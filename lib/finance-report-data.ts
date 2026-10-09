import type {
  FinanceCategory,
  FinanceState,
  FinanceTransaction,
} from './finance-types.ts';
import { addFinanceCents } from './finance-domain.ts';
import { calculateFinanceStats } from './finance-stats.ts';
import { categoryColor, categoryPath } from './finance-chart-data.ts';

/** A half-open report window. Dates are calendar dates in Asia/Shanghai. */
export type FinanceReportRange = { from: string; to: string };

export type FinanceReportMetadata = {
  generatedAt: string;
  pendingCount: number;
  localDraft: boolean;
};

export type ReportGroup = {
  id: string;
  name: string;
  /** Signed net amount. Negative values are adjustments, never pie slices. */
  cents: number;
  color: string;
  children: ReportGroup[];
};

export type FinanceReportGroup = ReportGroup;

export type FinanceReportDetail = {
  id: string;
  date: string;
  description: string;
  purpose: string;
  cents: number;
};

export type FinanceReportTrendUnit = 'day' | 'week' | 'month';

export type FinanceReportTrendPoint = {
  /** First calendar day represented by this half-open point. */
  date: string;
  /** First calendar day after this half-open point. */
  endDate: string;
  cents: number;
  /** True when at least one expense transaction was recorded in the bucket. */
  recorded: boolean;
};

export type FinanceReport = {
  from: string;
  to: string;
  space: FinanceState['space'];
  /** Ledger version used for the frozen report snapshot. */
  snapshotVersion: number;
  generatedAt: string;
  pendingCount: number;
  localDraft: boolean;
  personalCents: number;
  incomeCents: number;
  unclassifiedCents: number;
  expenseCount: number;
  /** Sum of positive top-level groups. */
  positiveCents: number;
  /** Signed sum of negative top-level groups. */
  adjustmentCents: number;
  /** Complete top-level category tree, including the zero/negative unclassified group. */
  groups: ReportGroup[];
  /** Positive top-level groups, merged to at most eight entries. */
  overviewGroups: ReportGroup[];
  /** Negative top-level groups with their signed amounts. */
  adjustments: ReportGroup[];
  /** Five largest positive top-level groups, excluding unclassified. */
  topGroups: ReportGroup[];
  /** Five expense transactions with the largest net personal amount. */
  details: FinanceReportDetail[];
  trend: FinanceReportTrendPoint[];
  trendUnit: FinanceReportTrendUnit;
};

const MAX_RANGE_DAYS = 3660;
const UNCLASSIFIED_STATS_ID = '__unclassified__';
const UNCLASSIFIED_ID = 'unclassified';
const OTHER_MAJOR_ID = 'other-major';
const UNSPECIFIED_NAME = '未细分';

