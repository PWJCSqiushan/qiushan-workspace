import {gradeRank,type QueueReturn,type Task} from './domain.ts';

/** The small operation shape is intentionally open: protocol versions can add
 * operation metadata without making the queue functions depend on storage. */
export type CoordinationOperation={kind:string;[key:string]:unknown};

type ReturnKind='complete'|'deleted';
type Numbered={task:Task;index:number;order:number};

const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
const nonNegative=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const active=(task:Task)=>!task.deletedAt&&task.status!=='已结束';

function clone<T>(value:T):T{return structuredClone(value);}

function removeQueueReturn(task:Task):Task{
 const {queueReturn:_queueReturn,...rest}=task;
 return rest;
}

function compactQueueReturn(task:Task,source?:QueueReturn):Task{
 const queueReturn:QueueReturn={};
 if(source?.complete!==undefined&&positive(source.complete))queueReturn.complete=source.complete;
 if(source?.deleted!==undefined&&positive(source.deleted))queueReturn.deleted=source.deleted;
 return Object.keys(queueReturn).length?{...task,queueReturn}:removeQueueReturn(task);
}

function setQueueReturn(task:Task,kind:ReturnKind,order:number):Task{
 const source={...task.queueReturn,[kind]:order};
 return compactQueueReturn({...task,coordOrder:null},source);
}

function clearQueueReturn(task:Task,kind?:ReturnKind):Task{
 if(!task.queueReturn)return task;
 const source={...task.queueReturn};
 if(kind)delete source[kind];
 else return removeQueueReturn(task);
 return compactQueueReturn(task,source);
}

function queueCompare(a:Numbered,b:Numbered){
 return a.order-b.order||gradeRank(a.task.coordLetter)-gradeRank(b.task.coordLetter)||
  gradeRank(a.task.priority)-gradeRank(b.task.priority)||a.task.createdAt.localeCompare(b.task.createdAt)||a.task.id.localeCompare(b.task.id);
}

/**
 * Bootstrap or repair the positive coordination queue. Only tasks that are
 * active and already have a positive number are assigned a number; unnumbered
 * and zero-numbered tasks remain exactly where they are.
 */
export function normalizeQueue(tasks:Task[]):Task[]{
 const out=clone(tasks);
 const numbered:Numbered[]=[];
 for(let index=0;index<out.length;index++){
  const task=out[index];
  if(!positive(task.coordOrder))continue;
  if(!active(task)){
   let released:Task={...task,coordOrder:null};
   const source={...task.queueReturn};
   if(task.status==='已结束')source.complete=task.coordOrder;
   if(task.deletedAt)source.deleted=task.coordOrder;
   released=compactQueueReturn(released,source);
   out[index]=released;
   continue;
  }
  numbered.push({task,index,order:task.coordOrder});
 }
 numbered.sort(queueCompare);
 numbered.forEach((item,index)=>{out[item.index]={...out[item.index],coordOrder:index+1};});
 return out;
}

function hasOwn(value:unknown,key:string):boolean{
 return !!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);
}

function patchObject(operation:CoordinationOperation):Record<string,unknown>|null{
 const patch=operation.patch;
 return patch&&typeof patch==='object'&&!Array.isArray(patch)?patch as Record<string,unknown>:null;
}

function explicitCoordinationChange(operation:CoordinationOperation,before:Task|null,next:Task):boolean{
 const patch=patchObject(operation);
 const explicit=operation.kind==='create'||
  (operation.kind==='patch'&&!!patch&&hasOwn(patch,'coordOrder'))||
  operation.kind==='setCoordOrder'||operation.kind==='setCoord' || hasOwn(operation,'coordOrder');
 return explicit&&(!before||next.coordOrder!==before.coordOrder);
}

function clampOrder(value:number,queueLength:number){return Math.min(Math.max(value,1),queueLength+1);}

function shiftAfterRemoval(tasks:Task[],order:number){
 for(let i=0;i<tasks.length;i++){
  const task=tasks[i];
  if(active(task)&&positive(task.coordOrder)&&task.coordOrder>order)tasks[i]={...task,coordOrder:task.coordOrder-1};
 }
}

