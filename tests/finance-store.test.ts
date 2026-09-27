import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1-helper.ts';
import { FinanceStore } from '../lib/finance-store.ts';
import {
  exportFinanceBackup,
  restoreFinanceBackup,
  validateFinanceBackup,
} from '../lib/finance-backup.ts';
import {
  emptyFinanceState,
  applyFinancePatches,
  type FinanceMutation,
  type FinanceTransaction,
} from '../lib/finance-types.ts';
import { handleFinanceRequest } from '../lib/finance-api.ts';
import { sha256 } from '../lib/protocol.ts';

async function fixture() {
  const { db, sqlite } = database(),
    store = new FinanceStore(db, 'synthetic-a');
  let sequence = 0;
  const send = (
    mutation: FinanceMutation,
    operationId = 'op_' + ++sequence,
    baseVersion = 0,
  ) => store.mutate({ space: 'demo', operationId, baseVersion, mutation });
  await send({
    type: 'configure',
    categories: [
      { id: 'root', version: 0, name: '合成用途', parentId: null, level: 1 },
      { id: 'sub', version: 0, name: '合成小类', parentId: 'root', level: 2 },
      { id: 'leaf', version: 0, name: '合成明细', parentId: 'sub', level: 3 },
    ],
  });
  await send({
    type: 'batch',
    mutations: [
      {
        type: 'put',
        collection: 'accounts',
        expectedVersion: 0,
        entity: {
          id: 'cash',
          version: 0,
          name: '合成账户',
          kind: 'asset',
          openingCents: 100000,
          openingAt: '2026-01-01T00:00:00+08:00',
        },
      },
      {
        type: 'put',
        collection: 'accounts',
        expectedVersion: 0,
        entity: {
          id: 'card',
          version: 0,
          name: '合成饭卡',
          kind: 'asset',
          openingCents: 0,
          openingAt: '2026-01-01T00:00:00+08:00',
        },
      },
    ],
  });
  const expense = (
    id: string,
    paid = 12000,
    own = 4000,
  ): FinanceTransaction => ({
    id,
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-10T12:00:00+08:00',
    accountId: 'cash',
    amountCents: paid,
    personalCents: own,
    allocations: [
      {
        id: id + '_a',
        categoryId: 'leaf',
        content: '餐饮',
        amountCents: own,
        nature: 'daily',
      },
    ],
  });
  return { db, sqlite, store, send, expense };
}
test('finance D1 mutation is atomic, receipt replay is small, different records accept stale global revision', async () => {
  const { store, send, expense, sqlite } = await fixture(),
    tx = expense('meal');
  const mutation = {
    type: 'saveTransaction' as const,
    transaction: tx,
    expectedVersion: 0,
  };
  const a = await send(mutation, 'stable');
  const b = await send(mutation, 'stable');
  assert.deepEqual(b, a);
  assert.equal(
    sqlite
      .prepare(
        "SELECT COUNT(*) n FROM finance_postings WHERE transaction_id='meal'",
      )
      .get()!.n,
    3,
  );
  await assert.rejects(
    () =>
      send(
        { ...mutation, transaction: { ...tx, amountCents: 13000 } },
        'stable',
      ),
    /同一操作/,
  );
  await send(
    {
      type: 'saveTransaction',
      transaction: expense('second'),
      expectedVersion: 0,
    },
    'other',
    0,
  );
  const latest = (await store.snapshot('demo')).transactions.find(
    (t) => t.id === 'meal',
  )!;
  await send({
    type: 'saveTransaction',
    transaction: { ...latest, note: 'new' },
    expectedVersion: latest.version,
  });
  await assert.rejects(
    () =>
      send({
        type: 'saveTransaction',
        transaction: { ...latest, note: 'stale' },
        expectedVersion: latest.version,
      }),
    /其他设备/,
  );
  assert.equal((await store.snapshot('demo')).transactions.length, 2);
  assert.ok(JSON.stringify(a).length < 2500);
  sqlite.close();
});
test('finance partial SQL reads include all original settlements and cap multiple refunds and collections', async () => {
  const { store, send, expense, sqlite } = await fixture();
  await send({
    type: 'saveTransaction',
    transaction: expense('aa'),
    expectedVersion: 0,
  });
  const collect = (id: string, n: number): FinanceTransaction => ({
    id,
    version: 0,
    kind: 'collect',
    occurredAt: '2026-09-12T00:00:00Z',
    accountId: 'cash',
    amountCents: n,
    relatedId: 'aa',
    allocations: [],
  });
  await send({
    type: 'saveTransaction',
    transaction: collect('c1', 5000),
    expectedVersion: 0,
  });
  await assert.rejects(
    () =>
      send({
        type: 'saveTransaction',
        transaction: collect('c2', 4000),
        expectedVersion: 0,
      }),
    /exceeds/,
  );
  const refund = (id: string, n: number): FinanceTransaction => ({
    id,
    version: 0,
    kind: 'refund',
    occurredAt: '2026-10-01T00:00:00Z',
    accountId: 'cash',
    amountCents: n,
    personalCents: n,
    relatedId: 'aa',
    allocations: [
      {
        id: id + '_a',
        categoryId: 'leaf',
        content: '餐饮',
        amountCents: n,
        nature: 'daily',
        refundOfAllocationId: 'aa_a',
      },
    ],
  });
  await send({
    type: 'saveTransaction',
    transaction: refund('r1', 3000),
    expectedVersion: 0,
  });
  await assert.rejects(
    () =>
      send({
        type: 'saveTransaction',
        transaction: refund('r2', 2000),
        expectedVersion: 0,
      }),
    /exceeds/,
  );
  assert.equal(
    (await store.stats('demo', { from: '2026-09-01', to: '2026-10-01' }))
      .personalCents,
    1000,
  );
  sqlite.close();
});
test('finance transfers, batch validation failure and tombstones do not duplicate consumption', async () => {
  const { store, send, expense, sqlite } = await fixture();
  const before = await store.version('demo');
  await assert.rejects(() =>
    send({
      type: 'batch',
      mutations: [
        {
          type: 'saveTransaction',
          transaction: expense('valid'),
          expectedVersion: 0,
        },
        {
          type: 'saveTransaction',
          transaction: { ...expense('invalid'), accountId: 'missing' },
          expectedVersion: 0,
        },
      ],
    }),
  );
  assert.equal(await store.version('demo'), before);
  assert.equal((await store.snapshot('demo')).transactions.length, 0);
  await send({
    type: 'saveTransaction',
    transaction: {
      id: 'topup',
      version: 0,
      kind: 'transfer',
      accountId: 'cash',
      targetAccountId: 'card',
      amountCents: 10000,
      occurredAt: '2026-09-10T00:00:00Z',
      allocations: [],
    },
    expectedVersion: 0,
  });
  await send({
    type: 'saveTransaction',
    transaction: { ...expense('imported'), sourceKey: 'platform:abcdef' },
    expectedVersion: 0,
  });
  await send({
    type: 'delete',
    collection: 'transactions',
    id: 'imported',
    expectedVersion: 1,
  });
  await assert.rejects(
    () =>
      send({
        type: 'saveTransaction',
        transaction: { ...expense('duplicate'), sourceKey: 'platform:abcdef' },
        expectedVersion: 0,
      }),
    /duplicate|UNIQUE|来源/,
  );
  const stats = await store.stats('demo', {
    from: '2026-09-01',
    to: '2026-10-01',
  });
  assert.equal(stats.personalCents, 0);
  assert.equal(
    stats.accountBalances.find((a) => a.id === 'card')!.cents,
    10000,
  );
  sqlite.close();
});
test('finance undo redo order and backup restore preserve balances without touching other spaces', async () => {
  const { store, send, expense, sqlite, db } = await fixture();
  await send(
    {
      type: 'saveTransaction',
      transaction: expense('first'),
      expectedVersion: 0,
    },
    'z_first',
  );
  await send(
    {
      type: 'saveTransaction',
      transaction: expense('second'),
      expectedVersion: 0,
    },
    'a_second',
  );
  await send({ type: 'undo', historyId: 'a_second' });
  await send({ type: 'undo', historyId: 'z_first' });
  await send({ type: 'redo', historyId: 'z_first' });
  await send({ type: 'redo', historyId: 'a_second' });
  const original = await exportFinanceBackup(store, 'demo');
  await validateFinanceBackup(original);
  await send({
    type: 'saveTransaction',
    transaction: expense('third'),
    expectedVersion: 0,
  });
  const restored = await restoreFinanceBackup(
    store,
    original,
    'restore_1',
    await store.version('demo'),
  );
  assert.equal(restored.restored, true);
  assert.equal(
    (await store.snapshot('demo')).transactions.filter((t) => !t.deleted)
      .length,
    2,
  );
  await send({ type: 'undo', historyId: 'a_second' });
  assert.equal(
    (await store.stats('demo', { from: '2026-09-01', to: '2026-10-01' }))
      .personalCents,
    4000,
  );
  await send({ type: 'redo', historyId: 'a_second' });
  assert.equal(
    (await new FinanceStore(db, 'another-user').snapshot('demo')).transactions
      .length,
    0,
  );
  assert.equal((await store.snapshot('personal')).transactions.length, 0);
  await assert.rejects(
    () => validateFinanceBackup({ ...original, sha256: 'bad' }),
    /校验/,
  );
  sqlite.close();
});
test('finance restore invalidates pre-restore receipts while preserving post-restore low-version replay', async () => {
  const { store, send, expense, sqlite } = await fixture();
  const before = await exportFinanceBackup(store, 'demo');
  const lost = {
    type: 'saveTransaction' as const,
    transaction: expense('lost_receipt'),
    expectedVersion: 0,
  };
  await send(lost, 'lost_receipt');
  const currentVersion = await store.version('demo');
  await restoreFinanceBackup(store, before, 'restore_guard', currentVersion);
  await assert.rejects(() => send(lost, 'lost_receipt'), /恢复|核对/);
  assert.equal(
    (await store.snapshot('demo')).transactions.some(
      (t) => t.id === 'lost_receipt',
    ),
    false,
  );
  const later = {
    type: 'saveTransaction' as const,
    transaction: expense('post_restore'),
    expectedVersion: 0,
  };
  const committed = await send(later, 'post_restore');
  await send(
    {
      type: 'saveTransaction',
      transaction: expense('after_post'),
      expectedVersion: 0,
    },
    'after_post',
  );
  const replay = await send(later, 'post_restore');
  assert.equal(replay.version, committed.version);
  sqlite.close();
});
test('finance backup owner and history integrity are checked during preview and restore', async () => {
  const { store, send, expense, db, sqlite } = await fixture();
  await send(
    {
      type: 'saveTransaction',
      transaction: expense('history_seed'),
      expectedVersion: 0,
    },
    'history_seed',
  );
  const original = await exportFinanceBackup(store, 'demo');
  const other = new FinanceStore(db, 'other-owner');
  await assert.rejects(
    () => validateFinanceBackup(original, 'other-owner'),
    /账户/,
  );
  await assert.rejects(
    () => restoreFinanceBackup(other, original, 'cross_owner', 0),
    /账户/,
  );
  await assert.rejects(
    () =>
      handleFinanceRequest(
        new Request('http://local/api/finance/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            space: 'demo',
            backup: original,
            confirm: false,
          }),
        }),
        other,
      ),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      (error as { status?: unknown }).status === 400,
  );
  const alter = async (change: (backup: typeof original) => void) => {
    const copy = JSON.parse(JSON.stringify(original)) as typeof original;
    change(copy);
    copy.sha256 = await sha256({ state: copy.state, history: copy.history });
    return copy;
  };
  const duplicate = await alter((b) => b.history.push(b.history[0]!));
  await assert.rejects(() => validateFinanceBackup(duplicate), /历史/);
  const invalidFlag = await alter((b) => {
    b.history[0]!.undone = 2;
  });
  await assert.rejects(() => validateFinanceBackup(invalidFlag), /历史/);
  const mismatch = await alter((b) => {
    const row = b.history.find((h) =>
      (
        JSON.parse(h.after_json) as Array<{ value: { id: string } | null }>
      ).some((p) => p.value),
    );
    assert.ok(row);
    const patches = JSON.parse(row!.after_json) as Array<{
      collection: string;
      id: string;
      value: { id: string } | null;
    }>;
    const patch = patches.find((p) => p.value)!;
    patch.value!.id = 'mismatched';
    row!.after_json = JSON.stringify(patches);
  });
  await assert.rejects(() => validateFinanceBackup(mismatch), /历史/);
  const projection = await alter((b) => {
    b.state.history[0]!.label += ' changed';
  });
  await assert.rejects(() => validateFinanceBackup(projection), /投影/);
  sqlite.close();
});
test('finance incremental pages reconstruct state, GET endpoints do not create records', async () => {
  const { store, send, expense, sqlite } = await fixture();
  for (let batch = 0; batch < 5; batch++)
    await send({
      type: 'batch',
      mutations: Array.from({ length: 50 }, (_, i) => ({
        type: 'saveTransaction' as const,
        transaction: expense('t' + (batch * 50 + i), 100, 100),
        expectedVersion: 0,
      })),
    });
  let state = emptyFinanceState('synthetic-a', 'demo'),
    cursor = 0,
    pages = 0;
  for (;;) {
    const p = await store.sync('demo', cursor);
    assert.ok(p.changes.length <= 200);
    state = applyFinancePatches(state, p.changes, p.version);
    cursor = p.cursor;
    pages++;
    if (!p.hasMore) break;
  }
  assert.equal(state.transactions.length, 250);
  assert.equal(pages, 2);
  const count = sqlite.prepare('SELECT COUNT(*) n FROM finance_heads').get()!.n;
  const response = await handleFinanceRequest(
    new Request('http://local/api/finance/sync?space=personal'),
    store,
  );
  assert.equal(response.status, 200);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) n FROM finance_heads').get()!.n,
    count,
  );
  sqlite.close();
});
