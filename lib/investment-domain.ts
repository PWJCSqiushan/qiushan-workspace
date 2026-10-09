import { createHash } from 'node:crypto';
import { stable } from './protocol.ts';

export type InvestmentSpace = 'personal' | 'demo';
export type InstrumentKind = 'etf' | 'stock' | 'fund' | 'index';
export type Exchange = 'SH' | 'SZ' | 'OF';
export type SnapshotStatus = 'fresh' | 'stale' | 'missing';
export type TransactionKind =
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdraw'
  | 'fund_pending'
  | 'fund_confirm'
  | 'dividend';
export type PlanAction = 'observe' | 'consider' | 'no_trade';

export type Instrument = {
  id: string;
  code: string;
  name: string;
  kind: InstrumentKind;
  exchange: Exchange;
};

export type Snapshot = {
  snapshot_id: string;
  instrument_id: string;
  source: string | null;
  source_url: string | null;
  as_of: string | null;
  fetched_at: string;
  status: SnapshotStatus;
  error: string | null;
  quote: {
    price: number | null;
    change_pct: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    preclose: number | null;
    volume: number | null;
    amount: number | null;
  };
  history: Array<{
    date: string;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
    amount: number | null;
  }>;
  adjustment: 'none' | 'qfq' | 'hfq' | null;
  valuation_kind: 'market_price' | 'confirmed_nav' | null;
  metrics: {
    ma20: number | null;
    ma60: number | null;
    return_20d: number | null;
    range_120d: number | null;
    history_count: number;
  };
  fundamentals: Array<{
    label: string;
    value: string | number | null;
    unit: string | null;
    period: string | null;
    source: string | null;
    url: string | null;
  }>;
  evidence: Array<{
    id: string;
    title: string;
    url: string;
    source: string;
    published_at: string | null;
    kind: 'announcement' | 'financial' | 'macro' | 'news';
    summary?: string;
  }>;
  warnings: string[];
  quote_source?: string | null;
  history_source?: string | null;
  units?: { price: string; volume: string; amount: string };
  history_as_of?: string | null;
  history_status?: SnapshotStatus;
};

export type Market = {
  snapshot_id: string;
  date: string | null;
  status: SnapshotStatus;
  fetched_at: string;
  source: string | null;
  breadth: {
    up: number | null;
    down: number | null;
    flat: number | null;
    total: number | null;
    amount: number | null;
  } | null;
  sentiment: {
    limit_up: number | null;
    limit_down: number | null;
    broken: number | null;
    broken_rate: number | null;
    max_streak: number | null;
  } | null;
  flow: {
    northbound: number | null;
    northbound_note: string;
    main: number | null;
    main_note: string;
  } | null;
  evidence: Snapshot['evidence'];
  missing_fields: string[];
  warnings: string[];
};

export type InvestmentProfile = {
  initial_capital: number;
  loss_limit: number;
  monthly_goal_min: number;
  monthly_goal_max: number;
  purpose: string;
  horizon: string;
  holdings_confirmed: boolean;
  commission_rate: number;
  minimum_commission: number;
  stamp_tax_rate: number;
  transfer_fee_rate: number;
};

export type OpeningPosition = {
  instrument_id: string;
  quantity: number;
  average_cost: number | null;
  reference_price: number;
  broker_display_cost?: number | null;
};

export type Opening = {
  date: string;
  cash: number;
  positions: OpeningPosition[];
  confirmed_empty: boolean;
  initial_equity: number;
  opening_pnl: number | null;
  created_at: string;
};

export type AccountPosition = {
  instrument_id: string;
  quantity: number;
  reference_price: number;
  market_value: number;
  broker_display_cost?: number | null;
  cost_basis_status: 'unverified' | 'verified';
};

export type AccountContext = {
  as_of: string;
  observed_time: string | null;
  source: string;
  broker_assets: number;
  broker_market_value: number;
  broker_available_cash: number;
  broker_floating_pnl: number | null;
  broker_day_pnl: number | null;
  broker_month_pnl: number | null;
  broker_month_return_pct: number | null;
  external_cash: number;
  external_available_hours: number | null;
  horizon: string;
  purpose: string | null;
  cost_note: string;
  notes: string;
  positions: AccountPosition[];
  recorded_at: string;
};

export type Plan = {
  id: string;
  instrument_id: string;
  date: string;
  action: PlanAction;
  observation: string;
  buy_condition: string;
  exit_condition: string;
  invalidation: string;
  budget: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type Transaction = {
  id: string;
  kind: TransactionKind;
  date: string;
  created_at: string;
  instrument_id?: string;
  amount: number | null;
  quantity: number | null;
  price: number | null;
  fees: number | null;
  notes: string;
  plan_id?: string;
  pending_id?: string;
  rule_warning?: string;
};

export type Job = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  error?: string | null;
  started_at: string;
  finished_at?: string | null;
  result?: {
    count: number;
    source_health: SourceHealth[];
    selected_ids?: string[];
    remaining?: number;
    remaining_ids?: string[];
    next_cursor?: string | null;
  };
};

export type SourceHealth = {
  source: string;
  status: 'ok' | 'degraded' | 'failed' | 'missing';
  message?: string;
  checked_at?: string;
};

export type ReportSection = { title: string; body: string };
export type InvestmentReport = {
  id: string;
  report_type: 'market' | 'diagnosis';
  instrument_id: string | null;
  snapshot_id: string;
  context_id: string;
  conclusion: string;
  score: number | null;
  score_label: string | null;
  strategy?: string | null;
  position_range?: string | null;
  sections: ReportSection[];
  sources: string[];
  created_at: string;
  is_stale: boolean;
};

export type EquityObservation = {
  date: string;
  equity: number;
  net_contributions: number;
  cash: number;
  pending_value: number;
  market_value: number;
  positions: Array<{ instrument_id: string; quantity: number; price: number | null; as_of: string | null }>;
  created_at: string;
};

export type ExportBinding = {
  instrument_id: string | null;
  report_type: 'market' | 'diagnosis';
  context_id: string;
  exported_at: string;
};

const idPattern = /^[A-Za-z0-9_-]{1,120}$/;

export type InvestmentState = {
  schema_version: 1;
  owner: string;
  space: InvestmentSpace;
  version: number;
  profile: InvestmentProfile;
  instruments: Instrument[];
  snapshots: Record<string, Snapshot>;
  market: Market | null;
  opening: Opening | null;
  account_context: AccountContext | null;
  plans: Plan[];
  transactions: Transaction[];
  reports: InvestmentReport[];
  jobs: Job[];
  source_health: SourceHealth[];
  observations: EquityObservation[];
  exports: Record<string, ExportBinding>;
  sample_notice?: string;
};

export type PositionSummary = {
  instrument_id: string;
  name: string;
  quantity: number;
  average_cost: number | null;
  price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  status: SnapshotStatus;
  as_of: string | null;
  broker_display_cost?: number | null;
};

