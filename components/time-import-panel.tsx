"use client";

import {useEffect, useMemo, useState} from 'react';
import {
  categoryIdFromLabel,
  normalizeTimetable,
  parseChineseTime,
  parseGarminFile,
  parseTimetableFile,
  recognizeTimetableImage,
  normalizeTimetableOcrResult,
  type ImportCandidate,
  type ImportIssue,
  type OcrBlock,
  type TimetablePeriod,
  type TimetableColumnMap,
} from '@/lib/time-imports';
import './time-import-panel.css';
import {extractTimetableLayout,detectTimetableRegions} from '@/lib/time-ocr-layout';

export type TimeImportPanelProps = {
  onPreview: (items: ImportCandidate[], source: string) => void;
  now?: Date | string;

};

type ImportMode = 'text' | 'timetable' | 'garmin';

type TesseractGlobal = {
  recognize?: (image: unknown, language?: string, options?: unknown) => Promise<unknown>;
  createWorker?: (language?: string, oem?: number, options?: unknown) => Promise<{recognize: (image: unknown, params?: unknown, options?: unknown) => Promise<unknown>; terminate?: () => Promise<unknown>}>;
};

type XlsxGlobal = {
  read: (data: ArrayBuffer, options: {type: 'array'}) => {SheetNames: string[]; Sheets: Record<string, unknown>};
  utils: {sheet_to_json: (sheet: unknown, options: {header: number; raw: boolean; defval: string}) => unknown};
};

const CATEGORY_LABELS: Record<string, string> = {
  sleep: '睡眠',
  class: '上课',
  study: '专注学习',
  exercise: '运动',
  meeting: '会议',
  commute: '通勤',
  meal: '用餐',
  entertainment: '娱乐',
  buffer: '缓冲',
  free: '自由时间',
  other: '其他',
};

function periodText(periods: readonly TimetablePeriod[]): string {
  return periods.map((period) => `${period.index}=${period.start}-${period.end}`).join(',');
}

function parsePeriods(text: string): TimetablePeriod[] {
  return text
    .split(/[,，\n;]/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const match = part.match(/^(\d+)\s*[=:：]\s*(\d{1,2}(?::\d{1,2})?)\s*[-—~～]\s*(\d{1,2}(?::\d{1,2})?)$/u);
      if (!match) return [];
      return [{index: Number(match[1]), start: toClock(match[2]), end: toClock(match[3])}];
    });
}

function parseDateColumns(text: string): Array<{date: string; x0: number; x1: number}> {
  return text.split(/[,，\n;]/u).map((part) => {
    const match = part.trim().match(/^([^@]+)@\s*(\d+(?:\.\d+)?)\s*[-—]\s*(\d+(?:\.\d+)?)$/u);
    return match ? {date: match[1].trim(), x0: Number(match[2]), x1: Number(match[3])} : undefined;
  }).filter((value): value is {date: string; x0: number; x1: number} => Boolean(value));
}

function parsePeriodRows(text: string): Array<{period: string; y0: number; y1: number}> {
  return text.split(/[,，\n;]/u).map((part) => {
    const match = part.trim().match(/^([^@]+)@\s*(\d+(?:\.\d+)?)\s*[-—]\s*(\d+(?:\.\d+)?)$/u);
    return match ? {period: match[1].trim(), y0: Number(match[2]), y1: Number(match[3])} : undefined;
  }).filter((value): value is {period: string; y0: number; y1: number} => Boolean(value));
}

function toClock(value: string): string {
  const [hour, minute = '0'] = value.split(/:|：/u);
  return `${Number(hour).toString().padStart(2, '0')}:${Number(minute).toString().padStart(2, '0')}`;
}

function ocrRows(text: string): readonly (readonly unknown[])[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t+|\s*\|\s*|\s{2,}/u).map((cell) => cell.trim()));
}

function issueText(issues: readonly ImportIssue[]): string[] {
  return issues.map((item) => item.message);
}

function globalTesseract(): TesseractGlobal | undefined {
  const candidate = (globalThis as unknown as {Tesseract?: TesseractGlobal}).Tesseract;
  return candidate;
}

