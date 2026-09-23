/**
 * Local-only import helpers for the time board.
 *
 * This module deliberately contains no database or network code.  Importers
 * return a preview and issues; the caller decides whether to submit anything.
 * Dates are represented with an explicit Asia/Shanghai offset so that a local
 * browser and a Worker do not silently reinterpret a user's time.
 */

export const TIME_ZONE = 'Asia/Shanghai';
export const TIME_OFFSET = '+08:00';

export const TIME_CATEGORY_IDS = [
  'sleep',
  'class',
  'study',
  'exercise',
  'meeting',
  'commute',
  'meal',
  'entertainment',
  'buffer',
  'free',
  'other',
] as const;

export type TimeCategoryId = (typeof TIME_CATEGORY_IDS)[number] | (string & {});
export type ImportKind = 'plan' | 'actual';

export type ImportCandidate = {
  start: string;
  end: string;
  categoryId: string;
  note: string;
  sourceKey: string;
  kind: ImportKind;
  estimated?: boolean;
};

export type ImportIssueLevel = 'error' | 'warning';

export type ImportIssue = {
  level: ImportIssueLevel;
  code: string;
  message: string;
  sourceKey?: string;
  row?: number;
};

export type ImportPreview = {
  items: ImportCandidate[];
  candidates: ImportCandidate[];
  issues: ImportIssue[];
  errors: string[];
  warnings: string[];
  source: string;
};

export type ParseChineseTimeResult = ImportPreview & {
  ok: boolean;
  text: string;
};

export type TimetablePeriod = {
  index: number;
  start: string;
  end: string;
  label?: string;
};

export type TimetableColumnMap = {
  date?: string | number;
  weekday?: string | number;
  period?: string | number;
  course?: string | number;
  note?: string | number;
  week?: string | number;
  start?: string | number;
  end?: string | number;
  [key: string]: string | number | undefined;
};

export type TimetableNormalizeOptions = {
  source?: string;
  weekStart?: string;
  weekEnd?: string;
  periods?: readonly TimetablePeriod[];
  columnMap?: TimetableColumnMap;
  /** Set only after the user supplies all semester recurrence information. */
  semester?: {
    startDate?: string;
    parity?: 'all' | 'odd' | 'even';
    fromWeek?: number;
    toWeek?: number;
    periods?: readonly TimetablePeriod[];
  };
  /** Used for a column such as 周一/周二 when a date is supplied separately. */
  dateByWeekday?: Record<string, string>;
};

export type TimetableNormalizeResult = ImportPreview & {
  skippedRows: number[];
};

export type OcrBlock = {
  text: string;
  confidence?: number;
  bbox?: {x0: number; y0: number; x1: number; y1: number};
  blockId?: string;
  words?: OcrBlock[];
};

export type TimetableOcrResult = {
  text: string;
  blocks: OcrBlock[];
  regions?: OcrBlock[];
  issues: ImportIssue[];
};

export type OcrDateColumnMapping = {
  date: string;
  x0: number;
  x1: number;
  label?: string;
};

export type OcrPeriodRowMapping = {
  period: string;
  y0: number;
  y1: number;
};

export type OcrGridMapping = {
  dateColumns: OcrDateColumnMapping[];
  periodRows: OcrPeriodRowMapping[];
};

export type TimetableOcrGridOptions = TimetableNormalizeOptions & {
  mapping?: Partial<OcrGridMapping>;
};

export type TimetableOcrGridResult = TimetableNormalizeResult & {
  mapping: OcrGridMapping;
  ocrRows: Array<{date: string; period: string; course: string; note?: string; confidence?: number; sourceKey: string}>;
};

export type FileLikeImport = {
  name?: string;
  type?: string;
  text?: string;
  bytes?: ArrayBuffer | Uint8Array;
};

export type FileImportResult = TimetableNormalizeResult & {
  format: 'csv' | 'tsv' | 'json' | 'xlsx' | 'xls' | 'unknown';
};

export type GarminImportResult = ImportPreview & {
  format: 'csv' | 'json' | 'fit' | 'unknown';
  recordsRead: number;
  recordsSkipped: number;
};

const DATE_RE = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?$/u;
const MONTH_DAY_RE = /^(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?$/u;
const TIME_TOKEN_RE = /(?:(今天|明天|后天|昨天|前天|昨晚|今晚|明早|今早|\d{4}[年\-/\.]\d{1,2}[月\-/\.]\d{1,2}日?|\d{1,2}月\d{1,2}日)\s*)?(?:(凌晨|清晨|早上|上午|中午|下午|晚上|傍晚)\s*)?(\d{1,2}(?:(?::|：)\s*\d{1,2}\s*(?:分)?|点(?:半|\s*\d{1,2}\s*分?)?|时\s*\d{1,2}\s*分?))/gu;
const DATE_TIME_RE = /^(?:(今天|明天|后天|昨天|前天|昨晚|今晚|明早|今早)\s*)?(?:(\d{4})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?|(?:(\d{1,2})月(\d{1,2})日?))?\s*(?:(凌晨|清晨|早上|上午|中午|下午|晚上|傍晚)\s*)?(\d{1,2})(?:(?::|：)\s*(\d{1,2})\s*(?:分)?)?(?:点半|点\s*半|点\s*(\d{1,2})\s*分?|点|时\s*(\d{1,2})\s*分?)?$/u;

const ACTIVITY_MAP: Array<[RegExp, string]> = [
  [/睡|入睡|起床|午睡|休息/u, 'sleep'],
  [/上课|课程|课堂|听课/u, 'class'],
  [/学|复习|作业|写代码|编程|阅读|读书|论文|专注/u, 'study'],
  [/跑步|运动|训练|健身|骑车|游泳|比赛/u, 'exercise'],
  [/会议|开会|组会|面试|讨论/u, 'meeting'],
  [/通勤|坐车|公交|地铁|开车|步行到/u, 'commute'],
  [/吃饭|用餐|早餐|午餐|晚餐|饭/u, 'meal'],
  [/娱乐|游戏|刷视频|看剧|电影|音乐/u, 'entertainment'],
  [/缓冲|整理|准备|收拾/u, 'buffer'],
  [/自由|空闲|发呆/u, 'free'],
];

function issue(level: ImportIssueLevel, code: string, message: string, extra: Partial<ImportIssue> = {}): ImportIssue {
  return {level, code, message, ...extra};
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return String(value).trim();
}

function normalizedKey(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s_\-./\\:：()（）]/gu, '');
}

