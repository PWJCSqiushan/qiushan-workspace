import {TIME_SLOT_MINUTES,TIME_SLOT_MS} from './time-grid.ts';
import {AppError} from './workspace.ts';

export const TIME_ZONE = 'Asia/Shanghai';
export const TIME_CATEGORY_IDS = [
  'sleep', 'class', 'study', 'exercise', 'meeting', 'commute', 'meal',
  'entertainment', 'buffer', 'free', 'other', 'unrecorded',
] as const;
export type TimeCategoryId = typeof TIME_CATEGORY_IDS[number];

export type TimeCategory = {
  id:string;
  name:string;
  color:string;
  active:boolean;
};

export type TimeInterval = {
  id:string;
  start:string;
  end:string;
  categoryId:string;
  note?:string;
  sourceKey?:string;
  manual?:boolean;
  estimated?:boolean;
  version?:number;
};

export type TimePlanStatus = 'planned'|'confirmed'|'cancelled';
export const TIME_ATTENDANCE_STATUSES = [
  'on_time', 'late_under_5', 'late_over_5', 'absent', 'excused',
] as const;
export type TimeAttendanceStatus = typeof TIME_ATTENDANCE_STATUSES[number];
export type TimePlan = TimeInterval & {status:TimePlanStatus;attendance?:TimeAttendanceStatus};
export type TimeTimer = {start:string;categoryId:string;note?:string;id?:string};

export type TimeImportRecord = {
  id:string;
  source:string;
  status:'preview'|'committed'|'partial'|'failed';
  sourceHash?:string;
  itemCount:number;
  accepted?:number;
  skipped?:number;
  createdAt:string;
};

export type TimeCoreSnapshot = {
  categories:TimeCategory[];
  intervals:TimeInterval[];
  plans:TimePlan[];
  timer:TimeTimer|null;
  sources:TimeSourceRecord[];
};

export type TimeSourceRecord = {
  sourceKey:string;
  kind:'actual'|'plan';
  status:'active'|'cancelled'|'deleted';
  manual:boolean;
  recordId?:string;
  payload?:Record<string,unknown>;
  updatedAt?:string;
};

export type TimeCorrection = {
  id:string;
  operationId:string;
  kind:string;
  before:TimeCoreSnapshot;
  after:TimeCoreSnapshot;
  undone:boolean;
  createdAt:string;
};

export type TimeSnapshot = TimeCoreSnapshot & {
  owner:string;
  space:'personal'|'demo';
  version:number;
  imports:TimeImportRecord[];
  corrections:TimeCorrection[];
};

export type ImportCandidate = {
  start:string;
  end:string;
  categoryId:string;
  note?:string;
  sourceKey?:string;
  kind:'plan'|'actual';
  estimated?:boolean;
  status?:TimePlanStatus;
};

export type TimeMutation =
  | {type:'upsert';interval:Partial<TimeInterval>&Pick<TimeInterval,'start'|'end'|'categoryId'>;replace?:boolean;confirmed?:boolean}
  | {type:'delete';id:string}
  | {type:'timerStart';start?:string;categoryId:string;note?:string}
  | {type:'timerStop';end?:string;replace?:boolean;confirmedLong?:boolean}
  | {type:'category';category:TimeCategory}
  | {type:'upsertPlan';plan:Partial<TimePlan>&Pick<TimePlan,'start'|'end'|'categoryId'>;restoreCancelled?:boolean}
  | {type:'undo';correctionId:string}
  | {type:'import';items:ImportCandidate[];source:string;replace?:boolean;importId?:string}
  | {type:'confirmPlan';ids:string[];replace?:boolean}
  | {type:'setAttendance';id:string;status:TimeAttendanceStatus}
  | {type:'cancelPlan';id:string}
  | {type:'restore';snapshot:TimeCoreSnapshot};

export type TimeMutationEnvelope = {
  space:'personal'|'demo';
  operationId:string;
  baseVersion:number;
  mutation:TimeMutation;
};

export type TimeStats = {
  from:string;
  to:string;
  elapsedMinutes:number;
  recordedMinutes:number;
  unrecordedMinutes:number;
  coverage:number;
  categories:Array<{categoryId:string;minutes:number;periodRatio:number;recordedRatio:number}>;
  daily:Array<{date:string;minutes:number;recordedMinutes:number;coverage:number}>;
  slotMinutes?:number;
  slots:Array<{start:string;end:string;parts:Array<{categoryId:string;minutes:number}>}>;
};

export class TimeValidationError extends AppError {
  constructor(message:string,status=400,public details?:unknown){super(message,status);}
}

