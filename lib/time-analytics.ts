type Interval={start:string;end:string;categoryId:string};
type Category={id:string;name:string;color:string};
export const ATTENDANCE_LABELS={on_time:'正常出席',late_under_5:'迟到 ≤5 分钟',late_over_5:'迟到 >5 分钟',absent:'翘课',excused:'请假'} as const;
export type Attendance=keyof typeof ATTENDANCE_LABELS;
export const attendanceColors=['#73C6A2','#E4CD7C','#EDA66C','#E58E90','#B39AE7','#8b969e'];
export function categoryTotals(rows:readonly Interval[],categories:readonly Category[],start:number,end:number){
 const totals=new Map<string,number>();
 for(const row of rows){const minutes=Math.max(0,Math.min(Date.parse(row.end),end)-Math.max(Date.parse(row.start),start))/60000;totals.set(row.categoryId,(totals.get(row.categoryId)||0)+minutes);}
 return categories.filter(c=>c.id!=='unrecorded').map(c=>({...c,value:totals.get(c.id)||0}));
}
export function attendanceTotals(plans:readonly (Interval&{attendance?:string;status:string;deliveryMode?:string})[],start:number,end:number){
 const ended=plans.filter(p=>p.categoryId==='class'&&Date.parse(p.end)>start&&Date.parse(p.end)<=end&&p.status!=='cancelled'&&p.deliveryMode!=='online'&&Date.parse(p.end)<=Date.now());
 return Object.entries(ATTENDANCE_LABELS).map(([id,name],i)=>({id,name,color:attendanceColors[i],value:ended.filter(p=>(p.attendance||'on_time')===id).length}));
}
export function weekStart(ms:number){const day=new Date(ms+8*3600000);const midnight=Date.parse(day.toISOString().slice(0,10)+'T00:00:00+08:00');return midnight-((day.getUTCDay()+6)%7)*86400000;}
export function weeklyComparison(rows:readonly Interval[],categories:readonly Category[],now:number,weeks=4){
 const current=weekStart(now),weekMs=7*86400000;
 const series=Array.from({length:weeks},(_,i)=>{const start=current-(weeks-i)*weekMs;return {key:'w'+i,start,end:start+weekMs,label:new Date(start+8*3600000).toISOString().slice(5,10)};});
 const totals=series.map(w=>categoryTotals(rows,categories,w.start,w.end));
 const axes:Array<{id:string;name:string}&Record<string,string|number>>=categories.filter(c=>c.id!=='unrecorded').map(c=>({id:c.id,name:c.name,...Object.fromEntries(series.map((w,i)=>[w.key,Number(((totals[i].find(r=>r.id===c.id)?.value||0)/60).toFixed(2))]))}));
 return {series,axes};
}