async function recognizeWithBrowserWorker(image: Blob | ArrayBuffer | Uint8Array): Promise<unknown> {
  await loadVendorScript('/vendor/tesseract/tesseract.min.js', () => Boolean(globalTesseract()));
  const tesseract = globalTesseract();
  if (!tesseract) throw new Error('未加载 Tesseract.js；请在本地构建中注入 chi_sim Worker，或改用文字/CSV预览');
  if (tesseract.createWorker) {
    const worker = await tesseract.createWorker('chi_sim', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract-core',
      langPath: '/vendor/tessdata',
    });
    try {
      const raster=await readImageRaster(image instanceof Blob?image:new Blob([image as ArrayBuffer]));
      const canvas=document.createElement('canvas');canvas.width=raster.width;canvas.height=raster.height;canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(raster.rgba),raster.width,raster.height),0,0);
      const regions=detectTimetableRegions(raster.width,raster.height,raster.rgba);
      if(!regions.length)return await worker.recognize(image,{}, {blocks:true});
      const crop=async(box:{x0:number;y0:number;x1:number;y1:number},invert=false)=>{
        const part=document.createElement('canvas');part.width=Math.ceil(box.x1-box.x0);part.height=Math.ceil(box.y1-box.y0);const ctx=part.getContext('2d')!;ctx.drawImage(canvas,box.x0,box.y0,part.width,part.height,0,0,part.width,part.height);
        if(invert){const data=ctx.getImageData(0,0,part.width,part.height);const samples=[];for(let i=0;i<data.data.length;i+=16)samples.push((data.data[i]+data.data[i+1]+data.data[i+2])/3);samples.sort((a,b)=>a-b);const threshold=samples[Math.floor(samples.length*.5)]+10;for(let i=0;i<data.data.length;i+=4){const gray=(data.data[i]+data.data[i+1]+data.data[i+2])/3>threshold?0:255;data.data[i]=data.data[i+1]=data.data[i+2]=gray;}ctx.putImageData(data,0,0);}
        return normalizeTimetableOcrResult(await worker.recognize(part,{}, {blocks:true}));
      };
      const courseTop=Math.min(...regions.map(r=>r.y0)),courseLeft=Math.min(...regions.map(r=>r.x0));
      const header=await crop({x0:0,y0:0,x1:raster.width,y1:courseTop});
      const gutter=await crop({x0:0,y0:0,x1:courseLeft,y1:raster.height});
      const courses=[];
      for(const box of regions){const result=await crop(box,true);courses.push({text:result.text,bbox:box,confidence:result.blocks.length?result.blocks.reduce((s,b)=>s+(b.confidence||0),0)/result.blocks.length:0});}
      return {data:{text:[header.text,gutter.text,...courses.map(c=>c.text)].join('\n'),blocks:[...header.blocks,...gutter.blocks],regions:courses}};
    } finally { if (worker.terminate) await worker.terminate(); }
  }
  if (tesseract.recognize) return tesseract.recognize(image, 'chi_sim', {blocks: true});
  throw new Error('Tesseract.js 未提供 recognize/createWorker');
}

const scriptLoads = new Map<string, Promise<void>>();

function loadVendorScript(src: string, ready: () => boolean): Promise<void> {
  if (ready()) return Promise.resolve();
  const existing = scriptLoads.get(src);
  if (existing) return existing;
  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error(`浏览器端资源 ${src} 仅可在页面中加载`));
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = src;
    script.onload = () => ready() ? resolve() : reject(new Error(`资源 ${src} 已加载但全局对象不可用`));
    script.onerror = () => reject(new Error(`无法加载本地资源 ${src}；请检查 vendor 文件`));
    document.head.appendChild(script);
  });
  scriptLoads.set(src, promise);
  return promise;
}

function globalXlsx(): XlsxGlobal | undefined {
  return (globalThis as unknown as {XLSX?: XlsxGlobal}).XLSX;
}

async function parseXlsxInBrowser(file: File, options: Parameters<typeof normalizeTimetable>[1]) {
  await loadVendorScript('/vendor/xlsx.full.min.js', () => Boolean(globalXlsx()));
  const xlsx = globalXlsx();
  if (!xlsx) throw new Error('未加载 SheetJS；请检查 /vendor/xlsx.full.min.js');
  const workbook = xlsx.read(await file.arrayBuffer(), {type: 'array'});
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel 文件没有工作表');
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1, raw: false, defval: ''});
  if (!Array.isArray(rows)) throw new Error('Excel 工作表无法转换为行');
  return normalizeTimetable(rows as readonly (readonly unknown[])[], options);
}

