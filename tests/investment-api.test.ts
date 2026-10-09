import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1-helper.ts';
import { handleInvestmentRequest } from '../app/api/investment/route.ts';
import { InvestmentStore } from '../lib/investment-store.ts';
import { todayShanghai, type Instrument } from '../lib/investment-domain.ts';

const stock: Instrument = { id: 'stock:SH:600000', code: '600000', name: '合成测试股票', kind: 'stock', exchange: 'SH' };

function req(path: string, method = 'GET', payload?: unknown) {
  return new Request(`https://private.example${path}`, {
    method,
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
}

async function call(store: InvestmentStore, path: string, method = 'GET', payload?: unknown) {
  const response = await handleInvestmentRequest(req(path, method, payload), store);
  const value = await response.json();
  return { response, value: value as Record<string, any> };
}

test('investment API enforces owner+space isolation, optimistic versions and operation idempotency', async () => {
  const { db } = database();
  const a = new InvestmentStore(db, 'owner-a'), b = new InvestmentStore(db, 'owner-b');
  let result = await call(a, '/api/investment/bootstrap?space=personal');
  assert.equal(result.value.transactions.length, 0);
  assert.equal(result.value.instruments.length, 0);
  result = await call(a, '/api/investment/watchlist?space=personal', 'POST', { space: 'personal', base_version: 0, operation_id: 'add-1', ...stock });
  assert.equal(result.response.status, 200);
  assert.equal(result.value.version, 1);
  result = await call(a, '/api/investment/transactions?space=personal', 'POST', { space: 'personal', base_version: 1, operation_id: 'tx-1', kind: 'buy', date: '2026-10-01', instrument_id: stock.id, quantity: 100, price: 10, fees: 0 });
  assert.equal(result.value.transaction.quantity, 100);
  const firstId = result.value.transaction.id;
  const retry = await call(a, '/api/investment/transactions?space=personal', 'POST', { space: 'personal', base_version: 1, operation_id: 'tx-1', kind: 'buy', date: '2026-10-01', instrument_id: stock.id, quantity: 100, price: 10, fees: 0 });
  assert.equal(retry.value.transaction.id, firstId);
  assert.equal((await call(a, '/api/investment/transactions?space=personal')).value.items, undefined);
  await assert.rejects(() => call(a, '/api/investment/profile?space=personal', 'PUT', { space: 'personal', base_version: 1, operation_id: 'stale', purpose: '旧客户端' }), /投资账本已在其他设备修改/);
  const other = await call(b, '/api/investment/bootstrap?space=personal');
  assert.equal(other.value.transactions.length, 0);
  const demo = await call(b, '/api/investment/bootstrap?space=demo');
  assert.equal(demo.value.sample_notice.includes('合成'), true);
  assert.equal(demo.value.instruments.length > 0, true);
});

test('analysis package binds context and snapshot, then reports become stale after profile change; restore makes a protected backup', async () => {
  const { db } = database();
  const store = new InvestmentStore(db, 'owner-report');
  let r = await call(store, '/api/investment/watchlist?space=personal', 'POST', { base_version: 0, operation_id: 'add', ...stock });
  const today = todayShanghai();
  await store.mutate('personal', { base_version: r.value.version, operation_id: 'seed-snapshot', payload: 'test' }, (state) => {
    state.snapshots[stock.id] = { snapshot_id: 'snapshot-current', instrument_id: stock.id, source: 'test', source_url: null, as_of: today, fetched_at: new Date().toISOString(), status: 'fresh', error: null, quote: { price: 10, change_pct: null, open: null, high: null, low: null, preclose: null, volume: null, amount: null }, history: [], adjustment: 'none', valuation_kind: 'market_price', metrics: { ma20: null, ma60: null, return_20d: null, range_120d: null, history_count: 0 }, fundamentals: [], evidence: [], warnings: [] };
    return { ok: true };
  });
  r = await call(store, `/api/investment/analysis-package?space=personal&type=diagnosis&instrument_id=${encodeURIComponent(stock.id)}`);
  const pkg = r.value;
  assert.equal(pkg.context_id.length > 0, true);
  const current = (await store.snapshot('personal')).version;
  const report = await call(store, '/api/investment/reports?space=personal', 'POST', { base_version: current, operation_id: 'report-1', report_type: 'diagnosis', instrument_id: stock.id, snapshot_id: pkg.snapshot_id, context_id: pkg.context_id, conclusion: '待补充', sections: pkg.report_template.sections, sources: [] });
  assert.equal(report.response.status, 200);
  const profileVersion = report.value.version;
  await call(store, '/api/investment/profile?space=personal', 'PUT', { base_version: profileVersion, operation_id: 'profile-change', purpose: '改变上下文' });
  const reports = await call(store, '/api/investment/reports?space=personal');
  assert.equal(reports.value[0].is_stale, true);
  const versionBeforeBackup = (await store.snapshot('personal')).version;
  const backup = await call(store, '/api/investment/backups?space=personal', 'POST', { base_version: versionBeforeBackup, operation_id: 'backup-1' });
  assert.equal(backup.response.status, 200);
  const afterBackupVersion = (await store.snapshot('personal')).version;
  await call(store, '/api/investment/profile?space=personal', 'PUT', { base_version: afterBackupVersion, operation_id: 'profile-change-2', purpose: '第二次改变' });
  const restoreVersion = (await store.snapshot('personal')).version;
  const restored = await call(store, '/api/investment/backups/restore?space=personal', 'POST', { base_version: restoreVersion, operation_id: 'restore-1', name: backup.value.name });
  assert.equal(restored.response.status, 200);
  assert.equal((await call(store, '/api/investment/profile?space=personal')).value.profile.purpose, '改变上下文');
  assert.equal((await store.backups('personal')).length >= 2, true);
});
