import type {TimeCoreSnapshot, TimePlan, ImportCandidate} from './time-domain.ts';
import type {TimetablePeriod} from './time-imports.ts';

// The existing verified school table; these are clock times, never inferred from Excel geometry.
export const SCHOOL_PERIODS:TimetablePeriod[] = [
  ['08:00','08:45'],['08:55','09:40'],['10:00','10:45'],['10:55','11:40'],
  ['13:30','14:15'],['14:25','15:10'],['15:30','16:15'],['16:25','17:10'],
  ['18:20','19:05'],['19:06','19:50'],['20:00','20:45'],['20:46','21:30'],
].map(([start,end],i)=>({index:i+1,start,end}));
export const CALENDAR_SOURCE='https://xsc.jlu.edu.cn/info/1048/5900.htm';
export type CalendarRule={id:string;date:string;action:'stop'|'unknown'|'teach'|'move'|'add';originalDate?:string;note:string};
export type SemesterLesson={code:string;name:string;section:string;weeks:number[];weekday:number;periods:number[];location:string;deliveryMode:'online'|'in_person';cells:string[]};
export type SemesterPreset={id:string;name:string;startDate:string;endWeek:number;periods:TimetablePeriod[];lessons:SemesterLesson[];calendar:CalendarRule[];calendarVerifiedThrough:string};
export function keyOf(value:string){let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return (h>>>0).toString(16);}
export const shiftDay=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const localDay=(date:string)=>new Date(Date.parse(date)+8*3600000).toISOString().slice(0,10);
const courseLabel=(value:string)=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
export function defaultCalendar():CalendarRule[]{return [
  ...[25,26,27].map(n=>({id:'holiday-09-'+n,date:`2026-09-${n}`,action:'stop' as const,note:'中秋放假 · 学工处通知'})),
  ...Array.from({length:7},(_,i)=>({id:'holiday-10-'+(i+1),date:`2026-10-0${i+1}`,action:'stop' as const,note:'国庆放假 · 学工处通知'})),
  ...['2026-09-20','2026-10-10'].map(date=>({id:'review-'+date,date,action:'unknown' as const,note:'本科补课映射待核对，未生成补课'})),
];}
export function parseWeeks(text:string):number[]{
  const odd=/单/.test(text),even=/双/.test(text);const clean=text.replace(/[第周\s()（）单双]/g,'').replace(/[至到~～—–]/g,'-');
  if(!/^\d+(?:-\d+)?(?:[,，、]\d+(?:-\d+)?)*$/.test(clean))throw new Error('周次无法识别：'+text);
  const weeks=new Set<number>();for(const part of clean.split(/[,，、]/)){const [a,b=a]=part.split('-').map(Number);if(a<1||b<a||b>30)throw new Error('周次超出 1–30');for(let w=a;w<=b;w++)if((!odd||w%2===1)&&(!even||w%2===0))weeks.add(w);}
  return [...weeks].sort((a,b)=>a-b);
}
export function parseSemesterGrid(rows:readonly (readonly unknown[])[],periods=SCHOOL_PERIODS){
  const issues:string[]=[];const header=rows.findIndex(row=>row.filter(v=>/^星期[一二三四五六日天]$/.test(String(v||''))).length>=5);
  if(header<0)throw new Error('未找到星期网格表头');
  const all=rows.flat().map(v=>String(v||'')).join(' ');if(!/2026-2027.*第1学期/.test(all)||!/9月7日/.test(all))throw new Error('请核对学年与第一周周一，当前预设只支持明确的 2026-2027 第一学期 / 9月7日');
  const lessons:SemesterLesson[]=[];const seen=new Map<string,SemesterLesson>();
  for(let r=header+1;r<rows.length;r++){
    const rowLabel=rows[r].map(v=>String(v||'')).find(v=>/^第\d+节/.test(v));if(!rowLabel)continue;
    rows[header].forEach((h,c)=>{const day='一二三四五六日'.indexOf(String(h||'').replace('星期','').replace('天','日'))+1;if(!/^星期/.test(String(h||''))||day<1)return;
      const raw=String(rows[r][c]||'').trim();if(!raw)return;
      const chunks=raw.split(/\n\s*\n/).filter(Boolean);
      for(const chunk of chunks){const m=chunk.trim().match(/^([A-Za-z0-9]+)-([^\n]+?)\[([^\]]+)\]\s*\n([\s\S]+)$/);
        const cell=`R${r+1}C${c+1}`;if(!m){issues.push(cell+' 课程代码或教学班无法识别');continue;}
        const detail=m[4].trim().match(/^(.+?),\s*星期([1-7一二三四五六日天]),\s*第(\d+)节(?:[-—～]第?(\d+)节)?(.*)$/);
        if(!detail){issues.push(cell+' 周次、星期或节次无法识别');continue;}
        try{const weekday=Number(detail[2])||'一二三四五六日'.indexOf(detail[2].replace('天','日'))+1;if(weekday!==day)throw new Error('星期与列不一致');
          const a=Number(detail[3]),b=Number(detail[4]||a);if(a<1||b<a||b>12)throw new Error('节次范围无效');
          const location=detail[5].replace(/[,，\s]+$/,'').trim();const item:SemesterLesson={code:m[1],name:m[2].trim(),section:m[3],weeks:parseWeeks(detail[1]),weekday,periods:Array.from({length:b-a+1},(_,i)=>a+i),location,deliveryMode:/线上|在线/.test(location)?'online':'in_person',cells:[cell]};
          const identity=JSON.stringify({...item,cells:undefined});const prior=seen.get(identity);if(prior)prior.cells.push(cell);else{seen.set(identity,item);lessons.push(item);}
        }catch(e){issues.push(cell+' '+(e instanceof Error?e.message:String(e)));}
      }
    });
  }
  const preset:SemesterPreset={id:'jlu-2026-autumn',name:'2026–2027 第一学期',startDate:'2026-09-07',endWeek:Math.max(1,...lessons.flatMap(l=>l.weeks)),periods:structuredClone(periods),lessons,calendar:defaultCalendar(),calendarVerifiedThrough:'2026-10-10'};
  return {preset,issues};
}
function validDate(s:unknown):s is string{return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
export function validatePreset(value:SemesterPreset):SemesterPreset{
  if(!value||typeof value!=='object'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)||typeof value.name!=='string'||value.name.length>100||!validDate(value.startDate)||new Date(value.startDate).getUTCDay()!==1||!Number.isInteger(value.endWeek)||value.endWeek<1||value.endWeek>30)throw new Error('学期预设参数无效');
  if(!Array.isArray(value.periods)||value.periods.length>24||new Set(value.periods.map(p=>p.index)).size!==value.periods.length||value.periods.some(p=>!Number.isInteger(p.index)||p.index<1||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)||p.end<=p.start))throw new Error('节次钟点表无效');
  if(!Array.isArray(value.lessons)||value.lessons.length>500||!value.lessons.length)throw new Error('课程预设为空或过多');
  for(const l of value.lessons){if(!l||typeof l.code!=='string'||!l.code||l.code.length>100||typeof l.name!=='string'||!l.name||l.name.length>150||typeof l.section!=='string'||l.section.length>40||typeof l.location!=='string'||l.location.length>200||!['online','in_person'].includes(l.deliveryMode)||!Number.isInteger(l.weekday)||l.weekday<1||l.weekday>7||!Array.isArray(l.weeks)||!l.weeks.length||l.weeks.some(w=>!Number.isInteger(w)||w<1||w>value.endWeek)||!Array.isArray(l.periods)||!l.periods.length||l.periods.some((p,i)=>!value.periods.some(t=>t.index===p)||(i>0&&p!==l.periods[i-1]+1)))throw new Error('课程周次或节次无效');}
  if(!validDate(value.calendarVerifiedThrough)||!Array.isArray(value.calendar)||value.calendar.length>300)throw new Error('校历无效');
  const ids=new Set<string>();for(const r of value.calendar){if(!r||typeof r.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(r.id)||ids.has(r.id)||!validDate(r.date)||!['stop','unknown','teach','move','add'].includes(r.action)||typeof r.note!=='string'||r.note.length>300||(['move','add'].includes(r.action)&&!validDate(r.originalDate)))throw new Error('校历日期或原教学日期无效');ids.add(r.id);}
  return structuredClone(value);
}
export function savedSemester(core:Pick<TimeCoreSnapshot,'sources'>):SemesterPreset|undefined{return core.sources.find(s=>s.sourceKey.startsWith('semester-preset:'))?.payload?.preset as SemesterPreset|undefined;}
export type SemesterRow={item:ImportCandidate;state:'new'|'matched'|'stopped'|'online'|'conflict'|'review'|'protected';message:string;matchIds:string[];candidateIds?:string[]};
export function previewSemester(core:Pick<TimeCoreSnapshot,'plans'|'sources'>,input:SemesterPreset){
  const preset=validatePreset(input),rows:SemesterRow[]=[];const items:ImportCandidate[]=[];const notices:string[]=[];
  if(shiftDay(preset.startDate,preset.endWeek*7-1)>preset.calendarVerifiedThrough)notices.push(`校历仅核对至 ${preset.calendarVerifiedThrough}；后续（含 2027 年）节假日须补充核对`);
  for(const rule of preset.calendar.filter(r=>r.action==='unknown'))notices.push(`${rule.date}：${rule.note}`);
  for(const lesson of preset.lessons)for(const week of lesson.weeks){
    const originalDate=shiftDay(preset.startDate,(week-1)*7+lesson.weekday-1);
    const base=[preset.id,lesson.code,lesson.section,week,lesson.weekday,lesson.periods.join('-')].join(':');
    const moves=preset.calendar.filter(r=>r.action==='move'&&r.originalDate===originalDate);if(moves.length>1)notices.push(originalDate+' 有多个移动安排，请核对');
    const destinations=[{date:moves[0]?.date||originalDate,suffix:'',explicit:moves.length===1},...preset.calendar.filter(r=>r.action==='add'&&r.originalDate===originalDate).map(r=>({date:r.date,suffix:':add:'+r.id,explicit:true}))];
    for(const dest of destinations){
      const logicalOccurrenceId='semester:'+keyOf(base+dest.suffix),first=preset.periods.find(p=>p.index===lesson.periods[0])!,last=preset.periods.find(p=>p.index===lesson.periods.at(-1))!;
      const item:ImportCandidate={kind:'plan',start:dest.date+'T'+first.start+':00+08:00',end:dest.date+'T'+last.end+':00+08:00',categoryId:'class',note:lesson.name,courseName:lesson.name,courseCode:lesson.code,location:lesson.location,deliveryMode:lesson.deliveryMode,sourceKey:logicalOccurrenceId,logicalOccurrenceId,sourceLessonKey:logicalOccurrenceId,sourcePeriods:lesson.periods,teachingWeek:week,teachingDate:originalDate,importSource:preset.id};
      const rules=preset.calendar.filter(r=>r.date===dest.date),unknown=rules.some(r=>r.action==='unknown')&&!dest.explicit&&!rules.some(r=>r.action==='teach'),stop=rules.some(r=>r.action==='stop')&&!rules.some(r=>r.action==='teach')&&!dest.explicit;
      const exact=core.plans.filter(p=>p.logicalOccurrenceId===logicalOccurrenceId||p.sourceKey===logicalOccurrenceId);
      const legacy=exact.length?[]:core.plans.filter(p=>p.categoryId==='class'&&!p.logicalOccurrenceId&&localDay(p.start)===originalDate&&courseLabel(p.courseName||p.note?.split(' · ')[0]||'')===courseLabel(lesson.name)&&Date.parse(p.start)>=Date.parse(originalDate+'T'+first.start+':00+08:00')&&Date.parse(p.end)<=Date.parse(originalDate+'T'+last.end+':00+08:00'));
      const protectedMatch=exact.some(p=>p.manual!==false||p.attendance!==undefined||p.status==='cancelled'||core.sources.some(s=>s.recordId===p.id&&s.manual));
      let state:SemesterRow['state']=unknown||moves.length>1?'review':stop?'stopped':lesson.deliveryMode==='online'?'online':exact.length?'matched':legacy.length?'review':'new';
      if(protectedMatch)state='protected';
      const duplicate=items.find(p=>p.logicalOccurrenceId===logicalOccurrenceId);
      if(duplicate){if(JSON.stringify(duplicate)===JSON.stringify(item))continue;state='conflict';for(const row of rows.filter(r=>r.item.logicalOccurrenceId===logicalOccurrenceId))row.state='conflict';}
      items.push(item);rows.push({item,state,matchIds:(exact.length?exact:legacy).map(p=>p.id),message:unknown?'本科教学安排待核对':legacy.length?'旧课程身份需确认，保留人工标记':stop?'校历停课':lesson.deliveryMode==='online'?'线上教学不计出勤或通勤':protectedMatch?'保留人工状态 / 历史出勤':state==='conflict'?'同一课程身份存在不同安排':'第 '+week+' 周'});
    }
  }
  const eligible=rows.filter(r=>['new','matched','conflict'].includes(r.state));
  for(const row of eligible){const conflicts=[...eligible.filter(r=>r!==row&&!row.matchIds.some(id=>r.matchIds.includes(id))).map(r=>r.item),...core.plans.filter(p=>p.categoryId==='class'&&p.status!=='cancelled'&&p.deliveryMode!=='online'&&!row.matchIds.includes(p.id)&&!p.logicalOccurrenceId?.startsWith('semester:'))].some(p=>Date.parse(p.start)<Date.parse(row.item.end)&&Date.parse(row.item.start)<Date.parse(p.end));if(conflicts){row.state='conflict';row.message='与其他课程重叠，未自动应用';}}
  for(const row of rows.filter(r=>r.state==='conflict'&&!r.matchIds.length))row.candidateIds=core.plans.filter(p=>p.categoryId==='class'&&!p.logicalOccurrenceId&&Date.parse(p.start)>=Date.parse(row.item.start)&&Date.parse(p.end)<=Date.parse(row.item.end)).map(p=>p.id);
  const unmatched=core.plans.filter(p=>p.categoryId==='class'&&!rows.some(r=>r.matchIds.includes(p.id)));
  return {rows,notices,unmatched,legacyCount:core.plans.filter(p=>p.categoryId==='class').length,counts:Object.fromEntries(['new','matched','stopped','online','conflict','review','protected'].map(s=>[s,rows.filter(r=>r.state===s).length]))};
}
export function applySemester(core:TimeCoreSnapshot,input:SemesterPreset,approvedMappings:Record<string,string[]>={},now=new Date()):TimeCoreSnapshot{
  const preset=validatePreset(input),next=structuredClone(core),preview=previewSemester(core,preset);
  for(const row of preview.rows){const item=row.item;let matches=next.plans.filter(p=>row.matchIds.includes(p.id));
    const reviewIds=row.matchIds.length?row.matchIds:row.candidateIds||[];
    if(['review','conflict'].includes(row.state)&&reviewIds.length&&JSON.stringify([...(approvedMappings[item.logicalOccurrenceId!]||[])].sort())===JSON.stringify([...reviewIds].sort())){
      // Explicit identity mapping is metadata-only when any old row is manual or already attended.
      matches=next.plans.filter(p=>reviewIds.includes(p.id));
      for(const p of matches)p.logicalOccurrenceId=item.logicalOccurrenceId;
      continue;
    }
    if(['review','conflict','protected'].includes(row.state))continue;
    if(['online','stopped'].includes(row.state)){
      for(const p of matches)if(p.manual===false&&!p.attendance&&p.status!=='cancelled'&&Date.parse(p.end)>now.getTime()){if(row.state==='online')p.deliveryMode='online';else p.status='cancelled';}
      continue;
    }
    if(matches.length>1)continue;
    const {kind,...planItem}=item;
    if(matches.length){const p=matches[0];Object.assign(p,planItem,{start:new Date(item.start).toISOString(),end:new Date(item.end).toISOString()});}
    else {const p:TimePlan={...planItem,id:'plan-'+keyOf(item.logicalOccurrenceId!),start:new Date(item.start).toISOString(),end:new Date(item.end).toISOString(),status:'planned',manual:false,version:1,courseGroupKey:item.logicalOccurrenceId,originalPlanIds:[]};if(next.plans.some(old=>old.id===p.id))throw new Error('课程标识冲突');next.plans.push(p);matches=[p];}
    const p=matches[0],prior=next.sources.find(s=>s.sourceKey===item.sourceKey);
    if(!prior)next.sources.push({sourceKey:item.sourceKey!,kind:'plan',status:p.status==='cancelled'?'cancelled':'active',manual:false,recordId:p.id});
  }
  return next;
}
