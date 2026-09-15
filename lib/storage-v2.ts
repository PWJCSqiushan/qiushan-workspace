import {AppError,validateImport,validateSettings,type Settings,type Workspace} from './workspace.ts';
import {today,type Task} from './domain.ts';
import {CategoryValidationError,validateCategory,validateCategoryPatch,type Category} from './categories.ts';
import {normalizeQueue} from './coordination.ts';
import {coordinationState,mutateCoordinated,readHistory,writeEvents} from './coordinated-store.ts';
import {validateHistory} from './history-validation.ts';
import {applyTaskMutation,checkMutation,ConflictError,sha256,stable,type Receipt,type Space,type SyncResult} from './protocol.ts';

type Row=Record<string,any>;
type SettingsState={settings:Settings;version:number};
const settingKinds=new Set(['settings','categoryCreate','categoryUpdate']);

export class Store {
 constructor(public db:D1Database,public owner:string){}
 q(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args);}
 async initialize(subject:string){await this.db.batch([
  this.q('INSERT OR IGNORE INTO owners(owner_id,subject) VALUES(?,?)',this.owner,subject),
  ...(['personal','demo'] as Space[]).flatMap(space=>[
   this.q('INSERT OR IGNORE INTO workspaces_v2(owner_id,space,revision,schema_version) VALUES(?,?,0,2)',this.owner,space),
   this.q('INSERT OR IGNORE INTO workspace_settings(owner_id,space,version,payload) VALUES(?,?,0,?)',this.owner,space,'{"density":"compact"}')])]);}
 private async settingsState(space:Space):Promise<SettingsState>{
  const row=await this.q('SELECT version,payload FROM workspace_settings WHERE owner_id=? AND space=?',this.owner,space).first<Row>();
  if(!row)throw new AppError('工作区尚未配置',503);
  try{return {settings:validateSettings(JSON.parse(row.payload)),version:Number(row.version)};}catch(error){if(error instanceof AppError)throw error;throw new AppError('工作区设置无效',503);}
 }
 private settingsConflict(state:SettingsState,code='SETTINGS_CONFLICT'){return new ConflictError(null,code,state.settings,state.version);}
  private categoryReferenceError(old:Task|null,next:Task,state:SettingsState):ConflictError|null{
   if(!next.categoryId)return null;
   const category=state.settings.categories?.find(item=>item.id===next.categoryId);
   if(!category||category.flow!==next.flow||(category.archived&&old?.categoryId!==next.categoryId))return this.settingsConflict(state,'CATEGORY_CONFLICT');
   return null;
  }
  /** Resolve restore-only directory retention before preview or commit. */
  private resolveRestoreCategories(before:Workspace,incoming:Settings,tasks:readonly Task[]):Settings{
   let effective:Settings=incoming.categories===undefined&&before.settings.categories!==undefined?{...incoming,categories:structuredClone(before.settings.categories)}:incoming;
   const categories=effective.categories?[...effective.categories]:[];
   for(const task of tasks){
    if(!task.categoryId||categories.some(category=>category.id===task.categoryId))continue;
    const historical=before.settings.categories?.find(category=>category.id===task.categoryId);
    if(!historical)throw new AppError('恢复目录缺少仍被引用的分类，请补全备份目录',409);
    if(categories.some(category=>category.flow===historical.flow&&category.name===historical.name))throw new AppError('恢复目录与保留历史分类同流重名，请先处理目录',409);
    categories.push({...historical,archived:true});
   }
   effective=categories.length?{...effective,categories}:effective;
   effective=validateSettings(effective);
   for(const task of tasks)if(task.categoryId){const category=effective.categories?.find(item=>item.id===task.categoryId);if(!category||category.flow!==task.flow)throw new AppError('备份中的分类引用无效',400);}
   return effective;
  }
 async task(space:Space,id:string):Promise<Task|null>{const results=await this.db.batch([
  this.q('SELECT payload,version FROM tasks WHERE owner_id=? AND space=? AND task_id=?',this.owner,space,id),
  this.q('SELECT beijing_date FROM daily_completions WHERE owner_id=? AND space=? AND task_id=? AND completed=1 ORDER BY ordinal,beijing_date',this.owner,space,id)]);
  const r=results[0].results[0] as Row|undefined;return r?{...JSON.parse(r.payload),version:r.version,completions:results[1].results.map((d:any)=>d.beijing_date)}:null;}
 /** Check relation constraints before and inside the write batch. */
 async relationError(space:Space,next:Task):Promise<string|null>{
  if(next.kind!=='project'){
   const child=await this.q("SELECT task_id FROM tasks WHERE owner_id=? AND space=? AND json_extract(payload,'$.projectId')=? AND task_id<>? LIMIT 1",this.owner,space,next.id,next.id).first<Row>();
   if(child)return '已有子任务，不能将项目改为具体任务';
  }
  if(next.projectId){
   const parent=await this.q("SELECT task_id FROM tasks WHERE owner_id=? AND space=? AND task_id=? AND COALESCE(json_extract(payload,'$.kind'),'')<>'project' LIMIT 1",this.owner,space,next.projectId).first<Row>();
   if(parent)return '项目关系只能指向项目事项';
  }
  return null;
 }
 async snapshot(space:Space,includeHistory=false):Promise<{workspace:Workspace;settingsVersion:number}>{const rows=await this.db.batch([
  this.q('SELECT revision FROM workspaces_v2 WHERE owner_id=? AND space=?',this.owner,space),
  this.q('SELECT payload,version,task_id FROM tasks WHERE owner_id=? AND space=? ORDER BY ordinal,task_id',this.owner,space),
  this.q('SELECT task_id,beijing_date FROM daily_completions WHERE owner_id=? AND space=? AND completed=1 ORDER BY ordinal,beijing_date',this.owner,space),
   this.q('SELECT version,payload FROM workspace_settings WHERE owner_id=? AND space=?',this.owner,space),
   this.q('SELECT ready,queue_version,coverage FROM coordination_state WHERE owner_id=? AND space=?',this.owner,space),
   ...(includeHistory?[this.q('SELECT payload FROM task_events WHERE owner_id=? AND space=? ORDER BY event_id',this.owner,space)]:[])]);
  const head=rows[0].results[0] as Row|undefined,setting=rows[3].results[0] as Row|undefined;if(!head||!setting)throw new AppError('工作区尚未配置',503);
  const completions=new Map<string,string[]>();for(const d of rows[2].results as Row[]){const a=completions.get(d.task_id)||[];a.push(d.beijing_date);completions.set(d.task_id,a);}
  let settings:Settings;try{settings=validateSettings(JSON.parse(setting.payload));}catch(error){if(error instanceof AppError)throw error;throw new AppError('工作区设置无效',503);}
   const coord=(rows[4].results[0] as Row|undefined)||{ready:0,queue_version:0,coverage:JSON.stringify({since:today(),incomplete:true,unknown:0})};
   return {workspace:{...(Number(coord.ready)?{queueVersion:Number(coord.queue_version),coordinationReady:true}:{}),...(includeHistory&&Number(coord.ready)?{history:{version:1 as const,events:rows[5].results.map(r=>JSON.parse((r as Row).payload)),coverage:JSON.parse(String(coord.coverage))}}:{}),schemaVersion:1,space,revision:Number(head.revision),tasks:(rows[1].results as Row[]).map(r=>({...JSON.parse(r.payload),version:r.version,completions:completions.get(r.task_id)||[]})),settings},settingsVersion:Number(setting.version)};}
 async sync(space:Space,cursor:number|null):Promise<SyncResult>{
  if(cursor===null){const s=await this.snapshot(space);return {mode:'snapshot',space,...s,nextCursor:s.workspace.revision,hasMore:false,serverTime:new Date().toISOString()};}
  const r=await this.db.batch([this.q('SELECT revision FROM workspaces_v2 WHERE owner_id=? AND space=?',this.owner,space),this.q('SELECT seq,kind,dto_json FROM change_log WHERE owner_id=? AND space=? AND seq>? ORDER BY seq LIMIT 101',this.owner,space,cursor),this.q('SELECT version FROM workspace_settings WHERE owner_id=? AND space=?',this.owner,space)]);
  const head=r[0].results[0] as Row|undefined;if(!head)throw new AppError('工作区尚未配置',503);const logs=r[1].results as Row[];
  if(cursor>head.revision||(cursor<head.revision&&(!logs.length||logs[0].seq!==cursor+1))||logs.some(x=>x.kind==='reset'))throw new AppError('SYNC_RESET_REQUIRED',410);
  const coord=(await coordinationState(this,space));const changes=logs.slice(0,100).map(x=>({seq:x.seq,kind:x.kind,dto:JSON.parse(x.dto_json) as Omit<Receipt,'cursor'>}));return {mode:'delta',space,changes,...(coord.ready?{queueVersion:logs.length>100?changes.at(-1)?.dto.queueVersion:coord.queue_version,coordinationReady:true}:{}),nextCursor:changes.at(-1)?.seq??cursor,hasMore:logs.length>100,settingsVersion:Number((r[2].results[0] as Row).version),serverTime:new Date().toISOString()};
 }
 async receipt(space:Space,id:string,hash:string):Promise<Receipt|null>{const r=await this.q('SELECT request_hash,result_json,result_seq FROM mutation_receipts WHERE owner_id=? AND space=? AND operation_id=?',this.owner,space,id).first<Row>();if(!r)return null;if(r.request_hash!==hash)throw new AppError('操作 ID 已用于不同内容',409);return {...JSON.parse(r.result_json),cursor:Number(r.result_seq)};}
 async mutate(input:unknown):Promise<Receipt>{
  const checked=checkMutation(input);
  // Coordination gates task mutations only. Settings and category directory
  // edits keep their independent settings CAS semantics and do not consume a
  // queue version or emit task events.
  if(!settingKinds.has(checked.operation.kind)&&(await coordinationState(this,checked.space)).ready)return mutateCoordinated(this,checked);
  const m=checked,hash=await sha256(m),prior=await this.receipt(m.space,m.operationId,hash);if(prior)return prior;
  const stamp=new Date().toISOString(),op=m.operation;
  let next:Task|undefined;let old:Task|null=null;let settingPayload:Settings|undefined;let changedCategory:Category|undefined;
  const isSettingMutation=settingKinds.has(op.kind);
  const state=await this.settingsState(m.space);
  if(isSettingMutation){
   if(state.version!==m.baseVersion)throw this.settingsConflict(state);
   try{
    if(op.kind==='settings')settingPayload={...state.settings,density:op.density};
    else if(op.kind==='categoryCreate'){
     const category=validateCategory(op.category),categories=state.settings.categories||[];
     if(categories.some(item=>item.id===category.id))throw new AppError('分类 ID 已存在',409);
     if(categories.some(item=>item.flow===category.flow&&item.name===category.name))throw new AppError('同一工作流不能有同名分类',409);
     settingPayload={...state.settings,categories:[...categories,category]};changedCategory=category;
    }else if(op.kind==='categoryUpdate'){
     const current=state.settings.categories?.find(item=>item.id===op.categoryId);if(!current)throw new AppError('分类不存在',409);
     const patch=validateCategoryPatch(op.patch),candidate=validateCategory({...current,...patch});
     if(candidate.id!==current.id||candidate.flow!==current.flow)throw new AppError('分类不可修改工作流或 ID',400);
     if(state.settings.categories?.some(item=>item.id!==current.id&&item.flow===candidate.flow&&item.name===candidate.name))throw new AppError('同一工作流不能有同名分类',409);
     settingPayload={...state.settings,categories:(state.settings.categories||[]).map(item=>item.id===current.id?candidate:item)};changedCategory=candidate;
    }else throw new AppError('未知设置操作');
   }catch(error){if(error instanceof AppError)throw error;if(error instanceof CategoryValidationError)throw new AppError(error.message);throw error;}
  }else{
   old=await this.task(m.space,m.taskId!);
   try{next=applyTaskMutation(old,m,new Date(stamp));const categoryError=this.categoryReferenceError(old,next,state);if(categoryError)throw categoryError;const relationError=await this.relationError(m.space,next);if(relationError)throw new AppError(relationError,409);}catch(error){const retry=await this.receipt(m.space,m.operationId,hash);if(retry)return retry;throw error;}
  }
  if(isSettingMutation)settingPayload=validateSettings(settingPayload);
  const dto:Omit<Receipt,'cursor'>=next?{operationId:m.operationId,serverTime:stamp,task:next}:{operationId:m.operationId,serverTime:stamp,settings:settingPayload!,settingsVersion:state.version+1,...(changedCategory?{category:changedCategory,categories:settingPayload!.categories||[]}: {})};
  const args=[this.owner,m.space,m.operationId,m.clientId,hash,stamp],insert='INSERT INTO mutation_receipts(owner_id,space,operation_id,client_id,request_hash,created_at)';
  const guard=(condition:string,...values:unknown[])=>this.q(insert+' SELECT ?,?,?,?,?,? WHERE '+condition,...args,...values);
  const statements=[this.q(insert+' VALUES(?,?,?,?,?,?)',...args),guard('NOT EXISTS(SELECT 1 FROM workspaces_v2 WHERE owner_id=? AND space=?)',this.owner,m.space)];
  if(next){
   const exists='SELECT 1 FROM tasks WHERE owner_id=? AND space=? AND task_id=?';
   statements.push(guard(op.kind==='create'?'EXISTS('+exists+')':'NOT EXISTS('+exists+' AND version=?)',this.owner,m.space,m.taskId,...(op.kind==='create'?[]:[m.baseVersion])));
   if(op.kind==='create')statements.push(guard('(SELECT COUNT(*) FROM tasks WHERE owner_id=? AND space=?)>=5000',this.owner,m.space));
   const {completions,...payload}=next;
   if(op.kind==='create')statements.push(this.q('INSERT INTO tasks(owner_id,space,task_id,version,flow,status,deleted_at,updated_at,payload,ordinal) VALUES(?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(ordinal),-1)+1 FROM tasks WHERE owner_id=? AND space=?))',this.owner,m.space,next.id,next.version,next.flow,next.status,next.deletedAt,stamp,JSON.stringify(payload),this.owner,m.space));
   else statements.push(this.q('UPDATE tasks SET version=?,flow=?,status=?,deleted_at=?,updated_at=?,payload=? WHERE owner_id=? AND space=? AND task_id=? AND version=?',next.version,next.flow,next.status,next.deletedAt,stamp,JSON.stringify(payload),this.owner,m.space,next.id,m.baseVersion));
   statements.push(guard('NOT EXISTS('+exists+' AND version=?)',this.owner,m.space,next.id,next.version));
   if(next.kind!=='project')statements.push(guard("EXISTS(SELECT 1 FROM tasks child WHERE child.owner_id=? AND child.space=? AND json_extract(child.payload,'$.projectId')=? AND child.task_id<>?)",this.owner,m.space,next.id,next.id));
   if(next.projectId)statements.push(guard("EXISTS(SELECT 1 FROM tasks parent WHERE parent.owner_id=? AND parent.space=? AND parent.task_id=? AND COALESCE(json_extract(parent.payload,'$.kind'),'')<>'project')",this.owner,m.space,next.projectId));
   if(next.categoryId)statements.push(guard("NOT EXISTS(SELECT 1 FROM json_each((SELECT payload FROM workspace_settings WHERE owner_id=? AND space=?),'$.categories') c WHERE json_extract(c.value,'$.id')=? AND json_extract(c.value,'$.flow')=? AND (COALESCE(json_extract(c.value,'$.archived'),0)=0 OR ?=?))",this.owner,m.space,next.categoryId,next.flow,old?.categoryId||'',next.categoryId));
   if(op.kind==='setCompleted')statements.push(this.q('INSERT INTO daily_completions(owner_id,space,task_id,beijing_date,completed,version,ordinal) VALUES(?,?,?,?,?,1,?) ON CONFLICT(owner_id,space,task_id,beijing_date) DO UPDATE SET completed=excluded.completed,version=daily_completions.version+1,ordinal=excluded.ordinal',this.owner,m.space,next.id,op.date,op.value?1:0,Math.max(0,next.completions.indexOf(op.date))));
  }else{
   statements.push(guard('NOT EXISTS(SELECT 1 FROM workspace_settings WHERE owner_id=? AND space=? AND version=?)',this.owner,m.space,m.baseVersion));
   if(op.kind==='categoryCreate'){
    statements.push(guard("EXISTS(SELECT 1 FROM json_each((SELECT payload FROM workspace_settings WHERE owner_id=? AND space=?),'$.categories') WHERE json_extract(value,'$.id')=?)",this.owner,m.space,op.category.id));
    statements.push(guard("EXISTS(SELECT 1 FROM json_each((SELECT payload FROM workspace_settings WHERE owner_id=? AND space=?),'$.categories') WHERE json_extract(value,'$.flow')=? AND json_extract(value,'$.name')=?)",this.owner,m.space,op.category.flow,op.category.name));
   }else if(op.kind==='categoryUpdate'){
    const candidate=changedCategory!;
    statements.push(guard("NOT EXISTS(SELECT 1 FROM json_each((SELECT payload FROM workspace_settings WHERE owner_id=? AND space=?),'$.categories') WHERE json_extract(value,'$.id')=?)",this.owner,m.space,op.categoryId));
    statements.push(guard("EXISTS(SELECT 1 FROM json_each((SELECT payload FROM workspace_settings WHERE owner_id=? AND space=?),'$.categories') WHERE json_extract(value,'$.id')<>? AND json_extract(value,'$.flow')=? AND json_extract(value,'$.name')=?)",this.owner,m.space,candidate.id,candidate.flow,candidate.name));
   }
   statements.push(this.q('UPDATE workspace_settings SET version=version+1,payload=? WHERE owner_id=? AND space=? AND version=?',JSON.stringify(settingPayload),this.owner,m.space,m.baseVersion));
  }
  statements.push(this.q('UPDATE workspaces_v2 SET revision=revision+1 WHERE owner_id=? AND space=?',this.owner,m.space),this.q('INSERT INTO change_log(owner_id,space,seq,operation_id,kind,dto_json,created_at) SELECT owner_id,space,revision,?,?,?,? FROM workspaces_v2 WHERE owner_id=? AND space=?',m.operationId,next?'task':op.kind,JSON.stringify(dto),stamp,this.owner,m.space),this.q('UPDATE mutation_receipts SET result_json=?,result_seq=(SELECT revision FROM workspaces_v2 WHERE owner_id=? AND space=?) WHERE owner_id=? AND space=? AND operation_id=?',JSON.stringify(dto),this.owner,m.space,this.owner,m.space,m.operationId));
  statements.push(guard("NOT EXISTS(SELECT 1 FROM mutation_receipts r JOIN workspaces_v2 w ON r.owner_id=w.owner_id AND r.space=w.space WHERE r.owner_id=? AND r.space=? AND r.operation_id=? AND r.result_seq=w.revision AND r.result_seq>0 AND r.result_json=?)",this.owner,m.space,m.operationId,JSON.stringify(dto)));
  if(!next)statements.push(guard('NOT EXISTS(SELECT 1 FROM workspace_settings WHERE owner_id=? AND space=? AND version=?)',this.owner,m.space,m.baseVersion+1));
  try{await this.db.batch(statements);}catch(error){const retry=await this.receipt(m.space,m.operationId,hash);if(retry)return retry;if(next){const relationError=await this.relationError(m.space,next);if(relationError)throw new AppError(relationError,409);const latest=await this.task(m.space,m.taskId!);const latestSettings=await this.settingsState(m.space);if(op.kind==='create'?!!latest:latest?.version!==m.baseVersion)throw new ConflictError(latest,'VERSION_CONFLICT',latestSettings.settings,latestSettings.version);const categoryError=this.categoryReferenceError(old,next,latestSettings);if(categoryError)throw categoryError;}else{const latest=await this.settingsState(m.space);if(latest.version!==m.baseVersion)throw this.settingsConflict(latest);}throw error;}
  return (await this.receipt(m.space,m.operationId,hash))!;
 }
 async exportWorkspace(space:Space){return (await this.snapshot(space,true)).workspace;}
 async preview(space:Space,input:unknown,kind:'migration'|'restore'){
  const w=validateImport(input);if(w.history)validateHistory(w.history);if(w.space!==space)throw new AppError('备份所属工作区不一致');if(!Number.isSafeInteger(w.revision)||w.revision<0)throw new AppError('源版本无效');
  if(stable(w.tasks)!==stable((input as Workspace).tasks))throw new AppError('源数据需要规范化，请先审查差异');
  const current=await this.snapshot(space,true);
  if(kind==='restore'){
   const restoreTasks=[...w.tasks];
   for(const task of current.workspace.tasks)if(!restoreTasks.some(item=>item.id===task.id))restoreTasks.push({...task,version:task.version+1,deletedAt:task.deletedAt||'1970-01-01T00:00:00.000Z',updatedAt:task.updatedAt});
   this.resolveRestoreCategories(current.workspace,w.settings,restoreTasks);
  }
  const categoryNotice=kind==='restore'&&w.settings.categories===undefined?'恢复卡片无分类，现有分类目录保留':undefined;
  return {sourceHash:await sha256(w),taskCount:w.tasks.length,completionCount:w.tasks.reduce((n,t)=>n+t.completions.length,0),expectedRevision:current.workspace.revision,sourceRevision:w.revision,kind,categoryNotice,notice:categoryNotice};
 }
 async importWorkspace(space:Space,input:unknown,runId:string,sourceHash:string,expectedRevision:number,kind:'migration'|'restore'){
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(runId))throw new AppError('批次 ID 无效');
  const w=validateImport(input);if(stable(w.tasks)!==stable((input as Workspace).tasks))throw new AppError('源数据不能静默规范化');const actualHash=await sha256(w);if(actualHash!==sourceHash||w.space!==space)throw new AppError('源哈希或工作区不一致');
  const prior=await this.q('SELECT source_hash,result,kind FROM migration_runs WHERE owner_id=? AND space=? AND run_id=?',this.owner,space,runId).first<Row>();if(prior){if(prior.source_hash!==sourceHash||prior.kind!==kind)throw new AppError('批次 ID 已用于其他数据',409);return JSON.parse(prior.result);}
  const beforeSnapshot=await this.snapshot(space,true),before=beforeSnapshot.workspace;if(before.revision!==expectedRevision)throw new ConflictError(null,'VERSION_CONFLICT',before.settings,beforeSnapshot.settingsVersion);if(kind==='migration'&&(before.tasks.length||before.revision))throw new AppError('初次迁移要求空目标库',409);
  if(w.history)validateHistory(w.history);
  let effectiveSettings:Settings=w.settings;
  const stamp=new Date().toISOString(),revision=kind==='migration'?w.revision:before.revision+1;
  let tasks=kind==='migration'?w.tasks:w.tasks.map(t=>({...t,version:Math.max(t.version,before.tasks.find(x=>x.id===t.id)?.version??0)+1,updatedAt:stamp}));
  if(kind==='restore')for(const t of before.tasks)if(!tasks.some(x=>x.id===t.id))tasks.push({...t,version:t.version+1,deletedAt:stamp,updatedAt:stamp});
  if(kind==='restore')effectiveSettings=this.resolveRestoreCategories(before,w.settings,tasks);
  const coord=await coordinationState(this,space);
  if(coord.ready||w.coordinationReady||w.history)tasks=normalizeQueue(tasks);
  for(const task of tasks)if(task.categoryId){const category=effectiveSettings.categories?.find(item=>item.id===task.categoryId);if(!category||category.flow!==task.flow)throw new AppError('备份中的分类引用无效',400);}
  effectiveSettings=validateSettings(effectiveSettings);
  const categoryNotice=kind==='restore'&&w.settings.categories===undefined?'恢复卡片无分类，现有分类目录保留':undefined;
  const result={runId,sourceHash,revision,taskCount:tasks.length,completedAt:stamp,...(categoryNotice?{categoryNotice}: {})},raw=JSON.stringify(tasks);
  const statements=[this.q('INSERT INTO migration_runs(owner_id,space,run_id,kind,source_hash,result,created_at) VALUES(?,?,?,?,?,?,?)',this.owner,space,runId,kind,sourceHash,JSON.stringify(result),stamp),this.q('INSERT INTO migration_runs(owner_id,space,run_id,kind,source_hash,result,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspaces_v2 WHERE owner_id=? AND space=? AND revision=?)',this.owner,space,runId,kind,sourceHash,'{}',stamp,this.owner,space,expectedRevision),this.q('INSERT INTO snapshots_v2(owner_id,space,id,payload,created_at) VALUES(?,?,?,?,?)',this.owner,space,runId,JSON.stringify(before),stamp),
   this.q('INSERT INTO tasks(owner_id,space,task_id,version,flow,status,deleted_at,updated_at,payload,ordinal) SELECT ?,?,json_extract(value,\'$.id\'),json_extract(value,\'$.version\'),json_extract(value,\'$.flow\'),json_extract(value,\'$.status\'),json_extract(value,\'$.deletedAt\'),json_extract(value,\'$.updatedAt\'),json_remove(value,\'$.completions\'),CAST(key AS INTEGER) FROM json_each(?) WHERE true ON CONFLICT(owner_id,space,task_id) DO UPDATE SET version=excluded.version,flow=excluded.flow,status=excluded.status,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at,payload=excluded.payload,ordinal=excluded.ordinal',this.owner,space,raw),
   this.q('UPDATE daily_completions SET completed=0 WHERE owner_id=? AND space=?',this.owner,space),
   this.q('INSERT INTO daily_completions(owner_id,space,task_id,beijing_date,completed,version,ordinal) SELECT ?,?,json_extract(t.value,\'$.id\'),c.value,1,1,CAST(c.key AS INTEGER) FROM json_each(?) t,json_each(t.value,\'$.completions\') c WHERE true ON CONFLICT(owner_id,space,task_id,beijing_date) DO UPDATE SET completed=1,version=daily_completions.version+1,ordinal=excluded.ordinal',this.owner,space,raw),
   this.q('UPDATE workspace_settings SET payload=?,version=version+1 WHERE owner_id=? AND space=?',JSON.stringify(effectiveSettings),this.owner,space),this.q('UPDATE workspaces_v2 SET revision=? WHERE owner_id=? AND space=?',revision,this.owner,space),this.q('INSERT INTO change_log(owner_id,space,seq,operation_id,kind,dto_json,created_at) VALUES(?,?,?,?,?,?,?)',this.owner,space,revision,runId,'reset','{}',stamp)];
  if(kind==='restore')statements.push(this.q('DELETE FROM mutation_receipts WHERE owner_id=? AND space=?',this.owner,space));
  if(coord.ready||w.coordinationReady||w.history){const history=w.history?validateHistory(w.history):{...(await readHistory(this,space)),coverage:{...JSON.parse(coord.coverage),incomplete:true}};if(w.history)statements.push(this.q('DELETE FROM task_events WHERE owner_id=? AND space=?',this.owner,space),...writeEvents(this,space,history.events));statements.push(this.q('INSERT INTO coordination_state(owner_id,space,queue_version,ready,coverage) VALUES(?,?,?,1,?) ON CONFLICT(owner_id,space) DO UPDATE SET queue_version=excluded.queue_version,ready=1,coverage=excluded.coverage',this.owner,space,coord.queue_version+1,JSON.stringify(history.coverage)));}
  statements.push(this.q('INSERT INTO migration_runs(owner_id,space,run_id,kind,source_hash,result,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM workspace_settings s JOIN workspaces_v2 w ON s.owner_id=w.owner_id AND s.space=w.space WHERE s.owner_id=? AND s.space=? AND s.version=? AND s.payload=? AND w.revision=?)',this.owner,space,runId,kind,sourceHash,'{}',stamp,this.owner,space,beforeSnapshot.settingsVersion+1,JSON.stringify(effectiveSettings),revision));
  try{await this.db.batch(statements);}catch(error){const retry=await this.q('SELECT source_hash,result,kind FROM migration_runs WHERE owner_id=? AND space=? AND run_id=?',this.owner,space,runId).first<Row>();if(retry&&retry.source_hash===sourceHash&&retry.kind===kind)return JSON.parse(retry.result);if((await this.snapshot(space)).workspace.revision!==expectedRevision)throw new ConflictError(null,'VERSION_CONFLICT',(await this.snapshot(space)).workspace.settings,(await this.snapshot(space)).settingsVersion);throw error;}return result;
 }
}

