import { createHash } from 'node:crypto';
import {
  contextId,
  freshness,
  summarizeInvestment,
  todayShanghai,
  type Instrument,
  type InvestmentState,
  type Snapshot,
} from './investment-domain.ts';

/** Deterministic, non-executing advice produced from the current local state. */
export type AdviceAction = 'buy' | 'reduce' | 'hold' | 'watch' | 'wait';
export type AdviceEvidence = {
  label: string;
  value: number | string | null;
  unit?: string;
  source?: string | null;
  date?: string | null;
  url?: string | null;
};
export type AdviceTrigger = { label: string; price: number | null; condition: string };
export type AdvicePlan = {
  action: 'observe' | 'consider' | 'no_trade';
  observation: string;
  buy_condition: string;
  exit_condition: string;
  invalidation: string;
  budget: number | null;
  notes: string;
};
export type InstrumentAdvice = {
  decision_id: string;
  instrument_id: string;
  name: string;
  kind: string;
  held: boolean;
  quantity: number | null;
  weight_pct: number | null;
  current_price: number | null;
  as_of: string | null;
  history_as_of: string | null;
  status: string;
  action: AdviceAction;
  action_label: string;
  headline: string;
  strength: 'strong' | 'neutral' | 'weak' | 'unknown';
  reasons: string[];
  risks: string[];
  blockers: string[];
  triggers: AdviceTrigger[];
  evidence: AdviceEvidence[];
  plan: AdvicePlan;
};
export type AdviceMarketDimension = {
  key: string;
  label: string;
  status: string;
  summary: string;
  value: number | string | null;
};
export type AdviceMarket = {
  label: string;
  data_status: 'complete' | 'partial' | 'missing' | 'stale';
  score: number | null;
  score_label: string | null;
  coverage: { available: number; total: number; missing: string[] };
  dimensions: AdviceMarketDimension[];
};
export type AdviceBundle = {
  as_of: string;
  generated_at: string;
  context_id: string;
  engine: {
    version: string;
    kind: 'transparent_rules';
    title: string;
    validation: 'unvalidated';
    limitations: string[];
    assumptions: string[];
  };
  overall: {
    action: 'defend' | 'balanced' | 'watch';
    title: string;
    summary: string;
    buying_allowed: boolean;
    blockers: string[];
  };
  market: AdviceMarket;
  holdings: InstrumentAdvice[];
  watchlist: InstrumentAdvice[];
  actions: { id: string; priority: number; title: string; description: string; instrument_id?: string; kind: 'review' | 'configure' | 'refresh' }[];
  disclaimer: string;
};

export const INVESTMENT_ADVICE_RULE_VERSION = 'auto-advice-v1';
export const INVESTMENT_ADVICE_CONCENTRATION_LIMIT_PCT = 35;

const ENGINE_LIMITATIONS = [
  '规则仅用可核验行情与账本事实，不是收益预测，也未经过历史收益验证。',
  '建议不构成投资或交易指令；不会生成数量、委托或成交。',
  '当前集成提供的腾讯股票/ETF日线为不复权价格口径；均线与动量是该价格口径的技术信号。',
  '不复权价格会受现金分红、拆并股和除权除息影响；发生这些公司行动时需复核，本规则不把技术信号解释为含分红总回报。',
  '场外基金只观察正式净值，不套用场内量能和买卖规则。',
  '跨境/黄金等ETF若缺同日IOPV与折溢价，只列核验风险，不推断高溢价。',
  '截图显示成本、券商摊薄成本和场外备用资金不进入收益或可用现金计算。',
];
const ENGINE_ASSUMPTIONS = [
  '趋势阈值：现价同时低于MA20与MA60视为弱势；强势要求现价>MA20>MA60且20日动量为正。阈值未经收益验证。',
  '集中度提示使用35%默认假设，不代表用户风险偏好或个性化风险上限。',
  'ETF买入候选要求同日IOPV可计算折溢价；只在折溢价不高于0.5%时通过此项核验。0.5%为首版保守规则假设。',
  '非持仓品种必须带 personalized=true 才进入个性化候选池。',
];

type AnyRecord = Record<string, unknown>;
type HistoryData = {
  rows: Array<{ date: string; close: number }>;
  history_as_of: string;
  ma20: number | null;
  ma60: number | null;
  momentum20: number | null;
};
type SnapshotHealth = {
  snapshot: AnyRecord;
  quote: AnyRecord;
  price: number | null;
  as_of: string | null;
  history: HistoryData | null;
};
type PortfolioPosition = AnyRecord & { instrument_id?: string };

function record(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}
function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean' || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDay(value: unknown): string | null {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > days) return null;
  return text;
}

function dayNumber(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
}

function usableSource(value: unknown) {
  const source = String(value || '').trim().toLowerCase();
  return !!source && source !== 'unknown' && source !== 'missing' && !source.startsWith('manual');
}

