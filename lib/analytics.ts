import {FLOWS} from './domain.ts';
import {AppError} from './workspace.ts';

export type AnalyticsBucket = 'day' | 'week' | 'month';
export type AnalyticsEventKind = 'created' | 'completed' | 'revoked';
export type AnalyticsEventSource = 'live' | 'historical';

/**
 * Dates on events are already converted to a Beijing calendar date by the
 * event writer. `occurredAt` is retained for deterministic ordering and
 * auditing, but it is never used to infer a different calendar date.
 */
export type TaskEvent = {
  id: string;
  taskId: string;
  kind: AnalyticsEventKind;
  date: string;
  flow: string;
  daily: boolean;
  occurredAt: string;
  reverses?: string;
  source: AnalyticsEventSource;
  /** Monotonic workspace revision for live writes, when available. */
  sequence?: number;
};

export type AnalyticsQuery = {
  from: string;
  to: string;
  bucket: AnalyticsBucket;
  flow?: string;
};

export type AnalyticsCoverage = {
  since: string;
  incomplete: boolean;
  unknown: number;
};

export type AnalyticsMetric = {
  created: number;
  completed: number;
  regular: number;
  daily: number;
};

export type AnalyticsFlow = AnalyticsMetric & {
  id: string;
  name: string;
  color: string;
};

export type AnalyticsSeriesPoint = AnalyticsMetric & {date: string};

export type AnalyticsResult = {
  query: AnalyticsQuery;
  totals: AnalyticsMetric;
  byFlow: AnalyticsFlow[];
  series: AnalyticsSeriesPoint[];
  coverage: AnalyticsCoverage;
  generatedAt: string;
};

const flowMeta = new Map(FLOWS.map((flow) => [flow.id, flow]));
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

function fail(message: string): never {
  throw new AppError(message, 400);
}

function assertString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value) fail(message);
}

function dayMs(value: string): number {
  if (!dayPattern.test(value)) fail(`日期格式无效：${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const result = Date.UTC(year, month - 1, day);
  if (new Date(result).toISOString().slice(0, 10) !== value) {
    fail(`日期无效：${value}`);
  }
  return result;
}

function dayFromMs(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return dayFromMs(dayMs(value) + days * 86_400_000);
}

function emptyMetric(): AnalyticsMetric {
  return {created: 0, completed: 0, regular: 0, daily: 0};
}

function validBucket(value: unknown): value is AnalyticsBucket {
  return value === 'day' || value === 'week' || value === 'month';
}

function bucketStart(value: string, bucket: AnalyticsBucket): string {
  if (bucket === 'day') return value;
  if (bucket === 'month') return `${value.slice(0, 7)}-01`;

  const weekday = new Date(dayMs(value)).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return addDays(value, -daysSinceMonday);
}

function nextBucket(value: string, bucket: AnalyticsBucket): string {
  if (bucket === 'day') return addDays(value, 1);
  if (bucket === 'week') return addDays(value, 7);

  const [year, month] = value.slice(0, 7).split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01`;
}

function inRange(value: string, from: string, to: string): boolean {
  return value >= from && value <= to;
}

function compareEvents(a: TaskEvent, b: TaskEvent): number {
  const sequenceOrder = a.sequence !== undefined && b.sequence !== undefined ? a.sequence - b.sequence : 0;
  return sequenceOrder || Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id);
}

function validateEvent(event: TaskEvent): void {
  assertString(event.id, '统计事件缺少 ID');
  assertString(event.taskId, '统计事件缺少事项 ID');
  assertString(event.date, '统计事件缺少日期');
  dayMs(event.date);
  if (typeof event.flow !== 'string') fail('统计事件缺少工作流');
  if (event.flow && !flowMeta.has(event.flow)) fail(`统计事件工作流无效：${event.flow}`);
  if (!['created', 'completed', 'revoked'].includes(event.kind)) fail('统计事件类型无效');
  if (typeof event.daily !== 'boolean') fail('统计事件每日标记无效');
  if (!Number.isFinite(Date.parse(event.occurredAt))) fail('统计事件发生时间无效');
  if (event.sequence !== undefined && (!Number.isSafeInteger(event.sequence) || event.sequence < 0)) {
    fail('统计事件序号无效');
  }
  if (event.kind === 'revoked') assertString(event.reverses, '撤销事件缺少被撤销事件');
  if (event.source !== 'live' && event.source !== 'historical') fail('统计事件来源无效');
}

function validateQuery(query: AnalyticsQuery): AnalyticsQuery {
  assertString(query.from, '统计起始日期无效');
  assertString(query.to, '统计结束日期无效');
  assertString(query.bucket, '统计粒度无效');
  dayMs(query.from);
  dayMs(query.to);
  if (query.from > query.to) fail('统计日期范围无效');
  if (dayMs(query.to) - dayMs(query.from) > 3660 * 86_400_000) {
    fail('统计日期范围不能超过 3660 天');
  }
  if (!validBucket(query.bucket)) fail('统计粒度无效');
  if (query.flow !== undefined && (!query.flow || !flowMeta.has(query.flow))) {
    fail('统计工作流无效');
  }
  return {...query};
}