function shiftForInsertion(tasks:Task[],order:number){
 for(let i=0;i<tasks.length;i++){
  const task=tasks[i];
  if(active(task)&&positive(task.coordOrder)&&task.coordOrder>=order)tasks[i]={...task,coordOrder:task.coordOrder+1};
 }
}

function countPositive(tasks:readonly Task[]){return tasks.reduce((count,task)=>count+(active(task)&&positive(task.coordOrder)?1:0),0);}

function eventDate(operation:CoordinationOperation,date:string){return typeof operation.date==='string'&&operation.date?operation.date:date;}

function dailyTransition(before:Task|null,next:Task,operation:CoordinationOperation,date:string){
 const target=eventDate(operation,date);
 const was=!!before?.daily&&before.completions.includes(target);
 const is=next.daily&&next.completions.includes(target);
 return {added:!was&&is,removed:was&&!is};
}

function completionRelease(before:Task|null,next:Task,operation:CoordinationOperation,date:string){
 const daily=dailyTransition(before,next,operation,date);
 const ended=next.status==='已结束'&&before?.status!=='已结束';
 return {release:daily.added||ended,undo:daily.removed||(!next.deletedAt&&next.status!=='已结束'&&before?.status==='已结束')};
}

function operationIsDeletion(operation:CoordinationOperation){return operation.kind==='delete'||operation.kind==='setDeleted';}

function operationIsRestore(operation:CoordinationOperation){return operation.kind==='restore'||(operation.kind==='setDeleted'&&operation.value===false);}

function insertAt(tasks:Task[],index:number,task:Task){
 const safe=Math.max(0,Math.min(index,tasks.length));
 tasks.splice(safe,0,task);
}

function savedOrder(task:Task|undefined,kind:ReturnKind):number|undefined{
 const value=task?.queueReturn?.[kind];
 return positive(value)?value:undefined;
}

/**
 * Apply the queue side of a task mutation. The caller owns versions and
 * revisions; this function only returns a new, fully ordered task array.
 */
