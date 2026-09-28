import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { localGet, localPut } from '../lib/device-db.ts';
import { FinanceClient } from '../lib/finance-client.ts';
import { FinanceStore } from '../lib/finance-store.ts';
import { database } from './d1-helper.ts';
import { handleFinanceRequest, financeFailure } from '../lib/finance-api.ts';
import { emptyFinanceState } from '../lib/finance-types.ts';
import type { FinanceTransaction } from '../lib/finance-types.ts';
import { skipMealMutation } from '../lib/finance-places.ts';

void test('skip outbox retains a conflict, rebases current links, replays lost receipt and restores through undo', async () => {
  const { db, sqlite } = database(),
    store = new FinanceStore(db, 'skip-client'),
    originalFetch = globalThis.fetch;
  let offline = false,
    loseReceipt = false;
  const operationIds: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError('offline');
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (path === '/api/session')
      return Response.json({
        owner: 'skip-client',
        expiresAt: Date.now() + 3600000,
      });
    let response: Response;
    try {
      response = await handleFinanceRequest(
        new Request('http://local' + path, init),
        store,
      );
    } catch (e) {
      response = financeFailure(e);
    }
    if (path.includes('mutations')) {
      operationIds.push(
        JSON.parse(typeof init?.body === 'string' ? init.body : '').operationId,
      );
      if (loseReceipt) {
        loseReceipt = false;
        throw new TypeError('receipt lost');
      }
    }
    return response;
  }) as typeof fetch;
  const client = new FinanceClient('demo', () => {});
  const tx = (id: string): FinanceTransaction => ({
    id,
    version: 0,
    kind: 'expense',
    accountId: 'bank',
    occurredAt: '2026-09-01T12:00:00+08:00',
    amountCents: 1200,
    personalCents: 800,
    mealId: 'meal',
    allocations: [
      {
        id: id + '-a',
        categoryId: null,
        content: '餐饮',
        amountCents: 800,
        merchantId: 'venue',
        nature: 'daily',
      },
    ],
  });
  try {
    await client.start();
    await client.enqueue({
      type: 'batch',
      mutations: [
        {
          type: 'put',
          collection: 'accounts',
          expectedVersion: 0,
          entity: {
            id: 'bank',
            version: 0,
            name: '合成账户',
            kind: 'asset',
            openingCents: 50000,
            openingAt: '2026-01-01T00:00:00Z',
          },
        },
        {
          type: 'put',
          collection: 'places',
          expectedVersion: 0,
          entity: { id: 'venue', version: 0, name: '合成餐厅', parentId: null },
        },
        {
          type: 'put',
          collection: 'meals',
          expectedVersion: 0,
          entity: {
            id: 'meal',
            version: 0,
            date: '2026-09-01',
            meal: 'lunch',
            placeId: 'venue',
            companions: 'alone',
            payment: 'aa',
            pricePending: false,
          },
        },
        {
          type: 'saveTransaction',
          expectedVersion: 0,
          transaction: tx('first'),
        },
      ],
    });
    offline = true;
    await client.enqueue(skipMealMutation(client.data!, client.data!.meals[0]));
    assert.equal(client.data!.meals[0].status, 'skipped');
    const draftId = client.pending[0].operationId;
    await store.mutate({
      space: 'demo',
      baseVersion: 0,
      operationId: 'other-device-new-link',
      mutation: {
        type: 'saveTransaction',
        transaction: tx('second'),
        expectedVersion: 0,
      },
    });
    offline = false;
    await client.sync();
    assert.equal(client.pending[0].operationId, draftId);
    assert.equal(client.pending[0].state, 'conflict');
    const latest = await store.snapshot('demo');
    assert.equal(latest.meals[0].status, undefined);
    assert.equal(latest.transactions.length, 2);
    await store.mutate({
      space: 'demo',
      baseVersion: 0,
      operationId: 'changed-during-review',
      mutation: {
        type: 'saveTransaction',
        transaction: {
          ...latest.transactions.find((t) => t.id === 'second')!,
          note: 'latest financial note',
        },
        expectedVersion: 1,
      },
    });
    await assert.rejects(client.resolve(draftId, true), /核对期间/);
    assert.equal(client.pending[0].operationId, draftId);
    loseReceipt = true;
    await client.resolve(draftId, true);
    assert.equal(client.pending.length, 1);
    const retry = client.pending[0];
    assert.notEqual(retry.operationId, draftId);
    assert.equal(retry.mutation.type, 'skipMeal');
    if (retry.mutation.type === 'skipMeal')
      assert.equal(retry.mutation.expectedTransactions.length, 2);
    await client.sync();
    assert.equal(client.pending.length, 0);
    assert.equal(operationIds.at(-1), operationIds.at(-2));
    const skipped = await store.snapshot('demo');
    assert.equal(skipped.meals[0].status, 'skipped');
    assert.ok(skipped.transactions.every((t) => !t.mealId));
    assert.equal(
      skipped.history.filter((h) => h.label.includes('未用餐')).length,
      1,
    );
    await client.enqueue({
      type: 'undo',
      historyId: skipped.history.at(-1)!.id,
    });
    assert.ok(client.data!.transactions.every((t) => t.mealId === 'meal'));
    assert.equal(client.data!.meals[0].status, undefined);
  } finally {
    client.stop();
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

void test('finance outbox keeps stable IDs after lost responses, serializes offline edits, and retains genuine conflicts', async () => {
  const { db, sqlite } = database(),
    store = new FinanceStore(db, 'client-test'),
    originalFetch = globalThis.fetch;
  let offline = false,
    loseReceipt = false,
    wrongReceipt = false;
  const operationIds: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (offline) throw new TypeError('network unavailable');
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (path === '/api/session')
      return Response.json({
        owner: 'client-test',
        expiresAt: Date.now() + 3600000,
      });
    if (init?.body && path.includes('mutations'))
      operationIds.push(
        JSON.parse(typeof init.body === 'string' ? init.body : '').operationId,
      );
    let response: Response;
    try {
      response = await handleFinanceRequest(
        new Request('http://local' + path, init),
        store,
      );
    } catch (e) {
      response = financeFailure(e);
    }
    if (path.includes('mutations') && loseReceipt) {
      loseReceipt = false;
      throw new TypeError('response lost');
    }
    if (path.includes('mutations') && wrongReceipt) {
      const body = (await response.json()) as Record<string, unknown>;
      return Response.json({ ...body, operationId: 'different' });
    }
    return response;
  }) as typeof fetch;
  const client = new FinanceClient('demo', () => {});
  try {
    await client.start();
    await client.enqueue({
      type: 'put',
      collection: 'accounts',
      entity: {
        id: 'bank',
        version: 0,
        name: '合成账户',
        kind: 'asset',
        openingCents: 100000,
        openingAt: '2026-01-01T00:00:00Z',
      },
      expectedVersion: 0,
    });
    const expense = (id: string, version = 0): FinanceTransaction => ({
      id,
      version,
      kind: 'expense',
      accountId: 'bank',
      occurredAt: '2026-09-01T00:00:00Z',
      amountCents: 1000,
      personalCents: 1000,
      allocations: [
        {
          id: id + '_a',
          categoryId: null,
          content: '其他',
          amountCents: 1000,
          nature: 'daily',
        },
      ],
    });
    offline = true;
    await client.enqueue({
      type: 'saveTransaction',
      transaction: expense('one'),
      expectedVersion: 0,
    });
    await client.enqueue({
      type: 'saveTransaction',
      transaction: expense('two'),
      expectedVersion: 0,
    });
    assert.equal(client.pending.length, 2);
    assert.equal(client.data!.transactions.length, 2);
    assert.equal((await store.snapshot('demo')).transactions.length, 0);
    offline = false;
    loseReceipt = true;
    await client.sync();
    assert.equal(client.pending.length, 2);
    await client.sync();
    assert.equal(client.pending.length, 0);
    assert.equal(operationIds[1], operationIds[2]);
    assert.equal((await store.snapshot('demo')).transactions.length, 2);
    offline = true;
    await client.enqueue({
      type: 'saveTransaction',
      transaction: { ...expense('one', 1), note: 'local draft' },
      expectedVersion: 1,
    });
    await store.mutate({
      space: 'demo',
      operationId: 'other-device',
      baseVersion: 0,
      mutation: {
        type: 'saveTransaction',
        transaction: { ...expense('one', 1), note: 'remote version' },
        expectedVersion: 1,
      },
    });
    offline = false;
    await client.sync();
    assert.equal(client.pending[0].state, 'conflict');
    assert.equal(
      (await store.snapshot('demo')).transactions.find((t) => t.id === 'one')!
        .note,
      'remote version',
    );
    await client.resolve(client.pending[0].operationId, false);
    assert.equal(client.pending.length, 0);
    wrongReceipt = true;
    await client.enqueue({
      type: 'saveTransaction',
      transaction: expense('three'),
      expectedVersion: 0,
    });
    assert.equal(client.pending.length, 1);
    assert.match(client.pending[0].error!, /回执/);
    wrongReceipt = false;
    await client.sync();
    assert.equal(client.pending.length, 0);
    assert.equal((await store.snapshot('demo')).transactions.length, 3);
  } finally {
    client.stop();
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
void test('fresh offline launch does not infer a signed-in owner from another cached session', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('offline');
  }) as typeof fetch;
  const client = new FinanceClient('demo', () => {});
  try {
    await client.start();
    assert.equal(client.data, null);
    assert.equal(client.blocked, true);
    assert.match(client.message, /身份/);
  } finally {
    client.stop();
    globalThis.fetch = original;
  }
});

