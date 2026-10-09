import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE,
  emptyInvestmentState,
  type Instrument,
  type InvestmentState,
  type Snapshot,
} from '../lib/investment-domain.ts';
import { buildInvestmentAdvice as buildAdvice } from '../lib/investment-advisor.ts';

const AS_OF = '2026-10-09';
const ETF: Instrument & { personalized: boolean } = { id: 'etf:SH:510300', code: '510300', name: '合成沪深ETF', kind: 'etf', exchange: 'SH', personalized: true };
const STOCK: Instrument & { personalized: boolean } = { id: 'stock:SH:600000', code: '600000', name: '合成主板股票', kind: 'stock', exchange: 'SH', personalized: true };
const FUND: Instrument & { personalized: boolean } = { id: 'fund:OF:110022', code: '110022', name: '合成场外基金', kind: 'fund', exchange: 'OF', personalized: true };
const INDEX: Instrument = { id: 'index:SH:000001', code: '000001', name: '合成指数', kind: 'index', exchange: 'SH' };

// Keep synthetic fixtures independent of the wall clock; production callers
// may omit asOf and receive today's Shanghai date from the pure function.
function buildInvestmentAdvice(value: InvestmentState, asOf = AS_OF, generatedAt?: string) {
  return buildAdvice(value, asOf, generatedAt);
}

