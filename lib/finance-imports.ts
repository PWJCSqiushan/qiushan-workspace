import type {
  FinanceKind,
  FinanceState,
  FinanceTransaction,
} from './finance-types.ts';

export interface FinanceImportRow {
  id: string;
  row: number;
  platform: 'wechat' | 'alipay' | 'campus';
  occurredAt: string;
  amountCents: number;
  merchant: string;
  description: string;
  payment: string;
  direction: string;
  rawType: string;
  status: string;
  sourceKey?: string;
  suggestedKind: FinanceKind | null;
  warnings: string[];
  duplicateId?: string;
  candidates: string[];
}
export interface FinanceImportResult {
  rows: FinanceImportRow[];
  warnings: string[];
  platform: 'wechat' | 'alipay';
}
export function parseMoney(value: unknown): number {
  const s = String(
    typeof value === 'string' || typeof value === 'number' ? value : '',
  ).replace(/[¥￥,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    throw new Error('金额必须是非负金额，最多两位小数');
  const [a, b = ''] = s.split('.'),
    cents = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('金额超出可支持范围');
  return cents;
}
/** RFC 4180 quoting, including embedded newlines; never evaluates spreadsheet cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let cell = '',
    quote = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quote && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quote || !cell) quote = !quote;
      else cell += c;
    } else if (c === ',' && !quote) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quote) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push([...row]);
      row.length = 0;
      cell = '';
    } else cell += c;
  }
  if (quote) throw new Error('CSV 引号未闭合，请重新导出账单');
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
function clean(v: unknown) {
  return String(typeof v === 'string' || typeof v === 'number' ? v : '')
    .replace(/^\uFEFF/, '')
    .trim();
}
function dateText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 19);
  return clean(value).replaceAll('/', '-').replace(' ', 'T');
}
function chinaDate(value: unknown) {
  const t = dateText(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(t))
    throw new Error('交易时间无效');
  const iso = t.length === 16 ? t + ':00' : t;
  const d = new Date(iso + '+08:00');
  if (
    !Number.isFinite(d.getTime()) ||
    new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 19) !== iso
  )
    throw new Error('交易时间无效');
  return d.toISOString();
}
function safeSource(v: unknown) {
  if (typeof v === 'number' && (!Number.isSafeInteger(v) || v >= 1e15))
    return '';
  const s = clean(v).replace(/^'|^="|"$/g, '');
  return /^[A-Za-z0-9_-]{6,120}$/.test(s) ? s : '';
}
export function parseBillRows(
  input: unknown[][],
  state?: FinanceState,
): FinanceImportResult {
  const headerIndex = input.findIndex(
    (r) =>
      r.some((x) => /^(交易时间|创建时间)$/.test(clean(x))) &&
      r.some((x) => /金额/.test(clean(x))) &&
      r.some((x) => /^(交易对方|商户名称)$/.test(clean(x))),
  );
  if (headerIndex < 0)
    throw new Error('未找到微信或支付宝账单表头（交易时间、交易对方、金额）');
  const headers = input[headerIndex].map(clean),
    platform = headers.includes('交易单号') ? 'wechat' : 'alipay';
  const col = (patterns: RegExp[]) =>
    headers.findIndex((h) => patterns.some((p) => p.test(h)));
  const indices = {
    time: col([/^(交易时间|创建时间)$/]),
    amount: col([/^金额/]),
    merchant: col([/^(交易对方|商户名称)$/]),
    description: col([/^(商品|商品名称|商品说明|交易备注)$/]),
    payment: col([/^(支付方式|收\/付款方式)$/]),
    direction: col([/^(收\/支|收支|收\/支情况)$/]),
    type: col([/^(交易类型|交易分类)$/]),
    status: col([/^(当前状态|交易状态)$/]),
    source: col([/^(交易单号|交易订单号)$/]),
  };
  const result: FinanceImportResult = { rows: [], warnings: [], platform };
  const seen = new Set<string>();
  for (let i = headerIndex + 1; i < input.length; i++) {
    const raw = input[i];
    if (!raw.some((x) => clean(x))) continue;
    const get = (k: keyof typeof indices) => raw[indices[k]],
      warnings: string[] = [];
    let occurredAt = '',
      amountCents = 0;
    // Footers are not transactions. Rows with a transaction-like time are never silently dropped.
    if (!get('time') || /^[-=]+|^共\d|^导出|^注[:：]/.test(clean(get('time'))))
      continue;
    try {
      occurredAt = chinaDate(get('time'));
    } catch {
      warnings.push('交易时间需要核对');
    }
    try {
      amountCents = parseMoney(get('amount'));
    } catch {
      warnings.push('金额无效或缺失');
    }
    const merchant = clean(get('merchant')),
      description = clean(get('description')),
      payment = clean(get('payment')),
      direction = clean(get('direction')),
      rawType = clean(get('type')),
      status = clean(get('status'));
    const source = safeSource(get('source')),
      sourceKey = source ? platform + ':' + source : undefined;
    if (!sourceKey) warnings.push('没有可靠交易号，仅可人工核对去重');
    if (sourceKey && seen.has(sourceKey)) warnings.push('同一文件内交易号重复');
    if (sourceKey) seen.add(sourceKey);
    const ambiguous =
      /转账|红包|充值|提现|还款|借|退款|退回|理财|基金|股票|代付|收款码/.test(
        rawType + ' ' + description,
      );
    let suggestedKind: FinanceKind | null = null;
    if (/失败|关闭|撤销|未支付|待支付/.test(status))
      warnings.push('交易未成功，默认不导入');
    else if (ambiguous) warnings.push('资金性质需要确认，不能直接记消费');
    else if (direction === '支出') suggestedKind = 'expense';
    else if (direction === '收入')
      warnings.push('收入可能是回款或转账，需要确认');
    else warnings.push('收支方向需要确认');
    const duplicate = sourceKey
      ? state?.transactions.find((t) => t.sourceKey === sourceKey)
      : undefined;
    const candidates =
      state?.transactions
        .filter(
          (t) =>
            !t.deleted &&
            !t.sourceKey &&
            t.amountCents === amountCents &&
            occurredAt &&
            Math.abs(Date.parse(t.occurredAt) - Date.parse(occurredAt)) <=
              86400000,
        )
        .map((t) => t.id) || [];
    if (candidates.length)
      warnings.push('发现同金额相近日期记录，请核对是否已手动记账');
    result.rows.push({
      id: (sourceKey || 'row') + '-' + (i + 1),
      row: i + 1,
      platform,
      occurredAt,
      amountCents,
      merchant,
      description,
      payment,
      direction,
      rawType,
      status,
      sourceKey,
      suggestedKind,
      warnings,
      duplicateId: duplicate?.id,
      candidates,
    });
  }
  if (!result.rows.length) throw new Error('账单中没有可核对的交易行');
  return result;
}
export async function readFinanceBill(
  file: File,
  state?: FinanceState,
): Promise<FinanceImportResult> {
  if (file.size > 20 * 1024 * 1024)
    throw new Error('请拆分为 20 MB 以内的账单');
  if (/\.csv$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    }
    return parseBillRows(parseCsv(text), state);
  }
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readExcel } = await import('read-excel-file/browser');
    const sheets = await readExcel(file);
    let last: unknown;
    for (const sheet of sheets) {
      try {
        return parseBillRows(sheet.data, state);
      } catch (error) {
        last = error;
      }
    }
    throw last || new Error('没有找到交易工作表');
  }
  throw new Error('请选择 CSV 或 XLSX 账单；旧版 XLS 请另存为 XLSX');
}
export function manualMatch(
  row: FinanceImportRow,
  transaction: FinanceTransaction,
): FinanceTransaction {
  if (
    transaction.deleted ||
    transaction.sourceKey ||
    !row.sourceKey ||
    transaction.amountCents !== row.amountCents
  )
    throw new Error('这条记录不能绑定该交易号');
  if (
    Math.abs(Date.parse(row.occurredAt) - Date.parse(transaction.occurredAt)) >
    86400000
  )
    throw new Error('日期相差超过一天，请在流水中核对');
  return { ...transaction, sourceKey: row.sourceKey };
}