void test('interrupted delta pagination never exposes or caches a partial ledger', async () => {
  const original = globalThis.fetch;
  let failSecond = true;
  const cursors: number[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (path === '/api/session')
      return Response.json({
        owner: 'pagination-test',
        expiresAt: Date.now() + 10000,
      });
    const cursor = Number(
      new URL('http://local' + path).searchParams.get('cursor'),
    );
    cursors.push(cursor);
    if (cursor === 200 && failSecond) throw new TypeError('lost second page');
    const changes = Array.from({ length: cursor === 0 ? 200 : 1 }, (_, i) => ({
      collection: 'accounts',
      id: 'account' + (cursor + i),
      value: {
        id: 'account' + (cursor + i),
        version: 1,
        name: '合成账户',
        kind: 'asset',
        openingCents: 0,
        openingAt: '2026-01-01T00:00:00Z',
      },
    }));
    return Response.json({
      owner: 'pagination-test',
      space: 'demo',
      version: 1,
      cursor: cursor === 0 ? 200 : 201,
      hasMore: cursor === 0,
      changes,
      history: [],
    });
  }) as typeof fetch;
  const client = new FinanceClient('demo', () => {});
  try {
    await client.start();
    assert.equal(client.data!.accounts.length, 0);
    failSecond = false;
    await client.sync();
    assert.equal(client.data!.accounts.length, 201);
    assert.deepEqual(cursors, [0, 200, 0, 200]);
  } finally {
    client.stop();
    globalThis.fetch = original;
  }
});

