'use client';
import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Download,
  Search,
} from 'lucide-react';
import { CategoryDonut } from './finance-charts';
import {
  categoryLabel,
  type CategoryLabelMode,
} from '@/lib/finance-category-codes';
import { categoryPath } from '@/lib/finance-chart-data';
import { calculateFinanceStats } from '@/lib/finance-stats';
import type {
  FinanceGroup,
  FinanceState,
  FinanceTransaction,
} from '@/lib/finance-types';
import {
  Empty,
  Panel,
  bounds,
  exportCsv,
  isUnder,
  kinds,
  localDate,
  localTime,
  money,
  natures,
  pathName,
  shiftMonth,
} from './finance-ui';
export type FinanceView =
  | 'purpose'
  | 'content'
  | 'activity'
  | 'nature'
  | 'resources';
export type FinanceFilter = {
  view: FinanceView | 'all';
  id: string;
  name: string;
  range?: { from: string; to: string };
  transactionIds?: string[];
};
export function expenseDate(t: FinanceTransaction, data: FinanceState) {
  const original =
    t.kind === 'refund'
      ? data.transactions.find((x) => x.id === t.relatedId)
      : t;
  return localDate((original || t).occurredAt);
}
export function matchesFinance(
  t: FinanceTransaction,
  f: FinanceFilter | undefined,
  data: FinanceState,
) {
  if (!f) return true;
  if (f.transactionIds)
    return (
      f.transactionIds.includes(t.id) ||
      (t.kind === 'refund' && f.transactionIds.includes(t.relatedId || ''))
    );
  if (
    f.view === 'purpose' &&
    f.id === 'unclassified' &&
    t.kind === 'expense' &&
    !t.allocations.length
  )
    return true;
  return f.view === 'purpose'
    ? t.allocations.some((a) =>
        f.id === 'unclassified'
          ? !a.categoryId
          : isUnder(data.categories, a.categoryId, f.id),
      )
    : f.view === 'content'
      ? t.allocations.some((a) => a.content === f.id)
      : f.view === 'activity'
        ? t.allocations.some(
            (a) => (a.activityId || '__unassociated__') === f.id,
          )
        : f.view === 'nature'
          ? t.allocations.some((a) => a.nature === f.id)
          : true;
}
export function exportTransactions(
  data: FinanceState,
  items: FinanceTransaction[],
  name: string,
) {
  exportCsv(name, [
    [
      '日期',
      '资金性质',
      '交易对方',
      '实际金额',
      '本人承担',
      '账户',
      '主要用途',
      '分类代码',
      '内容',
      '说明',
      '历史分析',
    ],
    ...items.map((t) => [
      localTime(t.occurredAt).replace('T', ' '),
      kinds[t.kind],
      t.counterparty,
      t.amountCents / 100,
      (t.personalCents || 0) / 100,
      data.accounts.find((a) => a.id === t.accountId)?.name,
      t.allocations
        .map(
          (a) =>
            pathName(data.categories, a.categoryId) +
            ':' +
            money(a.amountCents),
        )
        .join('；'),
      t.allocations
        .map((a) =>
          categoryPath(data.categories, a.categoryId)
            .map((c) => c.code)
            .filter(Boolean)
            .join('/'),
        )
        .join('；'),
      t.allocations.map((a) => a.content).join('；'),
      t.note,
      t.analysisOnly ? '是' : '否',
    ]),
  ]);
}
export function FinanceOverview({
  data,
  month,
  onDrill,
  onSetup,
  onImport,
  onPdfExport,
  mode,
}: {
  data: FinanceState;
  month: string;
  mode: CategoryLabelMode;
  onDrill: (f: FinanceFilter) => void;
  onSetup: () => void;
  onImport: () => void;
  onPdfExport: () => void;
}) {
  const [view, setView] = useState<FinanceView>('purpose'),
    [expanded, setExpanded] = useState<string[]>([]),
    [search, setSearch] = useState(''),
    [chartCategory, setChartCategory] = useState<string | null>(null);
  const range = bounds(month),
    stats = useMemo(
      () => calculateFinanceStats(data, bounds(month)),
      [data, month],
    ),
    previous = useMemo(
      () => calculateFinanceStats(data, bounds(shiftMonth(month, -1))),
      [data, month],
    );
  const categories = data.categories.filter((c) => !c.deleted),
    roots = categories.filter((c) => c.level === 1),
    total = (id: string, groups = stats.categoryTotals) =>
      groups
        .filter((g) => isUnder(categories, g.id, id))
        .reduce((s, g) => s + g.cents, 0);
  const expenses = data.transactions.filter(
      (t) =>
        !t.deleted &&
        t.kind === 'expense' &&
        expenseDate(t, data) >= range.from &&
        expenseDate(t, data) < range.to,
    ),
    count = (id: string) =>
      expenses.filter((t) =>
        t.allocations.some((a) => isUnder(categories, a.categoryId, id)),
      ).length;
  const top = roots
    .filter((c) => !c.archived || count(c.id) > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      cents: total(c.id),
      count: count(c.id),
    }));
  top.push({
    id: 'unclassified',
    name: '待分类',
    cents: stats.unclassifiedCents,
    count: expenses.filter((t) => t.allocations.some((a) => !a.categoryId))
      .length,
  });
  const source: FinanceGroup[] =
    view === 'content'
      ? stats.contentTotals
      : view === 'activity'
        ? stats.activityTotals
        : view === 'nature'
          ? stats.natureTotals.map((g) => ({
              ...g,
              name: natures[g.id as keyof typeof natures] || g.name,
            }))
          : top;
  const visible = [...source]
    .sort((a, b) => b.cents - a.cents)
    .filter(
      (g) =>
        !search ||
        g.name.toLowerCase().includes(search.toLowerCase()) ||
        categories
          .find((c) => c.id === g.id)
          ?.code?.toLowerCase()
          .includes(search.toLowerCase()) ||
        (view === 'purpose' &&
          categories.some(
            (c) =>
              (c.name.toLowerCase().includes(search.toLowerCase()) ||
                c.code?.toLowerCase().includes(search.toLowerCase())) &&
              isUnder(categories, c.id, g.id),
          )),
    );
  const change = (current: number, prev: number) =>
    prev
      ? current === prev
        ? '持平'
        : `${current > prev ? '+' : ''}${(((current - prev) / prev) * 100).toFixed(0)}%`
      : current
        ? '上月无记录'
        : '—';
  const toggle = (id: string) =>
    setExpanded((x) =>
      x.includes(id) ? x.filter((i) => i !== id) : [...x, id],
    );
  const tableRow = (g: FinanceGroup, level = 1): React.ReactNode => {
    const children = categories
        .filter((c) => c.parentId === g.id && (!c.archived || count(c.id) > 0))
        .sort((a, b) => total(b.id) - total(a.id)),
      open =
        expanded.includes(g.id) ||
        (!!search &&
          categories.some(
            (c) =>
              (c.name.toLowerCase().includes(search.toLowerCase()) ||
                c.code?.toLowerCase().includes(search.toLowerCase())) &&
              isUnder(categories, c.id, g.id),
          ));
    return (
      <div key={g.id}>
        <div className={'f-category-row depth-' + level}>
          <div>
            {children.length ? (
              <button
                className="f-icon"
                aria-label={(open ? '收起' : '展开') + g.name}
                onClick={() => toggle(g.id)}
              >
                {open ? <ChevronDown /> : <ChevronRight />}
              </button>
            ) : (
              <span className="f-tree-spacer" />
            )}
            <button
              className="f-category-name"
              title={g.name}
              onClick={() =>
                children.length ? toggle(g.id) : setChartCategory(g.id)
              }
            >
              {categories.find((c) => c.id === g.id)
                ? categoryLabel(
                    categories.find((c) => c.id === g.id)!,
                    mode,
                  )
                : g.name}
              {g.id === 'unclassified' && <small>已计入总额</small>}
            </button>
            <button
              className="f-icon f-row-drill"
              aria-label={'查看' + g.name + '流水'}
              onClick={() =>
                onDrill({ view: 'purpose', id: g.id, name: g.name })
              }
            >
              <ArrowUpRight />
            </button>
          </div>
          <span>{g.count || 0}</span>
          <strong>{money(g.cents)}</strong>
          <span>
            {stats.personalCents
              ? ((g.cents / stats.personalCents) * 100).toFixed(1) + '%'
              : '—'}
          </span>
          <span className="f-comparison">
            {change(
              g.cents,
              g.id === 'unclassified'
                ? previous.unclassifiedCents
                : total(g.id, previous.categoryTotals),
            )}
          </span>
        </div>
        {open &&
          children.map((c) =>
            tableRow(
              {
                id: c.id,
                name: c.name,
                cents: total(c.id),
                count: count(c.id),
              },
              level + 1,
            ),
          )}
      </div>
    );
  };
  const net =
    stats.accountBalances.reduce((s, a) => s + a.cents, 0) +
    stats.receivableCents -
    stats.payableCents -
    stats.custodyCents;
  return (
    <>
      <section className="f-kpis">
        <div className="f-kpi f-kpi-primary">
          <span>本月本人消费</span>
          <strong>{money(stats.personalCents)}</strong>
          <small>
            较上月{' '}
            {previous.personalCents
              ? money(stats.personalCents - previous.personalCents, true)
              : '暂无可比记录'}
          </small>
        </div>
        <div className="f-kpi">
          <span>本月真实收入</span>
          <strong>{money(stats.incomeCents)}</strong>
          <small>回款与转账不重复计入</small>
        </div>
        <button className="f-kpi" onClick={onSetup}>
          <span>
            所选月末净资金 <ArrowUpRight />
          </span>
          <strong>
            {data.accounts.some(
              (a) => !a.deleted && a.openingConfirmed === false,
            )
              ? '期初待填'
              : money(net)}
          </strong>
          <small>
            待收 {money(stats.receivableCents)} · 待付{' '}
            {money(stats.payableCents)}
          </small>
        </button>
        <button
          className="f-kpi"
          onClick={() =>
            onDrill({ view: 'purpose', id: 'unclassified', name: '待分类' })
          }
        >
          <span>
            待分类金额 <ArrowUpRight />
          </span>
          <strong>{money(stats.unclassifiedCents)}</strong>
          <small>已确认消费，已计入总额</small>
        </button>
      </section>
      <div className="f-overview">
        <Panel
          title="消费分布"
          className="f-purpose-panel"
          action={
            <details className="f-export-menu">
              <summary className="f-text"><Download /> 导出 <ChevronDown /></summary>
              <div className="f-export-options">
              <button
              className="f-text"
              onClick={() =>
                exportTransactions(
                  data,
                  data.transactions.filter(
                    (t) =>
                      !t.deleted &&
                      expenseDate(t, data) >= range.from &&
                      expenseDate(t, data) < range.to,
                  ),
                  '生活账本-' + month + '.csv',
                )
              }
            >
              <Download />
              CSV明细
            </button>
              <button className="f-text" onClick={(e) => {
                e.currentTarget.closest('details')?.removeAttribute('open');
                onPdfExport();
              }}>PDF报告</button>
              </div>
            </details>
          }
        >
          <div className="f-table-controls">
            <button
              className="f-text"
              onClick={() => {
                setExpanded([]);
                setSearch('');
              }}
            >
              全部收起
            </button>
            <div className="f-segment">
              {(
                [
                  ['purpose', '按用途'],
                  ['content', '按内容'],
                  ['activity', '按活动'],
                  ['nature', '按性质'],
                  ['resources', '兴趣资源'],
                ] as const
              ).map(([v, n]) => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {n}
                </button>
              ))}
            </div>
            <label className="f-search">
              <Search />
              <input
                aria-label="搜索分类"
                placeholder="查找用途"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          {view === 'resources' ? (
            <div className="f-resource-table">
              <div>
                <span>用途</span>
                <span>本人消费</span>
                <span>直接赞助</span>
              </div>
              {roots.map((c) => {
                const support = data.sponsorships
                  .filter(
                    (s) =>
                      !s.deleted &&
                      s.date &&
                      s.date >= range.from &&
                      s.date < range.to &&
                      isUnder(categories, s.categoryId, c.id),
                  )
                  .reduce((n, s) => n + s.amountCents, 0);
                return (
                  <div key={c.id}>
                    <b>{c.name}</b>
                    <strong>{money(total(c.id))}</strong>
                    <strong>{money(support)}</strong>
                  </div>
                );
              })}
              <p className="f-hint">
                个人消费与直接赞助分别展示。真实现金资助进入收入，不在这里重复加总。
              </p>
            </div>
          ) : (
            <>
              <div className="f-category-head">
                <span>
                  {view === 'purpose'
                    ? '大类 / 小类 / 明细'
                    : view === 'content'
                      ? '消费内容'
                      : view === 'activity'
                        ? '活动 / 项目'
                        : '消费性质'}
                </span>
                <span>笔数</span>
                <span>本人承担</span>
                <span>占比</span>
                <span>较上月</span>
              </div>
              <div className="f-category-scroll">
                {visible.length ? (
                  visible.map((g) =>
                    view === 'purpose' ? (
                      tableRow(g)
                    ) : (
                      <button
                        className="f-category-row"
                        key={g.id}
                        onClick={() =>
                          onDrill({ view, id: g.id, name: g.name })
                        }
                      >
                        <b>{g.name}</b>
                        <span>{g.count}</span>
                        <strong>{money(g.cents)}</strong>
                        <span>
                          {stats.personalCents
                            ? ((g.cents / stats.personalCents) * 100).toFixed(
                                1,
                              ) + '%'
                            : '—'}
                        </span>
                        <span>—</span>
                      </button>
                    ),
                  )
                ) : (
                  <Empty
                    title={
                      data.categories.length
                        ? '这个月还没有消费记录'
                        : '建立适合自己的账本'
                    }
                    detail={
                      data.categories.length
                        ? '记下第一笔消费，或导入一份账单。'
                        : '先载入私有分类目录，再填写账户的期初余额。'
                    }
                    action={
                      <button
                        className="f-primary"
                        onClick={data.categories.length ? onImport : onSetup}
                      >
                        {data.categories.length ? '导入账单' : '设置账本'}
                      </button>
                    }
                  />
                )}
              </div>
              <div className="f-table-total">
                <b>本月合计</b>
                <strong>{money(stats.personalCents)}</strong>
                <span>金额与本人消费总额一致</span>
              </div>
            </>
          )}
          <div className="f-daily">
            <div className="f-row">
              <h3>每日消费</h3>
              <small>{month}</small>
            </div>
            <section className="f-bars" aria-label="每日消费趋势">
              {stats.daily.map((d) => (
                <button
                  key={d.date}
                  title={d.date + ' ' + money(d.cents)}
                  onClick={() =>
                    onDrill({ view: 'all', id: d.date, name: d.date })
                  }
                >
                  <span
                    style={{
                      height: Math.max(
                        2,
                        (d.cents /
                          Math.max(1, ...stats.daily.map((x) => x.cents))) *
                          66,
                      ),
                    }}
                  />
                  <small>
                    {Number(d.date.slice(8)) % 5 === 1 ? d.date.slice(8) : ''}
                  </small>
                </button>
              ))}
            </section>
          </div>
        </Panel>
        <div className="f-side-stack">
          <Panel title="主要用途占比">
            <CategoryDonut
              key={chartCategory || 'all'}
              data={data}
              stats={stats}
              mode={mode}
              base={chartCategory}
              onDrill={onDrill}
            />
          </Panel>
          <Panel
            title="付给了谁"
            action={<span className="f-hint">本人承担金额</span>}
          >
            <div className="f-merchant-ranks">
              {stats.merchantTotals.slice(0, 6).map((g, i) => (
                <div key={g.id}>
                  <span className="f-rank-no">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <b>{g.name}</b>
                    <i
                      style={{
                        width:
                          Math.max(
                            3,
                            (g.cents /
                              Math.max(
                                1,
                                stats.merchantTotals[0]?.cents || 0,
                              )) *
                              100,
                          ) + '%',
                      }}
                    />
                  </span>
                  <strong>{money(g.cents)}</strong>
                </div>
              ))}
            </div>
            {!stats.merchantTotals.length && <Empty title="暂无商家记录" />}
          </Panel>
          <div className="f-subtle-note">
            <span>分类、内容和活动从不同角度查看同一笔钱，各视图不相加。</span>
            {data.space === 'demo' && <b>演示数据不影响个人账本</b>}
          </div>
        </div>
      </div>
    </>
  );
}
