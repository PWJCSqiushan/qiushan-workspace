"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, Dispatch, FormEvent, ReactNode, SetStateAction } from 'react'
import * as echarts from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { BoardSwitch } from '@/components/board-switch'
import DecisionDashboard from './decision-dashboard'
import type { AdviceBundle, InstrumentAdvice } from './advice'
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BarChart3, Bell, BookOpen,
  BriefcaseBusiness, CalendarDays, Check, ChevronDown, CircleHelp, Clock3, CloudDownload,
  FileDown, FileUp, Gauge, HeartPulse, Landmark, LayoutDashboard, LoaderCircle, Menu,
  Plus, RefreshCw, Search, Settings2, ShieldAlert, Sparkles, Wallet, X,
} from 'lucide-react'

type Kind = 'etf' | 'stock' | 'fund' | 'index'
type Space = 'personal' | 'demo'
type Instrument = { id: string; code: string; name: string; kind: Kind; exchange: 'SH' | 'SZ' | 'OF' }
type HistoryRow = { date: string; open?: number | null; high?: number | null; low?: number | null; close: number; volume?: number | null; amount?: number | null }
type Snapshot = {
  snapshot_id: string; instrument_id: string; source?: string | null; source_url?: string | null; quote_source?: string | null; history_source?: string | null; units?: { price?: string; volume?: string; amount?: string } | null; as_of?: string | null;
  fetched_at?: string | null; status: 'fresh' | 'stale' | 'missing'; error?: string | null;
  quote?: { price?: number | null; change_pct?: number | null; open?: number | null; high?: number | null; low?: number | null; preclose?: number | null; volume?: number | null; amount?: number | null } | null;
  history?: HistoryRow[]; adjustment?: string | null; valuation_kind?: string | null;
  metrics?: { ma20?: number | null; ma60?: number | null; return_20d?: number | null; range_120d?: number | null; history_count?: number | null } | null;
  fundamentals?: { label: string; value: number | string | null; unit?: string; period?: string; source?: string; url?: string }[];
  evidence?: { id: string; title: string; url: string; source?: string; published_at?: string; kind?: string; summary?: string; note?: string }[];
  warnings?: string[];
}
type Market = {
  snapshot_id?: string; date?: string; status?: 'fresh' | 'stale' | 'missing'; fetched_at?: string; source?: string;
  sentiment_source?: string | null; sentiment_date?: string | null;
  breadth?: { up?: number | null; down?: number | null; flat?: number | null; total?: number | null; amount?: number | null } | null;
  sentiment?: { limit_up?: number | null; limit_down?: number | null; broken?: number | null; broken_rate?: number | null; max_streak?: number | null } | null;
  flow?: { northbound?: number | null; northbound_note?: string; main?: number | null; main_note?: string } | null;
  evidence?: Snapshot['evidence']; missing_fields?: string[]; warnings?: string[];
}
type Profile = { initial_capital: number; loss_limit: number; monthly_goal_min: number; monthly_goal_max: number; purpose: string; horizon: string; holdings_confirmed: boolean; commission_rate: number; minimum_commission: number; stamp_tax_rate: number; transfer_fee_rate: number }
type Report = { id?: string; report_type?: 'market' | 'diagnosis'; instrument_id?: string | null; snapshot_id?: string; conclusion?: string; score?: number | null; score_label?: string | null; strategy?: string; position_range?: string; sections?: { title: string; body: string }[]; is_stale?: boolean; created_at?: string; sources?: string[] }
type Portfolio = { initial_capital?: number | null; net_contributions?: number | null; cash?: number | null; cash_estimated?: boolean; market_value?: number | null; total_equity?: number | null; total_equity_estimated?: boolean; opening_pnl?: number | null; realized_pnl?: number | null; unrealized_pnl?: number | null; total_pnl?: number | null; total_fees?: number | null; monthly_return?: number | null; drawdown_pct?: number | null; loss_triggered?: boolean | null; valuation_complete?: boolean; positions?: { instrument_id: string; name?: string; quantity?: number; average_cost?: number | null; price?: number | null; market_value?: number | null; unrealized_pnl?: number | null; status?: string; as_of?: string | null }[]; pending?: { pending_id?: string; instrument_id?: string; name?: string; amount?: number; date?: string; notes?: string }[]; equity_curve?: { date: string; equity: number; net_contributions: number; pnl: number; drawdown_pct: number }[]; warnings?: string[] }
type AccountPosition = { instrument_id: string; quantity: number; reference_price: number; market_value: number; broker_display_cost: number | null; cost_basis_status: 'unverified' | 'verified' }
type AccountContext = { as_of: string; observed_time: string | null; source: string; broker_assets: number; broker_market_value: number; broker_available_cash: number; broker_floating_pnl: number | null; broker_day_pnl: number | null; broker_month_pnl: number | null; broker_month_return_pct: number | null; external_cash: number; external_available_hours: number | null; horizon: string; purpose: string | null; cost_note: string; notes: string; positions: AccountPosition[] }
type AccountPositionDraft = { instrument_id: string; quantity: string; reference_price: string; market_value: string; broker_display_cost: string; cost_basis_status: 'unverified' | 'verified' }
type AccountContextDraft = { as_of: string; observed_time: string; source: string; broker_assets: string; broker_market_value: string; broker_available_cash: string; broker_floating_pnl: string; broker_day_pnl: string; broker_month_pnl: string; broker_month_return_pct: string; external_cash: string; external_available_hours: string; horizon: string; purpose: string; cost_note: string; notes: string; positions: AccountPositionDraft[] }
type Opening = { date: string; cash: number; initial_equity: number; positions: { instrument_id: string; quantity: number; average_cost: number | null; broker_display_cost?: number | null; reference_price: number }[] }
type Plan = { id?: string; instrument_id: string; date: string; action: 'observe' | 'consider' | 'no_trade'; observation?: string; buy_condition?: string; exit_condition?: string; invalidation?: string; budget?: number | null; notes?: string; created_at?: string }
type Transaction = { id?: string; instrument_id?: string; kind: string; date: string; quantity?: number; price?: number; amount?: number; fees?: number; notes?: string; plan_id?: string; pending_id?: string; created_at?: string }
type Job = { id: string; status: string; progress?: number; message?: string; error?: string; started_at?: string; finished_at?: string }
type Bootstrap = { version?: number; space?: Space; owner?: string; advice?: AdviceBundle | null; profile: Profile; instruments: Instrument[]; snapshots: Record<string, Snapshot>; market: Market | null; plans: Plan[]; reports: Report[]; transactions: Transaction[]; portfolio: Portfolio; opening?: Opening | null; account_context?: AccountContext | null; jobs: Job[]; source_health: { name?: string; provider?: string; source?: string; status?: string; last_error?: string; cooldown_until?: string }[] }
type RefreshResult = { job_id?: string; status?: string; version?: number; new_version?: number; space?: Space }
type Tab = 'today' | 'diagnosis' | 'plan' | 'assets' | 'funds' | 'learn'

echarts.use([LineChart, BarChart, PieChart, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
const number = (v: unknown, digits = 2) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '待补充'
const pct = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '待补充'
const yuan = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? `¥${v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '待补充'
const priceDigits = (item?: Instrument) => item?.kind === 'etf' ? 3 : item?.kind === 'fund' ? 4 : 2
const priceText = (v: unknown, item?: Instrument) => typeof v === 'number' && Number.isFinite(v) ? item?.kind === 'index' ? `${v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 点` : `¥${v.toLocaleString('zh-CN', { minimumFractionDigits: priceDigits(item), maximumFractionDigits: priceDigits(item) })}/${item?.kind === 'stock' ? '股' : '份'}` : '待补充'
const quantityText = (v: unknown, item?: Instrument) => item?.kind === 'fund' && typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('zh-CN', { maximumFractionDigits: 6 }) : number(v, 0)
const amount = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? `${v >= 100000000 ? `${(v / 100000000).toFixed(2)} 亿` : v >= 10000 ? `${(v / 10000).toFixed(1)} 万` : number(v, 0)}` : '待补充'
const kindName: Record<Kind, string> = { etf: '场内 ETF', stock: '股票', fund: '场外基金', index: '指数' }
const kindTone = (kind: string) => kind === 'etf' ? 'tone-blue' : kind === 'fund' ? 'tone-violet' : kind === 'index' ? 'tone-teal' : 'tone-orange'
const sourceLabel = (v?: string | null) => ({missing:'待补充',manual:'手动录入',eastmoney_fund_nav:'天天基金已公布净值',eastmoney_quote:'东方财富行情',tencent_quote:'腾讯行情',eastmoney_history:'东方财富日线',tencent_history:'腾讯日线',sina_history:'新浪日线',eastmoney_limit_pools:'东方财富涨跌停池',eastmoney_market_full:'东方财富市场快照',fund_pingzhongdata:'天天基金已公布净值',fund_f10_history:'天天基金历史净值',sina_financial_summary:'新浪财报摘要',eastmoney_fund_profile:'天天基金产品概况'}[v || ''] || v || '待补充')
const statusText = (status?: string | null) => status === 'fresh' ? '新鲜' : status === 'stale' ? '缓存数据' : '待补充'
const scoreInterval = (score?: number | null) => score == null || !Number.isFinite(score) ? '分数待补充' : score < 20 ? '0–19 分区间' : score < 40 ? '20–39 分区间' : score < 60 ? '40–59 分区间' : score < 80 ? '60–79 分区间' : '80–100 分区间'
const isOldReport = (report: Report, currentSnapshotId?: string | null) => Boolean(report.is_stale || (currentSnapshotId && report.snapshot_id && report.snapshot_id !== currentSnapshotId))
const changeTone = (v?: number | null) => typeof v !== 'number' ? '' : v > 0 ? 'market-up' : v < 0 ? 'market-down' : 'market-flat'
const dateTime = (v?: string | null) => v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '时间待补充'
const isActiveJob = (status: string) => /queued|running|pending|progress|started/i.test(status)
const isFinishedJob = (status: string) => /complete|success|done|failed|error/i.test(status)
function normalizeBackups(result: unknown): { name: string; created_at: string }[] {
  if (Array.isArray(result)) return result as { name: string; created_at: string }[]
  if (result && typeof result === 'object') {
    const value = result as { backups?: unknown; items?: unknown }
    const rows = value.backups || value.items
    if (Array.isArray(rows)) return rows as { name: string; created_at: string }[]
  }
  return []
}

function accountContextDraft(context?: AccountContext | null): AccountContextDraft {
  const text = (value: number | null | undefined) => value == null ? '' : String(value)
  return context ? {
    as_of: context.as_of || '', observed_time: context.observed_time || '', source: context.source || '',
    broker_assets: text(context.broker_assets), broker_market_value: text(context.broker_market_value), broker_available_cash: text(context.broker_available_cash),
    broker_floating_pnl: text(context.broker_floating_pnl), broker_day_pnl: text(context.broker_day_pnl), broker_month_pnl: text(context.broker_month_pnl), broker_month_return_pct: text(context.broker_month_return_pct),
    external_cash: text(context.external_cash), external_available_hours: text(context.external_available_hours), horizon: context.horizon || '', purpose: context.purpose || '', cost_note: context.cost_note || '', notes: context.notes || '',
    positions: (context.positions || []).map(p => ({ instrument_id: p.instrument_id, quantity: String(p.quantity), reference_price: String(p.reference_price), market_value: String(p.market_value), broker_display_cost: text(p.broker_display_cost), cost_basis_status: p.cost_basis_status || 'unverified' })),
  } : {
    as_of: '', observed_time: '', source: '', broker_assets: '', broker_market_value: '', broker_available_cash: '', broker_floating_pnl: '', broker_day_pnl: '', broker_month_pnl: '', broker_month_return_pct: '', external_cash: '', external_available_hours: '', horizon: '', purpose: '', cost_note: '', notes: '', positions: [],
  }
}

class InvestmentApiError extends Error {
  constructor(message: string, public status: number, public payload: unknown = {}) { super(message) }
}

type ApiOptions = { space: Space; baseVersion?: number; operationId?: string; signal?: AbortSignal }

async function api<T>(path: string, init: RequestInit | undefined, options: ApiOptions): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase()
  const [pathname, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  params.set('space', options.space)
  const headers = { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  let requestBody = init?.body
  if (method !== 'GET' && method !== 'HEAD' && requestBody == null) requestBody = '{}'
  if (method !== 'GET' && method !== 'HEAD' && typeof requestBody === 'string' && headers['Content-Type']?.includes('application/json')) {
    try {
      const value = JSON.parse(requestBody) as Record<string, unknown>
      value.space = options.space
      if (options.baseVersion != null) value.base_version = options.baseVersion
      if (options.operationId) value.operation_id = options.operationId
      requestBody = JSON.stringify(value)
    } catch { /* The server will return the normal JSON validation error. */ }
  }
  const response = await fetch(`/api/investment/${pathname.replace(/^\//, '')}${params.toString() ? `?${params}` : ''}`, { ...init, method, body: requestBody, signal: options.signal, headers, cache: 'no-store', redirect: 'manual' })
  const text = await response.text()
  let body: unknown
  try { body = text ? JSON.parse(text) : {} } catch { body = text }
  if (!response.ok) {
    const detail = typeof body === 'object' && body && 'detail' in body ? String((body as { detail: unknown }).detail) : typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : typeof body === 'string' ? body : response.statusText
    throw new InvestmentApiError(detail || `请求失败 (${response.status})`, response.status, body)
  }
  return body as T
}

const newOperationId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
const abortRequest = () => { const error = new Error('请求已取消'); error.name = 'AbortError'; return error }
const isAbortRequest = (value: unknown) => Boolean(value && typeof value === 'object' && 'name' in value && (value as { name?: unknown }).name === 'AbortError')
const responseSpace = (value: unknown) => value && typeof value === 'object' && 'space' in value ? (value as { space?: unknown }).space : undefined
const investmentDraftKey = (owner: string, space: Space) => `investment/drafts/${owner}/${space}`
const investmentOutboxKey = (owner: string, space: Space) => `investment/outbox/${owner}/${space}`
type InvestmentDraftState = { planDraft: unknown; txDraft: unknown; openingDraft: unknown; accountDraft: unknown; reportInput: string; historyInput: string; orderBudget: string; selected: string; tab: Tab }
type PendingMutation = { operation_id: string; path: string; method: string; body: Record<string, unknown>; base_version: number; created_at: string; state: 'queued' | 'conflict' | 'failed'; error?: string }
function readInvestmentDraft(owner: string, space: Space): InvestmentDraftState | null {
  if (typeof window === 'undefined') return null
  try { const value = JSON.parse(window.localStorage.getItem(investmentDraftKey(owner, space)) || 'null'); return value && typeof value === 'object' ? value as InvestmentDraftState : null } catch { return null }
}
function writeInvestmentDraft(owner: string, space: Space, value: InvestmentDraftState) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(investmentDraftKey(owner, space), JSON.stringify(value)) } catch { /* The form remains usable in memory. */ }
}
function readInvestmentOutbox(owner: string, space: Space): PendingMutation[] {
  if (typeof window === 'undefined') return []
  try { const value = JSON.parse(window.localStorage.getItem(investmentOutboxKey(owner, space)) || '[]'); return Array.isArray(value) ? value.filter(item => item && typeof item.operation_id === 'string') as PendingMutation[] : [] } catch { return [] }
}
function writeInvestmentOutbox(owner: string, space: Space, value: PendingMutation[]) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(investmentOutboxKey(owner, space), JSON.stringify(value)) } catch { /* The failed request still remains visible in the form state. */ }
}

const nav: { id: Tab; label: string; icon: typeof LayoutDashboard; detail: string }[] = [
  { id: 'today', label: '今日建议', icon: LayoutDashboard, detail: '自动分析与持仓行动' },
  { id: 'diagnosis', label: '体检', icon: HeartPulse, detail: '单品数据诊断' },
  { id: 'plan', label: '预案', icon: CalendarDays, detail: '写下条件再行动' },
  { id: 'assets', label: '资产复盘', icon: Wallet, detail: '只记真实成交' },
  { id: 'funds', label: '基金', icon: Landmark, detail: 'ETF 与场外基金' },
  { id: 'learn', label: '学习', icon: BookOpen, detail: '把规则讲明白' },
]