function risingHistory(day = AS_OF, count = 60) {
  const end = Date.parse(`${day}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end - (count - 1 - index) * 86400000).toISOString().slice(0, 10);
    return { date, open: null, high: null, low: null, close: 100 + index, volume: null, amount: null };
  });
}

function snapshot(instrument: Instrument, options: { day?: string; price?: number; source?: string | null; count?: number; status?: 'fresh' | 'stale' | 'missing'; valuation_kind?: string } = {}): Snapshot {
  const day = options.day || AS_OF;
  const rows = risingHistory(day, options.count || 60);
  return {
    snapshot_id: `synthetic:${instrument.id}:${day}:${rows.length}:${options.price ?? 159}`,
    instrument_id: instrument.id,
    source: options.source === undefined ? 'synthetic-market' : options.source,
    source_url: 'https://example.invalid/synthetic',
    as_of: day,
    fetched_at: `${day}T01:00:00.000Z`,
    status: options.status || 'fresh',
    error: null,
    quote: { price: options.price ?? 159, change_pct: null, open: null, high: null, low: null, preclose: null, volume: null, amount: null },
    history: rows,
    adjustment: 'none',
    valuation_kind: (options.valuation_kind || (instrument.kind === 'fund' ? 'confirmed_nav' : 'market_price')) as Snapshot['valuation_kind'],
    metrics: { ma20: null, ma60: null, return_20d: null, range_120d: null, history_count: rows.length },
    fundamentals: [],
    evidence: [],
    warnings: [],
    quote_source: options.source === undefined ? 'synthetic-market' : options.source,
    history_source: options.source === undefined ? 'synthetic-market' : options.source,
    history_as_of: rows.at(-1)!.date,
    history_status: 'fresh',
    ...(instrument.kind === 'etf' ? { iopv: options.price ?? 159, iopv_as_of: day, iopv_source: 'synthetic-iopv', iopv_url: 'https://example.invalid/iopv' } : {}),
  } as Snapshot;
}

function profile(changes: Record<string, unknown> = {}) {
  return { ...DEFAULT_PROFILE, initial_capital: 50000, purpose: '合成长期配置', horizon: '合成3年', holdings_confirmed: true, commission_rate: 0.0003, minimum_commission: 5, transfer_fee_rate: 0.00001, fees_confirmed: true, ...changes };
}

function state(instruments: Instrument[], snapshots: Record<string, Snapshot>, options: { profile?: Record<string, unknown>; opening?: InvestmentState['opening']; market?: unknown } = {}) {
  const value = emptyInvestmentState('advisor-test', 'personal');
  value.instruments = instruments;
  value.snapshots = snapshots;
  value.profile = { ...value.profile, ...(options.profile || {}) };
  if (options.opening !== undefined) value.opening = options.opening;
  value.market = (options.market || null) as InvestmentState['market'];
  return value;
}

function opening(instrument: Instrument, quantity = 100, cash = 8410, average_cost: number | null = 100, reference_price = 159): NonNullable<InvestmentState['opening']> {
  return { date: AS_OF, cash, positions: [{ instrument_id: instrument.id, quantity, average_cost, reference_price }], confirmed_empty: false, initial_equity: cash + quantity * reference_price, opening_pnl: average_cost === null ? null : quantity * (reference_price - average_cost), created_at: `${AS_OF}T00:00:00.000Z` };
}

test('strong personalized ETF is a candidate without order quantity or market score', () => {
  const result = buildInvestmentAdvice(state([ETF], { [ETF.id]: snapshot(ETF) }, { profile: profile() }), AS_OF, '2026-10-09T09:00:00+08:00');
  const item = result.watchlist[0];
  assert.equal(item.action, 'buy');
  assert.equal(item.strength, 'strong');
  assert.equal(item.quantity, null);
  assert.equal(item.plan.budget, null);
  assert.equal(item.plan.action, 'consider');
  assert.equal(item.status, 'fresh');
  assert.ok(item.evidence.every((row) => row.date === AS_OF));
  assert.equal(result.market.score, null);
  assert.equal(result.market.score_label, null);
  assert.equal(result.engine.validation, 'unvalidated');
});
test('account and ETF gates prevent a buy candidate', () => {
  const cases: Array<[Record<string, unknown>, number, Record<string, unknown> | null, string]> = [
    [{ fees_confirmed: false, commission_rate: 0, minimum_commission: 0, transfer_fee_rate: 0 }, 50000, null, '手续费'],
    [{}, 10, null, '现金不足'],
    [{}, 0, null, '现金为零'],
    [{ purpose: '' }, 50000, null, '投资用途'],
    [{ horizon: '' }, 50000, null, '投资期限'],
    [{ holdings_confirmed: false }, 50000, null, '持仓尚未确认'],
    [{}, 50000, { iopv_as_of: '2026-10-08' }, 'IOPV'],
  ];
  for (const [profileChanges, cash, iopvChanges, expected] of cases) {
    const snap = snapshot(ETF) as unknown as Record<string, any>;
    if (iopvChanges) Object.assign(snap, iopvChanges);
    const result = buildInvestmentAdvice(state([ETF], { [ETF.id]: snap as Snapshot }, { profile: profile({ ...profileChanges, initial_capital: cash }) }));
    const item = result.watchlist[0];
    assert.notEqual(item.action, 'buy', expected);
    assert.ok(item.blockers.some((text) => text.includes(expected)), `${expected}: ${item.blockers.join('|')}`);
    assert.equal(item.quantity, null);
  }
});

test('stale, mismatched, manual and short-history snapshots wait for verification', () => {
  const cases: Array<[Partial<Parameters<typeof snapshot>[1]>, string]> = [
    [{ status: 'stale' }, 'stale'],
    [{ day: '2026-10-08' }, 'date_mismatch'],
    [{ source: 'manual' }, 'manual'],
    [{ count: 30 }, 'missing_history'],
  ];
  for (const [options, expected] of cases) {
    const item = buildInvestmentAdvice(state([STOCK], { [STOCK.id]: snapshot(STOCK, options as any) }, { profile: profile() })).watchlist[0];
    assert.equal(item.action, 'wait');
    assert.equal(item.status, expected);
    assert.ok(item.blockers.length);
  }
});

test('recent history may differ from quote day, but history older than seven days blocks', () => {
  const shifted = snapshot(ETF) as unknown as Record<string, any>;
  shifted.history = (shifted.history as Array<Record<string, unknown>>).map((row) => ({ ...row, date: new Date(Date.parse(`${row.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) }));
  shifted.history_as_of = '2026-10-08';
  const recent = buildInvestmentAdvice(state([ETF], { [ETF.id]: shifted as Snapshot }, { profile: profile() })).watchlist[0];
  assert.equal(recent.action, 'buy');
  assert.equal(recent.history_as_of, '2026-10-08');
  assert.ok(recent.evidence.some((row) => row.label === 'MA20' && row.date === '2026-10-08'));
  const old = snapshot(STOCK) as unknown as Record<string, any>;
  old.history = (old.history as Array<Record<string, unknown>>).map((row) => ({ ...row, date: new Date(Date.parse(`${row.date}T00:00:00Z`) - 8 * 86400000).toISOString().slice(0, 10) }));
  old.history_as_of = '2026-10-01';
  const oldItem = buildInvestmentAdvice(state([STOCK], { [STOCK.id]: old as Snapshot }, { profile: profile() })).watchlist[0];
  assert.equal(oldItem.action, 'wait');
  assert.ok(oldItem.blockers.some((text) => text.includes('超过7个自然日')));
});

