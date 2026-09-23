import {localGet,localPut,localRemove,localList} from './device-db.ts';
export type TimeCategory={id:string;name:string;color:string;active:boolean};
export type TimeInterval={id:string;start:string;end:string;categoryId:string;note:string;sourceKey?:string;manual?:boolean;estimated?:boolean};
export type TimePlan=TimeInterval&{status:string;attendance?:'on_time'|'late_under_5'|'late_over_5'|'absent'|'excused'};
export type TimeSnapshot={owner:string;version:number;categories:TimeCategory[];intervals:TimeInterval[];plans:TimePlan[];timer:{id?:string;start:string;categoryId:string;note:string}|null;imports:{id:string;source:string;accepted?:number;skipped?:number;createdAt?:string}[];corrections:{id:string;createdAt?:string;kind?:string;undone?:boolean}[]};
export type TimeMutation=Record<string,unknown>&{type:string};
export type PendingTime={operationId:string;baseVersion:number;mutation:TimeMutation;state:'queued'|'conflict'|'failed';error?:string;createdAt:string};
type TimeSession={owner:string;expiresAt:number};
export class TimeRequestError extends Error{constructor(message:string,public status:number,public payload:Record<string,unknown>){super(message);}}
export async function timeRequest<T>(url:string,init?:RequestInit):Promise<T>{const response=await fetch(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000),...init});if(!response.headers.get('content-type')?.includes('application/json')){const expired=[0,301,302,303,307,308,401].includes(response.status);throw new TimeRequestError(expired?'登录已失效，请重新登录。草稿仍保留在本机。':'服务暂时不可用，将自动重试；修改已保留在本机。',expired?401:(response.status>=400?response.status:503),{});}const data=await response.json() as Record<string,unknown>;if(!response.ok)throw new TimeRequestError(String(data.error||'请求失败'),response.status,data);return data as T;}
export class TimeClient{
 session:TimeSession|null=null; data:TimeSnapshot|null=null; pending:PendingTime[]=[]; message='正在连接'; blocked=false; stopped=false; private busy:Promise<void>|null=null; private edits:Promise<unknown>=Promise.resolve(); private acknowledgedVersion=0; private requested=false;
 constructor(public space:'personal'|'demo',private notify:()=>void){}
 scope(){return this.session?.owner+'/'+this.space;}
 emit(){if(!this.stopped)this.notify();}
 async start(){try{this.session=await timeRequest<TimeSession>('/api/session');await localPut('time/session',this.session);}catch(error){if(error instanceof TimeRequestError&&error.status===401){this.blocked=true;this.message=error.message;this.emit();return;}const prior=await localGet<TimeSession>('time/session');if(!prior||prior.expiresAt<=Date.now()){this.blocked=true;this.message='联网登录后可恢复本机草稿';this.emit();return;}this.session=prior;this.message='离线 · 本机缓存';}this.data=await localGet<TimeSnapshot>('time/cache/'+this.scope())||null;await this.loadPending();this.emit();await this.sync();}
 async loadPending(){this.pending=(await localList<PendingTime>('time/outbox/'+this.scope()+'/')).map(r=>r.value).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
 async saveDraft(value:unknown){if(this.session)await localPut('time/draft/'+this.scope(),value);}
 async draft<T>(){return this.session?localGet<T>('time/draft/'+this.scope()):undefined;}
 private edit<T>(action:()=>Promise<T>):Promise<T>{const result=this.edits.then(action);this.edits=result.catch(()=>{});return result;}
 async enqueue(mutation:TimeMutation){await this.edit(async()=>{
  if(!this.session||this.blocked||!this.data)throw new Error('请先联网登录并加载时间看板');
  await this.loadPending();
  const baseVersion=Math.max(this.data.version,this.acknowledgedVersion,...this.pending.map(p=>p.baseVersion+1));
  const last=this.pending.at(-1);const createdAt=new Date(Math.max(Date.now(),last?Date.parse(last.createdAt)+1:0)).toISOString();
  const item:PendingTime={operationId:crypto.randomUUID(),baseVersion,mutation,state:'queued',createdAt};
  await localPut('time/outbox/'+this.scope()+'/'+item.operationId,item);await this.loadPending();this.message='已保存到本机 · 等待同步';this.emit();
 });await this.sync();}
 async sync(){this.requested=true;if(this.busy)return this.busy;if(!this.session||this.blocked||this.stopped)return;
  this.busy=(async()=>{do{this.requested=false;const healthy=await this.run();if(!healthy)break;}while(this.requested&&!this.blocked&&!this.stopped);})();
  try{await this.busy;}finally{this.busy=null;}
 }
 private async accept(latest:TimeSnapshot){if(latest.owner!==this.session?.owner)throw new TimeRequestError('登录身份已改变，原草稿已保留',401,{});if(!this.data||this.data.version!==latest.version){this.data=latest;await localPut('time/cache/'+this.scope(),latest);}this.acknowledgedVersion=Math.max(this.acknowledgedVersion,latest.version);}
 private async refresh(){await this.accept(await timeRequest<TimeSnapshot>('/api/time/sync?space='+this.space));}
 private async run(){try{
  while(!this.stopped){
   await this.edit(()=>this.loadPending());const item=this.pending[0];if(!item||item.state!=='queued')break;
   try{
    const result=await timeRequest<{version:number;snapshot?:TimeSnapshot}>('/api/time/mutations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({space:this.space,operationId:item.operationId,baseVersion:item.baseVersion,mutation:item.mutation})});
    await this.edit(async()=>{if(result.snapshot)await this.accept(result.snapshot);this.acknowledgedVersion=Math.max(this.acknowledgedVersion,result.version);await localRemove('time/outbox/'+this.scope()+'/'+item.operationId);await this.loadPending();});
   }catch(e){if(e instanceof TimeRequestError&&e.status!==401&&e.status<500&&![408,429].includes(e.status)){item.state=e.status===409?'conflict':'failed';item.error=e.message;await localPut('time/outbox/'+this.scope()+'/'+item.operationId,item);}else{item.error=e instanceof TimeRequestError?`服务端请求失败（HTTP ${e.status}）：${e.message}`:e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'请求超时，稍后重试':e instanceof TypeError?'连接请求失败，稍后重试':'本机处理失败，请保留此页面并重试';await localPut('time/outbox/'+this.scope()+'/'+item.operationId,item);}throw e;}
  }
  await this.refresh();this.message=this.pending.length?'有修改需要核对，后续提交已保留':'已同步 · 时间版本 '+this.data?.version;return true;
 }catch(e){
  if(e instanceof TimeRequestError){this.message=e.message;if(e.status===401){this.blocked=true;this.data=null;}else if(e.status===409){try{await this.refresh();}catch(refreshError){if(refreshError instanceof TimeRequestError&&refreshError.status===401){this.blocked=true;this.data=null;this.message=refreshError.message;}}}}
  else this.message=e instanceof Error&&['TimeoutError','AbortError'].includes(e.name)?'请求超时 · 修改已保留，将重试':e instanceof TypeError?'连接请求失败 · 修改已保留，将重试':'本机处理失败 · 请保留此页面并重试';return false;
 }finally{await this.edit(()=>this.loadPending());this.emit();}}
 async resolve(id:string,retry:boolean){if(this.busy)await this.busy;
  await this.edit(async()=>{await this.loadPending();const item=this.pending.find(p=>p.operationId===id);if(!item||!this.data||this.blocked||item.state==='queued')return;
   if(retry)await this.refresh();
   await localPut('time/archive/'+this.scope()+'/'+id,item);
   if(retry){const replacement:PendingTime={...item,operationId:crypto.randomUUID(),baseVersion:this.data!.version,state:'queued',error:undefined};await localPut('time/outbox/'+this.scope()+'/'+replacement.operationId,replacement);}
   await localRemove('time/outbox/'+this.scope()+'/'+id);await this.loadPending();this.emit();
  });await this.sync();
 }

}
export const shanghaiDate=(time=Date.now())=>new Date(time+8*3600000).toISOString().slice(0,10);
export const dayStart=(day:string)=>Date.parse(day+'T00:00:00+08:00');
export const localClock=(iso:string)=>new Date(Date.parse(iso)+8*3600000).toISOString().slice(11,16);
export const atLocal=(day:string,time:string)=>new Date(day+'T'+time+':00+08:00').toISOString();
export function clippedMinutes(rows:TimeInterval[],start:number,end:number,now=Date.now()){const cap=Math.min(end,now);return rows.reduce((total,row)=>total+Math.max(0,Math.min(Date.parse(row.end),cap)-Math.max(Date.parse(row.start),start))/60000,0);}