const ID_RE=/^[A-Za-z0-9_-]{1,120}$/;
const SOURCE_KEY_RE=/^[A-Za-z0-9:_./-]{1,200}$/;
const COLOR_RE=/^#[0-9a-fA-F]{6}$/;
const LOCAL_TS_RE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DAY_RE=/^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_TIME_CATEGORIES:readonly TimeCategory[] = [
  {id:'sleep',name:'睡眠',color:'#8ECBE6',active:true},
  {id:'class',name:'上课',color:'#E4CD7C',active:true},
  {id:'study',name:'专注学习',color:'#73C6A2',active:true},
  {id:'exercise',name:'运动',color:'#B39AE7',active:true},
  {id:'meeting',name:'会议',color:'#E58E90',active:true},
  {id:'commute',name:'通勤',color:'#BA987A',active:true},
  {id:'meal',name:'用餐',color:'#EDA66C',active:true},
  {id:'entertainment',name:'娱乐',color:'#CF8FB6',active:true},
  {id:'buffer',name:'缓冲',color:'#7F9CB5',active:true},
  {id:'free',name:'自由时间',color:'#B8C5C6',active:true},
  {id:'other',name:'其他',color:'#A3AC87',active:true},
  // This is a legend item only. It is deliberately rejected for intervals.
  {id:'unrecorded',name:'未记录',color:'#5B6572',active:true},
];

const CATEGORY_KEYWORDS:Array<[RegExp,TimeCategoryId]>=[
  [/睡|起床|午睡/, 'sleep'],[/课|课程|上课/, 'class'],[/学|复习|作业|专注/, 'study'],
  [/跑|运动|训练|健身/, 'exercise'],[/会|组会|会议/, 'meeting'],[/通勤|公交|地铁|路上/, 'commute'],
  [/饭|吃|用餐|早餐|午餐|晚餐/, 'meal'],[/娱乐|游戏|电影|刷视频/, 'entertainment'],
  [/缓冲|休息|整理/, 'buffer'],[/自由|发呆|空闲/, 'free'],
];

function ensure(ok:unknown,message:string,status=400,details?:unknown):asserts ok {
  if(!ok)throw new TimeValidationError(message,status,details);
}

export function isTimeCategoryId(value:unknown):value is string {
  return typeof value==='string'&&ID_RE.test(value)&&value!=='unrecorded';
}

export function isTimeAttendanceStatus(value:unknown):value is TimeAttendanceStatus {
  return typeof value==='string'&&TIME_ATTENDANCE_STATUSES.includes(value as TimeAttendanceStatus);
}

export function canonicalTimestamp(value:unknown):string {
  ensure(typeof value==='string'&&LOCAL_TS_RE.test(value),'时间必须是 ISO 日期时间');
  const withZone=/Z|[+-]\d{2}:?\d{2}$/.test(value)?value:value+'+08:00';
  const ms=Date.parse(withZone);
  ensure(Number.isFinite(ms),'时间无效');
  return new Date(ms).toISOString();
}

export function timestampMs(value:string):number {
  const ms=Date.parse(value);
  return Number.isFinite(ms)?ms:NaN;
}

export function validateCategory(value:unknown):TimeCategory {
  ensure(!!value&&typeof value==='object'&&!Array.isArray(value),'时间分类格式无效');
  const category=value as Partial<TimeCategory>;
  ensure(typeof category.id==='string'&&ID_RE.test(category.id),'时间分类 ID 无效');
  ensure(category.id!=='unrecorded','未记录不能作为区间分类');
  ensure(typeof category.name==='string'&&category.name.trim().length>0&&category.name.length<=40,'时间分类名称无效');
  ensure(typeof category.color==='string'&&COLOR_RE.test(category.color),'时间分类颜色无效');
  ensure(typeof category.active==='boolean','时间分类启用状态无效');
  return {id:category.id!,name:category.name!.trim(),color:category.color!,active:category.active!};
}

export function validateInterval(value:unknown,allowUnrecorded=false):TimeInterval {
  ensure(!!value&&typeof value==='object'&&!Array.isArray(value),'时间区间格式无效');
  const input=value as Partial<TimeInterval>;
  const id=input.id===undefined?crypto.randomUUID():input.id;
  ensure(typeof id==='string'&&ID_RE.test(id),'时间区间 ID 无效');
  const start=canonicalTimestamp(input.start);
  const end=canonicalTimestamp(input.end);
  ensure(timestampMs(end)>timestampMs(start),'结束时间必须晚于开始时间');
  ensure(timestampMs(end)-timestampMs(start)<=8*24*60*60*1000,'单条时间区间不能超过 8 天');
  ensure(typeof input.categoryId==='string'&&(allowUnrecorded?ID_RE.test(input.categoryId):isTimeCategoryId(input.categoryId)),'时间分类无效');
  if(input.note!==undefined)ensure(typeof input.note==='string'&&input.note.length<=2000,'时间备注最多 2000 字');
  if(input.sourceKey!==undefined)ensure(typeof input.sourceKey==='string'&&SOURCE_KEY_RE.test(input.sourceKey),'来源标识无效');
  if(input.manual!==undefined)ensure(typeof input.manual==='boolean','手工标记无效');
  if(input.estimated!==undefined)ensure(typeof input.estimated==='boolean','估计标记无效');
  if(input.version!==undefined)ensure(Number.isSafeInteger(input.version)&&input.version>=0,'区间版本无效');
  return {id,start,end,categoryId:input.categoryId!,...(input.note?{note:input.note}:{}),...(input.sourceKey?{sourceKey:input.sourceKey}:{}),manual:input.manual!==false,...(input.estimated?{estimated:true}:{}),version:input.version??1};
}

