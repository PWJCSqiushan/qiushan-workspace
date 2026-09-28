import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './d1-helper.ts';
import { FinanceStore } from '../lib/finance-store.ts';
import {
  applyFinanceMutation,
  validateFinanceState,
} from '../lib/finance-domain.ts';
import {
  emptyFinanceState,
  applyFinancePatches,
  type FinanceMeal,
  type FinanceMutation,
  type FinanceState,
  type FinanceTransaction,
} from '../lib/finance-types.ts';
import {
  mealPlaceTone,
  mealSkipPreview,
  skipMealMutation,
  groupMealPlaces,
  mealExpenseRows,
  mealNetCents,
} from '../lib/finance-places.ts';
import { calculateFinanceStats } from '../lib/finance-stats.ts';
import { mealChartGroups } from '../lib/finance-chart-data.ts';
import {
  exportFinanceBackup,
  restoreFinanceBackup,
  validateFinanceBackup,
} from '../lib/finance-backup.ts';

const range = { from: '2026-09-01', to: '2026-10-01' };
function stateFixture(): FinanceState {
  const s = emptyFinanceState('meal-status', 'demo');
  s.accounts = [
    {
      id: 'cash',
      version: 1,
      name: '合成账户',
      kind: 'asset',
      openingCents: 50000,
      openingAt: '2026-01-01T00:00:00Z',
    },
  ];
  s.places = [
    { id: 'area', version: 1, name: '合成区域', parentId: null, tone: 'mint' },
    { id: 'venue', version: 1, name: '合成餐厅', parentId: 'area' },
  ];
  s.meals = [eaten('meal', '2026-09-01')];
  return s;
}
function eaten(
  id: string,
  date: string,
  pricePending = false,
): Exclude<FinanceMeal, { status: 'skipped' }> {
  return {
    id,
    date,
    version: 1,
    meal: 'lunch',
    placeId: 'venue',
    companions: 'alone',
    payment: 'self',
    pricePending,
  };
}
function expense(id = 'expense'): FinanceTransaction {
  return {
    id,
    version: 0,
    kind: 'expense',
    accountId: 'cash',
    occurredAt: '2026-09-01T12:00:00+08:00',
    amountCents: 3000,
    personalCents: 1800,
    mealId: 'meal',
    counterparty: '合成同伴',
    allocations: [
      {
        id: id + '-a',
        categoryId: null,
        content: '餐饮',
        amountCents: 1800,
        merchantId: 'venue',
        nature: 'daily',
      },
    ],
  };
}
function apply(s: FinanceState, m: FinanceMutation) {
  return applyFinancePatches(
    s,
    applyFinanceMutation(s, m).changes,
    s.version + 1,
  );
}

void test('meal states separate legacy eaten, unknown amount, zero personal expense, skipped and empty', () => {
  const s = stateFixture();
  s.meals.push(eaten('unknown', '2026-09-02', true), {
    id: 'skip',
    version: 1,
    date: '2026-09-03',
    meal: 'lunch',
    status: 'skipped',
    pricePending: false,
  });
  validateFinanceState(s);
  const stats = calculateFinanceStats(s, range);
  assert.equal(stats.mealCount, 2);
  assert.equal(stats.pendingMealCount, 1);
  assert.equal(stats.skippedMealCount, 1);
  assert.equal(stats.personalCents, 0);
  assert.deepEqual(stats.mealPlaces, [
    { id: 'venue', name: '合成餐厅', count: 2, days: 2, cents: 0 },
  ]);
  assert.equal(mealChartGroups(s, stats, 'all', 'area', 'count').mealCount, 2);
  assert.equal(
    groupMealPlaces(s.places, stats.mealPlaces, s.meals, 'area')[0].days,
    2,
  );
  assert.deepEqual(mealExpenseRows(s, 'skip'), []);
  assert.equal(mealNetCents(s, 'skip'), 0);
  assert.equal(
    s.meals.some((m) => m.date === '2026-09-04'),
    false,
  );
  for (const bad of [
    { ...s.meals[2], pricePending: true },
    { ...s.meals[2], placeId: 'venue' },
    { ...s.meals[2], payment: 'self' },
    { ...s.meals[2], companions: 'alone' },
    { ...s.meals[2], status: 'inferred' },
  ])
    assert.throws(() =>
      validateFinanceState({ ...s, meals: [bad as FinanceMeal] }),
    );
  assert.throws(() =>
    validateFinanceState({
      ...s,
      meals: [{ ...s.meals[0], placeId: undefined } as FinanceMeal],
    }),
  );
  assert.throws(
    () =>
      apply(s, {
        type: 'put',
        collection: 'meals',
        expectedVersion: 0,
        entity: { ...s.meals[2], id: 'duplicate' },
      }),
    /duplicate active meal/,
  );
  const cleared = apply(s, {
    type: 'delete',
    collection: 'meals',
    id: 'skip',
    expectedVersion: 1,
  });
  assert.equal(calculateFinanceStats(cleared, range).skippedMealCount, 0);
  const restored = apply(s, {
    type: 'put',
    collection: 'meals',
    entity: eaten('skip', '2026-09-03', true),
    expectedVersion: 1,
  });
  assert.equal(calculateFinanceStats(restored, range).mealCount, 3);
});