function partsInShanghai(value: Date): {year: number; month: number; day: number} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {year: get('year'), month: get('month'), day: get('day')};
}

function normalizeNow(now?: Date | string): Date {
  if (now instanceof Date) {
    if (Number.isNaN(now.getTime())) throw new Error('当前时间无效');
    return now;
  }
  if (typeof now === 'string') {
    const value = new Date(now);
    if (Number.isNaN(value.getTime())) throw new Error('当前时间无效');
    return value;
  }
  return new Date();
}

function dateString(year: number, month: number, day: number): string {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() + 1 !== month || value.getUTCDate() !== day) {
    throw new Error('日期无效');
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function shiftDate(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + delta));
  return dateString(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

function dateFromNow(now: Date): string {
  const parts = partsInShanghai(now);
  return dateString(parts.year, parts.month, parts.day);
}

function parseDateLabel(value: string, baseDate: string): {date?: string; explicit: boolean; error?: string} {
  let text = value.trim().replace(/[，,。]$/u, '');
  let delta = 0;
  let explicit = false;
  if (/昨晚|昨天/u.test(text)) {
    delta = -1;
    explicit = true;
    text = text.replace(/昨晚|昨天/gu, '');
  } else if (/前天/u.test(text)) {
    delta = -2;
    explicit = true;
    text = text.replace(/前天/gu, '');
  } else if (/明天|明早/u.test(text)) {
    delta = 1;
    explicit = true;
    text = text.replace(/明天|明早/gu, '');
  } else if (/后天/u.test(text)) {
    delta = 2;
    explicit = true;
    text = text.replace(/后天/gu, '');
  } else if (/今天|今早|今晚/u.test(text)) {
    explicit = true;
    text = text.replace(/今天|今早|今晚/gu, '');
  }
  text = text.trim();
  if (!text) return {date: shiftDate(baseDate, delta), explicit};
  const full = text.match(DATE_RE);
  if (full) {
    try {
      return {date: dateString(Number(full[1]), Number(full[2]), Number(full[3])), explicit: true};
    } catch {
      return {error: '日期无效', explicit: true};
    }
  }
  const monthDay = text.match(MONTH_DAY_RE);
  if (monthDay) {
    const year = Number(baseDate.slice(0, 4));
    try {
      return {date: dateString(year, Number(monthDay[1]), Number(monthDay[2])), explicit: true};
    } catch {
      return {error: '日期无效', explicit: true};
    }
  }
  if (/周|星期/u.test(text)) return {error: '仅有星期几无法确定具体日期，请补充日期', explicit: true};
  return {error: `无法识别日期“${value.trim()}”`, explicit: true};
}

function endpointParts(value: string): {dateLabel: string; meridiem: string; hour: number; minute: number; hasMinute: boolean; rest: string} | {error: string} {
  const text = value.trim().replace(/^从\s*/u, '');
  const match = text.match(DATE_TIME_RE);
  if (!match) return {error: `无法识别时间“${value.trim()}”`};
  const hour = Number(match[8]);
  const minuteText = match[9] ?? match[10] ?? match[11];
  const minute = match[10] === undefined && match[11] === undefined && /点半/u.test(text) ? 30 : Number(minuteText ?? 0);
  const token = match[1] ?? '';
  const date = match[2] ? `${match[2]}年${match[3]}月${match[4]}日` : match[5] ? `${match[5]}月${match[6]}日` : token;
  const consumed = match[0].length;
  return {
    dateLabel: date,
    meridiem: match[7] ?? token,
    hour,
    minute,
    hasMinute: minuteText !== undefined || /点半|点\s*半/u.test(text),
    rest: text.slice(consumed).trim(),
  };
}

function canonicalEndpoint(parts: Exclude<ReturnType<typeof endpointParts>, {error: string}>, baseDate: string): {iso?: string; date?: string; error?: string; explicitDate: boolean} {
  const parsedDate = parseDateLabel(parts.dateLabel, baseDate);
  if (parsedDate.error || !parsedDate.date) return {error: parsedDate.error ?? '日期无效', explicitDate: false};
  let hour = parts.hour;
  let minute = parts.minute;
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return {error: '时间无效', explicitDate: parsedDate.explicit};
  const meridiem = parts.meridiem;
  if (/下午|晚上|傍晚/u.test(meridiem) && hour < 12) hour += 12;
  if (/中午/u.test(meridiem) && hour < 11) hour += 12;
  if (/凌晨|早上|清晨|上午|今早|明早/u.test(meridiem) && hour === 12) hour = 0;
  if (hour === 24 && minute !== 0) return {error: '24点只能表示整点', explicitDate: parsedDate.explicit};
  if (hour < 0 || hour > 24) return {error: '时间必须在 00:00—24:00 之间', explicitDate: parsedDate.explicit};
  let date = parsedDate.date;
  if (hour === 24) {
    date = shiftDate(date, 1);
    hour = 0;
  }
  return {iso: `${date}T${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00${TIME_OFFSET}`, date, explicitDate: parsedDate.explicit};
}

function activityCategory(text: string): {categoryId?: string; error?: string} {
  const value = text.trim().replace(/^[：:，,、\s]+|[：:，,、\s]+$/gu, '');
  if (!value) return {error: '缺少活动名称，请补充“学习/睡觉”等活动'};
  const hit = ACTIVITY_MAP.find(([pattern]) => pattern.test(value));
  if (hit) return {categoryId: hit[1]};
  if (/^[a-z][a-z0-9_-]*$/iu.test(value) && TIME_CATEGORY_IDS.includes(value as (typeof TIME_CATEGORY_IDS)[number])) return {categoryId: value};
  return {error: `无法判断活动分类“${value}”，请在预览中选择分类后再保存`};
}

function previewFrom(items: ImportCandidate[], issues: ImportIssue[], source: string): ImportPreview {
  return {
    items,
    candidates: items,
    issues,
    errors: issues.filter((item) => item.level === 'error').map((item) => item.message),
    warnings: issues.filter((item) => item.level === 'warning').map((item) => item.message),
    source,
  };
}

/** Parse a single explicit Chinese time range. It never saves anything. */
export function parseChineseTime(text: string, now?: Date | string): ParseChineseTimeResult {
  const source = 'chinese-text';
  const original = text;
  const issues: ImportIssue[] = [];
  const items: ImportCandidate[] = [];
  if (!text || !text.trim()) {
    issues.push(issue('error', 'empty_text', '请输入时间段，例如“今天14:10到15:35学习”'));
    return {...previewFrom(items, issues, source), ok: false, text: original};
  }
  let baseDate: string;
  try {
    baseDate = dateFromNow(normalizeNow(now));
  } catch (cause) {
    issues.push(issue('error', 'invalid_now', cause instanceof Error ? cause.message : '当前时间无效'));
    return {...previewFrom(items, issues, source), ok: false, text: original};
  }
  const matches = [...text.matchAll(TIME_TOKEN_RE)];
  if (matches.length < 2) {
    issues.push(issue('error', 'missing_endpoint', matches.length === 0 ? '未识别到开始和结束时间' : '缺少结束时间，请使用“开始到结束”活动格式'));
    return {...previewFrom(items, issues, source), ok: false, text: original};
  }
  const first = matches[0];
  const second = matches[1];
  const startText = first[0];
  const endText = second[0];
  const activity = `${text.slice(0, first.index ?? 0)} ${text.slice((second.index ?? 0) + endText.length)}`.replace(/(?:从|到|至|~|～|—|-)\s*/gu, ' ').trim();
  const startParts = endpointParts(startText);
  const endParts = endpointParts(endText);
  if ('error' in startParts) issues.push(issue('error', 'invalid_start', startParts.error));
  if ('error' in endParts) issues.push(issue('error', 'invalid_end', endParts.error));
  if ('error' in startParts || 'error' in endParts) return {...previewFrom(items, issues, source), ok: false, text: original};
  const start = canonicalEndpoint(startParts, baseDate);
  // A relative end label such as “今天” is relative to the user's current
  // date, while an omitted end date inherits the start date.  Passing the
  // start date unconditionally would turn “昨晚…到今天…” into the same day.
  const end = canonicalEndpoint(endParts, endParts.dateLabel ? baseDate : (start.date ?? baseDate));
  if (!start.iso || start.error) issues.push(issue('error', 'invalid_start', start.error ?? '开始时间无效'));
  if (!end.iso || end.error) issues.push(issue('error', 'invalid_end', end.error ?? '结束时间无效'));
  const category = activityCategory(activity);
  if (category.error) issues.push(issue('error', 'missing_or_ambiguous_activity', category.error));
  if (issues.length || !start.iso || !end.iso || !category.categoryId) return {...previewFrom(items, issues, source), ok: false, text: original};
  const startTime = Date.parse(start.iso);
  const endTime = Date.parse(end.iso);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    issues.push(issue('error', 'invalid_range', '结束时间必须晚于开始时间；跨午夜请明确写出“今天/明天”等日期'));
    return {...previewFrom(items, issues, source), ok: false, text: original};
  }
  const item: ImportCandidate = {
    start: start.iso,
    end: end.iso,
    categoryId: category.categoryId,
    note: activity,
    sourceKey: `chinese-time:${fnv1a(original.trim())}`,
    kind: 'actual',
  };
  items.push(item);
  return {...previewFrom(items, issues, source), ok: true, text: original};
}

