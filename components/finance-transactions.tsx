'use client';
import { useState } from 'react';
import { categoryPath } from '@/lib/finance-chart-data';
import { Download, FileUp, Plus, Search, Trash2, X } from 'lucide-react';
import type { FinanceClient } from '@/lib/finance-client';
import type { FinanceTransaction } from '@/lib/finance-types';
import {
  CategoryPicker,
  Dialog,
  Empty,
  Panel,
  bounds,
  kinds,
  localDate,
  money,
  pathName,
} from './finance-ui';
import {
  expenseDate,
  exportTransactions,
  matchesFinance,
  type FinanceFilter,
} from './finance-overview';
export function FinanceTransactions({
  client,
  month,
  filter,
  onClear,
  onEdit,
  onImport,
  onMessage,
}: {
  client: FinanceClient;
  month: string;
  filter?: FinanceFilter;
  onClear: () => void;
  onEdit: (t: FinanceTransaction | 'new') => void;
  onImport: () => void;
  onMessage: (m: string) => void;
}) {
  const data = client.data!,
    [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [allDates, setAllDates] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [removing, setRemoving] = useState<FinanceTransaction>(),
    [classify, setClassify] = useState(false),
    [category, setCategory] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const range = filter?.range || bounds(month),
    rows = data.transactions
      .filter(
        (t) =>
          !t.deleted &&
          (allDates ||
            (filter?.view === 'all' && filter.id
              ? expenseDate(t, data) === filter.id
              : expenseDate(t, data) >= range.from &&
                expenseDate(t, data) < range.to)) &&
          (kind === 'all' || t.kind === kind) &&
          matchesFinance(t, filter, data) &&
          (!query ||
            [
              t.counterparty,
              t.note,
              ...t.allocations.map(
                (a) =>
                  pathName(data.categories, a.categoryId) +
                  ' ' +
                  categoryPath(data.categories, a.categoryId)
                    .map((c) => c.code || '')
                    .join(' '),
              ),
            ]
              .join(' ')
              .toLowerCase()
              .includes(query.toLowerCase())),
      )
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const selection = rows.filter((t) => selected.includes(t.id)),
    run = async (fn: () => Promise<void>) => {
      setBusy(true);
      setError('');
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
  const bulk = async () =>
    run(async () => {
      if (
        selection.some(
          (t) => t.kind !== 'expense' || t.allocations.length !== 1,
        )
      )
        throw new Error('批量归类只适用于单用途消费，多用途请逐笔编辑');
      for (let i = 0; i < selection.length; i += 10) {
        await client.enqueue({
          type: 'batch',
          mutations: selection.slice(i, i + 10).map((t) => ({
            type: 'saveTransaction',
            expectedVersion: t.version,
            transaction: {
              ...t,
              allocations: t.allocations.map((a) => ({
                ...a,
                categoryId: category,
              })),
            },
          })),
        });
      }
      setClassify(false);
      setSelected([]);
      onMessage('分类已更新，可撤销');
    });
  return (
    <>
      <div className="f-section-toolbar">
        <label className="f-search">
          <Search />
          <input
            placeholder="搜索商家、分类、备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="资金性质筛选"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">所有资金性质</option>
          {Object.entries(kinds).map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </select>
        <label className="f-check">
          <input
            type="checkbox"
            checked={allDates}
            onChange={(e) => setAllDates(e.target.checked)}
          />
          全部日期
        </label>
        <span className="f-flex" />
        <button
          onClick={() =>
            exportTransactions(data, rows, '生活账本明细-' + month + '.csv')
          }
        >
          <Download />
          导出筛选结果
        </button>
        <button onClick={onImport}>
          <FileUp />
          导入账单
        </button>
      </div>
      {filter && (
        <div className="f-filter-chip">
          {filter.name}
          <button className="f-icon" onClick={onClear} aria-label="清除筛选">
            <X />
          </button>
        </div>
      )}
      {selection.length > 0 && (
        <div className="f-selection-bar">
          <b>已选 {selection.length} 笔</b>
          <span>
            本人承担{' '}
            {money(selection.reduce((s, t) => s + (t.personalCents || 0), 0))}
          </span>
          <button onClick={() => setClassify(true)}>修改主分类</button>
          <button className="f-text" onClick={() => setSelected([])}>
            取消选择
          </button>
        </div>
      )}
      <Panel
        title={`${rows.length} 笔流水`}
        className="f-ledger-panel"
        action={
          <span className="f-hint">
            消费按原发生月归属，跨月退款追溯原消费。
          </span>
        }
      >
        <div className="f-ledger-scroll">
          <table className="f-ledger">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择当前列表全部"
                    checked={
                      !!rows.length &&
                      rows.every((t) => selected.includes(t.id))
                    }
                    onChange={(e) =>
                      setSelected(e.target.checked ? rows.map((t) => t.id) : [])
                    }
                  />
                </th>
                <th>时间 / 性质</th>
                <th>对方与用途</th>
                <th>账户</th>
                <th>实际金额</th>
                <th>本人消费</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input
                      aria-label={'选择' + (t.counterparty || t.id)}
                      type="checkbox"
                      checked={selected.includes(t.id)}
                      onChange={(e) =>
                        setSelected((x) =>
                          e.target.checked
                            ? [...x, t.id]
                            : x.filter((id) => id !== t.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <b>{localDate(t.occurredAt)}</b>
                    <small>
                      {kinds[t.kind]}
                      {t.analysisOnly ? ' · 历史分析' : ''}
                    </small>
                  </td>
                  <td>
                    <button
                      className="f-ledger-title"
                      onClick={() => onEdit(t)}
                    >
                      {t.counterparty || t.note || kinds[t.kind]}
                    </button>
                    <small>
                      {t.allocations.length
                        ? t.allocations
                            .map((a) => pathName(data.categories, a.categoryId))
                            .join('；')
                        : t.note || '不计个人消费'}
                    </small>
                  </td>
                  <td>
                    {data.accounts.find((a) => a.id === t.accountId)?.name ||
                      '—'}
                  </td>
                  <td className="f-number">{money(t.amountCents)}</td>
                  <td className="f-number">
                    <strong>
                      {['expense', 'refund'].includes(t.kind)
                        ? money(
                            (t.personalCents || 0) *
                              (t.kind === 'refund' ? -1 : 1),
                          )
                        : '—'}
                    </strong>
                  </td>
                  <td>
                    <button
                      className="f-icon"
                      aria-label="删除这笔流水"
                      onClick={() => setRemoving(t)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <Empty
              title="没有符合条件的流水"
              detail="可调整筛选，或记下第一笔。"
              action={
                <button onClick={() => onEdit('new')}>
                  <Plus />
                  记一笔
                </button>
              }
            />
          )}
        </div>
      </Panel>
      {removing && (
        <Dialog
          title="删除这笔流水？"
          onClose={() => setRemoving(undefined)}
          busy={busy}
        >
          <div className="f-dialog-body">
            <p>
              {removing.counterparty || removing.note || kinds[removing.kind]} ·{' '}
              {money(removing.amountCents)}
            </p>
            <p className="f-hint">
              删除可撤销。有关联退款或结算时需要先处理关联记录。
            </p>
            {error && <p className="f-error">{error}</p>}
          </div>
          <footer>
            <button onClick={() => setRemoving(undefined)}>取消</button>
            <button
              className="f-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await client.enqueue({
                    type: 'delete',
                    collection: 'transactions',
                    id: removing.id,
                    expectedVersion: removing.version,
                  });
                  setRemoving(undefined);
                  onMessage('流水已删除，可撤销');
                })
              }
            >
              确认删除
            </button>
          </footer>
        </Dialog>
      )}
      {classify && (
        <Dialog
          title="批量分类预览"
          onClose={() => setClassify(false)}
          busy={busy}
        >
          <div className="f-dialog-body">
            <p>
              将更改 {selection.length} 笔已选消费的用途，合计{' '}
              {money(selection.reduce((s, t) => s + (t.personalCents || 0), 0))}
              。
            </p>
            <CategoryPicker
              categories={data.categories}
              value={category}
              onChange={setCategory}
            />
            <ul className="f-preview-list">
              {selection.map((t) => (
                <li key={t.id}>
                  {t.counterparty || t.note || '未命名'} ·{' '}
                  {money(t.personalCents || 0)}
                  <small>
                    {t.allocations
                      .map((a) => pathName(data.categories, a.categoryId))
                      .join('；')}{' '}
                    → {pathName(data.categories, category)}
                  </small>
                </li>
              ))}
            </ul>
            {error && <p className="f-error">{error}</p>}
          </div>
          <footer>
            <button onClick={() => setClassify(false)}>取消</button>
            <button
              className="f-primary"
              disabled={busy}
              onClick={() => void bulk()}
            >
              确认分类修改
            </button>
          </footer>
        </Dialog>
      )}
    </>
  );
}
