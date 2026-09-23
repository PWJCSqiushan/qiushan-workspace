/**
 * Geometry-only timetable OCR helper.
 *
 * This module deliberately has no browser, OCR, database, or network
 * dependency.  It turns position-aware OCR output plus optional screenshot
 * pixels into a reviewable grid.  A caller must still let the user confirm
 * the resulting rows before creating import candidates.
 */

export type OcrBBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/**
 * Tesseract-like nodes are accepted so callers can pass either already
 * flattened blocks or a single block containing paragraphs/lines/words.
 */
export type OcrBlock = {
  text?: string;
  confidence?: number;
  bbox?: OcrBBox;
  blockId?: string;
  blocks?: OcrBlock[];
  paragraphs?: OcrBlock[];
  lines?: OcrBlock[];
  words?: OcrBlock[];
  symbols?: OcrBlock[];
};

export type OcrLayoutColumnInput = {
  date: string;
  x0: number;
  x1: number;
  label?: string;
};

export type OcrLayoutPeriodInput = {
  index: number;
  start?: string;
  end?: string;
  y0: number;
  y1: number;
  label?: string;
};

export type OcrLayoutColumn = OcrLayoutColumnInput & {
  confidence: number;
  source: 'manual' | 'ocr' | 'pixels' | 'mixed';
};

export type OcrLayoutPeriod = OcrLayoutPeriodInput & {
  confidence: number;
  source: 'manual' | 'ocr' | 'pixels' | 'mixed';
  needsReview?: boolean;
};

export type OcrLayoutIssueLevel = 'error' | 'warning';

export type OcrLayoutIssue = {
  level: OcrLayoutIssueLevel;
  code: string;
  message: string;
  sourceRow?: number;
  column?: number;
  period?: string;
  confidence?: number;
};

export type OcrLayoutRow = {
  date: string;
  period: string;
  course: string;
  note?: string;
  nonCurrentWeek: boolean;
  confidence: number;
  bbox: OcrBBox;
  sourceRow: number;
};

export type ExtractTimetableLayoutInput = {
  width: number;
  height: number;
  rgba?: Uint8ClampedArray;
  blocks: OcrBlock[];
  courseBlocks?: OcrBlock[];
  /** The Monday of the week being imported. It is mandatory for import. */
  weekStart?: string;
  /** Explicit mappings take precedence over all geometry inference. */
  columns?: readonly OcrLayoutColumnInput[];
  periods?: readonly OcrLayoutPeriodInput[];
};

export type ExtractTimetableLayoutResult = {
  rows: OcrLayoutRow[];
  issues: OcrLayoutIssue[];
  columns: OcrLayoutColumn[];
  periods: OcrLayoutPeriod[];
};

type Leaf = {
  text: string;
  bbox: OcrBBox;
  confidence: number;
  sourceRow: number;
  lineId: number;
  blockId?: string;
};

type LineRecord = {
  text: string;
  bbox: OcrBBox;
  confidence: number;
  sourceRow: number;
  lineId: number;
};

type DateAnchor = {
  date: string;
  bbox: OcrBBox;
  confidence: number;
  sourceRow: number;
};

type PeriodAnchor = {
  indexes: number[];
  start?: string;
  end?: string;
  bbox: OcrBBox;
  confidence: number;
  sourceRow: number;
};

type ColorComponent = {
  bbox: OcrBBox;
  area: number;
};

type CellText = {
  course: string;
  note?: string;
  bbox: OcrBBox;
  confidence: number;
  sourceRow: number;
  nonCurrentWeek: boolean;
  signature: string;
};