export type PortfolioSummary = {
  initial_capital: number;
  net_contributions: number;
  cash: number;
  market_value: number | null;
  total_equity: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  total_pnl: number | null;
  opening_pnl: number | null;
  total_fees: number;
  monthly_return: number | null;
  drawdown_pct: number | null;
  current_drawdown_pct: number | null;
  loss_triggered: boolean | null;
  valuation_complete: boolean;
  provisional: boolean;
  cash_estimated: boolean;
  total_equity_estimated: boolean;
  positions: PositionSummary[];
  pending: Array<{ pending_id: string; instrument_id: string; amount: number; date: string }>;
  equity_curve: Array<{
    date: string;
    equity: number;
    net_contributions: number;
    pnl: number;
    unit_value: number;
    drawdown_pct: number;
  }>;
  warnings: string[];
};

export const MARKET_SECTIONS = [
  '市场温度打分',
  '宏观、情绪、资金判断',
  '今日策略基调与仓位区间',
  '今日回避方向',
  '盘中信号与触发条件',
] as const;
export const DIAGNOSIS_SECTIONS = [
  '一句话定性',
  '基本面体检／ETF产品体检',
  '技术面体检',
  '资金面体检',
  '预期差分析',
  '风险清单与证伪信号',
  '条件预案与参考价位',
  '如果只能记住一点',
] as const;

export const DEFAULT_PROFILE: InvestmentProfile = {
  initial_capital: 10000,
  loss_limit: 500,
  monthly_goal_min: 3,
  monthly_goal_max: 5,
  purpose: '',
  horizon: '',
  holdings_confirmed: false,
  commission_rate: 0,
  minimum_commission: 0,
  stamp_tax_rate: 0,
  transfer_fee_rate: 0,
};

export const SYNTHETIC_DEMO_INSTRUMENTS: Instrument[] = [
  { id: 'etf:SH:990001', kind: 'etf', exchange: 'SH', code: '990001', name: '合成宽基ETF' },
  { id: 'stock:SZ:990002', kind: 'stock', exchange: 'SZ', code: '990002', name: '合成主板股票' },
  { id: 'fund:OF:990003', kind: 'fund', exchange: 'OF', code: '990003', name: '合成场外基金' },
  { id: 'index:SH:990004', kind: 'index', exchange: 'SH', code: '990004', name: '合成指数观察' },
];

export function emptyInvestmentState(owner: string, space: InvestmentSpace): InvestmentState {
  return {
    schema_version: 1,
    owner,
    space,
    version: 0,
    profile: { ...DEFAULT_PROFILE },
    instruments: space === 'demo' ? SYNTHETIC_DEMO_INSTRUMENTS.map((x) => ({ ...x })) : [],
    snapshots: {},
    market: null,
    opening: null,
    account_context: null,
    plans: [],
    transactions: [],
    reports: [],
    jobs: [],
    source_health: [],
    observations: [],
    exports: {},
    sample_notice: space === 'demo' ? '仅用于接口验收的合成数据，不代表真实持仓或推荐。' : undefined,
  };
}

export class InvestmentValidationError extends Error {
  status = 400;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InvestmentValidationError';
    this.status = status;
  }
}

export class InvestmentConflictError extends InvestmentValidationError {
  code = 'INVESTMENT_CONFLICT';
  latest?: InvestmentState;
  constructor(message = '投资账本已在其他设备修改，请刷新后重试。', latest?: InvestmentState) {
    super(message, 409);
    this.name = 'InvestmentConflictError';
    this.latest = latest;
  }
}

function number(value: unknown, label: string, optional = false, positive = false): number | null {
  if (value === null || value === undefined || value === '') {
    if (optional) return null;
    throw new InvestmentValidationError(`${label}必须是有限数字`);
  }
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isFinite(value))
    throw new InvestmentValidationError(`${label}必须是有限数字`);
  if (positive && value <= 0) throw new InvestmentValidationError(`${label}必须大于0`);
  return value;
}

export function numeric(value: unknown, label: string, optional = false, positive = false) {
  return number(value, label, optional, positive);
}

export function todayShanghai(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now);
}

export function validDate(value: unknown, label = 'date', now = new Date()) {
  const parsed = validCalendarDate(value, label);
  if (parsed > todayShanghai(now)) throw new InvestmentValidationError(`${label}不能在未来`);
  return parsed;
}

/** Plan dates describe an intended future trading day, so they use the same
 * calendar validation as ledger dates while intentionally allowing tomorrow
 * and later dates. */
export function validPlanDate(value: unknown, label = 'date') {
  return validCalendarDate(value, label);
}

function validCalendarDate(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new InvestmentValidationError(`${label}必须是有效的上海时区日期`);
  const [year, month, day] = value.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > daysInMonth)
    throw new InvestmentValidationError(`${label}必须是有效的上海时区日期`);
  return value;
}

export function isWhole(value: number) {
  return Math.abs(value - Math.round(value)) < 1e-8;
}

export function expectedInstrumentId(kind: InstrumentKind, exchange: Exchange, code: string) {
  return `${kind}:${exchange}:${code}`;
}

export function validateInstrument(input: unknown): Instrument {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new InvestmentValidationError('品种必须是对象');
  const raw = input as Record<string, unknown>;
  const code = raw.code;
  const name = raw.name;
  const kind = raw.kind;
  const exchange = raw.exchange;
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new InvestmentValidationError('品种代码必须是6位数字并保留前导零');
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new InvestmentValidationError('品种名称无效');
  if (!['etf', 'stock', 'fund', 'index'].includes(String(kind))) throw new InvestmentValidationError('品种类型无效');
  if (!['SH', 'SZ', 'OF'].includes(String(exchange))) throw new InvestmentValidationError('交易所无效');
  if ((kind === 'fund') !== (exchange === 'OF')) throw new InvestmentValidationError('场外基金须使用OF市场；其他品种须使用SH或SZ');
  if (kind !== 'fund' && exchange === 'OF') throw new InvestmentValidationError('只有场外基金可使用OF市场');
  const id = expectedInstrumentId(kind as InstrumentKind, exchange as Exchange, code);
  if (raw.id !== undefined && raw.id !== '' && raw.id !== id) throw new InvestmentValidationError('品种身份不完整或instrument_id不匹配');
  return { id, code, name: name.trim(), kind: kind as InstrumentKind, exchange: exchange as Exchange };
}

export function knownLotRule(instrument: Instrument | undefined) {
  if (!instrument) return false;
  if (instrument.kind === 'etf' && ['SH', 'SZ'].includes(instrument.exchange)) return true;
  if (instrument.kind === 'stock' && instrument.exchange === 'SH' && /^(600|601|603|605)\d{3}$/.test(instrument.code)) return true;
  if (instrument.kind === 'stock' && instrument.exchange === 'SZ' && /^(000|001|002|003)\d{3}$/.test(instrument.code)) return true;
  return false;
}

function instrumentMap(instruments: Instrument[]) {
  return new Map(instruments.map((x) => [x.id, x]));
}

