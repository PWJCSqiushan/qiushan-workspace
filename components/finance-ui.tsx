'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { categoryLabel } from '@/lib/finance-category-codes';
import type {
  FinanceCategory,
  FinanceNature,
  FinanceKind,
} from '@/lib/finance-types';

export const kinds: Record<FinanceKind, string> = {
  expense: '个人消费',
  income: '真实收入',
  transfer: '账户互转',
  refund: '消费退款',
  lend: '借出 / 押金',
  borrow: '借入',
  collect: '收回往来',
  repay: '偿还往来',
  custodyReceive: '代管收款',
  custodyPay: '代管付款',
  adjustment: '余额校正',
  openingReceivable: '期初待收',
  openingPayable: '期初待付',
  openingCustody: '期初代管',
};
export const natures: Record<FinanceNature, string> = {
  daily: '日常消耗',
  durable: '耐用品',
  rental: '租赁',
  subscription: '订阅',
  credits: '额度充值',
};
export const contents = [
  '餐饮',
  '交通',
  '住宿',
  '数码器材',
  '云服务',
  '软件与AI',
  '服饰',
  '日用品',
  '医疗',
  '票务',
  '学习材料',
  '服务',
  '其他',
];
export const palette = [
  '#79bba6',
  '#88a9d5',
  '#dbb573',
  '#b6a0ce',
  '#d78e8d',
  '#82b7bd',
  '#b7b895',
  '#cfac96',
];
export const uid = (p = 'f') => p + '_' + crypto.randomUUID();
export const today = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const localDate = (iso: string) =>
  new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 10);
export const localTime = (iso: string) =>
  new Date(Date.parse(iso) + 8 * 3600000).toISOString().slice(0, 16);
export const isoTime = (local: string) =>
  new Date(local + ':00+08:00').toISOString();
