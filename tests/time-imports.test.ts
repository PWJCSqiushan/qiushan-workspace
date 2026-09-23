import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTimetable,
  normalizeTimetableOcrResult,
  parseChineseTime,
  parseGarminFile,
  parseTimetableContent,
  validateSemesterContext,
  type TimetablePeriod,
} from '../lib/time-imports.ts';

const periods: TimetablePeriod[] = [
  {index: 1, start: '08:00', end: '08:45'},
  {index: 2, start: '08:55', end: '09:40'},
  {index: 3, start: '10:00', end: '10:45'},
];

void test('parses an 85-minute Chinese time range with an explicit Shanghai offset', () => {
  const result = parseChineseTime('今天14:10到15:35学习', '2026-09-23T09:00:00Z');
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].start, '2026-09-23T14:10:00+08:00');
  assert.equal(result.items[0].end, '2026-09-23T15:35:00+08:00');
  assert.equal(Date.parse(result.items[0].end) - Date.parse(result.items[0].start), 85 * 60 * 1000);
  assert.equal(result.items[0].categoryId, 'study');
});

void test('keeps an explicit cross-midnight sleep interval', () => {
  const result = parseChineseTime('昨晚23:50到今天7:10睡觉', '2026-09-23T02:00:00Z');
  assert.equal(result.ok, true);
  assert.equal(result.items[0].start, '2026-09-22T23:50:00+08:00');
  assert.equal(result.items[0].end, '2026-09-23T07:10:00+08:00');
  assert.equal(result.items[0].categoryId, 'sleep');
});

void test('does not guess missing endpoints or unknown activity labels', () => {
  const missing = parseChineseTime('今天14:10学习', '2026-09-23T02:00:00Z');
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /结束时间/);
  const unknown = parseChineseTime('今天14:10到15:35逛校园', '2026-09-23T02:00:00Z');
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join(' '), /无法判断活动分类/);
});

void test('normalizes timetable periods while excluding non-current-week rows and preserving breaks', () => {
  const result = normalizeTimetable([
    {date: '2026-09-23', period: '1-2', course: '数据结构', note: 'A101', week: '第3周'},
    {date: '2026-09-23', period: '3', course: '非本周课程', note: '', week: '非本周'},
    {date: '2026-09-28', period: '1', course: '下周课程', note: '', week: '第4周'},
  ], {source: 'test', weekStart: '2026-09-21', weekEnd: '2026-09-27', periods});
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].kind, 'plan');
  assert.equal(result.items[0].start, '2026-09-23T08:00:00+08:00');
  assert.equal(result.items[0].end, '2026-09-23T08:45:00+08:00');
  assert.equal(result.items[1].start, '2026-09-23T08:55:00+08:00');
  assert.equal(result.items[1].end, '2026-09-23T09:40:00+08:00');
  assert.equal(result.skippedRows.length, 2);
  assert.equal(result.items[0].note, '数据结构 · A101');
});

void test('requires explicit semester recurrence context instead of inventing odd/even weeks', () => {
  const issues = validateSemesterContext({startDate: '2026-09-07', fromWeek: 1, toWeek: 2, parity: undefined, periods});
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /单双周/);
  const result = normalizeTimetable([{date: '2026-09-23', period: '1', course: '课'}], {semester: {fromWeek: 1, toWeek: 2, periods}});
  assert.ok(result.errors.some((message) => /学期批量导入/.test(message)));
});

void test('expands explicit row week ranges and empty week cells without importing breaks', () => {
  const result = normalizeTimetable([
    {weekday: '三', week: '1-2周', period: '1-2', course: '一二周课'},
    {weekday: '四', week: '3-4周', period: '3', course: '三四周课'},
    {weekday: '五', week: '单周', period: '1', course: '单周课'},
    {weekday: '六', week: '', period: '2', course: '每周课'},
  ], {
    semester: {startDate: '2026-09-07', fromWeek: 1, toWeek: 4, parity: 'all', periods},
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.items.length, 12);
  assert.equal(result.items.filter((item) => item.note === '一二周课').length, 4);
  assert.equal(result.items.filter((item) => item.note === '三四周课').length, 2);
  assert.equal(result.items.filter((item) => item.note === '单周课').length, 2);
  assert.equal(result.items.filter((item) => item.note === '每周课').length, 4);
  assert.ok(result.items.every((item) => Date.parse(item.end) - Date.parse(item.start) === 45 * 60 * 1000));
  assert.deepEqual(result.items.filter((item) => item.note === '一二周课').map((item) => item.start), [
    '2026-09-09T08:00:00+08:00',
    '2026-09-09T08:55:00+08:00',
    '2026-09-16T08:00:00+08:00',
    '2026-09-16T08:55:00+08:00',
  ]);
});

void test('validates the UI semester contract and its one-to-thirty week boundaries', () => {
  assert.deepEqual(validateSemesterContext({
    startDate: '2026-09-07', fromWeek: 1, toWeek: 30, parity: 'all', periods,
  }), []);
  assert.equal(validateSemesterContext({
    startDate: '2026-09-08', fromWeek: 1, toWeek: 30, parity: 'all', periods,
  })[0].code, 'semester_start_invalid');
  assert.equal(validateSemesterContext({
    startDate: '2026-09-07', fromWeek: 0, toWeek: 31, parity: 'all', periods,
  })[0].code, 'semester_week_range_invalid');

  const first = normalizeTimetable([{weekday: '一', week: '1周', period: '1', course: '第一周'}], {
    semester: {startDate: '2026-09-07', fromWeek: 1, toWeek: 1, parity: 'all', periods},
  });
  const last = normalizeTimetable([{weekday: '一', week: '30周', period: '1', course: '第三十周'}], {
    semester: {startDate: '2026-09-07', fromWeek: 30, toWeek: 30, parity: 'all', periods},
  });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].start, '2026-09-07T08:00:00+08:00');
  assert.equal(last.items.length, 1);
  assert.equal(last.items[0].start, '2027-03-29T08:00:00+08:00');
});

