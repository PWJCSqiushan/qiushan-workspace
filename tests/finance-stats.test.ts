import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFinanceMutation } from '../lib/finance-domain.ts';
import { calculateFinanceStats } from '../lib/finance-stats.ts';
import {
  applyFinancePatches,
  type FinanceState,
  type FinanceTransaction,
} from '../lib/finance-types.ts';

function state(): FinanceState {
  return {
    owner: 'synthetic',
    space: 'demo',
    version: 0,
    accounts: [
      {
        id: 'wallet',
        version: 1,
        name: '钱包',
        kind: 'asset',
        openingCents: 100_000,
        openingAt: '2026-01-01T00:00:00+08:00',
      },
    ],
    categories: [
      { id: 'life', version: 1, name: '日常生活', parentId: null, level: 1 },
      { id: 'food', version: 1, name: '三餐', parentId: 'life', level: 2 },
      { id: 'meal', version: 1, name: '正餐', parentId: 'food', level: 3 },
      { id: 'hobby', version: 1, name: '兴趣', parentId: null, level: 1 },
      { id: 'run', version: 1, name: '跑步', parentId: 'hobby', level: 2 },
      { id: 'race', version: 1, name: '赛事交通', parentId: 'run', level: 3 },
    ],
    places: [
      { id: 'canteen', version: 1, name: '学校食堂', parentId: null },
      { id: 'mcd', version: 1, name: '麦当劳', parentId: null },
    ],
    activities: [
      {
        id: 'event',
        version: 1,
        name: '比赛',
        kind: 'event',
        date: '2026-09-12',
      },
    ],
    transactions: [],
    meals: [
      {
        id: 'breakfast',
        version: 1,
        date: '2026-09-12',
        meal: 'breakfast',
        placeId: 'canteen',
        companions: 'alone',
        payment: 'self',
        pricePending: false,
      },
      {
        id: 'lunch',
        version: 1,
        date: '2026-09-12',
        meal: 'lunch',
        placeId: 'mcd',
        companions: 'classmates',
        payment: 'aa',
        pricePending: true,
      },
    ],
    sponsorships: [
      {
        id: 'sponsor',
        version: 1,
        date: '2026-09-12',
        name: '家庭支持',
        categoryId: 'race',
        amountCents: 2_000,
      },
    ],
    history: [],
  };
}

function add(
  current: FinanceState,
  transaction: FinanceTransaction,
): FinanceState {
  const result = applyFinanceMutation(current, {
    type: 'saveTransaction',
    transaction,
    expectedVersion: 0,
  });
  return applyFinancePatches(current, result.changes, current.version + 1);
}

test('stats aggregate leaf categories, merchants, activities and nature', () => {
  let current = state();
  current = add(current, {
    id: 'food-expense',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-12T08:00:00+08:00',
    accountId: 'wallet',
    amountCents: 1_500,
    allocations: [
      {
        id: 'food-a',
        categoryId: 'meal',
        content: '早餐',
        amountCents: 1_500,
        merchantId: 'canteen',
        nature: 'daily',
      },
    ],
    mealId: 'breakfast',
  });
  current = add(current, {
    id: 'race-expense',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-12T10:00:00+08:00',
    accountId: 'wallet',
    amountCents: 3_000,
    allocations: [
      {
        id: 'race-a',
        categoryId: 'race',
        content: '高铁',
        amountCents: 3_000,
        activityId: 'event',
        nature: 'durable',
      },
    ],
  });
  const stats = calculateFinanceStats(current, {
    from: '2026-09-01',
    to: '2026-10-01',
  });
  assert.equal(stats.personalCents, 4_500);
  assert.equal(
    stats.categoryTotals.find((group) => group.id === 'meal')?.cents,
    1_500,
  );
  assert.equal(
    stats.categoryTotals.find((group) => group.id === 'race')?.cents,
    3_000,
  );
  assert.equal(
    stats.merchantTotals.find((group) => group.id === 'canteen')?.cents,
    1_500,
  );
  assert.equal(
    stats.activityTotals.find((group) => group.id === 'event')?.cents,
    3_000,
  );
  assert.equal(
    stats.natureTotals.find((group) => group.id === 'durable')?.cents,
    3_000,
  );
  assert.deepEqual(stats.daily, [{ date: '2026-09-12', cents: 4_500 }]);
  assert.equal(stats.sponsorCents, 2_000);
});