export function categoryIdFromLabel(value: string): string | undefined {
  return activityCategory(value).categoryId;
}

function pickValue(row: Record<string, unknown> | readonly unknown[], key: string | number | undefined, headers?: string[]): string {
  if (typeof key === 'number') {
    if (Array.isArray(row)) return asText((row as readonly unknown[])[key]);
    const header = headers?.[key];
    return header ? asText((row as Record<string, unknown>)[header]) : '';
  }
  if (typeof key === 'string') {
    if (Array.isArray(row) && headers) {
      const index = headers.findIndex((header) => normalizedKey(header) === normalizedKey(key));
      if (index >= 0) return asText((row as readonly unknown[])[index]);
    }
    return Array.isArray(row) ? '' : asText((row as Record<string, unknown>)[key]);
  }
  return '';
}

function inferColumn(headers: string[], aliases: string[]): string | number | undefined {
  const keys = headers.map(normalizedKey);
  const exact = keys.findIndex((header) => aliases.some((alias) => header === normalizedKey(alias)));
  if (exact >= 0) return exact;
  const index = keys.findIndex((header) => aliases.some((alias) => header.includes(normalizedKey(alias))));
  return index >= 0 ? index : undefined;
}

function rowAsRecord(row: Record<string, unknown> | readonly unknown[], headers: string[]): Record<string, unknown> {
  if (!Array.isArray(row)) return row as Record<string, unknown>;
  return Object.fromEntries(headers.map((header, index) => [header, (row as readonly unknown[])[index] ?? '']));
}

function parseDateCell(value: string, options: TimetableNormalizeOptions): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (/^非本周|非本周/u.test(text)) return undefined;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/u.test(text)) {
    const [year, month, day] = text.split('-').map(Number);
    try { return dateString(year, month, day); } catch { return undefined; }
  }
  const full = text.match(DATE_RE);
  if (full) {
    try { return dateString(Number(full[1]), Number(full[2]), Number(full[3])); } catch { return undefined; }
  }
  const monthDay = text.match(MONTH_DAY_RE);
  if (monthDay) {
    const year = options.weekStart?.slice(0, 4) ?? options.semester?.startDate?.slice(0, 4);
    if (!year) return undefined;
    try { return dateString(Number(year), Number(monthDay[1]), Number(monthDay[2])); } catch { return undefined; }
  }
  if (options.dateByWeekday) return options.dateByWeekday[text.replace(/周|星期/u, '')] ?? options.dateByWeekday[text];
  return undefined;
}

