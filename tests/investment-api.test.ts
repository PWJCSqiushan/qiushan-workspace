import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1-helper.ts';
import { handleInvestmentRequest } from '../lib/investment-api.ts';
import { InvestmentStore } from '../lib/investment-store.ts';
import { todayShanghai, type Instrument } from '../lib/investment-domain.ts';

const stock: Instrument = { id: 'stock:SH:600000', code: '600000', name: '合成测试股票', kind: 'stock', exchange: 'SH' };

test('automatic advice recomputes server-side, saves one protected plan and rejects outdated decisions',async()=>{
 const {db}=database(),store=new InvestmentStore(db,'advice-owner');
 const bootstrap=await call(store,'/api/investment/bootstrap?space=demo');assert.equal(bootstrap.value.advice.engine.validation,'unvalidated');assert.equal(bootstrap.value.advice.market.score,null);
 const advice=(await call(store,'/api/investment/advice?space=demo')).value,item=advice.watchlist[0];assert(item);assert.equal(item.plan.budget,null);
 const before=await store.snapshot('demo'),ledger=JSON.stringify({opening:before.opening,transactions:before.transactions});
 let r=await call(store,'/api/investment/advice/plans?space=demo','POST',{space:'demo',base_version:before.version,operation_id:'advice-save',instrument_id:item.instrument_id,decision_id:item.decision_id,action:'buy',budget:999999});
 assert.equal(r.response.status,200);assert.equal(r.value.budget,null);assert.equal(r.value.action,item.plan.action);const planId=r.value.id;
 assert.equal((await store.backups('demo')).length,1);
 r=await call(store,'/api/investment/advice/plans?space=demo','POST',{space:'demo',base_version:r.value.version,operation_id:'advice-save-again',instrument_id:item.instrument_id,decision_id:item.decision_id});assert.equal(r.response.status,200);assert.equal(r.value.id,planId);
 assert.equal((await store.backups('demo')).length,1);assert.equal((await store.snapshot('demo')).plans.length,1);
 const after=await store.snapshot('demo');assert.equal(JSON.stringify({opening:after.opening,transactions:after.transactions}),ledger);
 await store.mutate('demo',{base_version:after.version,operation_id:'advice-context-change'},s=>{s.profile.purpose='修改合成资金用途';return {};});
 r=await call(store,'/api/investment/advice/plans?space=demo','POST',{space:'demo',base_version:after.version+1,operation_id:'advice-stale',instrument_id:item.instrument_id,decision_id:item.decision_id});assert.equal(r.response.status,409);assert.equal((await store.snapshot('demo')).plans.length,1);
});

test('opening and account context are protected; removing a sold holding preserves ledger identity',async()=>{
 const {db}=database(),store=new InvestmentStore(db,'protected-owner');
 let r=await call(store,'/api/investment/watchlist','POST',{base_version:0,operation_id:'protect-add',...stock});
 r=await call(store,'/api/investment/ledger/initialize','POST',{base_version:r.value.version,operation_id:'protect-opening',date:todayShanghai(),cash:9000,positions:[{instrument_id:stock.id,quantity:100,reference_price:10,average_cost:null}],confirmed_empty:false});
 assert.equal(r.response.status,200);assert.equal((await store.backups('personal')).length,1);
 assert.equal((await store.snapshot('personal')).profile.initial_capital,10000);
 assert.equal((await call(store,'/api/investment/watchlist/'+stock.id,'DELETE',{base_version:r.value.version,operation_id:'reject-held-remove'})).response.status,400);
 r=await call(store,'/api/investment/transactions','POST',{base_version:r.value.version,operation_id:'protect-sell',kind:'sell',date:todayShanghai(),instrument_id:stock.id,quantity:100,price:10,fees:0});
 assert.equal(r.response.status,200);
 r=await call(store,'/api/investment/watchlist/'+stock.id,'DELETE',{base_version:r.value.version,operation_id:'remove-closed'});assert.equal(r.response.status,200);
 const state=await store.snapshot('personal');assert.equal(state.instruments.length,1);assert.equal(state.instruments[0].watched,false);assert.equal(state.transactions.length,1);assert.equal((await call(store,'/api/investment/bootstrap')).value.instruments.length,0);
 r=await call(store,'/api/investment/account-context','PUT',{base_version:r.value.version,operation_id:'protect-context',as_of:todayShanghai(),observed_time:null,source:'合成核验',broker_assets:10000,broker_market_value:0,broker_available_cash:10000,broker_floating_pnl:null,broker_day_pnl:null,broker_month_pnl:null,broker_month_return_pct:null,external_cash:3000,external_available_hours:null,horizon:'一年',purpose:'合成测试',cost_note:'成本未知',notes:'合成',positions:[]});
 assert.equal(r.response.status,200);assert.equal((await store.backups('personal')).length,2);
 assert.equal((await call(store,'/api/investment/portfolio')).value.cash,10000);
});

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
  assert.equal(result.value.quantity, 100);
  const firstId = result.value.id;
  const retry = await call(a, '/api/investment/transactions?space=personal', 'POST', { space: 'personal', base_version: 1, operation_id: 'tx-1', kind: 'buy', date: '2026-10-01', instrument_id: stock.id, quantity: 100, price: 10, fees: 0 });
  assert.equal(retry.value.id, firstId);
  assert.equal((await call(a, '/api/investment/transactions?space=personal')).value.items, undefined);
  assert.equal((await call(a, '/api/investment/profile?space=personal', 'PUT', { space: 'personal', base_version: 1, operation_id: 'stale', purpose: '旧客户端' })).response.status,409);
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
  assert.equal((await call(store, '/api/investment/profile?space=personal')).value.purpose, '改变上下文');
  assert.equal((await store.backups('personal')).length >= 2, true);
});
