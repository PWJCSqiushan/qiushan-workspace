/**
 * Browser-local receipt OCR helpers.
 *
 * Tesseract is deliberately loaded lazily. This keeps the normal finance
 * page small and makes it explicit that an image never travels to our API.
 * The UI must show the returned candidates and ask the user to confirm one
 * before creating a transaction.
 */

export type FinanceOcrCandidate = { cents: number; label: string };
export type FinanceOcrBoundingBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};
export type FinanceOcrLine = {
  text: string;
  confidence?: number;
  bbox?: FinanceOcrBoundingBox;
};
export type FinanceOcrResult = {
  candidates: FinanceOcrCandidate[];
  text: string;
  /** Position-aware lines are optional because older OCR workers only return text. */
  lines?: FinanceOcrLine[];
};

type TesseractWorker = {
  recognize: (
    image: Blob,
    options?: object,
    output?: { blocks: boolean },
  ) => Promise<{
    data: {
      text?: string;
      lines?: FinanceOcrLine[];
      blocks?: { paragraphs?: { lines?: FinanceOcrLine[] }[] }[];
    };
  }>;
  terminate: () => Promise<unknown>;
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const OCR_ASSET_PATH = '/ocr';
let workerPromise: Promise<TesseractWorker> | null = null;
let progressSink: ((status: string) => void) | undefined;

const PRIORITY_TERMS: Array<[RegExp, number]> = [
  [/实\s*付|实付金额|实际支付|付款金额|amount\s*paid|paid/i, 100],
  [/支付|已支付|付款|需支付|payment|pay/i, 85],
  [/合计|总计|应付|订单金额|消费金额|total|subtotal/i, 72],
  [/(?:¥|￥|RMB|CNY)/i, 60],
  [/金额|价格|小计|收款|amount|price/i, 42],
];

function compactWhitespace(value: string): string {
  return value
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/** Normalize common OCR variants without changing the original text returned to the caller. */
export function normalizeOcrText(value: string): string {
  return value
    .replace(/[０-９]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/[．。]/g, '.')
    .replace(/[，]/g, ',')
    .replace(/[￥]/g, '¥')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\u00a0/g, ' ');
}

function isExcludedLine(line: string): boolean {
  if (/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(line)) return true;
  if (/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(line)) return true;
  if (/\b\d+(?:[.,]\d+)?\s*%/.test(line)) return true;
  // A long contiguous digit run is normally a transaction/order/phone ID.
  if (/(?<![\d.])\d{8,}(?![\d.])/.test(line)) return true;
  return false;
}

function parseAmount(raw: string): number | null {
  let value = raw.replace(/,/g, '').replace(/\s/g, '');
  // For a comma decimal separator, the decimal form is preserved before the
  // generic comma removal in the caller. This path mainly serves OCR lines.
  if (/^\d+,\d{1,2}$/.test(raw.trim())) value = raw.trim().replace(',', '.');
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 9999999)
    return null;
  const cents = Math.round(numeric * 100);
  return cents >= 0 ? cents : null;
}

function scoreLine(line: string, raw: string, amountCents: number): number {
  let score = 10;
  for (const [term, weight] of PRIORITY_TERMS)
    if (term.test(line)) score += weight;
  if (/\d[.,]\d{1,2}/.test(raw)) score += 12;
  if (amountCents <= 100000) score += 2;
  return score;
}

function labelForLine(line: string, _raw: string): string {
  const text = line.replace(/\s/g, '');
  if (/实付|实际支付|付款金额|amountpaid|paid/i.test(text)) return '实付金额';
  if (/优惠|折扣|discount|coupon/i.test(text)) return '优惠金额';
  if (/合计|总计|订单金额|total/i.test(text)) return '订单合计';
  if (/支付|付款|payment|pay/i.test(text)) return '支付金额';
  return '截图金额';
}

/**
 * Extract conservative amount candidates from OCR text.
 *
 * This function intentionally returns several candidates. It never picks the
 * largest number and it rejects dates, percentages and long IDs before
 * scoring labels such as “实付” and “合计”.
 */
