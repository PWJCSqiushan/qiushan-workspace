/**
 * Public market adapters for the investment page.
 *
 * This module deliberately has no Node, Python, database, cookie, or account
 * dependencies.  It is safe to import from a Cloudflare Worker.  Every URL is
 * assembled from a validated public endpoint and a six digit instrument code;
 * callers cannot provide an arbitrary upstream URL.
 */

export type InstrumentKind = 'etf' | 'stock' | 'fund' | 'index';
export type Exchange = 'SH' | 'SZ' | 'OF';
export type SnapshotStatus = 'fresh' | 'stale' | 'missing';

export interface Instrument {
  id: string;
  kind: InstrumentKind;
  exchange: Exchange;
  code: string;
  name: string;
}

export interface Quote {
  price: number | null;
  change_pct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  preclose: number | null;
  volume: number | null;
  amount: number | null;
}

export interface HistoryRow {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  amount: number | null;
}

export interface Metrics {
  ma20: number | null;
  ma60: number | null;
  return_20d: number | null;
  range_120d: number | null;
  history_count: number;
}

export interface SourceAttempt {
  source: string;
  role: 'quote' | 'history' | 'market' | 'search';
  url: string;
  status: 'ok' | 'error';
  error?: string;
}

export interface Evidence {
  id: string;
  title: string;
  url: string;
  source: string;
  published_at: string | null;
  kind: string;
  summary?: string;
}

export interface Snapshot {
  snapshot_id: string;
  instrument_id: string;
  source: string;
  source_url: string | null;
  quote_source: string | null;
  quote_source_url: string | null;
  history_source: string | null;
  history_source_url: string | null;
  quote_as_of: string | null;
  as_of: string | null;
  fetched_at: string;
  status: SnapshotStatus;
  error: string | null;
  quote: Quote;
  history: HistoryRow[];
  history_as_of: string | null;
  history_status: SnapshotStatus;
  units: {
    price: string;
    volume: string;
    amount: string;
  };
  adjustment: 'none';
  valuation_kind: 'market_price' | 'confirmed_nav';
  metrics: Metrics;
  fundamentals: never[];
  evidence: Evidence[];
  warnings: string[];
  source_attempts: SourceAttempt[];
}

export interface MarketBreadth {
  up: number | null;
  down: number | null;
  flat: number | null;
  total: number | null;
  amount: number | null;
}

export interface MarketSentiment {
  limit_up: number | null;
  limit_down: number | null;
  broken: number | null;
  broken_rate: number | null;
  max_streak: number | null;
}

export interface Market {
  snapshot_id: string;
  date: string | null;
  status: SnapshotStatus;
  fetched_at: string;
  source: string;
  source_url: string | null;
  breadth: MarketBreadth;
  sentiment: MarketSentiment;
  flow: {
    northbound: number | null;
    northbound_note: string;
    main: number | null;
    main_note: string;
  };
  evidence: never[];
  missing_fields: string[];
  warnings: string[];
  source_attempts: SourceAttempt[];
}

export const VALIDATED_ORIGINS = Object.freeze([
  'https://push2.eastmoney.com',
  'https://push2his.eastmoney.com',
  'https://88.push2.eastmoney.com',
  'https://qt.gtimg.cn',
  'https://web.ifzq.gtimg.cn',
  'https://quotes.sina.cn',
  'https://fund.eastmoney.com',
]);

const ENDPOINTS = Object.freeze({
  eastmoney_quote: 'https://push2.eastmoney.com/api/qt/stock/get',
  eastmoney_history: 'https://push2his.eastmoney.com/api/qt/stock/kline/get',
  tencent_quote: 'https://qt.gtimg.cn/q=',
  tencent_history: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
  sina_history:
    'https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketData.getKLineData',
  eastmoney_fund_nav: 'https://fund.eastmoney.com/pingzhongdata/',
  eastmoney_etf_list: 'https://88.push2.eastmoney.com/api/qt/clist/get',
  eastmoney_market_full: 'https://push2.eastmoney.com/api/qt/clist/get',
});

/** Public observation samples from the source project's SEEDS list. */
export const SEEDS: readonly Instrument[] = Object.freeze([
  {
    id: 'etf:SH:510300',
    kind: 'etf',
    exchange: 'SH',
    code: '510300',
    name: '沪深300ETF华泰柏瑞',
  },
  {
    id: 'etf:SH:510500',
    kind: 'etf',
    exchange: 'SH',
    code: '510500',
    name: '中证500ETF南方',
  },
  {
    id: 'etf:SZ:159915',
    kind: 'etf',
    exchange: 'SZ',
    code: '159915',
    name: '创业板ETF易方达',
  },
  {
    id: 'stock:SH:600519',
    kind: 'stock',
    exchange: 'SH',
    code: '600519',
    name: '贵州茅台',
  },
  {
    id: 'stock:SZ:000001',
    kind: 'stock',
    exchange: 'SZ',
    code: '000001',
    name: '平安银行',
  },
  {
    id: 'fund:OF:110022',
    kind: 'fund',
    exchange: 'OF',
    code: '110022',
    name: '易方达消费行业股票',
  },
  {
    id: 'fund:OF:000001',
    kind: 'fund',
    exchange: 'OF',
    code: '000001',
    name: '华夏成长混合',
  },
  {
    id: 'index:SH:000001',
    kind: 'index',
    exchange: 'SH',
    code: '000001',
    name: '上证指数',
  },
  {
    id: 'index:SZ:399001',
    kind: 'index',
    exchange: 'SZ',
    code: '399001',
    name: '深证成指',
  },
  {
    id: 'index:SZ:399006',
    kind: 'index',
    exchange: 'SZ',
    code: '399006',
    name: '创业板指',
  },
]);

const INDEXES: readonly Instrument[] = Object.freeze([
  {
    id: 'index:SH:000001',
    kind: 'index',
    exchange: 'SH',
    code: '000001',
    name: '上证指数',
  },
  {
    id: 'index:SZ:399001',
    kind: 'index',
    exchange: 'SZ',
    code: '399001',
    name: '深证成指',
  },
  {
    id: 'index:SZ:399006',
    kind: 'index',
    exchange: 'SZ',
    code: '399006',
    name: '创业板指',
  },
  {
    id: 'index:SH:000300',
    kind: 'index',
    exchange: 'SH',
    code: '000300',
    name: '沪深300',
  },
  {
    id: 'index:SH:000905',
    kind: 'index',
    exchange: 'SH',
    code: '000905',
    name: '中证500',
  },
  {
    id: 'index:SH:000852',
    kind: 'index',
    exchange: 'SH',
    code: '000852',
    name: '中证1000',
  },
  { id: 'index:SH:000688', kind: 'index', exchange: 'SH', code: '科创50' },
] as Instrument[]);