const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateDateOnly(value: string, label: string): void {
  assert(isDateOnly(value), `${label} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  assert(
    check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day,
    `${label} is not a valid calendar date`,
  );
}

function dateKey(value: string): string {
  if (isDateOnly(value)) {
    validateDateOnly(value, 'transaction date');
    return value;
  }
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `invalid transaction date: ${value}`);
  return SHANGHAI_DATE.format(new Date(parsed));
}

function utcDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function dayDistance(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / 86_400_000);
}

function shiftDay(value: string, amount: number): string {
  const date = new Date(utcDay(value));
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function assertSafeCents(value: number, label: string): number {
  assert(Number.isSafeInteger(value), `${label} must be a safe integer`);
  return value;
}

function addCents(left: number, right: number, label: string): number {
  return addFinanceCents(
    assertSafeCents(left, label),
    assertSafeCents(right, label),
    label,
  );
}

function validateRange(range: FinanceReportRange): number {
  validateDateOnly(range.from, 'report.from');
  validateDateOnly(range.to, 'report.to');
  assert(range.from < range.to, 'report.from must be before report.to');
  const days = dayDistance(range.from, range.to);
  assert(days > 0 && days <= MAX_RANGE_DAYS, 'report range is too large');
  return days;
}

function personalCents(transaction: FinanceTransaction): number {
  if (transaction.kind === 'expense')
    return transaction.personalCents ?? transaction.amountCents;
  if (transaction.kind === 'refund') {
    return (
      transaction.personalCents ??
      transaction.allocations.reduce(
        (sum, allocation) =>
          addCents(
            sum,
            allocation.amountCents,
            `transaction ${transaction.id} allocation total`,
          ),
        0,
      )
    );
  }
  return 0;
}

function transactionDescription(
  state: FinanceState,
  transaction: FinanceTransaction,
): string {
  const counterparty = transaction.counterparty
    ? state.places.find((place) => place.id === transaction.counterparty)
        ?.name ?? transaction.counterparty
    : '';
  const value = [counterparty, transaction.note ?? '']
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' · ');
  return value || '未指定商家';
}

function transactionPurpose(
  state: FinanceState,
  transaction: FinanceTransaction,
): string {
  if (transaction.allocations.length === 0) return '待分类';
  const labels: string[] = [];
  for (const allocation of transaction.allocations) {
    const path = allocation.categoryId
      ? categoryPath(state.categories, allocation.categoryId)
      : [];
    const label = path.length
      ? path.map((category) => category.name).join(' / ')
      : '待分类';
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join('、') || '待分类';
}

type MutableReportGroup = {
  id: string;
  name: string;
  cents: number;
  color: string;
  children: Map<string, MutableReportGroup>;
};

function compareGroups(left: ReportGroup, right: ReportGroup): number {
  if (right.cents !== left.cents) return right.cents > left.cents ? 1 : -1;
  return left.name.localeCompare(right.name);
}

function freezeGroup(group: MutableReportGroup): ReportGroup {
  const children = [...group.children.values()]
    .map(freezeGroup)
    .sort(compareGroups);
  return {
    id: group.id,
    name: group.name,
    cents: group.cents,
    color: group.color,
    children,
  };
}

function newGroup(
  state: FinanceState,
  category: FinanceCategory | undefined,
  id: string,
  name: string,
): MutableReportGroup {
  return {
    id,
    name,
    cents: 0,
    color: category ? categoryColor(state.categories, category.id) : '#86959d',
    children: new Map(),
  };
}

function addCategoryGroup(
  state: FinanceState,
  roots: Map<string, MutableReportGroup>,
  categoryId: string,
  amountCents: number,
): void {
  if (categoryId === UNCLASSIFIED_STATS_ID) {
    const group = roots.get(UNCLASSIFIED_ID)!;
    group.cents = addCents(group.cents, amountCents, 'unclassified report total');
    return;
  }
  const path = categoryPath(state.categories, categoryId);
  if (path.length === 0) {
    const group = roots.get(UNCLASSIFIED_ID)!;
    group.cents = addCents(group.cents, amountCents, 'unknown category report total');
    return;
  }
  let current: MutableReportGroup =
    roots.get(path[0].id) ??
    newGroup(state, path[0], path[0].id, path[0].name);
  roots.set(path[0].id, current);
  current.cents = addCents(current.cents, amountCents, `category ${current.id} total`);
  for (const category of path.slice(1)) {
    let child = current.children.get(category.id);
    if (!child) {
      child = newGroup(state, category, category.id, category.name);
      current.children.set(category.id, child);
    }
    child.cents = addCents(child.cents, amountCents, `category ${child.id} total`);
    current = child;
  }
}

/**
 * Keep direct amounts visible when a snapshot has a level-1/2 allocation or
 * an unclassified amount. Domain-created transactions normally end at level 3,
 * but old snapshots can contain direct parent amounts. The synthetic leaf is
 * explicit so every parent with a non-zero amount still reconciles by children.
 */
function addUnspecifiedLeaves(
  state: FinanceState,
  group: MutableReportGroup,
): void {
  for (const child of group.children.values()) addUnspecifiedLeaves(state, child);
  const childTotal = [...group.children.values()].reduce(
    (sum, child) => addCents(sum, child.cents, `children of ${group.id}`),
    0,
  );
  const residual = addCents(group.cents, -childTotal, `unallocated ${group.id}`);
  const category = state.categories.find((item) => item.id === group.id);
  if (residual === 0 || category?.level === 3) return;
  let id = `${group.id}::unspecified`;
  let suffix = 2;
  while (group.children.has(id)) id = `${group.id}::unspecified-${suffix++}`;
  group.children.set(id, {
    id,
    name: UNSPECIFIED_NAME,
    cents: residual,
    color: group.color,
    children: new Map(),
  });
}

function buildGroups(state: FinanceState, stats: ReturnType<typeof calculateFinanceStats>): ReportGroup[] {
  const roots = new Map<string, MutableReportGroup>();
  for (const category of state.categories.filter(
    (item) => !item.deleted && item.level === 1,
  ))
    roots.set(category.id, newGroup(state, category, category.id, category.name));
  roots.set(
    UNCLASSIFIED_ID,
    newGroup(state, undefined, UNCLASSIFIED_ID, '待分类'),
  );
  for (const group of stats.categoryTotals)
    addCategoryGroup(state, roots, group.id, group.cents);
  for (const root of roots.values()) addUnspecifiedLeaves(state, root);
  return [...roots.values()].map(freezeGroup).sort(compareGroups);
}

function cloneGroup(group: ReportGroup): ReportGroup {
  return { ...group, children: group.children.map(cloneGroup) };
}

function buildOverviewGroups(groups: ReportGroup[]): ReportGroup[] {
  const unclassified = groups.find((group) => group.id === UNCLASSIFIED_ID);
  const unclassifiedPositive = unclassified && unclassified.cents > 0;
  const positive = groups.filter(
    (group) => group.id !== UNCLASSIFIED_ID && group.cents > 0,
  );
  const capacity = 8 - (unclassifiedPositive ? 1 : 0);
  const shouldMerge = positive.length > capacity;
  const keepCount = shouldMerge ? Math.max(0, capacity - 1) : positive.length;
  const result = positive.slice(0, keepCount).map(cloneGroup);
  const omitted = positive.slice(keepCount);
  if (omitted.length) {
    const cents = omitted.reduce(
      (sum, group) => addCents(sum, group.cents, 'other major uses'),
      0,
    );
    result.push({
      id: OTHER_MAJOR_ID,
      name: '其他主要用途',
      cents,
      color: '#9aa6ad',
      children: [],
    });
  }
  if (unclassifiedPositive) result.push(cloneGroup(unclassified!));
  return result.sort(compareGroups);
}

function buildTrend(
  state: FinanceState,
  stats: ReturnType<typeof calculateFinanceStats>,
  range: FinanceReportRange,
  days: number,
): { trend: FinanceReportTrendPoint[]; trendUnit: FinanceReportTrendUnit } {
  const trendUnit: FinanceReportTrendUnit =
    days <= 62 ? 'day' : days <= 370 ? 'week' : 'month';
  const daily = new Map(stats.daily.map((item) => [item.date, item.cents]));
  const recorded = new Set(
    state.transactions
      .filter(
        (transaction) =>
          !transaction.deleted &&
          transaction.kind === 'expense' &&
          dateKey(transaction.occurredAt) >= range.from &&
          dateKey(transaction.occurredAt) < range.to,
      )
      .map((transaction) => dateKey(transaction.occurredAt)),
  );
  if (trendUnit === 'day') {
    const result: FinanceReportTrendPoint[] = [];
    for (let date = range.from; date < range.to; date = shiftDay(date, 1))
      result.push({
        date,
        endDate: shiftDay(date, 1),
        cents: daily.get(date) ?? 0,
        recorded: recorded.has(date),
      });
    return { trend: result, trendUnit };
  }
  const buckets = new Map<
    string,
    { date: string; endDate: string; cents: number; recorded: boolean }
  >();
  for (let date = range.from; date < range.to; date = shiftDay(date, 1)) {
    let start: string;
    let end: string;
    if (trendUnit === 'week') {
      const weekday = new Date(utcDay(date)).getUTCDay();
      const mondayOffset = (weekday + 6) % 7;
      start = shiftDay(date, -mondayOffset);
      end = shiftDay(start, 7);
    } else {
      start = `${date.slice(0, 7)}-01`;
      const nextMonth = shiftDay(start, 32).slice(0, 7) + '-01';
      end = nextMonth;
    }
    const bucket = buckets.get(start) ?? {
      date: date > start ? date : start,
      endDate: range.to < end ? range.to : end,
      cents: 0,
      recorded: false,
    };
    bucket.cents = addCents(
      bucket.cents,
      daily.get(date) ?? 0,
      `trend ${trendUnit} total`,
    );
    bucket.recorded ||= recorded.has(date);
    buckets.set(start, bucket);
  }
  return {
    trend: [...buckets.values()].sort((left, right) =>
      left.date.localeCompare(right.date),
    ),
    trendUnit,
  };
}

export function buildFinanceReport(
  state: FinanceState,
  range: FinanceReportRange,
  metadata: FinanceReportMetadata,
): FinanceReport {
  const days = validateRange(range);
  assert(
    typeof metadata.generatedAt === 'string' &&
      metadata.generatedAt.length > 0 &&
      Number.isFinite(Date.parse(metadata.generatedAt)),
    'generatedAt must be a valid date',
  );
  assert(Number.isSafeInteger(metadata.pendingCount) && metadata.pendingCount >= 0, 'pendingCount must be a non-negative integer');
  assert(typeof metadata.localDraft === 'boolean', 'localDraft must be boolean');
  const stats = calculateFinanceStats(state, range);
  const groups = buildGroups(state, stats);
  const groupedTotal = groups.reduce(
    (sum, group) => addCents(sum, group.cents, 'report group total'),
    0,
  );
  assert(
    groupedTotal === stats.personalCents,
    'report category groups do not reconcile with personal total',
  );
  const positiveCents = groups
    .filter((group) => group.cents > 0)
    .reduce((sum, group) => addCents(sum, group.cents, 'positive report total'), 0);
  const adjustmentCents = groups
    .filter((group) => group.cents < 0)
    .reduce((sum, group) => addCents(sum, group.cents, 'report adjustment total'), 0);
  assert(
    addCents(positiveCents, adjustmentCents, 'report signed total') ===
      stats.personalCents,
    'report positive and adjustment totals do not reconcile',
  );
  const refundsByOriginal = new Map<string, number>();
  for (const transaction of state.transactions) {
    if (transaction.deleted || transaction.kind !== 'refund' || !transaction.relatedId) continue;
    refundsByOriginal.set(
      transaction.relatedId,
      addCents(
        refundsByOriginal.get(transaction.relatedId) ?? 0,
        personalCents(transaction),
        `refund total ${transaction.relatedId}`,
      ),
    );
  }
  const expenses = state.transactions.filter(
    (transaction) =>
      !transaction.deleted &&
      transaction.kind === 'expense' &&
      dateKey(transaction.occurredAt) >= range.from &&
      dateKey(transaction.occurredAt) < range.to,
  );
  const expenseIds = new Set(expenses.map((transaction) => transaction.id));
  const details = expenses
    .map((transaction) => ({
      id: transaction.id,
      date: dateKey(transaction.occurredAt),
      description: transactionDescription(state, transaction),
      purpose: transactionPurpose(state, transaction),
      cents: addCents(
        personalCents(transaction),
        -(refundsByOriginal.get(transaction.id) ?? 0),
        `net detail ${transaction.id}`,
      ),
    }))
    .sort(
      (left, right) =>
        right.cents - left.cents ||
        right.date.localeCompare(left.date) ||
        left.id.localeCompare(right.id),
    )
    .filter((detail) => detail.cents > 0)
    .slice(0, 5);
  const trendData = buildTrend(state, stats, range, days);
  return {
    from: range.from,
    to: range.to,
    space: state.space,
    snapshotVersion: state.version,
    generatedAt: metadata.generatedAt,
    pendingCount: metadata.pendingCount,
    localDraft: metadata.localDraft,
    personalCents: stats.personalCents,
    incomeCents: stats.incomeCents,
    unclassifiedCents: stats.unclassifiedCents,
    expenseCount: expenseIds.size,
    positiveCents,
    adjustmentCents,
    groups,
    overviewGroups: buildOverviewGroups(groups),
    adjustments: groups.filter((group) => group.cents < 0).map(cloneGroup),
    topGroups: groups
      .filter((group) => group.id !== UNCLASSIFIED_ID && group.cents > 0)
      .slice(0, 5)
      .map(cloneGroup),
    details,
    trend: trendData.trend,
    trendUnit: trendData.trendUnit,
  };
}
