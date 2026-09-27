import type { FinanceImportRow } from './finance-imports.ts';
import {
  recognizeReceipt,
  type FinanceOcrBoundingBox,
  type FinanceOcrLine,
} from './finance-ocr.ts';
import type { FinanceMeal, FinanceState } from './finance-types.ts';

/**
 * A caller-owned alias.  The parser ships no private merchant aliases;
 * private dining-room names can be supplied by the caller without entering
 * the application bundle or a tracked fixture.
 */
export type CampusAlias =
  | {
      placeName: string;
      categoryId?: string;
    }
  | string;

export type CampusImportOptions = {
  year: number;
  imageHash: string;
  state?: FinanceState;
  aliases?: Record<string, CampusAlias>;
  mealCategoryId?: string;
  bathCategoryId?: string;
  defaultCategoryId?: string;
};

export type CampusImportImageOptions = Omit<
  CampusImportOptions,
  'imageHash'
> & {
  onProgress?: (status: string) => void;
};

export interface CampusImportRow extends FinanceImportRow {
  platform: 'campus';
  suggestedPlaceName?: string;
  suggestedCategoryId?: string;
  mealSlot?: FinanceMeal['meal'];
  requiresShareReview?: boolean;
  /** OCR-provided coordinates; absent when the worker only returns text. */
  bbox?: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  bboxConfidence?: number;
  /** A small, local-only crop of the original image for row-by-row review. */
  thumbnailDataUrl?: string;
  /** The OCR lines that produced this row, kept for an editable preview. */
  sourceFragment?: string;
}

export type CampusImportResult = {
  rows: CampusImportRow[];
  warnings: string[];
  expenseTotalCents: number | null;
  rechargeTotalCents: number | null;
};

export type CampusImageImportResult = CampusImportResult & {
  imageHash: string;
  /** OCR text is returned for the local review panel; it is never uploaded. */
  ocrText: string;
};

/**
 * No private dining names are bundled in the parser.  The page supplies its
 * own private alias catalog through CampusImportOptions.aliases.
 */
export const DEFAULT_CAMPUS_ALIASES: Record<string, CampusAlias> = {};

const DATE_RE =
  /(?<!\d)(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?:\s+|T)(\d{1,2})[:：](\d{2})(?::(\d{2}))?(?!\d)/;
// Require a following clock value so decimal amounts such as -16.57 are not
// mistaken for an invalid MM.DD date during the warning pass.
const DATE_LIKE_RE =
  /(?<![\d.+-])(?:\d{4}[-/.])?\d{1,2}[-/]\d{1,2}(?=\s+\d{1,2}[:：]\d{2})/;
const MONEY_RE =
  /(?<![\d.])([+-])?\s*(?:[¥￥]|RMB|CNY)?\s*(\d{1,7}(?:,\d{3})*(?:[.,]\d{1,2})?)(?![\d.])/gi;
const BATH_RE = /浴池|洗浴|澡堂|生活服务中心|洗衣|淋浴/;
const MEAL_RE =
  /食堂|餐厅|饭|米粉|拌饭|水饺|麻辣|烧烤|快餐|汉堡|面馆|面条|蛋包|鸡块|炒饭|汤饭|捞饭|餐饮/;
const HEADER_RE = /^(?:本月|支出|收入|余额|合计|总计|本期|消费金额|充值金额)/;
const META_RE =
  /^(?:消费|充值|转账|收入|支出|付款|交易成功|已完成|消费记录|充值记录)$/;

function cleanLine(value: string): string {
  return value
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(
      /[：，．￥]/g,
      (char) => ({ '：': ':', '，': ',', '．': '.', '￥': '¥' })[char] || char,
    )
    .replace(/[−‐‑‒–—]/g, '-')
    .replace(/＋/g, '+')
    .replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, '$1-$2-$3')
    .replace(/(\d{1,2})月(\d{1,2})日/g, '$1-$2')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r ]+/g, ' ')
    .trim();
}

function comparable(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s/\\·•,，:：()（）［］[\]{}「」“”"'`_—–-]/g, '');
}

function aliasFor(
  merchant: string,
  options: CampusImportOptions,
): { placeName: string; categoryId?: string } | undefined {
  const entries = [
    ...Object.entries(options.aliases || {}),
    ...Object.entries(DEFAULT_CAMPUS_ALIASES),
  ];
  const value = comparable(merchant);
  const matches = entries
    .map(([key, alias]) => ({
      key: comparable(key),
      alias: typeof alias === 'string' ? { placeName: alias } : alias,
    }))
    .filter((entry) => entry.key && value.includes(entry.key))
    .sort((left, right) => right.key.length - left.key.length);
  return matches[0]?.alias;
}