test('refund is applied to original expense date even when it occurs next month', () => {
  let current = state();
  current = add(current, {
    id: 'sep-expense',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-30T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 4_000,
    allocations: [
      {
        id: 'sep-a',
        categoryId: 'meal',
        content: '晚餐',
        amountCents: 4_000,
        merchantId: 'mcd',
        nature: 'daily',
      },
    ],
  });
  current = add(current, {
    id: 'oct-refund',
    version: 0,
    kind: 'refund',
    occurredAt: '2026-10-02T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 1_000,
    personalCents: 1_000,
    relatedId: 'sep-expense',
    allocations: [
      {
        id: 'refund-a',
        categoryId: 'meal',
        content: '退款',
        amountCents: 1_000,
        nature: 'daily',
        refundOfAllocationId: 'sep-a',
      },
    ],
  });
  const september = calculateFinanceStats(current, {
    from: '2026-09-01',
    to: '2026-10-01',
  });
  const october = calculateFinanceStats(current, {
    from: '2026-10-01',
    to: '2026-11-01',
  });
  assert.equal(september.personalCents, 3_000);
  assert.equal(
    september.categoryTotals.find((group) => group.id === 'meal')?.cents,
    3_000,
  );
  assert.equal(october.personalCents, 0);
});

test('unknown category remains visible and meal filter counts unique meals and days', () => {
  let current = state();
  current = add(current, {
    id: 'unknown-expense',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-12T13:00:00+08:00',
    accountId: 'wallet',
    amountCents: 2_000,
    allocations: [
      {
        id: 'unknown-a',
        categoryId: null,
        content: '待分类支出',
        amountCents: 2_000,
        nature: 'daily',
      },
    ],
    mealId: 'lunch',
  });
  const stats = calculateFinanceStats(current, {
    from: '2026-09-01',
    to: '2026-10-01',
    meal: 'lunch',
  });
  assert.equal(stats.mealCount, 1);
  assert.equal(stats.pendingMealCount, 1);
  assert.equal(stats.mealPlaces[0].id, 'mcd');
  assert.equal(stats.mealPlaces[0].days, 1);
  assert.equal(stats.mealPlaces[0].cents, 2_000);
  assert.equal(stats.unclassifiedCents, 2_000);
});