export function validatePlan(value:unknown):TimePlan {
  ensure(!!value&&typeof value==='object','计划格式无效');
  const input=value as Partial<TimePlan>;
  ensure(input.status==='planned'||input.status==='confirmed'||input.status==='cancelled','计划状态无效');
  if(input.attendance!==undefined)ensure(isTimeAttendanceStatus(input.attendance),'出勤状态无效');
  return {...validateInterval(input),status:input.status,...(input.attendance===undefined?{}:{attendance:input.attendance})};
}

/** Validate a complete persisted time state before any replacement write. */
export function validateTimeCoreSnapshot(core:TimeCoreSnapshot,options:{now?:Date;allowFutureActual?:boolean}={}):TimeCoreSnapshot {
  ensure(!!core&&typeof core==='object'&&!Array.isArray(core),'时间数据格式无效');
  ensure(Array.isArray(core.categories)&&core.categories.length<=200,'时间分类过多');
  const categoryIds=new Set<string>();for(const category of core.categories){ensure(!categoryIds.has(category.id),'时间分类 ID 重复');categoryIds.add(category.id);if(category.id!=='unrecorded')validateCategory(category);}
  ensure(categoryIds.has('unrecorded'),'时间数据缺少未记录图例');
  ensure(Array.isArray(core.intervals)&&core.intervals.length<=10000,'实际区间过多');
  const intervalIds=new Set<string>();const now=options.now?.getTime()??Date.now();
  for(const interval of core.intervals){validateInterval(interval);ensure(!intervalIds.has(interval.id),'实际区间 ID 重复');intervalIds.add(interval.id);ensure(categoryIds.has(interval.categoryId)&&interval.categoryId!=='unrecorded','实际区间分类不存在');if(!options.allowFutureActual)ensure(timestampMs(interval.end)<=now,'实际时间不能在未来');}
  const sortedIntervals=[...core.intervals].sort((a,b)=>timestampMs(a.start)-timestampMs(b.start));for(let i=1;i<sortedIntervals.length;i++)ensure(!overlaps(sortedIntervals[i-1],sortedIntervals[i]),'实际区间不能重叠');
  ensure(Array.isArray(core.plans)&&core.plans.length<=10000,'计划过多');const planIds=new Set<string>();
  for(const plan of core.plans){validatePlan(plan);ensure(!planIds.has(plan.id),'计划 ID 重复');planIds.add(plan.id);ensure(categoryIds.has(plan.categoryId)&&plan.categoryId!=='unrecorded','计划分类不存在');}
  if(core.timer){canonicalTimestamp(core.timer.start);ensure(categoryIds.has(core.timer.categoryId)&&core.timer.categoryId!=='unrecorded','计时分类不存在');ensure(timestampMs(core.timer.start)<=now,'计时开始不能在未来');}
  ensure(Array.isArray(core.sources)&&core.sources.length<=10000,'来源记录过多');const sourceKeys=new Set<string>();for(const source of core.sources){ensure(!!source&&typeof source==='object','来源记录无效');ensure(typeof source.sourceKey==='string'&&SOURCE_KEY_RE.test(source.sourceKey),'来源标识无效');ensure(!sourceKeys.has(source.sourceKey),'来源标识重复');sourceKeys.add(source.sourceKey);ensure(['actual','plan'].includes(source.kind)&&['active','cancelled','deleted'].includes(source.status)&&typeof source.manual==='boolean','来源状态无效');if(source.updatedAt)canonicalTimestamp(source.updatedAt);if(source.status==='active'){ensure(typeof source.recordId==='string'&&(source.kind==='actual'?intervalIds:planIds).has(source.recordId),'来源关联记录不存在');}}
  return clone(core);
}

export function validateTimeHistory(snapshot:Pick<TimeSnapshot,'imports'|'corrections'>){
  ensure(Array.isArray(snapshot.imports)&&snapshot.imports.length<=10000,'导入历史无效或过多');ensure(Array.isArray(snapshot.corrections)&&snapshot.corrections.length<=10000,'修正历史无效或过多');
  const ids=new Set<string>();for(const item of snapshot.imports){ensure(!!item&&typeof item==='object'&&typeof item.id==='string'&&ID_RE.test(item.id)&&!ids.has(item.id),'导入历史标识无效或重复');ids.add(item.id);ensure(typeof item.source==='string'&&item.source.length>0&&item.source.length<=200&&['preview','committed','partial','failed'].includes(item.status),'导入历史内容无效');ensure(Number.isSafeInteger(item.itemCount)&&item.itemCount>=0,'导入数量无效');for(const count of [item.accepted,item.skipped])if(count!==undefined)ensure(Number.isSafeInteger(count)&&count>=0&&count<=item.itemCount,'导入结果数量无效');canonicalTimestamp(item.createdAt);}
  ids.clear();for(const item of snapshot.corrections){ensure(!!item&&typeof item==='object'&&typeof item.id==='string'&&ID_RE.test(item.id)&&!ids.has(item.id),'修正标识无效或重复');ids.add(item.id);ensure(typeof item.operationId==='string'&&ID_RE.test(item.operationId)&&typeof item.kind==='string'&&item.kind.length<=80&&typeof item.undone==='boolean','修正历史内容无效');canonicalTimestamp(item.createdAt);validateTimeCoreSnapshot(item.before,{allowFutureActual:true});validateTimeCoreSnapshot(item.after,{allowFutureActual:true});}
}

