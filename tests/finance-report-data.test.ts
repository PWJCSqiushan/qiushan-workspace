import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinanceReport } from '../lib/finance-report-data.ts';
import { calculateFinanceStats } from '../lib/finance-stats.ts';
import type { FinanceState, FinanceTransaction } from '../lib/finance-types.ts';
import {
  makeFinanceReportFixture,
  REPORT_FIXTURE_METADATA,
  REPORT_FIXTURE_RANGE,
} from './fixtures/finance-report-fixture.ts';

function sumGroups(groups: { cents: number }[]): number {
  return groups.reduce((sum, group) => sum + group.cents, 0);
}

function assertTreeConserves(
  groups: { cents: number; children: { cents: number; children: unknown[] }[] }[],
): void {
  for (const group of groups) {
    if (group.children.length)
      assert.equal(sumGroups(group.children), group.cents);
    assertTreeConserves(group.children as typeof groups);
  }
}

function fixtureReport(overrides: Partial<FinanceState> = {}) {
  return buildFinanceReport(
    { ...makeFinanceReportFixture(), ...overrides },
    REPORT_FIXTURE_RANGE,
    REPORT_FIXTURE_METADATA,
  );
}

void test('synthetic report carries a frozen snapshot and conserves every category level', () => {
  const report = fixtureReport();
  assert.equal(report.space, 'demo');
  assert.equal(report.snapshotVersion, 1);
  assert.equal(report.generatedAt, '2026-10-09T04:00:00Z');
  assert.equal(report.pendingCount, 2);
  assert.equal(report.localDraft, false);
  assert.equal(report.personalCents, 39_900);
  assert.equal(report.incomeCents, 30_000);
  assert.equal(report.expenseCount, 10);
  assert.equal(sumGroups(report.groups), report.personalCents);
  assertTreeConserves(report.groups);
  const unclassified = report.groups.find((group) => group.id === 'unclassified')!;
  assert.equal(unclassified.children.length, 1);
  assert.deepEqual(
    [unclassified.children[0].name, unclassified.children[0].cents],
    ['未细分', report.unclassifiedCents],
  );
  assert.equal(report.positiveCents + report.adjustmentCents, report.personalCents);
  assert.equal(report.adjustments.length, 0);
  assert.equal(report.trendUnit, 'day');
  assert.equal(report.trend.length, 30);
  assert.deepEqual(report.trend.find((row) => row.date === '2026-09-06'), {
    date: '2026-09-06',
    endDate: '2026-09-07',
    cents: 6_000,
    recorded: true,
  });
  assert.deepEqual(report.trend.find((row) => row.date === '2026-09-01'), {
    date: '2026-09-01',
    endDate: '2026-09-02',
    cents: 0,
    recorded: false,
  });
  assert.equal(report.trend.find((row) => row.date === '2026-09-22')?.recorded, true);
  assert.equal(report.topGroups.length, 5);
  assert.deepEqual(report.details.map((detail) => detail.id), [
    'monthly-rent',
    'rail-ticket',
    'race-entry',
    'food-main',
    'book-purchase',
  ]);
  assert.ok(report.details.every((detail) => detail.cents > 0));
  assert.ok(report.details[0].description.includes('合成公寓'));
  assert.ok(report.details[0].purpose.includes('居住家居'));
  assert.ok(report.overviewGroups.length <= 8);
});
void test('AA allocation, analysis-only expense, income, transfer and lending use the right dimensions', () => {
  const state = makeFinanceReportFixture();
  const stats = calculateFinanceStats(state, REPORT_FIXTURE_RANGE);
  const report = fixtureReport();
  assert.equal(stats.personalCents, report.personalCents);
  assert.equal(report.groups.find((group) => group.id === 'life')?.cents, 7_500);
  assert.equal(report.groups.find((group) => group.id === 'hobby')?.cents, 5_900);
  assert.equal(report.incomeCents, 30_000);
  assert.equal(report.groups.some((group) => group.id === 'income'), false);
  assert.equal(report.groups.some((group) => group.id === 'wallet'), false);
  assert.equal(report.expenseCount, 10);
});

void test('cross-month mapped refund is applied to the original expense date', () => {
  const report = fixtureReport();
  assert.equal(report.groups.find((group) => group.id === 'transport')?.cents, 6_000);
  assert.equal(report.trend.find((row) => row.date === '2026-10-02'), undefined);
  assert.equal(report.trend.find((row) => row.date === '2026-09-06')?.cents, 6_000);
  assert.equal(report.details.find((detail) => detail.id === 'rail-ticket')?.date, '2026-09-06');
});