void test('import review count tracks unresolved rows independently from sync queue', async () => {
  const client = new FinanceClient('demo', () => {});
  client.session = { owner: 'review-fixture', expiresAt: Date.now() + 60000 };
  await client.saveDraft({
    kind: 'finance-imports',
    sessions: [
      {
        id: 'bill',
        rows: [{ id: 'one' }, { id: 'two' }],
        reviews: { one: { done: false }, two: { done: true } },
      },
    ],
  });
  assert.equal(client.reviewCount, 1);
  assert.equal(client.pending.length, 0);
  await client.saveDraft({
    kind: 'finance-imports',
    sessions: [
      {
        id: 'bill',
        rows: [{ id: 'one' }, { id: 'two' }],
        reviews: { one: { done: true }, two: { done: true } },
      },
    ],
  });
  assert.equal(client.reviewCount, 0);
});

void test('campus review drafts stay separate from the mutation queue and add to bill review count', async () => {
  const client = new FinanceClient('demo', () => {});
  client.session = {
    owner: 'campus-review-test',
    expiresAt: Date.now() + 60000,
  };
  await client.saveDraft({
    kind: 'finance-imports',
    sessions: [
      { id: 'bill', rows: [{ id: 'one' }], reviews: { one: { done: false } } },
    ],
  });
  await localPut('finance/campus-drafts/campus-review-test/demo', [
    {
      rows: [{ id: 'a' }, { id: 'b' }],
      reviews: { a: { done: false }, b: { done: true } },
    },
  ]);
  await client.refreshReviewCounts();
  assert.equal(client.reviewCount, 2);
  assert.equal(client.pending.length, 0);
});