export function durationMinutes(start:string,end:string):number {
  const value=(timestampMs(end)-timestampMs(start))/60000;
  return Number.isFinite(value)&&value>0?value:0;
}

export function overlaps(a:Pick<TimeInterval,'start'|'end'>,b:Pick<TimeInterval,'start'|'end'>):boolean {
  return timestampMs(a.start)<timestampMs(b.end)&&timestampMs(b.start)<timestampMs(a.end);
}

function clone<T>(value:T):T{return structuredClone(value);}
function stable(value:unknown):string{if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stable).join(',')+']';return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}';}
function newId(prefix:string){return `${prefix}-${crypto.randomUUID()}`;}

function coreWithoutCorrections(snapshot:TimeSnapshot):TimeCoreSnapshot {
  return {categories:clone(snapshot.categories),intervals:clone(snapshot.intervals),plans:clone(snapshot.plans),timer:clone(snapshot.timer),sources:clone(snapshot.sources)};
}

function sourceIndex(snapshot:TimeCoreSnapshot){return new Map(snapshot.sources.map(item=>[item.sourceKey,item]));}
function categoryExists(snapshot:TimeCoreSnapshot,id:string){return snapshot.categories.some(item=>item.id===id&&item.id!=='unrecorded');}
function assertCategory(snapshot:TimeCoreSnapshot,id:string){ensure(categoryExists(snapshot,id),'时间分类不存在或已停用');}
function addSource(snapshot:TimeCoreSnapshot,candidate:TimeSourceRecord){
  const index=snapshot.sources.findIndex(item=>item.sourceKey===candidate.sourceKey);
  if(index<0)snapshot.sources.push(candidate);else snapshot.sources[index]=candidate;
}

function overlapDetails(intervals:TimeInterval[],next:TimeInterval){
  return intervals.filter(item=>item.id!==next.id&&overlaps(item,next)).map(item=>({id:item.id,start:item.start,end:item.end,categoryId:item.categoryId}));
}

/**
 * Replace an interval while keeping every non-overlapping portion of existing
 * records. The caller must explicitly pass replace=true before this function
 * removes or splits another activity.
 */
export function upsertInterval(core:TimeCoreSnapshot,input:unknown,replace=false):{core:TimeCoreSnapshot;overlaps:Array<Record<string,string>>} {
  const next=validateInterval(input);
  assertCategory(core,next.categoryId);
  const conflicts=overlapDetails(core.intervals,next);
  if(conflicts.length&&!replace)throw new TimeValidationError('时间区间重叠，需要确认替换或拆分',409,{code:'TIME_OVERLAP_CONFIRMATION_REQUIRED',overlaps:conflicts});
  let intervals=core.intervals.filter(item=>item.id!==next.id);
  for(const current of intervals){
    if(!overlaps(current,next))continue;
    const start=timestampMs(current.start),end=timestampMs(current.end),ns=timestampMs(next.start),ne=timestampMs(next.end);
    const pieces:TimeInterval[]=[];
    if(start<ns)pieces.push({...current,id:current.id,end:next.start,version:(current.version||1)+1});
    if(ne<end)pieces.push({...current,id:newId('split'),start:next.end,version:(current.version||1)+1});
    intervals=intervals.filter(item=>item.id!==current.id).concat(pieces);
    if(current.sourceKey){
      const source=core.sources.find(item=>item.sourceKey===current.sourceKey);
      if(source){source.recordId=pieces[0]?.id;source.manual=true;if(!pieces.length)source.status='deleted';}
    }
  }
  intervals.push(next);
  intervals.sort((a,b)=>timestampMs(a.start)-timestampMs(b.start)||a.id.localeCompare(b.id));
  return {core:{...core,intervals},overlaps:conflicts};
}

function mergeCore(base:TimeCoreSnapshot,patch:Partial<TimeCoreSnapshot>):TimeCoreSnapshot {
  return {...base,...patch,categories:clone(patch.categories??base.categories),intervals:clone(patch.intervals??base.intervals),plans:clone(patch.plans??base.plans),timer:clone(patch.timer===undefined?base.timer:patch.timer),sources:clone(patch.sources??base.sources)};
}

function correction(before:TimeCoreSnapshot,after:TimeCoreSnapshot,operationId:string,kind:string,createdAt:string):TimeCorrection {
  return {id:crypto.randomUUID(),operationId,kind,before:clone(before),after:clone(after),undone:false,createdAt};
}

function requireLongTimer(start:string,end:string,confirmed:boolean){
  ensure(confirmed||timestampMs(end)-timestampMs(start)<=18*60*60*1000,'计时记录超过 18 小时，请核对后确认',409,{code:'TIME_LONG_RECORD_REVIEW'});
}