export function bounds(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    from: month + '-01',
    to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
  };
}
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}
export function money(cents: number, sign = false) {
  return (
    (sign && cents > 0 ? '+' : '') +
    '¥' +
    (cents / 100).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
export const amount = (cents: number) => String(cents / 100);
export function pathName(
  categories: FinanceCategory[],
  id: string | null | undefined,
): string {
  if (!id) return '待分类';
  const cat = categories.find((c) => c.id === id);
  if (!cat) return '分类不可用';
  return cat.parentId
    ? pathName(categories, cat.parentId) + ' / ' + cat.name
    : cat.name;
}
export function isUnder(
  categories: FinanceCategory[],
  leaf: string | null,
  id: string,
): boolean {
  if (!leaf) return false;
  if (leaf === id) return true;
  const cat = categories.find((c) => c.id === leaf);
  return !!cat?.parentId && isUnder(categories, cat.parentId, id);
}
export function exportFile(
  name: string,
  content: string,
  type = 'application/json',
) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportCsv(name: string, rows: unknown[][]) {
  const cell = (v: unknown) => {
    let s =
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      typeof v === 'bigint'
        ? String(v)
        : v == null
          ? ''
          : JSON.stringify(v);
    if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  exportFile(
    name,
    '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n'),
    'text/csv;charset=utf-8',
  );
}
export function Field({
  label,
  help,
  children,
  className = '',
}: {
  label: string;
  help?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={'f-field ' + className}>
      <span>{label}</span>
      {children}
      {help && <small>{help}</small>}
    </label>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="f-empty">
      <span className="f-empty-symbol">—</span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'f-panel ' + className}>
      <div className="f-panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
  busy = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    close = useRef(onClose),
    blocking = useRef(busy);
  useEffect(() => {
    close.current = onClose;
    blocking.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const original = document.activeElement as HTMLElement,
      bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blocking.current) close.current();
      if (e.key === 'Tab') {
        const all = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
          ) || [],
        ).filter((el) => el.getClientRects().length);
        const first = all[0],
          last = all.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = bodyOverflow;
      original?.focus();
    };
  }, []);
  return (
    <div
      role="presentation"
      className="f-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={'f-dialog ' + (wide ? 'f-dialog-wide' : '')}
        // This custom modal owns its focus trap and uses the shared overlay.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="f-icon"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭面板"
          >
            <X />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: FinanceCategory[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const selected = categories.find((c) => c.id === value),
    second =
      selected?.level === 3
        ? categories.find((c) => c.id === selected.parentId)
        : selected?.level === 2
          ? selected
          : undefined;
  const root = second
    ? categories.find((c) => c.id === second.parentId)
    : selected?.level === 1
      ? selected
      : undefined;
  // Intermediate choices are local UI state, never persisted as allocation leaves.
  return (
    <CategorySteps
      categories={categories}
      value={value}
      root={root?.id || ''}
      second={second?.id || ''}
      onChange={onChange}
    />
  );
}
function CategorySteps({
  categories,
  value,
  root,
  second,
  onChange,
}: {
  categories: FinanceCategory[];
  value: string | null;
  root: string;
  second: string;
  onChange: (id: string | null) => void;
}) {
  const [selection, setSelection] = useState({
    observed: value,
    one: root,
    two: second,
  });
  if (selection.observed !== value) {
    setSelection({ observed: value, one: root, two: second });
  }
  const { one, two } = selection;
  const options = (parent: string | null) =>
    categories.filter(
      (c) =>
        c.parentId === parent &&
        !c.deleted &&
        (!c.archived || c.id === value || c.id === root || c.id === second),
    );
  return (
    <div className="f-category-picker">
      <select
        aria-label="消费大类"
        value={one}
        onChange={(e) => {
          setSelection({ observed: null, one: e.target.value, two: '' });
          onChange(null);
        }}
      >
        <option value="">待分类</option>
        {options(null).map((c) => (
          <option key={c.id} value={c.id}>
            {categoryLabel(c, 'both')}
          </option>
        ))}
      </select>
      <select
        aria-label="消费小类"
        required={!!one}
        value={two}
        disabled={!one}
        onChange={(e) => {
          setSelection({ observed: null, one, two: e.target.value });
          onChange(null);
        }}
      >
        <option value="">选择小类</option>
        {one &&
          options(one).map((c) => (
            <option key={c.id} value={c.id}>
              {categoryLabel(c, 'both')}
            </option>
          ))}
      </select>
      <select
        aria-label="消费明细"
        required={!!two}
        value={value || ''}
        disabled={!two}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">选择明细</option>
        {two &&
          options(two).map((c) => (
            <option key={c.id} value={c.id}>
              {categoryLabel(c, 'both')}
            </option>
          ))}
      </select>
    </div>
  );
}
export function Ring({
  groups,
  total,
  unit = '金额',
  onSelect,
}: {
  groups: {
    id: string;
    name: string;
    cents: number;
    color?: string;
    fullName?: string;
  }[];
  total: number;
  unit?: string;
  onSelect?: (id: string) => void;
}) {
  const positive = groups.filter((g) => g.cents > 0),
    sum = positive.reduce((s, g) => s + g.cents, 0);
  const circumference = 2 * Math.PI * 76;

  const value = (n: number) => (unit === '餐数' ? n + '餐' : money(n));
  return (
    <div className="f-ring-wrap">
      <div className="f-donut-visual">
        <svg viewBox="0 0 200 200" aria-label="占比图">
          <circle
            cx="100"
            cy="100"
            r="76"
            fill="none"
            stroke="var(--f-line)"
            strokeWidth="28"
          />
          {positive.map((g, index) => {
            const length = (g.cents / sum) * circumference,
              before = positive
                .slice(0, index)
                .reduce(
                  (value, item) => value + (item.cents / sum) * circumference,
                  0,
                );

            const label =
              (g.fullName || g.name) +
              ' ' +
              value(g.cents) +
              ' ' +
              ((g.cents / sum) * 100).toFixed(1) +
              '%';
            return (
              <circle
                key={g.id}
                cx="100"
                cy="100"
                r="76"
                fill="none"
                stroke={g.color || palette[groups.indexOf(g) % palette.length]}
                strokeWidth="28"
                strokeDasharray={length + ' ' + (circumference - length)}
                strokeDashoffset={-before}
                transform="rotate(-90 100 100)"
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={label}
                onClick={() => onSelect?.(g.id)}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelect(g.id);
                  }
                }}
              >
                <title>{label}</title>
              </circle>
            );
          })}
        </svg>
        <div className="f-donut-center">
          <strong>{unit === '餐数' ? total : money(total)}</strong>
          <small>{unit === '餐数' ? '已记录餐数' : '本人消费'}</small>
        </div>
      </div>
      <div className="f-ring-legend">
        {groups.map((g, i) => (
          <button
            type="button"
            key={g.id}
            onClick={() => onSelect?.(g.id)}
            disabled={!onSelect}
            title={g.fullName || g.name}
          >
            <i style={{ background: g.color || palette[i % palette.length] }} />
            <span>
              {g.name}
              <small>{value(g.cents)}</small>
            </span>
            <b>
              {sum
                ? ((Math.max(0, g.cents) / sum) * 100).toFixed(1) + '%'
                : '0%'}
            </b>
          </button>
        ))}
        {!groups.length && <small className="f-hint">所选范围暂无记录</small>}
      </div>
    </div>
  );
}
