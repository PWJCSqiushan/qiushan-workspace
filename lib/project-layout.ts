import {doneToday,rowSort,today} from './domain.ts';
import type {Task} from './domain.ts';

/** A task is available on the current flow board when it is neither deleted nor
 * permanently ended. Daily items completed today stay visible as a separate
 * completed-today row and reappear as unfinished on the next Beijing day. */
export function isUnfinished(task:Task,_now=new Date()):boolean{
 return !task.deletedAt&&task.status!=='已结束';
}

export type ProjectRelationState='cross-flow'|'deleted'|'ended'|'unavailable';

export type IndependentLayoutUnit={
 kind:'independent';
 task:Task;
 anchor:Task;
 /** The related project is context only when the child cannot be grouped here. */
 project?:Task;
 relationState?:ProjectRelationState;
};

export type ProjectLayoutUnit={
 kind:'group';
 project:Task;
 /** Active, same-flow children selected by visibleTasks. */
 children:Task[];
 /** Completed children are kept for a collapsed count in the UI. */
 completedChildren:Task[];
 completedTodayChildren:Task[];
 endedChildren:Task[];
 /** Active children in another flow are references, never duplicate cards. */
 crossFlowChildren:Task[];
 /** True when the unit was included because a visible child matched a filter. */
 contextOnly:boolean;
 anchor:Task;
};

export type FlowLayoutUnit=IndependentLayoutUnit|ProjectLayoutUnit;

function activeProject(task:Task,flow:string,now:Date):boolean{
 return task.kind==='project'&&task.flow===flow&&isUnfinished(task,now);
}

function byRowSort(tasks:readonly Task[]):Task[]{
 return [...tasks].sort(rowSort);
}

function relationState(project:Task|undefined,flow:string):ProjectRelationState|undefined{
 if(!project)return 'unavailable';
 if(project.flow!==flow)return 'cross-flow';
 if(project.deletedAt)return 'deleted';
 if(project.status==='已结束')return 'ended';
 return 'unavailable';
}

/**
 * Build the one-level project layout for a single flow.
 *
 * `allTasks` supplies parents, completed children, and cross-flow references;
 * `visibleTasks` supplies the items currently selected by search/filter. Both
 * arrays may be the same array. No task is copied into a second flow unit.
 */
export function buildFlowLayout(
 allTasks:readonly Task[],
 visibleTasks:readonly Task[],
 flow:string,
 now=new Date(),
):FlowLayoutUnit[]{
 const allById=new Map<string,Task>();
 for(const task of allTasks)allById.set(task.id,task);
 // Be tolerant of a caller passing a filtered projection containing a newer
 // object. The canonical allTasks item still wins when IDs overlap.
 for(const task of visibleTasks)if(!allById.has(task.id))allById.set(task.id,task);

 const visibleIds=new Set<string>();
 const candidates=visibleTasks.filter(task=>task.flow===flow&&isUnfinished(task,now));
 for(const task of candidates)visibleIds.add(task.id);
 const groups=new Map<string,ProjectLayoutUnit>();
 const units:FlowLayoutUnit[]=[];

 const ensureGroup=(project:Task):ProjectLayoutUnit=>{
  const existing=groups.get(project.id);
  if(existing)return existing;
  const completed=byRowSort(allTasks.filter(task=>task.projectId===project.id&&task.flow===flow&&!task.deletedAt&&
   (task.status==='已结束'||doneToday(task,today(now)))));
  const completedTodayChildren=completed.filter(task=>task.status!=='已结束'&&doneToday(task,today(now)));
  const endedChildren=completed.filter(task=>task.status==='已结束');
  const crossFlowChildren=byRowSort(allTasks.filter(task=>task.projectId===project.id&&task.flow!==flow&&isUnfinished(task,now)));
   const unit:ProjectLayoutUnit={
    kind:'group',project,children:[],completedChildren:completed,completedTodayChildren,endedChildren,
   crossFlowChildren,contextOnly:!visibleIds.has(project.id),anchor:project,
  };
  groups.set(project.id,unit);units.push(unit);return unit;
 };

 for(const task of candidates){
  if(task.kind==='project'){
   ensureGroup(task);
   continue;
  }
  const parent=task.projectId?allById.get(task.projectId):undefined;
  if(parent&&activeProject(parent,flow,now)){
   const group=ensureGroup(parent);
   const completedToday=doneToday(task,today(now));
   const destination=completedToday?group.completedTodayChildren:group.children;
   if(!destination.some(child=>child.id===task.id))destination.push(task);
   continue;
  }
  const independent:IndependentLayoutUnit={kind:'independent',task,anchor:task};
  if(task.projectId){independent.project=parent;independent.relationState=relationState(parent,flow);}
  units.push(independent);
 }

 for(const unit of groups.values()){
  unit.children=byRowSort(unit.children);
  unit.completedChildren=byRowSort(unit.completedChildren);
  unit.completedTodayChildren=byRowSort(unit.completedTodayChildren);
  unit.endedChildren=byRowSort(unit.endedChildren);
  unit.crossFlowChildren=byRowSort(unit.crossFlowChildren);
  // Completed-today children do not move the active project container's
  // anchor; the project and visible unfinished children define its position.
  const anchors=[unit.project,...unit.children];
  unit.anchor=anchors.reduce((best,task)=>rowSort(task,best)<0?task:best);
 }
 return units.sort((a,b)=>rowSort(a.anchor,b.anchor)||a.anchor.id.localeCompare(b.anchor.id));
}
