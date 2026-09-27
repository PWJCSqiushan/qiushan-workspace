import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFinanceState,
  type FinanceTransaction,
} from '../lib/finance-types.ts';
import { calculateFinanceStats } from '../lib/finance-stats.ts';
import {
  categoryChartModel,
  chartPreset,
  completeDays,
  monthSeries,
  mealChartGroups,
} from '../lib/finance-chart-data.ts';
function fixture() {
  const s = emptyFinanceState('synthetic', 'demo');
  s.accounts = [
    {
      id: 'a',
      version: 0,
      name: '合成账户',
      kind: 'asset',
      openingCents: 0,
      openingAt: '2026-01-01T00:00:00+08:00',
    },
  ];
  s.categories = [
    { id: 'l', version: 0, name: '生活', level: 1, parentId: null },
    { id: 'm', version: 0, name: '餐饮', level: 2, parentId: 'l' },
    { id: 'f', version: 0, name: '正餐', level: 3, parentId: 'm' },
    { id: 'z', version: 0, name: '零消费小类', level: 2, parentId: 'l' },
    { id: 'zz', version: 0, name: '零消费明细', level: 3, parentId: 'z' },
    {
      id: 'old',
      version: 0,
      name: '停用',
      level: 2,
      parentId: 'l',
      archived: true,
    },
  ];
  return s;
}
const expense: FinanceTransaction = {
  id: 't',
  version: 0,
  kind: 'expense',
  occurredAt: '2026-09-02T00:20:00+08:00',
  accountId: 'a',
  amountCents: 1200,
  personalCents: 1200,
  allocations: [
    {
      id: 'x',
      categoryId: 'f',
      content: '餐饮',
      nature: 'daily',
      amountCents: 1200,
    },
  ],
  analysisOnly: true,
};
void test('chart category hierarchy retains zero children and conserves parent amounts', () => {
  const s = fixture();
  s.transactions = [expense];
  const stats = calculateFinanceStats(s, {
      from: '2026-09-01',
      to: '2026-10-01',
    }),
    model = categoryChartModel(s, stats);
  assert.deepEqual(
    model.groups('l', 'text').map((g) => [g.id, g.cents]),
    [
      ['m', 1200],
      ['z', 0],
    ],
  );
  assert.equal(model.groups('z', 'text')[0].name, '零消费明细');
  assert.equal(
    model.groups(null, 'text').reduce((n, g) => n + g.cents, 0),
    stats.personalCents,
  );
  assert.equal(
    model.groups('m', 'text').reduce((n, g) => n + g.cents, 0),
    1200,
  );
});
void test('calendar distinguishes no records from refunded zero and includes missing dates', () => {
  const s = fixture();
  s.transactions = [
    expense,
    {
      id: 'r',
      version: 0,
      kind: 'refund',
      occurredAt: '2026-10-03T12:00:00+08:00',
      accountId: 'a',
      amountCents: 1200,
      personalCents: 1200,
      relatedId: 't',
      allocations: [
        {
          id: 'rx',
          categoryId: 'f',
          content: '餐饮',
          nature: 'daily',
          amountCents: 1200,
          refundOfAllocationId: 'x',
        },
      ],
      analysisOnly: true,
    },
  ];
  const stats = calculateFinanceStats(s, {
      from: '2026-09-01',
      to: '2026-09-04',
    }),
    days = completeDays(s, stats);
  assert.equal(days.length, 3);
  assert.deepEqual(days[0], { date: '2026-09-01', cents: 0, recorded: false });
  assert.deepEqual(days[1], { date: '2026-09-02', cents: 0, recorded: true });
  assert.equal(monthSeries(days, stats, '2026-09-27')[0].partial, true);
});
void test('range presets include today and handle month/year boundaries', () => {
  assert.deepEqual(chartPreset('7', '2026-01-03', '2026-01'), {
    from: '2025-12-28',
    to: '2026-01-04',
  });
  assert.deepEqual(chartPreset('m3', '2026-01-03', '2026-01'), {
    from: '2025-11-01',
    to: '2026-01-04',
  });
  assert.deepEqual(chartPreset('month', '2026-03-01', '2024-02'), {
    from: '2024-02-01',
    to: '2024-03-01',
  });
});
void test('meal count uses one primary place while money splits among actual venues', () => {
  const s = fixture();
  s.places = [
    { id: 'area', version: 0, name: '合成区域', parentId: null },
    {
      id: 'p1',
      version: 0,
      name: '合成餐厅一',
      parentId: 'area',
      brand: '合成品牌',
    },
    {
      id: 'p2',
      version: 0,
      name: '合成餐厅二',
      parentId: 'area',
      brand: '合成品牌',
    },
  ];
  s.meals = [
    {
      id: 'meal',
      version: 0,
      date: '2026-09-02',
      meal: 'lunch',
      placeId: 'p1',
      companions: 'unknown',
      payment: 'unknown',
      pricePending: true,
    },
  ];
  s.transactions = [
    {
      ...expense,
      mealId: 'meal',
      allocations: [
        { ...expense.allocations[0], amountCents: 500, merchantId: 'p1' },
        {
          ...expense.allocations[0],
          id: 'x2',
          amountCents: 700,
          merchantId: 'p2',
        },
      ],
    },
  ];
  const stats = calculateFinanceStats(s, {
    from: '2026-09-01',
    to: '2026-10-01',
    meal: 'lunch',
  });
  assert.equal(
    mealChartGroups(s, stats, 'lunch', 'brand', 'count').groups[0].cents,
    1,
  );
  assert.equal(
    mealChartGroups(s, stats, 'lunch', 'brand', 'money').groups[0].cents,
    1200,
  );
  assert.equal(mealChartGroups(s, stats, 'lunch', 'area', 'count').pending, 1);
});

void test('dining money without a meal link remains visible without inventing a meal', () => {
  const data = fixture();
  data.transactions = [{ ...expense }];
  const all = calculateFinanceStats(data, {
    from: '2026-09-01',
    to: '2026-10-01',
  });
  assert.equal(all.mealCount, 0);
  assert.equal(
    all.mealPlaces.reduce((s, g) => s + g.cents, 0),
    1200,
  );
  const breakfast = calculateFinanceStats(data, {
    from: '2026-09-01',
    to: '2026-10-01',
    meal: 'breakfast',
  });
  assert.equal(
    breakfast.mealPlaces.reduce((s, g) => s + g.cents, 0),
    0,
  );
});
