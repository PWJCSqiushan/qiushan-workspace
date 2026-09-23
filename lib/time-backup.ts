import {AppError} from './workspace.ts';
import {sha256} from './protocol.ts';
import {TimeStore,type TimeSpace} from './time-store.ts';
import {validateTimeCoreSnapshot,validateTimeHistory,type TimeSnapshot} from './time-domain.ts';

export type TimeBackupEnvelope={
  schemaVersion:1;
  kind:'time-board';
  exportedAt:string;
  space:TimeSpace;
  version:number;
  sha256:string;
  time:TimeSnapshot;
};

export async function exportTimeBackup(store:TimeStore,space:TimeSpace):Promise<TimeBackupEnvelope>{
  const time=await store.exportSnapshot(space);const hash=await sha256(time);return {schemaVersion:1,kind:'time-board',exportedAt:new Date().toISOString(),space,version:time.version,sha256:hash,time};
}

export async function validateTimeBackup(value:unknown):Promise<TimeBackupEnvelope>{
  if(!value||typeof value!=='object')throw new AppError('时间备份格式无效');const backup=value as Partial<TimeBackupEnvelope>;
  if(backup.schemaVersion!==1||backup.kind!=='time-board'||(backup.space!=='personal'&&backup.space!=='demo')||!backup.time||typeof backup.time!=='object')throw new AppError('不支持的时间备份版本');
  const time=backup.time as TimeSnapshot;if(time.space!==backup.space||!Number.isSafeInteger(time.version)||time.version<0||!Array.isArray(time.categories)||!Array.isArray(time.intervals)||!Array.isArray(time.plans))throw new AppError('时间备份内容无效');
  validateTimeCoreSnapshot({categories:time.categories,intervals:time.intervals,plans:time.plans,timer:time.timer,sources:time.sources||[]});
  validateTimeHistory(time);const hash=await sha256(time);if(typeof backup.sha256!=='string'||hash!==backup.sha256)throw new AppError('时间备份校验失败',400);
  return backup as TimeBackupEnvelope;
}

export async function backupTimeAll(db:D1Database,kv:KVNamespace,options:{ownerId?:string;id?:string}={}):Promise<Array<{owner:string;space:TimeSpace;id:string;status:'success'|'failed';sha256?:string;error?:string}>>{
  const owners=await (options.ownerId?db.prepare('SELECT owner_id FROM owners WHERE owner_id=?').bind(options.ownerId):db.prepare('SELECT owner_id FROM owners')).all<{owner_id:string}>();const results=[];
  for(const row of owners.results){for(const space of ['personal','demo'] as const){const store=new TimeStore(db,row.owner_id);const id=options.id||new Date().toISOString().slice(0,10)+'-time-daily';try{const backup=await exportTimeBackup(store,space);const raw=JSON.stringify(backup);const hash=backup.sha256;await kv.put(`time/${row.owner_id}/${space}/${id}/${hash}`,raw,{metadata:{sha256:hash,revision:backup.version}});await db.prepare('INSERT INTO time_backup_runs(owner_id,space,id,status,bytes,sha256,error,created_at) VALUES(?,?,?,\'success\',?,?,NULL,?) ON CONFLICT(owner_id,space,id) DO UPDATE SET status=\'success\',bytes=excluded.bytes,sha256=excluded.sha256,error=NULL,created_at=excluded.created_at').bind(row.owner_id,space,id,new TextEncoder().encode(raw).byteLength,hash,new Date().toISOString()).run();results.push({owner:row.owner_id,space,id,status:'success' as const,sha256:hash});}catch(error){const message=error instanceof Error?error.message:'TIME_BACKUP_FAILED';await db.prepare('INSERT INTO time_backup_runs(owner_id,space,id,status,bytes,sha256,error,created_at) VALUES(?,?,?,\'failed\',0,NULL,?,?) ON CONFLICT(owner_id,space,id) DO UPDATE SET status=\'failed\',error=excluded.error,created_at=excluded.created_at').bind(row.owner_id,space,id,message,new Date().toISOString()).run();results.push({owner:row.owner_id,space,id,status:'failed' as const,error:message});}}}
  return results;
}