export function coordinateMutation(tasks:Task[],old:Task|null,next:Task,operation:CoordinationOperation,date:string):Task[]{
 const bootstrapped=normalizeQueue(tasks);
 const currentIndex=bootstrapped.findIndex(task=>task.id===next.id);
 const current=currentIndex>=0?bootstrapped[currentIndex]:old?clone(old):null;
 const before=old?clone(old):current?clone(current):null;
 let nextTask=clone(next);
 // Protocol patchers normally carry optional fields forward. Merging a
 // missing return marker from the canonical task also makes this helper safe
 // for callers that build a partial next object themselves.
 if(!nextTask.queueReturn&&current?.queueReturn)nextTask={...nextTask,queueReturn:clone(current.queueReturn)};

 const remaining=bootstrapped.filter(task=>task.id!==nextTask.id);
 const stableIndex=currentIndex<0?remaining.length:Math.min(currentIndex,remaining.length);
 const beforeOrder=positive(before?.coordOrder)?before!.coordOrder:null;
 const currentOrder=positive(current?.coordOrder)?current!.coordOrder:null;
 const explicitOrder=explicitCoordinationChange(operation,before,nextTask);
 const changedOrder=before&&nextTask.coordOrder!==before.coordOrder;
 const daily=completionRelease(before,nextTask,operation,date);
 const deleteTransition=!!nextTask.deletedAt&&!before?.deletedAt;
 const restoreTransition=!!before?.deletedAt&&!nextTask.deletedAt;
 const completionTransition=daily.release;
 const deletionOperation=operationIsDeletion(operation);
 const restoreOperation=operationIsRestore(operation);

 // A queue number can only be removed once. A normalized baseline has
 // already released legacy ended/deleted positive numbers, so only the
 // current active positive number needs a shift here.
 let working=remaining;
 let removedOrder: number|null=null;
 const shouldReleaseForCompletion=completionTransition;
 const shouldReleaseForDeletion=deleteTransition||
  (deletionOperation&&!before?.deletedAt&&currentOrder!==null);
 const shouldClearManual=explicitOrder&&changedOrder;
 const targetPositive=positive(nextTask.coordOrder);
 const requestedOrder=targetPositive?nextTask.coordOrder:null;
 const currentNeedsRemoval=currentOrder!==null&&(
  shouldReleaseForCompletion||shouldReleaseForDeletion||
  (shouldClearManual&&nextTask.coordOrder!==current!.coordOrder));

 if(currentNeedsRemoval){
  removedOrder=currentOrder;
  shiftAfterRemoval(working,currentOrder);
 }

 // If an old, invalid snapshot carried a positive number into a completion or
 // deletion mutation, normalizeQueue already collapsed its neighbours. Keep
 // the recovery marker without shifting the queue twice.
 const legacyReleasedOrder=currentOrder===null&&beforeOrder!==null&&
  (!!before?.deletedAt||before?.status==='已结束');
 if(shouldReleaseForCompletion||shouldReleaseForDeletion||legacyReleasedOrder){
  const order=removedOrder??beforeOrder;
  if(order!==null){
   const complete=shouldReleaseForCompletion||(!shouldReleaseForDeletion&&before?.status==='已结束');
   const deleted=shouldReleaseForDeletion||deleteTransition;
   nextTask={...nextTask,coordOrder:null};
   if(complete)nextTask=setQueueReturn(nextTask,'complete',order);
   if(deleted)nextTask=setQueueReturn(nextTask,'deleted',order);
  } else if(!active(nextTask)&&positive(nextTask.coordOrder)){
   nextTask={...nextTask,coordOrder:null};
  }
 }

 // Explicit coordination edits are manual insertion operations. Releasing a
 // previous positive number first makes moving 3 to 1 behave like remove-then-
 // insert and keeps the queue contiguous.
 if(shouldClearManual){
  if(!targetPositive){
   nextTask=clearQueueReturn({...nextTask,coordOrder:nonNegative(nextTask.coordOrder)?nextTask.coordOrder:null});
  } else {
   nextTask=clearQueueReturn({...nextTask,coordOrder:null});
  }
 }

 const releaseHappened=currentNeedsRemoval||legacyReleasedOrder;
 const manualInsertion=shouldClearManual&&targetPositive&&!shouldReleaseForCompletion&&!shouldReleaseForDeletion;
 if(manualInsertion){
  const target=clampOrder(requestedOrder??1,countPositive(working));
  shiftForInsertion(working,target);
  nextTask={...nextTask,coordOrder:target};
 }

 // A create can carry a positive initial number even though there is no old
 // task to remove. It is inserted into the shared queue with tail clamping.
 if(!before&&operation.kind==='create'&&active(nextTask)&&targetPositive){
  const target=clampOrder(nextTask.coordOrder!,countPositive(working));
  shiftForInsertion(working,target);
  nextTask=clearQueueReturn({...nextTask,coordOrder:target});
 }

 const completionUndo=daily.undo||restoreTransition&&!nextTask.deletedAt&&!nextTask.status.includes('已结束');
 const deletionUndo=restoreTransition||restoreOperation&&!!before?.deletedAt&&!nextTask.deletedAt;
 const explicitTarget=explicitOrder&&targetPositive&&!shouldReleaseForCompletion&&!shouldReleaseForDeletion;
 if(!manualInsertion&&!explicitTarget&&!releaseHappened&&active(nextTask)&&nextTask.coordOrder===null){
  const kind:ReturnKind=restoreOperation||deletionUndo?'deleted':'complete';
  const saved=savedOrder(nextTask,kind)??savedOrder(current??undefined,kind)??savedOrder(before??undefined,kind);
  if(saved!==undefined&&(completionUndo||deletionUndo)){
   const target=clampOrder(saved,countPositive(working));
   shiftForInsertion(working,target);
   nextTask={...nextTask,coordOrder:target};
   nextTask=clearQueueReturn(nextTask,kind);
  }
 }

 // Normal non-queue patches retain the task's positive position. A completed
 // or deleted task can never leave a live positive number behind.
 if(!active(nextTask)&&positive(nextTask.coordOrder)){
  const order=nextTask.coordOrder;
  nextTask={...nextTask,coordOrder:null};
  if(nextTask.status==='已结束')nextTask=setQueueReturn(nextTask,'complete',order);
  if(nextTask.deletedAt)nextTask=setQueueReturn(nextTask,'deleted',order);
 }

 insertAt(working,stableIndex,nextTask);
 // This final repair is intentionally limited to the queue invariant: it does
 // not assign numbers to unnumbered/zero tasks and only changes active
 // positive positions if a malformed caller snapshot made that necessary.
 return normalizeQueue(working);
}