function identityOk(instrument: unknown) {
  const item = record(instrument);
  const kind = item.kind;
  const exchange = item.exchange;
  const code = String(item.code || '');
  return ['stock', 'etf', 'fund', 'index'].includes(String(kind))
    && ['SH', 'SZ', 'OF'].includes(String(exchange))
    && /^\d{6}$/.test(code)
    && item.id === `${String(kind)}:${String(exchange)}:${code}`
    && ((kind === 'fund' && exchange === 'OF') || (kind !== 'fund' && exchange !== 'OF'));
}

function supportedLotRule(instrument: unknown) {
  if (!identityOk(instrument)) return false;
  const item = record(instrument);
  const kind = item.kind, exchange = item.exchange, code = String(item.code);
  if (kind === 'etf') return true;
  if (kind === 'stock' && exchange === 'SH') return /^(600|601|603|605)\d{3}$/.test(code);
  if (kind === 'stock' && exchange === 'SZ') return /^(000|001|002|003)\d{3}$/.test(code);
  return false;
}

function jsonStable(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonStable).join(',')}]`;
  if (typeof value === 'object') {
    const item = value as AnyRecord;
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${jsonStable(item[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

function digest(value: unknown) {
  return createHash('sha256').update(jsonStable(value), 'utf8').digest('hex').slice(0, 24);
}

function pick(value: AnyRecord, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, value[key] === undefined ? null : value[key]]));
}

function historyData(snapshot: AnyRecord, analysisDay: string, requireTrend = true): { data: HistoryData | null; error: string | null } {
  const rows = snapshot.history;
  if (!Array.isArray(rows) || !rows.length) return { data: null, error: '缺少日线/净值历史' };
  const clean: Array<{ date: string; close: number }> = [];
  let lastDay: string | null = null;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { data: null, error: '历史记录格式无效' };
    const item = record(raw);
    const day = validDay(item.date);
    const close = numberValue(item.close);
    if (!day || close === null || close <= 0) return { data: null, error: '历史日期或收盘价无效' };
    if (lastDay !== null && day <= lastDay) return { data: null, error: '历史日期重复或未按升序排列' };
    clean.push({ date: day, close });
    lastDay = day;
  }
  const historyAsOf = validDay(snapshot.history_as_of) || clean[clean.length - 1].date;
  if (historyAsOf !== clean[clean.length - 1].date) return { data: null, error: '历史截止日期与末条记录不一致' };
  if (dayNumber(historyAsOf) > dayNumber(analysisDay)) return { data: null, error: '历史日线/净值日期晚于分析日' };
  if (dayNumber(analysisDay) - dayNumber(historyAsOf) > 7 * 86400000) return { data: null, error: '历史日线/净值超过7个自然日未更新' };
  if (!requireTrend) return { data: { rows: clean, history_as_of: historyAsOf, ma20: null, ma60: null, momentum20: null }, error: null };
  if (clean.length < 60) return { data: null, error: '历史不足60个交易日，不能计算MA60' };
  if (clean.length < 21) return { data: null, error: '历史不足21个交易日，不能计算20日动量' };
  const closes = clean.map((row) => row.close);
  const ma20 = closes.slice(-20).reduce((sum, value) => sum + value, 0) / 20;
  const ma60 = closes.slice(-60).reduce((sum, value) => sum + value, 0) / 60;
  const momentum20 = (closes[closes.length - 1] / closes[closes.length - 21] - 1) * 100;
  return { data: { rows: clean, history_as_of: historyAsOf, ma20, ma60, momentum20 }, error: null };
}

function snapshotHealth(instrument: unknown, snapshot: AnyRecord | null, analysisDay: string, allowNav = false): { health: SnapshotHealth | null; blockers: string[]; status: string } {
  const item = record(instrument);
  const blockers: string[] = [];
  if (!identityOk(item)) blockers.push('品种身份不完整或与instrument_id不匹配');
  if (!snapshot) {
    blockers.push('缺少行情快照');
    return { health: null, blockers, status: 'missing' };
  }
  const identityMismatch = snapshot.instrument_id !== item.id;
  if (identityMismatch) blockers.push('行情快照instrument_id与品种不匹配');
  const sourceValues = [snapshot.source, snapshot.quote_source, snapshot.history_source, snapshot.snapshot_id];
  if (sourceValues.some((value) => String(value || '').trim().toLowerCase() === 'manual' || String(value || '').trim().toLowerCase().startsWith('manual:'))) blockers.push('行情或历史为手动导入，不能作为自动建议依据');
  const status = String(snapshot.status || 'missing');
  if (status !== 'fresh') blockers.push('行情快照不是当日fresh数据');
  const snapshotDay = validDay(snapshot.as_of);
  if (snapshotDay !== analysisDay) blockers.push('行情日期与分析日不一致');
  const quote = record(snapshot.quote);
  const quoteSource = snapshot.quote_source || snapshot.source;
  const historySource = snapshot.history_source || snapshot.source;
  if (!usableSource(quoteSource)) blockers.push('现价缺少可核验来源');
  if (!usableSource(historySource)) blockers.push('历史数据缺少可核验来源');
  const price = numberValue(quote.price);
  if (price === null || price <= 0) blockers.push('缺少有效现价');
  if (item.kind === 'fund' && (!allowNav || snapshot.valuation_kind !== 'confirmed_nav')) blockers.push('场外基金缺少正式净值依据');
  const historyResult = historyData(snapshot, analysisDay, item.kind !== 'fund');
  if (historyResult.error) blockers.push(historyResult.error);
  if (snapshot.history_status !== undefined && snapshot.history_status !== null && snapshot.history_status !== 'fresh') blockers.push('历史日线/净值已过期');
  let statusOut: string;
  if (!identityOk(item) || identityMismatch) statusOut = 'identity_mismatch';
  else if (blockers.some((text) => text.includes('手动'))) statusOut = 'manual';
  else if (snapshot.history_status === 'stale') statusOut = 'stale';
  else if (blockers.some((text) => text.includes('来源'))) statusOut = 'missing';
  else if (status !== 'fresh') statusOut = status === 'stale' ? 'stale' : 'missing';
  else if (blockers.some((text) => text.includes('日期'))) statusOut = 'date_mismatch';
  else if (!historyResult.data) statusOut = 'missing_history';
  else statusOut = 'fresh';
  return { health: { snapshot, quote, price, as_of: snapshotDay, history: historyResult.data }, blockers, status: statusOut };
}

function trend(price: number | null, history: HistoryData | null): InstrumentAdvice['strength'] {
  if (!history || history.ma20 === null || history.ma60 === null || history.momentum20 === null || price === null) return 'unknown';
  if (price < history.ma20 && price < history.ma60) return 'weak';
  if (price > history.ma20 && history.ma20 > history.ma60 && history.momentum20 > 0) return 'strong';
  return 'neutral';
}

function stockEtfCandidate(instrument: unknown) {
  const item = record(instrument);
  return identityOk(item) && (item.kind === 'stock' || item.kind === 'etf') && supportedLotRule(item);
}

function accountBlockers(profile: AnyRecord, portfolio: AnyRecord) {
  const blockers: string[] = [];
  if (!String(profile.purpose || '').trim()) blockers.push('尚未填写投资用途');
  if (!String(profile.horizon || '').trim()) blockers.push('尚未填写投资期限');
  if (profile.holdings_confirmed !== true || portfolio.provisional === true) blockers.push('账本持仓尚未确认');
  if (portfolio.cash_estimated === true || portfolio.total_equity_estimated === true) blockers.push('账本现金或权益仍为估算');
  const commission = numberValue(profile.commission_rate);
  const minimumCommission = numberValue(profile.minimum_commission);
  const transferFee = numberValue(profile.transfer_fee_rate);
  const feesConfirmed = profile.fees_confirmed === true;
  const relevantFeeConfigured = [commission, minimumCommission, transferFee].some((value) => value !== null && value > 0);
  if (!feesConfirmed && !relevantFeeConfigured) blockers.push('买入相关手续费尚未核实');
  if (portfolio.loss_triggered === true) blockers.push('账本已触及亏损暂停线');
  else if (portfolio.total_pnl === null || portfolio.total_pnl === undefined) blockers.push('账本净盈亏或暂停状态尚未确认');
  const cash = numberValue(portfolio.cash);
  if (cash === null) blockers.push('账本可用现金未知');
  else if (cash <= 0) blockers.push('账本可用现金为零，阻断新增买入');
  return blockers;
}

function etfPremiumBlocker(instrument: AnyRecord, snapshot: AnyRecord, price: number | null, analysisDay: string): { premium: number | null; blocker: string | null } {
  if (instrument.kind !== 'etf') return { premium: null, blocker: null };
  const quote = record(snapshot.quote);
  const iopv = numberValue(snapshot.iopv === undefined ? quote.iopv : snapshot.iopv);
  const iopvDay = validDay(snapshot.iopv_as_of === undefined ? quote.iopv_as_of : snapshot.iopv_as_of);
  const iopvSource = snapshot.iopv_source === undefined ? quote.iopv_source : snapshot.iopv_source;
  const iopvUrl = snapshot.iopv_url === undefined ? quote.iopv_url : snapshot.iopv_url;
  if (iopv === null || iopv <= 0 || price === null || iopvDay !== analysisDay || !usableSource(iopvSource) || !String(iopvUrl || '').trim())
    return { premium: null, blocker: 'ETF缺少同日且可追溯来源的IOPV/折溢价核验' };
  const premium = (price / iopv - 1) * 100;
  return { premium, blocker: premium > 0.5 ? 'ETF折溢价超过0.5%首版核验阈值' : null };
}

function evidence(label: string, value: number | string | null, unit: string | null = null, source: unknown = null, day: string | null = null, url: unknown = null): AdviceEvidence {
  const item: AdviceEvidence = { label, value, source: source === undefined ? null : String(source || '') || null, date: day };
  if (unit !== null) item.unit = unit;
  if (url) item.url = String(url);
  return item;
}

function round(value: number, digits: number) {
  return Number(value.toFixed(digits));
}

function formatGeneral(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function adviceItem(
  instrument: AnyRecord,
  snapshot: AnyRecord | null,
  portfolioPosition: PortfolioPosition | null,
  analysisDay: string,
  globalBlockers: string[],
  personalized: boolean,
  portfolio: AnyRecord,
  profile: AnyRecord,
): InstrumentAdvice {
  const instrumentId = String(instrument.id || portfolioPosition?.instrument_id || 'unknown');
  const item = Object.keys(instrument).length ? instrument : { id: instrumentId, name: instrumentId, kind: 'unknown' };
  const healthResult = snapshotHealth(item, snapshot, analysisDay, true);
  const health = healthResult.health;
  const dataBlockers = healthResult.blockers;
  let held = portfolioPosition !== null;
  let position = portfolioPosition;
  let quantity = held ? numberValue(position?.quantity) : null;
  if (quantity !== null && quantity <= 0) {
    held = false;
    position = null;
    quantity = null;
  }
  const price = health?.price ?? null;
  const history = health?.history ?? null;
  const strength = trend(price, history);
  const kind = String(item.kind || 'unknown');
  const marketValue = held ? numberValue(position?.market_value) : null;
  const weight = held ? numberValue(position?.weight_pct) : null;
  const reasons: string[] = [];
  const risks: string[] = [];
  const blockers = [...dataBlockers];
  const evidenceRows: AdviceEvidence[] = [];
  const triggers: AdviceTrigger[] = [];
  const currentSnapshot = health?.snapshot || {};
  const source = currentSnapshot.history_source || currentSnapshot.source;
  const sourceUrl = currentSnapshot.source_url;
  const asOfValue = health?.as_of ?? validDay(currentSnapshot.as_of);
  const historyAsOf = history?.history_as_of ?? validDay(currentSnapshot.history_as_of);
  if (price !== null) {
    const quote = record(currentSnapshot.quote);
    const quoteSource = currentSnapshot.quote_source || currentSnapshot.source;
    const quoteUrl = currentSnapshot.quote_url || quote.source_url || (quoteSource === currentSnapshot.source ? sourceUrl : null);
    evidenceRows.push(evidence('现价', price, '元', quoteSource, asOfValue, quoteUrl));
  }
  if (history && history.ma20 !== null) {
    evidenceRows.push(evidence('MA20', round(history.ma20, 6), '元', currentSnapshot.history_source || source, historyAsOf, sourceUrl));
    evidenceRows.push(evidence('MA60', round(history.ma60!, 6), '元', currentSnapshot.history_source || source, historyAsOf, sourceUrl));
    evidenceRows.push(evidence('20个交易间隔动量', round(history.momentum20!, 4), '%', currentSnapshot.history_source || source, historyAsOf, sourceUrl));
  }
  if (held && (position?.average_cost === null || position?.average_cost === undefined)) risks.push('账本平均成本未知；券商显示成本不用于判断盈亏或信号');
  if (held && weight === null && marketValue !== null) risks.push('账户总权益或完整估值不足，无法计算持仓权重');
  if (held && marketValue === null) risks.push('持仓市值估值缺失；集中度不能可靠计算');
  if (held && weight !== null && weight > INVESTMENT_ADVICE_CONCENTRATION_LIMIT_PCT) risks.push(`持仓权重${weight.toFixed(1)}%超过35%默认集中度提醒；35%只是首版假设`);
  if (strength === 'strong') {
    reasons.push('现价高于MA20、MA20高于MA60，且20个交易间隔动量为正');
    triggers.push({ label: '趋势观察', price: history!.ma20, condition: '若收盘跌破MA20，重新评估趋势' });
  } else if (strength === 'weak') {
    reasons.push('现价同时低于MA20与MA60，触发弱势持仓复核规则');
    triggers.push({ label: '趋势复核', price: Math.max(history!.ma20!, history!.ma60!), condition: '若收盘重新站上MA20与MA60，再复核当前减仓提示；不自动卖出' });
  } else if (strength === 'neutral') reasons.push('价格与均线组合未满足首版强势或弱势条件');
  else reasons.push('行情或历史不足，暂不能判断趋势');

  const premiumResult = etfPremiumBlocker(item, currentSnapshot, price, analysisDay);
  if (kind === 'etf') {
    if (premiumResult.premium === null) risks.push('未获得同日IOPV/折溢价，不能断言当前存在高溢价');
    else {
      const quote = record(currentSnapshot.quote);
      const iopvValue = numberValue(currentSnapshot.iopv === undefined ? quote.iopv : currentSnapshot.iopv);
      const iopvSource = currentSnapshot.iopv_source === undefined ? quote.iopv_source : currentSnapshot.iopv_source;
      const iopvUrl = currentSnapshot.iopv_url === undefined ? quote.iopv_url : currentSnapshot.iopv_url;
      const iopvDay = validDay(currentSnapshot.iopv_as_of === undefined ? quote.iopv_as_of : currentSnapshot.iopv_as_of);
      evidenceRows.push(evidence('IOPV参考净值', iopvValue, '元/份', iopvSource, iopvDay, iopvUrl));
      evidenceRows.push(evidence('折溢价（由现价/同日IOPV计算）', round(premiumResult.premium, 4), '%', iopvSource, iopvDay, iopvUrl));
      if (premiumResult.premium > 0) risks.push(`当前折溢价约${premiumResult.premium.toFixed(2)}%；该数据仅为同日现价与IOPV之比`);
    }
  }
  if (premiumResult.blocker) blockers.push(premiumResult.blocker);

  let action: AdviceAction;
  let actionLabel: string;
  let planAction: AdvicePlan['action'];
  if (kind === 'fund') {
    if (currentSnapshot.valuation_kind !== 'confirmed_nav') blockers.push('场外基金仅使用正式净值观察');
    if (dataBlockers.length) [action, actionLabel] = ['wait', '待核验正式净值'];
    else [action, actionLabel] = ['watch', '观察正式净值'];
    reasons.push('场外基金只展示正式净值趋势，不生成场内买卖建议');
    planAction = 'observe';
  } else if (held) {
    if (dataBlockers.length) [action, actionLabel] = ['wait', '待核验持仓数据'];
    else if (strength === 'weak') { [action, actionLabel] = ['reduce', '减仓复核']; reasons.push('该项只提示复核风险，不判断可卖数量'); }
    else if (strength === 'strong') [action, actionLabel] = ['hold', '持有观察'];
    else [action, actionLabel] = ['watch', '继续观察'];
    planAction = 'observe';
  } else {
    if (dataBlockers.length || !stockEtfCandidate(item)) {
      if (!stockEtfCandidate(item)) blockers.push('仅已核验身份与规则的沪深主板股票/普通ETF可进入买入候选');
      [action, actionLabel] = ['wait', '待核验候选资料'];
      planAction = 'observe';
    } else if (strength !== 'strong') {
      [action, actionLabel] = ['watch', '观察，不追买'];
      planAction = 'observe';
    } else if (!personalized) {
      blockers.push('样例观察品种未确认加入个性化关注池');
      [action, actionLabel] = ['watch', '先加入个性化关注'];
      planAction = 'observe';
    } else if (premiumResult.blocker) {
      [action, actionLabel] = ['wait', '待核验ETF折溢价'];
      planAction = 'observe';
    } else if (globalBlockers.length) {
      blockers.push(...globalBlockers);
      [action, actionLabel] = ['watch', '账户条件未齐'];
      planAction = 'observe';
    } else {
      const cash = numberValue(portfolio.cash);
      const commission = numberValue(profile.commission_rate) || 0;
      const minimumCommission = numberValue(profile.minimum_commission) || 0;
      const transferRate = numberValue(profile.transfer_fee_rate) || 0;
      const minimumBudget = (price || 0) * 100 + Math.max((price || 0) * 100 * commission, minimumCommission) + (price || 0) * 100 * transferRate;
      if (cash === null || cash + 1e-8 < minimumBudget) {
        blockers.push('账本可用现金不足以覆盖至少一个100份/股交易单位及已配置买入费用');
        [action, actionLabel] = ['watch', '现金不足，暂不考虑买入'];
        planAction = 'observe';
      } else {
        [action, actionLabel] = ['buy', '强势候选，满足条件后考虑买入'];
        reasons.push('规则仅输出候选，不生成数量；还需核对券商可用现金、实时价格与费用');
        planAction = 'consider';
      }
    }
  }
  if (held && globalBlockers.length) risks.push(...globalBlockers.map((value) => `新增买入阻断：${value}`));
  if (currentSnapshot.status === 'stale') risks.push('行情已过期，不能将旧价格视为当前报价');
  if (healthResult.status === 'manual') risks.push('手动导入历史仅作参考，不作为自动信号');
  if (!reasons.length) reasons.push('暂无足够证据形成方向判断');
  const plan: AdvicePlan = {
    action: planAction,
    observation: reasons.join('; '),
    buy_condition: ['buy', 'watch', 'wait'].includes(action) ? '仅当当日行情、历史、账户用途/期限、已确认现金与费用均满足，且复核券商实时数据后再自行决定；本建议不提供数量。' : '不新增仓位；先按已有持仓风险条件复核。',
    exit_condition: held ? '若收盘同时低于MA20与MA60，复核持仓风险和退出计划；不得据此自动卖出。' : '无持仓；若未来成交，需重新核对退出条件。',
    invalidation: '新交易日、行情/历史快照变化、账本或账户上下文变化后本建议失效。',
    budget: null,
    notes: '规则版本未验证；不得把建议直接当成成交或数量指令。',
  };
  const unique = (values: string[]) => [...new Set(values)];
  return {
    decision_id: '',
    instrument_id: instrumentId,
    name: String(item.name || instrumentId),
    kind,
    held,
    quantity,
    weight_pct: weight === null ? null : round(weight, 3),
    current_price: price,
    as_of: asOfValue,
    history_as_of: historyAsOf,
    status: healthResult.status,
    action,
    action_label: actionLabel,
    headline: `${String(item.name || instrumentId)}：${actionLabel}`,
    strength,
    reasons: unique(reasons),
    risks: unique(risks),
    blockers: unique(blockers),
    triggers,
    evidence: evidenceRows,
    plan,
  };
}
function marketSummary(instruments: AnyRecord[], snapshots: Record<string, AnyRecord>, marketInput: unknown, analysisDay: string): AdviceMarket {
  const market = record(marketInput);
  const dimensions: AdviceMarketDimension[] = [];
  const missing: string[] = [];
  const indexReadings: string[] = [];
  for (const instrument of instruments) {
    if (instrument.kind !== 'index') continue;
    const healthResult = snapshotHealth(instrument, snapshots[String(instrument.id)], analysisDay);
    if (healthResult.health && !healthResult.blockers.length) {
      const signal = trend(healthResult.health.price, healthResult.health.history);
      const signalLabel = ({ strong: '趋势偏强', weak: '趋势偏弱', neutral: '趋势中性', unknown: '趋势暂无法判断' } as const)[signal];
      indexReadings.push(`${String(instrument.name || instrument.id)}：${signalLabel}`);
    }
  }
  if (indexReadings.length) dimensions.push({ key: 'index_trend', label: '指数技术趋势', status: 'available', summary: indexReadings.join('；'), value: indexReadings.join('；') });
  else { missing.push('index_trend'); dimensions.push({ key: 'index_trend', label: '指数技术趋势', status: 'missing', summary: '缺少同日有效指数及足够历史', value: null }); }

  const breadth = record(market.breadth);
  const up = numberValue(breadth.up), down = numberValue(breadth.down), flat = numberValue(breadth.flat), total = numberValue(breadth.total), amount = numberValue(breadth.amount);
  const breadthCounts = [up, down, flat, total];
  const marketDay = validDay(market.date);
  const breadthOk = market.status === 'fresh' && marketDay === analysisDay && usableSource(market.source)
    && breadthCounts.every((value) => value !== null && value >= 0 && Number.isInteger(value))
    && amount !== null && amount >= 0
    && Math.abs((up || 0) + (down || 0) + (flat || 0) - (total || 0)) < 1e-6 && (total || 0) > 0;
  if (breadthOk) dimensions.push({ key: 'breadth', label: '市场宽度', status: 'available', summary: `上涨${formatGeneral(up!)}、下跌${formatGeneral(down!)}、平盘${formatGeneral(flat!)}，合计${formatGeneral(total!)}`, value: total });
  else { missing.push('breadth'); dimensions.push({ key: 'breadth', label: '市场宽度', status: 'missing', summary: '缺少完整或校验通过的全市场宽度', value: null }); }

  const sentiment = record(market.sentiment);
  const sentimentValues = Object.fromEntries(['limit_up', 'limit_down', 'broken', 'broken_rate', 'max_streak'].map((key) => [key, numberValue(sentiment[key])])) as Record<string, number | null>;
  const sentimentOk = Object.values(sentimentValues).every((value) => value !== null && value >= 0)
    && (sentimentValues.broken_rate || 0) <= 100
    && ['limit_up', 'limit_down', 'broken', 'max_streak'].every((key) => Number.isInteger(sentimentValues[key]))
    && usableSource(market.sentiment_source) && validDay(market.sentiment_date) === analysisDay;
  if (sentimentOk) {
    const summary = `涨停${formatGeneral(sentimentValues.limit_up!)}家、跌停${formatGeneral(sentimentValues.limit_down!)}家、炸板${formatGeneral(sentimentValues.broken!)}家、炸板率${formatGeneral(sentimentValues.broken_rate!)}%、最高连板${formatGeneral(sentimentValues.max_streak!)}板`;
    dimensions.push({ key: 'sentiment', label: '情绪指标', status: 'available', summary, value: summary });
  } else { missing.push('sentiment'); dimensions.push({ key: 'sentiment', label: '情绪指标', status: 'missing', summary: '情绪指标不完整', value: null }); }

  let macro: AnyRecord | null = null;
  if (market.macro && typeof market.macro === 'object' && !Array.isArray(market.macro)) macro = record(market.macro);
  else {
    const macroEvidence = (Array.isArray(market.evidence) ? market.evidence : []).map(record).find((item) => item.kind === 'macro' && item.source && item.published_at);
    if (macroEvidence) macro = { value: macroEvidence.summary || macroEvidence.title, source: macroEvidence.source, date: macroEvidence.published_at };
  }
  const macroDay = macro ? validDay(macro.date) : null;
  if (macro && macro.value !== null && macro.value !== undefined && macro.source && usableSource(macro.source) && macroDay !== null && macroDay <= analysisDay)
    dimensions.push({ key: 'macro', label: '宏观信息', status: 'available', summary: `来源：${String(macro.source)}，日期：${String(macro.date)}`, value: String(macro.value) });
  else { missing.push('macro'); dimensions.push({ key: 'macro', label: '宏观信息', status: 'missing', summary: '无带来源和日期的宏观事实', value: null }); }

  const flow = record(market.flow);
  const flowValues: Array<[string, number | null]> = [['northbound', numberValue(flow.northbound)], ['main', numberValue(flow.main)]];
  const availableFlow = flowValues.filter(([, value]) => value !== null) as Array<[string, number]>;
  const flowOk = availableFlow.length > 0 && usableSource(flow.source) && validDay(flow.date) === analysisDay;
  if (flowOk) {
    const notes = availableFlow.map(([key]) => flow[`${key}_note`]).filter((value): value is string => typeof value === 'string' && !!value);
    const names: Record<string, string> = { northbound: '北向资金', main: '主力资金口径' };
    const summary = notes.length ? notes.join('；') : availableFlow.map(([key, value]) => `${names[key]}净额${formatGeneral(value)}`).join('、') + '（仅按来源口径展示）';
    dimensions.push({ key: 'flow', label: '资金信息', status: 'available', summary, value: availableFlow.map(([key, value]) => `${names[key]}净额${formatGeneral(value)}`).join('；') });
  } else { missing.push('flow'); dimensions.push({ key: 'flow', label: '资金信息', status: 'missing', summary: '无可验证资金流数据', value: null }); }

  let dataStatus: AdviceMarket['data_status'] = missing.length === 0 ? 'complete' : missing.length === dimensions.length ? 'missing' : 'partial';
  if (market.status === 'stale' || (market.date !== null && market.date !== undefined && marketDay !== analysisDay)) dataStatus = 'stale';
  const label = dataStatus === 'complete' ? '维度覆盖完整；未计算综合市场分' : dataStatus === 'stale' ? '市场数据过期或日期不符' : dataStatus === 'missing' ? '市场数据待补充' : '市场维度部分覆盖';
  return { label, data_status: dataStatus, score: null, score_label: null, coverage: { available: dimensions.length - missing.length, total: dimensions.length, missing }, dimensions };
}

function decisionId(instrumentId: string, snapshot: AnyRecord | null, context: string, asOf: string, decision: InstrumentAdvice, market: AdviceMarket, portfolio: AnyRecord) {
  const binding = pick(snapshot || {}, ['snapshot_id', 'instrument_id', 'source', 'quote_source', 'history_source', 'status', 'as_of', 'history_as_of', 'history_status', 'valuation_kind', 'quote', 'history', 'iopv', 'iopv_as_of', 'iopv_source', 'iopv_url']);
  const portfolioBinding = pick(portfolio, ['cash', 'total_equity', 'total_pnl', 'net_contributions', 'loss_triggered', 'cash_estimated', 'total_equity_estimated', 'provisional']);
  portfolioBinding.positions = (Array.isArray(portfolio.positions) ? portfolio.positions : []).map(record).map((position) => pick(position, ['instrument_id', 'quantity', 'market_value', 'weight_pct'])).sort((a, b) => String(a.instrument_id || '').localeCompare(String(b.instrument_id || '')));
  const outcome = pick(decision as unknown as AnyRecord, ['action', 'status', 'strength', 'reasons', 'risks', 'blockers', 'triggers', 'weight_pct', 'quantity', 'plan']);
  return digest({ version: INVESTMENT_ADVICE_RULE_VERSION, instrument_id: instrumentId, snapshot: binding, context_id: context, as_of: asOf, decision: outcome, market, portfolio: portfolioBinding });
}

function dateForFreshness(day: string) {
  return new Date(`${day}T12:00:00+08:00`);
}

/** Build deterministic advice from the state snapshot. It never writes, calls
 * the network, predicts returns, or emits an order quantity. */
export function buildInvestmentAdvice(state: InvestmentState, asOf = todayShanghai(), generatedAt = new Date().toISOString()): AdviceBundle {
  const analysisDay = validDay(asOf);
  if (!analysisDay) throw new Error('as_of必须是有效日期');
  const rows = (state.instruments || []).map((item) => record(item));
  const snapshotMap = Object.fromEntries(Object.entries(state.snapshots || {}).map(([id, snapshot]) => {
    // The source advisor evaluates the persisted snapshot status first: a
    // fresh snapshot from another analysis day is reported as date_mismatch,
    // rather than being rewritten to stale by the account read clock.  Still
    // run the shared freshness projection for already-stale rows so this pure
    // read stays aligned with the rest of the Worker domain without changing
    // that source ordering.
    const sourceView = record(structuredClone(snapshot));
    const freshView = freshness(snapshot, dateForFreshness(analysisDay));
    if (sourceView.status === 'stale' && freshView?.status === 'stale') sourceView.status = 'stale';
    return [id, sourceView];
  }));
  const portfolio = record(summarizeInvestment(state));
  const profile = record(state.profile);
  const context = contextId(state);
  const positions = new Map<string, PortfolioPosition>();
  for (const raw of Array.isArray(portfolio.positions) ? portfolio.positions : []) {
    const position = record(raw);
    const quantity = numberValue(position.quantity);
    const instrumentId = position.instrument_id;
    if (typeof instrumentId === 'string' && quantity !== null && quantity > 0) positions.set(instrumentId, position as PortfolioPosition);
  }
  const globalBlockers = accountBlockers(profile, portfolio);
  if (portfolio.loss_triggered === true && !globalBlockers.includes('账本已触及亏损暂停线')) globalBlockers.push('账本已触及亏损暂停线');
  const instrumentMap = new Map(rows.filter((item) => item.id).map((item) => [String(item.id), item]));
  const holdings: InstrumentAdvice[] = [];
  for (const [instrumentId, position] of positions) {
    let instrument = instrumentMap.get(instrumentId);
    if (instrument?.kind === 'index') continue;
    if (!instrument) instrument = { id: instrumentId, name: String(position.name || instrumentId), kind: 'unknown', code: '', exchange: '' };
    const totalEquity = numberValue(portfolio.total_equity);
    const marketValue = numberValue(position.market_value);
    const weighted = marketValue !== null && totalEquity !== null && totalEquity > 0 ? { ...position, weight_pct: marketValue / totalEquity * 100 } : position;
    holdings.push(adviceItem(instrument, snapshotMap[instrumentId] || null, weighted, analysisDay, globalBlockers, true, portfolio, profile));
  }
  const watchlist: InstrumentAdvice[] = [];
  for (const instrument of rows) {
    const instrumentId = typeof instrument.id === 'string' ? instrument.id : '';
    if (!instrumentId || positions.has(instrumentId) || instrument.kind === 'index' || instrument.watched === false) continue;
    watchlist.push(adviceItem(instrument, snapshotMap[instrumentId] || null, null, analysisDay, globalBlockers, instrument.personalized === true, portfolio, profile));
  }
  const market = marketSummary(rows, snapshotMap, state.market, analysisDay);
  for (const item of [...holdings, ...watchlist]) item.decision_id = decisionId(item.instrument_id, snapshotMap[item.instrument_id] || null, context, analysisDay, item, market, portfolio);
  const actionItems: AdviceBundle['actions'] = [];
  if (globalBlockers.length) actionItems.push({ id: 'account-setup', priority: 1, title: '补齐账户确认条件', description: globalBlockers.join('；'), kind: 'configure' });
  const staleItems = [...holdings, ...watchlist].filter((item) => ['stale', 'missing', 'manual', 'date_mismatch', 'missing_history', 'identity_mismatch'].includes(item.status));
  if (staleItems.length) actionItems.push({ id: 'refresh-data', priority: 2, title: '更新或核验行情历史', description: '存在过期、手动、日期不符或历史不足的品种；更新来源数据后再判断。', kind: 'refresh' });
  for (const item of holdings) if (item.action === 'reduce') actionItems.push({ id: `review:${item.instrument_id}`, priority: 1, title: `复核${item.name}持仓风险`, description: item.headline, instrument_id: item.instrument_id, kind: 'review' });
  actionItems.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const lossTriggered = portfolio.loss_triggered === true;
  let overallAction: AdviceBundle['overall']['action'], overallTitle: string, overallSummary: string;
  if (lossTriggered) {
    [overallAction, overallTitle] = ['defend', '账本已触及亏损暂停线'];
    overallSummary = '暂停新增买入；继续核验已有持仓风险，不据此自动卖出。';
  } else if (holdings.some((item) => item.action === 'reduce')) {
    const weakCount = holdings.filter((item) => item.action === 'reduce').length;
    [overallAction, overallTitle] = ['defend', '优先复核已有持仓风险'];
    overallSummary = `已取得的数据中，${weakCount} 项持仓的现价同时低于MA20与MA60，优先复核风险；不自动卖出。新增买入仍需逐项满足账户与数据条件，缺失市场资料不补分。`;
  } else if (globalBlockers.length || market.data_status !== 'complete') {
    [overallAction, overallTitle] = ['watch', '先补齐账户或数据条件'];
    overallSummary = '个股/ETF逐项建议仍可查看；账户门槛未满足时不输出新增买入候选。';
  } else {
    [overallAction, overallTitle] = ['balanced', '逐项按规则复核'];
    overallSummary = '市场综合分不自动补值；只按有来源的品种数据与账户条件逐项观察。';
  }
  return {
    as_of: analysisDay,
    generated_at: generatedAt,
    context_id: context,
    engine: { version: INVESTMENT_ADVICE_RULE_VERSION, kind: 'transparent_rules', title: '透明趋势与账户门槛规则', validation: 'unvalidated', limitations: [...ENGINE_LIMITATIONS], assumptions: [...ENGINE_ASSUMPTIONS] },
    overall: { action: overallAction, title: overallTitle, summary: overallSummary, buying_allowed: globalBlockers.length === 0, blockers: globalBlockers },
    market,
    holdings,
    watchlist,
    actions: actionItems,
    disclaimer: '仅为可复核规则提示，不是收益预测或交易指令。成交、可卖份额、实时价格与费用由用户在券商端自行核验。',
  };
}
