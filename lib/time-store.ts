import {gzipSync,gunzipSync} from 'node:zlib';
import {Buffer} from 'node:buffer';
import {AppError} from './workspace.ts';
import {sha256,stable} from './protocol.ts';
import {
  DEFAULT_TIME_CATEGORIES,applyTimeMutation,previewCourseMigration,courseMetadata,calculateTimeStats,canonicalTimestamp,
  type ImportCandidate,type TimeCategory,type TimeCoreSnapshot,type TimeCorrection,
  type TimeImportRecord,type TimeInterval,type TimeMutation,type TimeMutationEnvelope,
  type TimePlan,type TimeSnapshot,type TimeSourceRecord,type TimeStats,type TimeTimer,
  TimeValidationError,validateCategory,validateInterval,validatePlan,validateTimeCoreSnapshot,validateTimeHistory,
} from './time-domain.ts';

export type TimeSpace='personal'|'demo';
type Row=Record<string,any>;

const ID_RE=/^[A-Za-z0-9_-]{1,120}$/;
const MAX_RECORDS=10000;

export class TimeConflictError extends AppError {
  constructor(public latest:TimeSnapshot,public code='TIME_VERSION_CONFLICT'){
    super('时间看板已有修改，草稿已保留，请重新同步。',409);
  }
}

function isSpace(value:unknown):value is TimeSpace{return value==='personal'||value==='demo';}
function ensureSpace(value:unknown):asserts value is TimeSpace{if(!isSpace(value))throw new AppError('工作区无效');}
function jsonParse<T>(value:string,fallback:T):T{try{return JSON.parse(value) as T;}catch{return fallback;}}
function nowIso(){return new Date().toISOString();}
function clone<T>(value:T):T{return structuredClone(value);}
function ensureCount(value:number,label:string){if(value>MAX_RECORDS)throw new AppError(`${label}过多，请先导出或分批整理`,413);}
function guard(owner:string,space:TimeSpace,version:number,operationId:string){return `EXISTS(SELECT 1 FROM time_heads WHERE owner_id=? AND space=? AND version=? AND last_operation_id=?)`;
}

function rowCategory(row:Row):TimeCategory{return {id:String(row.category_id),name:String(row.name),color:String(row.color),active:Number(row.active)!==0};}
function rowInterval(row:Row):TimeInterval{return {...jsonParse<Pick<TimeInterval,'courseGroupKey'|'generatedBy'>>(String(row.course_metadata||'{}'),{}),id:String(row.interval_id),start:String(row.start_at),end:String(row.end_at),categoryId:String(row.category_id),...(row.note?{note:String(row.note)}:{}),...(row.source_key?{sourceKey:String(row.source_key)}:{}),manual:Number(row.manual)!==0,...(Number(row.estimated)!==0?{estimated:true}:{}),version:Number(row.version)||1};}
function rowPlan(row:Row):TimePlan{return {...rowInterval(row),...courseMetadata(jsonParse(String(row.course_metadata||'{}'),{})),id:String(row.plan_id),status:row.status as TimePlan['status'],...(row.attendance?{attendance:String(row.attendance) as TimePlan['attendance']}: {})};}
function rowTimer(row:Row|undefined):TimeTimer|null{return row?{id:String(row.timer_id),start:String(row.start_at),categoryId:String(row.category_id),...(row.note?{note:String(row.note)}:{})}:null;}

export class TimeStore {
  constructor(public db:D1Database,public owner:string){}
  q(sql:string,...args:unknown[]){return this.db.prepare(sql).bind(...args);}

  async ensure(space:TimeSpace){
    ensureSpace(space);
    const stamp=nowIso();
    await this.db.batch([
      this.q('INSERT OR IGNORE INTO time_heads(owner_id,space,version,last_operation_id,updated_at) VALUES(?,?,0,NULL,?)',this.owner,space,stamp),
      ...DEFAULT_TIME_CATEGORIES.map((category,ordinal)=>this.q('INSERT OR IGNORE INTO time_categories(owner_id,space,category_id,name,color,active,ordinal) VALUES(?,?,?,?,?,?,?)',this.owner,space,category.id,category.name,category.color,category.active?1:0,ordinal)),
    ]);
  }