function applyImport(core:TimeCoreSnapshot,items:ImportCandidate[],replace:boolean,now:string){
  const accepted:ImportCandidate[]=[];const skipped:ImportCandidate[]=[];const sources=sourceIndex(core);
  for(const candidate of items){
    const item={...candidate,start:canonicalTimestamp(candidate.start),end:canonicalTimestamp(candidate.end)};
    validateInterval({...item,id:newId('candidate'),manual:false},true);
    if(item.categoryId==='unrecorded'||!categoryExists(core,item.categoryId))throw new TimeValidationError('导入分类不存在',400,{item});
    if(item.sourceKey){
      const old=sources.get(item.sourceKey);
      const same=core.intervals.some(v=>v.sourceKey===item.sourceKey)||core.plans.some(v=>v.sourceKey===item.sourceKey);
      if(old?.manual||old?.status==='cancelled'||same){skipped.push(item);continue;}
    }
    if(item.kind==='plan'){
      const plan:TimePlan={...validateInterval({...item,id:newId('plan'),manual:false},true),status:item.status==='cancelled'?'cancelled':'planned',manual:false};
      core.plans.push(plan);
      if(item.sourceKey)addSource(core,{sourceKey:item.sourceKey,kind:'plan',status:plan.status==='cancelled'?'cancelled':'active',manual:false,recordId:plan.id,updatedAt:now});
      accepted.push(item);continue;
    }
    const interval:TimeInterval={...validateInterval({...item,id:newId('import'),manual:false},true),manual:false};
    const changed=upsertInterval(core,interval,replace);core=changed.core;
    if(item.sourceKey)addSource(core,{sourceKey:item.sourceKey,kind:'actual',status:'active',manual:false,recordId:interval.id,updatedAt:now});
    accepted.push(item);
  }
  return {core,accepted,skipped};
}

