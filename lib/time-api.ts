import {body,json} from './http.ts';
import {AppError} from './workspace.ts';
import {TimeConflictError,TimeStore,type TimeSpace} from './time-store.ts';
import {exportTimeBackup,validateTimeBackup} from './time-backup.ts';
import type {ImportCandidate,TimeMutationEnvelope} from './time-domain.ts';
import {sha256} from './protocol.ts';

function spaceOf(value:unknown):TimeSpace{if(value!=='personal'&&value!=='demo')throw new AppError('工作区无效');return value;}
function operationId(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(value))throw new AppError('操作 ID 无效');return value;}

export function timeFailure(error:unknown,includeSnapshot=true){
  if(error instanceof TimeConflictError)return json({error:error.message,code:error.code,...(includeSnapshot?{latest:error.latest}:{}),version:error.latest.version},409);
  if(error instanceof AppError)return json({error:error.message,code:error.status===410?'SYNC_RESET_REQUIRED':undefined,...(includeSnapshot&&error instanceof Error&&'details' in error?{details:(error as Error & {details?:unknown}).details}: {})},error.status);
  console.error(JSON.stringify({code:'TIME_REQUEST_FAILED',name:error instanceof Error?error.name:'unknown'}));
  return json({error:'时间看板服务暂时不可用，操作已保留，请重试'},500);
}

/** Worker/route entry point. Garmin commit/pull may authenticate with its
 * scoped token when the normal session cookie is unavailable. */
export async function timeRoute(request:Request){try{return await timeRouteInternal(request);}catch(error){return timeFailure(error,!new URL(request.url).pathname.startsWith('/api/time/garmin'));}}
async function timeRouteInternal(request:Request){
  const {identity}=await import('./auth.ts');const {env}=await import('cloudflare:workers');const path=new URL(request.url).pathname;let user;
  try{user=await identity(request);}catch(error){
    if(!path.startsWith('/api/time/garmin')||!['pull','commit'].some(action=>path.endsWith('/'+action)))throw error;
    let payload:Record<string,unknown>={};try{payload=await body(request.clone() as unknown as Request) as Record<string,unknown>;}catch{throw error;}
    assertGarminTokenRoute(request,payload);
    const token=payload.token;if(typeof token!=='string'||!token)throw error;
    const row=await env.DB.prepare("SELECT owner_id,space FROM time_garmin_connections WHERE token_hash=? AND status='active'").bind(await sha256(token)).first<{owner_id:string;space:TimeSpace}>();
    if(!row||payload.space!==row.space)throw error;user={owner:row.owner_id};
  }
  return handleTimeRequest(request,new TimeStore(env.DB,user.owner));
}

export function assertGarminTokenRoute(request:Request,payload:Record<string,unknown>){const action=new URL(request.url).pathname.split('/').at(-1);if(request.method!=='POST'||!['pull','commit'].includes(action||'')||(payload.action!==undefined&&payload.action!==action))throw new AppError('Garmin 令牌不允许此操作',403);}

function routeParts(request:Request){return new URL(request.url).pathname.split('/').filter(Boolean).slice(2);}

/** Dispatch all /api/time/* requests after the caller has authenticated. */
export async function handleTimeRequest(request:Request,store:TimeStore){
  const url=new URL(request.url);const parts=routeParts(request);const top=parts[0]||'';const query=url.searchParams;const method=request.method.toUpperCase();
  if(method==='GET'&&(top==='sync'||top==='')){const space=spaceOf(query.get('space')||'personal');return json(await store.snapshot(space));}
  if(method==='GET'&&top==='stats'){const space=spaceOf(query.get('space')||'personal');const period=query.get('period') as 'day'|'week'|'month'|null;if(period&& !['day','week','month'].includes(period))throw new AppError('统计周期无效');return json(await store.stats(space,{from:query.get('from')||undefined,to:query.get('to')||undefined,period:period||undefined}));}
  if(method==='GET'&&top==='export'){const space=spaceOf(query.get('space')||'personal');return json(await exportTimeBackup(store,space));}
  if(top==='garmin')return handleGarminRequest(request,store,parts.slice(1));
  if(method==='POST'&&top==='mutations')return json(await store.mutate(await body(request)));
  if(method==='POST'&&top==='import'){
    const input=await body(request) as Record<string,unknown>;const space=spaceOf(input.space||'personal');const items=input.items;const source=typeof input.source==='string'?input.source:'import';if(!Array.isArray(items))throw new AppError('导入项目无效');
    if(input.action==='preview'||input.commit!==true)return json(await store.previewImport(space,items as ImportCandidate[],source,input.replace===true));
    const envelope={space,operationId:operationId(input.operationId),baseVersion:input.baseVersion,mutation:{type:'import',items:items as ImportCandidate[],source,replace:input.replace===true,importId:typeof input.importId==='string'?input.importId:undefined}};return json(await store.mutate(envelope));
  }
  if(method==='POST'&&top==='restore'){
    const input=await body(request) as Record<string,unknown>;const space=spaceOf(input.space||'personal');if(input.confirm!==true)throw new AppError('请先明确确认恢复时间数据');const backup=await validateTimeBackup(input.backup);const expectedVersion=input.expectedVersion??input.baseVersion;if(typeof expectedVersion!=='number'||!Number.isSafeInteger(expectedVersion))throw new AppError('恢复版本无效');return json(await store.restoreSnapshot(space,backup.time,operationId(input.operationId),expectedVersion));
  }
  return json({error:'时间接口不存在'},404);
}

