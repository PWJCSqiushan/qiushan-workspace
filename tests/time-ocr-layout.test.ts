import assert from 'node:assert/strict';
import test from 'node:test';
import {extractTimetableLayout, type OcrBlock, type OcrLayoutColumnInput, type OcrLayoutPeriodInput} from '../lib/time-ocr-layout.ts';

function box(x0: number, y0: number, x1: number, y1: number) {
  return {x0, y0, x1, y1};
}

function block(text: string, x0: number, y0: number, x1: number, y1: number, confidence = 0.95): OcrBlock {
  return {text, confidence, bbox: box(x0, y0, x1, y1)};
}

function columns(dates: readonly string[] = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']): OcrLayoutColumnInput[] {
  return dates.map((date, index) => ({date, x0: index * 100, x1: index * 100 + 100}));
}

function periods(indexes: readonly number[] = [1, 2, 3]): OcrLayoutPeriodInput[] {
  return indexes.map((index) => ({index, start: `${String(7 + index).padStart(2, '0')}:00`, end: `${String(7 + index).padStart(2, '0')}:45`, y0: (index - 1) * 50, y1: index * 50}));
}

function coloredImage(width: number, height: number, rectangles: readonly {x0: number; y0: number; x1: number; y1: number}[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) rgba[index * 4 + 3] = 255;
  for (const rectangle of rectangles) {
    for (let y = rectangle.y0; y < rectangle.y1; y += 1) {
      for (let x = rectangle.x0; x < rectangle.x1; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = 96;
        rgba[offset + 1] = 174;
        rgba[offset + 2] = 222;
        rgba[offset + 3] = 255;
      }
    }
  }
  return rgba;
}

void test('requires explicit weekStart and never guesses a semester week', () => {
  const result = extractTimetableLayout({
    width: 700,
    height: 200,
    blocks: [block('课程', 10, 10, 80, 40)],
    columns: columns(),
    periods: periods([1]),
  });

  assert.equal(result.rows.length, 0);
  assert.ok(result.issues.some((item) => item.code === 'week_start_required' && item.level === 'error'));
});

void test('manual mappings aggregate one OCR block across multiple periods and preserve non-current preview rows', () => {
  const result = extractTimetableLayout({
    width: 700,
    height: 200,
    weekStart: '2026-09-21',
    blocks: [
      block('多节课程', 20, 5, 80, 95),
      block('教师备注', 20, 22, 80, 36, 0.9),
      block('非本周', 120, 5, 180, 25),
      block('旧课程', 120, 30, 180, 95),
    ],
    columns: columns(),
    periods: periods([1, 2]),
  });

  const current = result.rows.find((row) => row.date === '2026-09-21');
  assert.ok(current);
  assert.equal(current.period, '1-2');
  assert.equal(current.course, '多节课程');
  assert.equal(current.note, '教师备注');
  assert.equal(current.nonCurrentWeek, false);
  assert.ok(current.bbox.y1 >= 95);

  const flagged = result.rows.find((row) => row.date === '2026-09-22');
  assert.ok(flagged);
  assert.equal(flagged.nonCurrentWeek, true);
  assert.ok(result.issues.some((item) => item.code === 'non_current_week'));
});

void test('manual column mapping overrides pixel geometry and keeps dates attached to x positions', () => {
  const result = extractTimetableLayout({
    width: 200,
    height: 100,
    weekStart: '2026-09-21',
    rgba: coloredImage(200, 100, [{x0: 5, y0: 30, x1: 95, y1: 80}, {x0: 105, y0: 30, x1: 195, y1: 80}]),
    blocks: [block('右列', 110, 35, 180, 70), block('左列', 10, 35, 80, 70)],
    columns: [
      {date: '2026-09-22', x0: 100, x1: 200},
      {date: '2026-09-21', x0: 0, x1: 100},
    ],
    periods: [{index: 1, start: '08:00', end: '08:45', y0: 0, y1: 100}],
  });

  assert.deepEqual(result.columns.map((column) => column.date), ['2026-09-21', '2026-09-22']);
  assert.deepEqual(result.rows.map((row) => [row.date, row.course]), [['2026-09-21', '左列'], ['2026-09-22', '右列']]);
  assert.equal(result.columns.every((column) => column.source === 'manual'), true);
});

