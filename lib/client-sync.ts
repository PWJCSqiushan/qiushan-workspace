import {newTask,today,type Task} from './domain.ts';
import type {Workspace} from './workspace.ts';
import {changedFields,mergeThreeWay,stable,applyTaskMutation,type Mutation,type Operation,type Receipt,type Space,type SyncResult,type EditableKey} from './protocol.ts';
import {localGet,localPut,localRemove,localList} from './device-db.ts';
export type Session={owner:string;email:string;local:boolean;migrationEnabled?:boolean;loginId?:string;expiresAt:number;serverTime:string};
export type DraftRecord={base:Task;draft:Task;updatedAt:string};
export type QueueItem={mutation:Mutation;base:Task|null;local:Task|null;createdAt:string;attempted:boolean;state:'queued'|'conflict'|'failed';latest?:Task|null;fields?:EditableKey[];error?:string};
export type EngineState={workspace:Workspace|null;session:Session|null;message:string;queue:QueueItem[];error:string;clockOffset:number};
class NetworkError extends Error {constructor(message:string,public status=0,public detail:any=null){super(message);}}
export async function api<T=any>(path:string,init?:RequestInit){const r=await fetch(path,{signal:AbortSignal.timeout(15000),...init,cache:'no-store',redirect:'manual'});if(r.type==='opaqueredirect'||r.status===302||r.status===303)throw new NetworkError('登录已过期，请重新登录',401);if(!r.headers.get('content-type')?.includes('application/json'))throw new NetworkError('请重新登录',401);const data:any=await r.json();if(!r.ok)throw new NetworkError(data.error||'同步失败',r.status,data);return data as T;}
export class SyncEngine {
 session:Session|null=null;server:Workspace|null=null;queue:QueueItem[]=[];space:Space='personal';settingsVersion=0;clockOffset=0;message='正在连接';error='';clientId='';private cycle:Promise<void>|null=null;private stopped=false;private listener:(s:EngineState)=>void=()=>{};private timer:ReturnType<typeof setTimeout>|undefined;private authBlocked=false;
 scope(){return this.session!.owner+'/'+this.space+'/';}
 queueKey(id:string){return 'outbox/'+this.scope()+id;}
 draftKey(id:string){return 'draft/'+this.scope()+id;}
 emit(){this.listener({workspace:this.authBlocked?null:this.display(),session:this.session,message:this.message,queue:this.authBlocked?[]:[...this.queue],error:this.error,clockOffset:this.clockOffset});}
 display():Workspace|null{if(this.authBlocked||!this.server)return null;const w=structuredClone(this.server);for(const item of this.queue){if(item.local){const i=w.tasks.findIndex(t=>t.id===item.local!.id);if(i<0)w.tasks.push(item.local);else w.tasks[i]=item.local;}else if(item.mutation.operation.kind==='settings')w.settings={density:item.mutation.operation.density};}return w;}
 async start(listener:(s:EngineState)=>void){this.listener=listener;this.clientId=(await localGet<string>('clientId'))||crypto.randomUUID();await localPut('clientId',this.clientId);await this.connect();this.schedule();}
 stop(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
 private schedule(){if(this.stopped)return;this.timer=setTimeout(async()=>{await this.sync();this.schedule();},(document.hidden?60000:this.error?Math.min(60000,10000):5000)+Math.floor(Math.random()*250));}
 async connect(){try{const session:Session=await api('/api/session');const locked=await localGet<string>('loggedOut');if(locked===(session.loginId||String(session.expiresAt))){try{await api('/logout',{method:'POST'});}catch{}throw new NetworkError('已退出，请重新输入口令',401);}if(locked)await localRemove('loggedOut');this.clockOffset=Date.parse(session.serverTime)-Date.now();this.session=session;this.authBlocked=false;await localPut('session',session);await this.loadLocal();await this.sync();}catch(e){const prior=await localGet<Session>('session');if(!(await localGet('loggedOut'))&&!(e instanceof NetworkError&&[401,403].includes(e.status))&&prior&&prior.expiresAt>Date.now()){this.session=prior;await this.loadLocal();this.message='离线 · 已读取本机缓存';this.error='';}else{this.authBlocked=true;this.message='请登录';this.error=(e as Error).message;}this.emit();}}
 private async loadLocal(){this.server=await localGet<Workspace>('cache/'+this.scope())||{schemaVersion:1,space:this.space,revision:0,tasks:[],settings:{density:'compact'}};this.settingsVersion=await localGet<number>('settingsVersion/'+this.scope())||0;this.queue=(await localList<QueueItem>('outbox/'+this.scope())).map(x=>x.value).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.mutation.operationId.localeCompare(b.mutation.operationId));this.emit();}
 async switchSpace(space:Space){if(this.cycle)await this.cycle;this.space=space;this.server=null;await this.loadLocal();await this.sync();}
 async refresh(){if(this.authBlocked)await this.connect();else await this.sync();if(this.authBlocked)throw new Error('请重新登录，草稿仍保留');return this.display()!;}
 private async pull(){if(!this.session)return;let data:SyncResult&{owner?:string};try{data=await api('/api/sync?space='+this.space+'&cursor='+(this.server?.revision??0));}catch(e){if(e instanceof NetworkError&&e.status===410)data=await api('/api/sync?space='+this.space);else throw e;}if(data.owner&&data.owner!==this.session.owner)throw new NetworkError('身份已改变，请重新登录',401);
  if(data.mode==='snapshot')this.server=data.workspace!;else {const w=structuredClone(this.server!);for(const c of data.changes||[]){if(c.dto.task){const i=w.tasks.findIndex(t=>t.id===c.dto.task!.id);if(i<0)w.tasks.push(c.dto.task);else w.tasks[i]=c.dto.task;}if(c.dto.settings)w.settings=c.dto.settings;}w.revision=data.nextCursor;this.server=w;}
  this.settingsVersion=data.settingsVersion;this.clockOffset=Date.parse(data.serverTime)-Date.now();await localPut('cache/'+this.scope(),this.server);await localPut('settingsVersion/'+this.scope(),this.settingsVersion);if(data.hasMore)await this.pull();
 }
 async sync(){if(this.session&&this.session.expiresAt<=Date.now()){this.authBlocked=true;this.message='登录已过期 · 草稿已保留';this.emit();return;}if(this.cycle)return this.cycle;if(!this.session||this.authBlocked||this.stopped)return;this.cycle=this.runCycle().finally(()=>{this.cycle=null;});return this.cycle;}
 private async runCycle(){try{await this.pull();for(const item of [...this.queue]){if(this.authBlocked||this.stopped)break;if(item.state!=='queued')continue;if(this.queue.some(other=>other!==item&&other.mutation.taskId===item.mutation.taskId&&other.state!=='queued'))continue;await this.send(item);}this.message=this.queue.some(x=>x.state==='conflict')?'冲突 · 草稿已保留':this.queue.some(x=>x.state==='failed')?'同步失败 · 可导出重试':this.queue.length?'已存本机待同步':'已同步';this.error='';}catch(e){if(e instanceof NetworkError&&[401,403].includes(e.status)){this.authBlocked=true;this.message='登录已过期 · 草稿已保留';}else this.message='离线或连接失败 · 已存本机待同步';this.error=(e as Error).message;}finally{this.emit();}}
 private async saveItem(item:QueueItem){await localPut(this.queueKey(item.mutation.operationId),item);}
 private async send(item:QueueItem){this.message='正在同步';this.emit();try{
   // An attempted operation is immutable until a definitive server rejection.
   if(!item.attempted&&!this.rebase(item))return await this.saveItem(item);
   item.attempted=true;await this.saveItem(item);
   const result:Receipt=await api('/api/mutations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item.mutation)});
   if(result.task){const i=this.server!.tasks.findIndex(t=>t.id===result.task!.id);if(i<0)this.server!.tasks.push(result.task);else this.server!.tasks[i]=result.task;}
   if(result.settings){this.server!.settings=result.settings;this.settingsVersion=result.settingsVersion!;}
   await this.pull();await localRemove(this.queueKey(item.mutation.operationId));this.queue=this.queue.filter(x=>x!==item);
  }catch(e){if(!(e instanceof NetworkError)||![400,409,413].includes(e.status))throw e;
   if(e.status===409&&e.detail&&'latest' in e.detail){item.latest=e.detail.latest;item.state='conflict';item.error=e.message;if(item.base&&item.local&&item.latest){const merge=mergeThreeWay(item.base,item.local,item.latest);item.fields=merge.conflicts;if(!merge.deletedConflict&&!merge.conflicts.length&&item.mutation.operation.kind==='patch'){
      // A 409 is a definitive rejection. Retire the rejected ID, retaining its record.
      await localPut('rejected/'+this.scope()+item.mutation.operationId,item);await localRemove(this.queueKey(item.mutation.operationId));item.mutation={...item.mutation,operationId:crypto.randomUUID(),baseVersion:item.latest.version,operation:{kind:'patch',patch:changedFields(item.latest,merge.merged)}};item.base=item.latest;item.local=merge.merged;item.state='queued';item.attempted=false;await this.saveItem(item);return;
    }}}else {item.state='failed';item.error=e.message;}await this.saveItem(item);
  }}
 private rebase(item:QueueItem){if(item.mutation.operation.kind==='settings'){if(this.settingsVersion!==item.mutation.baseVersion){item.state='failed';item.error='显示设置已改变，请重新选择';return false;}return true;}
  const remote=this.server!.tasks.find(t=>t.id===item.mutation.taskId)||null;
  if(item.mutation.operation.kind==='create'){if(remote){item.state='conflict';item.latest=remote;item.error='此 ID 已存在';return false;}return true;}
  if(!remote||remote.deletedAt&&!(item.mutation.operation.kind==='setDeleted'&&!item.mutation.operation.value)){item.state='conflict';item.latest=remote;item.error='事项已被删除';return false;}
  if(remote.version===item.mutation.baseVersion)return true;
  if(item.base&&item.local){const merged=mergeThreeWay(item.base,item.local,remote);item.fields=merged.conflicts;if(merged.conflicts.length||merged.deletedConflict){item.state='conflict';item.latest=remote;item.error='同一字段存在不同修改';return false;}
   if(item.mutation.operation.kind==='patch'){item.mutation.operation={kind:'patch',patch:changedFields(remote,merged.merged)};item.local=merged.merged;}
   else {item.state='conflict';item.latest=remote;item.error='事项已改变，请确认此操作';return false;}
  }item.base=remote;item.mutation.baseVersion=remote.version;return true;
 }
 async enqueue(op:any,baseOverride?:Task){if(!this.session||this.authBlocked)throw new Error('请重新登录，草稿仍保留');const w=this.display();if(!w)throw new Error('尚未读取工作区');const base=baseOverride||w.tasks.find(t=>t.id===(op.task?.id||op.id))||null;const stamp=new Date(Date.now()+this.clockOffset),date=today(stamp);let operation:Operation,local:Task|null=base?structuredClone(base):null;
  switch(op.kind){case 'save':local=structuredClone(op.task);operation=local!.version===0&&!this.queue.some(q=>q.mutation.taskId===local!.id&&q.mutation.operation.kind==='create')?{kind:'create',task:local!}:{kind:'patch',patch:changedFields(base!,local!)};break;
   case 'flag':local!.flagged=!base!.flagged;operation={kind:'setFlagged',value:local!.flagged};break;
   case 'complete':if(base!.daily){const value=!base!.completions.includes(date);operation={kind:'setCompleted',value,date,capturedAt:stamp.toISOString()};local!.completions=value?[...base!.completions,date]:base!.completions.filter(d=>d!==date);}else{operation={kind:'setStatus',value:'已结束'};local!.status='已结束';}local!.boostDate='';local!.boostAt='';break;
   case 'finish':case 'reopen':operation={kind:'setStatus',value:op.kind==='finish'?'已结束':'准备推进'};local!.status=operation.value;break;
   case 'delete':case 'restore':operation={kind:'setDeleted',value:op.kind==='delete'};local!.deletedAt=operation.value?stamp.toISOString():null;break;
   case 'boost':operation={kind:'setBoost',value:base!.boostDate!==date,reason:op.reason||'',date};local!.boostDate=operation.value?date:'';local!.boostAt=operation.value?stamp.toISOString():'';break;
   case 'settings':operation={kind:'settings',density:op.density};break;
   default:throw new Error('此操作需要独立的预览与确认');}
  const item:QueueItem={mutation:{space:this.space,clientId:this.clientId,operationId:crypto.randomUUID(),taskId:local?.id,baseVersion:base?.version??this.settingsVersion,operation},base,local,createdAt:new Date(Math.max(Date.now(),...this.queue.map(q=>Date.parse(q.createdAt)+1))).toISOString(),attempted:false,state:'queued'};
  await this.saveItem(item);this.queue.push(item);this.message='已存本机待同步';this.emit();await this.sync();return this.display()!;
 }
 async retry(id:string){const item=this.queue.find(x=>x.mutation.operationId===id);if(!item)return;item.state='queued';await this.saveItem(item);await this.sync();}
 async resolve(id:string,choices:Partial<Record<EditableKey,'local'|'remote'>>,copy=false,discard=false){const item=this.queue.find(x=>x.mutation.operationId===id);if(!item)return;await localPut('resolved/'+this.scope()+id,item);
  if(!discard&&item.local){let task:Task;if(copy){task={...item.local,...{id:crypto.randomUUID(),version:0,deletedAt:null,completions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},title:item.local.title+'（冲突副本）'};}
   else {const latest=item.latest;if(!latest||(latest.deletedAt&&!(item.mutation.operation.kind==='setDeleted'&&!item.mutation.operation.value)))throw new Error('删除冲突只能保留删除或另存副本');if(item.mutation.operation.kind!=='patch'){task=applyTaskMutation(latest,{...item.mutation,baseVersion:latest.version});}else task=mergeThreeWay(item.base!,item.local,latest).merged;for(const field of item.mutation.operation.kind==='patch'?item.fields||[]:[]){if(!choices[field])throw new Error('请为每个冲突字段选择一个版本');(task as unknown as Record<string,unknown>)[field]=choices[field]==='local'?item.local[field]:latest[field];}}
   const newItem:QueueItem={mutation:{space:this.space,clientId:this.clientId,operationId:crypto.randomUUID(),taskId:task.id,baseVersion:copy?0:item.latest!.version,operation:copy?{kind:'create',task}:item.mutation.operation.kind==='patch'?{kind:'patch',patch:changedFields(item.latest!,task)}:item.mutation.operation},base:copy?null:item.latest!,local:task,createdAt:new Date().toISOString(),attempted:false,state:'queued'};await this.saveItem(newItem);this.queue.push(newItem);
  }await localRemove(this.queueKey(id));this.queue=this.queue.filter(x=>x!==item);this.emit();await this.sync();
 }
 async drafts(){return (await localList<DraftRecord>('draft/'+this.scope())).map(x=>x.value);}
 async saveDraft(base:Task,draft:Task){await localPut(this.draftKey(draft.id),{base,draft,updatedAt:new Date().toISOString()});}
 async clearDraft(id:string){await localRemove(this.draftKey(id));}
 async exportPending(){if(this.authBlocked)throw new Error('请重新登录后导出');return {exportedAt:new Date().toISOString(),space:this.space,owner:this.session?.owner,drafts:await this.drafts(),outbox:this.queue};}
 async logout(){this.authBlocked=true;this.stop();this.message='已退出 · 草稿已保留';this.emit();await localPut('loggedOut',this.session?.loginId||String(this.session?.expiresAt));await localPut('session',{...this.session,expiresAt:0});if(typeof caches!=='undefined')for(const name of await caches.keys())if(name.startsWith('qiushan-shell-'))await caches.delete(name);if(this.cycle)await this.cycle;this.server=null;try{await api('/logout',{method:'POST'});}catch{this.error='本机已锁定；联网后重新登录。';}this.emit();if(typeof location!=='undefined')location.assign('/login');}
}
