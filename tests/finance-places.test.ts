import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFinanceState,
  type FinanceMeal,
  type FinancePlace,
} from '../lib/finance-types.ts';
import {
  groupMealPlaces,
  mealDefaultCategory,
  mealNetCents,
  mealExpenseRows,
} from '../lib/finance-places.ts';
import { validateFinanceState } from '../lib/finance-domain.ts';

const places: FinancePlace[] = [
  {
    id: 'floor-a',
    version: 1,
    name: '示例楼一层',
    parentId: null,
    summaryGroupId: 'building',
    summaryGroupName: '示例楼',
    defaultCategoryId: 'leaf',
  },
  {
    id: 'floor-b',
    version: 1,
    name: '示例楼二层',
    parentId: null,
    summaryGroupId: 'building',
    summaryGroupName: '示例楼',
  },
  { id: 'cafe-a', version: 1, name: '同名餐厅', parentId: 'floor-a' },
  { id: 'cafe-b', version: 1, name: '同名餐厅', parentId: 'floor-b' },
];
const meals: Exclude<FinanceMeal, { status: 'skipped' }>[] = [
  ['m1', '2026-09-01', 'lunch', 'cafe-a'],
  ['m2', '2026-09-01', 'dinner', 'cafe-b'],
  ['m3', '2026-09-02', 'lunch', 'cafe-b'],
].map(([id, date, meal, placeId]) => ({
  id,
  date,
  meal: meal as FinanceMeal['meal'],
  placeId,
  version: 1,
  companions: 'alone',
  payment: 'self',
  pricePending: false,
}));
const rows = [
  { id: 'cafe-a', name: '同名餐厅', count: 1, days: 1, cents: 1200 },
  { id: 'cafe-b', name: '同名餐厅', count: 2, days: 2, cents: 2600 },
];
void test('shared building totals sum meals and money but deduplicate dates across floors', () => {
  assert.deepEqual(groupMealPlaces(places, rows, meals, 'area'), [
    { id: 'group:building', name: '示例楼', count: 3, days: 2, cents: 3800 },
  ]);
  assert.equal(groupMealPlaces(places, rows, meals, 'floor').length, 2);
  assert.deepEqual(
    groupMealPlaces(places, rows, meals, 'venue')
      .map((x) => x.id)
      .sort(),
    ['cafe-a', 'cafe-b'],
  );
});
void test('meal classification inherits explicit default while a treat remains a conscious purpose choice', () => {
  const state = emptyFinanceState();
  state.places = places;
  state.categories = [
    { id: 'root', version: 1, name: '大类', level: 1, parentId: null },
    { id: 'mid', version: 1, name: '小类', level: 2, parentId: 'root' },
    { id: 'leaf', version: 1, name: '明细', level: 3, parentId: 'mid' },
  ];
  assert.equal(mealDefaultCategory(state, meals[0]), 'leaf');
  assert.equal(
    mealDefaultCategory(state, { ...meals[0], payment: 'treat' }),
    null,
  );
  validateFinanceState(state);
  const bad = structuredClone(state);
  bad.places[1].summaryGroupName = '另一个名字';
  assert.throws(() => validateFinanceState(bad), /summary group/);
  const nested = structuredClone(state);
  nested.places[2].parentId = 'cafe-b';
  assert.throws(() => validateFinanceState(nested), /two levels/);
});
void test('meal cell price follows the same cross-month refund boundary as its statistics', () => {
  const state = emptyFinanceState();
  state.transactions = [
    {
      id: 'payment',
      version: 1,
      kind: 'expense',
      occurredAt: '2026-09-01T12:00:00+08:00',
      accountId: 'cash',
      amountCents: 2000,
      personalCents: 1800,
      mealId: 'm1',
      allocations: [],
    },
    {
      id: 'refund',
      version: 1,
      kind: 'refund',
      occurredAt: '2026-10-01T12:00:00+08:00',
      accountId: 'cash',
      amountCents: 600,
      personalCents: 500,
      relatedId: 'payment',
      allocations: [],
    },
  ];
  assert.equal(mealNetCents(state, 'm1'), 1300);
});

void test('new meal never selects unrelated expenses with no meal link', () => {
  const state = emptyFinanceState();
  state.transactions = [
    {
      id: 'unrelated',
      version: 1,
      kind: 'expense',
      accountId: 'cash',
      occurredAt: '2026-09-01T12:00:00Z',
      amountCents: 9900,
      personalCents: 9900,
      allocations: [],
    },
  ];
  assert.deepEqual(mealExpenseRows(state, undefined), []);
  assert.deepEqual(mealExpenseRows(state, 'new-meal'), []);
});