function parseTime(value: string): string | undefined {
  const text = value.trim();
  const match = text.match(/^(\d{1,2})(?::|：|点)(\d{1,2})?(?:分)?$/u);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour > 23 || minute > 59) return undefined;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function periodIndexes(value: string): number[] {
  const text = value.replace(/第|节|课/gu, '').trim();
  const matches = [...text.matchAll(/\d+/gu)].map((match) => Number(match[0])).filter(Number.isInteger);
  if (matches.length === 2 && matches[1] >= matches[0]) return Array.from({length: matches[1] - matches[0] + 1}, (_, index) => matches[0] + index);
  return matches.slice(0, 1);
}

function resolvePeriodRange(value: string, periods: readonly TimetablePeriod[] | undefined): {start?: string; end?: string; error?: string} {
  if (!periods?.length) return {error: '缺少节次时间表；请提供每节课开始/结束时间，不能把整段课程块当作授课时长'};
  const indexes = periodIndexes(value);
  if (!indexes.length) return {error: `无法识别节次“${value}”`};
  const selected = indexes.map((index) => periods.find((period) => period.index === index));
  if (selected.some((period) => !period)) return {error: `节次“${value}”不在已提供的节次表中`};
  return {start: selected[0]?.start, end: selected[selected.length - 1]?.end};
}

type TimetableInput = readonly (Record<string, unknown> | readonly unknown[])[] | {rows: readonly (Record<string, unknown> | readonly unknown[])[]; headers?: string[]};

function isTimetableRows(input: TimetableInput): input is readonly (Record<string, unknown> | readonly unknown[])[] {
  return Array.isArray(input);
}

/** Normalize manually mapped table rows or OCR-corrected rows into plan items. */
export function normalizeTimetable(
  input: TimetableInput,
  options: TimetableNormalizeOptions = {},
): TimetableNormalizeResult {
  const source = options.source ?? 'timetable';
  if (options.semester) return normalizeSemesterTimetable(input, options);
  const issues: ImportIssue[] = [];
  const items: ImportCandidate[] = [];
  const skippedRows: number[] = [];
  let rows: readonly (Record<string, unknown> | readonly unknown[])[];
  let providedHeaders: string[] | undefined;
  if (isTimetableRows(input)) {
    rows = input;
    providedHeaders = undefined;
  } else {
    rows = input.rows;
    providedHeaders = input.headers;
  }
  const firstArray = Array.isArray(rows[0]) ? (rows[0] as readonly unknown[]) : undefined;
  const headers = providedHeaders ?? (firstArray ? firstArray.map(asText) : (rows[0] && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : []));
  const dataRows = firstArray && !providedHeaders ? rows.slice(1) : rows;
  const map:TimetableColumnMap = {
    date: inferColumn(headers, ['日期', 'date', '上课日期']),
    weekday: inferColumn(headers, ['星期', '周几', 'weekday']),
    period: inferColumn(headers, ['节次', '课次', 'period']),
    course: inferColumn(headers, ['课程', '课程名称', '科目', 'course', 'title']),
    note: inferColumn(headers, ['备注', '地点', '教室', 'note']),
    week: inferColumn(headers, ['周次', 'week', '范围']),
    start: inferColumn(headers, ['开始', '开始时间', 'start']),
    end: inferColumn(headers, ['结束', '结束时间', 'end']),
    ...options.columnMap,
  } satisfies TimetableColumnMap;
  const periods = options.periods;
  const weekStart = options.weekStart ? parseDateCell(options.weekStart, options) : undefined;
  const weekEnd = options.weekEnd ? parseDateCell(options.weekEnd, options) : (weekStart ? shiftDate(weekStart, 6) : undefined);
  if (options.weekStart && !weekStart) issues.push(issue('error', 'invalid_week_start', '当前周起始日期无效'));
  if (options.weekEnd && !weekEnd) issues.push(issue('error', 'invalid_week_end', '当前周结束日期无效'));
  dataRows.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + (firstArray && !providedHeaders ? 2 : 1);
    const record = rowAsRecord(row as Record<string, unknown> | readonly unknown[], headers);
    const get = (field: keyof TimetableColumnMap) => pickValue(record, map[field], headers);
    const weekLabel = get('week');
    if (record.nonCurrentWeek === true || /非本周/u.test(weekLabel) || /非本周/u.test(Object.values(record).map(asText).join(' '))) {
      skippedRows.push(sourceRow);
      return;
    }
    const dateValue = get('date') || get('weekday');
    const date = parseDateCell(dateValue, options);
    if (!date) {
      issues.push(issue('error', 'date_missing_or_ambiguous', `第 ${sourceRow} 行缺少明确日期，未猜测学期周次`, {row: sourceRow}));
      return;
    }
    if (weekStart && weekEnd && (date < weekStart || date > weekEnd)) {
      skippedRows.push(sourceRow);
      return;
    }
    const course = get('course');
    if (!course) {
      issues.push(issue('warning', 'course_empty', `第 ${sourceRow} 行没有课程名称，已跳过`, {row: sourceRow}));
      skippedRows.push(sourceRow);
      return;
    }
    const directStart = parseTime(get('start'));
    const directEnd = parseTime(get('end'));
    const range = directStart && directEnd ? {start: directStart, end: directEnd} : resolvePeriodRange(get('period'), periods);
    if (!range.start || !range.end) {
      issues.push(issue('error', 'period_time_missing', `第 ${sourceRow} 行无法按准确节次拆分：${range.error ?? '缺少开始/结束时间'}`, {row: sourceRow}));
      return;
    }
    const segments = directStart && directEnd ? [{index:get('period')||directStart,start:directStart,end:directEnd}] : periodIndexes(get('period')).map(index=>periods!.find(p=>p.index===index)!);
    for(const segment of segments){
      const sourceKey = 'timetable:'+fnv1a(source+':'+date+':'+segment.index);
      items.push({start:date+'T'+segment.start+':00'+TIME_OFFSET,end:date+'T'+segment.end+':00'+TIME_OFFSET,categoryId:'class',note:[course,get('note')].filter(Boolean).join(' · '),sourceKey,kind:'plan'});
    }
  });
  const deduped = [...new Map(items.map((item) => [item.sourceKey, item])).values()];
  return {...previewFrom(deduped, issues, source), skippedRows};
}