void test('formal ledger review handoff preserves source, retries safely, refuses conflicts and missing transactions', async () => {
  const client = new FinanceClient('personal', () => {});
  client.session = { owner: 'promotion-test', expiresAt: Date.now() + 60000 };
  client.data = emptyFinanceState('promotion-test', 'personal');
  const original = globalThis.fetch;
  const transaction = { id: 'source' } as FinanceTransaction;
  const source = {
    kind: 'finance-imports',
    sessions: [{ rows: [{ id: 'pending' }], reviews: {} }],
  };
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ state: { transactions: [transaction] } }));
  await localPut('finance/draft/promotion-test/demo', source);
  try {
    await assert.rejects(
      () => client.copyDemoReviewDrafts(),
      /先完成演示流水迁入/,
    );
    assert.equal(
      await localGet('finance/draft/promotion-test/personal'),
      undefined,
    );
    client.data.transactions = [transaction];
    await client.copyDemoReviewDrafts();
    await client.copyDemoReviewDrafts();
    assert.equal(client.reviewCount, 1);
    assert.deepEqual(
      await localGet('finance/draft/promotion-test/demo'),
      source,
    );
    assert.deepEqual(
      await localGet('finance/draft/promotion-test/personal'),
      source,
    );
    const existing = { kind: 'finance-imports', sessions: [] };
    await localPut('finance/draft/promotion-test/personal', existing);
    await assert.rejects(
      () => client.copyDemoReviewDrafts(),
      /已有不同核对草稿/,
    );
    assert.deepEqual(
      await localGet('finance/draft/promotion-test/personal'),
      existing,
    );
  } finally {
    globalThis.fetch = original;
  }
});
void test('portable review drafts keep unresolved rows across owners and reject missing records or conflicting drafts', async () => {
  const source = new FinanceClient('personal', () => {}),
    target = new FinanceClient('personal', () => {});
  source.session = { owner: 'portable-source', expiresAt: Date.now() + 60000 };
  target.session = { owner: 'portable-target', expiresAt: Date.now() + 60000 };
  source.data = emptyFinanceState('portable-source', 'personal');
  target.data = emptyFinanceState('portable-target', 'personal');
  source.data.transactions = [{ id: 'migrated' } as FinanceTransaction];
  await source.saveDraft({
    kind: 'finance-imports',
    sessions: [{ rows: [{ id: 'unknown' }], reviews: {} }],
  });
  await localPut('finance/campus-drafts/portable-source/personal', [
    { rows: [{ id: 'meal' }], reviews: {} },
  ]);
  const bundle = await source.exportReviewBundle();
  await assert.rejects(
    () => target.importReviewBundle(bundle),
    /先迁入对应账本流水/,
  );
  target.data.transactions = [{ id: 'migrated' } as FinanceTransaction];
  await target.importReviewBundle(bundle);
  await target.importReviewBundle(bundle);
  assert.equal(target.reviewCount, 2);
  assert.deepEqual(await target.draft(), await source.draft());
  await target.saveDraft({ kind: 'finance-imports', sessions: [] });
  await assert.rejects(
    () => target.importReviewBundle(bundle),
    /已有不同核对草稿/,
  );
  await assert.rejects(
    () =>
      target.importReviewBundle({ ...bundle, campus: [{ rows: 'broken' }] }),
    /饭卡草稿内容无效/,
  );
});