export function validateProfile(input: unknown, base: InvestmentProfile = DEFAULT_PROFILE): InvestmentProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvestmentValidationError('个人设定必须是对象');
  const raw = input as Record<string, unknown>;
  const result: InvestmentProfile = { ...base };
  const fields: Array<'initial_capital' | 'loss_limit' | 'monthly_goal_min' | 'monthly_goal_max' | 'commission_rate' | 'minimum_commission' | 'stamp_tax_rate' | 'transfer_fee_rate'> = [
    'initial_capital', 'loss_limit', 'monthly_goal_min', 'monthly_goal_max', 'commission_rate',
    'minimum_commission', 'stamp_tax_rate', 'transfer_fee_rate',
  ];
  for (const field of fields) {
    if (raw[field] !== undefined) {
      const v = number(raw[field], field);
      if (v === null) throw new InvestmentValidationError(`${field}必须是有限数字`);
      result[field] = v;
    }
  }
  if (raw.holdings_confirmed !== undefined) {
    if (typeof raw.holdings_confirmed !== 'boolean') throw new InvestmentValidationError('holdings_confirmed必须是布尔值');
    result.holdings_confirmed = raw.holdings_confirmed;
  }
  for (const field of ['purpose', 'horizon'] as const) {
    if (raw[field] !== undefined) {
      if (typeof raw[field] !== 'string' || raw[field].length > 500) throw new InvestmentValidationError(`${field}长度无效`);
      result[field] = raw[field];
    }
  }
  if (result.initial_capital <= 0 || result.loss_limit <= 0) throw new InvestmentValidationError('本金和亏损提醒阈值必须大于0');
  if (result.monthly_goal_min < 0 || result.monthly_goal_max < result.monthly_goal_min) throw new InvestmentValidationError('目标区间无效');
  if (result.commission_rate < 0 || result.commission_rate > 1 || result.minimum_commission < 0 || result.stamp_tax_rate < 0 || result.stamp_tax_rate > 1 || result.transfer_fee_rate < 0 || result.transfer_fee_rate > 1)
    throw new InvestmentValidationError('费用配置无效');
  return result;
}

export function validateAccountContext(input: unknown, instruments: Instrument[], now = new Date()): Omit<AccountContext, 'recorded_at'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvestmentValidationError('账户上下文必须是对象');
  const raw = input as Record<string, unknown>;
  const asOf = validDate(raw.as_of, '账户截图日期', now);
  const observed = raw.observed_time;
  if (observed !== null && observed !== undefined && (typeof observed !== 'string' || !/^\d{2}:\d{2}$/.test(observed) || Number(observed.slice(0, 2)) > 23 || Number(observed.slice(3)) > 59)) throw new InvestmentValidationError('账户截图时间无效');
  const text = (field: string, max: number, nullable = false) => {
    const value = raw[field];
    if (nullable && (value === null || value === undefined)) return null;
    if (typeof value !== 'string' || value.length > max) throw new InvestmentValidationError(`${field}长度无效`);
    return value;
  };
  const nonnegative = (field: string, nullable = false) => {
    const value = number(raw[field], field, nullable) as number | null;
    if (value !== null && value < 0) throw new InvestmentValidationError(`${field}不能为负数`);
    return value;
  };
  const signed = (field: string) => number(raw[field], field, true);
  const out: Omit<AccountContext, 'recorded_at'> = {
    as_of: asOf,
    observed_time: observed === undefined ? null : (observed as string | null),
    source: text('source', 100) as string,
    broker_assets: nonnegative('broker_assets') as number,
    broker_market_value: nonnegative('broker_market_value') as number,
    broker_available_cash: nonnegative('broker_available_cash') as number,
    broker_floating_pnl: signed('broker_floating_pnl'),
    broker_day_pnl: signed('broker_day_pnl'),
    broker_month_pnl: signed('broker_month_pnl'),
    broker_month_return_pct: signed('broker_month_return_pct'),
    external_cash: nonnegative('external_cash') as number,
    external_available_hours: nonnegative('external_available_hours', true),
    horizon: text('horizon', 500) as string,
    purpose: text('purpose', 500, true),
    cost_note: text('cost_note', 5000) as string,
    notes: text('notes', 5000) as string,
    positions: [],
  };
  const positions = raw.positions;
  if (!Array.isArray(positions) || positions.length > 100) throw new InvestmentValidationError('截图持仓必须是0至100项数组');
  const map = instrumentMap(instruments), seen = new Set<string>();
  out.positions = positions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvestmentValidationError('截图持仓必须是对象');
    const p = value as Record<string, unknown>;
    const id = p.instrument_id;
    const inst = typeof id === 'string' ? map.get(id) : undefined;
    if (!inst || !['stock', 'etf', 'fund'].includes(inst.kind) || seen.has(id as string)) throw new InvestmentValidationError('截图持仓需为已知且不重复的可交易品种');
    seen.add(id as string);
    const quantity = number(p.quantity, 'quantity', false, true) as number;
    const reference = number(p.reference_price, 'reference_price', false, true) as number;
    const market = number(p.market_value, 'market_value', false, true) as number;
    if (['stock', 'etf'].includes(inst.kind) && !isWhole(quantity)) throw new InvestmentValidationError('截图股票及ETF份额必须为整数');
    if (Math.abs(quantity * reference - market) > 0.02) throw new InvestmentValidationError('截图份额、参考价与市值未核对一致');
    const brokerCost = number(p.broker_display_cost, 'broker_display_cost', true);
    const basis = p.cost_basis_status === undefined ? 'unverified' : p.cost_basis_status;
    if (basis !== 'unverified' && basis !== 'verified') throw new InvestmentValidationError('cost_basis_status无效');
    return { instrument_id: id as string, quantity, reference_price: reference, market_value: market, broker_display_cost: brokerCost, cost_basis_status: basis };
  });
  if (Math.abs(out.positions.reduce((sum, x) => sum + x.market_value, 0) - out.broker_market_value) > 0.02) throw new InvestmentValidationError('截图持仓合计与证券市值未核对一致');
  if (out.broker_market_value + out.broker_available_cash > out.broker_assets + 0.02) throw new InvestmentValidationError('截图证券市值及可用现金不能超过账户资产');
  return out;
}

function normalizeOptionalNumber(value: unknown, label: string, positive = false) {
  return number(value, label, true, positive);
}