const MAX_SAMPLED_PIXELS = 2_000_000;
const MAX_COMPONENTS = 200;
const LOW_CONFIDENCE = 0.62;
const FULL_DATE_RE = /(?:((?:19|20)\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?|((?:19|20)\d{2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2}))/gu;
const MONTH_DAY_RE = /(\d{1,2})\s*月\s*(\d{1,2})\s*日?/gu;
const SLASH_MONTH_DAY_RE = /(?:^|[^\d])(\d{1,2})\s*\/\s*(\d{1,2})(?!\d)/gu;
const NON_CURRENT_RE = /非本周|非当前周|其他周|上周|下周/u;
const TIME_RANGE_RE = /(\d{1,2})\s*[:：]\s*(\d{2})\s*[-~到至]\s*(\d{1,2})\s*[:：]\s*(\d{2})/u;
const PERIOD_RANGE_RE = /(?:第\s*)?(\d{1,2})(?:\s*[-~到至]\s*(\d{1,2}))?\s*(?:节|课)/u;
const STANDALONE_PERIOD_RE = /^\s*(\d{1,2})\s*$/u;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function confidence(value: unknown, fallback = 0.55): number {
  if (!finite(value)) return fallback;
  return clamp01(value > 1 ? value / 100 : value);
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function validBBox(value: unknown): OcrBBox | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const box = value as Partial<OcrBBox>;
  if (!finite(box.x0) || !finite(box.y0) || !finite(box.x1) || !finite(box.y1)) return undefined;
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return undefined;
  return {x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1};
}

function unionBBox(boxes: readonly OcrBBox[]): OcrBBox {
  const first = boxes[0] ?? {x0: 0, y0: 0, x1: 0, y1: 0};
  return boxes.slice(1).reduce(
    (result, box) => ({
      x0: Math.min(result.x0, box.x0),
      y0: Math.min(result.y0, box.y0),
      x1: Math.max(result.x1, box.x1),
      y1: Math.max(result.y1, box.y1),
    }),
    {...first},
  );
}

function bboxArea(box: OcrBBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

function horizontalOverlap(a: OcrBBox, b: OcrBBox): number {
  return Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
}

function verticalOverlap(a: OcrBBox, b: OcrBBox): number {
  return Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}

function centerX(box: OcrBBox): number {
  return (box.x0 + box.x1) / 2;
}

function centerY(box: OcrBBox): number {
  return (box.y0 + box.y1) / 2;
}

function joinText(parts: readonly string[]): string {
  let result = '';
  for (const raw of parts) {
    const text = cleanText(raw);
    if (!text) continue;
    if (!result) {
      result = text;
      continue;
    }
    const previous = result[result.length - 1] ?? '';
    const next = text[0] ?? '';
    const needsSpace = /[A-Za-z0-9]$/u.test(previous) && /^[A-Za-z0-9]/u.test(next);
    result += `${needsSpace ? ' ' : ''}${text}`;
  }
  return result;
}

function normalizeSignature(value: string): string {
  return cleanText(value).replace(/[·•，,。；;：:()（）[\]【】]/gu, '').toLocaleLowerCase();
}

function dateFromParts(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return undefined;
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function parseDateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = cleanText(value);
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/u);
  return match ? dateFromParts(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
}

function shiftDate(date: string, offset: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return dateFromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate())!;
}

function dateDistance(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

function resolveMonthDay(month: number, day: number, weekStart: string): string | undefined {
  const year = Number(weekStart.slice(0, 4));
  const weekEnd = shiftDate(weekStart, 6);
  const candidates = [year - 1, year, year + 1]
    .map((candidate) => dateFromParts(candidate, month, day))
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.sort((a, b) => {
    const aInside = a >= weekStart && a <= weekEnd;
    const bInside = b >= weekStart && b <= weekEnd;
    if (aInside !== bInside) return aInside ? -1 : 1;
    return dateDistance(a, weekStart) - dateDistance(b, weekStart);
  })[0];
}

function parseDateTexts(text: string, weekStart: string): Array<{date: string; offset: number}> {
  const result: Array<{date: string; offset: number}> = [];
  const push = (date: string | undefined, offset: number) => {
    if (date && !result.some((item) => item.date === date && item.offset === offset)) result.push({date, offset});
  };
  for (const match of text.matchAll(FULL_DATE_RE)) {
    const year = Number(match[1] ?? match[4]);
    const month = Number(match[2] ?? match[5]);
    const day = Number(match[3] ?? match[6]);
    push(dateFromParts(year, month, day), match.index ?? 0);
  }
  for (const match of text.matchAll(MONTH_DAY_RE)) {
    push(resolveMonthDay(Number(match[1]), Number(match[2]), weekStart), match.index ?? 0);
  }
  for (const match of text.matchAll(SLASH_MONTH_DAY_RE)) {
    push(resolveMonthDay(Number(match[1]), Number(match[2]), weekStart), match.index ?? 0);
  }
  return result.sort((a, b) => a.offset - b.offset);
}

function childCollection(node: OcrBlock): {kind: keyof OcrBlock; items: OcrBlock[]} | undefined {
  for (const kind of ['blocks', 'paragraphs', 'lines', 'words', 'symbols'] as const) {
    const value = node[kind];
    if (Array.isArray(value) && value.length > 0) return {kind, items: value};
  }
  return undefined;
}

function flattenOcr(blocks: readonly OcrBlock[]): {leaves: Leaf[]; lines: LineRecord[]} {
  const leaves: Leaf[] = [];
  const lines: LineRecord[] = [];
  let nextLineId = 1;
  let fallbackRow = 0;

  const walk = (node: OcrBlock, sourceRow: number, lineId: number | undefined) => {
    const children = childCollection(node);
    if (children) {
      if (children.kind === 'lines') {
        for (const child of children.items) {
          const currentLineId = nextLineId++;
          const currentRow = nextLineId - 1;
          const childBox = validBBox(child.bbox);
          const childText = cleanText(child.text);
          if (childBox && childText) {
            lines.push({text: childText, bbox: childBox, confidence: confidence(child.confidence), sourceRow: currentRow, lineId: currentLineId});
          }
          walk(child, currentRow, currentLineId);
        }
      } else {
        children.items.forEach((child, index) => walk(child, sourceRow || index + 1, lineId));
      }
      return;
    }
    const text = cleanText(node.text);
    const bbox = validBBox(node.bbox);
    if (!text || !bbox) return;
    const row = sourceRow || ++fallbackRow;
    const currentLineId = lineId ?? row;
    if (lineId === undefined) lines.push({text, bbox, confidence: confidence(node.confidence), sourceRow: row, lineId: currentLineId});
    leaves.push({text, bbox, confidence: confidence(node.confidence), sourceRow: row, lineId: currentLineId, blockId: node.blockId});
  };

  blocks.forEach((block, index) => walk(block, index + 1, undefined));
  return {leaves, lines};
}

function anchorsFromText(
  records: readonly LineRecord[],
  leaves: readonly Leaf[],
  weekStart: string,
): DateAnchor[] {
  const anchors: DateAnchor[] = [];
  const add = (date: string, box: OcrBBox, conf: number, row: number) => anchors.push({date, bbox: box, confidence: conf, sourceRow: row});
  for (const leaf of leaves) {
    const matches = parseDateTexts(leaf.text, weekStart);
    for (const match of matches) add(match.date, leaf.bbox, leaf.confidence, leaf.sourceRow);
  }
  for (const record of records) {
    const matches = parseDateTexts(record.text, weekStart);
    if (!matches.length) continue;
    if (matches.length === 1) {
      add(matches[0].date, record.bbox, record.confidence, record.sourceRow);
      continue;
    }
    const width = (record.bbox.x1 - record.bbox.x0) / matches.length;
    matches.forEach((match, index) => add(match.date, {
      x0: record.bbox.x0 + width * index,
      x1: record.bbox.x0 + width * (index + 1),
      y0: record.bbox.y0,
      y1: record.bbox.y1,
    }, record.confidence, record.sourceRow));
  }
  const unique = new Map<string, DateAnchor>();
  for (const anchor of anchors) {
    const key = `${anchor.date}:${Math.round(centerX(anchor.bbox) / 3)}:${Math.round(centerY(anchor.bbox) / 3)}`;
    const previous = unique.get(key);
    if (!previous || anchor.confidence > previous.confidence) unique.set(key, anchor);
  }
  return [...unique.values()].sort((a, b) => centerX(a.bbox) - centerX(b.bbox));
}

function normalizeBand(x0: number, x1: number, width: number): {x0: number; x1: number} | undefined {
  if (!finite(x0) || !finite(x1)) return undefined;
  const left = Math.max(0, Math.min(width, Math.min(x0, x1)));
  const right = Math.max(0, Math.min(width, Math.max(x0, x1)));
  return right > left ? {x0: left, x1: right} : undefined;
}

function centersToBands(centers: readonly number[], width: number): Array<{x0: number; x1: number}> {
  const values = [...new Set(centers.filter(finite))].sort((a, b) => a - b);
  if (!values.length) return [];
  return values.map((center, index) => {
    const left = index === 0 ? Math.max(0, center - (values[1] === undefined ? width / 14 : (values[1] - center) / 2)) : (values[index - 1] + center) / 2;
    const right = index === values.length - 1 ? Math.min(width, center + (values[index - 1] === undefined ? width / 14 : (center - values[index - 1]) / 2)) : (center + values[index + 1]) / 2;
    return {x0: left, x1: right};
  });
}

function clusterIntervals(intervals: readonly {x0: number; x1: number; area: number}[], gap: number): Array<{x0: number; x1: number; area: number}> {
  const sorted = [...intervals].sort((a, b) => a.x0 - b.x0 || b.area - a.area);
  const clusters: Array<{x0: number; x1: number; area: number}> = [];
  for (const interval of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && interval.x0 <= current.x1 + gap) {
      current.x1 = Math.max(current.x1, interval.x1);
      current.area += interval.area;
    } else clusters.push({...interval});
  }
  return clusters;
}

function detectColorComponents(width: number, height: number, rgba: Uint8ClampedArray | undefined): ColorComponent[] {
  if (!rgba || width <= 0 || height <= 0) return [];
  const total = width * height;
  if (!Number.isSafeInteger(total) || rgba.length < total * 4) return [];
  const step = Math.max(1, Math.ceil(Math.sqrt(total / MAX_SAMPLED_PIXELS)));
  const gridWidth = Math.ceil(width / step);
  const gridHeight = Math.ceil(height / step);
  const sampleCount = gridWidth * gridHeight;
  const mask = new Uint8Array(sampleCount);
  const colored = (index: number) => {
    const offset = index * 4;
    const r = rgba[offset] ?? 0;
    const g = rgba[offset + 1] ?? 0;
    const b = rgba[offset + 2] ?? 0;
    const alpha = rgba[offset + 3] ?? 0;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const edgeOffset=Math.floor(index/width)*width*4;
    const difference=Math.abs(r-rgba[edgeOffset])+Math.abs(g-rgba[edgeOffset+1])+Math.abs(b-rgba[edgeOffset+2]);
    return alpha >= 32 && spread >= 18 && difference>=50 && Math.max(r,g,b)<253;
  };
  for (let gy = 0; gy < gridHeight; gy += 1) {
    const y = Math.min(height - 1, gy * step);
    for (let gx = 0; gx < gridWidth; gx += 1) {
      const x = Math.min(width - 1, gx * step);
      mask[gy * gridWidth + gx] = colored((y * width + x)) ? 1 : 0;
    }
  }
  const queue = new Int32Array(sampleCount);
  const components: ColorComponent[] = [];
  for (let start = 0; start < sampleCount; start += 1) {
    if (!mask[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    mask[start] = 0;
    let count = 0;
    let minX = gridWidth;
    let minY = gridHeight;
    let maxX = 0;
    let maxY = 0;
    while (head < tail) {
      const current = queue[head++];
      const gx = current % gridWidth;
      const gy = Math.floor(current / gridWidth);
      count += 1;
      minX = Math.min(minX, gx);
      minY = Math.min(minY, gy);
      maxX = Math.max(maxX, gx);
      maxY = Math.max(maxY, gy);
      const neighbors = [current - 1, current + 1, current - gridWidth, current + gridWidth];
      for (const next of neighbors) {
        if (next < 0 || next >= sampleCount || !mask[next]) continue;
        const nx = next % gridWidth;
        const ny = Math.floor(next / gridWidth);
        if (Math.abs(nx - gx) + Math.abs(ny - gy) !== 1) continue;
        mask[next] = 0;
        queue[tail++] = next;
      }
    }
    const area = count * step * step;
    if (area < 20) continue;
    const bbox = {x0: minX * step, y0: minY * step, x1: Math.min(width, (maxX + 1) * step), y1: Math.min(height, (maxY + 1) * step)};
    if (bboxArea(bbox) > total * 0.6) continue;
    components.push({bbox, area});
  }
  return components.sort((a, b) => b.area - a.area).slice(0, MAX_COMPONENTS);
}

function columnsFromGeometry(width: number, components: readonly ColorComponent[]): Array<{x0: number; x1: number; confidence: number}> {
  const usable = components.filter((component) => component.bbox.x1 - component.bbox.x0 >= Math.max(4, width / 300));
  const clusters = clusterIntervals(usable.map((component) => ({x0: component.bbox.x0, x1: component.bbox.x1, area: component.area})), Math.max(1, width / 1200));
  const selected = clusters.length > 7 ? [...clusters].sort((a, b) => b.area - a.area).slice(0, 7).sort((a, b) => a.x0 - b.x0) : clusters;
  return selected.map((cluster) => ({x0: cluster.x0, x1: cluster.x1, confidence: selected.length === 7 ? 0.72 : 0.5}));
}

function normalizeManualColumns(input: readonly OcrLayoutColumnInput[], width: number, issues: OcrLayoutIssue[]): OcrLayoutColumn[] {
  const columns: OcrLayoutColumn[] = [];
  for (const [index, item] of input.entries()) {
    const band = normalizeBand(item.x0, item.x1, width);
    const date = parseDateOnly(item.date);
    if (!band || !date) {
      issues.push({level: 'error', code: 'invalid_column_mapping', message: `第 ${index + 1} 个日期列映射无效；需要有效日期和 x0/x1`});
      continue;
    }
    columns.push({...item, ...band, date, confidence: 1, source: 'manual'});
  }
  return columns.sort((a, b) => a.x0 - b.x0);
}

function assignDateAnchors(
  bands: readonly {x0: number; x1: number; confidence: number}[],
  anchors: readonly DateAnchor[],
  issues: OcrLayoutIssue[],
): OcrLayoutColumn[] {
  const columns: OcrLayoutColumn[] = bands.map((band) => ({...band, date: '', label: undefined, source: 'pixels', confidence: band.confidence}));
  for (const anchor of anchors) {
    if (!columns.length) break;
    const nearest = columns.reduce((best, column, index) => {
      const distance = Math.abs(centerX({x0: column.x0, x1: column.x1, y0: 0, y1: 1}) - centerX(anchor.bbox));
      return distance < best.distance ? {index, distance} : best;
    }, {index: 0, distance: Number.POSITIVE_INFINITY});
    const column = columns[nearest.index];
    const allowed = Math.max(8, (column.x1 - column.x0) * 0.9);
    if (nearest.distance > allowed) continue;
    if (column.date && column.date !== anchor.date) {
      issues.push({level: 'warning', code: 'duplicate_date_anchor', message: `同一日期列识别出多个日期，需校对`, column: nearest.index + 1, confidence: anchor.confidence});
      continue;
    }
    column.date = anchor.date;
    column.confidence = Math.max(column.confidence, anchor.confidence * 0.9);
    column.source = (column.source === 'pixels' ? 'mixed' : 'ocr') as OcrLayoutColumn['source'];
  }
  if (columns.some((column) => !column.date)) {
    issues.push({level: 'error', code: 'date_mapping_required', message: '无法为全部日期列建立明确日期映射；不会按列顺序猜测日期，请提供 columns 覆盖'});
  }
  return columns;
}

function buildColumns(
  input: ExtractTimetableLayoutInput,
  anchors: readonly DateAnchor[],
  components: readonly ColorComponent[],
  issues: OcrLayoutIssue[],
): OcrLayoutColumn[] {
  if (input.columns?.length) return normalizeManualColumns(input.columns, input.width, issues);
  const geometry = columnsFromGeometry(input.width, components);
  const uniqueDates=[...new Map(anchors.map(a=>[a.date,a])).values()].sort((a,b)=>a.date.localeCompare(b.date));
  if(uniqueDates.length>=3&&input.weekStart){
    const points=uniqueDates.map(a=>({day:Math.round((Date.parse(a.date)-Date.parse(input.weekStart!))/86400000),x:centerX(a.bbox)})).filter(p=>p.day>=0&&p.day<7);
    if(points.length>=3){
      const n=points.length,sx=points.reduce((s,p)=>s+p.day,0),sy=points.reduce((s,p)=>s+p.x,0),xx=points.reduce((s,p)=>s+p.day*p.day,0),xy=points.reduce((s,p)=>s+p.day*p.x,0);
      const step=(n*xy-sx*sy)/(n*xx-sx*sx),origin=(sy-step*sx)/n;
      if(step>input.width/12&&step<input.width/5&&points.every(p=>Math.abs(p.x-origin-step*p.day)<step*.15))
        return Array.from({length:7},(_,day)=>({date:shiftDate(input.weekStart!,day),x0:Math.max(0,origin+step*(day-.5)),x1:Math.min(input.width,origin+step*(day+.5)),confidence:.8,source:'mixed' as const}));
    }
  }
  const anchorCenters = anchors.map((anchor) => centerX(anchor.bbox));
  const uniqueAnchorCenters = [...new Set(anchorCenters.map((value) => Math.round(value)))];
  let bands: Array<{x0: number; x1: number; confidence: number}> = geometry;
  if (uniqueAnchorCenters.length >= geometry.length && uniqueAnchorCenters.length >= 2 && uniqueAnchorCenters.length <= 7) {
    bands = centersToBands(uniqueAnchorCenters, input.width).map((band) => ({...band, confidence: 0.7}));
  } else if (uniqueAnchorCenters.length === 7) {
    bands = centersToBands(uniqueAnchorCenters, input.width).map((band) => ({...band, confidence: 0.8}));
  }
  if (bands.length > 7) bands = bands.slice(0, 7);
  if (!bands.length) {
    issues.push({level: 'error', code: 'columns_not_detected', message: '未定位到日期列；请提供 columns 映射或清晰截图'});
    return [];
  }
  if (bands.length !== 7) issues.push({level: 'warning', code: 'column_count_uncertain', message: `自动定位到 ${bands.length} 个列带，预期为 7 列`});
  const columns = assignDateAnchors(bands, anchors, issues);
  if (!anchors.length) issues.push({level: 'error', code: 'date_mapping_required', message: '截图没有明确日期文字；不会按七列顺序猜测日期'});
  return columns;
}

function parseTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = cleanText(value).match(/^(\d{1,2})[:：](\d{2})$/u);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}` : undefined;
}

function parsePeriodAnchors(records: readonly LineRecord[], leaves: readonly Leaf[], width: number, height: number): PeriodAnchor[] {
  const anchors: PeriodAnchor[] = [];
  const inspect = (text: string, bbox: OcrBBox, conf: number, row: number) => {
    if (bbox.y0 < height * 0.08) return;
    const period = text.match(PERIOD_RANGE_RE);
    const standalone = !period && bbox.x1 <= width * 0.2 ? text.match(STANDALONE_PERIOD_RE) : undefined;
    if (period && bbox.x0 > width * 0.25) return;
    if (!period && !standalone) return;
    const first = Number(period?.[1] ?? standalone?.[1]);
    const last = Number(period?.[2] ?? first);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > 99) return;
    const indexes = Array.from({length: last - first + 1}, (_, index) => first + index);
    const time = text.match(TIME_RANGE_RE);
    anchors.push({
      indexes,
      start: time ? parseTime(`${time[1]}:${time[2]}`) : undefined,
      end: time ? parseTime(`${time[3]}:${time[4]}`) : undefined,
      bbox,
      confidence: conf,
      sourceRow: row,
    });
  };
  records.forEach((record) => inspect(record.text, record.bbox, record.confidence, record.sourceRow));
  leaves.forEach((leaf) => inspect(leaf.text, leaf.bbox, leaf.confidence, leaf.sourceRow));
  return anchors;
}

function periodsFromGeometry(components: readonly ColorComponent[], leaves: readonly Leaf[], width: number, height: number, issues: OcrLayoutIssue[]): OcrLayoutPeriod[] {
  const intervals = components
    .filter((component) => component.bbox.y1 - component.bbox.y0 >= Math.max(5, height / 500))
    .map((component) => ({x0: component.bbox.y0, x1: component.bbox.y1, area: component.area}));
  let clusters = clusterIntervals(intervals, Math.max(2, height / 1200));
  if (!clusters.length) {
    const centers = leaves.map((leaf) => centerY(leaf.bbox)).sort((a, b) => a - b);
    const unique = [...new Set(centers.map((value) => Math.round(value / 3) * 3))];
    const bands = centersToBands(unique, height);
    clusters = bands.map((band) => ({x0: band.x0, x1: band.x1, area: 1}));
  }
  const periods = clusters.slice(0, 99).map((cluster, index) => ({
    index: index + 1,
    y0: cluster.x0,
    y1: cluster.x1,
    confidence: 0.42,
    source: 'pixels' as const,
  }));
  if (!periods.length) issues.push({level: 'error', code: 'periods_not_detected', message: '未定位到节次槽；请提供 periods 映射'});
  return periods;
}

function normalizeManualPeriods(input: readonly OcrLayoutPeriodInput[], height: number, issues: OcrLayoutIssue[]): OcrLayoutPeriod[] {
  const periods: OcrLayoutPeriod[] = [];
  for (const [index, item] of input.entries()) {
    const y0 = Math.max(0, Math.min(height, Math.min(item.y0, item.y1)));
    const y1 = Math.max(0, Math.min(height, Math.max(item.y0, item.y1)));
    if (!Number.isSafeInteger(item.index) || item.index < 1 || y1 <= y0) {
      issues.push({level: 'error', code: 'invalid_period_mapping', message: `第 ${index + 1} 个节次映射无效`});
      continue;
    }
    const start = item.start ? parseTime(item.start) : undefined;
    const end = item.end ? parseTime(item.end) : undefined;
    if (item.start && !start || item.end && !end) issues.push({level: 'warning', code: 'period_time_invalid', message: `第 ${item.index} 节起止时间无法解析`, period: String(item.index)});
    const duration = start && end ? minutesBetween(start, end) : undefined;
    const needsReview = duration !== undefined && duration < 20;
    if (needsReview) issues.push({level: 'warning', code: 'period_time_suspicious', message: `第 ${item.index} 节时长异常（${duration} 分钟），不会补成 45 分钟`, period: String(item.index)});
    periods.push({...item, y0, y1, start, end, confidence: 1, source: 'manual', ...(needsReview ? {needsReview: true} : {})});
  }
  return periods.sort((a, b) => a.index - b.index || a.y0 - b.y0);
}

function minutesBetween(start: string, end: string): number | undefined {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const value = (eh * 60 + em) - (sh * 60 + sm);
  return value > 0 ? value : undefined;
}

function buildPeriods(
  input: ExtractTimetableLayoutInput,
  records: readonly LineRecord[],
  leaves: readonly Leaf[],
  components: readonly ColorComponent[],
  issues: OcrLayoutIssue[],
): OcrLayoutPeriod[] {
  if (input.periods?.length) return normalizeManualPeriods(input.periods, input.height, issues);
  const anchors = parsePeriodAnchors(records, leaves, input.width, input.height);
  let periods = periodsFromGeometry(components, leaves, input.width, input.height, issues);
  if (anchors.length) {
    const centers = anchors.flatMap((anchor) => anchor.indexes.map(() => centerY(anchor.bbox)));
    const uniqueCenters = [...new Set(centers.map((value) => Math.round(value)))];
    if (uniqueCenters.length >= 2) {
      const indexes = [...new Set(anchors.flatMap((anchor) => anchor.indexes))].sort((a, b) => a - b);
      periods = centersToBands(uniqueCenters, input.height).map((band, index) => ({index: indexes[index] ?? index + 1, y0: band.x0, y1: band.x1, confidence: 0.75, source: 'ocr' as const}));
    }
    const clockLeaves=leaves.filter(l=>l.bbox.x1<input.width*.14).map(l=>({text:l.text.replace(/\s/g,''),y:centerY(l.bbox)})).map(l=>({...l,time:parseTime(l.text)||(/^\d{4}$/.test(l.text)?parseTime(l.text.slice(0,2)+':'+l.text.slice(2)):undefined)})).filter(l=>l.time);
    const singleAnchors=[...new Map(anchors.filter(a=>a.indexes.length===1).map(a=>[a.indexes[0],a])).values()].sort((a,b)=>a.indexes[0]-b.indexes[0]);
    for(let i=0;i<singleAnchors.length;i++){
      const a=singleAnchors[i],bottom=singleAnchors[i+1]?.bbox.y0??input.height;
      const clocks=clockLeaves.filter(l=>l.y>a.bbox.y0&&l.y<bottom).sort((x,y)=>x.y-y.y);
      if(clocks.length>=2){a.start=clocks[0].time;a.end=clocks[1].time;}
    }
    if(singleAnchors.length>=4){
      const diffs=singleAnchors.slice(1).map((a,i)=>(centerY(a.bbox)-centerY(singleAnchors[i].bbox))/(a.indexes[0]-singleAnchors[i].indexes[0])).filter(x=>x>0).sort((a,b)=>a-b);
      const step=diffs[Math.floor(diffs.length/2)],first=singleAnchors[0],labelBase=centerY(first.bbox)-(first.indexes[0]-1)*step;
      const top=components.length?Math.min(...components.map(c=>c.bbox.y0)):labelBase-step*.25;
      if(step>input.height/100&&singleAnchors.every(a=>Math.abs(centerY(a.bbox)-(labelBase+(a.indexes[0]-1)*step))<step*.3))
        periods=Array.from({length:Math.max(...singleAnchors.map(a=>a.indexes[0]))},(_,i)=>({index:i+1,y0:Math.max(0,top+i*step),y1:Math.min(input.height,top+(i+1)*step),confidence:.75,source:'ocr' as const}));
    }
    const byIndex = new Map<number, PeriodAnchor>();
    for (const anchor of anchors) for (const index of anchor.indexes) if (!byIndex.has(index)) byIndex.set(index, anchor);
    periods = periods.map((period) => {
      const anchor = byIndex.get(period.index);
      if (!anchor) return period;
      const start = anchor.start;
      const end = anchor.end;
      const duration = start && end ? minutesBetween(start, end) : undefined;
      const needsReview = duration !== undefined && duration < 20;
      if (needsReview) issues.push({level: 'warning', code: 'period_time_suspicious', message: `第 ${period.index} 节时长异常（${duration} 分钟），不会补成 45 分钟`, period: String(period.index), confidence: anchor.confidence});
      return {...period, start, end, confidence: Math.max(period.confidence, anchor.confidence), source: period.source === 'pixels' ? 'mixed' : 'ocr', ...(needsReview ? {needsReview: true} : {})};
    });
  }
  if (periods.some((period) => !period.start || !period.end)) issues.push({level: 'error', code: 'period_time_missing', message: '节次槽已定位但缺少可靠起止时间；请提供 periods 映射，不能按默认 45 分钟猜测'});
  return periods.sort((a, b) => a.index - b.index || a.y0 - b.y0);
}

function isStructuralText(text: string): boolean {
  const value = cleanText(text);
  if (!value) return true;
  if (NON_CURRENT_RE.test(value)) return true;
  if (parseDateTexts(value, '2026-01-01').length) return true;
  if (TIME_RANGE_RE.test(value) || PERIOD_RANGE_RE.test(value)) return true;
  return /^\d{1,3}$/u.test(value);
}

function linesForCell(leaves: readonly Leaf[], cell: OcrBBox): {groups: Array<{text: string; bbox: OcrBBox; confidence: number; sourceRow: number}>; nonCurrentWeek: boolean} {
  const selected = leaves.filter((leaf) => {
    const xOverlap = horizontalOverlap(leaf.bbox, cell);
    const yOverlap = verticalOverlap(leaf.bbox, cell);
    return xOverlap > 0 && yOverlap > 0 && (xOverlap / Math.max(1, bboxArea(leaf.bbox) / Math.max(1, leaf.bbox.y1 - leaf.bbox.y0)) > 0.25 || centerX(leaf.bbox) >= cell.x0 && centerX(leaf.bbox) <= cell.x1) && (yOverlap / Math.max(1, leaf.bbox.y1 - leaf.bbox.y0) >= 0.15 || centerY(leaf.bbox) >= cell.y0 && centerY(leaf.bbox) <= cell.y1);
  });
  const byLine = new Map<number, Leaf[]>();
  for (const leaf of selected) {
    const group = byLine.get(leaf.lineId) ?? [];
    group.push(leaf);
    byLine.set(leaf.lineId, group);
  }
  let nonCurrentWeek = false;
  const groups = [...byLine.values()].map((group) => {
    group.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const raw = joinText(group.map((leaf) => leaf.text));
    if (NON_CURRENT_RE.test(raw)) nonCurrentWeek = true;
    const text = raw.replace(NON_CURRENT_RE, '').trim();
    return {text, bbox: unionBBox(group.map((leaf) => leaf.bbox)), confidence: group.reduce((sum, leaf) => sum + leaf.confidence, 0) / group.length, sourceRow: Math.min(...group.map((leaf) => leaf.sourceRow))};
  }).filter((group) => group.text && !isStructuralText(group.text));
  groups.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  return {groups, nonCurrentWeek};
}

function cellText(leaves: readonly Leaf[], column: OcrLayoutColumn, period: OcrLayoutPeriod): CellText | undefined {
  const result = linesForCell(leaves, {x0: column.x0, x1: column.x1, y0: period.y0, y1: period.y1});
  if (!result.groups.length) return undefined;
  const course = result.groups[0].text;
  const note = joinText(result.groups.slice(1).map((group) => group.text)) || undefined;
  const bbox = unionBBox(result.groups.map((group) => group.bbox));
  const row = Math.min(...result.groups.map((group) => group.sourceRow));
  const conf = result.groups.reduce((sum, group) => sum + group.confidence, 0) / result.groups.length;
  return {course, note, bbox, confidence: conf, sourceRow: row, nonCurrentWeek: result.nonCurrentWeek, signature: normalizeSignature(`${course}\n${note ?? ''}`)};
}

function periodLabel(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

function extractRows(
  columns: readonly OcrLayoutColumn[],
  periods: readonly OcrLayoutPeriod[],
  leaves: readonly Leaf[],
  weekStart: string,
  issues: OcrLayoutIssue[],
): OcrLayoutRow[] {
  const weekEnd = shiftDate(weekStart, 6);
  const rows: OcrLayoutRow[] = [];
  for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
    const column = columns[columnIndex];
    if (!column.date) continue;
    const outsideWeek = column.date < weekStart || column.date > weekEnd;
    let pending: {start: number; end: number; text: CellText} | undefined;
    const flush = () => {
      if (!pending) return;
      const text = pending.text;
      const periodConfidence = periods.find((period) => period.index === pending!.start)?.confidence ?? 0.5;
      const rowConfidence = clamp01(text.confidence * Math.min(column.confidence, periodConfidence));
      const nonCurrentWeek = outsideWeek || text.nonCurrentWeek;
      const row: OcrLayoutRow = {date: column.date, period: periodLabel(pending.start, pending.end), course: text.course, ...(text.note ? {note: text.note} : {}), nonCurrentWeek, confidence: rowConfidence, bbox: text.bbox, sourceRow: text.sourceRow};
      rows.push(row);
      if (nonCurrentWeek) issues.push({level: 'warning', code: 'non_current_week', message: `第 ${row.sourceRow} 行不属于当前周，预览保留但不可导入`, sourceRow: row.sourceRow, column: columnIndex + 1, period: row.period, confidence: rowConfidence});
      if (rowConfidence < LOW_CONFIDENCE) issues.push({level: 'warning', code: 'low_confidence', message: `第 ${row.sourceRow} 行 OCR 置信度较低，请逐项校对`, sourceRow: row.sourceRow, column: columnIndex + 1, period: row.period, confidence: rowConfidence});
      pending = undefined;
    };
    for (const period of periods) {
      const current = cellText(leaves, column, period);
      if (!current) {
        flush();
        continue;
      }
      const sameCourse = pending && normalizeSignature(pending.text.course) === normalizeSignature(current.course);
      if (pending && pending.end + 1 === period.index && sameCourse) {
        pending.end = period.index;
        const notes = [...new Set([pending.text.note, current.note].filter((value): value is string => Boolean(value)))];
        pending.text = {...pending.text, note: notes.length ? notes.join(' / ') : undefined, signature: normalizeSignature(`${pending.text.course}\n${notes.join(' / ')}`), bbox: unionBBox([pending.text.bbox, current.bbox]), confidence: Math.min(pending.text.confidence, current.confidence), sourceRow: Math.min(pending.text.sourceRow, current.sourceRow), nonCurrentWeek: pending.text.nonCurrentWeek || current.nonCurrentWeek};
      } else {
        flush();
        pending = {start: period.index, end: period.index, text: current};
      }
    }
    flush();
  }
  return rows;
}

export function extractTimetableLayout(input: ExtractTimetableLayoutInput): ExtractTimetableLayoutResult {
  const issues: OcrLayoutIssue[] = [];
  const width = Math.floor(input.width);
  const height = Math.floor(input.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return {rows: [], issues: [{level: 'error', code: 'invalid_image_size', message: '截图宽高无效'}], columns: [], periods: []};
  }
  const weekStart = parseDateOnly(input.weekStart);
  if (!weekStart) issues.push({level: 'error', code: 'week_start_required', message: '必须明确提供当前周起始日期；不会猜测学期或周次'});
  const {leaves, lines} = flattenOcr(Array.isArray(input.blocks) ? input.blocks : []);
  const components = detectColorComponents(width, height, input.rgba).filter(c=>c.bbox.x1-c.bbox.x0>width/18&&c.bbox.y1-c.bbox.y0>height/70);
  if (input.rgba && input.rgba.length < width * height * 4) issues.push({level: 'warning', code: 'rgba_invalid', message: '截图像素数据长度不足，已跳过颜色几何检测'});
  let anchors = weekStart ? anchorsFromText(lines, leaves, weekStart) : [];
  const courseTop=components.length?Math.min(...components.map(c=>c.bbox.y0)):height*.3;
  if(weekStart){
    for(const leaf of leaves){const match=leaf.text.trim().match(/^([12]?\d|3[01])$/);if(!match||leaf.bbox.y1>courseTop)continue;for(let d=0;d<7;d++){const date=shiftDate(weekStart,d);if(Number(date.slice(-2))===Number(match[1]))anchors.push({date,bbox:leaf.bbox,confidence:leaf.confidence,sourceRow:leaf.sourceRow});}}
    const groups:DateAnchor[][]=[];
    for(const anchor of anchors.filter(a=>a.bbox.y1<=courseTop)){let group=groups.find(g=>Math.abs(centerY(g[0].bbox)-centerY(anchor.bbox))<height*.018);if(!group){group=[];groups.push(group);}group.push(anchor);}
    groups.sort((a,b)=>new Set(b.map(x=>x.date)).size-new Set(a.map(x=>x.date)).size);
    if(groups[0]?.length)anchors=groups[0];
  }
  const columns = buildColumns(input, anchors, components, issues);
  const periods = buildPeriods(input, lines, leaves, components, issues);
  if (!weekStart) return {rows: [], issues, columns, periods};
  let rows = columns.length && periods.length ? extractRows(columns, periods, leaves, weekStart, issues) : [];
  if(input.courseBlocks?.length&&columns.length&&periods.length){
    rows=[];
    for(const [index,block] of input.courseBlocks.entries()){
      const box=validBBox(block.bbox);if(!box)continue;
      const col=columns.find(c=>centerX(box)>=c.x0&&centerX(box)<c.x1);if(!col?.date)continue;
      const selected=periods.filter(p=>verticalOverlap(box,{x0:box.x0,x1:box.x1,y0:p.y0,y1:p.y1})>Math.min(box.y1-box.y0,p.y1-p.y0)*.4);
      if(!selected.length)continue;
      const text=(block.text||'').replace(/非\s*本\s*周/g,'非本周');const nonCurrentWeek=text.includes('非本周');
      const rawLines=text.split(/\n/).map(x=>x.trim().replace(/\s+/g,'')).filter(Boolean).filter(x=>x!=='非本周');
      const teacher=rawLines.findIndex(x=>x.includes('@')||x.includes('＠'));
      const titleLines=teacher>0?rawLines.slice(0,teacher):rawLines.slice(0,Math.min(2,rawLines.length));
      const course=titleLines.join('')||'待校对课程';
      rows.push({date:col.date,period:periodLabel(selected[0].index,selected.at(-1)!.index),course,note:rawLines.join(' '),nonCurrentWeek,confidence:confidence(block.confidence),bbox:box,sourceRow:index+1});
    }
    issues.push({level:'warning',code:'course_crop_review',message:'已按彩色课程块分别识别；请逐块核对课程名、非本周标记和节次，再确认导入'});
  }
  if (!rows.length && columns.some((column) => column.date) && periods.length) issues.push({level: 'warning', code: 'no_course_rows', message: '已定位网格但没有可靠课程文字，请提高 OCR 清晰度或逐项校对'});
  return {rows, issues, columns, periods};
}

export function detectTimetableRegions(width:number,height:number,rgba:Uint8ClampedArray):OcrBBox[]{
 return detectColorComponents(width,height,rgba).filter(c=>c.bbox.x1-c.bbox.x0>width/18&&c.bbox.x1-c.bbox.x0<width/4&&c.bbox.y1-c.bbox.y0>height/70&&c.bbox.y0>height*.07).map(c=>c.bbox).sort((a,b)=>a.y0-b.y0||a.x0-b.x0);
}
