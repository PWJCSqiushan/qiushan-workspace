'use client';
import {memo,useMemo,useRef,useLayoutEffect,useState} from 'react';
import {TIME_SLOT_MS,TIME_SLOTS_PER_DAY,summarizeTimeSlot,timeSlotClock} from '../lib/time-grid';
import {bucketTimeRanges,timeDateTickIndices} from '../lib/time-window';
type Row={start:string;end:string;categoryId:string};
type Props={rows:Row[];plans:Row[];categories:{id:string;name:string;color:string}[];first:string;count:number;now:number;selected:string;onSelect:(day:string)=>void};
export const TimeMatrix=memo(function TimeMatrix({rows,plans,categories,first,count,now,selected,onSelect}:Props){
 const viewport=useRef<HTMLDivElement>(null);
 const [width,setWidth]=useState(560);
 useLayoutEffect(()=>{
  const node=viewport.current;if(!node)return;
  // Snap every row to the same number of device pixels; fractional fr tracks
  // otherwise alternate between rasterized gaps as the viewport changes.
  const measure=()=>{const scale=window.devicePixelRatio||1,physicalPitch=Math.max(2,Math.floor((node.clientHeight-34)*scale/TIME_SLOTS_PER_DAY)),pitch=physicalPitch/scale,gap=1/scale;
   setWidth(Math.max(1,(node.firstElementChild?.clientWidth||node.clientWidth)-34));
   node.style.setProperty('--time-row-pitch',pitch+'px');
   node.style.setProperty('--time-row-gap',gap+'px');
   node.style.setProperty('--time-bar-height',(pitch-gap)+'px');
  };
  const observer=new ResizeObserver(measure);observer.observe(node);window.addEventListener('resize',measure);measure();
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[]);
 const buckets=useMemo(()=>{const base=Date.parse(first+'T00:00:00+08:00'),cells=count*TIME_SLOTS_PER_DAY;return {actual:bucketTimeRanges(rows,base,cells,TIME_SLOT_MS),planned:bucketTimeRanges(plans,base,cells,TIME_SLOT_MS)};},[rows,plans,first,count]);
 const matrix=useMemo(()=>{
  const base=Date.parse(first+'T00:00:00+08:00'),lookup=new Map(categories.map(c=>[c.id,c]));
  return Array.from({length:count},(_,d)=>{const start=base+d*86400000,day=new Date(start+8*3600000).toISOString().slice(0,10);
   return {day,slots:Array.from({length:TIME_SLOTS_PER_DAY},(_,i)=>{const index=d*TIME_SLOTS_PER_DAY+i,slot=summarizeTimeSlot(buckets.actual[index],start+i*TIME_SLOT_MS,now,buckets.planned[index]);return {state:slot.state,color:lookup.get(slot.categoryId||'')?.color||'var(--time-unrecorded)',title:day+' '+timeSlotClock(i)+'—'+(i===TIME_SLOTS_PER_DAY-1?'24:00':timeSlotClock(i+1))+' · '+(slot.state==='planned'?'课程计划':slot.state==='future'?'未来':slot.parts.map(p=>(lookup.get(p.categoryId)?.name||'未记录')+' '+Number(p.minutes.toFixed(2))+'分钟').join('；'))};})};});
 },[buckets,categories,first,count,now]);
 const today=new Date(now+8*3600000).toISOString().slice(0,10);
 const ticks=timeDateTickIndices(count,width,Math.round((Date.parse(today)-Date.parse(first))/86400000));
 return <div className="time-matrix-scroll" ref={viewport}><div className="time-matrix" style={{gridTemplateColumns:`34px repeat(${count},minmax(0,1fr))`}}><span/>{matrix.map((column,index)=><button key={column.day} className={'time-date'+(column.day===selected?' selected':'')+(column.day===today?' today':'')} title={column.day} aria-current={column.day===today?'date':undefined} aria-label={'打开'+column.day+'时间轴'} onClick={()=>onSelect(column.day)}><span>{column.day===today?'今':ticks.has(index)?column.day.slice(5).replace('-','/'):''}</span></button>)}{Array.from({length:TIME_SLOTS_PER_DAY},(_,i)=><div className="time-matrix-row" key={i}><span className="time-hour">{i%6===0?timeSlotClock(i):''}</span>{matrix.map(column=>{const slot=column.slots[i];return <span className={'time-dot-cell '+slot.state} key={column.day} title={slot.title} onClick={()=>onSelect(column.day)}><i style={{backgroundColor:slot.state==='future'||slot.state==='planned'?'transparent':slot.color,border:slot.state==='planned'?'1px solid var(--time-plan)':slot.state==='future'?'1px solid var(--time-future)':'none'}}/></span>;})}</div>)}<span className="time-hour">24:00</span>{[42,141].map(slot=><span key={slot} className="time-boundary-line" aria-hidden="true" style={{top:`calc(24px + var(--time-row-pitch,3px) * ${slot} - var(--time-row-gap,1px))`}}/>)}</div></div>;
});