export function validateOpening(input: unknown, instruments: Instrument[], now = new Date()): Opening {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvestmentValidationError('开账内容必须是对象');
  const raw = input as Record<string, unknown>;
  const date = validDate(raw.date, '开账日期', now);
  const cash = number(raw.cash, 'cash') as number;
  if (cash < 0) throw new InvestmentValidationError('开账现金不能为负数');
  if (typeof raw.confirmed_empty !== 'boolean') throw new InvestmentValidationError('confirmed_empty必须明确确认');
  const confirmedEmpty = raw.confirmed_empty;
  if (!Array.isArray(raw.positions)) throw new InvestmentValidationError('positions必须是数组');
  if (raw.positions.length === 0 && !confirmedEmpty) throw new InvestmentValidationError('空仓开账必须明确确认confirmed_empty=true');
  if (raw.positions.length > 0 && confirmedEmpty) throw new InvestmentValidationError('有初始持仓时confirmed_empty必须为false');
  const map = instrumentMap(instruments), seen = new Set<string>();
  let marketValue = 0, openingPnl: number | null = 0;
  const positions = raw.positions.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvestmentValidationError('初始持仓必须是对象');
    const p = value as Record<string, unknown>, id = p.instrument_id;
    const inst = typeof id === 'string' ? map.get(id) : undefined;
    if (!inst || !['stock', 'etf', 'fund'].includes(inst.kind) || seen.has(id as string)) throw new InvestmentValidationError('初始持仓只支持已知且不重复的股票、ETF或场外基金');
    seen.add(id as string);
    const quantity = number(p.quantity, 'quantity', false, true) as number;
    const averageCost = normalizeOptionalNumber(p.average_cost, 'average_cost', true);
    const referencePrice = number(p.reference_price, 'reference_price', false, true) as number;
    const brokerDisplayCost = normalizeOptionalNumber(p.broker_display_cost, 'broker_display_cost');
    if (['stock', 'etf'].includes(inst.kind) && !isWhole(quantity)) throw new InvestmentValidationError('初始股票和ETF持仓必须是整数份额；允许记录零股');
    marketValue += quantity * referencePrice;
    if (averageCost === null) openingPnl = null;
    else if (openingPnl !== null) openingPnl += quantity * (referencePrice - averageCost);
    return { instrument_id: id as string, quantity, average_cost: averageCost, reference_price: referencePrice, broker_display_cost: brokerDisplayCost };
  });
  const initialEquity = cash + marketValue;
  if (!Number.isFinite(initialEquity) || initialEquity <= 0) throw new InvestmentValidationError('初始权益必须大于0');
  return { date, cash, positions, confirmed_empty: confirmedEmpty, initial_equity: initialEquity, opening_pnl: openingPnl, created_at: new Date().toISOString() };
}

export function validateTransactionInput(input: unknown, instruments: Instrument[], now = new Date()): Omit<Transaction, 'id' | 'created_at'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvestmentValidationError('交易内容必须是对象');
  const raw = input as Record<string, unknown>;
  const allowed = ['buy', 'sell', 'deposit', 'withdraw', 'fund_pending', 'fund_confirm', 'dividend'];
  if (!allowed.includes(String(raw.kind))) throw new InvestmentValidationError('未知交易类型');
  const kind = raw.kind as TransactionKind;
  const date = validDate(raw.date, 'date', now);
  const amount = normalizeOptionalNumber(raw.amount, 'amount', true);
  const quantity = normalizeOptionalNumber(raw.quantity, 'quantity', true);
  const price = normalizeOptionalNumber(raw.price, 'price', true);
  const fees = normalizeOptionalNumber(raw.fees, 'fees');
  if (fees !== null && fees < 0) throw new InvestmentValidationError('fees不能为负数');
  const instrumentId = raw.instrument_id;
  const map = instrumentMap(instruments);
  let instrument: Instrument | undefined;
  if (['buy', 'sell', 'dividend', 'fund_pending', 'fund_confirm'].includes(kind)) {
    if (typeof instrumentId !== 'string' || !map.has(instrumentId)) throw new InvestmentValidationError('未知品种，必须使用完整的instrument_id');
    instrument = map.get(instrumentId);
    if (!['stock', 'etf', 'fund'].includes(instrument?.kind || '')) throw new InvestmentValidationError('账本交易仅支持股票、ETF或基金申购确认');
    if (kind === 'buy' && instrument?.kind === 'fund') throw new InvestmentValidationError('场外基金买入须通过fund_pending和fund_confirm记录实际确认份额');
    if (['fund_pending', 'fund_confirm'].includes(kind) && !['fund', 'etf'].includes(instrument?.kind || '')) throw new InvestmentValidationError('基金申购确认仅支持基金或ETF品种');
  }
  let normalizedAmount = amount;
  if (['buy', 'sell', 'fund_confirm'].includes(kind)) {
    if (quantity === null || price === null) throw new InvestmentValidationError('买卖及基金确认必须提供实际quantity和price');
    const gross = quantity * price;
    if (!Number.isFinite(gross) || gross <= 0) throw new InvestmentValidationError('成交金额必须是有限正数');
    if (amount !== null && Math.abs(amount - gross) > Math.max(0.01, Math.abs(gross) * 1e-7)) throw new InvestmentValidationError('amount必须与quantity×price一致');
    normalizedAmount = gross;
    const lotChecked = !!instrument && knownLotRule(instrument) && (kind === 'buy' || kind === 'sell' || (kind === 'fund_confirm' && instrument.kind === 'etf'));
    if (lotChecked) {
      if (!isWhole(quantity)) throw new InvestmentValidationError('已核验规则的股票或ETF成交份额必须为整数');
      if ((kind === 'buy' || kind === 'fund_confirm') && Math.round(quantity) % 100 !== 0) throw new InvestmentValidationError('已核验规则的股票或ETF买入数量必须是100份/股的整数倍');
    }
  } else if (['deposit', 'withdraw', 'fund_pending', 'dividend'].includes(kind)) {
    if (amount === null || amount <= 0) throw new InvestmentValidationError(`${kind}必须提供正数amount`);
  }
  if (kind === 'dividend' && (quantity !== null || price !== null)) throw new InvestmentValidationError('dividend只记录实际到账amount');
  let pendingId: string | undefined;
  if (kind === 'fund_pending') pendingId = typeof raw.pending_id === 'string' && raw.pending_id.trim() ? raw.pending_id.trim() : undefined;
  if (kind === 'fund_confirm') {
    if (typeof raw.pending_id !== 'string' || !raw.pending_id.trim()) throw new InvestmentValidationError('fund_confirm必须指定pending_id');
    pendingId = raw.pending_id.trim();
  }
  const notes = raw.notes === undefined ? '' : raw.notes;
  if (typeof notes !== 'string' || notes.length > 5000) throw new InvestmentValidationError('notes长度无效');
  const planId = raw.plan_id;
  if (planId !== undefined && (typeof planId !== 'string' || planId.length > 120)) throw new InvestmentValidationError('plan_id无效');
  const ruleWarning = ['buy', 'sell'].includes(kind) && instrument && !knownLotRule(instrument) ? '该品种交易数量规则未核验；仅按实际成交记录，不提供数量指导' : undefined;
  return {
    kind,
    date,
    instrument_id: instrumentId as string | undefined,
    amount: normalizedAmount,
    quantity,
    price,
    fees,
    notes,
    plan_id: planId as string | undefined,
    pending_id: pendingId,
    rule_warning: ruleWarning,
  };
}

type Replay = {
  initial_equity: number;
  cash: number;
  contributions: number;
  realized: number;
  opening_pnl: number | null;
  realized_unknown: boolean;
  total_fees: number;
  fee_unknown: boolean;
  positions: Map<string, { quantity: number; cost: number | null; broker_display_cost?: number | null }>;
  pending: Array<{ pending_id: string; instrument_id: string; amount: number; date: string }>;
};