/** Pure state transition used by the D1 store and by focused domain tests. */
export function applyTimeMutation(snapshot:TimeSnapshot,mutation:TimeMutation,operationId:string,now=new Date()):{snapshot:TimeSnapshot;correction?:TimeCorrection;accepted?:ImportCandidate[];skipped?:ImportCandidate[]} {
  const stamp=now.toISOString();
  const before=coreWithoutCorrections(snapshot);
  let core=clone(before);let resultCorrection:TimeCorrection|undefined;let accepted:ImportCandidate[]|undefined;let skipped:ImportCandidate[]|undefined;
  switch(mutation.type){
    case 'upsert': {
      const existing=core.intervals.find(item=>item.id===mutation.interval.id);
      const nextInput={...mutation.interval,id:mutation.interval.id||crypto.randomUUID(),...(mutation.interval.sourceKey===undefined&&existing?.sourceKey?{sourceKey:existing.sourceKey}:{}),manual:true,version:(existing?.version||0)+1};
      const changed=upsertInterval(core,nextInput,mutation.replace===true);core=changed.core;
      if(nextInput.sourceKey)addSource(core,{sourceKey:nextInput.sourceKey,kind:'actual',status:'active',manual:true,recordId:nextInput.id,updatedAt:stamp});
      resultCorrection=correction(before,core,operationId,'upsert',stamp);break;
    }
    case 'delete': {
      const found=core.intervals.find(item=>item.id===mutation.id);ensure(found,'时间区间不存在',404);
      core.intervals=core.intervals.filter(item=>item.id!==mutation.id);
      if(found.sourceKey)addSource(core,{sourceKey:found.sourceKey,kind:'actual',status:'deleted',manual:true,recordId:found.id,updatedAt:stamp});
      resultCorrection=correction(before,core,operationId,'delete',stamp);break;
    }
    case 'timerStart': {
      ensure(!core.timer,'已有计时正在运行',409,{code:'TIMER_ALREADY_RUNNING'});assertCategory(core,mutation.categoryId);
      core.timer={id:crypto.randomUUID(),start:canonicalTimestamp(mutation.start||stamp),categoryId:mutation.categoryId,...(mutation.note?{note:mutation.note}:{})};break;
    }
    case 'timerStop': {
      ensure(!!core.timer,'没有正在运行的计时',409,{code:'TIMER_NOT_RUNNING'});
      const timer=core.timer!,end=canonicalTimestamp(mutation.end||stamp);requireLongTimer(timer.start,end,mutation.confirmedLong===true);
      const interval={id:timer.id||crypto.randomUUID(),start:timer.start,end,categoryId:timer.categoryId,note:timer.note,manual:true,version:1};
      const changed=upsertInterval(core,interval,mutation.replace===true);core=changed.core;core.timer=null;resultCorrection=correction(before,core,operationId,'timerStop',stamp);break;
    }
    case 'category': {
      const category=validateCategory(mutation.category);const index=core.categories.findIndex(item=>item.id===category.id);
      if(index<0){ensure(category.id!=='unrecorded','未记录只能由系统提供');core.categories.push(category);}else core.categories[index]=category;break;
    }
    case 'upsertPlan': {
      const existing=core.plans.find(item=>item.id===mutation.plan.id);ensure(!existing||existing.status!=='cancelled'||mutation.restoreCancelled===true,'已取消课程需明确恢复后才能重新排课',409);
      ensure(mutation.plan.attendance===undefined,'出勤状态需使用 setAttendance 操作');
      const attendance=mutation.plan.attendance===undefined?existing?.attendance:mutation.plan.attendance;
      const plan=validatePlan({...mutation.plan,id:mutation.plan.id||newId('plan'),status:existing?.status==='cancelled'?'planned':(mutation.plan.status||existing?.status||'planned'),manual:true,version:(existing?.version||0)+1,...(mutation.plan.sourceKey===undefined&&existing?.sourceKey?{sourceKey:existing.sourceKey}: {}),...(attendance===undefined?{}:{attendance})});
      assertCategory(core,plan.categoryId);
      if(attendance!==undefined){
        ensure(plan.categoryId==='class','带出勤标记的计划必须保持课程分类');
        ensure(timestampMs(plan.end)<=now.getTime(),'已有出勤标记的计划不能调整到未来',409,{code:'TIME_ATTENDANCE_FUTURE'});
      }
      if(existing)core.plans=core.plans.map(item=>item.id===plan.id?plan:item);else core.plans.push(plan);
      if(plan.sourceKey)addSource(core,{sourceKey:plan.sourceKey,kind:'plan',status:plan.status==='cancelled'?'cancelled':'active',manual:true,recordId:plan.id,updatedAt:stamp});
      resultCorrection=correction(before,core,operationId,'upsertPlan',stamp);break;
    }
    case 'undo': {
      const activeCorrections=snapshot.corrections.filter(item=>!item.undone).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
      const original=snapshot.corrections.find(item=>item.id===mutation.correctionId);ensure(original,'修正记录不存在',404);ensure(!original.undone,'修正已撤销',409);ensure(activeCorrections.at(-1)?.id===original.id,'只能撤销最近一次修正',409);
      ensure(stable(core)!==''&&stable(core)===stable(original.after),'当前数据已在修正后继续变化，不能直接撤销',409);
      core=clone(original.before);const i=snapshot.corrections.findIndex(item=>item.id===original.id);snapshot.corrections[i]={...original,undone:true};break;
    }
    case 'import': {
      ensure(Array.isArray(mutation.items)&&mutation.items.length<=5000,'导入项目过多');ensure(typeof mutation.source==='string'&&mutation.source.length>0&&mutation.source.length<=200,'导入来源无效');
      let importItems=mutation.items;const protectedItems:ImportCandidate[]=[];
      if(mutation.source==='garmin-cn'){
        const group=(key?:string)=>key?.match(/^garmin:cn:\d{4}-\d{2}-\d{2}:/)?.[0];
        for(const prefix of new Set(importItems.map(x=>group(x.sourceKey)).filter((x):x is string=>Boolean(x)))){
          const incoming=importItems.filter(x=>x.sourceKey?.startsWith(prefix));
          const old=core.sources.filter(x=>x.sourceKey.startsWith(prefix));
          if(old.some(x=>x.manual||x.status!=='active')){
            protectedItems.push(...incoming);importItems=importItems.filter(x=>!x.sourceKey?.startsWith(prefix));continue;
          }
          const unchanged=old.length===incoming.length&&incoming.every(item=>core.intervals.some(row=>row.sourceKey===item.sourceKey&&timestampMs(row.start)===timestampMs(item.start)&&timestampMs(row.end)===timestampMs(item.end)&&Boolean(row.estimated)===Boolean(item.estimated)));
          if(unchanged)continue;
          core.intervals=core.intervals.filter(x=>!x.sourceKey?.startsWith(prefix));
          core.sources=core.sources.filter(x=>!x.sourceKey.startsWith(prefix));
        }
      }
      const imported=applyImport(core,importItems,mutation.replace===true,stamp);core=imported.core;accepted=imported.accepted;skipped=[...protectedItems,...imported.skipped];break;
    }
    case 'confirmPlan': {
      ensure(Array.isArray(mutation.ids)&&mutation.ids.length<=500,'计划数量过多');
      for(const id of mutation.ids){const plan=core.plans.find(item=>item.id===id);ensure(plan,'计划不存在',404);if(plan.status==='cancelled')continue;plan.status='confirmed';
        const source=plan.sourceKey?core.sources.find(item=>item.sourceKey===plan.sourceKey):undefined;const exists=plan.sourceKey?core.intervals.some(item=>item.sourceKey===plan.sourceKey)||(source?.kind==='actual'&&source.status==='active'&&core.intervals.some(item=>item.id===source.recordId)):false;
        if(!exists){const interval:TimeInterval={id:`actual-${plan.id}`,start:plan.start,end:plan.end,categoryId:plan.categoryId,note:plan.note,sourceKey:plan.sourceKey,manual:true,version:1};const changed=upsertInterval(core,interval,mutation.replace===true);core=changed.core;}
        if(plan.sourceKey)addSource(core,{sourceKey:plan.sourceKey,kind:'actual',status:'active',manual:true,recordId:`actual-${plan.id}`,updatedAt:stamp});
      }break;
    }
    case 'setAttendance': {
      ensure(isTimeAttendanceStatus(mutation.status),'出勤状态无效');
      const plan=core.plans.find(item=>item.id===mutation.id);ensure(plan,'计划不存在',404);
      ensure(plan.categoryId==='class','只有课程计划可以标记出勤');
      ensure(plan.status!=='cancelled','已取消课程不能标记出勤');
      ensure(timestampMs(plan.end)<=now.getTime(),'课程尚未结束，不能标记出勤',409,{code:'TIME_ATTENDANCE_FUTURE'});
      plan.attendance=mutation.status;
      resultCorrection=correction(before,core,operationId,'setAttendance',stamp);
      break;
    }
    case 'cancelPlan': {
      const plan=core.plans.find(item=>item.id===mutation.id);ensure(plan,'计划不存在',404);plan.status='cancelled';if(plan.sourceKey)addSource(core,{sourceKey:plan.sourceKey,kind:'plan',status:'cancelled',manual:true,recordId:plan.id,updatedAt:stamp});break;
    }
    case 'restore': {
      core=clone(mutation.snapshot);validateTimeCoreSnapshot(core);break;
    }
    default: throw new TimeValidationError('未知时间操作');
  }
  if(mutation.type==='import'){
    const importCorrection=accepted?.length?correction(before,core,operationId,'import',stamp):undefined;
    validateTimeCoreSnapshot(core,{now});
    return {snapshot:{...snapshot,...core,version:snapshot.version+1},correction:importCorrection,accepted,skipped};
  }
  const changed=!['timerStart','category','undo','cancelPlan','confirmPlan'].includes(mutation.type);
  if(resultCorrection===undefined&&changed)resultCorrection=correction(before,core,operationId,mutation.type,stamp);
  const undoneId=mutation.type==='undo'?mutation.correctionId:undefined;
  validateTimeCoreSnapshot(core,{now});
  return {snapshot:{...snapshot,...core,version:snapshot.version+1,corrections:snapshot.corrections.map(item=>item.id===undoneId?{...item,undone:true}:item)},correction:resultCorrection,accepted,skipped};
}