test('weak confirmed holding stays visible as risk review and takes overall defense priority', () => {
  const weakInstruments = Array.from({ length: 4 }, (_, index) => ({ ...STOCK, id: `stock:SH:60000${index + 1}`, code: `60000${index + 1}`, name: `合成弱势${index + 1}` }));
  const snapshots = Object.fromEntries(weakInstruments.map((item) => [item.id, snapshot(item, { price: 70 })]));
  const openingRows = weakInstruments.map((item) => ({ instrument_id: item.id, quantity: 100, average_cost: 120, reference_price: 70 }));
  const openingValue = { date: AS_OF, cash: 10000, positions: openingRows, confirmed_empty: false, initial_equity: 10000 + 4 * 7000, opening_pnl: -20000, created_at: `${AS_OF}T00:00:00.000Z` } as NonNullable<InvestmentState['opening']>;
  const result = buildInvestmentAdvice(state(weakInstruments, snapshots, { opening: openingValue, profile: profile({ purpose: '', holdings_confirmed: false }) }));
  assert.ok(result.holdings.every((item) => item.action === 'reduce'));
  assert.equal(result.holdings[0].plan.action, 'observe');
  assert.equal(result.overall.action, 'defend');
  assert.match(result.overall.summary, /4 项持仓/);
  assert.equal(result.overall.buying_allowed, false);
});

test('only below MA20 is neutral observation, while strong holding is hold', () => {
  const held = opening(STOCK, 100, 1000, 110, 159);
  const stateValue = state([STOCK], { [STOCK.id]: snapshot(STOCK, { price: 140 }) }, { opening: held, profile: profile() });
  const item = buildInvestmentAdvice(stateValue).holdings[0];
  assert.equal(item.strength, 'neutral');
  assert.equal(item.action, 'watch');
  const strongState = state([STOCK], { [STOCK.id]: snapshot(STOCK) }, { opening: opening(STOCK), profile: profile() });
  assert.equal(buildInvestmentAdvice(strongState).holdings[0].action, 'hold');
  assert.equal(buildInvestmentAdvice(strongState).watchlist.length, 0);
});

test('unknown cost, negative broker cost and external cash never create a buy budget', () => {
  const heldOpening = opening(ETF, 100, 8410, null, 159);
  const heldState = state([ETF], { [ETF.id]: snapshot(ETF, { price: 70 }) }, { opening: heldOpening, profile: profile() });
  const held = buildInvestmentAdvice(heldState).holdings[0];
  assert.equal(held.action, 'reduce');
  assert.ok(held.risks.some((text) => text.includes('平均成本未知')));
  const lowCash = state([ETF], { [ETF.id]: snapshot(ETF) }, { profile: profile({ initial_capital: 10 }) });
  const unheld = buildInvestmentAdvice(lowCash).watchlist[0];
  assert.notEqual(unheld.action, 'buy');
  assert.ok(unheld.blockers.some((text) => text.includes('现金')));
});