  async snapshot(space:TimeSpace):Promise<TimeSnapshot>{
    await this.ensure(space);
    const rows=await Promise.all([
      this.q('SELECT version FROM time_heads WHERE owner_id=? AND space=?',this.owner,space).first<Row>(),
      this.q('SELECT category_id,name,color,active FROM time_categories WHERE owner_id=? AND space=? ORDER BY ordinal,category_id',this.owner,space).all<Row>(),
      this.q('SELECT interval_id,start_at,end_at,category_id,note,source_key,manual,version,estimated,course_metadata FROM time_intervals WHERE owner_id=? AND space=? ORDER BY start_at,interval_id',this.owner,space).all<Row>(),
      this.q('SELECT plan_id,start_at,end_at,category_id,note,source_key,status,manual,version,estimated,attendance,course_metadata FROM time_plans WHERE owner_id=? AND space=? ORDER BY start_at,plan_id',this.owner,space).all<Row>(),
      this.q('SELECT timer_id,start_at,category_id,note FROM time_timers WHERE owner_id=? AND space=?',this.owner,space).first<Row>(),
      this.q('SELECT import_id,source,status,source_hash,item_count,accepted,skipped,created_at FROM time_imports WHERE owner_id=? AND space=? ORDER BY created_at ASC',this.owner,space).all<Row>(),
      this.q('SELECT source_key,kind,status,manual,record_id,payload,updated_at FROM time_sources WHERE owner_id=? AND space=? ORDER BY updated_at,source_key',this.owner,space).all<Row>(),
      this.q('SELECT correction_id,operation_id,kind,before_json,after_json,undone,created_at FROM time_corrections WHERE owner_id=? AND space=? ORDER BY created_at ASC',this.owner,space).all<Row>(),
    ]);
    const head=rows[0] as Row|undefined;
    if(!head)throw new AppError('时间工作区尚未配置',503);
    const imports=(rows[5] as {results:Row[]}).results.map(row=>({id:String(row.import_id),source:String(row.source),status:row.status as TimeImportRecord['status'],...(row.source_hash?{sourceHash:String(row.source_hash)}:{}),itemCount:Number(row.item_count),...(row.accepted===null||row.accepted===undefined?{}:{accepted:Number(row.accepted)}),...(row.skipped===null||row.skipped===undefined?{}:{skipped:Number(row.skipped)}),createdAt:String(row.created_at)}));
    const corrections=(rows[7] as {results:Row[]}).results.map(row=>({id:String(row.correction_id),operationId:String(row.operation_id),kind:String(row.kind),before:jsonParse<TimeCoreSnapshot>(String(row.before_json),{categories:[],intervals:[],plans:[],timer:null,sources:[]}),after:jsonParse<TimeCoreSnapshot>(String(row.after_json),{categories:[],intervals:[],plans:[],timer:null,sources:[]}),undone:Number(row.undone)!==0,createdAt:String(row.created_at)}));
    const sources=(rows[6] as {results:Row[]}).results.map(row=>({sourceKey:String(row.source_key),kind:row.kind as TimeSourceRecord['kind'],status:row.status as TimeSourceRecord['status'],manual:Number(row.manual)!==0,...(row.record_id?{recordId:String(row.record_id)}:{}),payload:jsonParse<Record<string,unknown>>(String(row.payload||'{}'),{}),updatedAt:String(row.updated_at)}));
    const intervalRows=(rows[2] as {results:Row[]}).results;const planRows=(rows[3] as {results:Row[]}).results;ensureCount(intervalRows.length,'实际区间');ensureCount(planRows.length,'计划');ensureCount(sources.length,'来源记录');
    return {owner:this.owner,space,version:Number(head.version),categories:(rows[1] as {results:Row[]}).results.map(rowCategory),intervals:intervalRows.map(rowInterval),plans:planRows.map(rowPlan),timer:rowTimer(rows[4] as Row|undefined),imports,corrections,sources};
  }

  private async receipt(space:TimeSpace,operationId:string,hash:string){
    const row=await this.q('SELECT request_hash,result_json,result_version FROM time_receipts WHERE owner_id=? AND space=? AND operation_id=?',this.owner,space,operationId).first<Row>();
    if(!row)return null;
    if(String(row.request_hash)!==hash)throw new AppError('操作 ID 已用于不同内容',409);
    if(!row.result_json||row.result_json==='{}'||Number(row.result_version)===0)return null;
    const stored=String(row.result_json);
    const text=stored.startsWith('gzip:')?gunzipSync(Buffer.from(stored.slice(5),'base64')).toString('utf8'):stored;
    return JSON.parse(text) as Record<string,unknown>;
  }