async function readImageRaster(file: Blob): Promise<{width: number; height: number; rgba: Uint8ClampedArray}> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error('当前浏览器不支持本地图片栅格读取');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) { bitmap.close(); throw new Error('无法创建本地图片画布'); }
  context.drawImage(bitmap, 0, 0);
  const rgba = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const result = {width: bitmap.width, height: bitmap.height, rgba};
  bitmap.close();
  return result;
}

function initialPeriodText(): string {
  return periodText([
    {index: 1, start: '08:00', end: '08:45'},
    {index: 2, start: '08:55', end: '09:40'},
    {index: 3, start: '10:00', end: '10:45'},
    {index: 4, start: '10:55', end: '11:40'},
    {index: 5, start: '13:30', end: '14:15'}, {index: 6, start: '14:25', end: '15:10'},
    {index: 7, start: '15:30', end: '16:15'}, {index: 8, start: '16:25', end: '17:10'},
    {index: 9, start: '18:20', end: '19:05'}, {index: 10, start: '19:06', end: '19:50'},
    {index: 11, start: '20:00', end: '20:45'}, {index: 12, start: '20:46', end: '21:30'},
  ]);
}

export function TimeImportPanel({onPreview, now}: TimeImportPanelProps) {
  const [mode, setMode] = useState<ImportMode>('text');
  const [text, setText] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [weekStart, setWeekStart] = useState('');
  const [weekEnd, setWeekEnd] = useState('');
  const [periodsText, setPeriodsText] = useState(initialPeriodText);
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [lastFile,setLastFile]=useState<File|null>(null);
  const [mapping,setMapping]=useState<Record<string,string>>({});
  const [semesterEnabled,setSemesterEnabled]=useState(false);
  const [semesterStart,setSemesterStart]=useState('');
  const [fromWeek,setFromWeek]=useState('');
  const [toWeek,setToWeek]=useState('');
  const [parity,setParity]=useState<'all'|'odd'|'even'>('all');
  const [ocrBlocks, setOcrBlocks] = useState<OcrBlock[]>([]);
  const [ocrImageUrl, setOcrImageUrl] = useState('');
  const [ocrImageSize, setOcrImageSize] = useState({width: 1, height: 1});
  const [dateColumnsText, setDateColumnsText] = useState('');
  const [periodRowsText, setPeriodRowsText] = useState('');
  const periods = useMemo(() => parsePeriods(periodsText), [periodsText]);

  useEffect(() => () => {
    if (ocrImageUrl) URL.revokeObjectURL(ocrImageUrl);
  }, [ocrImageUrl]);

  function updateItem(index: number, patch: Partial<ImportCandidate>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? {...item, ...patch} : item));
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function previewText() {
    const result = parseChineseTime(text, now);
    setItems(result.items);
    setIssues(result.issues);
    setSource('text:chinese-time');
  }

  function previewOcrRows() {
    const rows = ocrRows(ocrText);
    const result = normalizeTimetable({rows,headers:['date','period','course','note']}, {
      source: fileName || 'timetable-ocr',
      weekStart: weekStart || undefined,
      weekEnd: weekEnd || undefined,
      periods,
      columnMap: {date: 0, period: 1, course: 2, note: 3},
    });
    setItems(result.items);
    setIssues(result.issues);
    setSource(`timetable:${fileName || 'ocr'}`);
  }

  async function handleFile(file: File) {
    setBusy(true);setIssues([]);setItems([]);
    setFileName(file.name);setLastFile(file);
    if(file.size>20*1024*1024){setIssues([{level:'error',code:'file_too_large',message:'文件超过20MB，请裁剪或拆分后重试'}]);setBusy(false);return;}
    setSource(file.name);
    try {
      if (/^image\//u.test(file.type) || /\.(png|jpe?g|webp|bmp)$/iu.test(file.name)) {
        if(!weekStart)throw new Error('请先填写截图对应周的周一日期，再选择或重新解析图片');
        const ocr = await recognizeTimetableImage(file, recognizeWithBrowserWorker);
        setOcrBlocks(ocr.blocks);
        setOcrImageUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return URL.createObjectURL(file);
        });
        if (ocr.blocks.length) {
          try {
            const raster = await readImageRaster(file);
            setOcrImageSize({width: raster.width, height: raster.height});
            const manualColumns=parseDateColumns(dateColumnsText);
            const manualPeriods=parsePeriodRows(periodRowsText).map(p=>({index:Number(p.period),y0:p.y0,y1:p.y1,...periods.find(x=>x.index===Number(p.period))}));
            const layout = extractTimetableLayout({...raster,blocks:ocr.blocks,courseBlocks:ocr.regions,weekStart:weekStart||undefined,columns:manualColumns.length?manualColumns:undefined,periods:manualPeriods.length?manualPeriods:undefined});
            const inferredPeriods=layout.periods.filter(p=>p.start&&p.end).map(p=>({index:p.index,start:p.start!,end:p.end!}));
            const knownPeriods=inferredPeriods.length?inferredPeriods:periods;
            if(inferredPeriods.length)setPeriodsText(periodText(inferredPeriods));
            if(layout.columns.length)setDateColumnsText(layout.columns.map(c=>c.date+'@'+c.x0+'-'+c.x1).join(','));
            if(layout.periods.length)setPeriodRowsText(layout.periods.map(p=>p.index+'@'+p.y0+'-'+p.y1).join(','));
            setOcrBlocks(layout.rows.map((row,index)=>({text:row.course,confidence:row.confidence*100,bbox:row.bbox,blockId:String(index)})));

            const rows = layout.rows.filter((row) => !row.nonCurrentWeek).map((row) => ({date: row.date, period: row.period, course: row.course, note: row.note ?? ''}));
            const normalized = normalizeTimetable(rows, {source: file.name, weekStart: weekStart || undefined, weekEnd: weekEnd || undefined, periods:knownPeriods, columnMap: {date: 'date', period: 'period', course: 'course', note: 'note'}});
            setItems(normalized.items);
            setIssues([...ocr.issues, ...(layout.issues ?? []), ...normalized.issues]);
            setOcrText(rows.map((row) => [row.date, row.period, row.course, row.note].join('\t')).join('\n'));
            setMode('timetable');
            return;
          } catch (cause) {
            setIssues([...ocr.issues, {level: 'warning', code: 'ocr_layout_failed', message: `图像课程块布局识别失败，已保留 OCR 结果供校对：${cause instanceof Error ? cause.message : String(cause)}`}]);
          }
        }
        setOcrText(ocr.text);
        setIssues(ocr.issues);
        setMode('timetable');
        setItems([]);
        return;
      }
      if (mode === 'garmin' || /garmin|sleep|睡眠/iu.test(file.name)) {
        const result = parseGarminFile(await file.text(), {name: file.name});
        setItems(result.items);
        setIssues(result.issues);
        setMode('garmin');
        return;
      }
      const normalizeOptions = {
        source: file.name,
        columnMap:Object.fromEntries(Object.entries(mapping).filter(([,v])=>v.trim())) as TimetableColumnMap,
        semester:semesterEnabled?{startDate:semesterStart,fromWeek:Number(fromWeek),toWeek:Number(toWeek),parity,periods}:undefined,
        weekStart: weekStart || undefined,
        weekEnd: weekEnd || undefined,
        periods,
      };
      if (/\.xlsx?$/iu.test(file.name)) {
        const result = await parseXlsxInBrowser(file, normalizeOptions);
        setItems(result.items);
        setIssues(result.issues);
      } else {
        const result = await parseTimetableFile({name: file.name, type: file.type, text: await file.text()}, normalizeOptions);
        setItems(result.items);
        setIssues(result.issues);
      }
      setMode('timetable');
    } catch (cause) {
      setItems([]);
      setIssues([{level: 'error', code: 'file_failed', message: cause instanceof Error ? cause.message : String(cause)}]);
    } finally {
      setBusy(false);
    }
  }

  function validateItems(): ImportIssue[] {
    const result: ImportIssue[] = [];
    items.forEach((item, index) => {
      if (!Number.isFinite(Date.parse(item.start)) || !Number.isFinite(Date.parse(item.end))) result.push({level: 'error', code: 'candidate_time_missing', message: `第 ${index + 1} 条候选缺少起止时间`, row: index + 1});
      else if (Date.parse(item.end) <= Date.parse(item.start)) result.push({level: 'error', code: 'candidate_range_invalid', message: `第 ${index + 1} 条候选结束时间不晚于开始时间`, row: index + 1});
      if (!item.categoryId) result.push({level: 'error', code: 'candidate_category_missing', message: `第 ${index + 1} 条候选缺少分类`, row: index + 1});
    });
    return result;
  }

  function confirmPreview() {
    if(issues.some(item=>item.level==='error'))return;
    const validation = validateItems();
    if (validation.length) {
      setIssues(validation);
      return;
    }
    onPreview(items, source || `time-import:${mode}`);
  }

  return (
    <section className="ti-panel" aria-label="时间导入预览">
      <div className="ti-header">
        <div>
          <p className="ti-eyebrow">LOCAL IMPORT / PREVIEW</p>
          <h2>录入时间</h2>
          <p className="ti-subtitle">先解析、校对，再交给看板确认。导入不会直接写入云端。</p>
        </div>
        <span className="ti-source-state">{busy ? '解析中…' : items.length ? `${items.length} 条待校对` : '等待输入'}</span>
      </div>

      <div className="ti-tabs" role="tablist" aria-label="导入方式">
        <button type="button" role="tab" aria-selected={mode === 'text'} className={mode === 'text' ? 'is-active' : ''} onClick={() => setMode('text')}>中文时间</button>
        <button type="button" role="tab" aria-selected={mode === 'timetable'} className={mode === 'timetable' ? 'is-active' : ''} onClick={() => setMode('timetable')}>课表截图 / 文件</button>
        <button type="button" role="tab" aria-selected={mode === 'garmin'} className={mode === 'garmin' ? 'is-active' : ''} onClick={() => setMode('garmin')}>Garmin 睡眠</button>
      </div>

      {mode === 'text' && <div className="ti-form-block">
        <label className="ti-field">时间段文字
          <textarea value={text} onChange={(event) => setText(event.currentTarget.value)} placeholder="例如：今天14:10到15:35学习；昨晚23:50到今天7:10睡觉" rows={3} />
        </label>
        <button type="button" className="ti-button ti-button-primary" onClick={previewText}>生成预览</button>
      </div>}

      {mode === 'timetable' && <div className="ti-form-block">
        <label className="ti-file-button">选择课表截图、CSV、TSV 或 JSON
          <input type="file" accept="image/*,.csv,.tsv,.json,.xlsx,.xls" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void handleFile(file); }} />
        </label>
        <div className="ti-grid-2">
          <label className="ti-field">当前周起始日<input type="date" value={weekStart} onChange={(event) => setWeekStart(event.currentTarget.value)} /></label>
          <label className="ti-field">当前周结束日<input type="date" value={weekEnd} onChange={(event) => setWeekEnd(event.currentTarget.value)} /></label>
        </div>
        <label className="ti-field">节次表示例（请核对真实起止，课间留空）<input value={periodsText} onChange={(event) => setPeriodsText(event.currentTarget.value)} placeholder="1=08:00-08:45,2=08:55-09:40" /></label>
        <div className="ti-grid-2">
          <label className="ti-field">日期列映射（可选）<input value={dateColumnsText} onChange={(event) => setDateColumnsText(event.currentTarget.value)} placeholder="2026-09-21@100-220,2026-09-22@221-340" /></label>
          <label className="ti-field">节次行映射（可选）<input value={periodRowsText} onChange={(event) => setPeriodRowsText(event.currentTarget.value)} placeholder="1@80-140,2@141-200" /></label>
        </div>
        <details><summary>Excel 列映射 / 学期展开</summary><p>默认按表头识别。需要调整时填写文件里的列名；学期展开使用“星期”列。</p><div className="ti-grid-2">{[['date','日期列'],['weekday','星期列'],['period','节次列'],['course','课程列'],['note','备注列']].map(([key,label])=><label className="ti-field" key={key}>{label}<input value={mapping[key]||''} onChange={e=>setMapping({...mapping,[key]:e.target.value})} placeholder="留空自动识别"/></label>)}</div><label><input type="checkbox" checked={semesterEnabled} onChange={e=>setSemesterEnabled(e.target.checked)}/>按明确的学期参数展开文件（截图仍仅本周）</label>{semesterEnabled&&<div className="ti-grid-2"><label className="ti-field">第一周周一<input type="date" value={semesterStart} onChange={e=>setSemesterStart(e.target.value)}/></label><label className="ti-field">开始周次<input type="number" min="1" max="30" value={fromWeek} onChange={e=>setFromWeek(e.target.value)}/></label><label className="ti-field">结束周次<input type="number" min="1" max="30" value={toWeek} onChange={e=>setToWeek(e.target.value)}/></label><label className="ti-field">单双周<select value={parity} onChange={e=>setParity(e.target.value as typeof parity)}><option value="all">每周</option><option value="odd">单周</option><option value="even">双周</option></select></label></div>}<a href="/time-timetable-template.csv" download>下载 Excel 可打开的 CSV 模板</a></details>
        {lastFile&&<button type="button" disabled={busy} onClick={()=>void handleFile(lastFile)}>按当前映射重新解析 {lastFile.name}</button>}
        <p className="ti-hint">OCR 结果会显示在下方文本框。请按“日期｜节次｜课程｜备注”逐行修正；标注“非本周”的行会排除。</p>
        {ocrImageUrl && ocrBlocks.length > 0 && <div className="ti-ocr-viewport" aria-label="OCR 位置块预览">
          <img src={ocrImageUrl} alt="待校对的课表截图" />
          {ocrBlocks.map((block, index) => {
            const box = block.bbox;
            if (!box) return null;
            const left = Math.max(0, (box.x0 / ocrImageSize.width) * 100);
            const top = Math.max(0, (box.y0 / ocrImageSize.height) * 100);
            const width = Math.max(1, ((box.x1 - box.x0) / ocrImageSize.width) * 100);
            const height = Math.max(1, ((box.y1 - box.y0) / ocrImageSize.height) * 100);
            return <span key={block.blockId ?? index} className={block.confidence !== undefined && block.confidence < 60 ? 'ti-ocr-box is-low' : 'ti-ocr-box'} style={{left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`}} title={`${block.text}${block.confidence === undefined ? '' : ` · ${Math.round(block.confidence)}%`}`} />;
          })}
        </div>}
        {ocrText && <>
          <label className="ti-field">OCR 文字（可编辑）<textarea value={ocrText} onChange={(event) => setOcrText(event.currentTarget.value)} rows={7} /></label>
          <button type="button" className="ti-button ti-button-primary" onClick={previewOcrRows}>按校正内容生成预览</button>
        </>}
      </div>}

      {mode === 'garmin' && <div className="ti-form-block">
        <label className="ti-file-button">选择 Garmin 导出的 CSV 或 JSON（只读睡眠区间）
          <input type="file" accept=".csv,.json,application/json,text/csv" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void handleFile(file); }} />
        </label>
        <p className="ti-hint">首次中国区登录、MFA 和本机 token 由同步器处理；网页端只接收必要的睡眠起止区间。没有起止范围的总时长不会被编造成点阵。</p>
      </div>}

      {issues.length > 0 && <div className="ti-issues" role="status">
        {issueText(issues).map((message, index) => <p key={`${message}-${index}`} className={issues[index]?.level === 'error' ? 'is-error' : 'is-warning'}>{message}</p>)}
      </div>}

      {items.length > 0 && <div className="ti-preview">
        <div className="ti-preview-heading"><span>候选预览</span><small>每一行都可以在确认前修正</small></div>
        <div className="ti-preview-table" role="table" aria-label="时间候选预览">
          {items.map((item, index) => <div className="ti-preview-row" role="row" key={item.sourceKey}>
            <input aria-label={`第${index + 1}条开始`} value={item.start} onChange={(event) => updateItem(index, {start: event.currentTarget.value})} />
            <input aria-label={`第${index + 1}条结束`} value={item.end} onChange={(event) => updateItem(index, {end: event.currentTarget.value})} />
            <select aria-label={`第${index + 1}条分类`} value={item.categoryId} onChange={(event) => updateItem(index, {categoryId: event.currentTarget.value})}>
              {Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              {!CATEGORY_LABELS[item.categoryId] && <option value={item.categoryId}>{item.categoryId}</option>}
            </select>
            <input aria-label={`第${index + 1}条备注`} value={item.note} onChange={(event) => updateItem(index, {note: event.currentTarget.value})} />
            <button type="button" className="ti-remove" onClick={() => removeItem(index)} aria-label={`删除第${index + 1}条`}>删除</button>
          </div>)}
        </div>
        <div className="ti-preview-actions">
          <button type="button" className="ti-button" onClick={() => setItems([])}>清空预览</button>
          <button type="button" className="ti-button ti-button-primary" disabled={busy||issues.some(item=>item.level==='error')} onClick={confirmPreview}>交给看板确认</button>
        </div>
      </div>}

      <p className="ti-footnote">分类颜色不表示效率或好坏；“计划”与“实际”在确认时仍会分开保存。</p>
    </section>
  );
}

export {categoryIdFromLabel};
