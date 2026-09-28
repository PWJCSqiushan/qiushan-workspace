import type {TimeCoreSnapshot,TimeInterval,TimePlan} from './time-domain.ts';
import {keyOf,localDay} from './time-semester.ts';
export const COMMUTE_EFFECTIVE_FROM='2026-09-28';
type Span={start:number;end:number;edges:string[]};
const auto=(r:TimeInterval)=>r.generatedBy==='commute'&&r.manual===false;
export function commuteEdge(plan:TimePlan,edge:'pre'|'post'){return 'commute-edge:'+keyOf(plan.logicalOccurrenceId||plan.courseGroupKey||plan.id)+':'+edge;}
export function suppressCommute(core:TimeCoreSnapshot,row:TimeInterval){
  for(const edge of row.commuteEdges||[]){core.sources=core.sources.filter(s=>s.sourceKey!==edge);core.sources.push({sourceKey:edge,kind:'actual',status:'deleted',manual:true,payload:{suppressed:true}});}
}
function subtract(spans:Span[],a:number,b:number):Span[]{return spans.flatMap(s=>b<=s.start||a>=s.end?[s]:[...(a>s.start?[{...s,end:a}]:[]),...(b<s.end?[{...s,start:b}]:[])]);}
/** Every course contributes two needs. Union them before filling only uncovered minutes. */
export function reconcileCommutes(input:TimeCoreSnapshot,now=new Date(),effectiveFrom=COMMUTE_EFFECTIVE_FROM):TimeCoreSnapshot{
  const core=structuredClone(input);core.intervals=core.intervals.filter(r=>!auto(r));core.plans=core.plans.filter(p=>!auto(p));
  const suppressed=new Set(core.sources.filter(s=>s.sourceKey.startsWith('commute-edge:')&&s.payload?.suppressed===true).map(s=>s.sourceKey));
  const classes=core.plans.filter(p=>p.categoryId==='class'&&p.status!=='cancelled'&&p.deliveryMode!=='online'&&!['absent','excused'].includes(p.attendance||''));
  const needs:Span[]=[];
  for(const p of classes){if(localDay(p.start)<effectiveFrom)continue;for(const edge of ['pre','post'] as const){if(edge==='pre'&&(p.attendance?.startsWith('late_')||(p.lateMinutes||0)>0))continue;const id=commuteEdge(p,edge);if(suppressed.has(id))continue;const start=Date.parse(edge==='pre'?p.start:p.end)-(edge==='pre'?600000:0);needs.push({start,end:start+600000,edges:[id]});}}
  // Split at every boundary so suppression of one neighbour never removes another's need.
  const points=[...new Set(needs.flatMap(n=>[n.start,n.end]))].sort((a,b)=>a-b),segments:Span[]=[];
  for(let i=1;i<points.length;i++){const start=points[i-1],end=points[i],edges=[...new Set(needs.filter(n=>n.start<end&&n.end>start).flatMap(n=>n.edges))].sort();if(edges.length)segments.push({start,end,edges});}
  let available=segments;for(const row of [...core.intervals,...classes,...core.plans.filter(p=>p.categoryId!=='class'&&p.manual!==false&&p.status!=='cancelled')])available=subtract(available,Date.parse(row.start),Date.parse(row.end));
  // One uninterrupted journey, retaining all contributing edges for manual suppression.
  const merged:Span[]=[];for(const span of available){const prev=merged.at(-1);if(prev&&prev.end===span.start){prev.end=span.end;prev.edges=[...new Set([...prev.edges,...span.edges])].sort();}else merged.push({...span});}
  for(const s of merged){const row:TimeInterval={id:'commute-'+keyOf([s.start,s.end,...s.edges].join(':')),start:new Date(s.start).toISOString(),end:new Date(s.end).toISOString(),categoryId:'commute',note:'课程通勤',manual:false,generatedBy:'commute',commuteEdges:s.edges,version:1};if(s.end<=now.getTime())core.intervals.push(row);else core.plans.push({...row,status:'planned'});}
  core.intervals.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));core.plans.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));return core;
}
export function previewHistoricalCommutes(core:TimeCoreSnapshot,now=new Date()){
  const full=reconcileCommutes(core,now,'1900-01-01');return full.intervals.filter(r=>auto(r)&&localDay(r.start)<COMMUTE_EFFECTIVE_FROM);
}
