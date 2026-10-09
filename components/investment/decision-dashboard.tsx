import { useState } from 'react'
import {
  ArrowDownRight, ArrowRight, BookOpenCheck, ChartNoAxesCombined,
  CheckCircle2, CircleDollarSign, CircleHelp, Clock3, Eye, Hand, RefreshCw,
  Settings2, ShieldAlert, ShieldCheck, Sparkles, Target, Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AdviceAction, AdviceBundle, InstrumentAdvice } from './advice'

type DecisionDashboardProps = {
  advice?: AdviceBundle | null
  loading?: boolean
  busy?: boolean
  onRefresh: () => void
  onSettings: () => void
  onInspect: (id: string) => void
  onSavePlan: (item: InstrumentAdvice) => void
  onRecord: (id: string) => void
}

const actionMeta: Record<AdviceAction, { label: string; icon: LucideIcon; tone: string }> = {
  buy: { label: '考虑买入', icon: CircleDollarSign, tone: 'buy' },
  reduce: { label: '考虑减仓', icon: ArrowDownRight, tone: 'reduce' },
  hold: { label: '继续持有', icon: Hand, tone: 'hold' },
  watch: { label: '观望', icon: Eye, tone: 'watch' },
  wait: { label: '待核验', icon: CircleHelp, tone: 'wait' },
}

const overallMeta = {
  defend: { label: '防守', icon: ShieldAlert, tone: 'defend' },
  balanced: { label: '均衡', icon: ShieldCheck, tone: 'balanced' },
  watch: { label: '等待', icon: Clock3, tone: 'wait' },
} as const

const strengthLabel = { strong: '规则信号较强', neutral: '信号中性', weak: '信号较弱', unknown: '依据不足' } as const
const kindLabel: Record<string, string> = { etf: 'ETF', stock: '股票', fund: '场外基金', index: '指数' }
const statusLabel: Record<string, string> = { available: '已取得', complete: '完整', missing: '待补充', stale: '缓存数据', fresh: '最新已取得', partial: '部分覆盖', unavailable: '暂不可用' }
const dimensionLabel: Record<string, string> = { index: '指数趋势', indices: '指数趋势', breadth: '涨跌分布', sentiment: '市场情绪', macro: '宏观消息', flow: '资金数据', funds: '资金数据', index_trend: '指数技术趋势' }
const sourceLabel: Record<string, string> = { eastmoney: '东方财富', eastmoney_quote: '东方财富行情', eastmoney_history: '东方财富日线', tencent: '腾讯行情', tencent_quote: '腾讯行情', tencent_history: '腾讯日线', sina: '新浪行情', sina_history: '新浪日线', calculated: '依据历史行情计算' }

function displayNumber(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : '待补充'
}

