'use client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { FinanceClient } from '../lib/finance-client';
import type { FinanceReport } from '../lib/finance-report-data';
import { buildFinanceReport } from '../lib/finance-report-data';
import { chartMonthBounds, shiftDay } from '../lib/finance-chart-data';
import { Dialog } from './finance-ui';

const Preview = lazy(() => import('./finance-pdf-preview'));
export default function FinanceExportDialog({ client, month, onClose }: { client: FinanceClient; month: string; onClose: () => void }) {
  const [period, setPeriod] = useState('month'), [selectedMonth, setSelectedMonth] = useState(month), [year, setYear] = useState(month.slice(0, 4));
  const initial = chartMonthBounds(month);
  const [from, setFrom] = useState(initial.from), [end, setEnd] = useState(shiftDay(initial.to, -1));
  const [draft, setDraft] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; report: FinanceReport }>();
  const worker = useRef<Worker>(null), attempt = useRef(0), busy = useRef(false), objectUrl = useRef('');
  const generating = !!status && !result && !error;
  const discard = () => {
    attempt.current++; busy.current = false; worker.current?.terminate(); worker.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = ''; setResult(undefined); setStatus(''); setError('');
  };
  const close = () => { discard(); onClose(); };
  useEffect(() => () => {
    attempt.current++; worker.current?.terminate();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);
  const generate = async (wait: boolean) => {
    if (busy.current) return;
    discard(); busy.current = true;
    const id = attempt.current;
    setStatus(wait ? '正在等待账本同步…' : '正在冻结报表快照…');
    try {
      if (wait) await client.sync();
      if (id !== attempt.current) return;
      const snapshot = await client.reportSnapshot(wait ? false : draft);
      if (id !== attempt.current) return;
      const range = period === 'month' ? chartMonthBounds(selectedMonth) : period === 'year' ? { from: `${year}-01-01`, to: `${Number(year) + 1}-01-01` } : { from, to: shiftDay(end, 1) };
      const report = buildFinanceReport(snapshot.state, range, snapshot.metadata);
      setStatus('正在载入字体并排版两页报告…');
      const w = new Worker(new URL('../lib/finance-report-worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      w.onerror = (event) => { if (id === attempt.current) { setError('PDF生成失败：' + (event.message || '生成任务无法载入，请重试')); setStatus(''); busy.current = false; w.terminate(); } };
      w.onmessage = e => {
        if (id !== attempt.current) return;
        if (e.data.status === 'rendering') setStatus('正在生成PDF…');
        if (e.data.status === 'error') { setError('PDF生成失败：' + e.data.message); setStatus(''); busy.current = false; w.terminate(); }
        if (e.data.status === 'done') {
          const blob = e.data.blob as Blob, url = URL.createObjectURL(blob);
          objectUrl.current = url; setResult({ blob, url, report }); setStatus('正在加载两页预览…'); busy.current = false; w.terminate(); worker.current = null;
        }
      };
      w.postMessage({ report, origin: window.location.origin });
    } catch (e) {
      if (id === attempt.current) { setError((e as Error).message); setStatus(''); busy.current = false; }
    }
  };
  const download = () => {
    if (!result) return;
    const a = document.createElement('a'); a.href = result.url;
    a.download = `生活账本-${result.report.space === 'demo' ? '演示' : '个人'}-${result.report.from}-${shiftDay(result.report.to, -1)}${result.report.localDraft ? '-本地草稿' : ''}.pdf`;
    a.click();
  };
  return <Dialog title="导出PDF报告" description="A4横向 · 两页摘要与重点明细" wide onClose={close}>
    {!result && <>
      <p className="f-hint">当前账本：{client.space === 'demo' ? '演示' : '个人'} · 人民币 · 日期含结束日</p>
      <fieldset className="f-pdf-config" disabled={generating}>
        <label>报告范围<select value={period} onChange={e => setPeriod(e.target.value)}><option value="month">按月</option><option value="year">按年</option><option value="custom">自定义日期</option></select></label>
        {period === 'month' && <label>月份<input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} required /></label>}
        {period === 'year' && <label>年份<input type="number" min="1900" max="9998" value={year} onChange={e => setYear(e.target.value)} required /></label>}
        {period === 'custom' && <><label>开始日期<input type="date" value={from} onChange={e => setFrom(e.target.value)} required /></label><label>结束日期（含）<input type="date" value={end} onChange={e => setEnd(e.target.value)} required /></label></>}
      </fieldset>
      {client.pending.length > 0 && <div className="f-pdf-pending"><p>还有 {client.pending.length} 笔编辑待同步。可等待同步后生成，或导出带本地草稿标记的快照。</p><label><input type="checkbox" checked={draft} disabled={generating} onChange={e => setDraft(e.target.checked)} /> 明确导出含本地草稿的快照</label></div>}
      <div className="f-dialog-actions">
        {client.pending.length > 0 && <button disabled={generating} onClick={() => void generate(true)}>等待同步并预览</button>}
        <button className="f-primary" disabled={generating || (client.pending.length > 0 && !draft)} onClick={() => void generate(false)}>{error ? '重试生成' : '生成预览'}</button>
        <button onClick={close}>{generating ? '取消生成' : '取消'}</button>
      </div>
    </>}
    {status && <output aria-live="polite">{status}</output>}
    {error && <p role="alert" className="f-pdf-error">{error}</p>}
    {result && <>
      <div className="f-dialog-actions"><button className="f-primary" onClick={download}>下载PDF</button><a href={result.url} target="_blank" rel="noreferrer">打开PDF</a><button onClick={discard}>调整范围</button><button onClick={close}>完成</button></div>
      <p className="f-hint">预览与下载使用同一份冻结快照 · 版本 {result.report.snapshotVersion}{result.report.localDraft ? ` · 含 ${result.report.pendingCount} 笔本地草稿` : ''}</p>
      <Suspense fallback={<output>正在载入PDF预览…</output>}><Preview blob={result.blob} onReady={() => setStatus('')} /></Suspense>
    </>}
  </Dialog>;
}