export function replayTransactions(state: InvestmentState): Replay {
  const profile = state.profile || DEFAULT_PROFILE;
  const opening = state.opening;
  const initial = opening?.initial_equity ?? profile.initial_capital;
  let cash = opening?.cash ?? initial;
  const positions = new Map<string, { quantity: number; cost: number | null; broker_display_cost?: number | null }>();
  // An opening with an unknown average cost carries an explicit null
  // opening_pnl. Preserve that null through replay so the summary cannot
  // accidentally present the unknown basis as a real zero gain/loss.
  let openingPnl: number | null = opening ? opening.opening_pnl : 0;
  if (opening) {
    for (const p of opening.positions) {
      const cost = p.average_cost === null ? null : p.quantity * p.average_cost;
      positions.set(p.instrument_id, { quantity: p.quantity, cost, broker_display_cost: p.broker_display_cost });
    }
  }
  let contributions = initial, realized = 0, realizedUnknown = false, totalFees = 0, feeUnknown = false;
  const pending = new Map<string, { pending_id: string; instrument_id: string; amount: number; date: string }>();
  const confirmed = new Set<string>();
  const imap = instrumentMap(state.instruments);
  const txns = [...state.transactions].sort((a, b) => `${a.date}|${a.created_at}|${a.id}`.localeCompare(`${b.date}|${b.created_at}|${b.id}`));
  const addFee = (t: Transaction, counts: boolean) => {
    if (!counts) return 0;
    if (t.fees === null || t.fees === undefined) { feeUnknown = true; return 0; }
    if (!Number.isFinite(t.fees) || t.fees < 0) throw new InvestmentValidationError('fees不能为负数');
    totalFees += t.fees;
    return t.fees;
  };
  for (const t of txns) {
    const amount = t.amount;
    const q = t.quantity;
    const p = t.price;
    const fee = addFee(t, ['buy', 'sell', 'deposit', 'withdraw', 'fund_confirm', 'dividend'].includes(t.kind));
    if (opening && t.date < opening.date) throw new InvestmentValidationError('成交日期不能早于初始开账日期');
    if (t.kind === 'deposit') { if (amount === null) throw new InvestmentValidationError('deposit缺少金额'); cash += amount - fee; contributions += amount; }
    else if (t.kind === 'withdraw') { if (amount === null || amount + fee > cash + 1e-8) throw new InvestmentValidationError('可用现金不足，无法记录该笔取出'); cash -= amount + fee; contributions -= amount; }
    else if (t.kind === 'buy') {
      if (q === null || p === null || amount === null) throw new InvestmentValidationError('买入数据不完整');
      const cost = q * p + fee;
      if (cost > cash + 1e-8) throw new InvestmentValidationError('现金不足，无法记录该笔买入');
      cash -= cost;
      const previous = positions.get(t.instrument_id!);
      if (!previous || previous.quantity <= 1e-8) positions.set(t.instrument_id!, { quantity: q, cost });
      else { previous.quantity += q; if (previous.cost !== null) previous.cost += cost; }
    } else if (t.kind === 'sell') {
      if (q === null || p === null || amount === null) throw new InvestmentValidationError('卖出数据不完整');
      const previous = positions.get(t.instrument_id!);
      if (!previous || q > previous.quantity + 1e-8) throw new InvestmentValidationError('卖出数量超过账本持仓');
      const instrument = imap.get(t.instrument_id!);
      if (knownLotRule(instrument)) {
        if (!isWhole(q)) throw new InvestmentValidationError('已核验规则的股票或ETF卖出份额必须是整数');
        if (Math.round(q) % 100 !== 0 && Math.abs(q - previous.quantity) > 1e-8) throw new InvestmentValidationError('零股卖出必须一次性卖出该品种全部剩余持仓');
      }
      const basis = previous.cost === null ? null : previous.cost / previous.quantity * q;
      previous.quantity -= q;
      if (Math.abs(previous.quantity) < 1e-8) { previous.quantity = 0; previous.cost = 0; }
      else if (basis !== null && previous.cost !== null) previous.cost -= basis;
      cash += q * p - fee;
      if (basis === null) realizedUnknown = true; else realized += q * p - fee - basis;
    } else if (t.kind === 'dividend') {
      if (amount === null) throw new InvestmentValidationError('dividend缺少金额');
      cash += amount - fee; realized += amount - fee;
    } else if (t.kind === 'fund_pending') {
      if (amount === null) throw new InvestmentValidationError('fund_pending缺少金额');
      const pid = t.pending_id || t.id;
      if (pending.has(pid) || confirmed.has(pid)) throw new InvestmentValidationError('pending_id重复');
      if (amount > cash + 1e-8) throw new InvestmentValidationError('可用现金不足，无法冻结该笔申购资金');
      cash -= amount;
      pending.set(pid, { pending_id: pid, instrument_id: t.instrument_id!, amount, date: t.date });
    } else if (t.kind === 'fund_confirm') {
      if (q === null || p === null || amount === null) throw new InvestmentValidationError('基金确认数据不完整');
      const pid = t.pending_id!;
      const reserve = pending.get(pid);
      if (!reserve) throw new InvestmentValidationError('申购单不存在、尚未冻结或已确认');
      if (reserve.instrument_id !== t.instrument_id) throw new InvestmentValidationError('基金确认品种与待确认申购单不一致');
      const actual = q * p + fee;
      if (actual - reserve.amount > cash + 1e-8) throw new InvestmentValidationError('确认金额超过冻结资金且可用现金不足');
      cash += reserve.amount - actual;
      const previous = positions.get(t.instrument_id!);
      if (!previous || previous.quantity <= 1e-8) positions.set(t.instrument_id!, { quantity: q, cost: actual });
      else { previous.quantity += q; if (previous.cost !== null) previous.cost += actual; }
      pending.delete(pid); confirmed.add(pid);
    }
  }
  return { initial_equity: initial, cash, contributions, realized, opening_pnl: openingPnl, realized_unknown: realizedUnknown, total_fees: totalFees, fee_unknown: feeUnknown, positions, pending: [...pending.values()] };
}

function quoteFor(state: InvestmentState, id: string) {
  const snapshot = state.snapshots[id];
  if (!snapshot || !['fresh', 'stale'].includes(snapshot.status)) return { snapshot, price: null as number | null };
  const price = snapshot.quote?.price;
  return { snapshot, price: typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null };
}

