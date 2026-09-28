'use client';
import {useState} from 'react';
import {parseSemesterGrid,previewSemester,savedSemester,CALENDAR_SOURCE,type SemesterPreset,type CalendarRule} from '../lib/time-semester';
import {previewHistoricalCommutes,COMMUTE_EFFECTIVE_FROM} from '../lib/time-commute';
import type {TimeCoreSnapshot,TimeMutation} from '../lib/time-domain';
import './time-semester-panel.css';
type Props={core:TimeCoreSnapshot;onMutation:(mutation:TimeMutation)=>Promise<unknown>};
const labels:Record<string,string>={new:'新增',matched:'已有匹配',stopped:'停课',online:'线上排除',conflict:'冲突',review:'待核对',protected:'人工 / 历史保护'};
export function TimeSemesterPanel({core,onMutation}:Props){
  const [calendarOpen,setCalendarOpen]=useState(false),[unmatchedOpen,setUnmatchedOpen]=useState(false);
  const stored=savedSemester(core),[draft,setDraft]=useState<SemesterPreset|undefined>(),[error,setError]=useState(''),[message,setMessage]=useState(''),[show,setShow]=useState(false),[busy,setBusy]=useState(false),[approved,setApproved]=useState<Record<string,string[]>>({}),[history,setHistory]=useState(false);
  const preset=draft||stored;let preview:ReturnType<typeof previewSemester>|undefined,validation='';try{if(preset)preview=previewSemester(core,preset);}catch(e){validation=e instanceof Error?e.message:String(e);}
  async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function read(file:File){await run(async()=>{const {readSheet}=await import('read-excel-file/browser');const parsed=parseSemesterGrid(await readSheet(file));if(parsed.issues.length)throw new Error(parsed.issues.join('；'));setDraft(parsed.preset);setShow(true);setMessage('已在本机解析。保存后，其他设备可直接预览与应用。');});}
  function patchRule(index:number,patch:Partial<CalendarRule>){if(preset)setDraft({...preset,calendar:preset.calendar.map((r,i)=>i===index?{...r,...patch}:r)});}
  const suppressed=core.sources.filter(s=>s.sourceKey.startsWith('commute-edge:')&&s.payload?.suppressed);
  return <section className="time-semester" aria-label="学期预设与校历">
    <h3>学期一键预设</h3><p>第一周周一：2026-09-07。首次保存后，iPad 无需重新选择 Excel；每次应用前查看新增、停课与冲突。</p>
    <label className="time-file">选择网格课表 XLSX<input type="file" accept=".xlsx" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void read(file);}}/></label>
    {preset&&<><p>{preset.name} · {preset.lessons.length} 条课程安排 · {draft?'本机待保存':'已保存到账户'}</p>
      <button disabled={busy||!!validation} onClick={()=>setShow(v=>!v)}>预览本学期</button>
      {draft&&<button disabled={busy||!!validation} onClick={()=>void run(async()=>{await onMutation({type:'saveSemester',preset:draft});setDraft(undefined);setMessage('已提交私有预设保存；离线时会排队同步。');})}>保存私有预设</button>}
      <button aria-expanded={calendarOpen} onClick={()=>setCalendarOpen(v=>!v)}>校历编辑与补课核对</button>{calendarOpen&&<div><p><a href={CALENDAR_SOURCE} target="_blank" rel="noreferrer">学校放假通知</a>。补课需填写原教学日期和实际日期；移动保留原教学周，加课另建一次出勤。</p>
        <label>已核对校历截至 <input type="date" value={preset.calendarVerifiedThrough} onChange={e=>setDraft({...preset,calendarVerifiedThrough:e.target.value})}/></label>
        {preset.calendar.map((r,i)=><div className="time-calendar-rule" key={r.id}><input aria-label={`安排${i+1}实际日期`} type="date" value={r.date} onChange={e=>patchRule(i,{date:e.target.value})}/><select aria-label={`安排${i+1}类型`} value={r.action} onChange={e=>patchRule(i,{action:e.target.value as CalendarRule['action']})}><option value="unknown">待核对</option><option value="stop">停课</option><option value="teach">明确正常上课</option><option value="move">移动原课程</option><option value="add">额外加课</option></select>{['move','add'].includes(r.action)&&<label>原教学日期<input type="date" value={r.originalDate||''} onChange={e=>patchRule(i,{originalDate:e.target.value})}/></label>}<input aria-label={`安排${i+1}依据`} value={r.note} onChange={e=>patchRule(i,{note:e.target.value})}/><button onClick={()=>setDraft({...preset,calendar:preset.calendar.filter((_,j)=>i!==j)})}>移除安排</button></div>)}
        <button onClick={()=>setDraft({...preset,calendar:[...preset.calendar,{id:crypto.randomUUID(),date:'',action:'unknown',note:''}]})}>新增明确日期安排</button>
      </div>}
      {show&&preview&&<div><p>{Object.entries(preview.counts).map(([k,n])=>`${labels[k]} ${n}`).join(' · ')}</p><p className="time-help">当前 {preview.legacyCount} 条课程记录保留原实体和出勤计数；旧记录确认仅建立身份映射，不合并历史出勤。冲突课程须先核对旧记录。</p>{preview.notices.map(n=><p className="time-help" key={n}>{n}</p>)}
        {preview.unmatched.length>0&&<div><button aria-expanded={unmatchedOpen} onClick={()=>setUnmatchedOpen(v=>!v)}>{preview.unmatched.length} 条旧记录未匹配（保留待核对）</button>{unmatchedOpen&&preview.unmatched.map(p=><p key={p.id}>{p.start.slice(0,10)} · {p.courseName||p.note} · {p.status} / {p.attendance||'未标记'}</p>)}</div>}
        <div className="time-preview-list">{preview.rows.map((r,i)=><p key={r.item.logicalOccurrenceId+'-'+i}><b>{labels[r.state]}</b> · {r.item.start.slice(0,10)} · {r.item.courseName} · 第{r.item.teachingWeek}周 · {r.item.sourcePeriods?.join('、')}节 · {r.message}{['review','conflict'].includes(r.state)&&(r.matchIds.length>0||(r.candidateIds?.length||0)>0)&&<label><input type="checkbox" checked={!!approved[r.item.logicalOccurrenceId!]} onChange={e=>setApproved(v=>{const next={...v};if(e.target.checked)next[r.item.logicalOccurrenceId!]=r.matchIds.length?r.matchIds:r.candidateIds!;else delete next[r.item.logicalOccurrenceId!];return next;})}/>确认这些旧记录属于本课（只映射身份，保留原状态）：{core.plans.filter(p=>(r.matchIds.length?r.matchIds:r.candidateIds||[]).includes(p.id)).map(p=>p.courseName||p.note||p.id).join('；')}</label>}</p>)}</div>
        <button className="time-primary" disabled={busy||!!draft} onClick={()=>void run(async()=>{await onMutation({type:'applySemester',approvedMappings:approved});setMessage('已提交增量应用；冲突、未确认补课与人工状态保留。');})}>{draft?'先保存预设，再应用':'应用本学期（增量）'}</button>
      </div>}
    </>}
    {(error||validation)&&<p role="alert">{error||validation}</p>}{message&&<p role="status">{message}</p>}
    <h3>课程自动通勤</h3><p>自 {COMMUTE_EFFECTIVE_FROM} 起，每次线下大课前后各 10 分钟；迟到取消课前通勤，人工记录优先。历史仅预览。</p>
    <button onClick={()=>setHistory(v=>!v)}>历史通勤预览</button>{history&&<div className="time-preview-list">{previewHistoricalCommutes(core).map(r=><p key={r.id}>{r.start.slice(0,10)} · {new Date(r.start).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'})} · 仅预览，未回填</p>)}</div>}
    {suppressed.length>0&&<><p>{suppressed.length} 个课前 / 课后通勤已由人工停用。</p><button disabled={busy} onClick={()=>void run(()=>onMutation({type:'restoreCommute',edges:suppressed.map(s=>s.sourceKey)}))}>恢复这些课程的自动通勤</button></>}
  </section>;
}
