'use client';
import { useState, useEffect, useRef } from 'react';
import { FileUp, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { FinanceClient } from '@/lib/finance-client';
import type {
  FinanceKind,
  FinanceMutation,
  FinanceTransaction,
} from '@/lib/finance-types';
import {
  manualMatch,
  parseMoney,
  readFinanceBill,
  type FinanceImportRow,
} from '@/lib/finance-imports';
import {
  CategoryPicker,
  Dialog,
  Empty,
  Field,
  amount,
  kinds,
  localTime,
  money,
  uid,
} from './finance-ui';
import { FinanceCampusImportPanel } from './finance-campus-import-panel';
import { FinanceTransactionEditor } from './finance-transaction-editor';
type Review = {
  selected: boolean;
  kind: FinanceKind | null;
  category: string | null;
  content: string;
  personal: string;
  account: string;
  target: string;
  match: string;
  done: boolean;
};
type ImportDraft = {
  id: string;
  rows: FinanceImportRow[];
  reviews: Record<string, Review>;
  fileName: string;
  account: string;
  analysis: boolean;
  index: number;
};
export function FinanceImportPanel({
  client,
  onClose,
}: {
  client: FinanceClient;
  onClose: () => void;
}) {
  const [campus, setCampus] = useState(false);
  const [rows, setRows] = useState<FinanceImportRow[]>([]),
    [reviews, setReviews] = useState<Record<string, Review>>({}),
    [fileName, setName] = useState(''),
    [index, setIndex] = useState(0),
    [account, setAccount] = useState(''),
    [analysis, setAnalysis] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [editor, setEditor] = useState<FinanceTransaction>();
  const drafts = useRef<ImportDraft[]>([]);
  const [storedDrafts, setStoredDrafts] = useState<ImportDraft[]>([]);
  const [draftId, setDraftId] = useState(''),
    [draftLoaded, setDraftLoaded] = useState(false);
  const restoreDraft = (d: ImportDraft) => {
    setStoredDrafts([...drafts.current]);
    setDraftId(d.id);
    setRows(d.rows);
    setReviews(d.reviews);
    setName(d.fileName);
    setAccount(d.account);
    setAnalysis(d.analysis);
    setIndex(d.index);
  };
  useEffect(() => {
    let live = true;
    void client
      .draft<{ kind: string; sessions: ImportDraft[] }>()
      .then((value) => {
        if (!live) return;
        if (value?.kind === 'finance-imports') {
          drafts.current = value.sessions;
          setStoredDrafts(value.sessions);
          if (value.sessions[0]) restoreDraft(value.sessions[0]);
        }
        setDraftLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [client]);
  useEffect(() => {
    if (!draftLoaded || !draftId) return;
    const d: ImportDraft = {
      id: draftId,
      rows,
      reviews,
      fileName,
      account,
      analysis,
      index,
    };
    drafts.current = [d, ...drafts.current.filter((x) => x.id !== draftId)];
    void client.saveDraft({
      kind: 'finance-imports',
      sessions: drafts.current,
    });
  }, [
    draftId,
    draftLoaded,
    rows,
    reviews,
    fileName,
    account,
    analysis,
    index,
    client,
  ]);
  const data = client.data!,
    row = rows[index],
    review = row ? reviews[row.id] : undefined;
  const update = (id: string, p: Partial<Review>) =>
    setReviews((rs) => ({ ...rs, [id]: { ...rs[id], ...p } }));
  const load = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const parsed = await readFinanceBill(file, data);
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
        ),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      const previous = drafts.current.find((d) => d.id === hash);
      if (previous) {
        restoreDraft(previous);
        setStatus('已恢复这份账单的本机核对进度');
        return;
      }
      setStoredDrafts([...drafts.current]);
      setDraftId(hash);
      setName(file.name);
      setRows(parsed.rows);
      setIndex(0);
      setReviews(
        Object.fromEntries(
          parsed.rows.map((r) => [
            r.id,
            {
              selected: false,
              kind: r.suggestedKind,
              category: null,
              content: '其他',
              personal: amount(r.amountCents),
              account: '',
              target: '',
              match: '',
              done: !!r.duplicateId,
            },
          ]),
        ),
      );
      setStatus(`${parsed.rows.length} 条流水待核对，原文件仅在本机解析。`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const build = (r: FinanceImportRow, v: Review): FinanceTransaction => {
    const own = parseMoney(v.personal);
    return {
      id: uid('tx'),
      version: 0,
      kind: v.kind!,
      occurredAt: r.occurredAt,
      amountCents: r.amountCents,
      personalCents: v.kind === 'expense' ? own : undefined,
      accountId: v.account || account,
      targetAccountId: v.kind === 'transfer' ? v.target : undefined,
      allocations:
        v.kind === 'expense' && own
          ? [
              {
                id: uid('a'),
                categoryId: v.category,
                content: v.content,
                amountCents: own,
                nature: 'daily',
              },
            ]
          : [],
      counterparty: r.merchant,
      note: r.description,
      sourceKey: r.sourceKey,
      analysisOnly: analysis,
      importBatchId: 'bill_' + fileName.slice(0, 60),
    };
  };
  const commit = async () => {
    setBusy(true);
    setError('');
    let saved = 0;
    try {
      // Small batches bound D1 SQL costs. Each queued batch has a stable operation ID.
      const chosen = rows.filter(
        (r) => reviews[r.id].selected && !reviews[r.id].done,
      );
      for (let start = 0; start < chosen.length; start += 10) {
        const chunk = chosen.slice(start, start + 10);
        const mutations: Exclude<FinanceMutation, { type: 'batch' }>[] = [];
        for (const r of chunk) {
          const v = reviews[r.id];
          if (!v.kind && !v.match)
            throw new Error(`第 ${r.row} 行还未确认资金性质`);
          if (!r.occurredAt || !Number.isSafeInteger(r.amountCents))
            throw new Error(`第 ${r.row} 行日期或金额无效`);
          if (
            r.warnings.some(
              (w) =>
                w.includes('金额无效') ||
                w.includes('未成功') ||
                w.includes('文件内'),
            )
          )
            throw new Error(
              `第 ${r.row} 行无法批量导入，请排除或重新核对原账单`,
            );
          const duplicate = client.data!.transactions.find(
            (t) => t.sourceKey && t.sourceKey === r.sourceKey,
          );
          if (duplicate)
            throw new Error(
              `第 ${r.row} 行已存在（包括已撤销记录），请核对原记录`,
            );
          if (v.match) {
            const original = client.data!.transactions.find(
              (t) => t.id === v.match,
            )!;
            mutations.push({
              type: 'saveTransaction',
              transaction: manualMatch(r, original),
              expectedVersion: original.version,
            });
          } else {
            if (
              !['expense', 'income', 'transfer', 'lend', 'borrow'].includes(
                v.kind!,
              )
            )
              throw new Error(`第 ${r.row} 行须用「关联录入」补充原交易关系`);
            mutations.push({
              type: 'saveTransaction',
              transaction: build(r, v),
              expectedVersion: 0,
            });
          }
        }
        const result = await client.enqueue({ type: 'batch', mutations });
        for (const r of chunk) update(r.id, { done: true, selected: false });
        saved += chunk.length;
        setStatus(
          `${saved} 条${result.state === 'queued' ? '已存本机，等待同步' : '已入账'}；可继续核对剩余记录。`,
        );
        if (result.state === 'queued') break;
      }
    } catch (e) {
      setError(
        (e as Error).message + '。已完成的批次会保留，未完成的行仍在预览。',
      );
    } finally {
      setBusy(false);
    }
  };
  const draftChoices = draftId
    ? [
        { id: draftId, rows, reviews, fileName, account, analysis, index },
        ...storedDrafts.filter((d) => d.id !== draftId),
      ]
    : storedDrafts;
  const selected = rows.filter(
    (r) => reviews[r.id]?.selected && !reviews[r.id].done,
  ).length;
  if (campus)
    return (
      <FinanceCampusImportPanel
        client={client}
        onClose={onClose}
        onBack={() => setCampus(false)}
      />
    );
  return (
    <>
      <Dialog
        title="导入账单"
        description="先核对资金性质与账户，再确认入账。相近日期和金额只提示匹配，不自动合并。"
        onClose={onClose}
        wide
        busy={busy}
      >
        <div className="f-dialog-body">
          {draftChoices.length > 0 && (
            <Field label="本机导入草稿">
              <select
                value={draftId}
                onChange={(e) => {
                  const d = drafts.current.find((d) => d.id === e.target.value);
                  if (d) restoreDraft(d);
                }}
              >
                {draftChoices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fileName} ·{' '}
                    {d.rows.filter((r) => !d.reviews[r.id]?.done).length}{' '}
                    条未处理
                  </option>
                ))}
              </select>
            </Field>
          )}
          <button className="f-campus-entry" onClick={() => setCampus(true)}>
            饭卡截图 · 本机识别多条消费
          </button>
          <div className="f-import-top">
            <label className="f-file-button">
              <FileUp />
              {fileName || '选择微信 / 支付宝 CSV、XLSX'}
              <input
                type="file"
                accept=".csv,.xlsx"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void load(f);
                }}
              />
            </label>
            <Field label="默认实际支付账户">
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">选择账户</option>
                {data.accounts
                  .filter((a) => !a.deleted && !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <label className="f-check">
              <input
                type="checkbox"
                checked={analysis}
                onChange={(e) => setAnalysis(e.target.checked)}
              />
              仅历史分析
            </label>
          </div>
          {status && <output className="f-hint">{status}</output>}
          {!rows.length ? (
            <Empty
              title="选择一份账单开始核对"
              detail="平台只是来源，实际扣款账户需要单独指定。不会从导入内容推测期初余额。"
            />
          ) : (
            <div className="f-import-grid">
              <div className="f-import-list" aria-label="账单预览列表">
                {rows.map((r, i) => (
                  <button
                    key={r.id + '_' + i}
                    className={index === i ? 'is-selected' : ''}
                    onClick={() => setIndex(i)}
                  >
                    <span>
                      {reviews[r.id].done ? (
                        <CheckCircle2 />
                      ) : (
                        <input
                          aria-label={'选择第' + r.row + '行'}
                          type="checkbox"
                          checked={reviews[r.id].selected}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            update(r.id, { selected: e.target.checked })
                          }
                        />
                      )}
                    </span>
                    <span>
                      <b>{r.merchant || r.rawType || '待核对'}</b>
                      <small>
                        {r.occurredAt
                          ? localTime(r.occurredAt).replace('T', ' ')
                          : '日期无效'}{' '}
                        ·{' '}
                        {reviews[r.id].done
                          ? '已存在 / 已处理'
                          : r.warnings.length
                            ? '需核对'
                            : '可核对消费'}
                      </small>
                    </span>
                    <strong>{money(r.amountCents)}</strong>
                  </button>
                ))}
              </div>
              {row && review && (
                <div className="f-import-detail">
                  <div className="f-row">
                    <span className="f-hint">
                      第 {row.row} 行 /{' '}
                      {row.platform === 'wechat' ? '微信' : '支付宝'}
                    </span>
                    <span>
                      <button
                        className="f-icon"
                        aria-label="上一行"
                        disabled={!index}
                        onClick={() => setIndex(index - 1)}
                      >
                        <ChevronLeft />
                      </button>
                      <button
                        className="f-icon"
                        aria-label="下一行"
                        disabled={index === rows.length - 1}
                        onClick={() => setIndex(index + 1)}
                      >
                        <ChevronRight />
                      </button>
                    </span>
                  </div>
                  <h3>{row.merchant || '未注明交易对方'}</h3>
                  <p>{row.description}</p>
                  <p className="f-hint">
                    {row.rawType} · {row.direction} · {row.status} ·{' '}
                    {row.payment}
                  </p>
                  {row.warnings.length > 0 && (
                    <ul className="f-callout">
                      {row.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <Field label="确认资金性质">
                    <select
                      value={review.kind || ''}
                      onChange={(e) =>
                        update(row.id, {
                          kind: (e.target.value as FinanceKind) || null,
                        })
                      }
                    >
                      <option value="">待确认，不计个人消费</option>
                      {Object.entries(kinds).map(([k, n]) => (
                        <option key={k} value={k}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="实际支付账户">
                    <select
                      value={review.account}
                      onChange={(e) =>
                        update(row.id, { account: e.target.value })
                      }
                    >
                      <option value="">使用上方默认账户</option>
                      {data.accounts
                        .filter((a) => !a.deleted)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {review.kind === 'transfer' && (
                    <Field label="转入账户">
                      <select
                        value={review.target}
                        onChange={(e) =>
                          update(row.id, { target: e.target.value })
                        }
                      >
                        <option value="">选择账户</option>
                        {data.accounts
                          .filter((a) => !a.deleted)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  {review.kind === 'expense' && (
                    <>
                      <Field label="本人承担金额">
                        <input
                          value={review.personal}
                          inputMode="decimal"
                          onChange={(e) =>
                            update(row.id, { personal: e.target.value })
                          }
                        />
                      </Field>
                      <CategoryPicker
                        categories={data.categories}
                        value={review.category}
                        onChange={(id) => update(row.id, { category: id })}
                      />
                      <Field label="消费内容">
                        <input
                          value={review.content}
                          onChange={(e) =>
                            update(row.id, { content: e.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                  {!!row.candidates.length && (
                    <Field label="已手动记录？只绑定来源，不重复入账">
                      <select
                        value={review.match}
                        onChange={(e) =>
                          update(row.id, { match: e.target.value })
                        }
                      >
                        <option value="">这是另一笔交易</option>
                        {row.candidates.map((id) => {
                          const tx = data.transactions.find(
                            (t) => t.id === id,
                          )!;
                          return (
                            <option key={id} value={id}>
                              {localTime(tx.occurredAt)} ·{' '}
                              {tx.counterparty || tx.note || '未命名'} ·{' '}
                              {money(tx.amountCents)}
                            </option>
                          );
                        })}
                      </select>
                    </Field>
                  )}
                  <div className="f-row f-wrap">
                    <label className="f-check">
                      <input
                        disabled={review.done}
                        type="checkbox"
                        checked={review.selected}
                        onChange={(e) =>
                          update(row.id, { selected: e.target.checked })
                        }
                      />
                      本行已核对
                    </label>
                    <button
                      disabled={review.done || !review.kind || !row.occurredAt}
                      onClick={() => {
                        try {
                          setEditor(build(row, review));
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      关联录入 / 多用途拆分
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="f-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span className="f-hint">
            已选择 {selected} 条 · 未确认流水保留为本机草稿，不计消费
          </span>
          <button onClick={onClose} disabled={busy}>
            关闭预览
          </button>
          <button
            className="f-primary"
            disabled={busy || !selected || !!client.pending.length}
            onClick={() => void commit()}
          >
            {busy ? '正在处理…' : '确认入账'}
          </button>
        </footer>
      </Dialog>
      {editor && (
        <FinanceTransactionEditor
          client={client}
          transaction={editor}
          onClose={() => setEditor(undefined)}
          onSaved={(message) => {
            if (row) update(row.id, { done: true, selected: false });
            setStatus(message);
          }}
        />
      )}
    </>
  );
}
