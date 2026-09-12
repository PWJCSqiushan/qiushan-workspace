'use client';

import {useEffect, useMemo, useState} from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {FLOWS, today} from '@/lib/domain';
import {api} from '@/lib/client-sync';
import type {AnalyticsBucket, AnalyticsResult} from '@/lib/analytics';

type Space = 'personal' | 'demo';
type RangePreset = 'today' | '7' | '30' | '90' | 'custom';

export type AnalyticsDashboardProps = {
  space: Space;
  revision: number;
  syncStatus: string;
};

const rangeLabels: Record<Exclude<RangePreset, 'custom'>, string> = {
  today: '今天',
  '7': '近 7 天',
  '30': '近 30 天',
  '90': '近 90 天',
};

const bucketLabels: Record<AnalyticsBucket, string> = {
  day: '按日',
  week: '按周',
  month: '按月',
};

function shiftDay(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
}

function dateLabel(value: string, bucket: AnalyticsBucket): string {
  if (bucket === 'month') return value.slice(0, 7);
  if (bucket === 'week') return `${value.slice(5)} 周`;
  return value.slice(5);
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function requestDates(range: RangePreset, customFrom: string, customTo: string, now: string): {from: string; to: string} {
  if (range === 'custom') return {from: customFrom, to: customTo};
  const days = range === 'today' ? 1 : Number(range);
  return {from: shiftDay(now, -(days - 1)), to: now};
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : '暂时无法读取统计数据，请稍后重试。';
}

function metricValue(value: number): string {
  return value.toLocaleString('zh-CN');
}

export function AnalyticsDashboard({space, revision, syncStatus}: AnalyticsDashboardProps) {
  const now = today();
  const [range, setRange] = useState<RangePreset>('7');
  const [customFrom, setCustomFrom] = useState(() => shiftDay(now, -6));
  const [customTo, setCustomTo] = useState(now);
  const [bucket, setBucket] = useState<AnalyticsBucket>('day');
  const [flow, setFlow] = useState('all');
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [errorState, setErrorState] = useState<{key: string; message: string} | null>(null);

  const dates = useMemo(() => requestDates(range, customFrom, customTo, now), [range, customFrom, customTo, now]);
  const validCustomRange = range !== 'custom' || Boolean(customFrom && customTo && customFrom <= customTo);
  const customRangeError = !validCustomRange ? '自定义日期范围无效，请先选择起止日期。' : '';
  const requestKey = `${space}:${revision}:${dates.from}:${dates.to}:${bucket}:${flow}`;
  const loading = validCustomRange && loadedKey !== requestKey;
  const error = errorState?.key === requestKey ? errorState.message : '';
  useEffect(() => {
    if (!validCustomRange) return;
    setResult(null);
    let active = true;
    const query = new URLSearchParams({space, from: dates.from, to: dates.to, bucket});
    if (flow !== 'all') query.set('flow', flow);
    void api<AnalyticsResult>(`/api/analytics?${query.toString()}`)
      .then((next) => {
        if (active) {
          setResult(next);
          setLoadedKey(requestKey);
          setErrorState(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setErrorState({key: requestKey, message: safeError(cause)});
          setLoadedKey(requestKey);
        }
      });
    return () => {
      active = false;
    };
  }, [requestKey, space, revision, dates.from, dates.to, bucket, flow, validCustomRange, syncStatus]);

  const visibleFlows = useMemo(
    () => result?.byFlow.filter((item) => flow === 'all' || item.id === flow) ?? [],
    [result, flow],
  );
  const pieData = useMemo(
    () => visibleFlows.filter((item) => item.completed > 0).map((item) => ({name: item.name, value: item.completed, fill: item.color})),
    [visibleFlows],
  );
  const hasActivity = Boolean(result && (result.totals.created > 0 || result.totals.completed > 0));
  const flowName = flow === 'all' ? '全部工作流' : FLOWS.find((item) => item.id === flow)?.name || '已选工作流';

  return (
    <section className="analytics-dashboard" aria-labelledby="analytics-title">
      <div className="analytics-header">
        <div>
          <p className="analytics-eyebrow">WORKSPACE ANALYTICS</p>
          <h2 id="analytics-title">统计总览</h2>
          <p className="analytics-subtitle">查看各工作流的新增、完成与每日变化。</p>
        </div>
        <div className="analytics-meta" aria-label="统计状态">
          <span>{space === 'demo' ? '演示工作台' : '正式工作台'}</span>
          <span>同步：{syncStatus || '未知'}</span>
          <span>版本：{revision}</span>
        </div>
      </div>

      <div className="analytics-controls" aria-label="统计筛选条件">
        <fieldset className="analytics-control-group">
          <legend className="analytics-control-label">时间范围</legend>
          <div className="analytics-segmented" aria-label="时间范围">
            {(Object.keys(rangeLabels) as Array<Exclude<RangePreset, 'custom'>>).map((key) => (
              <button key={key} type="button" className={range === key ? 'selected' : ''} aria-pressed={range === key} onClick={() => setRange(key)}>
                {rangeLabels[key]}
              </button>
            ))}
            <button type="button" className={range === 'custom' ? 'selected' : ''} aria-pressed={range === 'custom'} onClick={() => setRange('custom')}>
              自定义
            </button>
          </div>
        </fieldset>
        {range === 'custom' && (
          <div className="analytics-date-range">
            <label>从 <input type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.currentTarget.value)} /></label>
            <span aria-hidden="true">至</span>
            <label><span className="sr-only">结束日期</span><input type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.currentTarget.value)} /></label>
          </div>
        )}
        <label className="analytics-select-label">汇总粒度
          <select aria-label="汇总粒度" value={bucket} onChange={(event) => setBucket(event.currentTarget.value as AnalyticsBucket)}>
            {(Object.keys(bucketLabels) as AnalyticsBucket[]).map((key) => <option key={key} value={key}>{bucketLabels[key]}</option>)}
          </select>
        </label>
        <label className="analytics-select-label">工作流
          <select aria-label="统计工作流" value={flow} onChange={(event) => setFlow(event.currentTarget.value)}>
            <option value="all">全部工作流</option>
            {FLOWS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>

      {(error || customRangeError) && <div className="analytics-error" role="alert">{error || customRangeError}</div>}
      {loading && !result && validCustomRange && <output className="analytics-state">正在读取统计数据…</output>}
      {!loading && !result && !error && <div className="analytics-state">暂时没有可展示的统计数据。</div>}

      {result && (
        <>
          <div className="analytics-period-note">
            <span>{result.query.from} 至 {result.query.to} · {flowName}</span>
            <span>数据截至 {displayDate(result.generatedAt)}</span>
          </div>
          <div className="analytics-metrics" aria-label="统计指标">
            <div className="analytics-metric"><span>新增卡片</span><strong>{metricValue(result.totals.created)}</strong><small>首次创建事件</small></div>
            <div className="analytics-metric"><span>总完成次数</span><strong>{metricValue(result.totals.completed)}</strong><small>普通任务与每日打卡</small></div>
            <div className="analytics-metric"><span>普通任务完成</span><strong>{metricValue(result.totals.regular)}</strong><small>每次完成单独计数</small></div>
            <div className="analytics-metric"><span>每日例行打卡</span><strong>{metricValue(result.totals.daily)}</strong><small>同日同卡最多一次</small></div>
          </div>

          <div className="analytics-chart-grid">
            <article className="analytics-card analytics-chart-card analytics-chart-wide">
              <div className="analytics-card-heading"><div><h3>新增与完成</h3><p>按工作流对比事件数量</p></div><span>{flowName}</span></div>
              {hasActivity ? <div className="analytics-chart"><ResponsiveContainer width="100%" height={280}><BarChart data={visibleFlows} margin={{top: 8, right: 8, left: -18, bottom: 8}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--analytics-grid)" />
                <XAxis dataKey="name" tick={{fontSize: 11}} tickLine={false} axisLine={false} interval={0} angle={-16} textAnchor="end" height={56} />
                <YAxis allowDecimals={false} tick={{fontSize: 11}} tickLine={false} axisLine={false} />
                <Tooltip />
                <Legend />
                <Bar isAnimationActive={false} dataKey="created" name="新增" fill="var(--analytics-created)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="completed" name="完成" fill="var(--analytics-completed)" radius={[4, 4, 0, 0]} />
              </BarChart></ResponsiveContainer></div> : <div className="analytics-chart-empty">这段时间还没有新增或完成事件。</div>}
            </article>

            <article className="analytics-card analytics-chart-card analytics-chart-wide">
              <div className="analytics-card-heading"><div><h3>变化趋势</h3><p>{bucketLabels[result.query.bucket]}查看新增与完成</p></div><span>{result.series.length} 个统计周期</span></div>
              {hasActivity ? <div className="analytics-chart"><ResponsiveContainer width="100%" height={280}><LineChart data={result.series} margin={{top: 8, right: 8, left: -18, bottom: 8}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--analytics-grid)" />
                <XAxis dataKey="date" tickFormatter={(value: string) => dateLabel(value, result.query.bucket)} tick={{fontSize: 11}} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{fontSize: 11}} tickLine={false} axisLine={false} />
                <Tooltip labelFormatter={(value) => dateLabel(String(value), result.query.bucket)} />
                <Legend />
                <Line isAnimationActive={false} type="monotone" dataKey="created" name="新增" stroke="var(--analytics-created)" strokeWidth={2.5} dot={{r: 3}} />
                <Line isAnimationActive={false} type="monotone" dataKey="completed" name="完成" stroke="var(--analytics-completed)" strokeWidth={2.5} dot={{r: 3}} />
              </LineChart></ResponsiveContainer></div> : <div className="analytics-chart-empty">这段时间还没有新增或完成事件。</div>}
            </article>

            <article className="analytics-card analytics-chart-card analytics-chart-pie">
              <div className="analytics-card-heading"><div><h3>完成构成</h3><p>各工作流完成次数占比</p></div></div>
              {pieData.length ? <div className="analytics-pie-wrap"><ResponsiveContainer width="100%" height={250}><PieChart>
                <Pie isAnimationActive={false} data={pieData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none" />
                <Tooltip />
                <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{fontSize: '11px'}} />
              </PieChart></ResponsiveContainer></div> : <div className="analytics-chart-empty">还没有完成事件可供构成分析。</div>}
            </article>
          </div>

          <article className="analytics-card analytics-table-card">
            <div className="analytics-card-heading"><div><h3>工作流明细</h3><p>图表与下表使用同一统计口径</p></div><span>共 {result.byFlow.length} 条流</span></div>
            <div className="analytics-table-scroll"><table><caption className="sr-only">各工作流新增和完成统计</caption><thead><tr><th scope="col">工作流</th><th scope="col">新增卡片</th><th scope="col">总完成</th><th scope="col">普通任务</th><th scope="col">每日例行</th></tr></thead><tbody>{result.byFlow.map((item) => <tr key={item.id} className={flow !== 'all' && flow !== item.id ? 'muted-row' : ''}><th scope="row"><span className="analytics-flow-dot" style={{backgroundColor: item.color}} />{item.name}</th><td>{metricValue(item.created)}</td><td>{metricValue(item.completed)}</td><td>{metricValue(item.regular)}</td><td>{metricValue(item.daily)}</td></tr>)}</tbody><tfoot><tr><th scope="row">合计</th><td>{metricValue(result.totals.created)}</td><td>{metricValue(result.totals.completed)}</td><td>{metricValue(result.totals.regular)}</td><td>{metricValue(result.totals.daily)}</td></tr></tfoot></table></div>
          </article>

          <div className={`analytics-coverage ${result.coverage.incomplete || result.coverage.unknown > 0 ? 'is-incomplete' : ''}`} role="note">
            <span>历史覆盖：自 {result.coverage.since} 起</span>
            {result.coverage.incomplete ? <span>部分历史事件缺失，当前结果不代表完整历史。</span> : <span>已按北京时间日期汇总。</span>}
            {result.coverage.unknown > 0 && <span>另有 {metricValue(result.coverage.unknown)} 条历史信息缺失或归属不明；日期可核实的计入总量，归属不明的不放入九条流，日期不明的不计入趋势。</span>}
          </div>
          {loading && <output className="analytics-refreshing">正在更新统计…</output>}
        </>
      )}
    </section>
  );
}

export default AnalyticsDashboard;