test('unknown lot rules and unpersonalized seeds never become buy candidates; funds and indices stay constrained', () => {
  const seed = { ...STOCK, personalized: false };
  const unknownLot = { id: 'stock:SZ:300001', code: '300001', name: '合成创业板', kind: 'stock' as const, exchange: 'SZ' as const, personalized: true };
  const fundSnapshot = snapshot(FUND, { count: 1 });
  const result = buildInvestmentAdvice(state([seed, unknownLot, FUND, INDEX], { [seed.id]: snapshot(seed), [unknownLot.id]: snapshot(unknownLot), [FUND.id]: fundSnapshot, [INDEX.id]: snapshot(INDEX) }, { profile: profile() }));
  assert.equal(result.watchlist[0].action, 'watch');
  assert.ok(result.watchlist[0].blockers.some((text) => text.includes('个性化关注池')));
  assert.equal(result.watchlist[1].action, 'wait');
  assert.ok(result.watchlist[1].blockers.some((text) => text.includes('已核验身份与规则')));
  assert.deepEqual(result.watchlist.filter((item) => item.instrument_id === FUND.id).map((item) => item.action), ['watch']);
  assert.equal(result.watchlist.some((item) => item.instrument_id === INDEX.id), false);
});

test('ETF IOPV must have same-day traceable provenance and is disclosed separately', () => {
  const good = buildInvestmentAdvice(state([ETF], { [ETF.id]: snapshot(ETF) }, { profile: profile() })).watchlist[0];
  const iopv = good.evidence.filter((row) => row.label.startsWith('IOPV') || row.label.startsWith('折溢价'));
  assert.equal(iopv.length, 2);
  assert.equal(iopv[0].value, 159);
  assert.ok(iopv.every((row) => row.source === 'synthetic-iopv' && row.url === 'https://example.invalid/iopv'));
  for (const changes of [{ iopv_source: null }, { iopv_url: null }, { iopv_as_of: '2026-10-10' }]) {
    const bad = snapshot(ETF) as unknown as Record<string, any>;
    Object.assign(bad, changes);
    const item = buildInvestmentAdvice(state([ETF], { [ETF.id]: bad as Snapshot }, { profile: profile() })).watchlist[0];
    assert.equal(item.action, 'wait');
    assert.ok(item.blockers.some((text) => text.includes('可追溯来源')));
  }
});

test('quote evidence keeps provider provenance separate from history', () => {
  const value = snapshot(STOCK) as unknown as Record<string, any>;
  value.quote_source = 'synthetic-other-provider';
  const item = buildInvestmentAdvice(state([STOCK], { [STOCK.id]: value as Snapshot }, { profile: profile() })).watchlist[0];
  const current = item.evidence.find((row) => row.label === '现价');
  assert.equal(current?.source, 'synthetic-other-provider');
  assert.equal(current?.url, undefined);
  assert.equal(item.evidence.find((row) => row.label === 'MA20')?.url, value.source_url);
});

test('unwatched instruments leave the candidate list while real holdings remain visible', () => {
  const unwatched = { ...STOCK, watched: false, personalized: true } as Instrument & { watched: boolean; personalized: boolean };
  const noHolding = buildInvestmentAdvice(state([unwatched], { [unwatched.id]: snapshot(unwatched) }, { profile: profile() }));
  assert.equal(noHolding.watchlist.length, 0);
  const held = buildInvestmentAdvice(state([unwatched], { [unwatched.id]: snapshot(unwatched) }, { opening: opening(unwatched), profile: profile() }));
  assert.equal(held.holdings.length, 1);
  assert.equal(held.holdings[0].instrument_id, unwatched.id);
});

