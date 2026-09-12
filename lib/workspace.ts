import {FLOWS,STATUSES,newTask,demoTasks,today,stampMs} from './domain.ts';
import type {Task} from './domain.ts';
import type {TaskEvent} from './analytics.ts';
export type HistoryData={version:1;events:TaskEvent[];coverage:{since:string;incomplete:boolean;unknown:number}};
export type Settings={density:'compact'|'comfortable'};
export type Workspace={schemaVersion:1;space:'personal'|'demo';revision:number;tasks:Task[];settings:Settings;queueVersion?:number;coordinationReady?:boolean;history?:HistoryData};
export class AppError extends Error{status:number;constructor(message:string,status=400){super(message);this.status=status;}}
function ensure(ok:unknown,message:string):asserts ok{if(!ok)throw new AppError(message);}
function str(v:unknown,max=1000):v is string{return typeof v==='string'&&v.length<=max;}
function validDay(v:string){return /^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
function present(record:Record<string,unknown>,key:string){return Object.prototype.hasOwnProperty.call(record,key)&&record[key]!==undefined;}
export function validateTask(v:unknown):Task{
 ensure(v&&typeof v==='object'&&!Array.isArray(v),'事项格式无效');const t=v as Task;
 ensure(str(t.id,100)&&/^[a-zA-Z0-9_-]+$/.test(t.id),'事项 ID 无效');
 ensure(str(t.title,200)&&t.title.trim(),'请填写事项名称（最多 200 字）');ensure(FLOWS.some(f=>f.id===t.flow),'请选择工作流');
 ensure(STATUSES.includes(t.status),'状态无效');
 for(const k of ['project','location','stage','boostReason'] as const)ensure(str(t[k],1000),`${k} 内容过长或格式无效`);
 ensure(str(t.notes,20000),'备注最多 20000 字');
 for(const k of ['priority','coordLetter'] as const)ensure(str(t[k],3)&&/^(?:[A-Z][+-]?|NA|未定)?$/.test(t[k])&&t[k]!=='EM','优先级格式无效；紧急请使用 EM 开关');
 if(present(t as unknown as Record<string,unknown>,'kind'))ensure(t.kind==='project'||t.kind==='task','事项类型无效');
 if(present(t as unknown as Record<string,unknown>,'projectId'))ensure(str(t.projectId,100)&&(!t.projectId||/^[a-zA-Z0-9_-]+$/.test(t.projectId)),'项目 ID 无效');
 ensure(!(t.kind==='project'&&t.projectId&&t.projectId!==''),'项目不能关联父项目');
 ensure(!t.projectId||t.projectId!==t.id,'事项不能关联自己');
 ensure(t.coordOrder===null||(Number.isSafeInteger(t.coordOrder)&&t.coordOrder>=0&&t.coordOrder<=999999),'协调数字须为非负整数');
 if(t.queueReturn!==undefined)ensure(t.queueReturn&&typeof t.queueReturn==='object'&&Object.keys(t.queueReturn).every(k=>['complete','deleted'].includes(k))&&Object.values(t.queueReturn).every(n=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<=999999),'编号恢复信息无效');
 ensure(t.coordLetter!=='NA'||t.coordOrder===null,'NA 不应同时带有执行数字');
 ensure(t.minutes===null||(Number.isFinite(t.minutes)&&t.minutes>=0&&t.minutes<=1000000),'预计耗时须为非负分钟数');
 for(const k of ['emergency','flagged','daily'] as const)ensure(typeof t[k]==='boolean',`${k} 格式无效`);
 ensure(/^#[0-9a-fA-F]{6}$/.test(t.color),'卡片颜色无效');
 for(const k of ['start','end','due'] as const)ensure(str(t[k],16)&&(!t[k]||((/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(t[k]))&&validDay(t[k].slice(0,10))&&Number.isFinite(stampMs(t[k])))),'时间格式无效');
 ensure(!t.end||!!t.start,'请先填写活动开始时间');ensure(!t.end||stampMs(t.end)>=stampMs(t.start),'活动结束时间不能早于开始时间');
 ensure(str(t.boostDate,10)&&(!t.boostDate||validDay(t.boostDate)),'临时插队日期无效');
 ensure(Array.isArray(t.checklist)&&t.checklist.length<=200&&t.checklist.every(i=>i&&str(i.id,100)&&str(i.text,500)&&typeof i.done==='boolean')&&new Set(t.checklist.map(i=>i.id)).size===t.checklist.length,'检查清单格式无效');
 ensure(Array.isArray(t.completions)&&t.completions.length<=50000&&t.completions.every(x=>typeof x==='string'&&validDay(x)),'每日完成记录无效');
 for(const k of ['createdAt','updatedAt'] as const)ensure(str(t[k],40)&&Number.isFinite(Date.parse(t[k])),'记录时间无效');
 ensure(str(t.boostAt,40)&&(!t.boostAt||Number.isFinite(Date.parse(t.boostAt))),'插队时间无效');
 ensure(t.deletedAt===null||(str(t.deletedAt,40)&&Number.isFinite(Date.parse(t.deletedAt))),'回收站时间无效');
 ensure(Number.isSafeInteger(t.version)&&t.version>=0,'事项版本无效');
 return {...newTask(t.flow),...t,title:t.title.trim(),completions:[...new Set(t.completions)]};
}
/**
 * Validate relationships after the complete workspace is available. A missing
 * parent is intentionally allowed: soft-deleted/ended parents must not make a
 * child disappear, and old backups may contain a dangling compatibility ID.
 */
export function validateTaskRelations(tasks:readonly Task[]):void{
 const byId=new Map<string,Task>();
 for(const task of tasks){ensure(!byId.has(task.id),'备份中含有重复事项 ID');byId.set(task.id,task);}
 for(const task of tasks){
  if(!task.projectId)continue;
  ensure(task.projectId!==task.id,'事项不能关联自己');
  const parent=byId.get(task.projectId);
  if(parent)ensure(parent.kind==='project','项目关系只能指向项目事项');
 }
}
export function validateImport(v:unknown):Workspace{ensure(v&&typeof v==='object','备份格式无效');const w=v as Workspace;ensure(w.schemaVersion===1,'不支持此备份版本');ensure(Array.isArray(w.tasks)&&w.tasks.length<=5000,'备份最多支持 5000 张卡片');const tasks=w.tasks.map(validateTask);ensure(new Set(tasks.map(t=>t.id)).size===tasks.length,'备份中含有重复事项 ID');validateTaskRelations(tasks);ensure(w.settings&&['compact','comfortable'].includes(w.settings.density),'备份设置无效');return {...w,tasks};}
export function applyOperation(w:Workspace,op:any,now=new Date()):Workspace{
 ensure(op&&typeof op==='object','操作无效');const next=structuredClone(w);const stamp=now.toISOString();const date=today(now);let i=next.tasks.findIndex(t=>t.id===op.id);
 if(op.kind==='createMany'){ensure(Array.isArray(op.tasks)&&op.tasks.length<=200,'每批最多 200 项');const batch=op.tasks.map(validateTask);ensure(new Set(batch.map((t:Task)=>t.id)).size===batch.length,'批次含重复 ID');ensure(next.tasks.length+batch.length<=5000,'事项过多');ensure(batch.every((t:Task)=>!next.tasks.some(x=>x.id===t.id)),'批次中的事项已存在，未重复添加');next.tasks.push(...batch.map((t:Task)=>({...t,version:1,createdAt:stamp,updatedAt:stamp,completions:[],deletedAt:null})));
 }else if(op.kind==='save') {const source=op.task as Task;const draft=validateTask(source);i=next.tasks.findIndex(t=>t.id===draft.id);if(i>=0){ensure(next.tasks[i].version===draft.version,'事项版本不一致，请重新读取');draft.createdAt=next.tasks[i].createdAt;draft.completions=next.tasks[i].completions;draft.deletedAt=next.tasks[i].deletedAt;if(!Object.prototype.hasOwnProperty.call(source,'kind')&&next.tasks[i].kind!==undefined)draft.kind=next.tasks[i].kind;if(!Object.prototype.hasOwnProperty.call(source,'projectId')&&next.tasks[i].projectId!==undefined)draft.projectId=next.tasks[i].projectId;}else{ensure(next.tasks.length<5000,'最多支持 5000 张卡片');ensure(draft.version===0,'新卡片版本应为 0');draft.createdAt=stamp;draft.completions=[];draft.deletedAt=null;}draft.version++;draft.updatedAt=stamp;i<0?next.tasks.push(draft):next.tasks[i]=draft;
 }else if(op.kind==='settings'){ensure(['compact','comfortable'].includes(op.density),'显示密度无效');next.settings.density=op.density;
 }else if(op.kind==='import'){const imported=validateImport(op.data);next.tasks=imported.tasks.map(t=>({...t,version:Math.max(t.version,next.tasks.find(x=>x.id===t.id)?.version??0)+1,updatedAt:stamp}));next.settings=imported.settings;
 }else{ensure(i>=0,'事项不存在');const t=next.tasks[i];ensure(op.kind==='restore'||!t.deletedAt,'请先从回收站恢复事项');switch(op.kind){
 case 'flag':t.flagged=!t.flagged;break;
 case 'complete':ensure(t.status!=='暂停','暂停中的任务不能打卡，请先恢复推进');if(t.daily){t.completions=t.completions.includes(date)?t.completions.filter(d=>d!==date):[...t.completions,date];}else t.status='已结束';t.boostDate='';t.boostAt='';break;
 case 'finish':t.status='已结束';t.boostDate='';break;
 case 'reopen':t.status='准备推进';break;
 case 'delete':t.deletedAt=stamp;break;
 case 'restore':t.deletedAt=null;break;
 case 'boost':ensure(str(op.reason??'',1000),'插队原因过长');if(t.boostDate===date){t.boostDate='';t.boostAt='';}else{t.boostDate=date;t.boostAt=stamp;t.boostReason=op.reason??'';}break;
 default:throw new AppError('未知操作');}t.version++;t.updatedAt=stamp;}
 validateTaskRelations(next.tasks);next.revision++;return next;
}
export function emptyWorkspace(space:'personal'|'demo'):Workspace{return {schemaVersion:1,space,revision:0,tasks:space==='demo'?demoTasks():[],settings:{density:'compact'}};}
