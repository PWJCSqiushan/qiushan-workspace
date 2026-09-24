export type TimeWindow = {start:string;days:number};
export type TimeDomain = {start:string;end:string};
export const DAY_MS = 86_400_000;
export function dayNumber(date:string):number {
 const value=Date.parse(date+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(value)||new Date(value).toISOString().slice(0,10)!==date)throw new RangeError('Invalid calendar date: '+date);
 return value/DAY_MS;
}
export function dayString(day:number):string {return new Date(Math.round(day)*DAY_MS).toISOString().slice(0,10);}
/** Pad short histories on the right to preserve the seven-day minimum. */
export function timeDomainBounds(domain:TimeDomain) {
 const start=dayNumber(domain.start),end=dayNumber(domain.end);
 if(end<start)throw new RangeError('Time domain ends before it starts');
 return {start,end:Math.max(end,start+6)};
}
export function defaultTimeWindow(today:string):TimeWindow {return {start:dayString(dayNumber(today)-54),days:60};}
export function clampTimeWindow(value:TimeWindow,domain:TimeDomain):TimeWindow {
 const {start,end}=timeDomainBounds(domain),days=Math.min(end-start+1,120,Math.max(7,Number.isFinite(value.days)?Math.round(value.days):60));
 return {start:dayString(Math.max(start,Math.min(end-days+1,dayNumber(value.start)))),days};
}
export function moveTimeWindow(value:TimeWindow,days:number,domain:TimeDomain):TimeWindow {
 return clampTimeWindow({...value,start:dayString(dayNumber(value.start)+(Number.isFinite(days)?Math.round(days):0))},domain);
}
export function centerTimeWindow(date:string,days:number,domain:TimeDomain):TimeWindow {
 const size=clampTimeWindow({start:date,days},domain).days;
 return clampTimeWindow({start:dayString(dayNumber(date)-Math.floor((size-1)/2)),days:size},domain);
}
/** Resize one endpoint without moving its opposite endpoint. */
export function resizeTimeWindow(value:TimeWindow,edge:'start'|'end',delta:number,domain:TimeDomain):TimeWindow {
 const current=clampTimeWindow(value,domain),bounds=timeDomainBounds(domain),start=dayNumber(current.start),end=start+current.days-1;
 const shift=Number.isFinite(delta)?Math.round(delta):0;
 if(edge==='start') {const next=Math.max(bounds.start,end-119,Math.min(end-6,start+shift));return {start:dayString(next),days:end-next+1};}
 const next=Math.min(bounds.end,start+119,Math.max(start+6,end+shift));
 return {start:current.start,days:next-start+1};
}
export function zoomTimeWindow(value:TimeWindow,days:number,anchor:number,domain:TimeDomain):TimeWindow {
 const current=clampTimeWindow(value,domain),size=clampTimeWindow({...current,days},domain).days,ratio=Math.max(0,Math.min(1,anchor));
 return clampTimeWindow({start:dayString(dayNumber(current.start)+(current.days-size)*ratio),days:size},domain);
}
export function timeDateTickIndices(count:number,width:number,todayIndex=-1):Set<number> {
 const pitch=Math.max(1,width)/Math.max(1,count),spacing=Math.max(1,Math.ceil(48/pitch)),indices=new Set<number>();
 for(let i=0;i<count;i+=spacing)if(todayIndex<0||Math.abs(i-todayIndex)*pitch>=34)indices.add(i);
 if(todayIndex>=0&&todayIndex<count)indices.add(todayIndex);
 return indices;
}
/** Index only visible, intersecting cells; never rescan full history per day/cell. */
export function bucketTimeRanges<T extends {start:string;end:string}>(rows:readonly T[],start:number,count:number,slotMs:number):T[][] {
 const buckets=Array.from({length:count},()=>[] as T[]),end=start+count*slotMs;
 for(const row of rows){const a=Date.parse(row.start),b=Date.parse(row.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||a>=end||b<=start)continue;
  const first=Math.max(0,Math.floor((a-start)/slotMs)),last=Math.min(count-1,Math.ceil((b-start)/slotMs)-1);
  for(let i=first;i<=last;i++)buckets[i].push(row);
 }
 return buckets;
}