void test('full refund keeps one recorded expense but removes it from positive details', () => {
  const state = makeFinanceReportFixture();
  const original = state.transactions.find((transaction) => transaction.id === 'food-main')!;
  const fullRefund: FinanceTransaction = {
    id: 'food-full-refund',
    version: 1,
    kind: 'refund',
    occurredAt: '2026-09-25T08:00:00+08:00',
    accountId: 'wallet',
    amountCents: 4_500,
    personalCents: 4_500,
    relatedId: original.id,
    allocations: [
      {
        id: 'food-full-refund-allocation',
        categoryId: 'life-meal',
        content: '全额退款',
        amountCents: 4_500,
        nature: 'daily',
        refundOfAllocationId: 'food-main-allocation',
      },
    ],
  };
  state.transactions = [original, fullRefund];
  const report = buildFinanceReport(state, REPORT_FIXTURE_RANGE, REPORT_FIXTURE_METADATA);
  assert.equal(report.personalCents, 0);
  assert.equal(report.expenseCount, 1);
  assert.deepEqual(report.details, []);
  assert.equal(report.trend.find((row) => row.date === '2026-09-02')?.recorded, true);
  assert.equal(report.trend.find((row) => row.date === '2026-09-02')?.cents, 0);
  assert.equal(sumGroups(report.groups), 0);
});

void test('negative unmapped refund stays a signed unclassified adjustment', () => {
  const state = makeFinanceReportFixture();
  state.transactions = state.transactions.filter((transaction) => transaction.id !== 'long-note');
  const original: FinanceTransaction = {
    id: 'negative-adjustment-expense',
    version: 1,
    kind: 'expense',
    occurredAt: '2026-09-24T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 1_000,
    personalCents: 1_000,
    allocations: [
      {
        id: 'negative-adjustment-allocation',
        categoryId: 'life-meal',
        content: '待退款餐饮',
        amountCents: 1_000,
        nature: 'daily',
      },
    ],
  };
  const refund: FinanceTransaction = {
    id: 'negative-adjustment-refund',
    version: 1,
    kind: 'refund',
    occurredAt: '2026-09-25T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 1_000,
    personalCents: 1_000,
    relatedId: original.id,
    allocations: [],
  };
  state.transactions.push(original, refund);
  const report = buildFinanceReport(state, REPORT_FIXTURE_RANGE, REPORT_FIXTURE_METADATA);
  assert.equal(report.unclassifiedCents, -1_500);
  assert.deepEqual(report.adjustments.map((group) => [group.id, group.cents]), [
    ['unclassified', -1_500],
  ]);
  assert.equal(report.overviewGroups.some((group) => group.id === 'unclassified'), false);
  assert.equal(report.positiveCents + report.adjustmentCents, report.personalCents);
});

void test('overview merges many positive roots while keeping unclassified separate', () => {
  const state = makeFinanceReportFixture();
  const extraRoots = ['one', 'two', 'three'].flatMap((id, index) => [
    { id: `extra-${id}`, version: 1, name: `额外用途${index + 1}`, parentId: null, level: 1 as const },
    { id: `extra-${id}-sub`, version: 1, name: '子用途', parentId: `extra-${id}`, level: 2 as const },
    { id: `extra-${id}-leaf`, version: 1, name: '明细', parentId: `extra-${id}-sub`, level: 3 as const },
  ]);
  state.categories.push(...extraRoots);
  for (const [index, id] of ['one', 'two', 'three'].entries())
    state.transactions.push({
      id: `extra-expense-${id}`,
      version: 1,
      kind: 'expense',
      occurredAt: `2026-09-${26 + index}T12:00:00+08:00`,
      accountId: 'wallet',
      amountCents: 100 + index * 100,
      personalCents: 100 + index * 100,
      allocations: [
        {
          id: `extra-allocation-${id}`,
          categoryId: `extra-${id}-leaf`,
          content: '额外用途',
          amountCents: 100 + index * 100,
          nature: 'daily',
        },
      ],
    });
  const report = buildFinanceReport(state, REPORT_FIXTURE_RANGE, REPORT_FIXTURE_METADATA);
  assert.ok(report.groups.length >= 10);
  assert.ok(report.overviewGroups.length <= 8);
  assert.equal(report.overviewGroups.some((group) => group.id === 'other-major'), true);
  assert.equal(sumGroups(report.overviewGroups), report.positiveCents);
});