function buildCurve(observations: EquityObservation[], transactions: Transaction[]) {
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const curve: PortfolioSummary['equity_curve'] = [];
  let unit = 1, high: number | null = null;
  let previous: EquityObservation | null = null;
  let flowTimingUnknown = false;
  for (const obs of sorted) {
    if (!Number.isFinite(obs.equity) || obs.equity <= 0 || !Number.isFinite(obs.net_contributions)) continue;
    if (previous) {
      const flows = transactions.filter((t) => ['deposit', 'withdraw'].includes(t.kind) && t.date > previous!.date && t.date <= obs.date);
      if (flows.some((t) => t.date !== obs.date)) { flowTimingUnknown = true; continue; }
      const flow = obs.net_contributions - previous.net_contributions;
      const adjusted = obs.equity - flow;
      if (previous.equity <= 0 || adjusted <= 0) continue;
      unit *= adjusted / previous.equity;
    }
    high = high === null ? unit : Math.max(high, unit);
    curve.push({ date: obs.date, equity: obs.equity, net_contributions: obs.net_contributions, pnl: obs.equity - obs.net_contributions, unit_value: unit, drawdown_pct: (unit / high - 1) * 100 });
    previous = obs;
  }
  return { curve, flowTimingUnknown };
}

export function summarizeInvestment(state: InvestmentState): PortfolioSummary {
  const replay = replayTransactions(state);
  const imap = instrumentMap(state.instruments);
  const warnings: string[] = [];
  const opening = state.opening;
  if (state.profile.holdings_confirmed !== true && !opening) warnings.push('初始持仓尚未核对；当前账本仅包含本系统记录的交易');
  if (opening) {
    if (replay.opening_pnl === null) warnings.push('存在未提供平均成本的开账持仓，开账前成本浮盈亏未知；不计入开账后总盈亏');
    else warnings.push(`开账前成本浮盈亏 ¥${replay.opening_pnl.toFixed(2)} 仅供核对，不计入开账后总盈亏`);
  }
  if (replay.realized_unknown) warnings.push('存在未知成本持仓的卖出，累计已实现盈亏无法完整计算');
  if (replay.fee_unknown) {
    warnings.push('存在未记录手续费的交易；total_fees仅统计已记录费用，实际盈亏可能偏高');
    warnings.push('手续费缺失，无法确认完整总盈亏和止损提醒状态');
  }
  for (const t of state.transactions) if (t.rule_warning) warnings.push(t.rule_warning);
  if (![state.profile.commission_rate, state.profile.minimum_commission, state.profile.stamp_tax_rate, state.profile.transfer_fee_rate].some((x) => x > 0)) warnings.push('交易费用配置尚未确认；profile中的默认0不能视为实际费率');

  const positions: PositionSummary[] = [];
  let marketValue = 0, unrealized = 0, unrealizedUnknown = false, valuationComplete = true;
  for (const [id, pos] of replay.positions) {
    if (pos.quantity <= 1e-8) continue;
    const instrument = imap.get(id), quote = quoteFor(state, id), valid = quote.price !== null;
    const average = pos.cost === null ? null : pos.cost / pos.quantity;
    const value = valid ? pos.quantity * quote.price! : null;
    const upnl = valid && pos.cost !== null ? value! - pos.cost : null;
    if (!valid) { valuationComplete = false; warnings.push(`${instrument?.name || id}缺少有效估值，待补充行情`); }
    else {
      marketValue += value!;
      if (upnl === null) unrealizedUnknown = true; else unrealized += upnl;
      if (quote.snapshot?.status === 'stale') warnings.push(`${instrument?.name || id}估值使用缓存行情，数据可能过期`);
    }
    positions.push({ instrument_id: id, name: instrument?.name || id, quantity: pos.quantity, average_cost: replay.fee_unknown ? null : average, price: quote.price, market_value: value, unrealized_pnl: replay.fee_unknown ? null : upnl, status: valid ? (quote.snapshot!.status as SnapshotStatus) : 'missing', as_of: valid ? quote.snapshot!.as_of : null, broker_display_cost: pos.broker_display_cost });
  }
  const pendingValue = replay.pending.reduce((sum, p) => sum + p.amount, 0);
  const totalEquity = valuationComplete ? replay.cash + pendingValue + marketValue : null;
  const provisional = state.profile.holdings_confirmed !== true && !opening;
  const totalPnl = totalEquity !== null && !replay.fee_unknown && !provisional ? totalEquity - replay.contributions : null;
  const lossTriggered = totalPnl === null ? null : totalPnl <= -state.profile.loss_limit;
  if (lossTriggered) warnings.push('累计亏损已达到止损提醒阈值，建议暂停新增交易并复核');
  const { curve, flowTimingUnknown } = buildCurve(state.observations || [], state.transactions);
  let drawdown: number | null = null, currentDrawdown: number | null = null, monthlyReturn: number | null = null;
  if (valuationComplete && !replay.fee_unknown && curve.length >= 2) {
    drawdown = Math.min(...curve.map((x) => x.drawdown_pct));
    currentDrawdown = curve.at(-1)?.drawdown_pct ?? null;
    const currentMonth = todayShanghai().slice(0, 7), current = curve.filter((x) => x.date.startsWith(currentMonth));
    if (current.length >= 2 && current[0].date.endsWith('-01')) monthlyReturn = (current.at(-1)!.unit_value / current[0].unit_value - 1) * 100;
  }
  let finalCurve = curve;
  if (curve.length < 2 || flowTimingUnknown) { finalCurve = []; drawdown = null; currentDrawdown = null; monthlyReturn = null; warnings.push('缺少完整历史权益观察，历史曲线、月收益率和回撤待补充'); }
  if (flowTimingUnknown) warnings.push('现金流日期与权益观察日期不匹配，资金流中性回撤无法可靠计算');
  if (!valuationComplete) warnings.push('行情估值不完整，无法可靠计算总盈亏、月收益率和当前回撤');
  return {
    initial_capital: replay.initial_equity,
    net_contributions: replay.contributions,
    cash: replay.cash,
    market_value: valuationComplete ? marketValue : null,
    total_equity: totalEquity,
    realized_pnl: replay.fee_unknown || replay.realized_unknown || provisional ? null : replay.realized,
    unrealized_pnl: valuationComplete && !replay.fee_unknown && !provisional && !unrealizedUnknown ? unrealized : null,
    total_pnl: totalPnl,
    opening_pnl: replay.opening_pnl,
    total_fees: replay.total_fees,
    monthly_return: monthlyReturn,
    drawdown_pct: drawdown,
    current_drawdown_pct: currentDrawdown,
    loss_triggered: lossTriggered,
    valuation_complete: valuationComplete,
    provisional,
    cash_estimated: replay.fee_unknown || provisional,
    total_equity_estimated: replay.fee_unknown || provisional,
    positions,
    pending: replay.pending,
    equity_curve: finalCurve,
    warnings: [...new Set(warnings)],
  };
}

