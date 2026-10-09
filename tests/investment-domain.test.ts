import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROFILE,
  emptyInvestmentState,
  orderCheck,
  replayTransactions,
  summarizeInvestment,
  type Instrument,
} from '../lib/investment-domain.ts';

const stock: Instrument = { id: 'stock:SH:600000', code: '600000', name: '合成测试股票', kind: 'stock', exchange: 'SH' };
const fund: Instrument = { id: 'fund:OF:110022', code: '110022', name: '合成测试基金', kind: 'fund', exchange: 'OF' };

function state() {
  const value = emptyInvestmentState('owner-a', 'personal');
  value.instruments = [stock, fund];
  value.profile = { ...DEFAULT_PROFILE, purpose: '长期储蓄', horizon: '3年', holdings_confirmed: true, commission_rate: 0.001, minimum_commission: 5 };
  return value;
}

test('investment replay keeps cash flows out of profit and confirms fund subscriptions once', () => {
  const value = state();
  value.transactions = [
    { id: 'deposit', kind: 'deposit', date: '2026-10-01', created_at: '2026-10-01T01:00:00Z', amount: 2000, quantity: null, price: null, fees: 0, notes: '' },
    { id: 'buy', kind: 'buy', date: '2026-10-01', created_at: '2026-10-01T02:00:00Z', instrument_id: stock.id, amount: 2000, quantity: 200, price: 10, fees: 5, notes: '' },
    { id: 'pending', kind: 'fund_pending', date: '2026-10-02', created_at: '2026-10-02T01:00:00Z', instrument_id: fund.id, amount: 1000, quantity: null, price: null, fees: null, notes: '', pending_id: 'p-1' },
    { id: 'confirm', kind: 'fund_confirm', date: '2026-10-03', created_at: '2026-10-03T01:00:00Z', instrument_id: fund.id, amount: 980, quantity: 98, price: 10, fees: 2, notes: '', pending_id: 'p-1' },
  ];
  value.snapshots[stock.id] = { snapshot_id: 's-1', instrument_id: stock.id, source: 'test', source_url: null, as_of: '2026-10-09', fetched_at: new Date().toISOString(), status: 'fresh', error: null, quote: { price: 11, change_pct: null, open: null, high: null, low: null, preclose: null, volume: null, amount: null }, history: [], adjustment: 'none', valuation_kind: 'market_price', metrics: { ma20: null, ma60: null, return_20d: null, range_120d: null, history_count: 0 }, fundamentals: [], evidence: [], warnings: [] };
  value.snapshots[fund.id] = { ...value.snapshots[stock.id], snapshot_id: 's-2', instrument_id: fund.id, quote: { ...value.snapshots[stock.id].quote, price: 10 } };
  const replay = replayTransactions(value);
  assert.equal(replay.cash, 9013);
  assert.equal(replay.pending.length, 0);
  assert.equal(replay.positions.get(fund.id)?.quantity, 98);
  const summary = summarizeInvestment(value);
  assert.equal(summary.net_contributions, 12000);
  assert.equal(summary.total_equity, 12193);
  assert.equal(summary.total_pnl, 193);
});

test('unknown fees and unsupported lot rules stay conservative', () => {
  const value = state();
  value.transactions = [{ id: 'buy', kind: 'buy', date: '2026-10-01', created_at: '2026-10-01T01:00:00Z', instrument_id: stock.id, amount: 1000, quantity: 100, price: 10, fees: null, notes: '' }];
  value.snapshots[stock.id] = { snapshot_id: 's-1', instrument_id: stock.id, source: 'test', source_url: null, as_of: '2026-10-09', fetched_at: new Date().toISOString(), status: 'fresh', error: null, quote: { price: 10, change_pct: null, open: null, high: null, low: null, preclose: null, volume: null, amount: null }, history: [], adjustment: 'none', valuation_kind: 'market_price', metrics: { ma20: null, ma60: null, return_20d: null, range_120d: null, history_count: 0 }, fundamentals: [], evidence: [], warnings: [] };
  const summary = summarizeInvestment(value);
  assert.equal(summary.cash_estimated, true);
  assert.equal(summary.total_pnl, null);
  assert.equal(summary.positions[0].average_cost, null);
  const unsupported: Instrument = { id: 'stock:SZ:300001', code: '300001', name: '规则待核验', kind: 'stock', exchange: 'SZ' };
  assert.equal(orderCheck(unsupported, value.profile, 10, 5000).eligible, false);
});