void test('auto locates seven colored columns and OCR date anchors without hardcoded course names', () => {
  const width = 700;
  const height = 220;
  const rectangles = Array.from({length: 7}, (_, column) => ({x0: column * 100 + 8, y0: 70, x1: column * 100 + 92, y1: 180}));
  const blocks: OcrBlock[] = [
    ...['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27'].map((date, index) => block(date, index * 100 + 20, 5, index * 100 + 80, 30)),
    ...rectangles.map((rectangle, index) => block(`课程${index + 1}`, rectangle.x0 + 10, rectangle.y0 + 10, rectangle.x1 - 10, rectangle.y1 - 10)),
  ];
  const result = extractTimetableLayout({
    width,
    height,
    rgba: coloredImage(width, height, rectangles),
    blocks,
    weekStart: '2026-09-21',
    periods: [{index: 1, start: '08:00', end: '08:45', y0: 50, y1: 200}],
  });

  assert.equal(result.columns.length, 7);
  assert.deepEqual(result.columns.map((column) => column.date), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
  assert.equal(result.rows.length, 7);
  assert.equal(result.rows[0]?.course, '课程1');
});

void test('does not create import rows when geometry has no explicit date anchors', () => {
  const width = 700;
  const height = 160;
  const rectangles = Array.from({length: 7}, (_, column) => ({x0: column * 100 + 8, y0: 50, x1: column * 100 + 92, y1: 130}));
  const result = extractTimetableLayout({
    width,
    height,
    rgba: coloredImage(width, height, rectangles),
    blocks: [block('课程名称', 20, 65, 80, 100)],
    weekStart: '2026-09-21',
    periods: [{index: 1, start: '08:00', end: '08:45', y0: 40, y1: 140}],
  });

  assert.equal(result.columns.length, 7);
  assert.equal(result.rows.length, 0);
  assert.ok(result.issues.some((item) => item.code === 'date_mapping_required' && item.level === 'error'));
});

void test('flattens nested OCR words and marks low confidence rows for correction', () => {
  const result = extractTimetableLayout({
    width: 200,
    height: 120,
    weekStart: '2026-09-21',
    blocks: [{
      paragraphs: [{
        lines: [
          {text: '2026-09-21', confidence: 0.95, bbox: box(20, 2, 80, 20), words: [{text: '2026-09-21', confidence: 0.95, bbox: box(20, 2, 80, 20)}]},
          {text: '模糊课程', confidence: 0.2, bbox: box(20, 35, 80, 70), words: [{text: '模糊课程', confidence: 0.2, bbox: box(20, 35, 80, 70)}]},
        ],
      }],
    }],
    columns: [{date: '2026-09-21', x0: 0, x1: 100}],
    periods: [{index: 1, start: '08:00', end: '08:45', y0: 25, y1: 90}],
  });

  assert.equal(result.rows[0]?.course, '模糊课程');
  assert.ok((result.rows[0]?.confidence ?? 1) < 0.62);
  assert.ok(result.issues.some((item) => item.code === 'low_confidence'));
});

void test('keeps suspicious 13th-period timing for review instead of inventing 45 minutes', () => {
  const result = extractTimetableLayout({
    width: 100,
    height: 100,
    weekStart: '2026-09-21',
    blocks: [block('2026-09-21', 20, 2, 80, 20), block('下午课', 20, 35, 80, 75)],
    columns: [{date: '2026-09-21', x0: 0, x1: 100}],
    periods: [{index: 13, start: '13:30', end: '13:35', y0: 25, y1: 90}],
  });

  assert.equal(result.periods[0]?.start, '13:30');
  assert.equal(result.periods[0]?.end, '13:35');
  assert.equal(result.periods[0]?.needsReview, true);
  assert.ok(result.issues.some((item) => item.code === 'period_time_suspicious'));
});
