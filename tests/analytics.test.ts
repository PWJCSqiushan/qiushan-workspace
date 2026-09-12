import assert from 'node:assert/strict';
import test from 'node:test';
import {aggregateAnalytics, type TaskEvent} from '../lib/analytics.ts';

const coverage = {since: '2026-01-01', incomplete: false, unknown: 0};

function event(overrides: Partial<TaskEvent> & Pick<TaskEvent, 'id' | 'taskId' | 'kind' | 'date'>): TaskEvent {
  return {
    flow: 'study',
    daily: false,
    occurredAt: `${overrides.date}T12:00:00+08:00`,
    source: 'live',
    ...overrides,
  };
}

void test('deduplicates creations and daily completions, then applies revocations before filtering', () => {
  const events: TaskEvent[] = [
    event({id: 'create-1', taskId: 'task-1', kind: 'created', date: '2026-09-01'}),
    event({id: 'create-1-retry', taskId: 'task-1', kind: 'created', date: '2026-09-02'}),
    event({id: 'regular-1', taskId: 'task-1', kind: 'completed', date: '2026-09-02'}),
    event({id: 'regular-1-retry', taskId: 'task-1', kind: 'completed', date: '2026-09-02'}),
    event({id: 'revoke-regular', taskId: 'task-1', kind: 'revoked', date: '2026-09-03', reverses: 'regular-1'}),
    event({id: 'daily-1', taskId: 'daily-1', kind: 'completed', date: '2026-09-03', daily: true}),
    event({id: 'daily-1-retry', taskId: 'daily-1', kind: 'completed', date: '2026-09-03', daily: true}),
    event({id: 'unknown-created', taskId: 'unknown', kind: 'created', date: '2026-09-03', flow: ''}),
    event({id: 'unknown-completed', taskId: 'unknown', kind: 'completed', date: '2026-09-03', flow: ''}),
  ];
  const result = aggregateAnalytics(events, {from: '2026-09-01', to: '2026-09-03', bucket: 'day', flow: 'study'}, coverage);

  assert.deepEqual(result.totals, {created: 1, completed: 2, regular: 1, daily: 1});
  assert.equal(result.byFlow.find((flow) => flow.id === 'study')?.completed, 2);
  assert.equal(result.byFlow.find((flow) => flow.id === 'study')?.created, 1);
  assert.equal(result.coverage.unknown, 1);
  assert.deepEqual(result.series.map((point) => [point.date, point.created, point.completed]), [
    ['2026-09-01', 1, 0],
    ['2026-09-02', 0, 1],
    ['2026-09-03', 0, 1],
  ]);
});

void test('keeps a completion in its historical flow even when later records use another flow', () => {
  const events: TaskEvent[] = [
    event({id: 'created', taskId: 'moved-task', kind: 'created', date: '2026-08-30', flow: 'study'}),
    event({id: 'completed-before-move', taskId: 'moved-task', kind: 'completed', date: '2026-09-01', flow: 'study'}),
    event({id: 'created-after-move', taskId: 'new-task', kind: 'created', date: '2026-09-02', flow: 'research'}),
  ];
  const result = aggregateAnalytics(events, {from: '2026-09-01', to: '2026-09-02', bucket: 'day'}, coverage);
  assert.equal(result.byFlow.find((flow) => flow.id === 'study')?.completed, 1);
  assert.equal(result.byFlow.find((flow) => flow.id === 'research')?.created, 1);
  assert.equal(result.totals.completed, 1);
});

void test('fills Monday week buckets and calendar month buckets across boundaries', () => {
  const events: TaskEvent[] = [
    event({id: 'created-aug', taskId: 'aug', kind: 'created', date: '2026-08-31', flow: 'research'}),
    event({id: 'completed-sep-1', taskId: 'sep-1', kind: 'completed', date: '2026-09-01', flow: 'research'}),
    event({id: 'completed-sep-7', taskId: 'sep-7', kind: 'completed', date: '2026-09-07', flow: 'research'}),
  ];
  const weekly = aggregateAnalytics(events, {from: '2026-08-31', to: '2026-09-07', bucket: 'week'}, coverage);
  assert.deepEqual(weekly.series.map((point) => point.date), ['2026-08-31', '2026-09-07']);
  assert.deepEqual(weekly.series.map((point) => [point.created, point.completed]), [[1, 1], [0, 1]]);

  const monthly = aggregateAnalytics(events, {from: '2026-08-31', to: '2026-09-07', bucket: 'month'}, coverage);
  assert.deepEqual(monthly.series.map((point) => point.date), ['2026-08-01', '2026-09-01']);
  assert.deepEqual(monthly.series.map((point) => [point.created, point.completed]), [[1, 0], [0, 2]]);
});

void test('rejects malformed or overlong requests while preserving a zero-filled result for empty ranges', () => {
  assert.throws(
    () => aggregateAnalytics([], {from: '2026-09-02', to: '2026-09-01', bucket: 'day'}, coverage),
    /日期范围无效/,
  );
  assert.throws(
    () => aggregateAnalytics([], {from: '2010-01-01', to: '2021-01-01', bucket: 'day'}, coverage),
    /不能超过 3660 天/,
  );
  assert.throws(
    () => aggregateAnalytics([], {from: '2026-09-01', to: '2026-09-02', bucket: 'day', flow: 'missing'}, coverage),
    /工作流无效/,
  );
  const empty = aggregateAnalytics([], {from: '2026-09-01', to: '2026-09-03', bucket: 'day'}, coverage);
  assert.equal(empty.series.length, 3);
  assert.deepEqual(empty.totals, {created: 0, completed: 0, regular: 0, daily: 0});
  assert.equal(empty.byFlow.length, 9);
});