void test('stable area colors share group tones and persist through reorder, rename and new areas', () => {
  const s = stateFixture();
  s.places.push(
    {
      id: 'floor1',
      version: 1,
      name: '合成一层',
      parentId: null,
      summaryGroupId: 'building',
      summaryGroupName: '合成楼',
      tone: 'amber',
    },
    {
      id: 'floor2',
      version: 1,
      name: '合成二层',
      parentId: null,
      summaryGroupId: 'building',
      summaryGroupName: '合成楼',
    },
    {
      id: 'unknown-floor',
      version: 1,
      name: '楼层未注明',
      parentId: null,
      summaryGroupId: 'building',
      summaryGroupName: '合成楼',
    },
    { id: 'shop', version: 1, name: '合成店', parentId: 'floor2' },
  );
  validateFinanceState(s);
  for (const id of [
    'floor1',
    'floor2',
    'unknown-floor',
    'shop',
    'group:building',
  ])
    assert.equal(mealPlaceTone(s.places, id), 'amber');
  const custom = {
    id: 'custom-17',
    version: 1,
    name: '自定义',
    parentId: null,
  };
  const first = mealPlaceTone([...s.places, custom], custom.id);
  assert.equal(
    mealPlaceTone(
      [custom, ...s.places]
        .reverse()
        .map((p) => ({ ...p, name: p.name + '新' })),
      custom.id,
    ),
    first,
  );
  const bad = structuredClone(s);
  bad.places.find((p) => p.id === 'floor2')!.tone = 'rose';
  assert.throws(() => validateFinanceState(bad), /group tones/);
  const recolored = apply(s, {
    type: 'batch',
    mutations: s.places
      .filter((p) => p.summaryGroupId === 'building')
      .map((p) => ({
        type: 'put',
        collection: 'places',
        expectedVersion: p.version,
        entity: { ...p, tone: 'blue' },
      })),
  });
  assert.equal(mealPlaceTone(recolored.places, 'shop'), 'blue');
});

void test('atomic skip guards complete associations and preserves every financial field including refund and AA', () => {
  let s = apply(stateFixture(), {
    type: 'saveTransaction',
    transaction: expense(),
    expectedVersion: 0,
  });
  s = apply(s, {
    type: 'saveTransaction',
    expectedVersion: 0,
    transaction: {
      id: 'refund',
      version: 0,
      kind: 'refund',
      accountId: 'cash',
      occurredAt: '2026-10-02T12:00:00+08:00',
      amountCents: 200,
      personalCents: 200,
      relatedId: 'expense',
      mealId: 'meal',
      allocations: [
        {
          id: 'refund-a',
          categoryId: null,
          content: '餐饮',
          amountCents: 200,
          merchantId: 'venue',
          nature: 'daily',
          refundOfAllocationId: 'expense-a',
        },
      ],
    },
  });
  s = apply(s, {
    type: 'saveTransaction',
    expectedVersion: 0,
    transaction: {
      id: 'collect',
      version: 0,
      kind: 'collect',
      accountId: 'cash',
      occurredAt: '2026-09-02T12:00:00+08:00',
      amountCents: 500,
      relatedId: 'expense',
      mealId: 'meal',
      allocations: [],
    },
  });
  const before = structuredClone(s),
    mutation = skipMealMutation(s, s.meals[0]);
  assert.deepEqual(mealSkipPreview(s, 'meal'), {
    count: 1,
    paidCents: 3000,
    personalCents: 1800,
    expectedTransactions: s.transactions.map((t) => ({
      id: t.id,
      version: t.version,
    })),
  });
  assert.throws(
    () =>
      apply(s, {
        type: 'put',
        collection: 'meals',
        entity: mutation.meal,
        expectedVersion: 1,
      }),
    /unknown meal/,
  );
  const after = apply(s, mutation);
  assert.deepEqual(s, before, 'caller state remains unchanged');
  for (const tx of before.transactions) {
    const { mealId: _mealId, version, ...financial } = tx;
    const { version: nextVersion, ...actual } = after.transactions.find(
      (t) => t.id === tx.id,
    )!;
    assert.deepEqual(actual, financial);
    assert.equal(nextVersion, version + 1);
  }
  const originalStats = calculateFinanceStats(before, range),
    stats = calculateFinanceStats(after, range);
  assert.equal(stats.personalCents, originalStats.personalCents);
  assert.equal(stats.receivableCents, originalStats.receivableCents);
  assert.deepEqual(stats.accountBalances, originalStats.accountBalances);
  assert.equal(stats.mealCount, 0);
  assert.equal(stats.skippedMealCount, 1);
  assert.equal(stats.unlinkedMealCents, 1600);
  assert.deepEqual(stats.unlinkedMealTransactionIds, ['expense']);
  assert.equal(stats.mealPlaces[0].count, 0);
  assert.equal(stats.mealPlaces[0].days, 0);
  assert.equal(
    calculateFinanceStats(after, { ...range, meal: 'lunch' }).unlinkedMealCents,
    0,
  );
  const changed = structuredClone(s);
  changed.transactions[0].version++;
  assert.throws(() => apply(changed, mutation), /version conflict/);
  const added = apply(s, {
    type: 'saveTransaction',
    expectedVersion: 0,
    transaction: expense('extra'),
  });
  assert.throws(() => apply(added, mutation), /version conflict/);
  assert.throws(
    () => apply(s, { ...mutation, expectedTransactions: [] }),
    /version conflict/,
  );
});