test('account balances and outstanding custody/receivable use period end', () => {
  let current = state();
  current = add(current, {
    id: 'lend',
    version: 0,
    kind: 'lend',
    occurredAt: '2026-09-05',
    accountId: 'wallet',
    amountCents: 5_000,
    allocations: [],
  });
  current = add(current, {
    id: 'custody-in',
    version: 0,
    kind: 'custodyReceive',
    occurredAt: '2026-09-06',
    accountId: 'wallet',
    amountCents: 8_000,
    caseId: 'club',
    allocations: [],
  });
  current = add(current, {
    id: 'collect',
    version: 0,
    kind: 'collect',
    occurredAt: '2026-09-07',
    accountId: 'wallet',
    amountCents: 2_000,
    relatedId: 'lend',
    allocations: [],
  });
  const stats = calculateFinanceStats(current, {
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(stats.receivableCents, 3_000);
  assert.equal(stats.custodyCents, 8_000);
  assert.equal(stats.accountBalances[0].cents, 105_000);
});

test('stats use Beijing dates for UTC timestamps at a month boundary', () => {
  let current = state();
  current = add(current, {
    id: 'sep-boundary',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-30T15:59:59.999Z',
    accountId: 'wallet',
    amountCents: 100,
    allocations: [
      {
        id: 'sep-boundary-a',
        categoryId: 'meal',
        content: '九月',
        amountCents: 100,
        nature: 'daily',
      },
    ],
  });
  current = add(current, {
    id: 'oct-boundary',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-30T16:00:00.000Z',
    accountId: 'wallet',
    amountCents: 200,
    allocations: [
      {
        id: 'oct-boundary-a',
        categoryId: 'meal',
        content: '十月',
        amountCents: 200,
        nature: 'daily',
      },
    ],
  });
  assert.equal(
    calculateFinanceStats(current, { from: '2026-09-01', to: '2026-10-01' })
      .personalCents,
    100,
  );
  assert.equal(
    calculateFinanceStats(current, { from: '2026-10-01', to: '2026-11-01' })
      .personalCents,
    200,
  );
});

test('merchant and activity dimensions keep unassigned spending visible and conserve totals', () => {
  let current = state();
  current = add(current, {
    id: 'dimensions',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-15T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 300,
    counterparty: '店A',
    allocations: [
      {
        id: 'dimensions-a',
        categoryId: 'meal',
        content: '餐饮',
        amountCents: 100,
        nature: 'daily',
      },
      {
        id: 'dimensions-b',
        categoryId: 'race',
        content: '票务',
        amountCents: 200,
        merchantId: '店B',
        activityId: 'event',
        nature: 'durable',
      },
    ],
  });
  const stats = calculateFinanceStats(current, {
    from: '2026-09-01',
    to: '2026-10-01',
  });
  assert.equal(stats.personalCents, 300);
  assert.equal(
    stats.merchantTotals.find((group) => group.id === '店A')?.cents,
    100,
  );
  assert.equal(
    stats.merchantTotals.find((group) => group.id === '店B')?.cents,
    200,
  );
  assert.equal(
    stats.activityTotals.find((group) => group.id === '__unassociated__')
      ?.cents,
    100,
  );
  assert.equal(
    stats.activityTotals.find((group) => group.id === 'event')?.cents,
    200,
  );
  assert.equal(
    stats.merchantTotals.reduce((sum, group) => sum + group.cents, 0),
    stats.personalCents,
  );
  assert.equal(
    stats.activityTotals.reduce((sum, group) => sum + group.cents, 0),
    stats.personalCents,
  );
  assert.equal(
    stats.natureTotals.reduce((sum, group) => sum + group.cents, 0),
    stats.personalCents,
  );
});

test('meal amounts follow allocation merchants while count and days stay on the primary place', () => {
  let current = state();
  current = add(current, {
    id: 'multi-merchant-meal',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-12T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 300,
    allocations: [
      {
        id: 'multi-canteen',
        categoryId: 'meal',
        content: '主食',
        amountCents: 100,
        merchantId: 'canteen',
        nature: 'daily',
      },
      {
        id: 'multi-mcd',
        categoryId: 'meal',
        content: '饮品',
        amountCents: 200,
        merchantId: 'mcd',
        nature: 'daily',
      },
    ],
    mealId: 'lunch',
  });
  current = add(current, {
    id: 'multi-refund',
    version: 0,
    kind: 'refund',
    occurredAt: '2026-10-02T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 50,
    personalCents: 50,
    relatedId: 'multi-merchant-meal',
    allocations: [
      {
        id: 'multi-refund-a',
        categoryId: 'meal',
        content: '饮品退款',
        amountCents: 50,
        merchantId: 'mcd',
        nature: 'daily',
        refundOfAllocationId: 'multi-mcd',
      },
    ],
  });
  const stats = calculateFinanceStats(current, {
    from: '2026-09-01',
    to: '2026-10-01',
    meal: 'lunch',
  });
  const canteen = stats.mealPlaces.find((group) => group.id === 'canteen');
  const mcd = stats.mealPlaces.find((group) => group.id === 'mcd');
  assert.equal(canteen?.cents, 100);
  assert.equal(canteen?.count, 0);
  assert.equal(mcd?.cents, 150);
  assert.equal(mcd?.count, 1);
  assert.equal(mcd?.days, 1);
  assert.equal(
    stats.mealPlaces.reduce((sum, group) => sum + group.cents, 0),
    250,
  );
});

test('opening receivable, payable and custody seed virtual balances without changing account cash', () => {
  let current = state();
  current = add(current, {
    id: 'opening-receivable',
    version: 0,
    kind: 'openingReceivable',
    occurredAt: '2026-01-01T00:00:00+08:00',
    accountId: 'wallet',
    amountCents: 500,
    allocations: [],
  });
  current = add(current, {
    id: 'opening-payable',
    version: 0,
    kind: 'openingPayable',
    occurredAt: '2026-01-01T00:00:00+08:00',
    accountId: 'wallet',
    amountCents: 400,
    allocations: [],
  });
  current = add(current, {
    id: 'opening-custody',
    version: 0,
    kind: 'openingCustody',
    occurredAt: '2026-01-01T00:00:00+08:00',
    accountId: 'wallet',
    amountCents: 300,
    caseId: 'club',
    allocations: [],
  });
  const stats = calculateFinanceStats(current, {
    from: '2026-01-01',
    to: '2026-02-01',
  });
  assert.equal(stats.accountBalances[0].cents, 100_000);
  assert.equal(stats.receivableCents, 500);
  assert.equal(stats.payableCents, 400);
  assert.equal(stats.custodyCents, 300);
  assert.equal(stats.personalCents, 0);
});

test('safe integer overflow is rejected instead of losing cents', () => {
  let current = state();
  const huge = Number.MAX_SAFE_INTEGER;
  current = add(current, {
    id: 'huge-a',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-20',
    accountId: 'wallet',
    amountCents: huge,
    allocations: [
      {
        id: 'huge-a-a',
        categoryId: 'meal',
        content: '大额',
        amountCents: huge,
        nature: 'durable',
      },
    ],
  });
  current = add(current, {
    id: 'huge-b',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-21',
    accountId: 'wallet',
    amountCents: huge,
    allocations: [
      {
        id: 'huge-b-a',
        categoryId: 'meal',
        content: '大额',
        amountCents: huge,
        nature: 'durable',
      },
    ],
  });
  assert.throws(
    () =>
      calculateFinanceStats(current, { from: '2026-09-01', to: '2026-10-01' }),
    /safe integer range/,
  );
});
