"use client";
import {Check,Plus} from 'lucide-react';
import {TaskCard} from '@/components/task-card';
import {FLOWS,type Task,doneToday,today,rowSort} from '@/lib/domain';

type Props={visible:Task[];flow:string;now:Date;filtering:boolean;busy:boolean;ready:boolean;onOpen:(task:Task)=>void;onFlag:(task:Task)=>void;onComplete:(task:Task)=>void;onCreate:(flow:string)=>void};
export function FlowLane({visible,flow,now,filtering,busy,ready,onOpen,onFlag,onComplete,onCreate}:Props){
 const items=visible.filter(t=>t.flow===flow).sort(rowSort);
 const urgent=items.filter(t=>t.emergency&&!doneToday(t,today(now)));
 const queue=items.filter(t=>!urgent.includes(t));
 const label=FLOWS.find(f=>f.id===flow)?.name||'';
 const card=(task:Task)=><TaskCard key={task.id} task={task} now={now} onOpen={onOpen} onFlag={()=>{if(!busy)onFlag(task);}} onComplete={!task.deletedAt&&task.status!=='已结束'?()=>{if(!busy)onComplete(task);}:undefined}/>;
 return <>
  <div className="em-cell" aria-label={label+'紧急事项'}>{urgent.length?urgent.map(card):<div className="empty-em">暂无紧急事项</div>}</div>
  <div className="lane" aria-label={label+'事项'}>
   {queue.map(card)}
   <button className="add-card" title={'新增'+label+'事项'} aria-label={'新增'+label+'事项'} disabled={busy} onClick={()=>onCreate(flow)}><Plus/></button>
   {!items.length&&<span className="lane-empty">{!ready?'正在读取事项…':filtering?'本流暂无符合条件的事项':<><Check/>本流净空</>}</span>}
  </div>
 </>;
}