const EMPTY_QUOTE: Quote = {
  price: null,
  change_pct: null,
  open: null,
  high: null,
  low: null,
  preclose: null,
  volume: null,
  amount: null,
};

const EMPTY_SENTIMENT: MarketSentiment = {
  limit_up: null,
  limit_down: null,
  broken: null,
  broken_rate: null,
  max_streak: null,
};

class SourceFailure extends Error {
  readonly source: string;
  readonly url: string;
  attempts?: SourceAttempt[];

  constructor(source: string, url: string, message: string) {
    super(message);
    this.name = 'SourceFailure';
    this.source = source;
    this.url = url;
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  return '';
}

function finiteNumber(value: unknown, scale = 1): number | null {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === '-' ||
    value === '--'
  )
    return null;
  const raw =
    typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return parsed / scale;
}

function validDate(value: unknown): string | null {
  const raw = textOf(value).trim();
  const text = /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
    : raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) ? text : null;
}

function shanghaiDate(value = new Date()): string {
  return new Date(value.getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

function queryUrl(
  base: string,
  params: Record<string, string | number | undefined>,
): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    pairs.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }
  return pairs.length ? `${base}?${pairs.join('&')}` : base;
}

function isValidatedUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  return (
    url === ENDPOINTS.eastmoney_quote ||
    url.startsWith(`${ENDPOINTS.eastmoney_quote}?`) ||
    url === ENDPOINTS.eastmoney_history ||
    url.startsWith(`${ENDPOINTS.eastmoney_history}?`) ||
    url === ENDPOINTS.tencent_quote ||
    url.startsWith(ENDPOINTS.tencent_quote) ||
    url === ENDPOINTS.tencent_history ||
    url.startsWith(`${ENDPOINTS.tencent_history}?`) ||
    url === ENDPOINTS.sina_history ||
    url.startsWith(`${ENDPOINTS.sina_history}?`) ||
    /^https:\/\/fund\.eastmoney\.com\/pingzhongdata\/\d{6}\.js(?:\?.*)?$/.test(
      url,
    ) ||
    url === ENDPOINTS.eastmoney_etf_list ||
    url.startsWith(`${ENDPOINTS.eastmoney_etf_list}?`) ||
    url === ENDPOINTS.eastmoney_market_full ||
    url.startsWith(`${ENDPOINTS.eastmoney_market_full}?`)
  );
}

function validatedUrl(url: string): string {
  if (!isValidatedUrl(url)) throw new Error('unvalidated public source URL');
  return url;
}

function sourceError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, 300);
}

async function requestText(url: string, timeoutMs = 8_000): Promise<string> {
  const safeUrl = validatedUrl(url);
  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      globalThis.fetch(safeUrl, {
        method: 'GET',
        headers: { Accept: 'application/json,text/plain,*/*' },
        signal: controller?.signal,
      }),
      timeout,
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (typeof response.text === 'function') return await response.text();
    if (typeof response.arrayBuffer === 'function')
      return new TextDecoder().decode(await response.arrayBuffer());
    throw new Error('response has no text body');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function requestJson(
  url: string,
  source: string,
): Promise<Record<string, unknown>> {
  try {
    const text = await requestText(url);
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('unexpected JSON shape');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SourceFailure) throw error;
    throw new SourceFailure(source, url, sourceError(error));
  }
}

function codeOf(instrument: Instrument): string {
  return instrument.code;
}

function secidOf(instrument: Instrument): string {
  return `${instrument.exchange === 'SH' ? '1' : '0'}.${codeOf(instrument)}`;
}

function tencentSymbol(instrument: Instrument): string {
  return `${instrument.exchange === 'SH' ? 'sh' : 'sz'}${codeOf(instrument)}`;
}

