'use client';
import {useEffect,useId,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent} from 'react';
import {clampTimeWindow,centerTimeWindow,dayNumber,dayString,moveTimeWindow,resizeTimeWindow,timeDomainBounds,zoomTimeWindow} from '../lib/time-window';
import type {TimeDomain,TimeWindow} from '../lib/time-window';
import './time-navigator.css';

type Props={value:TimeWindow;domain:TimeDomain;onChange:(next:TimeWindow)=>void;onReset?:()=>void};
type Edge='start'|'end'|'pan';
export function TimeNavigator({value,domain,onChange,onReset}:Props) {
 const current=clampTimeWindow(value,domain),bounds=timeDomainBounds(domain),total=bounds.end-bounds.start+1;
 const start=dayNumber(current.start),end=start+current.days-1,id=useId();
 const rail=useRef<HTMLDivElement>(null),frame=useRef<number|null>(null),pending=useRef<TimeWindow|null>(null);
 const [railWidth,setRailWidth]=useState(0);
 const latest=useRef({current,domain,onChange});latest.current={current,domain,onChange};
 const drag=useRef<{id:number;x:number;width:number;total:number;edge:Edge;value:TimeWindow}|null>(null);
 function flush(){if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;const next=pending.current;pending.current=null;if(next&&(next.start!==latest.current.current.start||next.days!==latest.current.current.days))latest.current.onChange(next);}
 function queue(next:TimeWindow){pending.current=next;if(frame.current===null)frame.current=requestAnimationFrame(flush);}
 function active(){return pending.current||latest.current.current;}
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);},[]);
 useEffect(()=>{const node=rail.current;if(!node)return;const observer=new ResizeObserver(()=>setRailWidth(node.clientWidth));observer.observe(node);setRailWidth(node.clientWidth);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  const node=rail.current;if(!node)return;
  const wheel=(event:WheelEvent)=>{if(!event.altKey||event.deltaY===0)return;event.preventDefault();const v=active(),rect=node.getBoundingClientRect(),b=timeDomainBounds(latest.current.domain),date=b.start+(event.clientX-rect.left)/rect.width*(b.end-b.start+1),anchor=(date-dayNumber(v.start))/v.days;
   queue(zoomTimeWindow(v,v.days+Math.sign(event.deltaY)*Math.max(1,Math.round(v.days*.08)),anchor,latest.current.domain));};
  node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
 },[]);
 function begin(event:PointerEvent<HTMLButtonElement>,edge:Edge){if(!event.isPrimary||event.button!==0||drag.current)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);drag.current={id:event.pointerId,x:event.clientX,width:rail.current?.getBoundingClientRect().width||1,total,edge,value:active()};}
 function move(event:PointerEvent<HTMLButtonElement>){const d=drag.current;if(!d||d.id!==event.pointerId)return;const delta=Math.round((event.clientX-d.x)/d.width*d.total);queue(d.edge==='pan'?moveTimeWindow(d.value,delta,latest.current.domain):resizeTimeWindow(d.value,d.edge,delta,latest.current.domain));}
 function finish(event:PointerEvent<HTMLButtonElement>){if(drag.current?.id!==event.pointerId)return;drag.current=null;flush();}
 function key(event:KeyboardEvent<HTMLButtonElement>,edge:Edge){const v=active(),b=timeDomainBounds(domain),a=dayNumber(v.start),z=a+v.days-1;let delta=0;
  if(event.key==='ArrowLeft'||event.key==='ArrowDown')delta=event.shiftKey?-7:-1;
  else if(event.key==='ArrowRight'||event.key==='ArrowUp')delta=event.shiftKey?7:1;
  else if(event.key==='PageUp')delta=-v.days;else if(event.key==='PageDown')delta=v.days;
  else if(event.key==='Home')delta=b.start-(edge==='end'?z:a);
  else if(event.key==='End')delta=b.end-(edge==='start'?a:z);
  else if(edge==='pan'&&(event.key==='+'||event.key==='='||event.key==='-')){event.preventDefault();queue(zoomTimeWindow(v,v.days+(event.key==='-'?7:-7),.5,domain));return;}else return;
  event.preventDefault();queue(edge==='pan'?moveTimeWindow(v,delta,domain):resizeTimeWindow(v,edge,delta,domain));
 }
 const handlers=(edge:Edge)=>({onPointerDown:(e:PointerEvent<HTMLButtonElement>)=>begin(e,edge),onPointerMove:move,onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:finish,onKeyDown:(e:KeyboardEvent<HTMLButtonElement>)=>key(e,edge)});
 return <section className="time-navigator" aria-label="日期范围导航">
  <div className="time-navigator-caption"><span>{current.start} — {dayString(end)}</span><span>{current.days} 天{onReset&&<button type="button" className="time-navigator-reset" onClick={()=>{pending.current=null;if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;onReset();}} title="恢复今天及前24天、后5天">恢复默认 · 30天</button>}</span></div>
  <div className={'time-navigator-rail'+(railWidth*current.days/total<88?' compact':'')} ref={rail}>
   <button type="button" className="time-navigator-overview" aria-label="完整历史：点击定位日期" tabIndex={-1} onClick={e=>{const rect=rail.current!.getBoundingClientRect();queue(centerTimeWindow(dayString(bounds.start+Math.min(total-1,Math.max(0,(e.clientX-rect.left)/rect.width*total))),active().days,domain));}}/>
   <div className="time-navigator-selection" style={{left:`${(start-bounds.start)/total*100}%`,width:`${current.days/total*100}%`}} aria-hidden="true"/>
   <button type="button" className="time-navigator-pan" style={{left:`${(start-bounds.start+current.days/2)/total*100}%`,width:`max(44px, ${current.days/total*100}% - 44px)`}} aria-label="平移日期范围" aria-describedby={id} {...handlers('pan')}><span aria-hidden="true">•••</span></button>
   <button type="button" role="slider" className="time-navigator-handle start" style={{left:`${(start-bounds.start)/total*100}%`}} aria-label="范围开始日期" aria-valuemin={Math.max(bounds.start,end-119)} aria-valuemax={end-6} aria-valuenow={start} aria-valuetext={current.start} aria-describedby={id} {...handlers('start')}><i/></button>
   <button type="button" role="slider" className="time-navigator-handle end" style={{left:`${(end+1-bounds.start)/total*100}%`}} aria-label="范围结束日期" aria-valuemin={start+6} aria-valuemax={Math.min(bounds.end,start+119)} aria-valuenow={end} aria-valuetext={dayString(end)} aria-describedby={id} {...handlers('end')}><i/></button>
  </div>
  <div className="time-navigator-domain"><span>{domain.start}</span><span>{dayString(bounds.end)}</span></div>
  <span className="time-navigator-sr" id={id}>拖动中间平移，拖动两端缩放。方向键调整一天，Shift 加方向键调整七天，Home 和 End 到边界。中间按加减键或 Alt 加滚轮缩放。</span>
 </section>;
}
