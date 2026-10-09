import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1-helper.ts';
import { backupInvestmentAll, validateInvestmentBackup } from '../lib/investment-backup.ts';
import { sha256 } from '../lib/protocol.ts';
import { InvestmentStore } from '../lib/investment-store.ts';
import { todayShanghai, validDate, validPlanDate, type Instrument, type Snapshot } from '../lib/investment-domain.ts';

test('analysis export bindings coexist with concurrent state writes without changing CAS version',async()=>{
 const {db}=database(),store=new InvestmentStore(db,'export-owner');
 const binding={instrument_id:null,report_type:'market' as const,context_id:'context-synthetic',exported_at:new Date().toISOString()};
 await Promise.all([store.registerExport('personal','snapshot-a',binding),store.registerExport('personal','snapshot-b',binding),store.mutate('personal',{base_version:0,operation_id:'parallel-profile'},state=>{state.profile.purpose='合成研究';return {};})]);
 const state=await store.snapshot('personal');assert.equal(state.version,1);assert.deepEqual(state.exports['snapshot-a'],binding);assert.deepEqual(state.exports['snapshot-b'],binding);assert.equal(state.profile.purpose,'合成研究');
});

test('investment daily backup rejects capacity overflow rather than reporting truncated success',async()=>{
 const {db}=database();
 for(let i=0;i<201;i++)await new InvestmentStore(db,'capacity-'+i).ensure('demo');
 let writes=0;
 await assert.rejects(()=>backupInvestmentAll(db,{put:async()=>{writes++;}} as unknown as KVNamespace),/capacity exceeded/);
 assert.equal(writes,0);
});

test('stale provider output is retained and marked degraded rather than source success',async()=>{
 const {db}=database();const provider={fetchInvestmentSnapshot:(instrument:Instrument)=>({...snapshotFor(instrument),status:'stale' as const,error:'upstream failed'})};
 const store=new InvestmentStore(db,'stale-owner',provider);const before=await store.snapshot('demo');
 const refreshed=await store.refresh('demo',{base_version:before.version,operation_id:'stale-refresh'});
 assert.equal(refreshed.job.result?.source_health[0].status,'degraded');assert.equal((await store.snapshot('demo')).snapshots[before.instruments[0].id].status,'stale');
});

function snapshotFor(instrument: Instrument): Snapshot {
  return {
    snapshot_id: `synthetic-${instrument.id}`,
    instrument_id: instrument.id,
    source: 'synthetic-test',
    source_url: null,
    as_of: todayShanghai(),
    fetched_at: new Date().toISOString(),
    status: 'fresh',
    error: null,
    quote: { price: 10, change_pct: null, open: null, high: null, low: null, preclose: null, volume: null, amount: null },
    history: [],
    adjustment: 'none',
    valuation_kind: 'market_price',
    metrics: { ma20: null, ma60: null, return_20d: null, range_120d: null, history_count: 0 },
    fundamentals: [],
    evidence: [],
    warnings: [],
  };
}

test('investment store refreshes at most five instruments and exposes the next cursor', async () => {
  const { db } = database();
  const instruments: Instrument[] = Array.from({ length: 6 }, (_, index) => {
    const code = String(900000 + index);
    return { id: `index:SH:${code}`, code, name: `合成指数${index}`, kind: 'index', exchange: 'SH' };
  });
  const provider = { fetchInvestmentSnapshot: async (instrument: Instrument) => snapshotFor(instrument) };
  const store = new InvestmentStore(db, 'refresh-owner', provider);
  await store.mutate('personal', { base_version: 0, operation_id: 'seed-refresh', payload: instruments }, (state) => {
    state.instruments = instruments;
    return { count: instruments.length };
  });
  const first = await store.refresh('personal', { base_version: 1, operation_id: 'refresh-first' });
  assert.deepEqual(first.job.result?.selected_ids, instruments.slice(0, 5).map((x) => x.id));
  assert.equal(first.job.result?.remaining, 1);
  assert.equal(first.job.result?.next_cursor, instruments[4].id);
  const second = await store.refresh('personal', { base_version: 2, operation_id: 'refresh-second', cursor: first.job.result?.next_cursor || undefined });
  assert.deepEqual(second.job.result?.selected_ids, [instruments[5].id]);
  assert.equal(second.job.result?.remaining, 0);
  assert.equal(second.job.result?.next_cursor, null);
  await assert.rejects(() => store.refresh('personal', { base_version: 3, operation_id: 'refresh-too-many', ids: instruments.map((x) => x.id) }), /最多5个品种/);
});

test('investment CAS and operation receipt commit atomically under concurrent writers', async () => {
  const { db } = database();
  const store = new InvestmentStore(db, 'atomic-owner');
  const writes = ['atomic-a', 'atomic-b'].map((operation_id) => store.mutate('personal', { base_version: 0, operation_id, payload: operation_id }, (state) => {
    state.profile = { ...state.profile, purpose: operation_id };
    return { purpose: operation_id };
  }));
  const results = await Promise.allSettled(writes);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const state = await store.snapshot('personal');
  assert.equal(state.version, 1);
  const receipts = await db.prepare('SELECT COUNT(*) AS count FROM investment_operations WHERE owner_id=? AND space=?').bind('atomic-owner', 'personal').first<{ count: number }>();
  assert.equal(Number(receipts?.count), 1);
});

test('portable investment backups require schema, matching version and a state hash', async () => {
  const { db } = database();
  const store = new InvestmentStore(db, 'portable-owner');
  const state = await store.snapshot('personal');
  const envelope = { schema_version: 1 as const, owner: state.owner, space: state.space, version: state.version, state, state_sha256: await sha256(JSON.stringify(state)) };
  assert.deepEqual(await validateInvestmentBackup(envelope, state.owner, state.space), state);
  await assert.rejects(() => validateInvestmentBackup({ ...envelope, state_sha256: undefined }, state.owner, state.space), /哈希格式/);
  await assert.rejects(() => validateInvestmentBackup({ ...envelope, version: envelope.version + 1 }, state.owner, state.space), /版本/);
  const values: Array<{ key: string; options?: Record<string, unknown> }> = [];
  await backupInvestmentAll(db, { put: async (key: string, _value: string, options?: Record<string, unknown>) => { values.push({ key, options }); } } as unknown as KVNamespace);
  assert.equal(values.length, 1);
  assert.match(values[0].key, /^investment\/[a-f0-9]{64}\/personal\/latest$/);
  assert.equal(values[0].options?.expirationTtl, 90 * 86400);
});

test('plan dates may target a future trading day while ledger dates cannot', () => {
  assert.equal(validPlanDate('2099-01-01'), '2099-01-01');
  assert.throws(() => validDate('2099-01-01'), /不能在未来/);
});