function validateCoverage(coverage: AnalyticsCoverage): AnalyticsCoverage {
  assertString(coverage.since, '统计覆盖起始日期无效');
  dayMs(coverage.since);
  if (typeof coverage.incomplete !== 'boolean') fail('统计覆盖状态无效');
  if (!Number.isSafeInteger(coverage.unknown) || coverage.unknown < 0) {
    fail('统计未知记录数量无效');
  }
  return {...coverage};
}

function prepareEvents(events: readonly TaskEvent[]): {
  created: TaskEvent[];
  completed: TaskEvent[];
  unknownTaskIds: Set<string>;
} {
  const byId = new Map<string, TaskEvent>();
  for (const event of events) {
    validateEvent(event);
    // Sync retries or overlapping history pages can repeat an event. An event
    // ID is the idempotency key, so only the first copy participates.
    if (!byId.has(event.id)) byId.set(event.id, {...event});
  }
  const all = [...byId.values()].sort(compareEvents);
  const byEventId = new Map(all.map((event) => [event.id, event]));
  const revoked = new Set<string>();
  for (const event of all) {
    if (event.kind !== 'revoked' || !event.reverses) continue;
    const target = byEventId.get(event.reverses);
    if (target?.kind === 'completed') revoked.add(target.id);
  }

  const created: TaskEvent[] = [];
  const completed: TaskEvent[] = [];
  const createdTasks = new Set<string>();
  const dailyCompletions = new Set<string>();
  const unknownTaskIds = new Set<string>();
  for (const event of all) {
    if (!event.flow) unknownTaskIds.add(event.taskId);
    if (event.kind === 'created') {
      if (!createdTasks.has(event.taskId)) {
        createdTasks.add(event.taskId);
        created.push(event);
      }
      continue;
    }
    if (event.kind !== 'completed' || revoked.has(event.id)) continue;
    if (event.daily) {
      const key = `${event.taskId}\u0000${event.date}`;
      if (dailyCompletions.has(key)) continue;
      dailyCompletions.add(key);
    }
    completed.push(event);
  }
  return {created, completed, unknownTaskIds};
}

function eventMatchesFlow(event: TaskEvent, flow: string | undefined): boolean {
  return flow === undefined || event.flow === flow;
}

function addEvent(metric: AnalyticsMetric, event: TaskEvent): void {
  if (event.kind === 'created') metric.created += 1;
  else {
    metric.completed += 1;
    metric[event.daily ? 'daily' : 'regular'] += 1;
  }
}

function makeBuckets(query: AnalyticsQuery): string[] {
  const values: string[] = [];
  const start = bucketStart(query.from, query.bucket);
  const end = bucketStart(query.to, query.bucket);
  for (let value = start; value <= end; value = nextBucket(value, query.bucket)) {
    values.push(value);
    if (values.length > 3665) fail('统计桶数量超出限制');
  }
  return values;
}

/**
 * Aggregate immutable task events into the metrics consumed by the overview.
 * Revocations are applied against the complete event set before the requested
 * date or flow filter. This preserves the original completion date and flow.
 */
export function aggregateAnalytics(
  events: TaskEvent[],
  query: AnalyticsQuery,
  coverage: AnalyticsCoverage,
): AnalyticsResult {
  const normalizedQuery = validateQuery(query);
  const normalizedCoverage = validateCoverage(coverage);
  const prepared = prepareEvents(events);
  const buckets = makeBuckets(normalizedQuery);
  const totals = emptyMetric();
  const byFlow = FLOWS.map((flow) => ({...emptyMetric(), id: flow.id, name: flow.name, color: flow.color}));
  const flowRows = new Map(byFlow.map((flow) => [flow.id, flow]));
  const series = buckets.map((date) => ({date, ...emptyMetric()}));
  const seriesRows = new Map(series.map((row) => [row.date, row]));

  const add = (event: TaskEvent): void => {
    if (!inRange(event.date, normalizedQuery.from, normalizedQuery.to)) return;
    if (!eventMatchesFlow(event, normalizedQuery.flow)) return;
    addEvent(totals, event);
    const row = event.flow ? flowRows.get(event.flow) : undefined;
    if (row) addEvent(row, event);
    const bucket = seriesRows.get(bucketStart(event.date, normalizedQuery.bucket));
    if (bucket) addEvent(bucket, event);
  };
  for (const event of prepared.created) add(event);
  for (const event of prepared.completed) add(event);

  return {
    query: normalizedQuery,
    totals,
    byFlow,
    series,
    coverage: {
      ...normalizedCoverage,
      // The caller may know about additional historical records. At minimum,
      // surface tasks whose live events have no workflow assignment.
      unknown: Math.max(normalizedCoverage.unknown, prepared.unknownTaskIds.size),
    },
    generatedAt: new Date().toISOString(),
  };
}