function parts(ms:number){
  const values=new Intl.DateTimeFormat('en-CA',{timeZone:TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms));
  const out=Object.fromEntries(values.filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));
  return {date:`${out.year}-${out.month}-${out.day}`,hour:Number(out.hour),minute:Number(out.minute)};
}
function localMidnight(date:string){return Date.parse(`${date}T00:00:00+08:00`);}
function addDays(date:string,days:number){const [year,month,day]=date.split('-').map(Number);return new Date(Date.UTC(year,month-1,day+days)).toISOString().slice(0,10);}
function localDate(ms:number){return parts(ms).date;}
function validDate(date:string){return DAY_RE.test(date)&&Number.isFinite(localMidnight(date))&&parts(localMidnight(date)).date===date;}
function firstDayOfWeek(date:string){const [year,month,day]=date.split('-').map(Number);const weekday=new Date(Date.UTC(year,month-1,day)).getUTCDay();return addDays(date,-(weekday===0?6:weekday-1));}

export function periodBounds(period:'day'|'week'|'month'='month',anchor=new Date()):{from:string;to:string} {
  const date=localDate(anchor.getTime());ensure(validDate(date),'日期无效');
  if(period==='day')return {from:new Date(localMidnight(date)).toISOString(),to:new Date(localMidnight(addDays(date,1))).toISOString()};
  if(period==='week'){const from=firstDayOfWeek(date);return {from:new Date(localMidnight(from)).toISOString(),to:new Date(localMidnight(addDays(from,7))).toISOString()};}
  const from=`${date.slice(0,7)}-01`;const nextMonth=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),1));const next=parts(nextMonth.getTime()).date;return {from:new Date(localMidnight(from)).toISOString(),to:new Date(localMidnight(next)).toISOString()};
}

function clip(start:number,end:number,from:number,to:number){return {start:Math.max(start,from),end:Math.min(end,to)};}