export function extractAmountCandidates(input: string): FinanceOcrCandidate[] {
  const normalized = normalizeOcrText(input);
  const candidates: Array<
    FinanceOcrCandidate & { score: number; index: number }
  > = [];
  const lines = normalized.split(/\n+/).map(compactWhitespace).filter(Boolean);
  const amountPattern =
    /(?<![\d.,])(?:¥|RMB|CNY)?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,7}(?:[.,]\d{1,2})?)(?![\d.,])/gi;

  lines.forEach((line, index) => {
    if (isExcludedLine(line)) return;
    amountPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = amountPattern.exec(line))) {
      const raw = match[1];
      const cents = parseAmount(raw);
      if (cents === null) continue;
      // Bare integer OCR fragments are accepted only when the line contains a
      // strong financial label. This avoids treating dates such as 09/24 as
      // money while still allowing “实付 18”.
      const hasStrongLabel = PRIORITY_TERMS.slice(0, 4).some(([term]) =>
        term.test(line),
      );
      if (
        !/[.,]\d{1,2}/.test(raw) &&
        !hasStrongLabel &&
        !/(?:¥|RMB|CNY)/i.test(line)
      )
        continue;
      const label = labelForLine(line, raw);
      candidates.push({
        cents,
        label,
        score: scoreLine(line, raw, cents),
        index,
      });
    }
  });

  // Preserve the strongest label for a duplicate amount while retaining the
  // source order for equal scores. The UI can therefore present 18.50 and
  // 20.00 together without silently selecting one.
  const unique = new Map<
    string,
    FinanceOcrCandidate & { score: number; index: number }
  >();
  for (const candidate of candidates) {
    const key = `${candidate.cents}:${candidate.label}`;
    const previous = unique.get(key);
    if (!previous || candidate.score > previous.score)
      unique.set(key, candidate);
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 6)
    .map(({ cents, label }) => ({ cents, label }));
}

async function createLocalWorker(): Promise<TesseractWorker> {
  // Tesseract is a browser-only optional dependency. The dynamic import keeps
  // OCR out of server rendering and lets the main app lazy-load it on demand.
  const tesseract = await import('tesseract.js');
  const createWorker = (tesseract as typeof import('tesseract.js'))
    .createWorker;
  return createWorker(['eng', 'chi_sim'], 1, {
    workerPath: `${OCR_ASSET_PATH}/worker.min.js`,
    corePath: OCR_ASSET_PATH,
    langPath: OCR_ASSET_PATH,
    gzip: false,
    cacheMethod: 'write',
    logger: (message: { status?: string; progress?: number }) => {
      const statusNames: Record<string, string> = {
        'loading tesseract core': '准备识别引擎',
        'initializing tesseract': '启动本机识别',
        'loading language traineddata': '准备中文识别',
        'initializing api': '准备完成',
        'recognizing text': '识别金额',
      };
      const percent =
        typeof message.progress === 'number'
          ? ` ${Math.round(message.progress * 100)}%`
          : '';
      progressSink?.(
        `${statusNames[message.status || ''] || '本机识别中'}${percent}`,
      );
    },
  }) as unknown as TesseractWorker;
}

/** Release the cached worker when a route or a long-lived client is closed. */
export async function terminateReceiptOcr(): Promise<void> {
  const current = workerPromise;
  workerPromise = null;
  if (!current) return;
  try {
    await (await current).terminate();
  } catch {
    /* worker already stopped */
  }
  progressSink = undefined;
}

/**
 * Recognize a locally selected receipt image.
 *
 * The returned text and candidates remain in the caller's memory. This module
 * does not call fetch or any finance API, and it never creates a transaction.
 */
export async function recognizeReceipt(
  file: Blob,
  onProgress?: (status: string) => void,
): Promise<FinanceOcrResult> {
  if (typeof window === 'undefined')
    throw new Error('收据 OCR 只在浏览器本地运行。');
  if (!(file instanceof Blob) || file.size === 0)
    throw new Error('请选择一张有效的收据图片。');
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error('图片超过 20 MB，请先压缩后再识别。');
  progressSink = onProgress;
  onProgress?.('准备本地识别');
  if (!workerPromise) workerPromise = createLocalWorker();
  try {
    const worker = await workerPromise;
    const result = await worker.recognize(file, {}, { blocks: true });
    const text = String(result.data?.text || '');
    const rawLines =
      result.data?.lines ||
      result.data?.blocks?.flatMap((b) =>
        (b.paragraphs || []).flatMap((p) => p.lines || []),
      );
    const lines = rawLines
      ?.filter((line) => String(line.text || '').trim())
      .map((line) => ({
        text: String(line.text || ''),
        ...(typeof line.confidence === 'number'
          ? { confidence: line.confidence }
          : {}),
        ...(line.bbox
          ? {
              bbox: {
                x0: Number(line.bbox.x0),
                y0: Number(line.bbox.y0),
                x1: Number(line.bbox.x1),
                y1: Number(line.bbox.y1),
              },
            }
          : {}),
      }));
    onProgress?.('候选金额已生成，请人工确认');
    return {
      text,
      candidates: extractAmountCandidates(text),
      ...(lines?.length ? { lines } : {}),
    };
  } catch (error) {
    workerPromise = null;
    throw new Error(
      `本地 OCR 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