export const normalizeTimetableRows = normalizeTimetable;
export const normalizeCourseSchedule = normalizeTimetable;

function normalizeOcrBlock(value: unknown, index: number): OcrBlock | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const text = asText(source.text);
  if (!text) return undefined;
  const box = source.bbox && typeof source.bbox === 'object' ? source.bbox as Record<string, unknown> : undefined;
  const x0 = Number(box?.x0 ?? box?.left ?? 0);
  const y0 = Number(box?.y0 ?? box?.top ?? 0);
  const x1 = Number(box?.x1 ?? box?.right ?? x0);
  const y1 = Number(box?.y1 ?? box?.bottom ?? y0);
  return {text, words:Array.isArray(source.words)?source.words.map(normalizeOcrBlock).filter((x):x is OcrBlock=>Boolean(x)):undefined, confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : undefined, bbox: {x0, y0, x1, y1}, blockId: asText(source.blockId) || `ocr-${index}`};
}

function flattenOcrGeometry(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  // Tesseract 5/6 returns blocks -> paragraphs -> lines -> words. Lines are
  // the useful unit for course placement; words are used only when a line is
  // absent. This avoids treating one full-page block as one course.
  if (Array.isArray(record.paragraphs) && record.paragraphs.length) return record.paragraphs.flatMap(flattenOcrGeometry);
  if (Array.isArray(record.lines) && record.lines.length) return record.lines;
  if (Array.isArray(record.words) && record.words.length) return record.words;
  return [value];
}

/** Convert a Tesseract.js result or injected worker output into position blocks. */
export function normalizeTimetableOcrResult(value: unknown): TimetableOcrResult {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const data = source.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : source;
  const rawBlocks = Array.isArray(data.blocks) ? data.blocks : Array.isArray(data.lines) ? data.lines : [];
  const blocks = rawBlocks.flatMap(flattenOcrGeometry).map(normalizeOcrBlock).filter((block): block is OcrBlock => Boolean(block));
  const text = asText(data.text) || blocks.map((block) => block.text).join('\n');
  const issues: ImportIssue[] = [];
  if (!blocks.length && !text) issues.push(issue('error', 'ocr_empty', 'OCR 没有识别到文字；请提高截图清晰度并逐项校对'));
  return {text, blocks, regions:Array.isArray(data.regions)?data.regions.map(normalizeOcrBlock).filter((x):x is OcrBlock=>Boolean(x)):undefined, issues};
}

export type TimetableOcrRecognizer = (image: Blob | ArrayBuffer | Uint8Array) => Promise<unknown>;

/** Run an injected browser OCR worker. Tesseract.js is intentionally optional. */
export async function recognizeTimetableImage(image: Blob | ArrayBuffer | Uint8Array, recognize: TimetableOcrRecognizer): Promise<TimetableOcrResult> {
  try {
    return normalizeTimetableOcrResult(await recognize(image));
  } catch (cause) {
    return {text: '', blocks: [], issues: [issue('error', 'ocr_failed', `浏览器 OCR 失败：${cause instanceof Error ? cause.message : String(cause)}`)]};
  }
}

function parseDelimitedText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function bytesToText(bytes: ArrayBuffer | Uint8Array): string {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new TextDecoder('utf-8', {fatal: false}).decode(value).replace(/^\uFEFF/u, '');
}

/** Parse CSV/TSV/JSON content without installing a spreadsheet package. */
export function parseTimetableContent(content: string, options: TimetableNormalizeOptions & {format?: string} = {}): FileImportResult {
  const format = (options.format ?? '').toLowerCase();
  const trimmed = content.trim();
  let rows: readonly (Record<string, unknown> | readonly unknown[])[];
  let actualFormat: FileImportResult['format'] = format === 'tsv' ? 'tsv' : format === 'json' ? 'json' : 'csv';
  if (format === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    actualFormat = 'json';
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) rows = parsed as readonly (Record<string, unknown> | readonly unknown[])[];
      else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as {rows?: unknown}).rows)) rows = (parsed as {rows: readonly (Record<string, unknown> | readonly unknown[])[]}).rows;
      else rows = [parsed as Record<string, unknown>];
    } catch {
      return {...normalizeTimetable([], {...options, source: options.source ?? 'timetable-json'}), format: actualFormat, issues: [issue('error', 'invalid_json', 'JSON 课表文件无法解析')], errors: ['JSON 课表文件无法解析']};
    }
  } else {
    const delimiter = format === 'tsv' || (!format && trimmed.split('\n', 1)[0].includes('\t')) ? '\t' : ',';
    actualFormat = delimiter === '\t' ? 'tsv' : 'csv';
    rows = parseDelimitedText(content, delimiter);
  }
  const result = normalizeTimetable(rows, options);
  return {...result, format: actualFormat};
}

export async function parseTimetableFile(file: FileLikeImport, options: TimetableNormalizeOptions = {}): Promise<FileImportResult> {
  const name = file.name ?? '';
  const extension = name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'xlsx' || extension === 'xls') {
    const result = normalizeTimetable([], {...options, source: options.source ?? name});
    const xlsxIssue = issue('error', 'xlsx_dependency_missing', 'Excel 文件需要在浏览器构建中注入可选的 xlsx 解析器；请先解析预览，不会自动提交。');
    return {...result, format: extension, issues: [...result.issues, xlsxIssue], errors: [...result.errors, xlsxIssue.message]};
  }
  const text = file.text ?? (file.bytes ? bytesToText(file.bytes) : '');
  return parseTimetableContent(text, {...options, format: extension || (options.source ?? ''), source: options.source ?? (name || 'timetable-file')});
}

