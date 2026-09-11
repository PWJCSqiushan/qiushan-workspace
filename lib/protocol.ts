import {today, type Task} from './domain.ts';
import {AppError, validateTask, type Workspace} from './workspace.ts';

export type Space = 'personal' | 'demo';
export const editableKeys = ['flow','title','project','projectId','kind','start','end','due','location','notes','minutes','checklist','priority','coordLetter','coordOrder','emergency','flagged','daily','color','status','stage','boostReason'] as const;
export type EditableKey = typeof editableKeys[number];
export type Patch = Partial<Pick<Task, EditableKey>>;
export type Operation =
 | {kind:'create';task:Task}
 | {kind:'patch';patch:Patch}
 | {kind:'setFlagged';value:boolean}
 | {kind:'setCompleted';value:boolean;date:string;capturedAt:string}
 | {kind:'setDeleted';value:boolean}
 | {kind:'setStatus';value:string}
 | {kind:'setBoost';value:boolean;reason:string;date:string}
 | {kind:'settings';density:'compact'|'comfortable'};
export type Mutation = {clientId:string;operationId:string;space:Space;taskId?:string;baseVersion:number;operation:Operation};
export type Receipt = {task?:Task;settings?:Workspace['settings'];settingsVersion?:number;cursor:number;operationId:string;serverTime:string};
export type SyncResult = {mode:'snapshot'|'delta';space:Space;workspace?:Workspace;changes?:{seq:number;kind:string;dto:Omit<Receipt,'cursor'>}[];nextCursor:number;hasMore:boolean;settingsVersion:number;serverTime:string};
export class ConflictError extends AppError {constructor(public latest:Task|null,public code='VERSION_CONFLICT'){super('云端已有修改，草稿已保留，请处理冲突。',409);}}
export function stable(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable((value as Record<string,unknown>)[k])).join(',')+'}';
}
export async function sha256(value:unknown){const data=new TextEncoder().encode(typeof value==='string'?value:stable(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');}
export function checkMutation(v:unknown):Mutation {
 if(!v||typeof v!=='object')throw new AppError('操作格式无效');const m=v as Mutation;
 if(!['personal','demo'].includes(m.space)||![m.clientId,m.operationId].every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x))||!Number.isSafeInteger(m.baseVersion)||m.baseVersion<0||!m.operation||typeof m.operation!=='object')throw new AppError('操作标识或版本无效');
 if(m.operation.kind!=='settings'&&(typeof m.taskId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(m.taskId)))throw new AppError('事项 ID 无效');
 return m;
}
function requireBoolean(v:unknown):asserts v is boolean{if(typeof v!=='boolean')throw new AppError('目标状态必须明确为 true 或 false');}
export function applyTaskMutation(old:Task|null,m:Mutation,now=new Date()):Task {
 const op=m.operation,stamp=now.toISOString();
 if(op.kind==='create'){
  if(old||m.baseVersion!==0)throw new ConflictError(old);
  if(op.task.id!==m.taskId)throw new AppError('事项 ID 不匹配');
  return validateTask({...op.task,version:1,createdAt:stamp,updatedAt:stamp,completions:[],deletedAt:null,boostDate:'',boostAt:''});
 }
 if(!old||old.version!==m.baseVersion)throw new ConflictError(old);
 if(old.deletedAt&&!(op.kind==='setDeleted'&&op.value===false))throw new ConflictError(old,'DELETED_CONFLICT');
 const next=structuredClone(old);
 switch(op.kind){
  case 'patch':{
   if(!op.patch||typeof op.patch!=='object'||Array.isArray(op.patch)||Object.keys(op.patch).some(k=>!editableKeys.includes(k as EditableKey)))throw new AppError('包含不可编辑字段');
   Object.assign(next,op.patch);break;
  }
  case 'setFlagged':requireBoolean(op.value);next.flagged=op.value;break;
  case 'setDeleted':requireBoolean(op.value);next.deletedAt=op.value?stamp:null;break;
  case 'setStatus':next.status=op.value;if(op.value==='已结束'){next.boostDate='';next.boostAt='';}break;
  case 'setCompleted':{
   requireBoolean(op.value);if(!next.daily||next.status==='暂停'||next.status==='已结束')throw new AppError('该事项当前不能每日打卡');
   const captured=Date.parse(op.capturedAt);if(!/^\d{4}-\d{2}-\d{2}$/.test(op.date)||!Number.isFinite(Date.parse(op.date))||new Date(op.date).toISOString().slice(0,10)!==op.date||op.date>today(now)||!Number.isFinite(captured)||captured>+now+300000)throw new AppError('补记日期或设备时间无效，请核对后重试');
   next.completions=op.value?[...new Set([...next.completions,op.date])]:next.completions.filter(d=>d!==op.date);
   next.boostDate='';next.boostAt='';break;
  }
  case 'setBoost':requireBoolean(op.value);if(op.value&&op.date!==today(now))throw new AppError('临时提前仅在当天有效，请重新选择');next.boostDate=op.value?today(now):'';next.boostAt=op.value?stamp:'';if(op.value)next.boostReason=op.reason;break;
  default:throw new AppError('未知事项操作');
 }
 next.version=old.version+1;next.updatedAt=stamp;return validateTask(next);
}
export function changedFields(base:Task,draft:Task):Patch {const patch:Patch={};for(const k of editableKeys)if(stable(base[k])!==stable(draft[k]))(patch as Record<string,unknown>)[k]=draft[k];return patch;}
export function mergeThreeWay(base:Task,local:Task,remote:Task){
 const merged=structuredClone(remote),conflicts:EditableKey[]=[];
 for(const k of editableKeys){if(stable(local[k])===stable(base[k]))continue;if(stable(remote[k])!==stable(base[k])&&stable(remote[k])!==stable(local[k]))conflicts.push(k);else (merged as unknown as Record<string,unknown>)[k]=structuredClone(local[k]);}
 return {merged,conflicts,deletedConflict:!!remote.deletedAt&&!base.deletedAt};
}