export function orderCheck(instrument: Instrument | undefined, profile: InvestmentProfile, price: unknown, budget: unknown) {
  const reasons: string[] = [];
  let px: number, cash: number;
  try { px = number(price, 'price', false, true) as number; cash = number(budget, 'budget', false, true) as number; } catch (e) { return { eligible: false, quantity: null, cost: null, reasons: [e instanceof Error ? e.message : '价格或预算无效'] }; }
  if (!profile.purpose.trim()) reasons.push('请先填写投资用途');
  if (!profile.horizon.trim()) reasons.push('请先填写投资期限');
  if (profile.holdings_confirmed !== true) reasons.push('请先确认当前真实持仓');
  if (!instrument) reasons.push('未知品种，无法核验交易规则');
  else {
    if (instrument.id !== expectedInstrumentId(instrument.kind, instrument.exchange, instrument.code)) reasons.push('品种身份不完整或instrument_id不匹配');
    if (!knownLotRule(instrument)) reasons.push('仅支持交易规则已核验的沪深主板股票和普通ETF数量指导');
  }
  if (![profile.commission_rate, profile.minimum_commission, profile.transfer_fee_rate].some((x) => x > 0)) reasons.push('实际交易费率尚未配置，暂不提供数量指导');
  if (reasons.length) return { eligible: false, quantity: null, cost: null, reasons };
  const commissionRate = profile.commission_rate, minimum = profile.minimum_commission, transfer = profile.transfer_fee_rate;
  let quantity = Math.floor(cash / px / 100) * 100;
  while (quantity >= 100) {
    const notional = quantity * px, fee = Math.max(notional * commissionRate, minimum) + notional * transfer;
    if (notional + fee <= cash + 1e-8) break;
    quantity -= 100;
  }
  if (quantity < 100) return { eligible: false, quantity: null, cost: null, reasons: ['预算不足以买入100份/股'] };
  const notional = quantity * px, fee = Math.max(notional * commissionRate, minimum) + notional * transfer;
  return { eligible: true, quantity, cost: notional + fee, reasons: [] as string[] };
}

export function contextId(state: InvestmentState) {
  const source = stable({ profile: state.profile, opening: state.opening, account_context: state.account_context, transactions: state.transactions });
  return createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 24);
}

export function validateReportSections(reportType: 'market' | 'diagnosis', sections: unknown): ReportSection[] {
  const expected = reportType === 'market' ? MARKET_SECTIONS : DIAGNOSIS_SECTIONS;
  if (!Array.isArray(sections) || sections.length !== expected.length) throw new InvestmentValidationError(`该报告需按模板顺序包含${expected.length}个指定章节，请保持标题不变`);
  const out = sections.map((x) => {
    if (!x || typeof x !== 'object') throw new InvestmentValidationError('报告章节无效');
    const row = x as Record<string, unknown>;
    if (typeof row.title !== 'string' || typeof row.body !== 'string' || !row.title.trim() || !row.body.trim() || row.title.length > 200 || row.body.length > 20000) throw new InvestmentValidationError('报告标题与正文不能空白；信息不足请注明待补充');
    return { title: row.title, body: row.body };
  });
  if (out.some((x, i) => x.title !== expected[i])) throw new InvestmentValidationError(`该报告需按模板顺序包含${expected.length}个指定章节，请保持标题不变`);
  return out;
}