function recordValue(record: Record<string, unknown>, aliases: string[]): string {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const key = normalizedKey(alias);
    const entry = entries.find(([name]) => normalizedKey(name) === key || normalizedKey(name).includes(key));
    if (entry) return asText(entry[1]);
  }
  return '';
}

function parseGarminDate(value: unknown, preferUtc = false): string | undefined {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/u.test(value.trim()))) {
    const number = Number(value);
    const milliseconds = number < 100_000_000_000 ? number * 1000 : number;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : formatInstant(date);
  }
  const text = asText(value);
  if (!text) return undefined;
  const isoText = text.includes('T') ? text : text.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(isoText) ? isoText : `${isoText}${preferUtc ? 'Z' : TIME_OFFSET}`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? undefined : formatInstant(date);
}

function formatInstant(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'}).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${TIME_OFFSET}`;
}

function garminRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['sleepData', 'sleep', 'records', 'items', 'data']) {
      if (Array.isArray(record[key])) return garminRecords(record[key]);
    }
    return [record];
  }
  return [];
}

function garminStageIntervals(record: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ['sleepLevels', 'sleepStages', 'levels', 'stages']) {
    if (Array.isArray(record[key])) return garminRecords(record[key]);
  }
  return [];
}

/** Parse Garmin sleep JSON/CSV exports into actual sleep candidates. */
export function parseGarminFile(input: string | Record<string, unknown> | readonly Record<string, unknown>[], options: {name?: string; source?: string} = {}): GarminImportResult {
  const source = options.source ?? options.name ?? 'garmin-file';
  const issues: ImportIssue[] = [];
  let value: unknown = input;
  let format: GarminImportResult['format'] = 'json';
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      issues.push(issue('error', 'empty_garmin_file', 'Garmin 文件为空'));
      return {...previewFrom([], issues, source), format: 'unknown', recordsRead: 0, recordsSkipped: 0};
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { value = JSON.parse(trimmed); } catch { issues.push(issue('error', 'invalid_garmin_json', 'Garmin JSON 无法解析')); return {...previewFrom([], issues, source), format: 'json', recordsRead: 0, recordsSkipped: 0}; }
      format = 'json';
    } else if (/^(?:PK|\xD0\xCF)/u.test(trimmed)) {
      issues.push(issue('error', 'binary_garmin_file', '二进制 FIT/Excel 文件不能用文本解析器读取，请在本机导出 CSV/JSON 或注入对应解析器'));
      return {...previewFrom([], issues, source), format: 'fit', recordsRead: 0, recordsSkipped: 0};
    } else {
      const rows = parseDelimitedText(trimmed, trimmed.split('\n', 1)[0].includes('\t') ? '\t' : ',');
      value = rows.slice(1).map((row) => Object.fromEntries((rows[0] ?? []).map((header, index) => [header, row[index] ?? ''])));
      format = 'csv';
    }
  }
  const records = garminRecords(value);
  const items: ImportCandidate[] = [];
  let recordsSkipped = 0;
  records.forEach((record, index) => {
    const dto=(record.dailySleepDTO&&typeof record.dailySleepDTO==='object'?record.dailySleepDTO:record) as Record<string,unknown>;
    const begin=parseGarminDate(dto.sleepStartTimestampGMT,true),finish=parseGarminDate(dto.sleepEndTimestampGMT,true);
    if(dto.napTimeSeconds)issues.push(issue('warning','nap_no_window','午睡只有总时长，没有起止时间，未生成区间',{row:index+1}));
    if(begin&&finish&&Date.parse(finish)>Date.parse(begin)){
      const from=Date.parse(begin),to=Date.parse(finish);
      const stages=garminStageIntervals(record).map(stage=>({start:Date.parse(parseGarminDate(stage.startGMT,true)||''),end:Date.parse(parseGarminDate(stage.endGMT,true)||''),code:Number(stage.activityLevel)})).filter(stage=>stage.end>from&&stage.start<to).map(stage=>({...stage,start:Math.max(from,stage.start),end:Math.min(to,stage.end)})).sort((a,b)=>a.start-b.start);
      const sums=[0,0,0,0];let cursor=from;let valid=stages.length>0;
      for(const stage of stages){if(!Number.isInteger(stage.code)||stage.code<0||stage.code>3||stage.end<=stage.start||Math.abs(stage.start-cursor)>1000){valid=false;continue;}sums[stage.code]+=(stage.end-stage.start)/1000;cursor=stage.end;}
      valid=valid&&Math.abs(cursor-to)<=1000&&['deepSleepSeconds','lightSleepSeconds','remSleepSeconds','awakeSleepSeconds'].every((field,code)=>typeof dto[field]==='number'&&Math.abs(sums[code]-Number(dto[field]))<=1);
      const spans:{start:number;end:number}[]=[];
      if(valid){for(const stage of stages){if(stage.code===3)continue;const last=spans.at(-1);if(last&&last.end===stage.start)last.end=stage.end;else spans.push({start:stage.start,end:stage.end});}}
      else{spans.push({start:from,end:to});issues.push(issue('warning','awake_positions_unverified','清醒位置未核实，仅预览设备睡眠窗口估计',{row:index+1}));}
      const date=asText(dto.calendarDate)||formatInstant(new Date(to)).slice(0,10);
      spans.forEach((span,i)=>items.push({start:formatInstant(new Date(span.start)),end:formatInstant(new Date(span.end)),categoryId:'sleep',note:valid?'Garmin 睡眠（已排除清醒）':'Garmin 睡眠窗口估计（清醒位置未核实）',sourceKey:'garmin:cn:'+date+':sleep:'+i,kind:'actual',estimated:!valid}));
      return;
    }
    const stages=garminStageIntervals(record);
    const candidates=stages.length?stages:[record];let produced=false;
    candidates.forEach((part,partIndex)=>{
      const label=recordValue(part,['sleepStage','stage','state','type','name','label']).toLowerCase();
      if(/awake|wake|清醒/u.test(label))return;
      if(stages.length&&!/sleep|light|deep|rem|睡/u.test(label)){issues.push(issue('warning','unknown_stage','未知睡眠阶段，未猜测是否清醒',{row:index+1}));return;}
      const startGMT=part.sleepStartTimestampGMT??part.startTimeGMT??part.startGMT;
      const endGMT=part.sleepEndTimestampGMT??part.endTimeGMT??part.endGMT;
      const start=parseGarminDate(startGMT??recordValue(part,['startTimeLocal','startLocal','startTime','start']),startGMT!=null);
      const end=parseGarminDate(endGMT??recordValue(part,['endTimeLocal','endLocal','endTime','end']),endGMT!=null);
      if(!start||!end||Date.parse(end)<=Date.parse(start)){recordsSkipped++;return;}
      const sourceKey='garmin:file:'+fnv1a(source+':'+index+':'+partIndex+':'+start);
      items.push({start,end,categoryId:'sleep',note:'Garmin 睡眠文件区间',sourceKey,kind:'actual'});produced=true;
    });
    if(!produced)recordsSkipped++;
  });
  const deduped = [...new Map(items.map((item) => [item.sourceKey, item])).values()];
  if (!deduped.length && !issues.some((item) => item.level === 'error')) issues.push(issue('warning', 'garmin_no_intervals', '文件中没有可用的睡眠起止区间；仅有总时长不会被编造成点阵'));
  return {...previewFrom(deduped, issues, source), format, recordsRead: records.length, recordsSkipped};
}