void test('D1 skip receipt, full undo/redo, stale links, backup export/restore and old statusless backup', async () => {
  const { db, sqlite } = database(),
    store = new FinanceStore(db, 'meal-status');
  let sequence = 0;
  const send = (
    mutation: FinanceMutation,
    operationId = 'status-' + ++sequence,
  ) => store.mutate({ space: 'demo', baseVersion: 0, mutation, operationId });
  try {
    const initial = stateFixture();
    await send({
      type: 'batch',
      mutations: [
        ...initial.accounts.map((entity) => ({
          type: 'put' as const,
          collection: 'accounts' as const,
          entity,
          expectedVersion: 0,
        })),
        ...initial.places.map((entity) => ({
          type: 'put' as const,
          collection: 'places' as const,
          entity,
          expectedVersion: 0,
        })),
        ...initial.meals.map((entity) => ({
          type: 'put' as const,
          collection: 'meals' as const,
          entity,
          expectedVersion: 0,
        })),
        { type: 'saveTransaction', transaction: expense(), expectedVersion: 0 },
      ],
    });
    const legacy = await exportFinanceBackup(store, 'demo');
    assert.equal(legacy.state.meals[0].status, undefined);
    await validateFinanceBackup(legacy);
    const current = await store.snapshot('demo'),
      skip = skipMealMutation(current, current.meals[0]);
    await assert.rejects(
      send({
        type: 'put',
        collection: 'meals',
        entity: skip.meal,
        expectedVersion: skip.expectedVersion,
      }),
      /unknown meal/,
    );
    const result = await send(skip, 'skip-stable');
    assert.deepEqual(await send(skip, 'skip-stable'), result);
    assert.equal(result.changes.length, 2);
    const backup = await exportFinanceBackup(store, 'demo');
    await validateFinanceBackup(backup);
    assert.equal(backup.state.transactions[0].mealId, undefined);
    await send({ type: 'undo', historyId: result.history!.id });
    let restored = await store.snapshot('demo');
    assert.equal(restored.meals[0].status, undefined);
    assert.equal(restored.transactions[0].mealId, 'meal');
    assert.deepEqual(
      restored.transactions[0].allocations,
      current.transactions[0].allocations,
    );
    await send({ type: 'redo', historyId: result.history!.id });
    restored = await store.snapshot('demo');
    assert.equal(restored.meals[0].status, 'skipped');
    await restoreFinanceBackup(
      store,
      legacy,
      'restore-legacy',
      restored.version,
    );
    restored = await store.snapshot('demo');
    validateFinanceState(restored);
    assert.equal(restored.meals[0].status, undefined);
    const stale = skipMealMutation(restored, restored.meals[0]);
    await send({
      type: 'saveTransaction',
      transaction: expense('new-linked'),
      expectedVersion: 0,
    });
    const before = await store.snapshot('demo');
    await assert.rejects(send(stale), /其他设备修改/);
    assert.deepEqual(await store.snapshot('demo'), before);
    await restoreFinanceBackup(
      store,
      backup,
      'restore-skipped',
      before.version,
    );
    const final = await store.snapshot('demo');
    assert.equal(final.meals[0].status, 'skipped');
    assert.equal(final.transactions[0].mealId, undefined);
  } finally {
    sqlite.close();
  }
});

void test('unmapped refunds remain visible and reduce unlinked dining totals after skip', () => {
  let s = apply(stateFixture(), {
    type: 'saveTransaction',
    transaction: expense(),
    expectedVersion: 0,
  });
  s = apply(s, {
    type: 'saveTransaction',
    expectedVersion: 0,
    transaction: {
      id: 'unmapped-refund',
      version: 0,
      kind: 'refund',
      accountId: 'cash',
      occurredAt: '2026-10-02T12:00:00+08:00',
      amountCents: 200,
      personalCents: 200,
      relatedId: 'expense',
      allocations: [],
    },
  });
  s = apply(s, skipMealMutation(s, s.meals[0]));
  const stats = calculateFinanceStats(s, range);
  assert.equal(stats.unlinkedMealCents, 1600);
  assert.equal(
    stats.mealPlaces.reduce((n, p) => n + p.cents, 0),
    1600,
  );
  assert.equal(
    stats.mealPlaces.find((p) => p.id === '__unknown__')?.cents,
    -200,
  );
  const outside = calculateFinanceStats(s, {
    from: '2026-09-02',
    to: '2026-09-30',
  });
  assert.equal(outside.unlinkedMealCents, 0);
  assert.deepEqual(outside.unlinkedMealTransactionIds, []);
  assert.deepEqual(outside.mealPlaces, []);
});
