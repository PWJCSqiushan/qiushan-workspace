import test from 'node:test';
import assert from 'node:assert/strict';
import { mealSocialGroups } from '../lib/finance-meal-social.ts';
import {
  emptyFinanceState,
  applyFinancePatches,
  type FinanceMeal,
} from '../lib/finance-types.ts';
import { applyFinanceMutation } from '../lib/finance-domain.ts';

void test('friend groups stay separate; unknowns count, skipped and deleted meals do not', () => {
  const companions = [
    'alone',
    'friendsF',
    'friendsL',
    'friends',
    'family',
    'unknown',
  ] as const;
  const meals: FinanceMeal[] = companions.map((companions, i) => ({
    id: 'm' + i,
    version: 0,
    date: '2026-09-01',
    meal: 'lunch',
    placeId: 'p',
    companions,
    payment: i === 0 ? 'self' : 'aa',
    pricePending: true,
  }));
  meals.push(
    { ...meals[0], id: 'deleted', deleted: true },
    {
      id: 'skip',
      version: 0,
      date: '2026-09-02',
      meal: 'lunch',
      status: 'skipped',
      pricePending: false,
    },
  );
  const groups = mealSocialGroups(meals);
  assert.equal(groups.total, 6);
  for (const id of companions)
    assert.equal(groups.companions.find((g) => g.id === id)?.cents, 1);
  assert.equal(
    groups.companions.reduce((s, g) => s + g.cents, 0),
    groups.total,
  );
  assert.equal(
    groups.payments.reduce((s, g) => s + g.cents, 0),
    groups.total,
  );
  assert.equal(groups.payments.find((g) => g.id === 'aa')?.cents, 5);
  assert.equal(mealSocialGroups([]).total, 0);
});

void test('domain accepts F and L independently and retains legacy friends', () => {
  let state = emptyFinanceState('social', 'demo');
  state.places = [{ id: 'p', version: 1, name: '合成地点', parentId: null }];
  for (const [i, companions] of (
    ['friendsF', 'friendsL', 'friends'] as const
  ).entries()) {
    const meal: FinanceMeal = {
      id: 'm' + i,
      version: 0,
      date: '2026-09-0' + (i + 1),
      meal: 'lunch',
      placeId: 'p',
      companions,
      payment: 'self',
      pricePending: true,
    };
    state = applyFinancePatches(
      state,
      applyFinanceMutation(
        state,
        { type: 'put', collection: 'meals', entity: meal, expectedVersion: 0 },
        new Date(),
      ).changes,
      state.version + 1,
    );
  }
  assert.deepEqual(
    state.meals.map((m) => m.companions),
    ['friendsF', 'friendsL', 'friends'],
  );
});
