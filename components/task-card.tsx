"use client";

import {Check,CheckCircle2,ChevronUp,Clock3,Flag,Repeat2} from 'lucide-react';
import {doneToday,today,type Task} from '@/lib/domain';
import {cardTone,coordinationParts,duePresentation,formatTaskDate,isCompleted,priorityLabel} from '@/lib/card-presentation';

export type TaskCardProps = {
  task:Task; onOpen:(task:Task)=>void; onFlag?:(task:Task)=>void;
  onComplete?:(task:Task)=>void; showFlow?:boolean; now?:Date; className?:string;
};

const gradeTone=(value:string)=>/^S[+-]?$/.test(value)?' grade-s':value==='A+'?' grade-aplus':'';

// A single fixed-size surface for every item; optional historical relations stay in storage.
export function TaskCard({task,onOpen,onFlag,onComplete,now,className}:TaskCardProps){
 const clock=now??new Date();
 const tone=cardTone(task,clock);
 const completed=isCompleted(task,clock);
 const completedToday=doneToday(task,today(clock));
 const ended=task.status==='已结束';
 const due=duePresentation(task,clock);
 const priority=priorityLabel(task.priority);
 const coordination=coordinationParts(task.coordLetter,task.coordOrder);
 const status=ended?'已结束':completedToday?'今日已完成':task.status||'准备推进';
 const statusDetail=[task.stage&&'阶段：'+task.stage,'状态：'+status].filter(Boolean).join(' · ');
 const completionLabel=task.daily?(completedToday?'撤销今日完成':'今日完成'):'标记完成';
 const canComplete=Boolean(onComplete)&&!ended&&task.status!=='暂停';
 const shortDate=(value:string)=>formatTaskDate(value).replace('（当日结束）','').replace(/(\d+)月(\d+)日/,'$1/$2');
 const dueText=due?(due.state==='overdue'?'已逾期 '+shortDate(task.due):due.state==='today'||due.state==='soon'?due.label+' · '+due.detail:shortDate(task.due)+' 截止'):'';
 const timeText=dueText||(task.daily?'每日例行':task.start?shortDate(task.start):task.end?shortDate(task.end):'时间待定');
 const timeDetail=due?[due.label+'：'+due.detail,task.start&&'开始：'+formatTaskDate(task.start),task.end&&'结束：'+formatTaskDate(task.end),task.location].filter(Boolean).join(' · '):[timeText,task.location].filter(Boolean).join(' · ');
 return <article className={['task redesign-task-card','task--tone-'+tone,task.flagged?'flagged':'',completed?'done':'',className||''].filter(Boolean).join(' ')} data-task-id={task.id} data-card-tone={tone} data-priority={priority} data-coord-letter={task.coordLetter||'未定'} data-due-state={due?.state??'none'}>
  <button type="button" className="card-open" onClick={()=>onOpen(task)} aria-label={'编辑事项：'+task.title}>
   <h3 className="task-title" title={task.title}>{task.title||'未命名事项'}</h3>
   <div className={'task-time-hint'+(due?' due-'+due.state:'')} title={timeDetail} aria-label={timeDetail}><Clock3 aria-hidden="true"/><span>{timeText}</span></div>
   <div className={'task-priority-grid'+(Math.max(priority.length,coordination.label.length)>4?' grades-long':'')} aria-label="双优先级">
    <div className={'priority-block'+(gradeTone(task.priority)?' priority-strong':'')} title={'本流优先级 '+priority}><span className="priority-label">本流</span><strong className={'priority-value'+(priority==='未定'?' priority-unset':'')}><span className={'grade-letter'+gradeTone(task.priority)}>{priority}</span></strong></div>
    <div className={'priority-block priority-coordination'+(gradeTone(task.coordLetter)?' priority-strong':'')} title={'协调优先级 '+coordination.label}><span className="priority-label">协调</span><strong className={'priority-value coord-value'+(coordination.letter==='未定'?' priority-unset':'')+(coordination.order.length>3?' coord-long':'')} aria-label={'协调优先级 '+coordination.label}><span className={'grade-letter'+gradeTone(coordination.letter)}>{coordination.letter}</span>{coordination.order!==''&&<span className="coord-order">{coordination.order}</span>}</strong></div>
   </div>
  </button>
  {onFlag?<button type="button" className="flag-button" aria-pressed={task.flagged} aria-label={(task.flagged?'取消旗标':'添加旗标')+' '+task.title} onClick={()=>onFlag(task)}><Flag className={task.flagged?'flag-icon':'unflag'} fill={task.flagged?'currentColor':'none'}/></button>:task.flagged?<Flag className="flag-icon flag-static" aria-label="已添加旗标"/>:null}
  <div className="task-footer">
   <span className={'task-status'+(task.status==='正在推进'&&!completed?' status-active':'')} title={statusDetail}>{completed?<CheckCircle2 aria-hidden="true"/>:<i className="status-dot" aria-hidden="true"/>}<span>{status}</span></span>
   <span className="task-signals" aria-label={[task.emergency&&'紧急 EM',task.daily&&'每日例行',task.boostDate===today(clock)&&'本次先做'].filter(Boolean).join('、')}>
    {task.emergency&&<span className="signal-em" title="紧急 EM">EM</span>}
    {task.daily&&<Repeat2 aria-label="每日例行"/>}
    {task.boostDate===today(clock)&&<ChevronUp aria-label="本次先做"/>}
   </span>
  </div>
  {canComplete&&<button type="button" className="task-complete" title={completionLabel} aria-label={completionLabel+'：'+task.title} onClick={()=>onComplete?.(task)}><Check aria-hidden="true"/></button>}
 </article>;
}