function displayCompactNumber(value: number, digits = 2) {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

function displayMoney(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `¥${displayNumber(value)}` : '待补充'
}

function displayPrice(value: number | null, kind: string) {
  if (value == null || !Number.isFinite(value)) return '待补充'
  if (kind === 'index') return `${displayNumber(value)} 点`
  const digits = kind === 'etf' ? 3 : kind === 'fund' ? 4 : 2
  const unit = kind === 'stock' ? '股' : '份'
  return `¥${displayNumber(value, digits)}/${unit}`
}

function displayWeight(value: number | null) {
  return value == null || !Number.isFinite(value) ? '待补充' : `${displayNumber(value, 1)}%`
}

function displayTime(value: string | null | undefined) {
  if (!value) return '日期待补充'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(parsed)
}

function valueWithUnit(value: number | string | null, unit?: string) {
  return value == null ? '待补充' : `${typeof value === 'number' ? displayCompactNumber(value, unit?.includes('元') ? 6 : 2) : value}${unit || ''}`
}

export function DecisionDashboard({ advice, loading = false, busy = false, onRefresh, onSettings, onInspect, onSavePlan, onRecord }: DecisionDashboardProps) {
  const [watchlistOpen, setWatchlistOpen] = useState(false)

  if (!advice) {
    return <div className="decision-dashboard dh-empty-home">
      <header className="dh-page-head"><div><span className="dh-eyebrow">每日分析 · 自动规则</span><h1>今日建议</h1><p>先看市场环境，再核对自己的持仓；是否交易始终由你决定。</p></div><div className="dh-head-actions"><button className="dh-button dh-button-quiet" type="button" onClick={onSettings}><Settings2 size={15} />设置</button><button className="dh-button dh-button-primary" type="button" onClick={onRefresh} disabled={busy || loading}><RefreshCw size={16} className={loading ? 'dh-spin' : ''} />{loading ? '自动计算中…' : '生成今日建议'}</button></div></header>
      <section className="dh-empty-state" aria-live="polite"><div className="dh-empty-icon"><Sparkles size={22} /></div><h2>{loading ? '正在整理可用数据' : '自动建议尚未生成'}</h2><p>{loading ? '建议会基于当前行情、已确认账本和账户设置计算；缺失部分将保留待补充。' : '点击“生成今日建议”，系统将使用本机已经取得的数据自动计算，不需要手工粘贴分析报告。'}</p><small>不会生成模拟持仓、默认分数或券商订单。</small></section>
      {!loading && <RulesBoundary />}
    </div>
  }

  const overall = overallMeta[advice.overall.action]
  const OverallIcon = overall.icon
  const coverage = advice.market.coverage
  const coveragePct = coverage.total > 0 ? Math.max(0, Math.min(100, coverage.available / coverage.total * 100)) : 0

  return <div className="decision-dashboard">
    <header className="dh-page-head"><div><span className="dh-eyebrow"><span className="dh-live-dot" />每日分析 · {advice.as_of || '日期待补充'}</span><h1>今天，先做什么？</h1><p>把自动分析的结论放在前面，具体理由和资料仍可逐项核对。</p></div><div className="dh-head-actions"><button className="dh-button dh-button-quiet" type="button" onClick={onSettings}><Settings2 size={15} />设置</button><button className="dh-button dh-button-primary" type="button" onClick={onRefresh} disabled={busy || loading}><RefreshCw size={15} className={loading ? 'dh-spin' : ''} />{loading ? '更新中…' : '刷新并重算'}</button></div></header>

    <section className={`dh-hero dh-hero-${overall.tone}`} aria-labelledby="dh-overall-title">
      <div className="dh-hero-main"><div className="dh-hero-kicker"><OverallIcon size={17} />今日建议 · {overall.label}</div><h2 id="dh-overall-title">{advice.overall.title || overall.label}</h2><p>{advice.overall.summary || '综合依据不足，先核对数据覆盖和具体持仓。'}</p><div className="dh-hero-meta"><span><Clock3 size={13} />分析日期 {advice.as_of || '待补充'}</span><span>自动整理于 {displayTime(advice.generated_at)}</span><span className="dh-buy-gate">{advice.overall.buying_allowed ? '新增买入仍需逐项核验' : '新增买入条件未通过'}</span></div></div>
      <div className="dh-hero-side"><div className="dh-temp-label">市场温度</div><strong>{advice.market.score == null ? '待补充' : displayNumber(advice.market.score, 0)}</strong><span>{advice.market.score_label || (advice.market.score == null ? '评分依据待补充' : advice.market.label || '市场环境描述')}</span><small>温度描述市场环境，不是上涨概率或建议成功率。</small></div>
    </section>

    <section className="dh-positions-section"><div className="dh-section-title"><div><span className="dh-eyebrow">优先检查</span><h2>你的持仓 · 怎么做</h2><p>先看行动和条件，展开卡片可核对价格依据及失效情形。</p></div><span className="dh-count-pill">{advice.holdings.length} 项真实持仓</span></div>
      {advice.holdings.length ? <div className="dh-position-list">{advice.holdings.map(item => <PositionCard key={item.decision_id} item={item} busy={busy} onInspect={onInspect} onSavePlan={onSavePlan} onRecord={onRecord} />)}</div> : <div className="dh-inline-empty">没有已确认的持仓建议。请在资产页面记录实际持仓。</div>}
    </section>

    <div className="dh-summary-row">
      <section className="dh-card dh-market-card"><div className="dh-card-head"><div><span className="dh-section-label"><ChartNoAxesCombined size={15} />市场依据</span><p>{advice.market.label || '市场维度待整理'} · {advice.market.data_status === 'stale' ? '含缓存数据' : advice.market.data_status === 'complete' ? '覆盖完整' : advice.market.data_status === 'partial' ? '部分覆盖' : '数据待补充'}</p></div><span className="dh-date-chip">{advice.as_of || '日期待补充'}</span></div>
        <div className="dh-coverage"><div className="dh-coverage-title"><span>可用分析维度</span><b>{coverage.total > 0 ? `${coverage.available} / ${coverage.total}` : '待补充'}</b></div><div className="dh-coverage-track" role="img" aria-label={coverage.total > 0 ? `可用分析维度 ${coverage.available} 项，共 ${coverage.total} 项` : '分析维度覆盖待补充'}><i style={{ width: `${coveragePct}%` }} /></div><small>数据覆盖范围，不代表获利概率。</small></div>
        <div className="dh-dimensions">{advice.market.dimensions.length ? advice.market.dimensions.map(dimension => <article className="dh-dimension" key={dimension.key}><div><b>{dimension.label}</b><span className={`dh-dimension-status ${dimension.status === 'available' || dimension.status === 'complete' ? 'is-available' : ''}`}>{statusLabel[dimension.status] || '待核验'}</span></div><p>{dimension.summary || '该项依据待补充。'}</p>{dimension.value !== dimension.summary && <small>{valueWithUnit(dimension.value)}</small>}</article>) : <div className="dh-inline-empty">市场分析维度待补充；已取得的指数趋势仍可在关注列表中查看。</div>}</div>
        {!!coverage.missing.length && <details className="dh-missing-details"><summary>查看缺失的 {coverage.missing.length} 项数据</summary><p>{coverage.missing.map(key => dimensionLabel[key] || key).join('、')}</p></details>}
      </section>
      <section className="dh-card dh-today-steps"><div className="dh-card-head"><div><span className="dh-section-label"><BookOpenCheck size={15} />今天三步</span><p>建议是核对顺序，不是自动下单流程。</p></div></div><ol><li><i>1</i><span><b>看自动建议</b><small>先读总判断和自己的持仓卡。</small></span><CheckCircle2 size={16} /></li><li><i>2</i><span><b>打开同花顺核对</b><small>重新确认行情、可卖份额和费用。</small></span><ArrowRight size={16} /></li><li><i>3</i><span><b>只记录实际成交</b><small>没有成交时，不要把预案记成交易。</small></span><Wallet size={16} /></li></ol><div className="dh-no-order-note"><ShieldCheck size={14} />建议不会连接券商，也不会替你提交委托。</div></section>
    </div>

    {!!advice.overall.blockers.length && <section className="dh-blocker-strip"><ShieldAlert size={16} /><div><b>行动前还有条件需要核验</b><span>{advice.overall.blockers.slice(0, 3).join('；')}</span></div></section>}

    {!!advice.actions.length && <section className="dh-action-list"><div className="dh-section-title"><div><h2>还需核对</h2><p>先处理影响判断的条件。</p></div></div><div className="dh-action-grid">{advice.actions.slice(0, 3).map(item => <article key={item.id} className="dh-action-item"><Target size={16} /><div><b>{item.title}</b><p>{item.description}</p></div>{item.kind === 'configure' ? <button type="button" onClick={onSettings} aria-label={`设置：${item.title}`}><ArrowRight size={15} /></button> : item.kind === 'refresh' ? <button type="button" disabled={busy || loading} onClick={onRefresh} aria-label={`刷新：${item.title}`}><RefreshCw size={15} /></button> : item.instrument_id ? <button type="button" onClick={() => onInspect(item.instrument_id!)} aria-label={`查看：${item.title}`}><ArrowRight size={15} /></button> : null}</article>)}</div></section>}

    <details className="dh-watchlist-fold" open={watchlistOpen} onToggle={event => setWatchlistOpen(event.currentTarget.open)}><summary><span><Eye size={16} />观察池</span><small>{advice.watchlist.length} 项 · 默认收起</small></summary><div className="dh-watchlist-intro">观察信号用于挑选下一步要核对的资料，不代表上涨胜率；验证种子和接口关注项不等于个性化选股。候选仅供观察与条件核验，不是立即买入指令。</div>{advice.watchlist.length ? <div className="dh-position-list">{advice.watchlist.map(item => <PositionCard key={item.decision_id} item={item} busy={busy} onInspect={onInspect} onSavePlan={onSavePlan} onRecord={onRecord} />)}</div> : <div className="dh-inline-empty">观察池为空；没有自动补入标的。</div>}</details>

    <RulesBoundary advice={advice} />
    <footer className="dh-disclaimer">{advice.disclaimer || '规则化研究辅助，不是收益预测或个性化投资建议。交易前请在券商软件核对。'}</footer>
  </div>
}

function PositionCard({ item, busy, onInspect, onSavePlan, onRecord }: { item: InstrumentAdvice; busy: boolean; onInspect: (id: string) => void; onSavePlan: (item: InstrumentAdvice) => void; onRecord: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const meta = actionMeta[item.action]
  const Icon = meta.icon
  const reasons = item.reasons.filter(Boolean).slice(0, 2)
  return <article className={`dh-position-card dh-action-${meta.tone}`}>
    <div className="dh-position-main"><div className="dh-position-heading"><div className="dh-position-name"><h3>{item.name || '名称待补充'}</h3><span>{item.instrument_id.split(':').slice(1).join(' · ')} · {kindLabel[item.kind] || '品种待核验'}</span></div><span className={`dh-decision-badge dh-badge-${meta.tone}`}><Icon size={15} />{item.action_label || meta.label}</span></div>
      <p className="dh-position-headline">{item.headline || '建议依据待补充，请先核对这项数据。'}</p>
      <div className="dh-position-stats"><span><small>当前价格</small><b>{displayPrice(item.current_price, item.kind)}</b></span><span><small>持仓占比</small><b>{item.held ? displayWeight(item.weight_pct) : '非持仓'}</b></span><span><small>数据日期</small><b>{item.as_of || '待补充'}</b></span><span><small>规则信号</small><b className={`dh-strength dh-strength-${item.strength}`}>{strengthLabel[item.strength]}</b></span></div>
      <div className="dh-reason-list">{reasons.length ? reasons.map((reason, index) => <div key={`${item.decision_id}-reason-${index}`}><i>{index + 1}</i><span>{reason}</span></div>) : <div className="dh-no-reasons"><CircleHelp size={14} />具体依据待补充，不据此采取操作。</div>}</div>
      {!!item.blockers.length && <div className="dh-card-blocker"><ShieldAlert size={14} /><span>{item.blockers.slice(0, 2).join('；')}</span></div>}
      <div className="dh-position-actions"><button type="button" className="dh-button dh-button-primary" onClick={() => onInspect(item.instrument_id)}><ChartNoAxesCombined size={14} />查看图表</button><button type="button" className="dh-button dh-button-quiet" onClick={() => onSavePlan(item)} disabled={busy}><BookOpenCheck size={14} />保存条件预案</button><button type="button" className="dh-button dh-button-outline" onClick={() => onRecord(item.instrument_id)}><Wallet size={14} />记录实际成交</button><button type="button" className="dh-expand-button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起详情' : '展开证据与风险'}<ArrowRight size={14} className={expanded ? 'dh-expanded-arrow' : ''} /></button></div>
    </div>
    {expanded && <div className="dh-position-details"><div className="dh-detail-columns"><section><h4>数据证据</h4>{item.evidence.length ? <ul className="dh-evidence-list">{item.evidence.map((evidence, index) => <li key={`${item.decision_id}-evidence-${index}`}><b>{evidence.label}</b><span>{valueWithUnit(evidence.value, evidence.unit)}</span><small>{sourceLabel[evidence.source || ''] || evidence.source || '来源待补充'} · {evidence.date || '日期待补充'}</small>{evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">查看原始来源 ↗</a>}</li>)}</ul> : <p className="dh-detail-empty">证据记录待补充。</p>}</section>
          <section><h4>风险与阻塞</h4>{item.risks.length || item.blockers.length ? <ul className="dh-plain-list">{[...item.blockers, ...item.risks].map((risk, index) => <li key={`${item.decision_id}-risk-${index}`}>{risk}</li>)}</ul> : <p className="dh-detail-empty">未提供风险清单；请结合公告和自身情况核对。</p>}</section></div>
        <section className="dh-trigger-section"><h4>条件与失效情形</h4>{item.triggers.length ? <div className="dh-trigger-list">{item.triggers.map((trigger, index) => <div key={`${item.decision_id}-trigger-${index}`}><b>{trigger.label}</b><strong>{displayPrice(trigger.price, item.kind)}</strong><span>{trigger.condition || '触发条件待补充'}</span></div>)}</div> : <p className="dh-detail-empty">触发价位待补充；不要自行把缺失价格当作条件。</p>}<div className="dh-plan-fields"><span><b>观察：</b>{item.plan.observation || '待补充'}</span><span><b>考虑条件：</b>{item.plan.buy_condition || '待补充'}</span><span><b>退出条件：</b>{item.plan.exit_condition || '待补充'}</span><span><b>失效条件：</b>{item.plan.invalidation || '待补充'}</span><span><b>预算：</b>{displayMoney(item.plan.budget)}{item.plan.budget == null ? '' : ' · 不是买入金额指令'}</span></div></section>
        <div className="dh-source-date">报价日期 {item.as_of || '待补充'} · 日线日期 {item.history_as_of || '待补充'} · {statusLabel[item.status] || '数据需核验'}</div>
      </div>}
    <div className="dh-card-foot"><span>{item.held ? `真实账本持仓 · ${displayNumber(item.quantity, item.kind === 'fund' ? 4 : 0)} ${item.kind === 'stock' ? '股' : '份'}` : '非持仓观察项'}</span><button type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? '收起建议详情' : '展开建议详情'}>{expanded ? '收起' : '查看详情'} <ArrowRight size={13} /></button></div>
  </article>
}

function RulesBoundary({ advice }: { advice?: AdviceBundle | null }) {
  return <details className="dh-rules-boundary"><summary><span><ShieldCheck size={15} />规则与边界</span><small>透明规则 · 尚未回测验证</small></summary><div className="dh-boundary-content"><p>{advice?.engine.title || '每日建议由透明规则自动生成，不依赖手工报告。'} · 版本 {advice?.engine.version || '待补充'}。当前规则未经收益回测验证，不代表未来表现。</p>{!!advice?.engine.assumptions.length && <section><b>规则假设</b><ul>{advice.engine.assumptions.map((item, index) => <li key={`assumption-${index}`}>{item}</li>)}</ul></section>}{!!advice?.engine.limitations.length && <section><b>已知限制</b><ul>{advice.engine.limitations.map((item, index) => <li key={`limitation-${index}`}>{item}</li>)}</ul></section>}<p>系统不生成交易数量、不读取券商账户、不执行委托；数据缺失、成本未知或条件不全时按待补充处理。</p></div></details>
}

export default DecisionDashboard