test('market coverage requires valid fresh sources and never fabricates score 50', () => {
  const value = state([STOCK], { [STOCK.id]: snapshot(STOCK) }, { profile: profile() });
  const result = buildInvestmentAdvice(value);
  assert.equal(result.market.score, null);
  assert.equal(result.market.data_status, 'missing');
  assert.deepEqual(new Set(result.market.coverage.missing), new Set(['index_trend', 'breadth', 'sentiment', 'macro', 'flow']));
  const completeMarket = {
    date: AS_OF, status: 'fresh', source: 'synthetic-market',
    breadth: { up: 3, down: 2, flat: 1, total: 6, amount: 1000 },
    sentiment: { limit_up: 1, limit_down: 2, broken: 3, broken_rate: 25, max_streak: 2 }, sentiment_source: 'synthetic-sentiment', sentiment_date: AS_OF,
    flow: { northbound: 10, main: -5, source: 'synthetic-flow', date: AS_OF }, macro: { value: '合成宏观说明', source: 'synthetic-macro', date: AS_OF },
  };
  const complete = buildInvestmentAdvice(state([INDEX], { [INDEX.id]: snapshot(INDEX, { price: 70 }) }, { profile: profile(), market: completeMarket })).market;
  assert.equal(complete.score, null);
  assert.equal(complete.data_status, 'complete');
  const fractionalBreadth = buildInvestmentAdvice(state([INDEX], { [INDEX.id]: snapshot(INDEX, { price: 70 }) }, { profile: profile(), market: { ...completeMarket, breadth: { ...completeMarket.breadth, up: 3.5, total: 6.5 } } })).market;
  assert.ok(fractionalBreadth.coverage.missing.includes('breadth'));
  const stale = buildInvestmentAdvice(state([STOCK], { [STOCK.id]: snapshot(STOCK) }, { profile: profile(), market: { ...completeMarket, status: 'stale' } })).market;
  assert.equal(stale.data_status, 'stale');
});

test('decision id ignores generated_at and changes with context, data, market and analysis day', () => {
  const base = state([STOCK], { [STOCK.id]: snapshot(STOCK) }, { profile: profile() });
  const first = buildInvestmentAdvice(base, AS_OF, '2026-10-09T09:00:00+08:00').watchlist[0].decision_id;
  const second = buildInvestmentAdvice(base, AS_OF, '2026-10-09T09:00:01+08:00').watchlist[0].decision_id;
  assert.equal(first, second);
  const changedContext = structuredClone(base); changedContext.profile = { ...changedContext.profile, purpose: '另一个用途' };
  assert.notEqual(first, buildInvestmentAdvice(changedContext).watchlist[0].decision_id);
  const changedData = structuredClone(base); (changedData.snapshots[STOCK.id] as any).quote.price = 161;
  assert.notEqual(first, buildInvestmentAdvice(changedData).watchlist[0].decision_id);
  const changedMarket = structuredClone(base); changedMarket.market = { status: 'stale', date: '2026-10-08' } as any;
  assert.notEqual(first, buildInvestmentAdvice(changedMarket).watchlist[0].decision_id);
  const otherDay = structuredClone(base); (otherDay.snapshots[STOCK.id] as any).as_of = '2026-10-08';
  assert.notEqual(first, buildInvestmentAdvice(otherDay, '2026-10-08').watchlist[0].decision_id);
  assert.match(buildInvestmentAdvice(base).watchlist[0].plan.invalidation, /新交易日/);
});

test('identity mismatch is blocked and account context is used in decision identity', () => {
  const bad = snapshot(STOCK) as unknown as Record<string, any>;
  bad.instrument_id = 'stock:SZ:000001';
  const item = buildInvestmentAdvice(state([STOCK], { [STOCK.id]: bad as Snapshot }, { profile: profile() })).watchlist[0];
  assert.equal(item.action, 'wait');
  assert.equal(item.status, 'identity_mismatch');
  const first = buildInvestmentAdvice(state([STOCK], { [STOCK.id]: snapshot(STOCK) }, { profile: profile() })).watchlist[0].decision_id;
  const withContext = state([STOCK], { [STOCK.id]: snapshot(STOCK) }, { profile: profile() });
  withContext.account_context = { as_of: AS_OF, observed_time: null, source: 'synthetic', broker_assets: 1, broker_market_value: 0, broker_available_cash: 0, broker_floating_pnl: null, broker_day_pnl: null, broker_month_pnl: null, broker_month_return_pct: null, external_cash: 1, external_available_hours: null, horizon: '', purpose: null, cost_note: '', notes: '', positions: [], recorded_at: `${AS_OF}T00:00:00.000Z` };
  assert.notEqual(first, buildInvestmentAdvice(withContext).watchlist[0].decision_id);
});
