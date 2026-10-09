import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { FinanceClient } from '../lib/finance-client.ts';
import { FinanceStore } from '../lib/finance-store.ts';
import { handleFinanceRequest, financeFailure } from '../lib/finance-api.ts';
import { database } from './d1-helper.ts';
import type { FinanceTransaction } from '../lib/finance-types.ts';

async function harness(owner: string) {
  const { db, sqlite } = database(), store = new FinanceStore(db, owner), original = globalThis.fetch;
  let offline = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError('synthetic offline');
    const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (path === '/api/session') return Response.json({ owner, expiresAt: Date.now() + 3600000 });
    try { return await handleFinanceRequest(new Request('http://local' + path, init), store); }
    catch (e) { return financeFailure(e); }
  }) as typeof fetch;
  const client = new FinanceClient('demo', () => {});
  await client.start();
  await client.enqueue({ type: 'put', collection: 'accounts', expectedVersion: 0, entity: { id: 'bank', version: 0, name: '合成账户', kind: 'asset', openingCents: 100000, openingAt: '2026-01-01T00:00:00Z' } });
  return { client, store, offline: (value: boolean) => { offline = value; }, close: () => { client.stop(); globalThis.fetch = original; sqlite.close(); } };
}
const expense = (id: string): FinanceTransaction => ({ id, version: 0, kind: 'expense', occurredAt: '2026-09-02T12:00:00+08:00', accountId: 'bank', amountCents: 1200, personalCents: 800, allocations: [] });

void test('snapshot requires explicit draft consent, clones state, and waits for committed receipts', async () => {
  const h = await harness('report-snapshot-a');
  try {
    const initial = await h.client.reportSnapshot(false);
    h.offline(true);
    await h.client.enqueue({ type: 'saveTransaction', transaction: expense('one'), expectedVersion: 0 });
    await assert.rejects(h.client.reportSnapshot(false), /待同步/);
    const draft = await h.client.reportSnapshot(true);
    assert.equal(draft.metadata.pendingCount, 1);
    assert.equal(draft.metadata.localDraft, true);
    assert.equal(draft.state.transactions[0].personalCents, 800);
    assert.equal(initial.state.transactions.length, 0);
    draft.state.transactions[0].personalCents = 1;
    assert.equal(h.client.data!.transactions[0].personalCents, 800);
    h.offline(false); await h.client.sync();
    const confirmed = await h.client.reportSnapshot(false);
    assert.equal(confirmed.metadata.pendingCount, 0);
    assert.equal(confirmed.metadata.localDraft, false);
    assert.equal(confirmed.state.transactions[0].personalCents, 800);
    assert.ok(confirmed.state.version > initial.state.version);
    assert.equal(confirmed.state.space, 'demo');
    assert.ok(Number.isFinite(Date.parse(confirmed.metadata.generatedAt)));
  } finally { h.close(); }
});
void test('conflicting queued edits cannot silently disappear from a marked draft export', async () => {
  const h = await harness('report-snapshot-conflict');
  try {
    h.offline(true);
    await h.client.enqueue({ type: 'saveTransaction', transaction: expense('same'), expectedVersion: 0 });
    await h.store.mutate({ space: 'demo', operationId: 'another-device', baseVersion: 0, mutation: { type: 'saveTransaction', transaction: { ...expense('same'), amountCents: 1600 }, expectedVersion: 0 } });
    h.offline(false); await h.client.sync();
    assert.equal(h.client.pending[0].state, 'conflict');
    await assert.rejects(h.client.reportSnapshot(true), /冲突/);
    await assert.rejects(h.client.reportSnapshot(false), /待同步/);
  } finally { h.close(); }
});
