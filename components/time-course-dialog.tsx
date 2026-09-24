'use client';
import {useEffect,useRef,useState} from 'react';
import {shanghaiDate,localClock,type TimePlan,type TimeInterval,type TimeMutation} from '../lib/time-client';
import './time-course-dialog.css';
type CoursePlan=TimePlan&{courseName?:string;courseGroupKey?:string;location?:string;deliveryMode?:'in_person'|'online';lateMinutes?:number};
type CourseRow=TimeInterval&{courseGroupKey?:string};
type Props={plans:TimePlan[];rows:TimeInterval[];now:number;onClose:()=>void;submit:(mutation:TimeMutation)=>Promise<{state:'synced'|'queued';message:string}>};
const labels={on_time:'正常',late_under_5:'迟到 ≤5分钟',late_over_5:'迟到 >5分钟',absent:'翘课',excused:'请假'};
function merged(ranges:number[][]){const result:number[][]=[];for(const range of ranges.sort((a,b)=>a[0]-b[0])){const last=result.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else result.push([...range]);}return result;}
function courseMinutes(p:CoursePlan,rows:CourseRow[],now:number){
 const start=Date.parse(p.start),end=Math.min(Date.parse(p.end),now);
 const clip=(r:CourseRow)=>[Math.max(start,Date.parse(r.start)),Math.min(end,Date.parse(r.end))];
 const linked=(r:CourseRow)=>(!!p.courseGroupKey&&r.courseGroupKey===p.courseGroupKey)||r.id===`actual-${p.id}`||!!p.originalPlanIds?.some(id=>r.id===`actual-${id}`)||!!(p.sourceKey&&r.sourceKey===p.sourceKey);
 const manual=merged(rows.filter(r=>r.manual&&!linked(r)).map(clip).filter(([a,b])=>b>a));
 const actual=merged(rows.filter(r=>r.categoryId==='class'&&linked(r)).map(clip).filter(([a,b])=>b>a));
 let actualMs=0;for(const [a,b] of actual){actualMs+=b-a;for(const [c,d] of manual)actualMs-=Math.max(0,Math.min(b,d)-Math.max(a,c));}
 return {actual:Math.round(actualMs/60000),manual:Math.round(manual.reduce((sum,[a,b])=>sum+b-a,0)/60000)};
}
function CourseCard({p,rows,now,busy,expanded,toggle,save}:{p:CoursePlan;rows:TimeInterval[];now:number;busy:boolean;expanded:boolean;toggle:()=>void;save:(m:TimeMutation)=>Promise<boolean>}){
 const future=Date.parse(p.end)>now,cancelled=p.status==='cancelled',online=p.deliveryMode==='online';
 const initial=p.attendance?.startsWith('late')?'late':p.attendance||'on_time';
 const [choice,setChoice]=useState(initial),[minutes,setMinutes]=useState(p.lateMinutes===undefined?'':String(p.lateMinutes)),[error,setError]=useState('');
 const detailId='course-detail-'+p.id,title=p.courseName||p.note||'课程',times=courseMinutes(p,rows,now);
 return <article className={'course-card'+(future?' is-future':'')} data-state={cancelled?'cancelled':online?'online':p.attendance||'on_time'}>
 <button className="course-card-heading" onClick={toggle} aria-expanded={expanded} aria-controls={detailId}><span><strong>{title}</strong><small><time>{localClock(p.start)}—{localClock(p.end)}</time>{p.location&&<span> · {p.location}</span>}</small></span><span className="course-state">{cancelled?'已取消':online?'线上':future?(p.attendance==='excused'?'计划 · 请假':'计划'):labels[p.attendance||'on_time']}{!cancelled&&!online&&p.lateMinutes!==undefined&&p.lateMinutes>0?` · ${p.lateMinutes} 分钟`:''}</span></button>
 {expanded&&<div id={detailId} className="course-detail"><p className="course-duration">实际课堂 {times.actual} 分钟 · 手动活动覆盖 {times.manual} 分钟</p><form className="course-controls" onSubmit={async e=>{e.preventDefault();setError('');if(choice==='late'&&(!/^\d+$/.test(minutes)||Number(minutes)<1||Number(minutes)>1440)){setError('请填写 1—1440 的整数迟到分钟。');return;}const mutation:TimeMutation=choice==='late'?{type:'setCourseState',id:p.id,lateMinutes:Number(minutes)}:{type:'setCourseState',id:p.id,status:choice};await save(mutation);}}>
 <label>出勤<select aria-label={`${title}出勤`} value={choice} disabled={busy||cancelled||online} onChange={e=>{setChoice(e.target.value);setError('');}}><option value="on_time" disabled={future}>正常</option><option value="late" disabled={future}>迟到</option><option value="absent" disabled={future}>翘课</option><option value="excused">请假</option></select></label>
 {choice==='late'&&<label>迟到分钟<input aria-label={`${title}迟到分钟`} type="number" min="1" max="1440" step="1" value={minutes} onChange={e=>setMinutes(e.target.value)} placeholder="填写准确分钟" disabled={busy||future||cancelled||online}/></label>}
 <button disabled={busy||cancelled||online||(future&&choice!=='excused')} type="submit">保存出勤</button></form>
 {choice==='late'&&p.attendance?.startsWith('late')&&p.lateMinutes===undefined&&<p className="course-duration">旧记录未填写分钟，补填保存后更新。</p>}{error&&<p role="alert">{error}</p>}
 <div className="course-actions"><button disabled={busy||cancelled} aria-pressed={online} onClick={()=>void save({type:'setCourseState',id:p.id,deliveryMode:online?'in_person':'online'})}>{online?'恢复线下':'改为线上'}</button><button disabled={busy} onClick={()=>void save({type:'setCourseState',id:p.id,cancelled:!cancelled})}>{cancelled?'恢复课程':'取消课程'}</button></div></div>}
 </article>;
}
export function TimeCourseDialog({plans,rows,now,onClose,submit}:Props){
 const [date,setDate]=useState(()=>shanghaiDate(now)),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[expanded,setExpanded]=useState<string|null>(null);
 const ref=useRef<HTMLDialogElement>(null),lock=useRef(false);
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null;ref.current?.showModal();return()=>{ref.current?.close();prior?.focus();};},[]);
 const daily=(plans as CoursePlan[]).filter(p=>p.categoryId==='class'&&shanghaiDate(Date.parse(p.start))===date).sort((a,b)=>a.start.localeCompare(b.start));
 const hidden=daily.filter(p=>p.status==='cancelled'||p.deliveryMode==='online'),active=daily.filter(p=>!hidden.includes(p));
 const changeDate=(value:string)=>{setDate(value);setExpanded(null);},shift=(n:number)=>changeDate(shanghaiDate(Date.parse(date+'T12:00:00+08:00')+n*86400000));
 async function save(m:TimeMutation){if(lock.current)return false;lock.current=true;setBusy(true);setNotice('正在保存…');try{const result=await submit(m);setNotice(result.message||(result.state==='queued'?'已加入同步队列。':'已保存'));return true;}catch(error){setNotice(error instanceof Error?error.message:'保存失败，请重试。');return false;}finally{lock.current=false;setBusy(false);}}
 const card=(p:CoursePlan)=><CourseCard key={p.id} p={p} rows={rows} now={now} busy={busy} expanded={expanded===p.id} toggle={()=>setExpanded(expanded===p.id?null:p.id)} save={save}/>;
 return <dialog ref={ref} className="course-dialog" aria-labelledby="course-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}>
 <header><div><h2 id="course-title">一天课表</h2><p>课程与出勤</p></div><button aria-label="关闭一天课表" onClick={onClose}>关闭</button></header><nav aria-label="课表日期"><button aria-label="前一天" onClick={()=>shift(-1)}>←</button><input type="date" aria-label="选择课表日期" value={date} onChange={e=>{if(e.target.value)changeDate(e.target.value);}}/><button aria-label="后一天" onClick={()=>shift(1)}>→</button><button onClick={()=>changeDate(shanghaiDate(now))}>今天</button><span>{daily.length} 门课</span></nav>
 <div className="course-list">{active.map(card)}{!active.length&&<p className="course-empty">这一天没有线下课程</p>}{hidden.length>0&&<details className="course-hidden"><summary>取消 / 线上 · {hidden.length}</summary>{hidden.map(card)}</details>}</div><footer role="status">{notice||'已结束课程默认正常；未来课程可预设请假、线上或取消。'}</footer></dialog>;
}