function parseDate(
  line: string,
  year: number,
): { iso: string; ms: number } | null {
  const match = cleanLine(line).match(DATE_RE);
  if (!match) return null;
  const actualYear = Number(match[1] || year);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  if (
    !Number.isInteger(actualYear) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const ms = Date.UTC(actualYear, month - 1, day, hour - 8, minute, second);
  const check = new Date(ms);
  // Check the local calendar after applying the China timezone offset. This
  // rejects OCR values such as 02-31 instead of silently rolling into March.
  const local = new Date(ms + 8 * 3600000);
  if (
    !Number.isFinite(ms) ||
    local.getUTCFullYear() !== actualYear ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  )
    return null;
  return { iso: check.toISOString(), ms };
}

type MoneyToken = {
  cents: number;
  sign: -1 | 0 | 1;
  signed: boolean;
  source: string;
  index: number;
};

function moneyTokens(line: string): MoneyToken[] {
  const result: MoneyToken[] = [];
  MONEY_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MONEY_RE.exec(line))) {
    const source = match[0];
    const rawNumber = match[2];
    const numberText = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(rawNumber)
      ? rawNumber.replace(/,/g, '')
      : rawNumber.replace(',', '.');
    const value = Number(numberText);
    if (!Number.isFinite(value) || value > 9_999_999) continue;
    const signed = Boolean(match[1]);
    const hasCurrency = /¥|RMB|CNY/i.test(source);
    const hasDecimal = /[.,]\d{1,2}/.test(numberText);
    // Bare integers in dates, phone numbers and row labels are not amounts.
    if (!signed && !hasCurrency && !hasDecimal) continue;
    const cents = Math.round(value * 100);
    result.push({
      cents,
      sign: match[1] === '-' ? -1 : match[1] === '+' ? 1 : 0,
      signed,
      source,
      index: match.index,
    });
  }
  return result;
}

function summaryAmount(line: string, label: RegExp): number | null {
  if (!label.test(line)) return null;
  return moneyTokens(line)[0]?.cents ?? null;
}

function mealSlotFor(date: string): FinanceMeal['meal'] | undefined {
  // occurredAt is stored as UTC ISO, while meal windows are local China time.
  const hour = (Number(date.slice(11, 13)) + 8) % 24;
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 21) return 'dinner';
  return undefined;
}

function shanghaiDate(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms + 8 * 3600000).toISOString().slice(0, 10)
    : iso.slice(0, 10);
}

function findCategoryId(
  state: FinanceState | undefined,
  explicit: string | undefined,
  names: string[],
): string | undefined {
  if (explicit) return explicit;
  if (!state) return undefined;
  const exact = state.categories.find((category) =>
    names.includes(category.name),
  );
  if (exact) return exact.id;
  const fuzzy = state.categories.find((category) =>
    names.some(
      (name) => category.name.includes(name) || name.includes(category.name),
    ),
  );
  return fuzzy?.id;
}

function isMealcardAccount(
  state: FinanceState,
  id: string | undefined,
): boolean {
  if (!id) return false;
  const account = state.accounts.find((item) => item.id === id);
  return Boolean(account && /饭卡|校园卡|一卡通|食堂卡/.test(account.name));
}

function candidateIds(
  row: {
    amountCents: number;
    occurredAt: string;
    recharge: boolean;
    sourceKey: string;
  },
  state: FinanceState | undefined,
): string[] {
  if (!state || !row.occurredAt || row.amountCents <= 0) return [];
  const rowMs = Date.parse(row.occurredAt);
  if (!Number.isFinite(rowMs)) return [];
  return state.transactions
    .filter((transaction) => {
      if (transaction.deleted || transaction.amountCents !== row.amountCents)
        return false;
      if (transaction.sourceKey === row.sourceKey) return false;
      const txMs = Date.parse(transaction.occurredAt);
      if (!Number.isFinite(txMs)) return false;
      if (row.recharge) {
        return (
          transaction.kind === 'transfer' &&
          (isMealcardAccount(state, transaction.accountId) ||
            isMealcardAccount(state, transaction.targetAccountId)) &&
          Math.abs(txMs - rowMs) <= 3 * 60 * 1000
        );
      }
      return (
        (transaction.kind === 'expense' || transaction.kind === 'refund') &&
        Math.abs(txMs - rowMs) <= 24 * 60 * 60 * 1000
      );
    })
    .map((transaction) => transaction.id);
}