async function handleGarminRequest(request:Request,store:TimeStore,path:string[]){
  const method=request.method.toUpperCase();const url=new URL(request.url);const action=path[0]||url.searchParams.get('action')||'';
  if(method==='GET'){
    const space=spaceOf(url.searchParams.get('space')||'personal');const connectionId=url.searchParams.get('connectionId')||undefined;return json(await store.garminStatus(space,connectionId));
  }
  if(method!=='POST')return json({error:'方法不支持'},405);
  const input=await body(request) as Record<string,unknown>;const space=spaceOf(input.space||'personal');const selected=String(input.action||action);
  if(selected==='request'){const queued=await store.queueGarminSync(space);return json({space,...queued,message:'已登记立即同步请求；请在本机同步器在线后轮询 status'});}
  if(selected==='token')return json(await store.createGarminConnection(space));
  const connectionId=typeof input.connectionId==='string'&&input.connectionId?input.connectionId:undefined;
  if(selected==='revoke'){return json(await store.revokeGarmin(space,connectionId));}
  if(selected==='pull'){
    if(typeof input.token!=='string'||!input.token)throw new AppError('缺少 Garmin 连接令牌',401);
    const verified=await store.verifyGarmin(space,connectionId,input.token);if(!verified.scopes.includes('time:import'))throw new AppError('Garmin 令牌权限无效',403);
    const current=await store.snapshot(space);const status=await store.garminStatus(space,verified.connectionId);return json({status:status.pendingRequest?'queued':'idle',connectionId:verified.connectionId,baseVersion:current.version,requestedAt:status.pendingRequest?.requestedAt||null,lastSyncAt:'lastSyncAt' in status?status.lastSyncAt||null:null,requestId:status.pendingRequest?.id||null},200);
  }
  if(selected==='commit'){
    if(typeof input.token!=='string'||!input.token)throw new AppError('缺少 Garmin 连接令牌',401);
    if(typeof input.operationId!=='string'||typeof input.baseVersion!=='number'||!Number.isSafeInteger(input.baseVersion)||(input.requestId!=null&&typeof input.requestId!=='string'))throw new AppError('Garmin 提交必须携带 operationId 和 baseVersion');
    const verified=await store.verifyGarmin(space,connectionId,input.token);if(!verified.scopes.includes('time:import'))throw new AppError('Garmin 令牌权限无效',403);if(!Array.isArray(input.items)||input.items.length>500)throw new AppError('Garmin 睡眠批次无效');
    const items=(input.items as ImportCandidate[]).map(item=>{if(item.kind!=='actual'||item.categoryId!=='sleep'||!item.sourceKey||!item.sourceKey.startsWith('garmin:'))throw new AppError('Garmin 只允许导入睡眠实际区间');return item;});
    const envelope:TimeMutationEnvelope={space,operationId:operationId(input.operationId),baseVersion:input.baseVersion,mutation:{type:'import',items,source:'garmin-cn',replace:false}};const result=await store.mutate(envelope);await store.markGarminSync(space,verified.connectionId,typeof input.requestId==='string'?input.requestId:undefined);const resultRecord=result as {operationId?:string;version?:number;snapshot?:{imports?:{accepted?:number;skipped?:number}[]}};const imported=resultRecord.snapshot?.imports?.at(-1);return json({status:'imported',connectionId:verified.connectionId,operationId:resultRecord.operationId,version:resultRecord.version,accepted:imported?.accepted??0,skipped:imported?.skipped??0},200);
  }
  return json({error:'Garmin 操作不存在'},404);
}