function MarketChart({ snapshot, instrument }: { snapshot?: Snapshot; instrument?: Instrument }) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<EChartsType | null>(null)
  const rows = snapshot?.history || []
  const hasRows = rows.length > 0
  const dates = rows.map(r => r.date)
  const close = rows.map(r => r.close)
  const volume = rows.map(r => r.volume ?? null)
  const hasVolume = volume.some(value => typeof value === 'number' && Number.isFinite(value))
  const movingAverage = (days: number) => close.map((_, i) => i + 1 < days ? null : close.slice(i + 1 - days, i + 1).reduce((sum, v) => sum + v, 0) / days)
  const option = {
    animation: false, legend: { data: ['收盘', 'MA20', 'MA60', ...(hasVolume ? ['成交量'] : [])], top: 0, textStyle: { fontSize: 12, color: '#526783' } }, grid: hasVolume ? [{ left: 55, right: 12, top: 35, height: '52%' }, { left: 55, right: 12, top: '80%', height: '12%' }] : { left: 55, right: 12, top: 35, height: '70%' },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }, formatter: (raw: unknown) => {
      const items = Array.isArray(raw) ? raw : [raw]
      return items.map(value => {
        const point = value as { seriesName?: string; name?: string; value?: unknown; marker?: string }
        const shown = point.seriesName !== '成交量' ? priceText(point.value, instrument) : `${number(point.value, 0)} ${snapshot?.units?.volume || (instrument?.kind === 'index' ? '份' : '股/份')}`
        return `${point.marker || ''}${point.name || ''} ${point.seriesName || ''}：${shown}`
      }).join('<br/>')
    } },
    xAxis: [{ type: 'category', data: dates, boundaryGap: false, axisLine: { lineStyle: { color: '#dce4ef' } }, axisLabel: { color: '#71829a', fontSize: 12, formatter: (value: string) => value.slice(2), interval: Math.ceil(dates.length / 6) } }, ...(hasVolume ? [{ type: 'category' as const, gridIndex: 1, data: dates, boundaryGap: false, axisLabel: { show: false }, axisLine: { show: false } }] : [])],
    yAxis: [{ scale: true, splitLine: { lineStyle: { color: '#edf1f6' } }, axisLabel: { color: '#71829a', fontSize: 12 } }, ...(hasVolume ? [{ gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, splitLine: { show: false } }] : [])],
    dataZoom: [{ type: 'inside', xAxisIndex: hasVolume ? [0, 1] : [0] }],
    series: [
      { name: '收盘', type: 'line', data: close, showSymbol: false, lineStyle: { color: '#3766d5', width: 2.5 }, areaStyle: { color: 'rgba(55,102,213,.08)' }, smooth: false },
      { name: 'MA20', type: 'line', data: movingAverage(20), showSymbol: false, lineStyle: { color: '#ce986a', width: 1.3 } },
      { name: 'MA60', type: 'line', data: movingAverage(60), showSymbol: false, lineStyle: { color: '#9496c4', width: 1.3 } },
      ...(hasVolume ? [{ name: '成交量', type: 'bar' as const, xAxisIndex: 1, yAxisIndex: 1, data: volume.map((value, index) => ({ value, itemStyle: { color: index === 0 || close[index] === close[index - 1] ? '#8295b588' : close[index] > close[index - 1] ? '#e5394f88' : '#059b7088' } })), itemStyle: { borderRadius: [2, 2, 0, 0] } }] : []),
    ],
  }
  useEffect(() => {
    if (!host.current) return
    chart.current = echarts.init(host.current, undefined, { renderer: 'canvas' })
    const resize = () => chart.current?.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.current?.dispose(); chart.current = null }
  }, [hasRows])
  useEffect(() => { chart.current?.setOption(option, true) }, [snapshot?.snapshot_id, hasRows, close.join(','), volume.join(',')])
  if (!hasRows) return <div className="chart-empty"><BarChart3 size={18} /><span>还没有可绘制的日线数据</span><small>刷新后会显示实际价格走势；不会用示意数值填充。</small></div>
  return <div ref={host} style={{ width: '100%', height: 250 }} />
}

