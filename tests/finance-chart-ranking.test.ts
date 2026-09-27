import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryChartModel,
  categoryColor,
} from '../lib/finance-chart-data.ts';
import { emptyFinanceState } from '../lib/finance-types.ts';
import { calculateFinanceStats } from '../lib/finance-stats.ts';
void test('category rankings descend independently at every level and colors ignore amount ranking', () => {
  const data = emptyFinanceState('test', 'demo');
  data.categories = [
    { id: 'a', name: 'A', level: 1, parentId: null, version: 0 },
    { id: 'b', name: 'B', level: 1, parentId: null, version: 0 },
    { id: 'a1', name: 'A1', level: 2, parentId: 'a', version: 0 },
    { id: 'a2', name: 'A2', level: 2, parentId: 'a', version: 0 },
    { id: 'a0', name: 'A0', level: 2, parentId: 'a', version: 0 },
  ];
  const stats = calculateFinanceStats(emptyFinanceState('test', 'demo'), {
    from: '2026-01-01',
    to: '2026-02-01',
  });
  stats.categoryTotals = [
    { id: 'a1', name: 'A1', cents: 100, count: 1 },
    { id: 'a2', name: 'A2', cents: 200, count: 1 },
    { id: 'b', name: 'B', cents: 700, count: 1 },
  ];
  stats.unclassifiedCents = 50;
  const model = categoryChartModel(data, stats);
  assert.deepEqual(
    model.groups(null, 'text').map((g) => g.id),
    ['b', 'a', 'unclassified'],
  );
  assert.deepEqual(
    model.groups('a', 'text').map((g) => g.id),
    ['a2', 'a1', 'a0'],
  );
  assert.notEqual(
    categoryColor(data.categories, 'a1'),
    categoryColor(data.categories, 'a2'),
  );
  assert.equal(
    model.groups('a', 'text')[0].color,
    categoryColor(data.categories, 'a2'),
  );
});
