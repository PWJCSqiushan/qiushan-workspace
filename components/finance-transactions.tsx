'use client';
import { useState } from 'react';
import { categoryPath } from '@/lib/finance-chart-data';
import { Download, FileUp, Plus, Search, Trash2, X } from 'lucide-react';
import type { FinanceClient } from '@/lib/finance-client';
import type { FinanceTransaction } from '@/lib/finance-types';
import {
  transactionEditBatch,
  transactionPersonalCents,
} from '@/lib/finance-transaction-edits';
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
    [targets, setTargets] = useState<FinanceTransaction[]>([]),
    [editCategory, setEditCategory] = useState(true),
    [editMerchant, setEditMerchant] = useState(false),
    [merchant, setMerchant] = useState(''),
    [editNote, setEditNote] = useState(false),
    [note, setNote] = useState(''),
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
      const result = await client.enqueue(
        transactionEditBatch(targets, {
          ...(editCategory ? { categoryId: category } : {}),
          ...(editMerchant ? { counterparty: merchant } : {}),
          ...(editNote ? { note } : {}),
        }),
      );
      setClassify(false);
      setSelected([]);
      onMessage(
        result.state === 'queued'
          ? result.message
          : '批量修改已保存，可整批撤销',
      );
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
            {money(
              selection.reduce(
                (s, t) =>
                  s +
                  transactionPersonalCents(t) * (t.kind === 'refund' ? -1 : 1),
                0,
              ),
            )}
          </span>
          <button
            onClick={() => {
              setTargets(structuredClone(selection));
              setError('');
              setCategory(null);
              setEditCategory(
                selection.some(
                  (t) =>
                    t.kind === 'expense' && transactionPersonalCents(t) > 0,
                ),
              );
              setEditMerchant(false);
              setMerchant('');
              setEditNote(false);
              setNote('');
              setClassify(true);
            }}
          >
            批量修改
          </button>
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
                        : t.kind === 'expense' &&
                            transactionPersonalCents(t) > 0
                          ? '待分类'
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
                            transactionPersonalCents(t) *
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
          title="批量修改预览"
          onClose={() => setClassify(false)}
          busy={busy}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void bulk();
            }}
          >
            <fieldset
              disabled={busy}
              style={{
                border: 0,
                padding: 0,
                margin: 0,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div className="f-dialog-body">
                <p>
                  已选 {targets.length} 笔流水。仅修改勾选字段，一次最多 50
                  笔，可整批撤销。
                </p>
                <label className="f-check">
                  <input
                    type="checkbox"
                    checked={editCategory}
                    onChange={(e) => setEditCategory(e.target.checked)}
                  />
                  修改消费用途
                </label>
                {editCategory && (
                  <>
                    <p className="f-hint">
                      适用{' '}
                      {
                        targets.filter(
                          (t) =>
                            t.kind === 'expense' &&
                            transactionPersonalCents(t) > 0,
                        ).length
                      }{' '}
                      笔消费。多用途的每项分类统一修改，保留原拆分金额及内容；退款统计跟随原消费。其他资金性质的用途不变。
                    </p>
                    <CategoryPicker
                      categories={data.categories}
                      value={category}
                      onChange={setCategory}
                    />
                  </>
                )}
                <label className="f-check">
                  <input
                    type="checkbox"
                    checked={editMerchant}
                    onChange={(e) => setEditMerchant(e.target.checked)}
                  />
                  修改商家 / 对方（全部已选流水）
                </label>
                {editMerchant && (
                  <input
                    aria-label="批量商家 / 对方"
                    value={merchant}
                    onChange={(e) => setMerchant(e.target.value)}
                    placeholder="留空将清除原商家 / 对方"
                  />
                )}
                <label className="f-check">
                  <input
                    type="checkbox"
                    checked={editNote}
                    onChange={(e) => setEditNote(e.target.checked)}
                  />
                  修改备注（全部已选流水）
                </label>
                {editNote && (
                  <textarea
                    aria-label="批量备注"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="替换原备注，留空将清除"
                    rows={2}
                  />
                )}
                <ul className="f-preview-list">
                  {targets.map((t) => (
                    <li key={t.id}>
                      {t.counterparty || t.note || '未命名'} ·{' '}
                      {money(t.amountCents)} · {kinds[t.kind]}
                      <small>
                        {editCategory &&
                        t.kind === 'expense' &&
                        transactionPersonalCents(t) > 0 ? (
                          <>
                            {t.allocations
                              .map((a) =>
                                pathName(data.categories, a.categoryId),
                              )
                              .join('；') || '待分类'}{' '}
                            → {pathName(data.categories, category)}
                          </>
                        ) : (
                          '用途保持原样'
                        )}
                      </small>
                      {editMerchant && (
                        <small>
                          对方：{t.counterparty || '空'} →{' '}
                          {merchant.trim() || '清空'}
                        </small>
                      )}
                      {editNote && (
                        <small>
                          备注：{t.note || '空'} → {note.trim() || '清空'}
                        </small>
                      )}
                    </li>
                  ))}
                </ul>
                {targets.length > 50 && (
                  <p className="f-error">
                    请关闭面板，将选择范围缩小至 50 笔以内。尚未修改任何流水。
                  </p>
                )}
                {error && <p className="f-error">{error}</p>}
              </div>
              <footer>
                <button type="button" onClick={() => setClassify(false)}>
                  取消
                </button>
                <button
                  className="f-primary"
                  type="submit"
                  disabled={
                    busy ||
                    targets.length > 50 ||
                    (!editCategory && !editMerchant && !editNote)
                  }
                >
                  确认批量修改
                </button>
              </footer>
            </fieldset>
          </form>
        </Dialog>
      )}
    </>
  );
}