function EquityChart({ rows }: { rows: NonNullable<Portfolio['equity_curve']> }) {
  const host = useRef<HTMLDivElement>(null)
  const enough = rows.length >= 2
  useEffect(() => {
    if (!host.current || !enough) return
    const chart = echarts.init(host.current)
    chart.setOption({
      animation: false, color: ['#318b76', '#a9b6b2', '#c18462'],
      grid: [{ left: 65, right: 15, top: 20, height: '52%' }, { left: 65, right: 15, top: '75%', height: '17%' }],
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => number(value, 2) },
      xAxis: [{ type: 'category', data: rows.map(r => r.date), boundaryGap: false }, { type: 'category', data: rows.map(r => r.date), boundaryGap: false, gridIndex: 1, axisLabel: { show: false } }],
      yAxis: [{ type: 'value', scale: true, axisLabel: { fontSize: 12 } }, { type: 'value', gridIndex: 1, axisLabel: { formatter: '{value}%', fontSize: 12 } }],
      series: [
        { name: '账户权益（元）', type: 'line', data: rows.map(r => r.equity), showSymbol: false },
        { name: '累计净投入（元）', type: 'line', data: rows.map(r => r.net_contributions), showSymbol: false, lineStyle: { type: 'dashed' } },
        { name: '资金流中性回撤', type: 'line', data: rows.map(r => r.drawdown_pct), showSymbol: false, xAxisIndex: 1, yAxisIndex: 1 },
      ],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [enough, JSON.stringify(rows)])
  return enough ? <div ref={host} style={{ height: 300, width: '100%' }} aria-label="实际权益、净投入与回撤图" /> : <div className="chart-empty"><BarChart3 size={18} /><span>权益曲线待积累</span><small>至少需要两个完整估值日；不使用虚拟历史数据填图。</small></div>
}

const majorIndexSpecs = [
  { code: '000001', exchange: 'SH' as const, name: '上证指数' },
  { code: '399001', exchange: 'SZ' as const, name: '深证成指' },
  { code: '399006', exchange: 'SZ' as const, name: '创业板指' },
]
function MiniIndexCard({ item, snapshot, name, code }: { item?: Instrument; snapshot?: Snapshot; name: string; code: string }) {
  const rows = (snapshot?.history || []).filter(row => Number.isFinite(row.close)).slice(-60)
  const points = rows.map(row => row.close)
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1
  const coords = points.map((value, index) => `${points.length < 2 ? 50 : index / (points.length - 1) * 100},${32 - (value - min) / span * 28}`).join(' ')
  const change = snapshot?.quote?.change_pct
  return <article className={`index-card ${item ? '' : 'index-card-empty'}`}>
    <div className="index-card-top"><span>{item?.name || name}</span><small>{item?.code || code} · {item?.exchange || (code.startsWith('399') ? 'SZ' : 'SH')}</small></div>
    {item && snapshot?.quote?.price != null ? <><div className="index-quote"><b>{priceText(snapshot.quote.price, item)}</b><strong className={changeTone(change)}>{pct(change)}</strong></div>{points.length > 1 ? <svg className={`index-sparkline ${changeTone(change)}`} viewBox="0 0 100 36" preserveAspectRatio="none" aria-label={`${item.name}近${points.length}个交易日日线走势`}><polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg> : <div className="mini-chart-empty">日线数据待补充</div>}<div className="index-card-foot"><span>近 {points.length} 个交易日日线</span><span>报价日期 {snapshot.as_of || '待补充'}</span><span>{statusText(snapshot.status)}</span></div></> : <div className="mini-chart-empty">{item ? '报价待补充' : '关注该指数后展示真实走势'}</div>}
  </article>
}

function MarketBars({ title, labels, values, date, source, unit = '家', complete, independent = false }: { title: string; labels: string[]; values: (number | null | undefined)[]; date?: string; source?: string | null; unit?: string; complete?: boolean; independent?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const hasData = values.some(value => typeof value === 'number' && Number.isFinite(value))
  const showChart = hasData && (independent || (complete ?? values.every(value => typeof value === 'number' && Number.isFinite(value))))
  useEffect(() => {
    if (!host.current || !showChart) return
    const chart = echarts.init(host.current)
    chart.setOption({ animation: false, grid: { left: 12, right: 14, top: 28, bottom: 20, containLabel: true }, tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `${number(value, 0)} ${unit}` }, xAxis: { type: 'category', data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: '#dce4ee' } }, axisLabel: { color: '#52647a', fontSize: 12 } }, yAxis: { type: 'value', min: 0, axisLabel: { color: '#8090a4', fontSize: 11 }, splitLine: { lineStyle: { color: '#edf1f6' } } }, series: [{ type: 'bar', label: { show: true, position: 'top', color: '#52647a', fontSize: 12, formatter: (item: { value?: number | null }) => item.value == null ? '待补充' : `${number(item.value, 0)}${unit}` }, data: values.map((value, index) => ({ value: value == null ? null : value, itemStyle: { color: index === 0 ? '#e5394f' : index === 1 ? '#059b70' : '#8295b5', borderRadius: [5, 5, 0, 0] } })), barMaxWidth: 44 }] })
    const resize = () => chart.resize(); window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [showChart, JSON.stringify(values), labels.join('|'), unit])
  return <section className="card visualization-card"><div className="card-top"><div><div className="section-kicker">{title}</div><div className="card-sub">数据日期 {date || '待补充'} · 来源 {sourceLabel(source)}</div></div></div>{showChart ? <div className="market-bar-chart" ref={host} /> : <div className="chart-empty compact-empty"><span>{independent ? '情绪数据待补充' : hasData ? '市场宽度尚不完整' : '待补充可信数据'}</span><small>{labels.map((label, i) => `${label} ${values[i] == null ? '待补充' : `${number(values[i], 0)}${unit}`}`).join(' · ')}</small></div>}{independent && <small className="chart-footnote">各池独立统计，并非互斥分类；不能相加当全市场总数。</small>}{showChart && values.some(value => value == null) && <small className="chart-footnote">{labels.filter((_, index) => values[index] == null).join('、')}：待补充（不填 0）。</small>}</section>
}

function AllocationChart({ portfolio, pending, confirmed }: { portfolio?: Portfolio; pending?: Portfolio['pending']; confirmed: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const pendingAmounts = (pending || []).map(row => typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null)
  const allPendingKnown = pendingAmounts.every(value => value !== null)
  const ready = Boolean(confirmed && portfolio && portfolio.valuation_complete && portfolio.cash != null && portfolio.market_value != null && allPendingKnown)
  const values = ready ? [portfolio!.cash!, portfolio!.market_value!, pendingAmounts.reduce<number>((sum, value) => sum + (value ?? 0), 0)] : []
  useEffect(() => {
    if (!host.current || !ready || values.every(value => value <= 0)) return
    const chart = echarts.init(host.current)
    chart.setOption({ animation: false, color: ['#3766d5', '#32a6a0', '#a9b8ce'], tooltip: { trigger: 'item', formatter: (item: { name?: string; value?: number; percent?: number }) => `${item.name || ''}：${yuan(item.value)}（${number(item.percent, 1)}%）` }, series: [{ type: 'pie', radius: ['58%', '82%'], center: ['50%', '50%'], avoidLabelOverlap: true, label: { show: true, color: '#314258', fontSize: 12, formatter: '{b}\n{d}%' }, labelLine: { length: 10, length2: 8 }, data: [{ value: values[0]!, name: '现金' }, { value: values[1]!, name: '持仓市值' }, { value: values[2]!, name: '基金待确认' }] }] })
    const resize = () => chart.resize(); window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [ready, values.join(',')])
  const estimate = portfolio?.cash_estimated || portfolio?.total_equity_estimated
  return <section className="card allocation-card"><div className="card-top"><div><div className="section-kicker">资金配置</div><div className="card-sub">{!confirmed ? '核对账本后展示' : ready ? '已确认账本与有效估值' : '等待完整有效估值'}{ready && estimate ? ' · 含估算数据' : ''}</div></div></div>{ready && values.some(value => value > 0) ? <><div className="allocation-chart" ref={host} /><div className="allocation-legend"><span><i className="cash-dot" />现金 <b>{yuan(values[0])}</b></span><span><i className="holding-dot" />持仓市值 <b>{yuan(values[1])}</b></span><span><i className="pending-dot" />基金待确认 <b>{yuan(values[2])}</b></span></div></> : <div className="chart-empty compact-empty"><span>资金配置图暂不可用</span><small>{!confirmed ? '账本尚未确认；先登记真实初始状态，不生成推测图。' : !portfolio?.valuation_complete ? '等待完整有效估值；不会将缺失金额画成零。' : !portfolio || portfolio.cash == null || portfolio.market_value == null ? '现金或持仓市值待补充。' : !allPendingKnown ? '基金待确认金额待补充。' : '暂无可展示的账面金额。'}</small></div>}</section>
}

function AccountWeightChart({ positions, instruments }: { positions: AccountPosition[]; instruments: Instrument[] }) {
  const host = useRef<HTMLDivElement>(null)
  const rows = positions.filter(p => Number.isFinite(p.market_value) && p.market_value > 0)
  const total = rows.reduce((sum, p) => sum + p.market_value, 0)
  useEffect(() => {
    if (!host.current || !rows.length || total <= 0) return
    const chart = echarts.init(host.current)
    chart.setOption({ animation: false, color: ['#3766d5', '#32a6a0', '#8a76d6', '#e39a45', '#72a8d2', '#b58b65'], tooltip: { trigger: 'item', formatter: (item: { name?: string; value?: number; percent?: number }) => `${item.name || ''}：${yuan(item.value)}（${number(item.percent, 1)}%）` }, series: [{ type: 'pie', radius: ['56%', '78%'], center: ['50%', '50%'], label: { show: false }, labelLine: { show: false }, data: rows.map(p => ({ value: p.market_value, name: instruments.find(i => i.id === p.instrument_id)?.name || p.instrument_id })) }] })
    const resize = () => chart.resize(); window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [positions, instruments, total])
  return <div className="account-weight-visual">{rows.length ? <><div className="account-weight-chart" ref={host} /><div className="account-weight-legend">{rows.map((p, index) => { const instrument = instruments.find(i => i.id === p.instrument_id); return <div key={`${p.instrument_id}-${index}`}><i style={{ background: ['#3766d5', '#32a6a0', '#8a76d6', '#e39a45', '#72a8d2', '#b58b65'][index % 6] }} /><span><b>{instrument?.name || p.instrument_id}</b><small>{instrument?.code || p.instrument_id}</small></span><strong>{number(total ? p.market_value / total * 100 : 0, 1)}%</strong></div> })}</div></> : <div className="subtle-empty">截图持仓权重待补充；没有正数市值时不生成图表。</div>}</div>
}

function AccountContextCard({ context, instruments, lossLimit, compact = false, onEdit }: { context?: AccountContext | null; instruments: Instrument[]; lossLimit: number; compact?: boolean; onEdit: () => void }) {
  if (!context) return <section className={`card account-context-card ${compact ? 'account-context-compact' : ''}`}><div className="account-context-head"><div><div className="section-kicker">券商截图基准</div><div className="card-sub">尚未录入账户截图资料；与工作台实时行情和账本分开保存。</div></div></div><div className="account-empty-note"><CircleHelp size={16} /><span>截图基准、场外备用资金和券商报告数据未录入时保持空白，不用实时行情补造。</span></div></section>
  const cutoff = context.observed_time ? `${context.as_of} · 截图时间 ${context.observed_time}` : `${context.as_of} · 截图时间待补充`
  const risk = lossLimit > 0 && context.broker_floating_pnl != null && context.broker_floating_pnl <= -lossLimit
  return <section className={`card account-context-card ${compact ? 'account-context-compact' : ''}`}>
    <div className="account-context-head"><div><div className="section-kicker">用户账户事实 · 券商截图基准</div><div className="card-sub">{cutoff} · 来源：{context.source || '待补充'} · 不是当前实时行情</div></div><button className="button button-secondary compact" onClick={onEdit}>维护基准资料</button></div>
    <div className="account-fact-grid"><div className="account-fact primary"><span>证券账户总资产</span><b>{yuan(context.broker_assets)}</b><small>截图时点 · 非实时值</small></div><div className="account-fact"><span>券商可用现金</span><b>{yuan(context.broker_available_cash)}</b><small>仅指证券账户内</small></div><div className="account-fact"><span>截图持仓市值</span><b>{yuan(context.broker_market_value)}</b><small>券商截图口径</small></div><div className={`account-fact ${changeTone(context.broker_floating_pnl)}`}><span>券商显示浮动损益</span><b>{yuan(context.broker_floating_pnl)}</b><small>非实际成本核算结果</small></div></div>
    <div className="account-separate-grid"><div><span>券商当日盈亏</span><b className={changeTone(context.broker_day_pnl)}>{yuan(context.broker_day_pnl)}</b></div><div><span>券商当月盈亏</span><b className={changeTone(context.broker_month_pnl)}>{yuan(context.broker_month_pnl)}</b></div><div><span>券商当月收益率</span><b className={changeTone(context.broker_month_return_pct)}>{pct(context.broker_month_return_pct)}</b></div><div><span>场外备用资金</span><b>{yuan(context.external_cash)}</b><small>{context.external_available_hours == null ? '到账时限待补充' : `预计 ${number(context.external_available_hours, 0)} 小时可用`}</small></div></div>
    <div className="account-separation-note"><Landmark size={15} /><span>场外备用资金不属于券商可用现金，也不是基金持仓；不计入工作台期间盈利。期限：{context.horizon || '待补充'} · 资金用途：{context.purpose || '待补充'}</span></div>
    {!compact && <><div className="account-positions-heading"><div><div className="section-kicker">截图持仓构成</div><div className="card-sub">市值权重依据截图基准，不混入最新报价。</div></div><span className="count-pill">{context.positions.length} 项</span></div><AccountWeightChart positions={context.positions} instruments={instruments} />
      {context.positions.length > 0 && <div className="table-wrap account-positions-table"><table><thead><tr><th>标的</th><th>份额 / 股数</th><th>券商显示成本</th><th>截图参考价</th><th>截图市值</th></tr></thead><tbody>{context.positions.map((p, index) => { const item = instruments.find(i => i.id === p.instrument_id); return <tr key={`${p.instrument_id}-${index}`}><td><b>{item?.name || p.instrument_id}</b><small>{item?.code || p.instrument_id}</small></td><td>{quantityText(p.quantity, item)}</td><td>{priceText(p.broker_display_cost, item)}<small>{p.cost_basis_status === 'verified' ? '券商显示口径已核验' : '券商显示口径未核验'}</small></td><td>{priceText(p.reference_price, item)}</td><td>{yuan(p.market_value)}</td></tr> })}</tbody></table></div>}
      <div className="account-cost-note"><b>成本口径：</b>{context.cost_note || '券商显示成本可能是摊薄口径（可为负），不能替代实际买入平均成本；未知的实际成本保持待补充。'} {context.notes && <span>{context.notes}</span>}</div>
    </>}
    {risk && <div className="account-risk-alert"><ShieldAlert size={17} /><div><b>券商截图浮亏触及个人关注线</b><span>券商显示浮亏已达到 {yuan(lossLimit)} 关注线。先复盘或暂停新增风险敞口；这不是全账户累计净亏损，系统不会自动卖出。</span></div></div>}
  </section>
}

function App() {
  const [space, setSpace] = useState<Space>('personal')
  const [ready, setReady] = useState(false)
  const [owner, setOwner] = useState('')
  const [data, setData] = useState<Bootstrap | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsOpenRef = useRef(false)
  settingsOpenRef.current = settingsOpen
  const [accountEditOpen, setAccountEditOpen] = useState(false)
  const [recordFocus, setRecordFocus] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null)
  const [planDraft, setPlanDraft] = useState({ instrument_id: '', date: today, action: 'observe' as Plan['action'], observation: '', buy_condition: '', exit_condition: '', invalidation: '', budget: '', notes: '' })
  const [txDraft, setTxDraft] = useState({ kind: 'buy', instrument_id: '', date: today, quantity: '', price: '', amount: '', fees: '', notes: '', plan_id: '', pending_id: '' })
  const [openingDraft, setOpeningDraft] = useState({ date: today, cash: '', positions: [{ instrument_id: '', quantity: '', average_cost: '', reference_price: '' }], confirmed_empty: false })
  const [accountDraft, setAccountDraft] = useState<AccountContextDraft>(() => accountContextDraft())
  const [orderCheck, setOrderCheck] = useState<{ eligible: boolean; quantity: number | null; cost: number | null; reasons: string[] } | null>(null)
  const [orderBudget, setOrderBudget] = useState('')
  const [reportInput, setReportInput] = useState('')
  const [historyInput, setHistoryInput] = useState('')
  const [backupList, setBackupList] = useState<{ name: string; created_at: string }[]>([])
  const [pendingRestore, setPendingRestore] = useState<string | null>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [outbox, setOutbox] = useState<PendingMutation[]>([])
  const [jobsSeen, setJobsSeen] = useState<Job[]>([])
  const draftHydratedRef = useRef(false)
  const epochRef = useRef(0)
  const busyRef = useRef<{ epoch: number; space: Space; owner: string; label: string } | null>(null)
  const flushingOutboxRef = useRef(false)
  const versionRef = useRef(0)
  const versionSpaceRef = useRef<Space>(space)
  const refreshRotationRef = useRef(0)
  const jobsSeenRef = useRef<Job[]>([])
  useEffect(() => {
    if (versionSpaceRef.current !== space) { versionSpaceRef.current = space; versionRef.current = 0 }
    if (typeof data?.version === 'number' && data.version > versionRef.current) versionRef.current = data.version
  }, [space, data?.version])
  useEffect(() => { jobsSeenRef.current = jobsSeen }, [jobsSeen])
  const spaceRef = useRef<Space>(space)
  spaceRef.current = space
  const ownerRef = useRef('')
  ownerRef.current = owner
  const request = async <T,>(path: string, init?: RequestInit, operationId?: string, baseVersionOverride?: number): Promise<T> => {
    const method = (init?.method || 'GET').toUpperCase()
    const id = operationId || (method === 'GET' ? undefined : newOperationId())
    const baseVersion = baseVersionOverride ?? versionRef.current
    const requestEpoch = epochRef.current
    const targetSpace = space
    const targetOwner = ownerRef.current
    const isCurrent = () => requestEpoch === epochRef.current && spaceRef.current === targetSpace && ownerRef.current === targetOwner
    let body: Record<string, unknown> = {}
    if (typeof init?.body === 'string') {
      try { const parsed = JSON.parse(init.body); if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown> } catch { /* api() reports malformed JSON. */ }
    }
    try {
      const result = await api<T>(path, init, { space: targetSpace, baseVersion, operationId: id })
      if (!isCurrent()) throw abortRequest()
      if (responseSpace(result) != null && responseSpace(result) !== targetSpace) throw new InvestmentApiError('空间响应不一致，已停止显示当前数据。', 409, result)
      if (method !== 'GET' && method !== 'HEAD') {
        const value = result as unknown as { version?: unknown; new_version?: unknown }
        const version = typeof value?.version === 'number' ? value.version : typeof value?.new_version === 'number' ? value.new_version : null
        if (version != null) { versionRef.current = version; setData(previous => previous ? { ...previous, version } : previous) }
        else await load(true, requestEpoch)
      }
      return result
    } catch (raw) {
      if (!isCurrent() || isAbortRequest(raw)) throw abortRequest()
      const error = raw instanceof InvestmentApiError ? raw : new InvestmentApiError('网络暂时不可用，修改已保留在本机待同步。', 0, raw)
      if (method !== 'GET' && method !== 'HEAD' && id && targetOwner && (error.status === 0 || error.status >= 500)) queueMutation(targetOwner, targetSpace, path, method, body, baseVersion, id, error.message)
      throw error
    }
  }

  const clearPrivateState = () => {
    setData(null)
    setProfileDraft(null)
    setAccountDraft(accountContextDraft())
    setJobsSeen([])
    setBackupList([])
    setOrderCheck(null)
    setOutbox([])
  }

  const queueMutation = (targetOwner: string, targetSpace: Space, path: string, method: string, body: Record<string, unknown>, baseVersion: number, operationId: string, error: string) => {
    const current = readInvestmentOutbox(targetOwner, targetSpace)
    if (current.some(item => item.operation_id === operationId)) return
    const next = [...current, { operation_id: operationId, path, method, body, base_version: baseVersion, created_at: new Date().toISOString(), state: 'queued' as const, error }]
    writeInvestmentOutbox(targetOwner, targetSpace, next)
    if (ownerRef.current === targetOwner && spaceRef.current === targetSpace) {
      setOutbox(next)
      setNotice('网络暂时不可用，写操作已保留在当前空间的待同步队列；冲突不会自动覆盖。')
    }
  }

  const flushOutbox = async (targetOwner: string, targetSpace: Space, epoch: number) => {
    if (flushingOutboxRef.current || !targetOwner) return
    const initial = readInvestmentOutbox(targetOwner, targetSpace)
    const isCurrent = () => epoch === epochRef.current && spaceRef.current === targetSpace && ownerRef.current === targetOwner
    const publish = (value: PendingMutation[]) => {
      writeInvestmentOutbox(targetOwner, targetSpace, value)
      if (isCurrent()) setOutbox(value)
    }
    if (!initial.some(item => item.state === 'queued')) { publish(initial); return }
    flushingOutboxRef.current = true
    let remaining = [...initial]
    try {
      for (const item of initial) {
        if (!isCurrent() || item.state !== 'queued') continue
        try {
          const result = await api(item.path, { method: item.method, body: JSON.stringify(item.body) }, { space: targetSpace, baseVersion: item.base_version, operationId: item.operation_id })
          if (responseSpace(result) != null && responseSpace(result) !== targetSpace) throw new InvestmentApiError('空间响应不一致，已停止同步当前数据。', 409, result)
          remaining = remaining.filter(candidate => candidate.operation_id !== item.operation_id)
          publish(remaining)
        } catch (raw) {
          if (isAbortRequest(raw)) return
          const error = raw instanceof InvestmentApiError ? raw : new InvestmentApiError('网络暂时不可用，待同步修改仍保留。', 0, raw)
          if (error.status === 409) {
            remaining = remaining.map(candidate => candidate.operation_id === item.operation_id ? { ...candidate, state: 'conflict', error: error.message } : candidate)
          } else if (error.status !== 0 && error.status < 500) {
            remaining = remaining.map(candidate => candidate.operation_id === item.operation_id ? { ...candidate, state: 'failed', error: error.message } : candidate)
          }
          publish(remaining)
          if (isCurrent() && error.status === 409) setError(`待同步修改发生并发冲突，服务端未覆盖你的数据：${error.message}`)
          if (error.status === 401) { if (isCurrent()) { clearPrivateState(); return } return }
          if (error.status === 0 || error.status >= 500) break
        }
      }
      if (isCurrent()) await load(true, epoch)
    } finally { flushingOutboxRef.current = false }
  }

  const load = async (quiet = false, epoch = epochRef.current, signal?: AbortSignal) => {
    if (!quiet) { setLoading(true); setError('') }
    try {
      const session = await api<{ owner?: string }>('/session', undefined, { space, signal })
      if (!session.owner) throw new InvestmentApiError('登录身份待确认，未展示私人数据。', 401)
      if (epoch !== epochRef.current || spaceRef.current !== space) return
      ownerRef.current = session.owner
      setOwner(session.owner)
      setOutbox(readInvestmentOutbox(session.owner, space))
      const next = await api<Bootstrap>('/bootstrap', undefined, { space, signal })
      if (next.space && next.space !== space) throw new InvestmentApiError('空间响应不一致，已停止显示当前数据。', 409, next)
      if (epoch !== epochRef.current || spaceRef.current !== space) return
      versionRef.current = typeof next.version === 'number' ? next.version : 0
      setData(next)
      if (!settingsOpenRef.current) {
        setProfileDraft(next.profile)
        setAccountDraft(accountContextDraft(next.account_context))
      }
      setSelected(current => current && next.instruments.some(x => x.id === current) ? current : next.instruments[0]?.id || '')
      setJobsSeen(next.jobs || [])
      if (!draftHydratedRef.current) {
        const saved = readInvestmentDraft(session.owner, space)
        if (saved) {
          if (saved.planDraft && typeof saved.planDraft === 'object') setPlanDraft(saved.planDraft as SetStateAction<typeof planDraft>)
          if (saved.txDraft && typeof saved.txDraft === 'object') setTxDraft(saved.txDraft as SetStateAction<typeof txDraft>)
          if (saved.openingDraft && typeof saved.openingDraft === 'object') setOpeningDraft(saved.openingDraft as SetStateAction<typeof openingDraft>)
          if (saved.accountDraft && typeof saved.accountDraft === 'object') setAccountDraft(saved.accountDraft as SetStateAction<AccountContextDraft>)
          if (typeof saved.reportInput === 'string') setReportInput(saved.reportInput)
          if (typeof saved.historyInput === 'string') setHistoryInput(saved.historyInput)
          if (typeof saved.orderBudget === 'string') setOrderBudget(saved.orderBudget)
          if (typeof saved.selected === 'string' && next.instruments.some(item => item.id === saved.selected)) setSelected(saved.selected)
          if (['today', 'diagnosis', 'plan', 'assets', 'funds', 'learn'].includes(saved.tab)) setTab(saved.tab)
          setNotice('已恢复本机未提交表单草稿；保存前请核对当前空间。')
        }
        draftHydratedRef.current = true
        setDraftHydrated(true)
      }
      void flushOutbox(session.owner, space, epoch)
    } catch (e) {
      if (epoch !== epochRef.current || spaceRef.current !== space || isAbortRequest(e)) return
      if (e instanceof InvestmentApiError && e.status === 401) { clearPrivateState(); setOwner(''); ownerRef.current = ''; setError('登录已失效，未展示旧私人数据；本机草稿仍保留。') }
      else if (!quiet || epoch === epochRef.current) setError(e instanceof Error ? e.message : '无法连接投资服务')
    }
    finally { if (!quiet && epoch === epochRef.current && spaceRef.current === space) setLoading(false) }
  }
  useEffect(() => {
    const savedSpace = typeof window !== 'undefined' && window.localStorage.getItem('qs-selected-space') === 'demo' ? 'demo' : 'personal'
    setSpace(savedSpace)
    setReady(true)
  }, [])
  useEffect(() => {
    if (!ready) return
    const epoch = ++epochRef.current
    const controller = new AbortController()
    busyRef.current = null
    setBusy('')
    setLoading(true)
    setError('')
    setNotice('')
    setData(null)
    versionRef.current = 0
    refreshRotationRef.current = 0
    ownerRef.current = ''
    setOwner('')
    setOutbox([])
    setSearchResults([])
    setSearching(false)
    setOrderCheck(null)
    setProfileDraft(null)
    draftHydratedRef.current = false
    setDraftHydrated(false)
    setJobsSeen([])
    void load(false, epoch, controller.signal)
    return () => controller.abort()
  }, [ready, space])
  const persistDraft = (targetSpace: Space = space) => {
    if (!ownerRef.current || !draftHydrated) return
    writeInvestmentDraft(ownerRef.current, targetSpace, { planDraft, txDraft, openingDraft, accountDraft, reportInput, historyInput, orderBudget, selected, tab })
  }
  useEffect(() => { persistDraft() }, [owner, space, draftHydrated, planDraft, txDraft, openingDraft, accountDraft, reportInput, historyInput, orderBudget, selected, tab])
  const instrumentIds = data?.instruments?.map(item => item.id) || []
  useEffect(() => {
    let live = true
    const targetSpace = space
    const targetEpoch = epochRef.current
    const isCurrent = () => live && targetEpoch === epochRef.current && spaceRef.current === targetSpace
    if (!query.trim()) { setSearchResults([]); setSearching(false); return () => { live = false } }
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const found = await request<{ items: Instrument[] }>(`/search?q=${encodeURIComponent(query.trim())}`)
        if (isCurrent()) setSearchResults(found.items || [])
      } catch (e) {
        if (isCurrent() && !isAbortRequest(e)) setError(e instanceof Error ? e.message : '搜索失败')
      } finally { if (isCurrent()) setSearching(false) }
    }, 280)
    return () => { live = false; window.clearTimeout(timer) }
  }, [query, space, owner])
  useEffect(() => {
    if (!selected) return
    let live = true
    const targetSpace = space
    const targetEpoch = epochRef.current
    const targetInstrument = selected
    const isCurrent = () => live && targetEpoch === epochRef.current && spaceRef.current === targetSpace
    request<Snapshot>(`/instruments/${encodeURIComponent(targetInstrument)}/snapshot`)
      .then(snap => { if (isCurrent()) setData(prev => prev ? { ...prev, snapshots: { ...prev.snapshots, [targetInstrument]: snap } } : prev) })
      .catch(e => {
        if (!isCurrent() || isAbortRequest(e)) return
        if (e instanceof InvestmentApiError && e.status === 404) {
          setData(prev => prev ? { ...prev, snapshots: { ...prev.snapshots, [targetInstrument]: { snapshot_id: `missing-${targetInstrument}`, instrument_id: targetInstrument, status: 'missing', quote: null, history: [] } } } : prev)
          return
        }
        setError(e instanceof Error ? e.message : '读取标的快照失败')
      })
    return () => { live = false }
  }, [selected, space, owner])
  useEffect(() => {
    const active = jobsSeen.some(j => isActiveJob(j.status))
    if (!active) return
    let live = true
    const targetSpace = space
    const targetEpoch = epochRef.current
    const isCurrent = () => live && targetEpoch === epochRef.current && spaceRef.current === targetSpace
    const timer = window.setInterval(async () => {
      try {
        const latest = await Promise.all(jobsSeen.filter(j => isActiveJob(j.status)).map(j => request<Job>(`/jobs/${encodeURIComponent(j.id)}`)))
        if (!isCurrent()) return
        setJobsSeen(prev => prev.map(old => latest.find(j => j.id === old.id) || old))
        if (latest.some(j => isFinishedJob(j.status))) await load(true, targetEpoch)
      } catch (e) { if (isCurrent() && !isAbortRequest(e)) setError(e instanceof Error ? e.message : '刷新任务状态失败') }
    }, 1300)
    return () => { live = false; window.clearInterval(timer) }
  }, [jobsSeen, space, owner])
  useEffect(() => {
    if (!data || !instrumentIds.length) return
    let live = true
    const targetSpace = space
    const targetEpoch = epochRef.current
    const isCurrent = () => live && targetEpoch === epochRef.current && spaceRef.current === targetSpace
    const timer = window.setInterval(async () => {
      if (!isCurrent() || document.visibilityState !== 'visible' || jobsSeenRef.current.some(j => isActiveJob(j.status))) return
      try {
        const start = refreshRotationRef.current % instrumentIds.length
        const batch = instrumentIds.slice(start, start + 4)
        refreshRotationRef.current = start + batch.length >= instrumentIds.length ? 0 : start + batch.length
        const started = await request<RefreshResult>('/refresh', { method: 'POST', body: JSON.stringify({ ids: batch, full: false }) }, undefined, versionRef.current)
        if (!isCurrent()) return
        if (started.job_id && !isFinishedJob(started.status || '')) setJobsSeen(prev => [{ id: started.job_id!, status: started.status || 'queued', progress: 0, message: `自动分批更新 ${batch.length} 个关注标的` }, ...prev.filter(j => j.id !== started.job_id)])
        if (isFinishedJob(started.status || '')) await load(true, targetEpoch)
        if (isCurrent()) setNotice(`自动分批更新：已${isFinishedJob(started.status || '') ? '更新' : '提交'} ${batch.length}/${instrumentIds.length} 个关注标的。`)
      } catch (e) { if (isCurrent() && !isAbortRequest(e)) setError(e instanceof Error ? e.message : '自动更新暂不可用') }
    }, 5 * 60 * 1000)
    return () => { live = false; window.clearInterval(timer) }
  }, [space, Boolean(data), instrumentIds.join('|'), owner])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [tab])
  useEffect(() => {
    if (tab !== 'assets' || !recordFocus) return
    document.getElementById('actual-record')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setRecordFocus(false)
  }, [tab, recordFocus])

  const instruments = data?.instruments || []
  const instrumentById = useMemo(() => Object.fromEntries(instruments.map(x => [x.id, x])) as Record<string, Instrument>, [instruments])
  const majorIndexCards = majorIndexSpecs.map(spec => ({ ...spec, item: instruments.find(item => item.kind === 'index' && item.code === spec.code && item.exchange === spec.exchange) }))
  const current = instrumentById[selected]
  const snapshot = data?.snapshots?.[selected]
  const portfolio = data?.portfolio
  const market = data?.market
  const reports = data?.reports || []
  const newestFirst = (left: Report, right: Report) => (right.created_at || '').localeCompare(left.created_at || '')
  const marketReports = reports.filter(r => r.report_type === 'market' && !r.instrument_id).sort(newestFirst)
  const diagnosisReports = reports.filter(r => r.report_type === 'diagnosis' && r.instrument_id === selected).sort(newestFirst)
  const jobActive = jobsSeen.some(j => isActiveJob(j.status))
  const selectedAdvice = [...(data?.advice?.holdings || []), ...(data?.advice?.watchlist || [])].find(row => row.instrument_id === selected)
  const importFile = (target: 'report' | 'history') => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => target === 'report' ? setReportInput(String(reader.result || '')) : setHistoryInput(String(reader.result || ''))
    reader.readAsText(file)
    event.target.value = ''
  }
  const act = async (label: string, task: () => Promise<void>) => {
    const targetEpoch = epochRef.current
    const targetSpace = spaceRef.current
    const targetOwner = ownerRef.current
    const lock = { epoch: targetEpoch, space: targetSpace, owner: targetOwner, label }
    if (busyRef.current && busyRef.current.epoch === targetEpoch && busyRef.current.space === targetSpace && busyRef.current.owner === targetOwner) return
    busyRef.current = lock
    const isCurrent = () => targetEpoch === epochRef.current && spaceRef.current === targetSpace && ownerRef.current === targetOwner
    setBusy(label); setError(''); setNotice('')
    try { await task() }
    catch (e) {
      if (!isCurrent() || isAbortRequest(e)) return
      persistDraft(targetSpace)
      if (e instanceof InvestmentApiError && e.status === 401) {
        clearPrivateState()
        setOwner('')
        ownerRef.current = ''
        setError('登录已失效，未展示旧私人数据；当前表单草稿已保留。')
      } else if (e instanceof InvestmentApiError && e.status === 409) {
        setError(`检测到并发冲突，服务端未覆盖你的修改。请刷新当前空间后核对再提交。${e.message ? `（${e.message}）` : ''}`)
      } else setError(e instanceof Error ? e.message : '操作失败，请查看服务状态')
    }
    finally {
      if (busyRef.current === lock) {
        busyRef.current = null
        if (isCurrent()) setBusy('')
      }
    }
  }
  const refresh = async (ids?: string[], full = false) => act('正在更新数据…', async () => {
    const targetIds = ids || instruments.map(item => item.id)
    const batches: (string[] | undefined)[] = targetIds.length ? Array.from({ length: Math.ceil(targetIds.length / 4) }, (_, index) => targetIds.slice(index * 4, index * 4 + 4)) : [undefined]
    let processed = 0
    const targetEpoch = epochRef.current
    for (let index = 0; index < batches.length; index += 1) {
      const batch = batches[index]
      const started = await request<RefreshResult>('/refresh', { method: 'POST', body: JSON.stringify({ ids: batch, full: full && index === 0 }) }, undefined, versionRef.current)
      const finished = isFinishedJob(started.status || '')
      if (batch) processed += batch.length
      if (started.job_id && !finished) setJobsSeen(prev => [{ id: started.job_id!, status: started.status || 'queued', progress: 0, message: `分批更新 ${batch?.length || 0} 个关注标的` }, ...prev.filter(j => j.id !== started.job_id)])
      if (finished) await load(true, targetEpoch)
      if (targetIds.length) setNotice(`分批更新：已${finished ? '更新' : '提交'} ${processed}/${targetIds.length} 个关注标的。`)
      else setNotice(finished ? '市场数据已更新。' : '市场数据更新任务已启动，完成后页面会自动更新。')
    }
  })
  const saveAutomaticPlan = (item: InstrumentAdvice) => act('正在保存条件预案…', async () => {
    const saved = await request<Plan>('/advice/plans', { method: 'POST', body: JSON.stringify({ instrument_id: item.instrument_id, decision_id: item.decision_id }) })
    await load(true)
    setNotice(`${item.name}的条件预案已保存（${saved.date}）；没有发生交易，重复点击不会新增相同预案。`)
  })
  const openActualRecord = (id: string) => {
    const recommendation = [...(data?.advice?.holdings || []), ...(data?.advice?.watchlist || [])].find(row => row.instrument_id === id)
    setTxDraft(d => ({ ...d, instrument_id: id, kind: recommendation?.action === 'reduce' ? 'sell' : instrumentById[id]?.kind === 'fund' ? 'fund_pending' : 'buy', quantity: '', price: '', amount: '', fees: '', plan_id: '', pending_id: '' }))
    setTab('assets')
    setRecordFocus(true)
    setNotice('仅在同花顺真实成交后填写实际价量和费用；打开表单不会改变持仓。')
  }
  const addWatch = async (item: Instrument) => act('正在添加…', async () => {
    await request('/watchlist', { method: 'POST', body: JSON.stringify(item) })
    setQuery(''); setSearchResults([]); setSelected(item.id)
    await load(true); setNotice(`${item.name} 已加入关注，行情会由投资服务获取。`)
  })
  const removeWatch = async (id: string) => act('正在移除…', async () => {
    await request(`/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (selected === id) setSelected('')
    await load(true); setNotice('已从关注列表移除，历史账本保留。')
  })
  const savePlan = async (e: FormEvent) => {
    e.preventDefault(); if (!planDraft.instrument_id) { setError('请先选择标的'); return }
    await act('正在保存预案…', async () => {
      await request('/plans', { method: 'POST', body: JSON.stringify({ ...planDraft, budget: planDraft.budget === '' ? null : Number(planDraft.budget) }) })
      setPlanDraft(d => ({ ...d, observation: '', buy_condition: '', exit_condition: '', invalidation: '', budget: '', notes: '' }))
      await load(true); setNotice('预案已记录。它只是计划，不会下单或改变持仓。')
    })
  }
  const submitTransaction = async (e: FormEvent) => {
    e.preventDefault()
    await act('正在记录账本…', async () => {
      const kind = txDraft.kind
      const payload: Record<string, unknown> = { kind, date: txDraft.date, notes: txDraft.notes }
      if (['buy', 'sell', 'fund_pending', 'fund_confirm', 'dividend'].includes(kind)) payload.instrument_id = txDraft.instrument_id || undefined
      if (txDraft.quantity) payload.quantity = Number(txDraft.quantity)
      if (txDraft.price) payload.price = Number(txDraft.price)
      if (txDraft.amount) payload.amount = Number(txDraft.amount)
      if (txDraft.fees) payload.fees = Number(txDraft.fees)
      if (txDraft.plan_id) payload.plan_id = txDraft.plan_id
      if (txDraft.pending_id) payload.pending_id = txDraft.pending_id
      await request('/transactions', { method: 'POST', body: JSON.stringify(payload) })
      setTxDraft(d => ({ ...d, quantity: '', price: '', amount: '', fees: '', notes: '', plan_id: '', pending_id: '' }))
      await load(true); setNotice('账本记录已保存；持仓只会按已确认成交更新。')
    })
  }
  const checkOrder = async () => act('正在检查规则…', async () => {
    if (!selected || !snapshot?.quote?.price) { setOrderCheck(null); throw new Error('需要先选择有有效现价的标的。') }
    setOrderCheck(await request(`/order-check?instrument_id=${encodeURIComponent(selected)}&price=${snapshot.quote.price}&budget=${Number(orderBudget) || 0}`))
  })
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault(); if (!profileDraft) return
    await act('正在保存…', async () => {
      await request('/profile', { method: 'PUT', body: JSON.stringify(profileDraft) })
      await load(true); setNotice('设置已保存。未知费用仍会显示待确认。')
    })
  }
  const saveAccountContext = async (e: FormEvent) => {
    e.preventDefault()
    await act('正在保存截图基准…', async () => {
      const base = data?.account_context
      if (!base) throw new Error('当前没有已核验的截图基准。请先由主流程补齐账户事实，再修改用途或场外备用资金。')
      const required = (value: string, label: string) => { if (value.trim() === '' || !Number.isFinite(Number(value))) throw new Error(`${label}需要填写有效数字。`); return Number(value) }
      const optional = (value: string, label: string) => { if (value.trim() === '') return null; if (!Number.isFinite(Number(value))) throw new Error(`${label}不是有效数字。`); return Number(value) }
      const externalCash = required(accountDraft.external_cash, '场外备用资金')
      const availableHours = optional(accountDraft.external_available_hours, '预计到账时长')
      if (externalCash < 0 || (availableHours != null && availableHours < 0)) throw new Error('场外备用资金和预计到账时长不能填写负数。')
      // PUT requires the full schema. Re-send only whitelisted persisted fields, never server metadata such as recorded_at.
      const payload: AccountContext = {
        as_of: base.as_of, observed_time: base.observed_time, source: base.source,
        broker_assets: base.broker_assets, broker_market_value: base.broker_market_value, broker_available_cash: base.broker_available_cash,
        broker_floating_pnl: base.broker_floating_pnl, broker_day_pnl: base.broker_day_pnl, broker_month_pnl: base.broker_month_pnl, broker_month_return_pct: base.broker_month_return_pct,
        external_cash: externalCash, external_available_hours: availableHours, horizon: accountDraft.horizon.trim(), purpose: accountDraft.purpose.trim() || null,
        cost_note: base.cost_note, notes: base.notes, positions: base.positions.map(p => ({ instrument_id: p.instrument_id, quantity: p.quantity, reference_price: p.reference_price, market_value: p.market_value, broker_display_cost: p.broker_display_cost, cost_basis_status: p.cost_basis_status })),
      }
      await request('/account-context', { method: 'PUT', body: JSON.stringify(payload) })
      await load(true); setAccountEditOpen(false); setNotice('场外备用资金/用途已保存。券商截图数字仍保持原基准；修改前请按截图重新核对。')
    })
  }
  const initializeLedger = async (e: FormEvent) => {
    e.preventDefault()
    await act('正在初始化账本…', async () => {
      if (data?.opening || data?.transactions?.length) throw new Error('已有初始账本或成交记录，不能重复初始化。')
      if (openingDraft.cash.trim() === '' || !Number.isFinite(Number(openingDraft.cash))) throw new Error('请填写起始现金；空值不会当作零。')
      const rows = openingDraft.positions.filter(row => row.instrument_id || row.quantity || row.average_cost || row.reference_price)
      if (!rows.length && !openingDraft.confirmed_empty) throw new Error('请添加起始持仓，或明确勾选“我确认当时为空仓”。')
      if (rows.length && openingDraft.confirmed_empty) throw new Error('填写了持仓时，请取消“空仓确认”。')
      if (rows.some(row => !row.instrument_id || row.quantity === '' || row.reference_price === '')) throw new Error('每行持仓都要填写品种、份额和起始参考价；实际成本可留空。')
      const positions = rows.map(row => ({ instrument_id: row.instrument_id, quantity: Number(row.quantity), average_cost: row.average_cost.trim() === '' ? null : Number(row.average_cost), reference_price: Number(row.reference_price) }))
      if (positions.some(row => !Number.isFinite(row.quantity) || row.quantity <= 0 || (row.average_cost != null && (!Number.isFinite(row.average_cost) || row.average_cost <= 0)) || !Number.isFinite(row.reference_price) || row.reference_price < 0)) throw new Error('起始数量须大于0；实际买入平均成本若填写必须大于0，参考价格须为有效非负数。')
      await request('/ledger/initialize', { method: 'POST', body: JSON.stringify({ date: openingDraft.date, cash: Number(openingDraft.cash), positions, confirmed_empty: rows.length === 0 && openingDraft.confirmed_empty }) })
      await load(true); setNotice('初始账本已记录。起始参考价是基准日估值，不是买卖成交。')
    })
  }
  const confirmHistoricalLedger = () => act('正在确认账本…', async () => {
    await request('/ledger/confirm', { method: 'POST', body: JSON.stringify({ confirmed: true }) }); await load(true); setNotice('历史账本已确认。')
  })
  const createBackup = () => act('正在备份…', async () => {
    await request('/backups', { method: 'POST', body: '{}' }); const result = await request<unknown>('/backups')
    setBackupList(normalizeBackups(result)); setNotice('已创建云端快照。')
  })
  const restoreBackup = (name: string) => act('正在恢复…', async () => {
    await request('/backups/restore', { method: 'POST', body: JSON.stringify({ name }) }); await load(true)
    setPendingRestore(null); setBackupList(normalizeBackups(await request('/backups'))); setNotice('恢复完成。')
  })
  const loadBackups = () => act('正在读取备份…', async () => {
    const result = await request<unknown>('/backups')
    setBackupList(normalizeBackups(result))
  })
  const exportPackage = async (type: 'market' | 'diagnosis') => act('正在准备分析包…', async () => {
    const path = type === 'market' ? '/analysis-package?type=market' : `/analysis-package?type=diagnosis&instrument_id=${encodeURIComponent(selected)}`
    const result = await request<Record<string, unknown> & { markdown?: string }>(path)
    const a = document.createElement('a'); const separator = path.includes('?') ? '&' : '?'; a.href = `/api/investment${path}${separator}download=true&space=${space}`; a.download = `投资分析包-${type}-${space}-${today}.json`; a.click()
    if (result.markdown) {
      try { await navigator.clipboard.writeText(result.markdown); setNotice('分析包 JSON 已下载，Markdown 已复制到剪贴板。') }
      catch { setNotice('分析包 JSON 已下载；当前浏览器未授权剪贴板，包内也含 Markdown。') }
    }
  })
  const importReport = async () => act('正在导入报告…', async () => {
    const parsed = JSON.parse(reportInput)
    const payload = parsed.report || parsed
    if (!payload.report_type || !payload.snapshot_id || !Array.isArray(payload.sections)) throw new Error('JSON 需要包含 report_type、snapshot_id 和 sections；可导入从本工作台导出的完整报告。')
    await request('/reports', { method: 'POST', body: JSON.stringify(payload) }); setReportInput(''); await load(true); setNotice('报告已提交，旧快照会作为历史保留。')
  })
  const importHistory = async () => act('正在导入历史…', async () => {
    if (!selected) throw new Error('先选择要补充历史的品种。')
    let rows: HistoryRow[]
    const raw = historyInput.trim()
    if (raw.startsWith('[') || raw.startsWith('{')) { const parsed = JSON.parse(raw); rows = Array.isArray(parsed) ? parsed : parsed.rows }
    else {
      const lines = raw.split(/\r?\n/).filter(Boolean), heads = lines[0].split(/[,\t]/).map(s => s.trim().toLowerCase())
      rows = lines.slice(1).map(line => { const vals = line.split(/[,\t]/).map(s => s.trim()); const get = (...keys: string[]) => { const index = heads.findIndex(h => keys.includes(h)); return index >= 0 && vals[index] ? Number(vals[index]) : undefined }; return { date: vals[heads.indexOf('date') >= 0 ? heads.indexOf('date') : 0], open: get('open','开盘'), high: get('high','最高'), low: get('low','最低'), close: get('close','收盘') ?? Number.NaN, volume: get('volume','成交量'), amount: get('amount','成交额') } }).filter(row => Number.isFinite(row.close) && row.date)
    }
    if (!rows.length || rows.some(row => !Number.isFinite(row.close))) throw new Error('历史数据必须包含日期和有效收盘价。')
    await request('/import/history', { method: 'POST', body: JSON.stringify({ instrument_id: selected, rows, source_label: '用户导入文件' }) }); setHistoryInput(''); await load(true); setNotice('历史数据已导入并标注为手动来源。')
  })

  const chartSnapshot = tab === 'funds' ? snapshot : snapshot
  const latestJob = jobsSeen[0]
  const fundItems = instruments.filter(i => i.kind === 'etf' || i.kind === 'fund')
  const expenseUnset = !data?.profile || !data.profile.minimum_commission && !data.profile.commission_rate && !data.profile.stamp_tax_rate && !data.profile.transfer_fee_rate

  return <div className="investment-page"><div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={18} strokeWidth={2.6} /></div><div><b>知行</b><span>INVESTMENT DESK</span></div></div>
      <div className="workspace-label">{space === 'demo' ? '演示空间 · 合成数据' : '私人空间 · 空账本起步'} <ChevronDown size={13} /></div>
      <div className="side-caption">工作区</div>
      <nav>{nav.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-item ${tab === item.id ? 'active' : ''}`} onClick={() => { setTab(item.id); setMobileNav(false) }}><Icon size={17} /><span>{item.label}</span>{item.id === 'plan' && !!data?.plans.length && <small>{data.plans.length}</small>}</button> })}</nav>
      <div className="side-spacer" />
      <div className="sidebar-note"><div className="note-icon"><ShieldAlert size={16} /></div><b>自动分析，亲自决策</b><p>查看条件建议，在同花顺自行操作，成交后回到这里记录。</p><span>登录保护 · Asia/Shanghai</span></div>
      <button className="side-settings" onClick={() => { setSettingsOpen(true); void loadBackups() }}><Settings2 size={16} />个人设置与备份</button>
      <div className="side-version">云端数据 <span className="live-dot" /> 私人空间隔离{outbox.length > 0 && <small className="investment-outbox-status"> · {outbox.filter(item => item.state === 'queued').length} 笔待同步</small>}</div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={() => setMobileNav(false)} aria-label="关闭菜单" />}

    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="打开模块菜单" onClick={() => setMobileNav(true)}><Menu size={19} /></button><div className="breadcrumb">工作区 <span>/</span> <b>{nav.find(n => n.id === tab)?.label}</b><BoardSwitch current="investment" space={space} /></div><div className="top-actions"><div className="market-status"><span className={`status-dot ${market?.status === 'fresh' ? 'is-fresh' : market?.status === 'stale' ? 'is-stale' : ''}`} />{market ? `${market.date || '市场数据'} · ${statusText(market.status)}` : '市场温度待补充'}</div><label className="investment-space-control"><span className="sr-only">投资空间</span><select aria-label="投资空间" disabled={!!busy} value={space} onChange={e => { persistDraft(space); const next = e.target.value as Space; if (next === space) return; if (typeof window !== 'undefined') window.localStorage.setItem('qs-selected-space', next); setMobileNav(false); setSpace(next) }}><option value="personal">私人</option><option value="demo">演示</option></select></label><button className="icon-button" aria-label="通知" title={latestJob?.message || '无新通知'}><Bell size={17} />{jobActive && <i />}</button><button className="avatar" onClick={() => { setSettingsOpen(true); void loadBackups() }}>丘</button></div></header>
      <div className="page-wrap">
        {error && <div className="alert alert-error"><ShieldAlert size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={14} /></button></div>}
        {notice && <div className="alert alert-success"><Check size={15} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={14} /></button></div>}
        {loading && !data ? <div className="loading-page"><LoaderCircle className="spin" size={24} /><p>正在读取投资工作台…</p><small>连接失败时不会展示模拟数据。</small></div> : !data ? <section className="connect-state"><div className="empty-icon"><Activity /></div><h1>投资服务暂不可用</h1><p>{error || '请确认个人工作台 API 服务已启动，再重新连接。'}</p><button className="button button-primary" onClick={() => void load()}><RefreshCw size={15} />重新连接</button></section> : <>
          {tab === "today" && <>
            <DecisionDashboard advice={data.advice} loading={loading || jobActive} busy={!!busy || jobActive} onRefresh={() => void refresh(undefined, true)} onSettings={() => { setSettingsOpen(true); setAccountEditOpen(false) }} onInspect={id => { setSelected(id); setTab("diagnosis") }} onSavePlan={item => void saveAutomaticPlan(item)} onRecord={openActualRecord} />
            <div className="decision-account-link"><span>证券权益 <b>{yuan(portfolio?.total_equity)}</b> · 账户现金 <b>{yuan(portfolio?.cash)}</b>{data.account_context && <> · 场外备用（未到账） <b>{yuan(data.account_context.external_cash)}</b></>}</span><button className="text-action" onClick={() => setTab("assets")}>查看资产与收益 <ArrowUpRight size={14} /></button></div>
            <details className="research-details">
              <summary><BarChart3 size={18} /><span>查看市场图表、自选和历史报告<small>进阶资料按需展开，日常使用不必导入报告</small></span><ChevronDown size={16} /></summary>
              <div className="research-details-body">
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> MARKET BRIEF <span>·</span> {today}</div><h1>行情与研究资料<span className="heading-period">。</span></h1><p>自动建议已在上方生成；这里保留行情图表、来源、自选和手工深度报告。</p></div><div className="heading-actions"><button className="button button-secondary" disabled={!!busy || jobActive} onClick={() => void refresh(undefined, true)}><RefreshCw size={15} className={jobActive ? 'spin' : ''} />{jobActive ? '数据更新中' : '更新市场数据'}</button><button className="button button-primary" onClick={() => setTab('plan')}><Plus size={16} />写今日预案</button></div></div>
            <section className="index-strip"><div className="section-heading"><div><h2>主要指数</h2><p>仅显示已关注且有真实行情/日线的指数。</p></div><button className="text-action" onClick={() => setTab('diagnosis')}>查看体检 <ArrowUpRight size={14} /></button></div><div className="index-grid">{majorIndexCards.map(spec => <MiniIndexCard key={`${spec.exchange}:${spec.code}`} item={spec.item} snapshot={spec.item ? data.snapshots[spec.item.id] : undefined} name={spec.name} code={spec.code} />)}</div></section>
            {data.account_context && <AccountContextCard context={data.account_context} instruments={instruments} lossLimit={data.profile.loss_limit} compact onEdit={() => { setAccountEditOpen(true); setSettingsOpen(true) }} />}
            <div className="overview-grid">
              <section className="card market-card"><div className="card-top"><div><div className="section-kicker">市场温度计 <span className="tip" title="用涨跌家数和涨停数据描述当日市场宽度，不等于未来收益预测。"><CircleHelp size={13} /></span></div><div className="card-sub">{market?.date || '市场全景未更新'} <span>·</span> {sourceLabel(market?.source)}</div></div><StatusBadge status={market?.status} /></div>
                <div className="temp-layout"><div className="temp-visual"><div className="temp-ring"><Gauge size={24} /><b>{market?.breadth?.up != null && market.breadth.down != null ? (market.breadth.up > market.breadth.down ? '上涨更多' : market.breadth.up < market.breadth.down ? '下跌更多' : '大致相近') : '待补充'}</b><small>家数对比</small></div></div><div className="breadth-bars"><div className="breadth-row"><div><span>上涨家数</span><b>{market?.breadth?.up?.toLocaleString() ?? '—'}</b></div><div className="meter"><i className="up-fill" style={{ width: breadthPercent(market?.breadth?.up, market?.breadth?.total) }} /></div></div><div className="breadth-row"><div><span>下跌家数</span><b>{market?.breadth?.down?.toLocaleString() ?? '—'}</b></div><div className="meter"><i className="down-fill" style={{ width: breadthPercent(market?.breadth?.down, market?.breadth?.total) }} /></div></div><div className="breadth-row"><div><span>平盘 / 总数</span><b>{market?.breadth?.flat?.toLocaleString() ?? '—'} / {market?.breadth?.total?.toLocaleString() ?? '—'}</b></div></div></div></div>
                <div className="market-foot"><span>涨停 <b>{market?.sentiment?.limit_up ?? '—'}</b></span><span>跌停 <b>{market?.sentiment?.limit_down ?? '—'}</b></span><span>最高连板 <b>{market?.sentiment?.max_streak ?? '待补充'}</b></span><span>炸板 <b>{market?.sentiment?.broken ?? '待补充'}</b></span><span>炸板率 <b>{market?.sentiment?.broken_rate == null ? '待补充' : `${number(market.sentiment.broken_rate)}%`}</b></span><span>成交额 <b>{amount(market?.breadth?.amount)}</b></span></div>
                <div className="card-sub">情绪数据日期 {market?.sentiment_date || '待补充'} · 来源 {sourceLabel(market?.sentiment_source)} · 炸板率按来源 zbc 字段，非上涨概率</div><div className="market-foot secondary-foot"><span>北向资金 <b>{market?.flow?.northbound != null ? amount(market.flow.northbound) : '不提供'}</b></span><span>主力净流 <b>{market?.flow?.main != null ? amount(market.flow.main) : '不提供'}</b></span></div>
                <InfoLine valuationKind="market_overview" status={market?.status} asOf={market?.date} fetchedAt={market?.fetched_at} error={market?.warnings?.[0] || market?.missing_fields?.join('、')} />
              </section>
              <section className="card report-card"><div className="card-top"><div><div className="section-kicker">市场复盘结论 <span className="tip" title="只展示市场报告，不混入单品诊断；评分来自导入报告。"><CircleHelp size={13} /></span></div><div className="card-sub">分析报告与行情快照分开保存</div></div><button className="link-button" onClick={() => void exportPackage('market')}><FileDown size={14} />分析包</button></div>
                {marketReports.length ? <div className="report-collection">{marketReports.map((report, index) => <ReportView key={report.id || `${report.snapshot_id}-${index}`} report={report} currentSnapshotId={market?.snapshot_id} />)}</div> : <div className="report-placeholder"><div className="placeholder-icon"><FileUp size={19} /></div><b>还没有市场复盘报告</b><span>没有导入时，评分和结论保持待补充。</span><button className="button button-light" onClick={() => { setTab('learn'); document.getElementById('report-import')?.scrollIntoView({ behavior: 'smooth' }) }}>导入分析报告</button></div>}
                <div className="report-note"><Sparkles size={13} />评分不代表收益预测；请查看原始数据和报告依据。</div></section>
            </div>
            <div className="market-visualization-grid"><MarketBars title="市场涨跌家数" labels={['上涨', '下跌', '平盘']} values={[market?.breadth?.up, market?.breadth?.down, market?.breadth?.flat]} date={market?.date} source={market?.source} complete={market?.breadth?.up != null && market?.breadth?.down != null && market?.breadth?.flat != null && market?.breadth?.total != null} /><MarketBars title="涨跌停与炸板" labels={['涨停', '跌停', '炸板']} values={[market?.sentiment?.limit_up, market?.sentiment?.limit_down, market?.sentiment?.broken]} date={market?.sentiment_date || market?.date} source={market?.sentiment_source || market?.source} independent /></div>
            <section className="section-block"><div className="section-heading"><div><h2>我的关注</h2><p>自选数据由云端采集；未更新时会明确标注缓存和数据日期。</p></div><div className="section-tools"><div className="search-box"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="输入名称 / 代码搜索" /><kbd>⌘ K</kbd>{query && <div className="search-popover">{searching ? <span className="search-message">正在检索公开标的信息…</span> : searchResults.length ? searchResults.map(item => <button key={item.id} onClick={() => void addWatch(item)}><span className={`kind-dot ${kindTone(item.kind)}`} /><span><b>{item.name}</b><small>{kindName[item.kind]} · {item.code} · {item.exchange}</small></span><Plus size={14} /></button>) : <span className="search-message">无匹配结果；搜索只查标的，不代表推荐。</span>}</div>}</div><button className="button button-secondary compact" disabled={!instruments.length || !!busy || jobActive} onClick={() => void refresh(instruments.map(i => i.id))}><RefreshCw size={14} />刷新自选</button></div></div>
              {instruments.length ? <div className="watch-grid">{instruments.map(i => <InstrumentCard key={i.id} item={i} snapshot={data.snapshots[i.id]} selected={selected === i.id} onSelect={() => { setSelected(i.id); setTab(i.kind === 'fund' ? 'funds' : 'diagnosis') }} onRemove={() => void removeWatch(i.id)} />)}</div> : <EmptyState icon={Search} title="关注列表还空着" text="搜索明确品种后添加。工作台不会预置模拟持仓或虚构行情。" action={<div className="empty-search"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="输入 ETF / 股票 / 基金 / 指数" /></div>} />}
            </section>
            <div className="today-bottom"><section className="card workflow-card"><div className="section-kicker">今天的三步</div><div className="workflow-steps"><button onClick={() => void refresh(undefined, true)}><span className="step-index">01</span><span><b>先确认数据日期</b><small>{market?.status === 'stale' ? '当前是缓存数据，注意过期时间。' : market?.status === 'fresh' ? '市场数据已更新，仍需核对来源。' : '市场温度尚无可信数据。'}</small></span><ArrowUpRight size={15} /></button><button onClick={() => { setTab('diagnosis'); if (!selected && instruments[0]) setSelected(instruments[0].id) }}><span className="step-index">02</span><span><b>再看持仓与标的条件</b><small>价格位置描述历史，不预测未来涨跌。</small></span><ArrowUpRight size={15} /></button><button onClick={() => setTab('plan')}><span className="step-index">03</span><span><b>最后写下计划或选择观望</b><small>预案是记录工具，不会连接券商。</small></span><ArrowUpRight size={15} /></button></div></section><section className="card mini-card"><div className="card-top"><div><div className="section-kicker">风险边界</div><div className="card-sub">按你设置的账户约束提醒</div></div><ShieldAlert size={17} className="muted-icon" /></div><div className={`risk-callout ${portfolio?.loss_triggered ? 'risk-alert' : ''}`}><b>{!data.profile.holdings_confirmed ? '初始账本待核对' : portfolio?.loss_triggered ? '已触及暂停线' : portfolio?.total_pnl != null ? '持续核对真实账本' : '尚无完整收益结论'}</b><span>{!data.profile.holdings_confirmed ? '先登记真实现金与持仓，再查看期间盈亏。' : portfolio?.loss_triggered ? '累计净亏损达到设定阈值，先暂停新增交易。' : portfolio?.valuation_complete ? `已记录盈亏 ${yuan(portfolio.total_pnl)}，按实际成交与最新行情计算。` : '确认初始持仓与行情后，账本才能计算完整收益。'}</span></div><button className="text-action" onClick={() => setTab('assets')}>查看资产复盘 <ArrowUpRight size={14} /></button></section></div>

              </div>
            </details>
          </>}

          {tab === 'diagnosis' && <>
            <PageTitle kicker="INSTRUMENT CHECK" title="单品体检" sub="用能核验的数据描述发生了什么；不把历史指标包装成买卖结论。" action={<button className="button button-secondary" disabled={!selected || !!busy || jobActive} onClick={() => void refresh(selected ? [selected] : [])}><RefreshCw size={15} />更新这项数据</button>} />
            <div className="content-grid"><section className="card diagnosis-main"><div className="selector-head"><InstrumentSelect items={instruments} selected={selected} onChange={setSelected} /></div>{current ? <div className="instrument-summary"><div><span className={`pill ${kindTone(current.kind)}`}>{kindName[current.kind]}</span><h2>{current.name}</h2><span className="muted-text">{current.code} · {current.exchange} · {current.id}</span></div><div className="quote-block"><span>{snapshot?.valuation_kind === 'confirmed_nav' ? '已公布净值' : '当前市场价格'}</span><b>{priceText(snapshot?.quote?.price, current)}</b><strong className={changeTone(snapshot?.quote?.change_pct)}>{pct(snapshot?.quote?.change_pct)}</strong><small>数据日期 {snapshot?.as_of || '待补充'}</small></div></div> : <EmptyState icon={Search} title="先选择一项标的" text="使用名称或代码搜索并添加到关注后，再查看体检。" />}
                {current && <><div className="chart-heading"><div><b>实际日线与成交量</b><span>价格按不复权口径；仅描述历史</span></div><StatusBadge status={snapshot?.status} valuationKind={snapshot?.valuation_kind} /></div><MarketChart snapshot={chartSnapshot} instrument={current} /><InfoLine status={snapshot?.status} asOf={snapshot?.as_of} fetchedAt={snapshot?.fetched_at} valuationKind={snapshot?.valuation_kind} quoteSource={snapshot?.quote_source || snapshot?.source} historySource={snapshot?.history_source} units={snapshot?.units} error={snapshot?.error || snapshot?.warnings?.join('；')} /><div className="metric-grid"><Metric label="20日均线" value={priceText(snapshot?.metrics?.ma20, current)} note="最近20个交易日平均收盘价" /><Metric label="60日均线" value={priceText(snapshot?.metrics?.ma60, current)} note={snapshot?.metrics?.ma60 == null ? '历史天数不足时不会估算' : '仅在历史天数足够时计算'} /><Metric label="20日区间变化" value={pct(snapshot?.metrics?.return_20d)} note="历史区间，不是预期收益" tone={changeTone(snapshot?.metrics?.return_20d)} /><Metric label="120日高低位置" value={typeof snapshot?.metrics?.range_120d === 'number' ? `${snapshot.metrics.range_120d.toFixed(0)}%` : '待补充'} note="当前价格在过去高低范围的位置" /></div>
                  <div className="diagnosis-explain"><div className="explain-title"><CircleHelp size={15} />这几个指标怎么读</div><div className="explain-items"><p><b>均线</b>：过去一段时间的平均收盘价，反映历史，不给出必涨必跌信号。</p><p><b>区间位置</b>：表示过去120日高低价之间的位置，不代表便宜或贵。</p><p><b>成交量</b>：交易活跃度线索；需要和趋势、公告一起看，单独不构成结论。</p></div></div>
                  <div className="card-subsection"><div className="subsection-title"><b>事实与来源</b><span>{snapshot?.fundamentals?.length || 0} 项可核验记录</span></div>{snapshot?.fundamentals?.length ? <div className="fact-list">{snapshot.fundamentals.map((f, ix) => <div className="fact-row" key={`${f.label}-${ix}`}><span>{f.label}</span><b>{f.value == null ? '待补充' : `${f.value}${f.unit === '文本' ? '' : f.unit || ''}`}</b><small>{f.period || '期间待补充'} · {f.source || '来源待补充'}</small>{f.url && <a href={f.url} target="_blank" rel="noreferrer">原始来源 ↗</a>}</div>)}</div> : <div className="subtle-empty">基本面事实暂未接入；未核实的数据不会显示成结论。</div>}{snapshot?.evidence?.length ? <EvidenceList evidence={snapshot.evidence} /> : null}</div>
                  <section className="card-subsection report-on-diagnosis"><div className="subsection-title"><b>此标的诊断报告</b><span>此标的专属分析，旧快照报告仍可阅读</span></div>{diagnosisReports.length ? diagnosisReports.map((report, index) => <ReportView key={report.id || `${report.snapshot_id}-${index}`} report={report} currentSnapshotId={snapshot?.snapshot_id} />) : <div className="subtle-empty">该标的尚无诊断报告；不会拿市场复盘报告代替。</div>}</section>
                </>}</section>
              <aside className="stack"><section className="card side-card"><div className="section-kicker">计划与纪律</div><h3>{selectedAdvice?.action_label || '等待自动建议'}</h3><p>{selectedAdvice?.headline || '选择有行情的持仓或关注标的，查看自动规则分析。'}</p>{selectedAdvice ? <button className="button button-primary full" disabled={!!busy || jobActive} onClick={() => void saveAutomaticPlan(selectedAdvice)}>保存条件预案 <Check size={15} /></button> : <button className="button button-primary full" disabled={!selected} onClick={() => { setPlanDraft(d => ({ ...d, instrument_id: selected })); setTab('plan') }}>写观察预案 <ArrowUpRight size={15} /></button>}</section><section className="card side-card"><div className="section-kicker">预算规则核验</div><label className="field-label">想检查的预算金额 <span>仅校验交易规则</span></label><div className="input-with-prefix"><span>¥</span><input type="number" min="0" value={orderBudget} onChange={e => setOrderBudget(e.target.value)} placeholder="输入金额" /></div><button className="button button-secondary full" disabled={!selected || !!busy} onClick={() => void checkOrder()}>检查规则</button>{orderCheck && <div className={`order-result ${orderCheck.eligible ? 'eligible' : ''}`}><b>{orderCheck.eligible && orderCheck.quantity != null ? `规则允许数量：${orderCheck.quantity}` : '暂不提供数量'}</b>{orderCheck.cost != null && <span>估算金额 {yuan(orderCheck.cost)}（不含未确认费用）</span>}<ul>{orderCheck.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}<div className="side-footnote">交易数量与费用可能因品种、规则和券商设置不同而变化。核验结果不是下单指令。</div></section><section className="card side-card source-card"><div className="section-kicker">数据状态</div><SourceRow label="行情源" value={sourceLabel(snapshot?.quote_source || snapshot?.source)} /><SourceRow label="日线源" value={sourceLabel(snapshot?.history_source)} /><SourceRow label="数据时间" value={snapshot?.as_of || '待补充'} /><SourceRow label="抓取时间" value={dateTime(snapshot?.fetched_at)} /><SourceRow label="复权方式" value={snapshot?.adjustment === 'none' ? '不复权' : snapshot?.adjustment || '待补充'} /></section></aside></div>
          </>}

          {tab === 'plan' && <>
            <PageTitle kicker="PLAN BEFORE ACTION" title="写下预案" sub="把观察、考虑和不交易写清楚。计划仅保存为文本，不会触发买卖。" />
            <div className="content-grid plan-layout"><section className="card form-card"><div className="form-intro"><div className="form-icon green"><CalendarDays size={18} /></div><div><h2>新增一条预案</h2><p>尽量写可验证条件和失效条件，减少临场冲动。</p></div></div><form onSubmit={e => void savePlan(e)} className="form-grid"><div className="form-field span-2"><label>关注标的 <em>*</em></label><InstrumentSelect items={instruments} selected={planDraft.instrument_id} onChange={v => setPlanDraft(d => ({ ...d, instrument_id: v }))} placeholder="选择类型明确的标的" /></div><div className="form-field"><label>预案日期</label><input type="date" value={planDraft.date} onChange={e => setPlanDraft(d => ({ ...d, date: e.target.value }))} /></div><div className="form-field"><label>当前态度</label><select value={planDraft.action} onChange={e => setPlanDraft(d => ({ ...d, action: e.target.value as Plan['action'] }))}><option value="observe">观察</option><option value="consider">满足条件后考虑</option><option value="no_trade">不交易</option></select></div><div className="form-field span-2"><label>观察依据</label><textarea value={planDraft.observation} onChange={e => setPlanDraft(d => ({ ...d, observation: e.target.value }))} placeholder="你实际看到的现象、数据日期或公告线索…" rows={3} /></div><div className="form-field"><label>考虑条件</label><textarea value={planDraft.buy_condition} onChange={e => setPlanDraft(d => ({ ...d, buy_condition: e.target.value }))} placeholder="什么情况出现后再重新评估？" rows={3} /></div><div className="form-field"><label>退出条件</label><textarea value={planDraft.exit_condition} onChange={e => setPlanDraft(d => ({ ...d, exit_condition: e.target.value }))} placeholder="预先写下如何处理" rows={3} /></div><div className="form-field"><label>失效条件</label><textarea value={planDraft.invalidation} onChange={e => setPlanDraft(d => ({ ...d, invalidation: e.target.value }))} placeholder="哪些事实变化会让当前想法无效？" rows={3} /></div><div className="form-field"><label>计划预算 <span className="optional">可留空</span></label><div className="input-with-prefix"><span>¥</span><input type="number" min="0" value={planDraft.budget} onChange={e => setPlanDraft(d => ({ ...d, budget: e.target.value }))} placeholder="不代表已买入" /></div></div><div className="form-field span-2"><label>补充说明</label><textarea value={planDraft.notes} onChange={e => setPlanDraft(d => ({ ...d, notes: e.target.value }))} placeholder="当时的判断、之后要复核的问题…" rows={2} /></div><div className="form-actions span-2"><span><ShieldAlert size={14} />保存计划不会下单，也不改变账本。</span><button className="button button-primary" type="submit" disabled={!!busy || !instruments.length}>{busy === '正在保存预案…' ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存预案</button></div></form></section>
              <section className="card plans-card"><div className="card-top"><div><div className="section-kicker">已保存的预案</div><div className="card-sub">按标的记录，便于之后回看判断。</div></div><span className="count-pill">{data.plans.length} 条</span></div>{data.plans.length ? <div className="plan-list">{[...data.plans].sort((a,b) => b.date.localeCompare(a.date)).map((p,i) => <article key={p.id || i} className="plan-item"><div className={`plan-action action-${p.action}`}>{p.action === 'observe' ? '观察' : p.action === 'consider' ? '有条件考虑' : '不交易'}</div><div className="plan-title-row"><b>{instrumentById[p.instrument_id]?.name || p.instrument_id}</b><time>{p.date}</time></div>{p.observation && <p>{p.observation}</p>}<div className="plan-criteria">{p.buy_condition && <span><b>考虑条件：</b>{p.buy_condition}</span>}{p.exit_condition && <span><b>退出条件：</b>{p.exit_condition}</span>}{p.invalidation && <span><b>失效条件：</b>{p.invalidation}</span>}{p.budget != null && <span><b>计划预算：</b>{yuan(p.budget)}</span>}</div>{p.notes && <div className="plan-notes">{p.notes}</div>}<PlanRecords plan={p} transactions={data.transactions} /><div className="plan-only-note">这是一条预案记录，不代表发生过交易。</div></article>)}</div> : <EmptyState icon={CalendarDays} title="还没有预案" text="从写下一个观察条件开始。空白也是有效的工作台状态。" />}</section></div>
          </>}

          {tab === 'assets' && <>
            <PageTitle kicker="PERSONAL LEDGER" title="资产复盘" sub="仅按你记录的真实成交和现金流计算。行情不完整时，盈亏不作完整结论。" action={<button className="button button-secondary" onClick={() => setHistoryOpen(v => !v)}><FileUp size={15} />导入历史数据</button>} />
            <AccountContextCard context={data.account_context} instruments={instruments} lossLimit={data.profile.loss_limit} onEdit={() => { setAccountEditOpen(true); setSettingsOpen(true) }} />
            <div className="assets-banner"><div className="banner-icon"><Wallet size={18} /></div><div><b>{data.opening ? '基准账本已登记' : data.profile.holdings_confirmed ? '历史账本已确认' : '初始持仓未核对'}</b><span>{data.opening ? `基准日 ${data.opening.date} · 起始现金 ${yuan(data.opening.cash)}；参考价不是成交价。` : data.profile.holdings_confirmed ? '账本会依据已核对的历史记录计算。' : '先登记基准日的真实现金和持仓，或完整补齐历史记录后再确认。'}</span></div><button className="text-action" onClick={() => { setSettingsOpen(true); void loadBackups() }}>账本设置 <ArrowUpRight size={14} /></button></div>
            <div className="assets-stats"><StatCard label={data.profile.holdings_confirmed ? "账户总权益" : "账本权益（待核对）"} value={!data.profile.holdings_confirmed ? '待核对' : portfolio?.total_equity == null ? '待补充' : yuan(portfolio.total_equity)} caption={portfolio?.total_equity_estimated ? '估算值 · 含现金与最新行情估值' : '现金 + 按有效行情估值的持仓'} icon={Wallet} /><StatCard label="账面现金" value={!data.profile.holdings_confirmed ? '待核对' : portfolio?.cash == null ? '待补充' : yuan(portfolio.cash)} caption={portfolio?.cash_estimated ? '估算账面现金' : '按实际记账现金流计算'} icon={ArrowLeftRight} /><StatCard label="账本基准 + 净入金" value={!data.profile.holdings_confirmed ? '待核对' : portfolio?.net_contributions == null ? '待补充' : yuan(portfolio.net_contributions)} caption="从开账基准起算；不代表全部历史投入，也不含场外备用资金" icon={ArrowLeftRight} /><StatCard label="工作台期间损益" value={data.profile.holdings_confirmed && portfolio?.valuation_complete && portfolio.total_pnl != null ? yuan(portfolio.total_pnl) : '数据未齐'} caption="从账本基准开始的权益变化" icon={Activity} tone={changeTone(portfolio?.total_pnl)} /><StatCard label="起始持仓浮盈" value={!data.profile.holdings_confirmed ? '待核对' : !data.opening ? '不适用' : portfolio?.opening_pnl == null ? '待补充' : yuan(portfolio.opening_pnl)} caption="仅使用已知实际买入成本核算；不用券商摊薄成本" icon={Activity} tone={changeTone(portfolio?.opening_pnl)} /><StatCard label="最大回撤" value={data.profile.holdings_confirmed ? pct(portfolio?.drawdown_pct) : '待补充'} caption="净值曲线下的历史峰值回落" icon={ArrowDownLeft} /></div>
            <AllocationChart portfolio={portfolio} pending={portfolio?.pending} confirmed={data.profile.holdings_confirmed} />
            <section className="card equity-card"><div className="card-top"><div><div className="section-kicker">权益与资金流</div><div className="card-sub">只绘制完整的实际权益观察；追加本金单独显示，不计为盈利。</div></div><span className="count-pill">{data.profile.holdings_confirmed && portfolio?.valuation_complete ? `${portfolio?.equity_curve?.length || 0} 个观察日` : '账本基准待核对'}</span></div><EquityChart rows={data.profile.holdings_confirmed && portfolio?.valuation_complete ? portfolio?.equity_curve || [] : []} /><div className="performance-grid"><StatCard label="个人月目标" value={`${data.profile.monthly_goal_min}%–${data.profile.monthly_goal_max}%`} caption="目标记录，不是收益预测" icon={Gauge} /><StatCard label="本月实际收益率" value={data.profile.holdings_confirmed && portfolio?.valuation_complete ? pct(portfolio?.monthly_return) : '待补充'} caption="缺月初基准或完整观察时待补充" icon={Activity} /><StatCard label="已记录手续费" value={yuan(portfolio?.total_fees)} caption={!data.transactions.length ? '尚无成交费用记录' : portfolio?.cash_estimated ? '有费用未填，此处仅为已记录部分' : '按成交单实际费用汇总'} icon={Wallet} /><StatCard label="已实现 / 浮动损益" value={`${yuan(portfolio?.realized_pnl)} / ${yuan(portfolio?.unrealized_pnl)}`} caption="开账后交易成本口径；不含截图基准备注中的历史已实现盈利" icon={Activity} /></div></section>
            <div className="ledger-method-note">已实现/未实现项目沿用后端账本口径；起始持仓自其券商成本以来的浮盈单列。估算权益会随行情更新，不等于券商实时资产。</div>
            {portfolio?.loss_triggered && <div className="loss-banner"><ShieldAlert size={18} /><div><b>累计净亏损已触及设置阈值</b><span>先暂停新增交易，复核成交记录、行情与风险承受能力。</span></div></div>}
            {historyOpen && <section className="card history-import"><div className="card-top"><div><div className="section-kicker">历史日线补充 · 最后兜底</div><div className="card-sub">优先使用自动行情；仅当自动数据确实不可用时导入CSV/JSON。</div></div><button className="icon-button" onClick={() => setHistoryOpen(false)}><X size={16} /></button></div><div className="inline-import"><InstrumentSelect items={instruments} selected={selected} onChange={setSelected} /><label className="file-picker"><FileUp size={14} />选择 CSV / JSON<input type="file" accept=".csv,.tsv,.json,text/csv,application/json" onChange={importFile('history')} /></label></div><textarea value={historyInput} onChange={e => setHistoryInput(e.target.value)} rows={5} placeholder="CSV首列日期，支持 date,open,high,low,close,volume,amount；或JSON rows 数组。" /><button className="button button-primary" onClick={() => void importHistory()} disabled={!historyInput || !selected || !!busy}>导入并注明手动来源</button></section>}
            <div className="content-grid assets-layout"><section className="card ledger-card"><div className="card-top"><div><div className="section-kicker">持仓明细</div><div className="card-sub">持仓只由真实成交和基金确认更新</div></div><span className="count-pill">{portfolio?.positions?.length || 0} 项</span></div>{portfolio?.positions?.length ? <div className="table-wrap"><table><thead><tr><th>标的</th><th>持有数量</th><th>平均成本</th><th>最新价格</th><th>市值</th><th>浮动盈亏</th><th>数据时间</th></tr></thead><tbody>{portfolio.positions.map((p,i) => { const item = instrumentById[p.instrument_id]; return <tr key={p.instrument_id || i}><td><b>{p.name || item?.name || p.instrument_id}</b><small>{p.instrument_id}</small></td><td>{quantityText(p.quantity, item)}</td><td>{priceText(p.average_cost, item)}</td><td>{priceText(p.price, item)}</td><td>{yuan(p.market_value)}</td><td className={changeTone(p.unrealized_pnl)}>{yuan(p.unrealized_pnl)}</td><td>{p.as_of || statusText(p.status)}</td></tr> })}</tbody></table></div> : <EmptyState icon={BriefcaseBusiness} title="当前没有已确认持仓" text="确认初始持仓或记录真实成交后，持仓才会显示。计划和行情不会自动加入账本。" />}{portfolio?.warnings?.length ? <div className="warning-list">{portfolio.warnings.map((w,i) => <span key={i}><CircleHelp size={13} />{w}</span>)}</div> : null}</section>
                <section id="actual-record" className="card transaction-card"><div className="section-kicker">记录账本</div><div className="card-sub">录入真实成交或现金流</div><form onSubmit={e => void submitTransaction(e)} className="tx-form"><div className="form-field"><label>记录类型</label><select value={txDraft.kind} onChange={e => setTxDraft(d => ({ ...d, kind: e.target.value }))}><option value="buy">买入成交</option><option value="sell">卖出成交</option><option value="deposit">入金</option><option value="withdraw">出金</option><option value="fund_pending">基金待确认</option><option value="fund_confirm">基金份额确认</option><option value="dividend">现金分红</option></select></div><div className="form-field"><label>发生日期</label><input type="date" value={txDraft.date} onChange={e => setTxDraft(d => ({ ...d, date: e.target.value }))} /></div>{['buy','sell','fund_pending','fund_confirm','dividend'].includes(txDraft.kind) && <div className="form-field"><label>标的</label><InstrumentSelect items={instruments} selected={txDraft.instrument_id} onChange={v => setTxDraft(d => ({ ...d, instrument_id: v, plan_id: '' }))} /></div>}{['buy','sell','fund_pending','fund_confirm'].includes(txDraft.kind) && <div className="form-field"><label>关联预案（可选）</label><select value={txDraft.plan_id} onChange={e => setTxDraft(d => ({ ...d, plan_id: e.target.value }))}><option value="">不关联预案</option>{data.plans.filter(p => p.instrument_id === txDraft.instrument_id).map((p,i) => <option key={p.id || i} value={p.id}>{p.date} · {p.action === 'observe' ? '观察' : p.action === 'consider' ? '有条件考虑' : '不交易'}</option>)}</select></div>}{txDraft.kind === 'fund_confirm' && <div className="form-field"><label>关联待确认记录</label><select value={txDraft.pending_id} onChange={e => setTxDraft(d => ({ ...d, pending_id: e.target.value }))}><option value="">选择待确认申购</option>{portfolio?.pending?.map((p,i) => <option key={p.pending_id || i} value={p.pending_id}>{p.name || p.instrument_id} · {p.date} · {yuan(p.amount)}</option>)}</select></div>}{['buy','sell','fund_confirm'].includes(txDraft.kind) && <div className="form-field two-fields"><div><label>份额 / 股数</label><input type="number" min="0" step="any" value={txDraft.quantity} onChange={e => setTxDraft(d => ({ ...d, quantity: e.target.value }))} placeholder="实际成交数量" /></div><div><label>成交价</label><input type="number" min="0" step="any" value={txDraft.price} onChange={e => setTxDraft(d => ({ ...d, price: e.target.value }))} placeholder="元" /></div></div>}{['deposit','withdraw','fund_pending','dividend'].includes(txDraft.kind) && <div className="form-field"><label>{txDraft.kind === 'fund_pending' ? '申购金额' : '现金金额'}</label><div className="input-with-prefix"><span>¥</span><input type="number" min="0" step="any" value={txDraft.amount} onChange={e => setTxDraft(d => ({ ...d, amount: e.target.value }))} placeholder="实际金额" /></div></div>}<div className="form-field"><label>实际费用 <span className="optional">可空，未填时保持未知</span></label><div className="input-with-prefix"><span>¥</span><input type="number" min="0" step="any" value={txDraft.fees} onChange={e => setTxDraft(d => ({ ...d, fees: e.target.value }))} placeholder="按成交单填写" /></div></div><div className="form-field"><label>备注</label><input value={txDraft.notes} onChange={e => setTxDraft(d => ({ ...d, notes: e.target.value }))} placeholder="订单号不要填写敏感账号" /></div><button className="button button-primary full" type="submit" disabled={!!busy}>{busy === '正在记录账本…' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}保存真实记录</button><div className="side-footnote">待确认基金申购不会增加份额；确认时填写实际份额和净值。</div></form></section></div>
            <section className="card transaction-history"><div className="card-top"><div><div className="section-kicker">交易与资金流水</div><div className="card-sub">历史记录来自云端账本</div></div><span className="count-pill">{data.transactions.length} 条</span></div>{data.transactions.length ? <div className="table-wrap"><table><thead><tr><th>日期</th><th>类型</th><th>标的</th><th>数量 / 金额</th><th>价格</th><th>费用</th><th>备注</th></tr></thead><tbody>{[...data.transactions].reverse().slice(0,20).map((t,i) => <tr key={t.id || i}><td>{t.date}</td><td><span className="pill tone-gray">{transactionLabel(t.kind)}</span></td><td>{instrumentById[t.instrument_id || '']?.name || t.instrument_id || '现金'}</td><td>{t.quantity != null ? quantityText(t.quantity, instrumentById[t.instrument_id || '']) : yuan(t.amount)}</td><td>{priceText(t.price, instrumentById[t.instrument_id || ''])}</td><td>{t.fees == null ? '待补充' : yuan(t.fees)}</td><td>{t.notes || '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon={ArrowLeftRight} title="还没有账本记录" text="先核对持仓和资金，再逐笔录入实际确认的成交。" />}</section>
          </>}

          {tab === 'funds' && <>
            <PageTitle kicker="ETF & FUND DESK" title="基金与 ETF" sub="ETF 是场内交易基金，价格随交易撮合变化；场外基金净值按基金公司公布口径确认。" action={<button className="button button-secondary" disabled={!fundItems.length || !!busy || jobActive} onClick={() => void refresh(fundItems.map(i => i.id))}><RefreshCw size={15} />刷新基金数据</button>} />
            <div className="etf-explainer"><div className="etf-icon"><Landmark size={19} /></div><div><b>先分清交易方式与数据口径</b><p>场内 ETF 可在交易时段按市场价格买卖，成交价与基金净值可能有折溢价；场外基金按申购规则，以后续公布净值确认份额。工作台首版只展示正式已公布净值，不把盘中估算当作事实。</p></div><button className="text-action" onClick={() => setTab('learn')}>查看入门解释 <ArrowUpRight size={14} /></button></div>
            {fundItems.length ? <div className="fund-grid">{fundItems.map(item => <FundCard key={item.id} item={item} snapshot={data.snapshots[item.id]} selected={selected === item.id} onSelect={() => setSelected(item.id)} onRemove={() => void removeWatch(item.id)} />)}</div> : <section className="card fund-empty"><EmptyState icon={Landmark} title="还未关注基金或 ETF" text="用明确类型搜索代码；同一个数字代码不会在 ETF、指数和基金之间混淆。" action={<div className="search-box wide"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索 ETF / 基金名称或代码" />{query && searchResults.length > 0 && <div className="search-popover">{searchResults.map(item => <button key={item.id} onClick={() => void addWatch(item)}><span className={`kind-dot ${kindTone(item.kind)}`} /><span><b>{item.name}</b><small>{kindName[item.kind]} · {item.code} · {item.exchange}</small></span><Plus size={14} /></button>)}</div>}</div>} /></section>}
            {selected && (current?.kind === 'etf' || current?.kind === 'fund') && <div className="content-grid fund-detail"><section className="card"><div className="card-top"><div><div className="section-kicker">所选基金数据</div><div className="card-sub">{current.name} · {snapshot?.valuation_kind === 'confirmed_nav' ? '正式公布净值' : current.kind === 'etf' ? '场内市场价格' : '净值待确认'}</div></div><StatusBadge status={snapshot?.status} valuationKind={snapshot?.valuation_kind} /></div><div className="fund-price-row"><div><span>{snapshot?.valuation_kind === 'confirmed_nav' ? '已公布净值' : '最新场内价格'}</span><b>{priceText(snapshot?.quote?.price, current)}</b><small>截至 {snapshot?.as_of || '日期待补充'}</small></div><div className={`change-chip ${changeTone(snapshot?.quote?.change_pct)}`}>{pct(snapshot?.quote?.change_pct)}<small>当日变化</small></div></div><MarketChart snapshot={snapshot} instrument={current} /><InfoLine status={snapshot?.status} asOf={snapshot?.as_of} fetchedAt={snapshot?.fetched_at} valuationKind={snapshot?.valuation_kind} quoteSource={snapshot?.quote_source || snapshot?.source} historySource={snapshot?.history_source} units={snapshot?.units} error={snapshot?.error || snapshot?.warnings?.join('；')} /></section><section className="card fund-facts"><div className="card-top"><div className="section-kicker">已接入的基金事实</div><button className="text-action" onClick={() => setTab('diagnosis')}>查看诊断与报告 <ArrowUpRight size={14} /></button></div><p className="card-sub">只展示来源明确的数据；未接入项保持待补充。</p>{snapshot?.fundamentals?.length ? <div className="fact-list">{snapshot.fundamentals.map((f,i) => <div className="fact-row" key={`${f.label}-${i}`}><span>{f.label}</span><b>{f.value == null ? '待补充' : `${f.value}${f.unit === '文本' ? '' : f.unit || ''}`}</b><small>{f.period || '期间待补充'} · {f.source || '来源待补充'}</small>{f.url && <a href={f.url} target="_blank" rel="noreferrer">原始来源 ↗</a>}</div>)}</div> : <div className="subtle-empty">基本面事实待接入；ETF 折溢价未获得可信数据时显示待补充。</div>}</section><section className="card side-card"><div className="section-kicker">基金申购与确认</div><h3>待确认不等于已持有</h3><p>记录场外基金申购时，选择“基金待确认”。确认份额后再选择“基金份额确认”，填写实际份额和确认净值。</p><button className="button button-primary full" onClick={() => { setTxDraft(d => ({ ...d, kind: current.kind === 'fund' ? 'fund_pending' : 'buy', instrument_id: selected })); setTab('assets') }}>记录申购或成交</button><div className="fund-status-grid"><span><small>份额 / 持有数</small><b>{portfolio?.positions?.find(p => p.instrument_id === selected)?.quantity != null ? quantityText(portfolio.positions.find(p => p.instrument_id === selected)?.quantity, current) : '待补充'}</b></span><span><small>持仓市值</small><b>{yuan(portfolio?.positions?.find(p => p.instrument_id === selected)?.market_value)}</b></span><span><small>估值口径</small><b>{snapshot?.valuation_kind === 'confirmed_nav' ? '确认净值' : current.kind === 'etf' ? '市场价格' : '待补充'}</b></span></div><div className="side-footnote">场外基金当日净值通常收盘后公布；刷新时间不代表净值日期。</div></section></div>}
          </>}

          {tab === 'learn' && <>
            <PageTitle kicker="LEARN WITH EVIDENCE" title="学习与复盘" sub="把指标翻译成能核验的话。你负责判断，工具负责把数据、时间和来源摆清楚。" />
            <div className="learn-grid"><article className="card learn-card wide-learn"><div className="learn-icon green"><Gauge size={17} /></div><div className="section-kicker">市场温度，不是天气预报</div><h2>温度计整理宏观、情绪与资金的当日判断。</h2><p>上涨/下跌家数是市场宽度。涨跌停与炸板率是情绪指标，但各数据源的口径和覆盖可能不同。数据不全时，先把结论留空，比用一个漂亮分数更诚实。</p><div className="learn-example"><span className="example-tag">理解方法</span><b>看数据 → 看口径 → 看来源日期 → 再写自己的观察</b><small>不把单日市场宽度等同于未来收益。</small></div></article><article className="card learn-card"><div className="learn-icon blue"><BarChart3 size={17} /></div><div className="section-kicker">看 ETF 之前</div><h2>它买的是什么？</h2><p>ETF 是一篮子资产的基金份额，在交易所撮合交易。先读基金名称、跟踪标的和官方文件，再理解价格与净值的关系。</p><button className="text-action" onClick={() => setTab('funds')}>查看基金面板 <ArrowUpRight size={14} /></button></article><article className="card learn-card"><div className="learn-icon violet"><Clock3 size={17} /></div><div className="section-kicker">盘前计划</div><h2>写条件，不写预测。</h2><p>把观察依据、考虑条件、退出条件和失效条件分开记录。条件没有出现，可以选择不做任何操作。</p><button className="text-action" onClick={() => setTab('plan')}>写一条预案 <ArrowUpRight size={14} /></button></article></div>
            <section className="card glossary"><div className="section-kicker">术语速查 · 点开看解释与例子</div><div className="glossary-grid"><Glossary term="仓位" meaning="某项资产市值占账户总权益的比例。它是对已持有金额的描述，不是买入建议。" example="账户权益 10,000 元，某 ETF 市值 2,000 元，仓位约 20%。" /><Glossary term="T+1 与 ETF 回转" meaning="普通 A 股买入后通常要到下一交易日才能卖出；部分 ETF 品种支持当日回转，需按具体品种和交易规则核对，不能把所有 ETF 一概而论。" example="下单前在同花顺核对证券简称、交易规则和可卖数量；上交所规则见官方条款。" source="https://www.sse.com.cn/lawandrules/sselawsrules2025/fund/trading/c/c_20260424_10817739.shtml" /><Glossary term="成交额" meaning="一段时间内成交金额的合计。它不是买入金额，也不表示后续走势。" example="日成交额 5 亿元，表示当天成交金额合计约 5 亿元。" /><Glossary term="净值" meaning="基金资产扣除负债后，按份额计算的价值。场外基金通常以管理人公布的净值确认成交。" example="基金页面显示 1.2345 元，须看净值日期和是否已正式公布。" /><Glossary term="折溢价" meaning="ETF 二级市场价格相对基金份额净值的差异。盘口价格不等于净值。" example="市场价高于参考净值时可能是溢价，仍要核对净值时点和口径。" /><Glossary term="复权" meaning="处理分红、拆分等因素后的历史价格序列。本工作台图区优先显示不复权价格，不用复权价做下单价。" example="除息后原始价格可能跳变，复权序列会调整历史值以便比较。" /><Glossary term="回撤" meaning="从历史权益高点到之后低点的下降幅度，是已发生波动的描述，不代表最大可能损失。" example="权益从 10,000 元降到 9,000 元，期间回撤 10%。" /><Glossary term="缓存行情" meaning="当前数据源暂时不可用时保留上次成功数据。页面会标记缓存和数据日期，不会显示成最新。" example="数据日期是周五而今天是周一，应先看市场是否休市和数据源状态。" /><Glossary term="待确认份额" meaning="基金申购后可能尚未公布确认份额和净值。待确认记录不会加入持仓，等实际确认再录入。" example="申购金额已记录，但直到确认份额和净值出现前，持有数量仍显示待确认。" /></div></section>
            <section className="card ths-checklist"><div className="section-kicker">同花顺操作检查卡</div><p>本工作台辅助整理信息，不会代替券商软件的可卖数量、委托校验或成交回报。</p><ol><li>核对证券代码、名称和市场；ETF 还要确认跟踪标的、交易规则与价格单位。</li><li>看清行情/净值日期、盘口价、买卖方向、数量和预计金额；费用按券商实际显示核验。</li><li>提交前由你在同花顺复核委托；只有看到真实成交回报后，才把成交写入本机账本。</li><li>普通 A 股通常 T+1；部分 ETF 可当日回转，按交易所规则和具体品种确认。</li></ol><div className="official-links"><a href="https://www.sse.com.cn/lawandrules/sselawsrules2025/fund/trading/c/c_20260424_10817739.shtml" target="_blank" rel="noreferrer">上交所基金交易规则 ↗</a><a href="https://investor.szse.cn/knowledge/fund/trade/t20171113_538865.html" target="_blank" rel="noreferrer">深交所 ETF 交易知识 ↗</a></div></section>
            <section id="report-import" className="card import-card"><div className="card-top"><div><div className="section-kicker">导入分析报告</div><div className="card-sub">导入报告与行情快照绑定；无分数时显示待补充。</div></div><FileUp size={17} className="muted-icon" /></div><label className="file-picker"><FileUp size={14} />选择 JSON 文件<input type="file" accept="application/json,.json" onChange={importFile('report')} /></label><textarea value={reportInput} onChange={e => setReportInput(e.target.value)} rows={6} placeholder="粘贴完整报告 JSON：report_type、snapshot_id、sections；报告保存时会校验关联品种和快照。" /><div className="import-actions"><button className="button button-primary" disabled={!reportInput || !!busy} onClick={() => void importReport()}>提交报告</button><button className="button button-secondary" onClick={() => void exportPackage(selected ? 'diagnosis' : 'market')}>导出分析包 JSON / 复制 Markdown</button></div></section>
          </>}
        </>}
      </div>
      <footer className="page-footer"><span>知行 · 理财投资</span><span>公开数据可能延迟或缺失 · 不构成投资建议 · 不执行交易</span></footer>
    </main>

    {settingsOpen && data && <div className="drawer-layer" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false) }}><aside className="settings-drawer"><div className="drawer-head"><div><div className="eyebrow">PROFILE & CLOUD SNAPSHOTS</div><h2>个人设置与云端快照</h2></div><button className="icon-button" aria-label="关闭设置" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div><div className="drawer-body"><AccountContextEditor draft={accountDraft} setDraft={setAccountDraft} busy={!!busy} open={accountEditOpen} setOpen={setAccountEditOpen} context={data.account_context} onSave={saveAccountContext} />{profileDraft && <form onSubmit={e => void saveProfile(e)} className="settings-form"><div className="section-kicker">资金与目标</div><div className="setting-field"><label>初始资金</label><div className="input-with-prefix"><span>¥</span><input type="number" value={profileDraft.initial_capital} onChange={e => setProfileDraft({ ...profileDraft, initial_capital: Number(e.target.value) })} /></div></div><div className="setting-field"><label>累计亏损提醒线</label><div className="input-with-prefix"><span>¥</span><input type="number" value={profileDraft.loss_limit} onChange={e => setProfileDraft({ ...profileDraft, loss_limit: Number(e.target.value) })} /></div><small>触及后提示暂停新增交易。</small></div><div className="two-fields"><div className="setting-field"><label>月目标下限 %</label><input type="number" step="0.1" value={profileDraft.monthly_goal_min} onChange={e => setProfileDraft({ ...profileDraft, monthly_goal_min: Number(e.target.value) })} /></div><div className="setting-field"><label>月目标上限 %</label><input type="number" step="0.1" value={profileDraft.monthly_goal_max} onChange={e => setProfileDraft({ ...profileDraft, monthly_goal_max: Number(e.target.value) })} /></div></div><div className="setting-field"><label>投资目的</label><textarea value={profileDraft.purpose} onChange={e => setProfileDraft({ ...profileDraft, purpose: e.target.value })} rows={2} placeholder="填写自己的目的，不用于自动推荐" /></div><div className="setting-field"><label>计划期限</label><input value={profileDraft.horizon} onChange={e => setProfileDraft({ ...profileDraft, horizon: e.target.value })} placeholder="例如：长期 / 1-2年" /></div><label className="checkbox-field"><input type="checkbox" checked={data.profile.holdings_confirmed} disabled readOnly /><span><b>{data.profile.holdings_confirmed ? '账本持仓已由服务端确认' : '账本持仓尚未确认'}</b><small>不能在偏好设置中直接勾选；请使用初始账本登记或完整历史记录确认入口。</small></span></label><div className="section-kicker setting-spacer">交易费用（按券商设置核实）</div><div className="fee-grid"><FeeInput label="佣金率（如 0.0003 = 万3）" value={profileDraft.commission_rate} onChange={v => setProfileDraft({ ...profileDraft, commission_rate: v })} /><FeeInput label="最低佣金（元）" value={profileDraft.minimum_commission} onChange={v => setProfileDraft({ ...profileDraft, minimum_commission: v })} /><FeeInput label="印花税率" value={profileDraft.stamp_tax_rate} onChange={v => setProfileDraft({ ...profileDraft, stamp_tax_rate: v })} /><FeeInput label="过户费率" value={profileDraft.transfer_fee_rate} onChange={v => setProfileDraft({ ...profileDraft, transfer_fee_rate: v })} /></div>{expenseUnset && <div className="inline-warning"><CircleHelp size={14} />费率还是 0；请按你的券商账单核实，不会假定真实费用为零。</div>}<button className="button button-primary full" type="submit" disabled={!!busy}><Check size={14} />保存个人设置</button></form>}
              <section className="opening-section">
                <div className="section-kicker">账本基准 · 记录真实起始状态</div>
                {data.opening ? <div className="opening-status"><b>基准日 {data.opening.date}</b><p>起始现金 {yuan(data.opening.cash)} · 基准权益 {yuan(data.opening.initial_equity)} · {data.opening.positions.length} 项持仓。</p><small>起始参考价用于基准估值，不是买入成交；实际买入平均成本未知时保持“待补充”；券商显示摊薄成本可能为负，单独保存在截图基准中，不能替代实际成本。</small></div>
                  : data.transactions.length === 0 ? <form className="opening-form" onSubmit={e => void initializeLedger(e)}><p>填入基准日现金和当时持仓，之后的期间损益才有明确起点。空值不会自动补成 0。</p><div className="setting-field"><label>基准日期</label><input type="date" value={openingDraft.date} onChange={e => setOpeningDraft(d => ({ ...d, date: e.target.value }))} required /></div><div className="setting-field"><label>起始现金（元）</label><input type="number" min="0" step="0.01" value={openingDraft.cash} onChange={e => setOpeningDraft(d => ({ ...d, cash: e.target.value }))} placeholder="填写当日真实现金" required /></div>
                    {openingDraft.positions.map((row,index) => <div className="opening-position-row" key={index}><div className="setting-field"><label>品种</label><InstrumentSelect items={instruments} selected={row.instrument_id} onChange={v => setOpeningDraft(d => ({ ...d, positions: d.positions.map((p,i) => i === index ? { ...p, instrument_id: v } : p) }))} /></div><div className="setting-field"><label>持有数量 / 份额</label><input type="number" min="0" step="any" value={row.quantity} onChange={e => setOpeningDraft(d => ({ ...d, positions: d.positions.map((p,i) => i === index ? { ...p, quantity: e.target.value } : p) }))} placeholder="按券商持仓" /></div><div className="setting-field"><label>实际买入平均成本（可空）</label><input type="number" min="0" step="any" value={row.average_cost} onChange={e => setOpeningDraft(d => ({ ...d, positions: d.positions.map((p,i) => i === index ? { ...p, average_cost: e.target.value } : p) }))} placeholder="可以留空；实际成本未知" /></div><div className="setting-field"><label>基准日参考价</label><input type="number" min="0" step="any" value={row.reference_price} onChange={e => setOpeningDraft(d => ({ ...d, positions: d.positions.map((p,i) => i === index ? { ...p, reference_price: e.target.value } : p) }))} placeholder="估值参考，不是成交" /></div><button className="button button-light remove-opening" type="button" onClick={() => setOpeningDraft(d => ({ ...d, positions: d.positions.filter((_,i) => i !== index) }))}>移除</button></div>)}
                    <button className="button button-secondary full" type="button" onClick={() => setOpeningDraft(d => ({ ...d, confirmed_empty: false, positions: [...d.positions, { instrument_id: '', quantity: '', average_cost: '', reference_price: '' }] }))}><Plus size={14} />添加持仓行</button><label className="checkbox-field"><input type="checkbox" checked={openingDraft.confirmed_empty} disabled={openingDraft.positions.some(p => p.instrument_id || p.quantity || p.average_cost || p.reference_price)} onChange={e => setOpeningDraft(d => ({ ...d, confirmed_empty: e.target.checked, positions: e.target.checked ? [] : d.positions.length ? d.positions : [{ instrument_id: '', quantity: '', average_cost: '', reference_price: '' }] }))} /><span><b>我确认基准日为空仓</b><small>只有确定没有任何持仓时才勾选；若填了持仓行，此项会禁用。</small></span></label><button className="button button-primary full" type="submit" disabled={!!busy}><Check size={14} />登记基准账本</button>
                  </form> : !data.profile.holdings_confirmed ? <div className="opening-status"><p>已有历史成交记录且尚无基准账本。请先补齐全部历史成交、现金流与当前持仓，再显式确认。</p><button className="button button-secondary full" type="button" onClick={() => void confirmHistoricalLedger()} disabled={!!busy}>我已补齐全部历史记录并确认</button></div> : <div className="opening-status">历史账本已由服务端确认；偏好设置不能更改此状态。</div>}
              </section>
              <div className="backup-section"><div className="section-kicker">云端快照</div>{pendingRestore && <div className="restore-review"><b>将恢复 {pendingRestore}</b><p>当前空间会先自动创建恢复前快照，再替换为选中快照中的记录。确认快照日期后继续。</p><div className="import-actions"><button className="button button-primary" disabled={!!busy} onClick={() => void restoreBackup(pendingRestore)}>确认恢复此快照</button><button className="button button-light" onClick={() => setPendingRestore(null)}>取消恢复</button></div></div>}<p>快照与恢复只作用于当前空间；恢复前服务会自动再创建一次快照。</p><button className="button button-secondary full" onClick={() => void createBackup()} disabled={!!busy}><CloudDownload size={15} />立即创建云端快照</button><button className="text-action" onClick={() => void loadBackups()}>读取快照列表 <RefreshCw size={13} /></button>{backupList.length ? <div className="backup-list">{backupList.map(item => <div key={item.name}><span><b>{item.name}</b><small>{dateTime(item.created_at)}</small></span><button className="button button-light" onClick={() => setPendingRestore(item.name)}>恢复</button></div>)}</div> : <div className="subtle-empty">{backupList.length === 0 ? '尚未加载快照列表。' : '没有可恢复快照。'}</div>}</div>
              <div className="health-section"><div className="section-kicker">数据源状态</div>{data?.source_health?.length ? data.source_health.map((s,i) => <div className="health-row" key={i}><span><i className={`health-dot ${s.status === 'ok' || s.status === 'healthy' ? 'healthy' : ''}`} />{s.source || s.provider || s.name || '数据源'}</span><small>{s.status || '未知'}{s.last_error ? ` · ${s.last_error}` : ''}</small></div>) : <div className="subtle-empty">数据源健康信息待补充。</div>}</div>
            </div></aside></div>}
  </div></div>
}

function AccountField({ label, value, onChange, type = 'text', step, placeholder }: { label: string; value: string; onChange: (value: string) => void; type?: string; step?: string; placeholder?: string }) { return <label className="setting-field"><span>{label}</span><input type={type} step={step} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label> }

function AccountContextEditor({ draft, setDraft, busy, open, setOpen, context, onSave }: { draft: AccountContextDraft; setDraft: Dispatch<SetStateAction<AccountContextDraft>>; busy: boolean; open: boolean; setOpen: (value: boolean) => void; context?: AccountContext | null; onSave: (event: FormEvent) => void }) {
  if (!context) return <section className="account-editor-section"><div className="account-context-head"><div><div className="section-kicker">账户资料</div><div className="card-sub">截图基准尚未由主流程录入；此处不开放不完整财务导入。</div></div></div></section>
  return <section className="account-editor-section"><div className="account-context-head"><div><div className="section-kicker">用途与场外备用资金</div><div className="card-sub">券商截图数字只读保留原基准。修改前请根据当前资料核对金额和到账时间。</div></div><button className="text-action" type="button" onClick={() => { setOpen(!open); if (!open) setDraft(accountContextDraft(context)) }}>{open ? '收起编辑' : '编辑'}</button></div>
    {open && <form className="account-editor-form" onSubmit={onSave}><div className="account-editor-grid"><AccountField label="场外备用资金（元）" value={draft.external_cash} type="number" step="any" onChange={v => setDraft(d => ({ ...d, external_cash: v }))} /><AccountField label="预计到账时长（小时，可空）" value={draft.external_available_hours} type="number" step="any" onChange={v => setDraft(d => ({ ...d, external_available_hours: v }))} /><AccountField label="可能用钱期限" value={draft.horizon} placeholder="按实际计划填写；未知可留空" onChange={v => setDraft(d => ({ ...d, horizon: v }))} /><AccountField label="账户资料用途（可空）" value={draft.purpose} placeholder="未知可留空" onChange={v => setDraft(d => ({ ...d, purpose: v }))} /></div><div className="account-editor-warning">场外金额不属于券商现金、基金持仓或工作台账本净入金。券商截图中的成本与盈亏由基准卡单独保留。账户资料用途不会自动改个人交易目的；若需要预算数量核验，请在个人设置中明确补齐。</div><button className="button button-primary full" type="submit" disabled={busy}><Check size={14} />保存用途 / 备用资金</button></form>}
  </section>
}
function breadthPercent(part?: number | null, total?: number | null) { return part != null && total && total > 0 ? `${Math.min(100, Math.max(0, part / total * 100))}%` : '0%' }
function transactionLabel(kind: string) { return ({ buy: '买入成交', sell: '卖出成交', deposit: '入金', withdraw: '出金', fund_pending: '基金待确认', fund_confirm: '份额确认', dividend: '现金分红' } as Record<string,string>)[kind] || kind }
function StatusBadge({ status, valuationKind }: { status?: string | null; valuationKind?: string | null }) { const label = valuationKind === 'market_overview' ? status === 'fresh' ? '市场宽度已更新' : '市场宽度待补充' : valuationKind === 'confirmed_nav' ? status === 'fresh' ? '已公布净值' : status === 'stale' ? '已公布净值（非今日）' : statusText(status) : statusText(status); return <span className={`status-badge ${status === 'fresh' ? 'fresh' : status === 'stale' ? 'stale' : 'missing'}`}><i />{label}</span> }
function InfoLine({ status, asOf, fetchedAt, valuationKind, quoteSource, historySource, units, error }: { status?: string | null; asOf?: string | null; fetchedAt?: string | null; valuationKind?: string | null; quoteSource?: string | null; historySource?: string | null; units?: Snapshot['units']; error?: string | null }) { const label = valuationKind === 'market_overview' ? status === 'fresh' ? '市场宽度已更新' : '市场宽度待补充' : valuationKind === 'confirmed_nav' ? status === 'fresh' ? '已公布净值' : status === 'stale' ? '已公布净值（非今日）' : '暂无已公布净值' : status === 'fresh' ? '数据获取成功' : status === 'stale' ? '缓存行情' : '暂无可信数据'; return <div className={`info-line ${status === 'stale' ? 'stale-line' : ''}`}><span><i />{label} · 数据日期 {asOf || '待补充'} · 抓取时间 {dateTime(fetchedAt)} · 行情源 {sourceLabel(quoteSource)} · 日线源 {sourceLabel(historySource)}{units?.price ? ` · 价格单位 ${units.price}` : ''}{units?.volume ? ` · 成交量单位 ${units.volume}` : ''}{units?.amount ? ` · 成交额单位 ${units.amount}` : ''}</span>{error && (/https?:|Server error|WinError|offline|peer|socket/i.test(error) ? <details className="data-diagnostics"><summary>数据源暂不可用，保留带日期缓存或待补充 · 查看详情</summary><p>{error}</p></details> : <small title={error}>{error}</small>)}</div> }
function InstrumentSelect({ items, selected, onChange, placeholder = '选择标的' }: { items: Instrument[]; selected: string; onChange: (value: string) => void; placeholder?: string }) { return <select value={selected} onChange={e => onChange(e.target.value)}><option value="">{placeholder}</option>{items.map(i => <option key={i.id} value={i.id}>{kindName[i.kind]} · {i.name} · {i.code} ({i.exchange})</option>)}</select> }
function InstrumentCard({ item, snapshot, selected, onSelect, onRemove }: { item: Instrument; snapshot?: Snapshot; selected: boolean; onSelect: () => void; onRemove: () => void }) { return <article className={`watch-card ${selected ? 'selected' : ''}`}><button className="card-select" onClick={onSelect} aria-label={`打开${item.name}体检`}><div className="instrument-head"><span className={`pill ${kindTone(item.kind)}`}>{kindName[item.kind]}</span><StatusBadge status={snapshot?.status} valuationKind={snapshot?.valuation_kind} /></div><b className="instrument-name">{item.name}</b><span className="instrument-code">{item.code} <i>·</i> {item.exchange}</span><div className="instrument-price"><b>{priceText(snapshot?.quote?.price, item)}</b><strong className={changeTone(snapshot?.quote?.change_pct)}>{pct(snapshot?.quote?.change_pct)}</strong></div><div className="instrument-foot"><span>{snapshot?.as_of || '数据日期待补充'}</span><ArrowUpRight size={14} /></div></button><button className="remove-watch" title="从关注列表移除" aria-label="移除关注" onClick={onRemove}><X size={13} /></button></article> }
function FundCard({ item, snapshot, selected, onSelect, onRemove }: { item: Instrument; snapshot?: Snapshot; selected: boolean; onSelect: () => void; onRemove: () => void }) { return <article className={`fund-card ${selected ? 'selected' : ''}`}><button className="fund-card-main" onClick={onSelect}><div className="fund-card-head"><span className={`pill ${kindTone(item.kind)}`}>{kindName[item.kind]}</span><StatusBadge status={snapshot?.status} valuationKind={snapshot?.valuation_kind} /></div><b>{item.name}</b><span className="muted-text">{item.code} · {item.exchange}</span><div className="fund-card-price"><span>{snapshot?.valuation_kind === 'confirmed_nav' ? '已公布净值' : item.kind === 'etf' ? '最新市场价格' : '净值待确认'}</span><b>{priceText(snapshot?.quote?.price, item)}</b></div><strong className={changeTone(snapshot?.quote?.change_pct)}>{pct(snapshot?.quote?.change_pct)}<small> 数据日期 {snapshot?.as_of || '待补充'}</small></strong></button><button className="remove-watch" title="移除关注" onClick={onRemove}><X size={13} /></button></article> }
function Metric({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: string }) { return <div className="metric"><span>{label}</span><b className={tone}>{value}</b><small>{note}</small></div> }
function StatCard({ label, value, caption, icon: Icon, tone = '' }: { label: string; value: string; caption: string; icon: typeof Wallet; tone?: string }) { return <div className="card stat-card"><div className="stat-icon"><Icon size={16} /></div><span>{label}</span><b className={tone}>{value}</b><small>{caption}</small></div> }
function SourceRow({ label, value }: { label: string; value: string }) { return <div className="source-row"><span>{label}</span><b>{value}</b></div> }
function EmptyState({ icon: Icon, title, text, action }: { icon: typeof Search; title: string; text: string; action?: ReactNode }) { return <div className="empty-state"><div className="empty-icon"><Icon size={19} /></div><b>{title}</b><p>{text}</p>{action}</div> }
function PageTitle({ kicker, title, sub, action }: { kicker: string; title: string; sub: string; action?: ReactNode }) { return <div className="page-heading subpage-heading"><div><div className="eyebrow"><span className="eyebrow-dot" />{kicker}</div><h1>{title}</h1><p>{sub}</p></div>{action && <div className="heading-actions">{action}</div>}</div> }
function EvidenceList({ evidence }: { evidence: NonNullable<Snapshot['evidence']> }) { return <div className="evidence-list"><div className="subsection-title"><b>原始来源</b></div>{evidence.map(e => <a href={e.url} target="_blank" rel="noreferrer" key={e.id}><span className="evidence-type">{e.kind || '来源'}</span><b>{e.title}</b><small>{e.source || '来源待补充'} · {e.published_at || '日期待补充'}</small>{(e.summary || e.note) && <p>{e.summary || e.note}</p>}</a>)}</div> }
function ReportView({ report, currentSnapshotId }: { report: Report; currentSnapshotId?: string | null }) {
  const historical = isOldReport(report, currentSnapshotId)
  return <article className={`report-entry ${historical ? 'report-historical' : ''}`}>
    <div className="report-entry-head"><span className={`report-stamp ${historical ? 'historical-stamp' : ''}`}>{historical ? '历史 / 已失效快照' : '当前快照报告'}</span><span className="report-meta">{dateTime(report.created_at)} · 快照 {report.snapshot_id || '未绑定'}</span></div>
    <div className="report-score"><div className="score-number">{report.score ?? '—'}<small>{report.score == null ? '分数待补充' : '/ 100'}</small></div><span className="score-band">{report.score_label || scoreInterval(report.score)}</span></div>
    <p className="report-conclusion">{report.conclusion || '报告尚未填写结论。'}</p>
    {(report.strategy || report.position_range) && <div className="report-summary-fields">{report.strategy && <p><b>策略说明</b>{report.strategy}</p>}{report.position_range && <p><b>仓位区间</b>{report.position_range}</p>}</div>}
    {report.sections?.length ? <div className="report-sections">{report.sections.map((section,index) => <section key={`${section.title}-${index}`}><h4>{section.title || `分析部分 ${index + 1}`}</h4><p>{section.body || '内容待补充。'}</p></section>)}</div> : <div className="subtle-empty">报告分项尚未填写。</div>}
    {report.sources?.length ? <div className="report-sources">{report.sources.map((source,index) => /^https?:\/\//i.test(source) ? <a key={`${source}-${index}`} href={source} target="_blank" rel="noreferrer">来源 {index + 1} ↗</a> : <span key={`${source}-${index}`}>{source}</span>)}</div> : null}
  </article>
}
function PlanRecords({ plan, transactions }: { plan: Plan; transactions: Transaction[] }) {
  const linked = transactions.filter(t => plan.id && t.plan_id === plan.id)
  if (!linked.length) return <div className="plan-records">关联真实成交：尚无记录{plan.budget != null ? ` · 计划预算 ${yuan(plan.budget)}` : ''}</div>
  const values = linked.map(t => typeof t.amount === 'number' ? t.amount : typeof t.quantity === 'number' && typeof t.price === 'number' ? t.quantity * t.price : null)
  const known = values.filter((v): v is number => v != null && Number.isFinite(v))
  const sum = known.reduce((a,b) => a + b, 0)
  return <div className="plan-records"><b>关联真实记录 {linked.length} 条</b> · 记录金额 {known.length === linked.length ? yuan(sum) : `${yuan(sum)}（另有金额待补充）`}{plan.budget != null ? ` · 预算 ${yuan(plan.budget)} · 差额 ${known.length === linked.length ? yuan(plan.budget - sum) : '待补充'}` : ''}<small>关联只表示账本记录与预案相连，不代表预案条件已经满足。</small></div>
}
function Glossary({ term, meaning, example, source }: { term: string; meaning: string; example: string; source?: string }) { return <details className="glossary-item"><summary><b>{term}</b><ChevronDown size={14} /></summary><p>{meaning}</p><small>例子：{example}</small>{source && <a href={source} target="_blank" rel="noreferrer">查看官方规则 ↗</a>}</details> }
function FeeInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <div className="setting-field"><label>{label}</label><input type="number" min="0" step="any" value={value} onChange={e => onChange(Number(e.target.value))} /></div> }

export default App