export function calculateTimeStats(snapshot:Pick<TimeSnapshot,'categories'|'intervals'>,options:{from?:string;to?:string;period?:'day'|'week'|'month';now?:Date}={}):TimeStats {
  const now=options.now||new Date();const period=options.period||'month';const defaults=periodBounds(period,now);const from=canonicalTimestamp(options.from||defaults.from),to=canonicalTimestamp(options.to||defaults.to);const fromMs=timestampMs(from),toMs=timestampMs(to),pastTo=Math.min(toMs,now.getTime()),elapsedMs=Math.max(0,pastTo-fromMs);
  const durations=new Map<string,number>();const covered:Array<{start:number;end:number;categoryId:string}>=[];
  for(const item of snapshot.intervals){const a=timestampMs(item.start),b=timestampMs(item.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=fromMs||a>=pastTo)continue;const c=clip(a,b,fromMs,pastTo);if(c.end>c.start){const mins=(c.end-c.start)/60000;durations.set(item.categoryId,(durations.get(item.categoryId)||0)+mins);covered.push({start:c.start,end:c.end,categoryId:item.categoryId});}}
  covered.sort((a,b)=>a.start-b.start||a.end-b.end);let coverageMs=0,last=fromMs;for(const item of covered){if(item.start>last)last=item.start;if(item.end>last){coverageMs+=item.end-last;last=item.end;}}
  const recordedMs=Array.from(durations.values()).reduce((a,b)=>a+b,0)*60000;const categoryIds=[...snapshot.categories.map(item=>item.id),...(!snapshot.categories.some(item=>item.id==='unrecorded')?['unrecorded']:[])];const unrecorded=Math.max(0,elapsedMs-coverageMs)/60000;durations.set('unrecorded',unrecorded);
  const categories=categoryIds.map(categoryId=>{const minutes=durations.get(categoryId)||0;return {categoryId,minutes,periodRatio:elapsedMs?minutes/(elapsedMs/60000):0,recordedRatio:recordedMs?minutes/(recordedMs/60000):0};});
  const daily:Array<{date:string;minutes:number;recordedMinutes:number;coverage:number}>=[];for(let ms=localMidnight(localDate(fromMs));ms<toMs;ms+=86400000){const date=parts(ms).date;const dayStart=ms,dayEnd=ms+86400000,day=clip(dayStart,dayEnd,fromMs,pastTo);if(day.end<=day.start)continue;let dayRecorded=0;const daySegments=covered.filter(item=>item.end>day.start&&item.start<day.end);for(const item of daySegments){const c=clip(item.start,item.end,day.start,day.end);dayRecorded+=Math.max(0,c.end-c.start);}daily.push({date,minutes:Math.max(0,day.end-day.start)/60000,recordedMinutes:dayRecorded/60000,coverage:day.end>day.start?Math.min(1,dayRecorded/(day.end-day.start)):0});}
  const slots:Array<{start:string;end:string;parts:Array<{categoryId:string;minutes:number}>}>=[];const first=Math.floor(fromMs/(TIME_SLOT_MS))*TIME_SLOT_MS;for(let start=first;start<pastTo;start+=TIME_SLOT_MS){const end=Math.min(start+TIME_SLOT_MS,pastTo),slotStart=Math.max(start,fromMs);if(end<=fromMs)continue;const partsMap=new Map<string,number>();for(const item of covered){const c=clip(item.start,item.end,Math.max(start,fromMs),Math.min(end,pastTo));if(c.end>c.start)partsMap.set(item.categoryId,(partsMap.get(item.categoryId)||0)+(c.end-c.start)/60000);}const total=Array.from(partsMap.values()).reduce((a,b)=>a+b,0);if(total<(end-slotStart)/60000&&end-slotStart>0)partsMap.set('unrecorded',((end-slotStart)/60000)-total);slots.push({start:new Date(slotStart).toISOString(),end:new Date(end).toISOString(),parts:Array.from(partsMap.entries()).map(([categoryId,minutes])=>({categoryId,minutes}))});}
  return {from,to,elapsedMinutes:elapsedMs/60000,recordedMinutes:recordedMs/60000,unrecordedMinutes:unrecorded,coverage:elapsedMs?Math.min(1,coverageMs/elapsedMs):0,categories,daily,slotMinutes:TIME_SLOT_MINUTES,slots};
}

/** Small rule parser used by the local text-entry preview. It never guesses a date. */
export function parseTimeText(text:string,now=new Date()):{start?:string;end?:string;categoryId?:string;note?:string;errors:string[]} {
  ensure(typeof text==='string'&&text.trim().length>0&&text.length<=500,'时间文本无效');
  const errors:string[]=[];const match=text.match(/(今天|昨日|昨天|昨晚)?\s*(\d{1,2})(?::(\d{2}))?\s*(?:到|至|-|—)\s*(今天|明天|昨日|昨天|昨晚)?\s*(\d{1,2})(?::(\d{2}))?/);
  if(!match){return {errors:['未识别出明确的开始和结束时间']};}
  const today=localDate(now.getTime());const dateFor=(prefix:string|undefined,defaultDate:string)=>{if(prefix==='今天')return today;if(prefix==='明天')return addDays(today,1);if(prefix==='昨天'||prefix==='昨日'||prefix==='昨晚')return addDays(today,-1);return defaultDate;};
  const startDate=dateFor(match[1],today),endDate=dateFor(match[4],startDate);const hour1=Number(match[2]),min1=Number(match[3]||'00'),hour2=Number(match[5]),min2=Number(match[6]||'00');
  if(hour1>23||hour2>23||min1>59||min2>59)errors.push('时间点超出范围');
  const start=`${startDate}T${String(hour1).padStart(2,'0')}:${String(min1).padStart(2,'0')}+08:00`,end=`${endDate}T${String(hour2).padStart(2,'0')}:${String(min2).padStart(2,'0')}+08:00`;
  if(Date.parse(end)<=Date.parse(start))errors.push('结束时间不晚于开始时间');
  const remainder=text.slice((match.index||0)+match[0].length).trim();const category=CATEGORY_KEYWORDS.find(([pattern])=>pattern.test(remainder));
  if(!category)errors.push('未识别活动分类，请手动选择');
  return {start:canonicalTimestamp(start),end:canonicalTimestamp(end),...(category?{categoryId:category[1]}:{}),...(remainder?{note:remainder}:{}),errors};
}