export function parseGarminContent(content: string, options: {name?: string; source?: string} = {}): GarminImportResult {
  return parseGarminFile(content, options);
}

export async function parseGarminBlob(file: FileLikeImport): Promise<GarminImportResult> {
  const content = file.text ?? (file.bytes ? bytesToText(file.bytes) : '');
  return parseGarminFile(content, {name: file.name});
}

const SEMESTER_MAX_WEEK = 30;

function parseDateOnly(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  try {
    return dateString(year, month, day) === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function isShanghaiMonday(value: string): boolean {
  const date = parseDateOnly(value);
  return Boolean(date && new Date(`${date}T00:00:00+08:00`).getUTCDay() === 0);
}

function validPeriodTable(periods: readonly TimetablePeriod[]): string | undefined {
  const indexes = new Set<number>();
  for (const period of periods) {
    if (!Number.isInteger(period.index) || period.index < 1 || indexes.has(period.index)) return '节次表中的编号必须是从 1 开始且不能重复';
    const start = parseTime(asText(period.start));
    const end = parseTime(asText(period.end));
    if (!start || !end || start >= end) return `第 ${period.index} 节的开始/结束时间无效`;
    indexes.add(period.index);
  }
  return undefined;
}

/** Validate the same fields that the semester UI submits. */
export function validateSemesterContext(context: TimetableNormalizeOptions['semester']): ImportIssue[] {
  if (!context) return [issue('error', 'semester_context_missing', '学期批量导入需要第一周周一、开始周次、结束周次、单双周和节次表，缺失时不会猜测')];

  const missing: string[] = [];
  if (!context.startDate) missing.push('第一周周一');
  if (context.fromWeek === undefined) missing.push('开始周次');
  if (context.toWeek === undefined) missing.push('结束周次');
  if (!context.parity) missing.push('单双周');
  if (!context.periods?.length) missing.push('节次表');
  if (missing.length) {
    return [issue('error', 'semester_context_missing', `学期批量导入缺少：${missing.join('、')}；不会猜测重复规则`)];
  }

  const problems: ImportIssue[] = [];
  if (!isShanghaiMonday(context.startDate!)) {
    problems.push(issue('error', 'semester_start_invalid', '第一周周一必须是有效的 YYYY-MM-DD 日期，并且必须落在星期一'));
  }
  const first = context.fromWeek!;
  const last = context.toWeek!;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || first > SEMESTER_MAX_WEEK || last < 1 || last > SEMESTER_MAX_WEEK) {
    problems.push(issue('error', 'semester_week_range_invalid', `开始/结束周次必须是 1—${SEMESTER_MAX_WEEK} 的整数`));
  } else if (first > last) {
    problems.push(issue('error', 'semester_week_range_invalid', '结束周次必须大于或等于开始周次'));
  }
  if (!['all', 'odd', 'even'].includes(context.parity!)) {
    problems.push(issue('error', 'semester_parity_invalid', '单双周只能选择每周、单周或双周'));
  }
  const periodError = validPeriodTable(context.periods!);
  if (periodError) problems.push(issue('error', 'semester_periods_invalid', periodError));
  return problems;
}

type SemesterWeekSelector =
  | {kind: 'all'}
  | {kind: 'exclude'}
  | {kind: 'set'; weeks: number[]}
  | {kind: 'invalid'};

function parseSemesterWeekSelector(value: string): SemesterWeekSelector {
  const text = value.trim();
  if (!text) return {kind: 'all'};
  if (/非本周/u.test(text)) return {kind: 'exclude'};
  const compact = text.replace(/\s+/gu, '');
  if (/^(?:每周|全周|全部|所有|不限)$/u.test(compact)) return {kind: 'all'};
  if (/^单周$/u.test(compact)) return {kind: 'set', weeks: Array.from({length: 15}, (_, index) => index * 2 + 1)};
  if (/^双周$/u.test(compact)) return {kind: 'set', weeks: Array.from({length: 15}, (_, index) => index * 2 + 2)};

  const normalized = compact
    .replace(/[第周]/gu, '')
    .replace(/[至到~～—–]/gu, '-')
    .replace(/[；;]/gu, ',');
  if (!/^\d+(?:(?:-\d+)|(?:[、,，/]\d+))*$/u.test(normalized)) return {kind: 'invalid'};

  const weeks = new Set<number>();
  for (const token of normalized.split(/[、,，/]/u)) {
    const values = token.split('-').map(Number);
    if (values.length > 2) return {kind: 'invalid'};
    const start = values[0];
    const end = values[1] ?? start;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > SEMESTER_MAX_WEEK) return {kind: 'invalid'};
    for (let week = start; week <= end; week += 1) weeks.add(week);
  }
  return weeks.size ? {kind: 'set', weeks: [...weeks].sort((a, b) => a - b)} : {kind: 'invalid'};
}