function parseSourceTimestamp(value: unknown): string | null {
  const text = textOf(value).replace(/\.0+$/, '');
  if (/^20\d{12}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}+08:00`;
  }
  if (/^20\d{6}$/.test(text))
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const number = finiteNumber(value);
  if (number !== null && number > 1_000_000_000) {
    const millis = number < 100_000_000_000 ? number * 1_000 : number;
    const parsed = new Date(millis);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function emptyMetrics(history: HistoryRow[]): Metrics {
  return {
    ma20: null,
    ma60: null,
    return_20d: null,
    range_120d: null,
    history_count: history.length,
  };
}

function metrics(history: HistoryRow[], enabled: boolean): Metrics {
  if (!enabled) return emptyMetrics(history);
  const closes = history
    .map((row) => row.close)
    .filter((value) => Number.isFinite(value));
  const ma20 =
    closes.length >= 20
      ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20
      : null;
  const ma60 =
    closes.length >= 60
      ? closes.slice(-60).reduce((a, b) => a + b, 0) / 60
      : null;
  const return20 =
    closes.length >= 21 && closes[closes.length - 21] !== 0
      ? (closes[closes.length - 1] / closes[closes.length - 21] - 1) * 100
      : null;
  const window = closes.slice(-120);
  const min = window.length >= 120 ? Math.min(...window) : null;
  const max = window.length >= 120 ? Math.max(...window) : null;
  const range =
    min !== null && max !== null && max !== min
      ? ((window[window.length - 1] - min) / (max - min)) * 100
      : null;
  return {
    ma20,
    ma60,
    return_20d: return20,
    range_120d: range,
    history_count: history.length,
  };
}

function cleanHistory(input: unknown): HistoryRow[] {
  if (!Array.isArray(input)) return [];
  const rows: HistoryRow[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const date = validDate(row.date);
    const close = finiteNumber(row.close);
    if (!date || close === null || seen.has(date)) continue;
    seen.add(date);
    rows.push({
      date,
      open: finiteNumber(row.open),
      high: finiteNumber(row.high),
      low: finiteNumber(row.low),
      close,
      volume: finiteNumber(row.volume),
      amount: finiteNumber(row.amount),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function cleanQuote(input: unknown): Quote {
  const row =
    input && typeof input === 'object'
      ? (input as Record<string, unknown>)
      : {};
  return {
    price: finiteNumber(row.price),
    change_pct: finiteNumber(row.change_pct),
    open: finiteNumber(row.open),
    high: finiteNumber(row.high),
    low: finiteNumber(row.low),
    preclose: finiteNumber(row.preclose),
    volume: finiteNumber(row.volume),
    amount: finiteNumber(row.amount),
  };
}

function errorAttempt(
  source: string,
  role: SourceAttempt['role'],
  url: string,
  error: unknown,
): SourceAttempt {
  return { source, role, url, status: 'error', error: sourceError(error) };
}

function okAttempt(
  source: string,
  role: SourceAttempt['role'],
  url: string,
): SourceAttempt {
  return { source, role, url, status: 'ok' };
}

function quoteUnits(kind: InstrumentKind): {
  price: string;
  volume: string;
  amount: string;
} {
  return {
    price:
      kind === 'fund' || kind === 'etf'
        ? '元/份'
        : kind === 'index'
          ? '指数点位'
          : '元/股',
    volume: kind === 'fund' || kind === 'etf' ? '份' : '股',
    amount: '元',
  };
}

function previousSnapshot(input: unknown): Snapshot | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Partial<Snapshot>;
  if (typeof row.instrument_id !== 'string') return null;
  const history = cleanHistory(row.history);
  const quote = cleanQuote(row.quote);
  const sourceUrl = isValidatedUrl(row.source_url) ? row.source_url : null;
  const quoteSourceUrl = isValidatedUrl(row.quote_source_url)
    ? row.quote_source_url
    : null;
  const historySourceUrl = isValidatedUrl(row.history_source_url)
    ? row.history_source_url
    : null;
  return {
    snapshot_id: typeof row.snapshot_id === 'string' ? row.snapshot_id : '',
    instrument_id: row.instrument_id,
    source: typeof row.source === 'string' ? row.source : 'unknown',
    source_url: sourceUrl,
    quote_source:
      typeof row.quote_source === 'string' ? row.quote_source : null,
    quote_source_url: quoteSourceUrl,
    history_source:
      typeof row.history_source === 'string' ? row.history_source : null,
    history_source_url: historySourceUrl,
    quote_as_of: typeof row.quote_as_of === 'string' ? row.quote_as_of : null,
    as_of: typeof row.as_of === 'string' ? row.as_of : null,
    fetched_at: typeof row.fetched_at === 'string' ? row.fetched_at : nowIso(),
    status:
      row.status === 'fresh' ||
      row.status === 'stale' ||
      row.status === 'missing'
        ? row.status
        : history.length || quote.price !== null
          ? 'stale'
          : 'missing',
    error: typeof row.error === 'string' ? row.error : null,
    quote,
    history,
    history_as_of:
      typeof row.history_as_of === 'string'
        ? row.history_as_of
        : (history.at(-1)?.date ?? null),
    history_status:
      row.history_status === 'fresh' ||
      row.history_status === 'stale' ||
      row.history_status === 'missing'
        ? row.history_status
        : history.length
          ? 'stale'
          : 'missing',
    units:
      row.units && typeof row.units === 'object'
        ? {
            price: textOf((row.units as Record<string, unknown>).price),
            volume: textOf((row.units as Record<string, unknown>).volume),
            amount:
              textOf((row.units as Record<string, unknown>).amount) || '元',
          }
        : { price: '', volume: '', amount: '元' },
    adjustment: 'none',
    valuation_kind:
      row.valuation_kind === 'confirmed_nav' ? 'confirmed_nav' : 'market_price',
    metrics:
      row.metrics && typeof row.metrics === 'object'
        ? (row.metrics as Metrics)
        : emptyMetrics(history),
    fundamentals: [],
    evidence: Array.isArray(row.evidence) ? (row.evidence as Evidence[]) : [],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    source_attempts: Array.isArray(row.source_attempts)
      ? (row.source_attempts as SourceAttempt[])
      : [],
  };
}

async function digestId(prefix: string, value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return `${prefix}@${hex.slice(0, 16)}`;
}

interface QuoteResult {
  quote: Quote;
  source: string;
  url: string;
  as_of: string | null;
  attempts: SourceAttempt[];
}

interface HistoryResult {
  history: HistoryRow[];
  source: string;
  url: string;
  valuation_kind: 'market_price' | 'confirmed_nav';
  attempts: SourceAttempt[];
}

function parseEastmoneyQuote(
  body: Record<string, unknown>,
  instrument: Instrument,
  url: string,
): { quote: Quote; as_of: string | null } {
  const data = body.data;
  const item =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  if (!item || textOf(item.f57).padStart(6, '0') !== instrument.code)
    throw new SourceFailure(
      'eastmoney_quote',
      url,
      'instrument not found or identity mismatch',
    );
  const rawPrecision = finiteNumber(item.f59);
  const precision =
    rawPrecision !== null &&
    Number.isInteger(rawPrecision) &&
    rawPrecision >= 0 &&
    rawPrecision <= 6
      ? rawPrecision
      : 2;
  const scale = 10 ** precision;
  const quote: Quote = {
    price: finiteNumber(item.f43, scale),
    change_pct: finiteNumber(item.f170, 100),
    open: finiteNumber(item.f46, scale),
    high: finiteNumber(item.f44, scale),
    low: finiteNumber(item.f45, scale),
    preclose: finiteNumber(item.f60, scale),
    volume:
      finiteNumber(item.f47) === null
        ? null
        : (finiteNumber(item.f47) as number) * 100,
    amount: finiteNumber(item.f48),
  };
  if (
    quote.price === null &&
    quote.open === null &&
    quote.high === null &&
    quote.low === null
  )
    throw new SourceFailure(
      'eastmoney_quote',
      url,
      'quote has no usable prices',
    );
  return { quote, as_of: parseSourceTimestamp(item.f124) };
}

async function fetchQuote(instrument: Instrument): Promise<QuoteResult> {
  const attempts: SourceAttempt[] = [];
  const eastmoneyUrl = queryUrl(ENDPOINTS.eastmoney_quote, {
    secid: secidOf(instrument),
    fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f59,f60,f86,f124,f170',
  });
  try {
    const body = await requestJson(eastmoneyUrl, 'eastmoney_quote');
    const parsed = parseEastmoneyQuote(body, instrument, eastmoneyUrl);
    attempts.push(okAttempt('eastmoney_quote', 'quote', eastmoneyUrl));
    return {
      ...parsed,
      source: 'eastmoney_quote',
      url: eastmoneyUrl,
      attempts,
    };
  } catch (error) {
    attempts.push(
      errorAttempt('eastmoney_quote', 'quote', eastmoneyUrl, error),
    );
  }

  const tencentUrl = `${ENDPOINTS.tencent_quote}${tencentSymbol(instrument)}`;
  try {
    const text = await requestText(tencentUrl);
    const match = /="([\s\S]*?)"\s*;/.exec(text);
    const fields = match?.[1]?.split('~') ?? [];
    if (
      fields.length < 10 ||
      String(fields[2]).padStart(6, '0') !== instrument.code
    )
      throw new Error('instrument not found or identity mismatch');
    const volume = finiteNumber(fields[6]);
    const quote: Quote = {
      price: finiteNumber(fields[3]),
      change_pct:
        finiteNumber(fields[3]) !== null && finiteNumber(fields[4])
          ? (finiteNumber(fields[3])! / finiteNumber(fields[4])! - 1) * 100
          : null,
      open: finiteNumber(fields[5]),
      high: null,
      low: null,
      preclose: finiteNumber(fields[4]),
      volume: volume === null ? null : volume * 100,
      amount: null,
    };
    if (quote.price === null && quote.open === null)
      throw new Error('quote has no usable prices');
    const stamp = fields.find((item) => /^20\d{6}(?:\d{6})?$/.test(item));
    attempts.push(okAttempt('tencent_quote', 'quote', tencentUrl));
    return {
      quote,
      as_of: parseSourceTimestamp(stamp),
      source: 'tencent_quote',
      url: tencentUrl,
      attempts,
    };
  } catch (error) {
    attempts.push(errorAttempt('tencent_quote', 'quote', tencentUrl, error));
    const failure = new SourceFailure(
      'quote',
      tencentUrl,
      attempts.map((item) => `${item.source}: ${item.error}`).join('; '),
    );
    failure.attempts = attempts;
    throw failure;
  }
}

function parseEastmoneyHistory(
  body: Record<string, unknown>,
  source: string,
  url: string,
): HistoryRow[] {
  const data = body.data;
  const item =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const values = item?.klines;
  if (!Array.isArray(values))
    throw new SourceFailure(
      source,
      url,
      'unadjusted daily history is unavailable',
    );
  const rows = values
    .map((line): HistoryRow | null => {
      const values = String(line).split(',');
      const date = validDate(values[0]);
      const close = finiteNumber(values[2]);
      if (!date || close === null) return null;
      const volume = finiteNumber(values[5]);
      return {
        date,
        open: finiteNumber(values[1]),
        close,
        high: finiteNumber(values[3]),
        low: finiteNumber(values[4]),
        volume: volume === null ? null : volume * 100,
        amount: finiteNumber(values[6]),
      };
    })
    .filter((row): row is HistoryRow => row !== null);
  const cleaned = cleanHistory(rows);
  if (!cleaned.length)
    throw new SourceFailure(source, url, 'history contains no usable rows');
  if (cleaned.length !== rows.length)
    throw new SourceFailure(
      source,
      url,
      'history contains duplicate or invalid rows',
    );
  return cleaned;
}

function parseTencentHistory(
  body: Record<string, unknown>,
  instrument: Instrument,
  source: string,
  url: string,
): HistoryRow[] {
  const data =
    body.data && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>)
      : null;
  const item = data?.[tencentSymbol(instrument)];
  const values =
    item && typeof item === 'object'
      ? (item as Record<string, unknown>).day
      : null;
  if (!Array.isArray(values))
    throw new SourceFailure(
      source,
      url,
      'unadjusted daily history is unavailable',
    );
  const rows = values
    .map((line): HistoryRow | null => {
      if (!Array.isArray(line) || line.length < 6) return null;
      const date = validDate(line[0]);
      const close = finiteNumber(line[2]);
      if (!date || close === null) return null;
      const volume = finiteNumber(line[5]);
      return {
        date,
        open: finiteNumber(line[1]),
        close,
        high: finiteNumber(line[3]),
        low: finiteNumber(line[4]),
        volume: volume === null ? null : volume * 100,
        amount: finiteNumber(line[6]),
      };
    })
    .filter((row): row is HistoryRow => row !== null);
  const cleaned = cleanHistory(rows);
  if (!cleaned.length)
    throw new SourceFailure(source, url, 'history contains no usable rows');
  if (cleaned.length !== rows.length)
    throw new SourceFailure(
      source,
      url,
      'history contains duplicate or invalid rows',
    );
  return cleaned;
}

function parseSinaHistory(
  text: string,
  source: string,
  url: string,
): HistoryRow[] {
  const match = /\(([\s\S]*?)\)\s*;?\s*$/.exec(text);
  if (!match)
    throw new SourceFailure(source, url, 'unexpected history response');
  let values: unknown;
  try {
    values = JSON.parse(match[1]);
  } catch {
    throw new SourceFailure(source, url, 'invalid history JSON');
  }
  if (!Array.isArray(values))
    throw new SourceFailure(source, url, 'unexpected history response');
  const rows = values
    .map((item): HistoryRow | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const date = validDate(row.day);
      const close = finiteNumber(row.close);
      if (!date || close === null) return null;
      const volume = finiteNumber(row.volume);
      return {
        date,
        open: finiteNumber(row.open),
        close,
        high: finiteNumber(row.high),
        low: finiteNumber(row.low),
        volume: volume === null ? null : volume * 100,
        amount: finiteNumber(row.amount),
      };
    })
    .filter((row): row is HistoryRow => row !== null);
  const cleaned = cleanHistory(rows);
  if (!cleaned.length)
    throw new SourceFailure(source, url, 'history contains no usable rows');
  if (cleaned.length !== rows.length)
    throw new SourceFailure(
      source,
      url,
      'history contains duplicate or invalid rows',
    );
  return cleaned;
}

function parseFundNav(text: string, source: string, url: string): HistoryRow[] {
  const match = /(?:var\s+)?Data_netWorthTrend\s*=\s*(\[[\s\S]*?\])\s*;/.exec(
    text,
  );
  if (!match)
    throw new SourceFailure(source, url, 'published NAV series not found');
  let values: unknown;
  try {
    values = JSON.parse(match[1]);
  } catch {
    throw new SourceFailure(source, url, 'NAV series is not JSON');
  }
  if (!Array.isArray(values))
    throw new SourceFailure(source, url, 'NAV series has unexpected shape');
  const rows = values
    .map((item): HistoryRow | null => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const stamp = finiteNumber(row.x);
      const close = finiteNumber(row.y);
      if (stamp === null || close === null) return null;
      const date = shanghaiDate(new Date(stamp));
      if (!date) return null;
      return {
        date,
        open: null,
        high: null,
        low: null,
        close,
        volume: null,
        amount: null,
      };
    })
    .filter((row): row is HistoryRow => row !== null);
  const cleaned = cleanHistory(rows);
  if (!cleaned.length)
    throw new SourceFailure(
      source,
      url,
      'NAV series has no usable observations',
    );
  if (cleaned.length !== rows.length)
    throw new SourceFailure(
      source,
      url,
      'NAV series contains duplicate or invalid dates',
    );
  return cleaned;
}

async function fetchHistory(instrument: Instrument): Promise<HistoryResult> {
  const attempts: SourceAttempt[] = [];
  const code = codeOf(instrument);
  if (instrument.kind === 'fund') {
    const url = `${ENDPOINTS.eastmoney_fund_nav}${code}.js`;
    try {
      const text = await requestText(url);
      const history = parseFundNav(text, 'eastmoney_fund_nav', url);
      attempts.push(okAttempt('eastmoney_fund_nav', 'history', url));
      return {
        history,
        source: 'eastmoney_fund_nav',
        url,
        valuation_kind: 'confirmed_nav',
        attempts,
      };
    } catch (error) {
      attempts.push(errorAttempt('eastmoney_fund_nav', 'history', url, error));
      const failure = new SourceFailure(
        'history',
        url,
        attempts.map((item) => `${item.source}: ${item.error}`).join('; '),
      );
      failure.attempts = attempts;
      throw failure;
    }
  }

  const params = {
    secid: secidOf(instrument),
    klt: '101',
    fqt: '0',
    beg: '0',
    end: '20500101',
    lmt: '320',
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
  };
  const eastmoneyUrl = queryUrl(ENDPOINTS.eastmoney_history, params);
  try {
    const body = await requestJson(eastmoneyUrl, 'eastmoney_history');
    const history = parseEastmoneyHistory(
      body,
      'eastmoney_history',
      eastmoneyUrl,
    );
    attempts.push(okAttempt('eastmoney_history', 'history', eastmoneyUrl));
    return {
      history,
      source: 'eastmoney_history',
      url: eastmoneyUrl,
      valuation_kind: 'market_price',
      attempts,
    };
  } catch (error) {
    attempts.push(
      errorAttempt('eastmoney_history', 'history', eastmoneyUrl, error),
    );
  }

  const tencentParam = `${tencentSymbol(instrument)},day,,,320,`;
  const tencentUrl = queryUrl(ENDPOINTS.tencent_history, {
    param: tencentParam,
  });
  try {
    const body = await requestJson(tencentUrl, 'tencent_history');
    const history = parseTencentHistory(
      body,
      instrument,
      'tencent_history',
      tencentUrl,
    );
    attempts.push(okAttempt('tencent_history', 'history', tencentUrl));
    return {
      history,
      source: 'tencent_history',
      url: tencentUrl,
      valuation_kind: 'market_price',
      attempts,
    };
  } catch (error) {
    attempts.push(
      errorAttempt('tencent_history', 'history', tencentUrl, error),
    );
  }

  if (instrument.kind === 'stock') {
    const sinaUrl = queryUrl(ENDPOINTS.sina_history, {
      symbol: tencentSymbol(instrument),
      scale: '240',
      ma: 'no',
      datalen: '320',
    });
    try {
      const text = await requestText(sinaUrl);
      const history = parseSinaHistory(text, 'sina_history', sinaUrl);
      attempts.push(okAttempt('sina_history', 'history', sinaUrl));
      return {
        history,
        source: 'sina_history',
        url: sinaUrl,
        valuation_kind: 'market_price',
        attempts,
      };
    } catch (error) {
      attempts.push(errorAttempt('sina_history', 'history', sinaUrl, error));
    }
  }
  const failure = new SourceFailure(
    'history',
    attempts.at(-1)?.url ?? ENDPOINTS.eastmoney_history,
    attempts.map((item) => `${item.source}: ${item.error}`).join('; '),
  );
  failure.attempts = attempts;
  throw failure;
}

function sourceDate(asOf: string | null): string | null {
  return asOf ? validDate(asOf) : null;
}

function latestAsOf(
  quoteAsOf: string | null,
  history: HistoryRow[],
): string | null {
  const dates = [sourceDate(quoteAsOf), history.at(-1)?.date ?? null].filter(
    (value): value is string => Boolean(value),
  );
  return dates.length ? dates.sort().at(-1)! : null;
}

function previousFieldUrl(
  previous: Snapshot | null,
  field: 'source_url' | 'quote_source_url' | 'history_source_url',
): string | null {
  const value = previous?.[field];
  return isValidatedUrl(value) ? value : null;
}

async function makeMissingSnapshot(
  instrument: Instrument,
  previous: Snapshot | null,
  warnings: string[],
  attempts: SourceAttempt[],
): Promise<Snapshot> {
  const prior =
    previous && (previous.quote.price !== null || previous.history.length)
      ? previous
      : null;
  if (prior) {
    const fallback = {
      ...prior,
      fetched_at: nowIso(),
      status: 'stale' as const,
      error: warnings.join('; ') || 'refresh failed',
      warnings: [
        ...prior.warnings,
        ...warnings,
        `缓存数据截至 ${prior.as_of ?? '未知日期'}`,
      ],
      source_attempts: [...prior.source_attempts, ...attempts],
    };
    if (!fallback.source_url && prior.source_url)
      fallback.source_url = previousFieldUrl(prior, 'source_url');
    return fallback;
  }
  const quote = { ...EMPTY_QUOTE };
  const snapshot: Snapshot = {
    snapshot_id: await digestId(instrument.id, [null, [], quote, 'missing']),
    instrument_id: instrument.id,
    source: 'missing',
    source_url: null,
    quote_source: null,
    quote_source_url: null,
    history_source: null,
    history_source_url: null,
    quote_as_of: null,
    as_of: null,
    fetched_at: nowIso(),
    status: 'missing',
    error: warnings.join('; ') || 'no upstream data',
    quote,
    history: [],
    history_as_of: null,
    history_status: 'missing',
    units: quoteUnits(instrument.kind),
    adjustment: 'none',
    valuation_kind:
      instrument.kind === 'fund' ? 'confirmed_nav' : 'market_price',
    metrics: emptyMetrics([]),
    fundamentals: [],
    evidence: [],
    warnings,
    source_attempts: attempts,
  };
  return snapshot;
}

/** Fetch one instrument, retaining a stale previous snapshot when all sources fail. */
export async function fetchInvestmentSnapshot(
  instrumentInput: Instrument,
  previous?: Snapshot | null,
): Promise<Snapshot> {
  const instrument = normalizeInstrument(instrumentInput);
  const parsedPrior = previousSnapshot(previous);
  const prior =
    parsedPrior?.instrument_id === instrument.id ? parsedPrior : null;
  const warnings: string[] = [];
  const attempts: SourceAttempt[] = [];
  let quote = { ...EMPTY_QUOTE };
  let quoteSource: string | null = null;
  let quoteSourceUrl: string | null = null;
  let quoteAsOf: string | null = null;
  let history: HistoryRow[] = [];
  let historySource: string | null = null;
  let historySourceUrl: string | null = null;
  let valuationKind: 'market_price' | 'confirmed_nav' =
    instrument.kind === 'fund' ? 'confirmed_nav' : 'market_price';
  let quoteFetched = false;
  let historyFetched = false;

  if (instrument.kind !== 'fund') {
    try {
      const result = await fetchQuote(instrument);
      quote = result.quote;
      quoteSource = result.source;
      quoteSourceUrl = result.url;
      quoteAsOf = result.as_of;
      quoteFetched = true;
      attempts.push(...result.attempts);
    } catch (error) {
      const sourceAttempts = (
        error as SourceFailure & { attempts?: SourceAttempt[] }
      ).attempts;
      if (Array.isArray(sourceAttempts)) attempts.push(...sourceAttempts);
      warnings.push(`行情获取失败：${sourceError(error)}`);
    }
  }

  try {
    const result = await fetchHistory(instrument);
    history = result.history;
    historySource = result.source;
    historySourceUrl = result.url;
    valuationKind = result.valuation_kind;
    historyFetched = true;
    attempts.push(...result.attempts);
  } catch (error) {
    const sourceAttempts = (
      error as SourceFailure & { attempts?: SourceAttempt[] }
    ).attempts;
    if (Array.isArray(sourceAttempts)) attempts.push(...sourceAttempts);
    warnings.push(`日线/净值获取失败：${sourceError(error)}`);
  }

  // When every cloud source failed, preserve the prior content identity and
  // mark only its freshness.  This is the cache contract used by the UI.
  if (!quoteFetched && !historyFetched && prior) {
    return {
      ...prior,
      fetched_at: nowIso(),
      status: 'stale',
      error: warnings.join('; ') || 'refresh failed',
      warnings: [
        ...prior.warnings,
        ...warnings,
        `缓存数据截至 ${prior.as_of ?? '未知日期'}`,
      ],
      source_attempts: [...prior.source_attempts, ...attempts],
    };
  }

  if (!history.length && prior?.history.length) {
    history = prior.history;
    historySource = prior.history_source;
    historySourceUrl =
      previousFieldUrl(prior, 'history_source_url') ??
      previousFieldUrl(prior, 'source_url');
    valuationKind = prior.valuation_kind;
    warnings.push(
      `沿用日线/净值缓存，数据日期 ${prior.history_as_of ?? prior.as_of ?? '未知'}`,
    );
  }
  if (!quoteFetched && prior) {
    quote = prior.quote;
    quoteSource = prior.quote_source;
    quoteSourceUrl = previousFieldUrl(prior, 'quote_source_url');
    quoteAsOf = prior.quote_as_of ?? prior.as_of;
  }
  if (instrument.kind === 'fund' && history.length) {
    quote = { ...EMPTY_QUOTE, price: history.at(-1)!.close };
    quoteSource = historySource;
    quoteSourceUrl = historySourceUrl;
    quoteAsOf = history.at(-1)!.date;
  } else if (quote.price === null && history.length) {
    quote = { ...quote, price: history.at(-1)!.close };
    quoteSource = historySource;
    quoteSourceUrl = historySourceUrl;
    quoteAsOf = quoteAsOf ?? history.at(-1)!.date;
    warnings.push('实时行情缺失，价格保留为最近一条未复权日线收盘价');
  }

  const historyAsOf = history.at(-1)?.date ?? null;
  const historyAge = historyAsOf
    ? Math.floor(
        (Date.parse(`${shanghaiDate()}T00:00:00Z`) -
          Date.parse(`${historyAsOf}T00:00:00Z`)) /
          86_400_000,
      )
    : null;
  const historyStatus: SnapshotStatus = history.length
    ? historyAge !== null && historyAge >= 0 && historyAge <= 7
      ? 'fresh'
      : 'stale'
    : 'missing';
  const currentDay = shanghaiDate();
  const currentFact =
    instrument.kind === 'fund'
      ? historyAsOf === currentDay
      : sourceDate(quoteAsOf) === currentDay ||
        (historyFetched && historyAsOf === currentDay);
  const hasData = quote.price !== null || history.length > 0;
  if (!hasData)
    return makeMissingSnapshot(instrument, prior, warnings, attempts);
  if (!currentFact)
    warnings.push(
      `最新可验证数据日期为 ${latestAsOf(quoteAsOf, history) ?? '未知'}；未将抓取时间当作数据日期`,
    );
  if (historyStatus !== 'fresh') {
    warnings.push(
      `历史数据已${historyStatus === 'missing' ? '缺失' : '过期'}；保留原始缓存，不计算技术指标`,
    );
  }
  const asOf = latestAsOf(quoteAsOf, history);
  const source = historySource ?? quoteSource ?? prior?.source ?? 'unknown';
  const sourceUrl =
    historySourceUrl ?? quoteSourceUrl ?? previousFieldUrl(prior, 'source_url');
  const snapshot: Snapshot = {
    snapshot_id: await digestId(instrument.id, [
      asOf,
      history,
      quote,
      source,
      valuationKind,
    ]),
    instrument_id: instrument.id,
    source,
    source_url: sourceUrl,
    quote_source: quoteSource,
    quote_source_url: quoteSourceUrl,
    history_source: historySource,
    history_source_url: historySourceUrl,
    quote_as_of: quoteAsOf,
    as_of: asOf,
    fetched_at: nowIso(),
    status: currentFact ? 'fresh' : 'stale',
    error: currentFact
      ? null
      : warnings.join('; ') || 'latest verifiable data is not current',
    quote,
    history,
    history_as_of: historyAsOf,
    history_status: historyStatus,
    units: quoteUnits(instrument.kind),
    adjustment: 'none',
    valuation_kind: valuationKind,
    metrics: metrics(history, historyStatus === 'fresh'),
    fundamentals: [],
    evidence: [],
    warnings,
    source_attempts: attempts,
  };
  if (quoteSource && historySource && quoteSource !== historySource)
    snapshot.warnings.push(`行情源：${quoteSource}；历史源：${historySource}`);
  return snapshot;
}

function normalizeInstrument(input: Instrument): Instrument {
  if (!input || typeof input !== 'object')
    throw new TypeError('instrument must be an object');
  const kind = String(input.kind ?? '') as InstrumentKind;
  const exchange = String(input.exchange ?? '').toUpperCase() as Exchange;
  const code = String(input.code ?? '');
  if (
    !(kind === 'etf' || kind === 'stock' || kind === 'fund' || kind === 'index')
  )
    throw new TypeError('unsupported instrument kind');
  if (!(exchange === 'SH' || exchange === 'SZ' || exchange === 'OF'))
    throw new TypeError('unsupported exchange');
  if (!/^\d{6}$/.test(code))
    throw new TypeError('instrument code must be a six digit string');
  if (kind === 'fund' && exchange !== 'OF')
    throw new TypeError('fund instruments must use exchange OF');
  if (kind !== 'fund' && exchange === 'OF')
    throw new TypeError('only fund instruments may use exchange OF');
  const id = `${kind}:${exchange}:${code}`;
  if (input.id !== id) throw new TypeError(`instrument id must be ${id}`);
  return { id, kind, exchange, code, name: String(input.name || code) };
}

function parseFundName(text: string, code: string): string | null {
  const codeMatch = /(?:var\s+)?fS_code\s*=\s*["']?(\d{6})/.exec(text);
  if (codeMatch && codeMatch[1] !== code) return null;
  const match = /(?:var\s+)?fS_name\s*=\s*["']([^"']+)/.exec(text);
  return match?.[1]?.trim() || null;
}

async function findEtf(code: string): Promise<Instrument | null> {
  const url = queryUrl(ENDPOINTS.eastmoney_etf_list, {
    pn: '1',
    pz: '10000',
    po: '1',
    np: '1',
    ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: 'f12',
    fs: 'b:MK0021,b:MK0022,b:MK0023,b:MK0024,b:MK0827',
    fields: 'f12,f13,f14',
  });
  const body = await requestJson(url, 'eastmoney_etf_list');
  const data =
    body.data && typeof body.data === 'object'
      ? (body.data as Record<string, unknown>)
      : null;
  const diff = data?.diff;
  const rows = Array.isArray(diff)
    ? diff
    : diff && typeof diff === 'object'
      ? Object.values(diff as Record<string, unknown>)
      : [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (textOf(row.f12).padStart(6, '0') !== code) continue;
    const exchange: Exchange = textOf(row.f13) === '1' ? 'SH' : 'SZ';
    return {
      id: `etf:${exchange}:${code}`,
      kind: 'etf',
      exchange,
      code,
      name: textOf(row.f14) || code,
    };
  }
  return null;
}

/** Search returns full kind/exchange/code identities and never merges same-code instruments. */
export async function searchInvestmentInstruments(
  query: string,
): Promise<Instrument[]> {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return [];
  const found = new Map<string, Instrument>();
  const add = (item: Instrument) => found.set(item.id, { ...item });
  for (const item of [...SEEDS, ...INDEXES]) {
    const itemCode = String(item.code ?? '').toLowerCase();
    const itemName = String(item.name ?? '').toLowerCase();
    const itemId = String(item.id ?? '').toLowerCase();
    if (q === itemCode || itemName.includes(q) || itemId.includes(q)) add(item);
  }
  if (!/^\d{6}$/.test(q))
    return [...found.values()]
      .sort(
        (a, b) =>
          a.kind.localeCompare(b.kind) ||
          a.exchange.localeCompare(b.exchange) ||
          a.code.localeCompare(b.code),
      )
      .slice(0, 50);
  const code = q;
  let etf: Instrument | null = null;
  let etfDirectoryAvailable = false;
  try {
    etf = await findEtf(code);
    etfDirectoryAvailable = true;
    if (etf) add(etf);
  } catch {
    // Local seeds remain useful when the ETF directory is unavailable.
  }
  const knownEtf = [...found.values()].some(
    (item) => item.kind === 'etf' && item.code === code,
  );
  if (!etf && etfDirectoryAvailable && !knownEtf) {
    const exchange: Exchange =
      code.startsWith('6') || code.startsWith('5') || code.startsWith('9')
        ? 'SH'
        : 'SZ';
    const candidate: Instrument = {
      id: `stock:${exchange}:${code}`,
      kind: 'stock',
      exchange,
      code,
      name: code,
    };
    const url = queryUrl(ENDPOINTS.eastmoney_quote, {
      secid: secidOf(candidate),
      fields: 'f57,f58',
    });
    try {
      const body = await requestJson(url, 'eastmoney_quote');
      const item =
        body.data && typeof body.data === 'object'
          ? (body.data as Record<string, unknown>)
          : null;
      if (item && textOf(item.f57).padStart(6, '0') === code && item.f58)
        add({ ...candidate, name: textOf(item.f58) });
    } catch {
      // Search is best effort; no fabricated stock identity is returned.
    }
  }
  if (!etf && etfDirectoryAvailable && !knownEtf) {
    const url = `${ENDPOINTS.eastmoney_fund_nav}${code}.js`;
    try {
      const text = await requestText(url);
      const name = parseFundName(text, code);
      if (name)
        add({
          id: `fund:OF:${code}`,
          kind: 'fund',
          exchange: 'OF',
          code,
          name,
        });
    } catch {
      // A failed fund directory request does not invalidate quote identities.
    }
  }
  return [...found.values()]
    .sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.exchange.localeCompare(b.exchange) ||
        a.code.localeCompare(b.code),
    )
    .slice(0, 50);
}

function emptyBreadth(): MarketBreadth {
  return { up: null, down: null, flat: null, total: null, amount: null };
}

function previousMarket(input: unknown): Market | null {
  if (!input || typeof input !== 'object') return null;
  const candidate =
    'market' in input && input.market && typeof input.market === 'object'
      ? input.market
      : input;
  const row = candidate as Partial<Market>;
  if (typeof row.snapshot_id !== 'string') return null;
  return {
    snapshot_id: row.snapshot_id,
    date: typeof row.date === 'string' ? row.date : null,
    status:
      row.status === 'fresh' ||
      row.status === 'stale' ||
      row.status === 'missing'
        ? row.status
        : 'stale',
    fetched_at: typeof row.fetched_at === 'string' ? row.fetched_at : nowIso(),
    source: typeof row.source === 'string' ? row.source : 'unknown',
    source_url: isValidatedUrl(row.source_url) ? row.source_url : null,
    breadth:
      row.breadth && typeof row.breadth === 'object'
        ? (row.breadth as MarketBreadth)
        : emptyBreadth(),
    sentiment:
      row.sentiment && typeof row.sentiment === 'object'
        ? (row.sentiment as MarketSentiment)
        : { ...EMPTY_SENTIMENT },
    flow:
      row.flow && typeof row.flow === 'object'
        ? (row.flow as Market['flow'])
        : {
            northbound: null,
            northbound_note: '未获取',
            main: null,
            main_note: '未获取',
          },
    evidence: [],
    missing_fields: Array.isArray(row.missing_fields)
      ? row.missing_fields.map(String)
      : ['breadth', 'sentiment', 'flow'],
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [],
    source_attempts: Array.isArray(row.source_attempts)
      ? (row.source_attempts as SourceAttempt[])
      : [],
  };
}

/** Refresh one public market breadth snapshot; incomplete breadth remains null. */
export async function refreshInvestmentMarket(
  previous?: Market | { market?: Market } | null,
): Promise<Market> {
  const prior = previousMarket(previous);
  const url = queryUrl(ENDPOINTS.eastmoney_market_full, {
    pn: '1',
    pz: '10000',
    po: '1',
    np: '1',
    ut: 'bd1d9ddb04089700cf9c27f6f7426281',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: 'm:1+t:2,m:1+t:23,m:0+t:6,m:0+t:80',
    fields: 'f2,f3,f5,f6,f12,f14,f15,f16,f17,f18,f51,f52,f297',
  });
  const attempts: SourceAttempt[] = [];
  try {
    const body = await requestJson(url, 'eastmoney_market_full');
    const data =
      body.data && typeof body.data === 'object'
        ? (body.data as Record<string, unknown>)
        : null;
    const rawDiff = data?.diff;
    const rows = Array.isArray(rawDiff)
      ? rawDiff
      : rawDiff && typeof rawDiff === 'object'
        ? Object.values(rawDiff as Record<string, unknown>)
        : [];
    const total = finiteNumber(data?.total);
    const parsedRows = rows
      .map((item) => {
        const row =
          item && typeof item === 'object'
            ? (item as Record<string, unknown>)
            : {};
        return {
          code: textOf(row.f12).padStart(6, '0'),
          change_pct: finiteNumber(row.f3),
          amount: finiteNumber(row.f6),
          date: validDate(row.f297),
        };
      })
      .filter((row) => /^\d{6}$/.test(row.code) && row.change_pct !== null);
    const unique = new Set(parsedRows.map((row) => row.code));
    const complete =
      parsedRows.length > 0 &&
      total !== null &&
      parsedRows.length === total &&
      unique.size === parsedRows.length;
    const dates = [
      ...new Set(
        parsedRows
          .map((row) => row.date)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const date =
      validDate(data?.date) ?? (dates.length === 1 ? dates[0] : null);
    const breadth: MarketBreadth = complete
      ? {
          up: parsedRows.filter((row) => row.change_pct! > 0).length,
          down: parsedRows.filter((row) => row.change_pct! < 0).length,
          flat: parsedRows.filter((row) => row.change_pct === 0).length,
          total: parsedRows.length,
          amount: parsedRows.every((row) => row.amount !== null)
            ? parsedRows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
            : null,
        }
      : emptyBreadth();
    attempts.push(okAttempt('eastmoney_market_full', 'market', url));
    const currentFact = complete && date === shanghaiDate();
    const status: SnapshotStatus = currentFact
      ? 'fresh'
      : complete
        ? 'stale'
        : prior
          ? 'stale'
          : 'missing';
    const warnings = [
      complete
        ? '市场宽度仅由返回总数与唯一代码完整匹配的全市场快照计算'
        : '全市场返回不完整，市场宽度保持 null',
      '公开资金流口径未确认，northbound/main 保持 null',
      '未获取可核验的涨跌停情绪统计，不输出情绪分数',
    ];
    if (!currentFact)
      warnings.push(
        `最新可验证市场日期为 ${date ?? '未知'}；未将抓取时间当作数据日期`,
      );
    return {
      snapshot_id: await digestId('market', [date, breadth, complete]),
      date,
      status,
      fetched_at: nowIso(),
      source: 'eastmoney_market_full',
      source_url: url,
      breadth,
      sentiment: { ...EMPTY_SENTIMENT },
      flow: {
        northbound: null,
        northbound_note: '现行公开接口/口径未确认，不展示北向实时净流入',
        main: null,
        main_note: '公开资金流为供应商估算口径，未核验前留空',
      },
      evidence: [],
      missing_fields: [
        'sentiment',
        'flow',
        ...(Object.values(breadth).some((value) => value === null)
          ? ['breadth']
          : []),
      ],
      warnings,
      source_attempts: attempts,
    };
  } catch (error) {
    attempts.push(errorAttempt('eastmoney_market_full', 'market', url, error));
    if (prior) {
      return {
        ...prior,
        status: 'stale',
        fetched_at: nowIso(),
        error: sourceError(error),
        warnings: [
          ...prior.warnings,
          `全市场刷新失败，沿用截至 ${prior.date ?? '未知日期'} 的缓存：${sourceError(error)}`,
        ],
        source_attempts: [...prior.source_attempts, ...attempts],
      } as Market;
    }
    return {
      snapshot_id: await digestId('market', [null, 'missing']),
      date: null,
      status: 'missing',
      fetched_at: nowIso(),
      source: 'missing',
      source_url: null,
      breadth: emptyBreadth(),
      sentiment: { ...EMPTY_SENTIMENT },
      flow: {
        northbound: null,
        northbound_note: '未获取',
        main: null,
        main_note: '未获取',
      },
      evidence: [],
      missing_fields: ['breadth', 'sentiment', 'flow'],
      warnings: [`全市场刷新失败：${sourceError(error)}`, '未输出情绪分数'],
      source_attempts: attempts,
    };
  }
}

export function investmentSeeds(): Instrument[] {
  return SEEDS.map((item) => ({ ...item }));
}