function likelyMerchant(line: string): boolean {
  const value = cleanLine(line);
  if (!value || HEADER_RE.test(value) || META_RE.test(value)) return false;
  if (DATE_RE.test(value)) return false;
  const withoutAmount = value.replace(MONEY_RE, '').trim();
  if (!withoutAmount) return false;
  if (/^(?:[-+]?\d+(?:\.\d{1,2})?|[¥￥])$/.test(withoutAmount)) return false;
  if (/^(?:筛选|本月|支出|收入|余额|更多|账单|搜索)/.test(withoutAmount))
    return false;
  return /[\u4e00-\u9fffA-Za-z]/.test(withoutAmount);
}

function merchantFrom(lines: string[]): string {
  const candidates = lines.filter(likelyMerchant);
  const candidate =
    candidates.find((line) =>
      /餐厅|食堂|浴池|充值|转账/.test(line.replace(/\s/g, '')),
    ) || candidates[0];
  if (candidate) {
    return cleanLine(candidate)
      .replace(MONEY_RE, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
  return '';
}

function typeFrom(lines: string[]): string {
  const line = lines.find((value) => /充值|消费|转账|付款/.test(value));
  return line ? cleanLine(line).slice(0, 80) : '';
}

function isRecharge(lines: string[], token: MoneyToken | undefined): boolean {
  const text = lines.join(' ');
  return (
    /充值|充入|饭卡转账/.test(text) ||
    (/微信支付转账|支付宝转账/.test(text) && token?.sign === 1)
  );
}

function normalizeImageHash(value: string): string {
  const hash = String(value || '').trim();
  if (!hash) throw new Error('饭卡导入需要图片指纹');
  return hash.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
}

function visualText(value: string): string {
  return cleanLine(value)
    .toLowerCase()
    .replace(/[\s/\\·•,，:：()（）［］[\]{}「」“”"'`_—–\-.]/g, '');
}

function rowVisualTokens(row: CampusImportRow): {
  merchant: string;
  amount: string;
  date: string;
  time: string;
} {
  const ms = Date.parse(row.occurredAt);
  const local = new Date(ms + 8 * 3600000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    merchant: visualText(row.merchant),
    amount: visualText((row.amountCents / 100).toFixed(2)),
    date: `${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}`,
  };
}

/**
 * Match a parsed row to OCR-reported text lines only when the line contains
 * concrete evidence (date/time, amount, or merchant prefix). There is no
 * uniform-row-height guess, so a missing/ambiguous match simply has no bbox.
 */
function bboxForRow(
  row: CampusImportRow,
  lines: FinanceOcrLine[] | undefined,
  after: number,
): { index: number; bbox?: CampusImportRow['bbox']; confidence?: number } {
  if (!lines?.length || !row.occurredAt) return { index: after };
  const tokens = rowVisualTokens(row);
  let best: { index: number; score: number; line: FinanceOcrLine } | undefined;
  lines.forEach((line, index) => {
    if (index < after || !line.bbox) return;
    const value = visualText(line.text);
    if (!value) return;
    let score = 0;
    if (tokens.amount && value.includes(tokens.amount)) score += 50;
    if (tokens.date && value.includes(tokens.date)) score += 35;
    if (tokens.time && value.includes(tokens.time)) score += 35;
    if (tokens.merchant) {
      const prefix = tokens.merchant.slice(
        0,
        Math.min(8, tokens.merchant.length),
      );
      if (prefix.length >= 4 && value.includes(prefix)) score += 70;
    }
    if (score < 50) return;
    if (
      !best ||
      score > best.score ||
      (score === best.score && index < best.index)
    )
      best = { index, score, line };
  });
  if (!best) return { index: after };
  const box = best.line.bbox;
  if (!box) return { index: best.index + 1 };
  const valid = [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite);
  return valid
    ? {
        index: best.index + 1,
        bbox: { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 },
        confidence: best.line.confidence,
      }
    : { index: best.index + 1 };
}

function validBbox(
  box: FinanceOcrBoundingBox | undefined,
): box is FinanceOcrBoundingBox {
  return Boolean(
    box &&
    [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) &&
    box.x1 > box.x0 &&
    box.y1 > box.y0,
  );
}

function unionBboxes(
  boxes: FinanceOcrBoundingBox[],
): FinanceOcrBoundingBox | undefined {
  if (!boxes.length) return undefined;
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

/**
 * Attach the real OCR coordinates to parsed rows.
 *
 * Tesseract returns one visual line for a merchant, amount, or timestamp in
 * many screenshots.  A row box is therefore the union of the nearby evidence
 * lines around the best textual match.  The search is monotonic and stops at
 * the next date anchor; it never estimates a row position from an even grid.
 */
export function assignCampusRowBoxes(
  rows: CampusImportRow[],
  lines: FinanceOcrLine[] | undefined,
): CampusImportRow[] {
  if (!lines?.length) return rows.map((row) => ({ ...row }));
  let cursor = 0;
  return rows.map((row) => {
    const match = bboxForRow(row, lines, cursor);
    const bestIndex = match.index - 1;
    if (
      !match.bbox ||
      bestIndex < cursor ||
      bestIndex >= lines.length ||
      !validBbox(match.bbox)
    )
      return { ...row };

    const tokens = rowVisualTokens(row);
    const bestText = visualText(lines[bestIndex]?.text || '');
    let start = bestIndex;
    // Merchant and amount commonly sit immediately above the date line.
    for (
      let index = bestIndex - 1;
      index >= cursor && bestIndex - index <= 4;
      index--
    ) {
      if (index !== bestIndex && DATE_LIKE_RE.test(lines[index].text)) break;
      start = index;
    }

    let end = bestIndex;
    const bestHasTimestamp =
      bestText.includes(tokens.date) && bestText.includes(tokens.time);
    if (!bestHasTimestamp) {
      // If the best evidence was the merchant or amount, include the following
      // timestamp line in the same visual row, if present.
      for (
        let index = bestIndex + 1;
        index < lines.length && index - bestIndex <= 4;
        index++
      ) {
        if (DATE_LIKE_RE.test(lines[index].text)) {
          const value = visualText(lines[index].text);
          if (value.includes(tokens.date) && value.includes(tokens.time))
            end = index;
          break;
        }
        end = index;
      }
    }

    const bboxes = lines
      .slice(start, end + 1)
      .map((line) => line.bbox)
      .filter(validBbox);
    const bbox = unionBboxes(bboxes);
    if (!bbox) return { ...row };
    const confidences = lines
      .slice(start, end + 1)
      .map((line) => line.confidence)
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      );
    cursor = end + 1;
    return {
      ...row,
      bbox,
      ...(confidences.length
        ? { bboxConfidence: Math.min(...confidences) }
        : {}),
    };
  });
}

type CampusImageSource = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

async function decodeCampusImage(file: Blob): Promise<CampusImageSource> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('原图无法解码'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function campusThumbnail(
  image: CampusImageSource,
  bbox: FinanceOcrBoundingBox,
): string | undefined {
  if (!validBbox(bbox) || image.width <= 0 || image.height <= 0)
    return undefined;
  const padX = Math.max(12, (bbox.x1 - bbox.x0) * 0.12);
  const padY = Math.max(10, (bbox.y1 - bbox.y0) * 0.22);
  const sx = Math.max(0, Math.floor(bbox.x0 - padX));
  const sy = Math.max(0, Math.floor(bbox.y0 - padY));
  const ex = Math.min(image.width, Math.ceil(bbox.x1 + padX));
  const ey = Math.min(image.height, Math.ceil(bbox.y1 + padY));
  const width = ex - sx;
  const height = ey - sy;
  if (width <= 0 || height <= 0) return undefined;
  const scale = Math.min(1, 1200 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return undefined;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image.source,
    sx,
    sy,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  try {
    return canvas.toDataURL('image/jpeg', 0.84);
  } catch {
    return undefined;
  }
}

async function addCampusThumbnails(
  file: Blob,
  rows: CampusImportRow[],
): Promise<CampusImportRow[]> {
  if (!rows.some((row) => row.bbox)) return rows;
  let image: CampusImageSource;
  try {
    image = await decodeCampusImage(file);
  } catch {
    // OCR data remains useful even when a browser cannot decode the image.
    return rows.map((row) => ({ ...row }));
  }
  try {
    return rows.map((row) => {
      if (!row.bbox) return { ...row };
      const thumbnailDataUrl = campusThumbnail(image, row.bbox);
      return thumbnailDataUrl ? { ...row, thumbnailDataUrl } : { ...row };
    });
  } finally {
    image.dispose();
  }
}

/**
 * Parse OCR text from the campus account list. The parser uses dates as row
 * boundaries, ignores page totals, and keeps every dated row even when one
 * field is uncertain so that the UI can show it for correction.
 */
export function parseCampusOcr(
  text: string,
  options: CampusImportOptions,
): CampusImportResult {
  if (
    !Number.isInteger(options.year) ||
    options.year < 2000 ||
    options.year > 2100
  )
    throw new Error('饭卡导入年份无效');
  const imageHash = normalizeImageHash(options.imageHash);
  const lines = String(text || '')
    .replace(
      /((?:\d{4}[-/.])?\d{1,2}[-/.]\d{1,2})\s*\n\s*(\d{1,2}[:：]\d{2})/g,
      '$1 $2',
    )
    .split(/\n+/)
    .map(cleanLine)
    .filter(Boolean);
  if (!lines.length)
    return {
      rows: [],
      warnings: ['OCR 没有识别到饭卡账单文字'],
      expenseTotalCents: null,
      rechargeTotalCents: null,
    };

  const anchors: Array<{
    lineIndex: number;
    date: { iso: string; ms: number };
  }> = [];
  const warnings: string[] = [];
  lines.forEach((line, lineIndex) => {
    if (!DATE_LIKE_RE.test(line)) return;
    const date = parseDate(line, options.year);
    if (date) anchors.push({ lineIndex, date });
    else warnings.push(`第 ${lineIndex + 1} 行日期无法识别，请核对`);
  });
  if (!anchors.length) {
    return {
      rows: [],
      warnings: [...warnings, '没有找到带日期的饭卡交易行'],
      expenseTotalCents: null,
      rechargeTotalCents: null,
    };
  }

  const firstDate = anchors[0].lineIndex;
  let reportedExpense: number | null = null;
  let reportedRecharge: number | null = null;
  for (const line of lines.slice(0, firstDate)) {
    reportedExpense ??= summaryAmount(line, /支出/);
    reportedRecharge ??= summaryAmount(line, /收入|充值/);
  }

  const rows: CampusImportRow[] = [];
  anchors.forEach((anchor, index) => {
    const previous = index ? anchors[index - 1].lineIndex + 1 : 0;
    const fragmentLines = lines.slice(previous, anchor.lineIndex + 1);
    const fragment = fragmentLines.join('\n').slice(0, 1200);
    const merchant = merchantFrom(fragmentLines);
    const transactionLines = fragmentLines.filter(
      (line) => !HEADER_RE.test(line),
    );
    const type = typeFrom(transactionLines);
    const entries = fragmentLines.flatMap((line) =>
      moneyTokens(line).map((token) => ({ ...token, line })),
    );
    const transactionEntries = entries.filter(
      (entry) =>
        !HEADER_RE.test(entry.line) && !/^(?:收入|支出)\b/.test(entry.line),
    );
    const signed = transactionEntries.filter((entry) => entry.signed);
    const token =
      signed[0] || transactionEntries[transactionEntries.length - 1];
    const rowWarnings: string[] = [];
    const amountCents = token?.cents || 0;
    const recharge = isRecharge(transactionLines, token);
    const signKnown = Boolean(token?.signed);
    if (!token) rowWarnings.push('金额未识别，请核对原图');
    if (token && !signKnown)
      rowWarnings.push('金额未明确标示正负，请核对充值或扣费方向');
    const bath = BATH_RE.test(merchant);
    const alias = !recharge && !bath ? aliasFor(merchant, options) : undefined;
    const meal =
      !recharge && !bath && (MEAL_RE.test(merchant) || Boolean(alias));
    const slot = meal ? mealSlotFor(anchor.date.iso) : undefined;
    const suggestedPlaceName = meal
      ? alias?.placeName || merchant || undefined
      : undefined;
    const suggestedCategoryId = bath
      ? findCategoryId(options.state, options.bathCategoryId, [
          '洗衣及生活服务',
          '日用购物与服务',
        ]) || options.defaultCategoryId
      : meal
        ? alias?.categoryId ||
          findCategoryId(options.state, options.mealCategoryId, [
            '日常三餐',
            '学校食堂',
          ]) ||
          options.defaultCategoryId
        : undefined;
    if (bath) rowWarnings.push('浴池扣费不是餐饮，不自动生成用餐记录');
    if (meal && !alias)
      rowWarnings.push('餐厅名称未匹配现有地点，请在导入预览中选择');
    if (recharge)
      rowWarnings.push('饭卡充值不是消费，请与饭卡转账候选核对后再关联');
    if (!merchant) rowWarnings.push('商户名称未识别，请核对原图');
    if (meal && !slot) rowWarnings.push('时间不在早午晚餐常用时段，请核对餐次');
    // The ordinal is the original transaction row order, rather than an OCR
    // line offset.  OCR may wrap a merchant into several visual lines while
    // the source row remains the same and therefore idempotent.
    const sourceKey = `campus:${imageHash}:${index + 1}`;
    const candidates = candidateIds(
      {
        amountCents,
        occurredAt: anchor.date.iso,
        recharge,
        sourceKey,
      },
      options.state,
    );
    if (candidates.length)
      rowWarnings.push('发现可能的已有记录，仅作候选，不自动合并');
    const duplicateId = options.state?.transactions.find(
      (transaction) => transaction.sourceKey === sourceKey,
    )?.id;
    rows.push({
      id: `${sourceKey}:${index + 1}`,
      row: index + 1,
      platform: 'campus',
      occurredAt: anchor.date.iso,
      amountCents,
      merchant,
      description: type || merchant,
      payment: '饭卡',
      direction: recharge ? '充值' : '支出',
      rawType: type || (recharge ? '充值' : '消费'),
      status: '待核对',
      sourceKey,
      suggestedKind:
        recharge ||
        !token ||
        token.sign === 1 ||
        (token.sign === 0 && !/消费|扣费|扣款/.test(type))
          ? null
          : 'expense',
      warnings: rowWarnings,
      duplicateId,
      candidates,
      ...(suggestedPlaceName ? { suggestedPlaceName } : {}),
      ...(suggestedCategoryId ? { suggestedCategoryId } : {}),
      ...(slot ? { mealSlot: slot } : {}),
      sourceFragment: fragment,
    });
  });

  const mealGroups = new Map<string, CampusImportRow[]>();
  for (const row of rows) {
    if (!row.mealSlot) continue;
    const key = `${shanghaiDate(row.occurredAt)}:${row.mealSlot}`;
    const group = mealGroups.get(key) || [];
    group.push(row);
    mealGroups.set(key, group);
  }
  for (const group of mealGroups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.requiresShareReview = true;
      row.warnings.push('同日同餐有多笔扣费，请确认是否本人承担、AA或请客');
    }
  }

  const expenseRows = rows.filter(
    (row) => row.suggestedKind === 'expense' && row.amountCents > 0,
  );
  const rechargeRows = rows.filter(
    (row) => row.direction === '充值' && row.amountCents > 0,
  );
  const expenseTotalCents = expenseRows.length
    ? expenseRows.reduce((sum, row) => sum + row.amountCents, 0)
    : null;
  const rechargeTotalCents = rechargeRows.length
    ? rechargeRows.reduce((sum, row) => sum + row.amountCents, 0)
    : null;
  if (reportedExpense !== null && expenseTotalCents !== reportedExpense)
    warnings.push(
      `识别支出合计 ¥${((expenseTotalCents || 0) / 100).toFixed(2)} 与页头 ¥${(reportedExpense / 100).toFixed(2)} 不一致，请核对`,
    );
  if (reportedRecharge !== null && rechargeTotalCents !== reportedRecharge)
    warnings.push(
      `识别充值合计 ¥${((rechargeTotalCents || 0) / 100).toFixed(2)} 与页头 ¥${(reportedRecharge / 100).toFixed(2)} 不一致，请核对`,
    );
  if (rows.some((row) => row.amountCents === 0))
    warnings.push('存在金额缺失的日期行，已保留为待核对草稿');
  return { rows, warnings, expenseTotalCents, rechargeTotalCents };
}

export async function campusImageFingerprint(file: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('当前浏览器不支持本地图片指纹');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

/** OCR and parsing remain entirely in the browser; no image is sent to an API. */
export async function recognizeCampusBillImage(
  file: File,
  options: CampusImportImageOptions,
): Promise<CampusImageImportResult> {
  if (typeof window === 'undefined')
    throw new Error('饭卡截图 OCR 只在浏览器本地运行');
  if (!(file instanceof Blob) || file.size === 0)
    throw new Error('请选择一张有效的饭卡账单截图');
  const imageHash = await campusImageFingerprint(file);
  const recognized = await recognizeReceipt(file, options.onProgress);
  const parsed = parseCampusOcr(recognized.text, { ...options, imageHash });
  options.onProgress?.('正在生成原图逐行预览');
  const rowsWithBoxes = assignCampusRowBoxes(parsed.rows, recognized.lines);
  const rows = await addCampusThumbnails(file, rowsWithBoxes);
  return { ...parsed, rows, imageHash, ocrText: recognized.text };
}