function semesterRows(input: TimetableInput, options: TimetableNormalizeOptions): {
  rows: Array<{record: Record<string, unknown>; sourceRow: number; selector: SemesterWeekSelector; weekLabel: string}>;
  map: TimetableColumnMap;
} {
  const sourceRows = isTimetableRows(input) ? input : input.rows;
  const providedHeaders = isTimetableRows(input) ? undefined : input.headers;
  const firstArray = Array.isArray(sourceRows[0]) ? sourceRows[0] as readonly unknown[] : undefined;
  const headers = providedHeaders ?? (firstArray ? firstArray.map(asText) : (sourceRows[0] && !Array.isArray(sourceRows[0]) ? Object.keys(sourceRows[0]) : []));
  const dataRows = firstArray && !providedHeaders ? sourceRows.slice(1) : sourceRows;
  const map: TimetableColumnMap = {
    date: inferColumn(headers, ['日期', 'date', '上课日期']),
    weekday: inferColumn(headers, ['星期', '周几', 'weekday']),
    period: inferColumn(headers, ['节次', '课次', 'period']),
    course: inferColumn(headers, ['课程', '课程名称', '科目', 'course', 'title']),
    note: inferColumn(headers, ['备注', '地点', '教室', 'note']),
    week: inferColumn(headers, ['周次', 'week', '范围']),
    start: inferColumn(headers, ['开始', '开始时间', 'start']),
    end: inferColumn(headers, ['结束', '结束时间', 'end']),
    ...options.columnMap,
  };
  const rows: Array<{record: Record<string, unknown>; sourceRow: number; selector: SemesterWeekSelector; weekLabel: string}> = [];
  dataRows.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + (firstArray && !providedHeaders ? 2 : 1);
    const record = rowAsRecord(row as Record<string, unknown> | readonly unknown[], headers);
    const weekLabel = pickValue(record, map.week, headers);
    const selector = parseSemesterWeekSelector(weekLabel);
    rows.push({record, sourceRow, selector, weekLabel});
  });
  return {rows, map};
}

export function normalizeSemesterTimetable(input: TimetableInput, options: TimetableNormalizeOptions): TimetableNormalizeResult {
  const source = options.source ?? 'timetable-semester';
  const contextIssues = validateSemesterContext(options.semester);
  if (contextIssues.length) return {...previewFrom([], contextIssues, source), skippedRows: []};

  const cfg = options.semester!;
  const first = cfg.fromWeek!;
  const last = cfg.toWeek!;
  const selectedWeeks = Array.from({length: last - first + 1}, (_, index) => first + index)
    .filter((week) => cfg.parity === 'all' || (cfg.parity === 'odd' ? week % 2 === 1 : week % 2 === 0));
  const prepared = semesterRows(input, options);
  const items: ImportCandidate[] = [];
  const issueMap = new Map<string, ImportIssue>();
  const skippedRows = new Set<number>();
  const addIssue = (value: ImportIssue) => {
    const normalized = value.row === undefined ? value : {...value};
    const key = `${normalized.level}:${normalized.code}:${normalized.row ?? ''}:${normalized.message}`;
    if (!issueMap.has(key)) issueMap.set(key, normalized);
  };

  for (const row of prepared.rows) {
    const values = Object.values(row.record).map(asText).join(' ');
    if (row.record.nonCurrentWeek === true || /非本周/u.test(values) || row.selector.kind === 'exclude') {
      skippedRows.add(row.sourceRow);
      continue;
    }
    if (row.selector.kind === 'invalid') {
      addIssue(issue('error', 'semester_week_unrecognized', `第 ${row.sourceRow} 行的周次“${row.weekLabel}”无法识别，请改为如“1-2周”“单周”或“每周”后再导入`, {row: row.sourceRow}));
      skippedRows.add(row.sourceRow);
      continue;
    }
    const selectorWeeks = row.selector.kind === 'set' ? row.selector.weeks : undefined;
    const rowWeeks = selectorWeeks
      ? selectedWeeks.filter((week) => selectorWeeks.includes(week))
      : selectedWeeks;
    if (!rowWeeks.length) {
      skippedRows.add(row.sourceRow);
      continue;
    }
    for (const week of rowWeeks) {
      const monday = shiftDate(cfg.startDate!, (week - 1) * 7);
      const weekdays: Record<string, string> = {};
      ['一', '二', '三', '四', '五', '六', '日'].forEach((day, index) => {
        weekdays[day] = shiftDate(monday, index);
        weekdays[String(index + 1)] = shiftDate(monday, index);
      });
      const result = normalizeTimetable([row.record], {
        ...options,
        semester: undefined,
        weekStart: monday,
        weekEnd: shiftDate(monday, 6),
        periods: cfg.periods,
        dateByWeekday: weekdays,
        columnMap: {...prepared.map, date: '__use_explicit_weekday__'},
      });
      items.push(...result.items);
      for (const value of result.issues) addIssue(value.row === undefined ? {...value, row: row.sourceRow} : {...value, row: row.sourceRow});
      if (result.skippedRows.length) skippedRows.add(row.sourceRow);
    }
  }

  const deduped = [...new Map(items.map((item) => [item.sourceKey, item])).values()];
  return {...previewFrom(deduped, [...issueMap.values()], source), skippedRows: [...skippedRows].sort((a, b) => a - b)};
}