void test('filters row-level weeks, applies odd/even recurrence, and rejects unknown weeks', () => {
  const odd = normalizeTimetable([
    {weekday: '一', week: '', period: '1', course: '每周课'},
    {weekday: '二', week: '双周', period: '1', course: '双周课'},
  ], {semester: {startDate: '2026-09-07', fromWeek: 1, toWeek: 4, parity: 'odd', periods}});
  assert.equal(odd.items.filter((item) => item.note === '每周课').length, 2);
  assert.equal(odd.items.filter((item) => item.note === '双周课').length, 0);
  assert.deepEqual(odd.items.filter((item) => item.note === '每周课').map((item) => item.start), [
    '2026-09-07T08:00:00+08:00',
    '2026-09-21T08:00:00+08:00',
  ]);

  const unknown = normalizeTimetable([{weekday: '三', week: '第3周以后', period: '1', course: '待校对'}], {
    semester: {startDate: '2026-09-07', fromWeek: 1, toWeek: 4, parity: 'all', periods},
  });
  assert.equal(unknown.items.length, 0);
  assert.ok(unknown.errors.some((message) => /周次/.test(message)));
  assert.deepEqual(unknown.skippedRows, [1]);
});

void test('continues excluding non-current-week rows in semester expansion', () => {
  const result = normalizeTimetable([
    {weekday: '三', week: '非本周', period: '1', course: '截图标记排除'},
    {weekday: '四', week: '1-2周', period: '1', course: '当前课', nonCurrentWeek: true},
  ], {semester: {startDate: '2026-09-07', fromWeek: 1, toWeek: 2, parity: 'all', periods}});
  assert.equal(result.items.length, 0);
  assert.deepEqual(result.skippedRows, [1, 2]);
});

void test('parses CSV timetable content through the same preview path', () => {
  const result = parseTimetableContent('日期,节次,课程,备注\n2026-09-23,1,离散数学,A202\n', {periods, weekStart: '2026-09-21', weekEnd: '2026-09-27'});
  assert.equal(result.format, 'csv');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].categoryId, 'class');
});

void test('parses Garmin GMT milliseconds and skips explicit awake stages', () => {
  const result = parseGarminFile(JSON.stringify({sleepData: [
    {sleepId: 's-1', sleepStartTimestampGMT: Date.parse('2026-09-22T15:50:00Z'), sleepEndTimestampGMT: Date.parse('2026-09-22T23:10:00Z')},
    {sleepId: 'awake-1', activityType: 'awake', startTime: '2026-09-23T07:00:00+08:00', endTime: '2026-09-23T07:10:00+08:00'},
  ]}), {name: 'garmin-sleep.json'});
  assert.equal(result.recordsRead, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].start, '2026-09-22T23:50:00+08:00');
  assert.equal(result.items[0].end, '2026-09-23T07:10:00+08:00');
  assert.equal(result.items[0].categoryId, 'sleep');
});

void test('keeps OCR output as editable position blocks and reports empty OCR', () => {
  const result = normalizeTimetableOcrResult({data: {text: '2026-09-23\t1\t数据结构', blocks: [{text: '数据结构', confidence: 92, bbox: {x0: 1, y0: 2, x1: 3, y1: 4}}]}});
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].bbox?.x0, 1);
  assert.equal(normalizeTimetableOcrResult({data: {text: ''}}).issues[0].code, 'ocr_empty');
});

void test('rejects malformed chained week ranges instead of silently truncating',()=>{const result=normalizeTimetable([{weekday:'一',week:'1-2-3周',period:'1',course:'待核对'}],{semester:{startDate:'2026-09-07',fromWeek:1,toWeek:4,parity:'all',periods}});assert.equal(result.items.length,0);assert.ok(result.errors.length>0);});