  private parseEnvelope(input:unknown):TimeMutationEnvelope {
    if(!input||typeof input!=='object')throw new AppError('时间操作格式无效');
    const raw=input as Record<string,unknown>;
    let mutation=(raw.mutation&&typeof raw.mutation==='object'?raw.mutation:raw) as TimeMutation & {backup?:unknown};
    const operationId=raw.operationId;
    const baseVersion=raw.baseVersion;
    ensureSpace(raw.space);
    if(typeof operationId!=='string'||!ID_RE.test(operationId)||!Number.isSafeInteger(baseVersion)||Number(baseVersion)<0)throw new AppError('时间操作标识或版本无效');
    if(!mutation||typeof mutation!=='object'||typeof (mutation as {type?:unknown}).type!=='string')throw new AppError('时间操作类型无效');
    return {space:raw.space as TimeSpace,operationId,baseVersion:baseVersion as number,mutation};
  }

  private async writeSnapshot(space:TimeSpace,operationId:string,hash:string,baseVersion:number,next:TimeSnapshot,options:{importRecord?:TimeImportRecord;correction?:TimeCorrection;replaceHistory?:boolean}={}):Promise<boolean>{
    validateTimeHistory(next);const stamp=nowIso();const h=guard(this.owner,space,next.version,operationId);const hArgs=[this.owner,space,next.version,operationId];
    const values=(params:unknown[])=>[...params,...hArgs];
    const statements:any[]=[
      this.q('INSERT INTO time_receipts(owner_id,space,operation_id,request_hash,result_json,result_version,created_at) VALUES(?,?,?,?,'+"'{}'"+',0,?)',this.owner,space,operationId,hash,stamp),
      this.q('UPDATE time_heads SET version=?,last_operation_id=?,updated_at=? WHERE owner_id=? AND space=? AND version=?',next.version,operationId,stamp,this.owner,space,baseVersion),
      this.q(`DELETE FROM time_categories WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])),
      ...next.categories.map((category,ordinal)=>this.q(`INSERT INTO time_categories(owner_id,space,category_id,name,color,active,ordinal) SELECT ?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,category.id,category.name,category.color,category.active?1:0,ordinal]))),
      this.q(`DELETE FROM time_intervals WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])),
      ...next.intervals.map(interval=>this.q(`INSERT INTO time_intervals(owner_id,space,interval_id,start_at,end_at,category_id,note,source_key,manual,estimated,version,created_at,updated_at,course_metadata) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,interval.id,interval.start,interval.end,interval.categoryId,interval.note||null,interval.sourceKey||null,interval.manual===false?0:1,interval.estimated?1:0,interval.version||1,stamp,stamp,JSON.stringify({courseGroupKey:interval.courseGroupKey,generatedBy:interval.generatedBy})]))),
      this.q(`DELETE FROM time_plans WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])),
      ...next.plans.map(plan=>this.q(`INSERT INTO time_plans(owner_id,space,plan_id,start_at,end_at,category_id,note,source_key,status,manual,estimated,version,created_at,updated_at,attendance,course_metadata) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,plan.id,plan.start,plan.end,plan.categoryId,plan.note||null,plan.sourceKey||null,plan.status,plan.manual===false?0:1,plan.estimated?1:0,plan.version||1,stamp,stamp,plan.attendance||null,JSON.stringify({...courseMetadata(plan),courseGroupKey:plan.courseGroupKey})]))),
      this.q(`DELETE FROM time_timers WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])),
    ];
    if(next.timer)statements.push(this.q(`INSERT INTO time_timers(owner_id,space,timer_id,start_at,category_id,note,version,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,next.timer.id||crypto.randomUUID(),next.timer.start,next.timer.categoryId,next.timer.note||null,1,stamp])));
    statements.push(this.q(`DELETE FROM time_sources WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])),...next.sources.map(source=>this.q(`INSERT INTO time_sources(owner_id,space,source_key,kind,status,manual,record_id,payload,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,source.sourceKey,source.kind,source.status,source.manual?1:0,source.recordId||null,JSON.stringify(source.payload||{}),source.updatedAt||stamp]))));
    if(options.replaceHistory){
      statements.push(this.q(`DELETE FROM time_imports WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])),this.q(`DELETE FROM time_corrections WHERE owner_id=? AND space=? AND ${h}`,...values([this.owner,space])));
      for(const item of next.imports)statements.push(this.q(`INSERT INTO time_imports(owner_id,space,import_id,source,status,source_hash,item_count,accepted,skipped,created_at,payload) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,item.id,item.source,item.status,item.sourceHash||null,item.itemCount,item.accepted??null,item.skipped??null,item.createdAt,JSON.stringify(item)])));
      for(const item of next.corrections)statements.push(this.q(`INSERT INTO time_corrections(owner_id,space,correction_id,operation_id,kind,before_json,after_json,undone,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,item.id,item.operationId,item.kind,JSON.stringify(item.before),JSON.stringify(item.after),item.undone?1:0,item.createdAt])));
    } else {
      if(options.importRecord) {const item=options.importRecord;statements.push(this.q(`INSERT INTO time_imports(owner_id,space,import_id,source,status,source_hash,item_count,accepted,skipped,created_at,payload) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,item.id,item.source,item.status,item.sourceHash||null,item.itemCount,item.accepted??null,item.skipped??null,item.createdAt,JSON.stringify(item)])));}
      if(options.correction) {const item=options.correction;statements.push(this.q(`INSERT INTO time_corrections(owner_id,space,correction_id,operation_id,kind,before_json,after_json,undone,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${h}`,...values([this.owner,space,item.id,item.operationId,item.kind,JSON.stringify(item.before),JSON.stringify(item.after),item.undone?1:0,item.createdAt])));}
    }
    if(!options.replaceHistory)for(const item of next.corrections.filter(x=>x.undone))statements.push(this.q(`UPDATE time_corrections SET undone=1 WHERE owner_id=? AND space=? AND correction_id=? AND ${h}`,...values([this.owner,space,item.id])));
    const result={operationId,version:next.version,snapshot:next};
    // D1 limits an entire row to 2 MB. Keep exact idempotent receipts without
    // duplicating uncompressed correction history into one oversized row.
    const receiptJson=JSON.stringify(result);
    const storedReceipt=Buffer.byteLength(receiptJson)>262144?'gzip:'+gzipSync(receiptJson).toString('base64'):receiptJson;
    if(Buffer.byteLength(storedReceipt)>1800000)throw new AppError('本次同步回执超过存储容量，修改仍保留在本机，请导出备份并联系维护者',413);
    statements.push(this.q(`UPDATE time_receipts SET result_json=?,result_version=? WHERE owner_id=? AND space=? AND operation_id=? AND ${h}`,storedReceipt,next.version,this.owner,space,operationId,...hArgs));
    try{await this.db.batch(statements);}catch(error){const prior=await this.receipt(space,operationId,hash);if(prior)return false;throw error;}
    const head=await this.q('SELECT version,last_operation_id FROM time_heads WHERE owner_id=? AND space=?',this.owner,space).first<Row>();
    const receipt=await this.receipt(space,operationId,hash);
    if(!head||Number(head.version)!==next.version||String(head.last_operation_id)!==operationId||!receipt){
      if(receipt)return false;
      await this.q("DELETE FROM time_receipts WHERE owner_id=? AND space=? AND operation_id=? AND request_hash=? AND result_json='{}'",this.owner,space,operationId,hash).run();
      return false;
    }
    return true;
  }

  async mutate(input:unknown):Promise<Record<string,unknown>> {
    const envelope=this.parseEnvelope(input);const {space,operationId,baseVersion,mutation}=envelope;await this.ensure(space);
    if(mutation.type==='restore'){
      const {validateTimeBackup}=await import('./time-backup.ts');
      const backup=await validateTimeBackup((mutation as unknown as {backup?:unknown}).backup);
      return this.restoreSnapshot(space,backup.time,operationId,baseVersion);
    }
    const hash=await sha256(envelope);const prior=await this.receipt(space,operationId,hash);if(prior)return prior;
    const before=await this.snapshot(space);if(before.version!==baseVersion)throw new TimeConflictError(before);
    let applied;
    try{applied=applyTimeMutation(before,mutation,operationId,new Date());}catch(error){if(error instanceof TimeValidationError||error instanceof AppError)throw error;throw new AppError('时间操作无效');}
    const next=applied.snapshot;if(next.version===before.version)return {operationId,version:next.version,snapshot:next,changed:false};let importRecord:TimeImportRecord|undefined;let correction=applied.correction;
    if(mutation.type==='import'){
      const accepted=applied.accepted?.length||0,skipped=applied.skipped?.length||0;const sourceHash=await sha256(mutation.items);importRecord={id:mutation.importId&&ID_RE.test(mutation.importId)?mutation.importId:crypto.randomUUID(),source:mutation.source,status:skipped?'partial':'committed',sourceHash,itemCount:mutation.items.length,accepted,skipped,createdAt:nowIso()};next.imports=[...before.imports,importRecord];
    }
    if(correction)next.corrections=[...before.corrections,correction];
    const ok=await this.writeSnapshot(space,operationId,hash,baseVersion,next,{importRecord,correction});
    if(!ok){const final=await this.receipt(space,operationId,hash);if(final)return final;throw new TimeConflictError(await this.snapshot(space));}
    const final=await this.receipt(space,operationId,hash);if(final)return final;throw new AppError('时间操作回执缺失',503);
  }

  async previewCourses(space:TimeSpace){return previewCourseMigration(await this.snapshot(space));}
  async rollover(space:TimeSpace){
    for(let attempt=0;attempt<3;attempt++){const before=await this.snapshot(space);try{const result=await this.mutate({space,baseVersion:before.version,operationId:'rollover-'+crypto.randomUUID(),mutation:{type:'rolloverCourses'}});return {...result,version:Number(result.version),changed:result.version!==before.version};}catch(error){if(!(error instanceof TimeConflictError)||attempt===2)throw error;}}
    throw new AppError('课程补算冲突',409);
  }

  async stats(space:TimeSpace,options:{from?:string;to?:string;period?:'day'|'week'|'month';now?:Date}={}):Promise<TimeStats>{return calculateTimeStats(await this.snapshot(space),options);}

  async previewImport(space:TimeSpace,items:ImportCandidate[],source='import',replace=false){
    const snapshot=await this.snapshot(space);const operationId='preview-'+crypto.randomUUID();const hash=await sha256({items,source,replace});
    try{const result=applyTimeMutation(snapshot,{type:'import',items,source,replace},operationId,new Date());return {space,baseVersion:snapshot.version,source,sourceHash:hash,itemCount:items.length,accepted:result.accepted||[],skipped:result.skipped||[],preview:result.snapshot};}catch(error){if(error instanceof TimeValidationError)return {space,baseVersion:snapshot.version,source,sourceHash:hash,itemCount:items.length,accepted:[],skipped:[],error:error.message,code:(error.details as {code?:string}|undefined)?.code,details:error.details};throw error;}
  }

  async exportSnapshot(space:TimeSpace){return this.snapshot(space);}

  async restoreSnapshot(space:TimeSpace,input:TimeSnapshot,operationId:string,expectedVersion:number){
    await this.ensure(space);const hash=await sha256({space,operationId,input});const prior=await this.receipt(space,operationId,hash);if(prior)return prior;const current=await this.snapshot(space);if(current.version!==expectedVersion)throw new TimeConflictError(current);
    if(input.space!==space)throw new AppError('时间备份所属工作区不一致');
    const core:TimeCoreSnapshot={categories:clone(input.categories),intervals:clone(input.intervals),plans:clone(input.plans),timer:clone(input.timer),sources:clone(input.sources||[])};
    validateTimeCoreSnapshot(core);validateTimeHistory(input);
    const next:TimeSnapshot={...clone(input),owner:this.owner,space,version:expectedVersion+1,...core};const ok=await this.writeSnapshot(space,operationId,hash,expectedVersion,next,{replaceHistory:true});if(!ok)throw new TimeConflictError(await this.snapshot(space));const final=await this.receipt(space,operationId,hash);if(final)return final;throw new AppError('时间恢复回执缺失',503);
  }

  async createGarminConnection(space:TimeSpace,scopes=['time:import']){
    await this.ensure(space);const bytes=crypto.getRandomValues(new Uint8Array(32));const token=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');const connectionId=crypto.randomUUID();const stamp=nowIso();await this.q('INSERT INTO time_garmin_connections(owner_id,space,connection_id,token_hash,status,scopes,created_at,revoked_at,last_sync_at) VALUES(?,?,?,?,?,?,?,?,?)',this.owner,space,connectionId,await sha256(token),'active',JSON.stringify(scopes),stamp,null,null).run();return {connectionId,token,scopes,createdAt:stamp};
  }
  async queueGarminSync(space:TimeSpace){await this.ensure(space);const requestId=crypto.randomUUID();const stamp=nowIso();await this.q("INSERT INTO time_sync_requests(owner_id,space,request_id,status,requested_at,completed_at) VALUES(?,?,?,'queued',?,NULL)",this.owner,space,requestId,stamp).run();return {requestId,status:'queued',requestedAt:stamp};}
  async garminStatus(space:TimeSpace,connectionId?:string){const row=await (connectionId?this.q('SELECT connection_id,status,scopes,created_at,revoked_at,last_sync_at FROM time_garmin_connections WHERE owner_id=? AND space=? AND connection_id=?',this.owner,space,connectionId):this.q('SELECT connection_id,status,scopes,created_at,revoked_at,last_sync_at FROM time_garmin_connections WHERE owner_id=? AND space=? ORDER BY created_at DESC LIMIT 1',this.owner,space)).first<Row>();const pending=await this.q("SELECT request_id,status,requested_at,completed_at FROM time_sync_requests WHERE owner_id=? AND space=? AND status='queued' ORDER BY requested_at DESC LIMIT 1",this.owner,space).first<Row>();if(!row)return {connectionId:null,status:'not_connected',scopes:['time:import'],message:'尚未连接 Garmin',...(pending?{pendingRequest:{id:String(pending.request_id),status:String(pending.status),requestedAt:String(pending.requested_at)}}:{})};return {connectionId:String(row.connection_id),status:String(row.status),scopes:jsonParse<string[]>(String(row.scopes),[]),createdAt:String(row.created_at),...(row.revoked_at?{revokedAt:String(row.revoked_at)}:{}),...(row.last_sync_at?{lastSyncAt:String(row.last_sync_at)}:{}),...(pending?{pendingRequest:{id:String(pending.request_id),status:String(pending.status),requestedAt:String(pending.requested_at)}}:{})};}
  async revokeGarmin(space:TimeSpace,connectionId?:string){const current=connectionId||String((await this.q('SELECT connection_id FROM time_garmin_connections WHERE owner_id=? AND space=? ORDER BY created_at DESC LIMIT 1',this.owner,space).first<Row>())?.connection_id||'');if(!current)throw new AppError('Garmin 尚未连接',404);const stamp=nowIso();const result=await this.q("UPDATE time_garmin_connections SET status='revoked',revoked_at=? WHERE owner_id=? AND space=? AND connection_id=? AND status='active'",stamp,this.owner,space,current).run();if(!result.meta?.changes)throw new AppError('Garmin 连接不存在或已撤销',404);return this.garminStatus(space,current);}
  async verifyGarmin(space:TimeSpace,connectionId:string|undefined,token:string){const row=await (connectionId?this.q("SELECT connection_id,status,token_hash,scopes FROM time_garmin_connections WHERE owner_id=? AND space=? AND connection_id=?",this.owner,space,connectionId):this.q("SELECT connection_id,status,token_hash,scopes FROM time_garmin_connections WHERE owner_id=? AND space=? ORDER BY created_at DESC LIMIT 1",this.owner,space)).first<Row>();if(!row||row.status!=='active'||await sha256(token)!==row.token_hash)throw new AppError('Garmin 连接无效或已撤销',401);return {connectionId:String(row.connection_id),scopes:jsonParse<string[]>(String(row.scopes),[])};}
  async markGarminSync(space:TimeSpace,connectionId:string,requestId?:string){const stamp=nowIso();await this.q('UPDATE time_garmin_connections SET last_sync_at=? WHERE owner_id=? AND space=? AND connection_id=?',stamp,this.owner,space,connectionId).run();if(requestId)await this.q("UPDATE time_sync_requests SET status='completed',completed_at=? WHERE owner_id=? AND space=? AND request_id=? AND status='queued'",stamp,this.owner,space,requestId).run();}
}

export async function rolloverAllCourses(db:D1Database){
  const heads=await db.prepare('SELECT owner_id,space FROM time_heads').all<{owner_id:string;space:TimeSpace}>();
  return Promise.all(heads.results.map(row=>new TimeStore(db,row.owner_id).rollover(row.space)));
}