export function validateState(state: InvestmentState) {
  if (!state || typeof state !== 'object' || state.schema_version !== 1 || !state.owner || !['personal', 'demo'].includes(state.space) || !Number.isSafeInteger(state.version) || state.version < 0) throw new InvestmentValidationError('投资状态无效');
  if (!Array.isArray(state.instruments) || !state.snapshots || typeof state.snapshots !== 'object' || Array.isArray(state.snapshots) || !Array.isArray(state.plans) || !Array.isArray(state.transactions) || !Array.isArray(state.reports) || !Array.isArray(state.jobs) || !Array.isArray(state.observations) || !state.exports || typeof state.exports !== 'object' || Array.isArray(state.exports)) throw new InvestmentValidationError('投资状态结构无效');
  if (state.instruments.length > 500 || state.transactions.length > 10000 || state.plans.length > 2000 || state.reports.length > 500 || state.jobs.length > 50 || Object.keys(state.snapshots).length > 500 || state.observations.length > 10000 || Object.keys(state.exports).length > 1000) throw new InvestmentValidationError('投资状态条目超过上限', 413);
  const instruments = state.instruments.map(validateInstrument);
  if (new Set(instruments.map((x) => x.id)).size !== instruments.length) throw new InvestmentValidationError('投资状态含有重复品种');
  state.profile = validateProfile(state.profile);
  const imap = instrumentMap(instruments);
  const finiteNullable = (value: unknown, label: string, positive = false) => {
    if (value === null || value === undefined) return null;
    const parsed = number(value, label, false, positive);
    return parsed;
  };
  const snapshotMap = state.snapshots as Record<string, Snapshot>;
  for (const [id, snapshot] of Object.entries(snapshotMap)) {
    if (!snapshot || typeof snapshot !== 'object' || snapshot.instrument_id !== id || !imap.has(id)) throw new InvestmentValidationError('行情快照身份无效');
    if (typeof snapshot.snapshot_id !== 'string' || snapshot.snapshot_id.length < 1 || snapshot.snapshot_id.length > 200 || !['fresh', 'stale', 'missing'].includes(snapshot.status)) throw new InvestmentValidationError('行情快照状态无效');
    if (snapshot.as_of !== null && snapshot.as_of !== undefined) validDate(snapshot.as_of, '快照日期');
    if (typeof snapshot.fetched_at !== 'string' || !Number.isFinite(Date.parse(snapshot.fetched_at))) throw new InvestmentValidationError('行情抓取时间无效');
    if (!snapshot.quote || typeof snapshot.quote !== 'object') throw new InvestmentValidationError('行情报价结构无效');
    for (const field of ['price', 'change_pct', 'open', 'high', 'low', 'preclose', 'volume', 'amount']) finiteNullable(snapshot.quote[field as keyof Snapshot['quote']], `quote.${field}`, field === 'price');
    if (!Array.isArray(snapshot.history) || snapshot.history.length > 10000) throw new InvestmentValidationError('行情历史条目超过上限');
    let previousDate = '';
    for (const row of snapshot.history) {
      if (!row || typeof row !== 'object') throw new InvestmentValidationError('行情历史行无效');
      validDate(row.date, '历史日期');
      if (row.date <= previousDate) throw new InvestmentValidationError('行情历史必须按日期升序且不重复');
      previousDate = row.date;
      for (const field of ['open', 'high', 'low', 'close', 'volume', 'amount'] as const) finiteNullable(row[field], `history.${field}`, field === 'close');
    }
    if (!['none', 'qfq', 'hfq', null].includes(snapshot.adjustment)) throw new InvestmentValidationError('复权类型无效');
    if (!['market_price', 'confirmed_nav', null].includes(snapshot.valuation_kind)) throw new InvestmentValidationError('估值类型无效');
    if (!snapshot.metrics || typeof snapshot.metrics !== 'object' || !Number.isSafeInteger(snapshot.metrics.history_count) || snapshot.metrics.history_count < 0 || snapshot.metrics.history_count !== snapshot.history.length) throw new InvestmentValidationError('行情指标结构无效');
    for (const field of ['ma20', 'ma60', 'return_20d', 'range_120d']) finiteNullable(snapshot.metrics[field as keyof Snapshot['metrics']], `metrics.${field}`);
    if (snapshot.metrics.range_120d !== null && (snapshot.metrics.range_120d < 0 || snapshot.metrics.range_120d > 100)) throw new InvestmentValidationError('行情区间位置无效');
    if (!Array.isArray(snapshot.fundamentals) || snapshot.fundamentals.length > 200 || !Array.isArray(snapshot.evidence) || snapshot.evidence.length > 200 || !Array.isArray(snapshot.warnings) || snapshot.warnings.length > 100) throw new InvestmentValidationError('行情证据结构无效');
  }
  if (state.market !== null) {
    if (!state.market || typeof state.market !== 'object' || typeof state.market.snapshot_id !== 'string' || !['fresh', 'stale', 'missing'].includes(state.market.status)) throw new InvestmentValidationError('市场快照结构无效');
    if (state.market.date !== null && state.market.date !== undefined) validDate(state.market.date, '市场快照日期');
    if (typeof state.market.fetched_at !== 'string' || !Number.isFinite(Date.parse(state.market.fetched_at))) throw new InvestmentValidationError('市场快照抓取时间无效');
    if (!Array.isArray(state.market.evidence) || !Array.isArray(state.market.missing_fields) || !Array.isArray(state.market.warnings)) throw new InvestmentValidationError('市场快照证据结构无效');
  }
  if (state.opening !== null) {
    const opening = validateOpening(state.opening, instruments);
    if (typeof state.opening.created_at !== 'string' || !Number.isFinite(Date.parse(state.opening.created_at)) || Math.abs(opening.initial_equity - state.opening.initial_equity) > 1e-8) throw new InvestmentValidationError('开账状态无效');
  }
  if (state.account_context !== null) {
    const account = validateAccountContext(state.account_context, instruments);
    const { recorded_at: _recordedAt, ...storedAccount } = state.account_context;
    if (typeof state.account_context.recorded_at !== 'string' || !Number.isFinite(Date.parse(state.account_context.recorded_at)) || stable(account) !== stable(storedAccount)) throw new InvestmentValidationError('账户上下文状态无效');
  }
  const planIds = new Set<string>();
  for (const plan of state.plans) {
    if (!plan || typeof plan !== 'object' || typeof plan.id !== 'string' || !idPattern.test(plan.id) || planIds.has(plan.id) || !imap.has(plan.instrument_id) || !['observe', 'consider', 'no_trade'].includes(plan.action)) throw new InvestmentValidationError('预案结构无效');
    planIds.add(plan.id);
    validPlanDate(plan.date, '预案日期');
    for (const field of ['observation', 'buy_condition', 'exit_condition', 'invalidation', 'notes']) if (typeof plan[field as keyof Plan] !== 'string' || (plan[field as keyof Plan] as string).length > 5000) throw new InvestmentValidationError('预案文本长度无效');
    if (plan.budget !== null && (typeof plan.budget !== 'number' || !Number.isFinite(plan.budget) || plan.budget < 0)) throw new InvestmentValidationError('预案预算无效');
    if (!Number.isFinite(Date.parse(plan.created_at)) || !Number.isFinite(Date.parse(plan.updated_at))) throw new InvestmentValidationError('预案时间无效');
  }
  const transactionIds = new Set<string>();
  for (const transaction of state.transactions) {
    if (!transaction || typeof transaction !== 'object' || typeof transaction.id !== 'string' || !idPattern.test(transaction.id) || transactionIds.has(transaction.id)) throw new InvestmentValidationError('交易记录身份无效');
    transactionIds.add(transaction.id);
    const normalized = validateTransactionInput(transaction, instruments);
    if (normalized.kind !== transaction.kind || normalized.date !== transaction.date || (normalized.instrument_id || undefined) !== (transaction.instrument_id || undefined)) throw new InvestmentValidationError('交易记录结构无效');
    if (typeof transaction.created_at !== 'string' || !Number.isFinite(Date.parse(transaction.created_at))) throw new InvestmentValidationError('交易记录时间无效');
    if (transaction.plan_id && !planIds.has(transaction.plan_id)) throw new InvestmentValidationError('交易关联预案不存在');
  }
  replayTransactions(state);
  for (const report of state.reports) {
    if (!report || typeof report !== 'object' || typeof report.id !== 'string' || !idPattern.test(report.id) || !['market', 'diagnosis'].includes(report.report_type) || (report.report_type === 'diagnosis' && !imap.has(report.instrument_id || '')) || (report.report_type === 'market' && report.instrument_id !== null)) throw new InvestmentValidationError('报告结构无效');
    if (typeof report.snapshot_id !== 'string' || typeof report.context_id !== 'string' || typeof report.conclusion !== 'string' || typeof report.is_stale !== 'boolean' || !Number.isFinite(Date.parse(report.created_at))) throw new InvestmentValidationError('报告绑定结构无效');
    validateReportSections(report.report_type, report.sections);
    if (report.score !== null && (!Number.isInteger(report.score) || report.score < 0 || report.score > 100)) throw new InvestmentValidationError('报告分数无效');
    if (!Array.isArray(report.sources) || report.sources.some((x) => typeof x !== 'string' || !/^https?:\/\//.test(x))) throw new InvestmentValidationError('报告来源无效');
  }
  for (const job of state.jobs) {
    if (!job || typeof job.id !== 'string' || !['queued', 'running', 'completed', 'failed'].includes(job.status) || !Number.isInteger(job.progress) || job.progress < 0 || job.progress > 100 || typeof job.message !== 'string' || !Number.isFinite(Date.parse(job.started_at))) throw new InvestmentValidationError('采集任务结构无效');
  }
  for (const observation of state.observations) {
    if (!observation || typeof observation !== 'object' || !/^-?\d+(?:\.\d+)?$/.test(String(observation.equity)) || !Number.isFinite(observation.equity) || observation.equity <= 0 || !Number.isFinite(observation.net_contributions) || !Array.isArray(observation.positions)) throw new InvestmentValidationError('权益观察结构无效');
    validDate(observation.date, '权益观察日期');
  }
  for (const [snapshotId, binding] of Object.entries(state.exports)) {
    if (!snapshotId || !binding || !['market', 'diagnosis'].includes(binding.report_type) || (binding.report_type === 'diagnosis' && !imap.has(binding.instrument_id || '')) || (binding.report_type === 'market' && binding.instrument_id !== null) || typeof binding.context_id !== 'string' || !Number.isFinite(Date.parse(binding.exported_at))) throw new InvestmentValidationError('分析导出绑定结构无效');
  }
  const text = JSON.stringify(state);
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new InvestmentValidationError('投资账本不能超过2MB', 413);
  return state;
}

export function freshness(snapshot: Snapshot | null | undefined, now = new Date()) {
  if (!snapshot) return null;
  const next = structuredClone(snapshot);
  if (next.status === 'fresh' && next.as_of && next.as_of.slice(0, 10) !== todayShanghai(now)) next.status = 'stale';
  return next;
}

export function reportScoreLabel(score: number | null) {
  return score === null ? null : ['冰点', '偏冷', '中性', '偏暖', '沸腾'][Math.min(4, Math.floor(score / 20))];
}