void test('one, three and five effective roots naturally size the ranking cards', () => {
  const selected = [
    ['monthly-rent'],
    ['monthly-rent', 'food-main', 'rail-ticket'],
    ['monthly-rent', 'food-main', 'rail-ticket', 'race-entry', 'book-purchase'],
  ];
  for (const ids of selected) {
    const state = makeFinanceReportFixture();
    state.transactions = state.transactions.filter(
      (transaction) => ids.includes(transaction.id),
    );
    const report = buildFinanceReport(state, REPORT_FIXTURE_RANGE, REPORT_FIXTURE_METADATA);
    assert.equal(report.topGroups.length, ids.length);
    assert.ok(report.topGroups.every((group) => group.cents > 0));
  }
});

void test('custom range, exact boundaries, weekly and monthly trends are deterministic', () => {
  const state = makeFinanceReportFixture();
  const short = buildFinanceReport(
    state,
    { from: '2026-09-04', to: '2026-09-11' },
    REPORT_FIXTURE_METADATA,
  );
  assert.equal(short.expenseCount, 4);
  assert.equal(short.personalCents, 26_000);
  assert.equal(short.trendUnit, 'day');
  const weekly = buildFinanceReport(
    state,
    { from: '2026-09-01', to: '2026-11-04' },
    REPORT_FIXTURE_METADATA,
  );
  assert.equal(weekly.trendUnit, 'week');
  assert.equal(weekly.trend[0].date, '2026-09-01');
  assert.equal(weekly.trend.at(-1)?.endDate, '2026-11-04');
  const monthly = buildFinanceReport(
    state,
    { from: '2025-01-15', to: '2027-01-15' },
    REPORT_FIXTURE_METADATA,
  );
  assert.equal(monthly.trendUnit, 'month');
  assert.equal(monthly.trend.length, 25);
  assert.equal(monthly.trend[0].date, '2025-01-15');
  assert.equal(monthly.trend.at(-1)?.endDate, '2027-01-15');
});

void test('empty state has a stable zero report and still distinguishes no records', () => {
  const state = makeFinanceReportFixture();
  state.transactions = [];
  const report = buildFinanceReport(state, REPORT_FIXTURE_RANGE, REPORT_FIXTURE_METADATA);
  assert.equal(report.personalCents, 0);
  assert.equal(report.incomeCents, 0);
  assert.equal(report.expenseCount, 0);
  assert.equal(report.positiveCents, 0);
  assert.equal(report.adjustmentCents, 0);
  assert.deepEqual(report.details, []);
  assert.equal(report.trend.every((row) => row.cents === 0 && !row.recorded), true);
  assert.equal(sumGroups(report.groups), 0);
});

void test('date range and metadata validation reject ambiguous or oversized exports', () => {
  const state = makeFinanceReportFixture();
  assert.throws(
    () => buildFinanceReport(state, { from: '2026-02-30', to: '2026-03-01' }, REPORT_FIXTURE_METADATA),
    /valid calendar date/,
  );
  assert.throws(
    () => buildFinanceReport(state, { from: '2026-03-01', to: '2026-03-01' }, REPORT_FIXTURE_METADATA),
    /before/,
  );
  assert.throws(
    () => buildFinanceReport(state, { from: '2010-01-01', to: '2026-01-01' }, REPORT_FIXTURE_METADATA),
    /too large/,
  );
  assert.throws(
    () => buildFinanceReport(state, REPORT_FIXTURE_RANGE, { ...REPORT_FIXTURE_METADATA, pendingCount: -1 }),
    /pendingCount/,
  );
  assert.throws(
    () => buildFinanceReport(state, REPORT_FIXTURE_RANGE, { ...REPORT_FIXTURE_METADATA, generatedAt: 'not-a-date' }),
    /generatedAt/,
  );
});

void test('personal space and local draft metadata remain frozen in the returned snapshot', () => {
  const state = makeFinanceReportFixture();
  state.space = 'personal';
  state.version = 42;
  const report = buildFinanceReport(state, REPORT_FIXTURE_RANGE, {
    generatedAt: '2026-10-09T04:00:00Z',
    pendingCount: 7,
    localDraft: true,
  });
  assert.equal(report.space, 'personal');
  assert.equal(report.snapshotVersion, 42);
  assert.equal(report.pendingCount, 7);
  assert.equal(report.localDraft, true);
});
