'use client';
import { useState } from 'react';
import type { FinanceClient, PendingFinance } from '@/lib/finance-client';
import type { FinanceEntity, FinanceMutation } from '@/lib/finance-types';
import { Dialog, kinds, localTime, money, pathName } from './finance-ui';
const textValue = (value: unknown): string =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'
    ? String(value)
    : value == null
      ? ''
      : JSON.stringify(value);
const labels: Record<string, string> = {
  name: '名称',
  kind: '性质',
  amountCents: '实际金额',
  personalCents: '本人承担',
  openingCents: '期初余额',
  openingAt: '余额截至',
  occurredAt: '发生时间',
  date: '日期',
  accountId: '付款账户',
  targetAccountId: '转入账户',
  counterparty: '对方',
  note: '备注',
  categoryId: '用途',
  parentId: '上级',
  placeId: '餐厅',
  allocations: '用途分配',
  meal: '餐次',
  companions: '同伴',
  payment: '结算',
  pricePending: '金额待补',
  deleted: '已删除',
  archived: '已停用',
  analysisOnly: '仅历史分析',
  relatedId: '关联记录',
  caseId: '往来事项',
  summaryGroupName: '统计合并名称',
  defaultCategoryId: '默认分类',
};
const flatten = (m: FinanceMutation): FinanceMutation[] =>
  m.type === 'batch' ? m.mutations.flatMap(flatten) : [m];
export function FinanceConflictReview({
  client,
  pending,
  onClose,
}: {
  client: FinanceClient;
  pending: PendingFinance;
  onClose: () => void;
}) {
  const data = client.serverData()!,
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const display = (key: string, value: unknown): string => {
    if (value === undefined || value === null || value === '') return '未填写';
    if (key.endsWith('Cents')) return money(Number(value));
    if (key === 'allocations')
      return (
        (value as { categoryId: string | null; amountCents: number }[])
          .map(
            (a) =>
              pathName(data.categories, a.categoryId) +
              ' ' +
              money(a.amountCents),
          )
          .join('；') || '无分配'
      );
    if (key.endsWith('At'))
      return localTime(textValue(value)).replace('T', ' ');
    if (key === 'kind')
      return kinds[value as keyof typeof kinds] || textValue(value);
    if (key === 'accountId' || key === 'targetAccountId')
      return (
        data.accounts.find((a) => a.id === value)?.name || textValue(value)
      );
    if (key === 'placeId')
      return data.places.find((a) => a.id === value)?.name || textValue(value);
    if (key === 'categoryId' || key === 'defaultCategoryId')
      return pathName(data.categories, textValue(value));
    if (typeof value === 'boolean') return value ? '是' : '否';
    return typeof value === 'object' ? JSON.stringify(value) : textValue(value);
  };
  return (
    <Dialog title="核对两端修改" onClose={onClose} busy={busy} wide>
      <div className="f-dialog-body">
        <p className="f-callout">
          只在确认后使用本机草稿重试。原草稿会保留；未改动的其他记录不会覆盖。
        </p>
        {flatten(pending.mutation).map((m, index) => {
          if (!['put', 'saveTransaction', 'delete'].includes(m.type))
            return (
              <p key={index}>该操作需要先移出队列，再从最新界面重新执行。</p>
            );
          const edit = m as Extract<
              FinanceMutation,
              { type: 'put' | 'saveTransaction' | 'delete' }
            >,
            collection =
              edit.type === 'saveTransaction'
                ? 'transactions'
                : edit.collection,
            id =
              edit.type === 'saveTransaction'
                ? edit.transaction.id
                : edit.type === 'put'
                  ? edit.entity.id
                  : edit.id,
            current = (data[collection] as FinanceEntity[]).find(
              (e) => e.id === id,
            ),
            draft =
              edit.type === 'saveTransaction'
                ? edit.transaction
                : edit.type === 'put'
                  ? edit.entity
                  : { ...current, deleted: true },
            a = (current || {}) as Record<string, unknown>,
            b = draft as Record<string, unknown>,
            keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
              (k) =>
                ![
                  'id',
                  'version',
                  'postings',
                  'sourceKey',
                  'importBatchId',
                ].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]),
            );
          return (
            <section className="f-conflict-block" key={index}>
              <h3>
                {textValue(
                  b.name ||
                    b.counterparty ||
                    a.name ||
                    a.counterparty ||
                    '账本记录',
                )}
              </h3>
              <table className="f-compare">
                <thead>
                  <tr>
                    <th>字段</th>
                    <th>当前账本</th>
                    <th>本机草稿</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k}>
                      <td>{labels[k] || k}</td>
                      <td>{display(k, a[k])}</td>
                      <td>{display(k, b[k])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!keys.length && <p className="f-hint">内容相同，仅版本不同。</p>}
            </section>
          );
        })}
        {error && <p className="f-error">{error}</p>}
      </div>
      <footer>
        <button disabled={busy} onClick={onClose}>
          继续保留草稿
        </button>
        <button
          className="f-primary"
          disabled={
            busy ||
            flatten(pending.mutation).some(
              (m) => !['put', 'saveTransaction', 'delete'].includes(m.type),
            )
          }
          onClick={async () => {
            setBusy(true);
            try {
              await client.resolve(pending.operationId, true);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          使用已核对的草稿重试
        </button>
      </footer>
    </Dialog>
  );
}
