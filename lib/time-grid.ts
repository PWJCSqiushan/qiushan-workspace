/** Display buckets only. Exact intervals remain the statistical source of truth. */
export const TIME_SLOT_MINUTES = 10;
export const TIME_SLOT_MS = TIME_SLOT_MINUTES * 60_000;
export const TIME_SLOTS_PER_DAY = 24 * 60 / TIME_SLOT_MINUTES;
type Range = {start:string;end:string;categoryId:string};
export type TimeSlotSummary = {
  categoryId:string|null;
  state:'recorded'|'unrecorded'|'planned'|'future';
  minutes:number;
  parts:{categoryId:string;minutes:number}[];
};
/** Unrecorded competes with actual categories; future time never votes.
 * Ties: actual before unrecorded, then earliest covered activity, then stable id.
 */
export function summarizeTimeSlot(rows:readonly Range[],start:number,now:number,plans:readonly Range[]=[]):TimeSlotSummary {
 const end=start+TIME_SLOT_MS,until=Math.min(end,now);
 const planned=plans.some(r=>Date.parse(r.start)<end&&Date.parse(r.end)>start);
 if(until<=start)return {categoryId:null,state:planned?'planned':'future',minutes:0,parts:[]};
 const totals=new Map<string,{duration:number;first:number}>();let recorded=0;
 for(const row of rows){
  const a=Math.max(start,Date.parse(row.start)),b=Math.min(until,Date.parse(row.end));
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||row.categoryId==='unrecorded')continue;
  const old=totals.get(row.categoryId);totals.set(row.categoryId,{duration:(old?.duration||0)+b-a,first:Math.min(old?.first??a,a)});recorded+=b-a;
 }
 const unknown=Math.max(0,until-start-recorded);
 if(unknown)totals.set('unrecorded',{duration:unknown,first:Infinity});
 const ranked=[...totals].sort(([a,x],[b,y])=>y.duration-x.duration||Number(a==='unrecorded')-Number(b==='unrecorded')||x.first-y.first||a.localeCompare(b));
 const winner=ranked[0]?.[0]||'unrecorded';
 return {categoryId:winner,state:recorded===0&&planned?'planned':winner==='unrecorded'?'unrecorded':'recorded',minutes:(until-start)/60000,parts:ranked.map(([categoryId,v])=>({categoryId,minutes:v.duration/60000}))};
}
export function timeSlotClock(index:number):string {
 const minutes=index*TIME_SLOT_MINUTES;
 return String(Math.floor(minutes/60)%24).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
}
