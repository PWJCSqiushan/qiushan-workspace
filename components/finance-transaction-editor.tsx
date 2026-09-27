'use client';
import { useState, type SyntheticEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  FinanceAllocation,
  FinanceKind,
  FinanceMeal,
  FinanceNature,
  FinanceTransaction,
} from '@/lib/finance-types';
import type { FinanceClient } from '@/lib/finance-client';
import { parseMoney } from '@/lib/finance-imports';
import { mealDefaultCategory } from '@/lib/finance-places';
import {
  CategoryPicker,
  Dialog,
  Field,
  amount,
  contents,
  isoTime,
  kinds,
  localTime,
  money,
  natures,
  uid,
} from './finance-ui';

type Line = Omit<FinanceAllocation, 'amountCents'> & { value: string };
export function FinanceTransactionEditor({
  client,
  transaction,
  meal,
  onClose,
  onSaved,
  defaultKind = 'expense',
}: {
  client: FinanceClient;
  defaultKind?: FinanceKind;
  transaction?: FinanceTransaction;
  meal?: FinanceMeal;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const data = client.data!,
    initial = transaction;
  const [kind, setKind] = useState<FinanceKind>(initial?.kind || defaultKind);
  const [time, setTime] = useState(
    initial
      ? localTime(initial.occurredAt)
      : meal
        ? meal.date +
          'T' +
          { breakfast: '08:00', lunch: '12:00', dinner: '18:00' }[meal.meal]
        : defaultKind.startsWith('opening') && data.accounts[0]
          ? localTime(data.accounts[0].openingAt)
          : localTime(new Date().toISOString()),
  );
  const [accountId, setAccount] = useState(
    initial?.accountId ||
      data.accounts.find((a) => !a.deleted && !a.archived)?.id ||
      '',
  );
  const [target, setTarget] = useState(initial?.targetAccountId || ''),
    [paid, setPaid] = useState(initial ? amount(initial.amountCents) : ''),
    [personal, setPersonal] = useState(
      initial?.personalCents !== undefined ? amount(initial.personalCents) : '',
    );
  const [merchant, setMerchant] = useState(
      initial?.counterparty ||
        (meal ? data.places.find((p) => p.id === meal.placeId)?.name : '') ||
        '',
    ),
    [note, setNote] = useState(initial?.note || ''),
    [related, setRelated] = useState(initial?.relatedId || ''),
    [caseId, setCaseId] = useState(initial?.caseId || '');
  const [analysisOnly, setAnalysis] = useState(!!initial?.analysisOnly),
    [unusual, setUnusual] = useState(!!initial?.unusual),
    [split, setSplit] = useState(
      !!initial && initial.personalCents !== initial.amountCents,
    );
  const [lines, setLines] = useState<Line[]>(
    (initial?.allocations.length
      ? initial.allocations
      : [
          {
            id: uid('a'),
            categoryId: mealDefaultCategory(data, meal),
            content: meal ? '餐饮' : '其他',
            amountCents: 0,
            nature: 'daily' as const,
            merchantId: meal?.placeId,
          },
        ]
    ).map((a) => ({ ...a, value: a.amountCents ? amount(a.amountCents) : '' })),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const allocationKind = kind === 'expense' || kind === 'refund',
    linked = ['refund', 'collect', 'repay'].includes(kind),
    custody =
      kind === 'custodyPay' ||
      kind === 'custodyReceive' ||
      kind === 'openingCustody';
  const accountOptions = data.accounts.filter(
    (a) => !a.deleted && (!a.archived || a.id === accountId || a.id === target),
  );
  const originals = data.transactions.filter(
    (t) =>
      !t.deleted &&
      t.id !== initial?.id &&
      (kind === 'refund'
        ? t.kind === 'expense'
        : kind === 'collect'
          ? ['expense', 'lend', 'openingReceivable'].includes(t.kind)
          : ['expense', 'borrow', 'openingPayable'].includes(t.kind)),
  );
  const updateLine = (id: string, p: Partial<Line>) =>
    setLines((items) => items.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const chooseOriginal = (id: string) => {
    setRelated(id);
    if (kind === 'refund') {
      const original = data.transactions.find((t) => t.id === id);
      if (original)
        setLines(
          original.allocations.map((a) => ({
            ...a,
            id: uid('a'),
            refundOfAllocationId: a.id,
            value: '',
          })),
        );
    }
  };
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const paidCents =
        kind === 'adjustment' && paid.startsWith('-')
          ? -parseMoney(paid.slice(1))
          : parseMoney(paid);
      const personalCents = allocationKind
        ? split
          ? parseMoney(personal)
          : paidCents
        : undefined;
      const allocations: FinanceAllocation[] = allocationKind
        ? lines
            .map(({ value, ...l }) => ({
              ...l,
              amountCents:
                lines.length === 1 ? personalCents! : parseMoney(value),
              ...(kind === 'refund' ? {} : { refundOfAllocationId: undefined }),
            }))
            .filter((l) => l.amountCents > 0)
        : [];
      if (
        allocationKind &&
        allocations.reduce((s, l) => s + l.amountCents, 0) !== personalCents
      )
        throw new Error('用途分配合计必须等于本人承担金额');
      const tx: FinanceTransaction = {
        id: initial?.id || uid('tx'),
        version: initial?.version || 0,
        kind,
        occurredAt: isoTime(time),
        accountId,
        amountCents: paidCents,
        allocations,
        personalCents,
        ...(kind === 'transfer' ? { targetAccountId: target } : {}),
        ...(linked ? { relatedId: related } : {}),
        ...(custody ? { caseId } : {}),
        ...(meal || initial?.mealId
          ? { mealId: meal?.id || initial?.mealId }
          : {}),
        counterparty: merchant.trim() || undefined,
        note: note.trim() || undefined,
        analysisOnly,
        unusual,
        ...(initial?.sourceKey ? { sourceKey: initial.sourceKey } : {}),
        ...(initial?.importBatchId
          ? { importBatchId: initial.importBatchId }
          : {}),
      };
      const mutation = {
        type: 'saveTransaction' as const,
        transaction: tx,
        expectedVersion: initial?.version || 0,
      };
      const result = await client.enqueue(
        meal && meal.pricePending
          ? {
              type: 'batch',
              mutations: [
                mutation,
                {
                  type: 'put',
                  collection: 'meals',
                  entity: { ...meal, pricePending: false },
                  expectedVersion: meal.version,
                },
              ],
            }
          : mutation,
      );
      onSaved(result.message);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，内容仍在面板中');
    } finally {
      setBusy(false);
    }
  };
  const remaining = () => {
    try {
      return (
        (split ? parseMoney(personal) : parseMoney(paid)) -
        lines.reduce((s, l) => s + parseMoney(l.value || '0'), 0)
      );
    } catch {
      return 0;
    }
  };
  return (
    <Dialog
      title={initial?.version ? '编辑流水' : meal ? '补充这餐消费' : '记一笔'}
      description={
        meal ? '一餐可关联多笔消费；每笔只记录自己承担的部分。' : undefined
      }
      onClose={onClose}
      busy={busy}
      wide
    >
      <form onSubmit={save}>
        <div className="f-dialog-body">
          <div className="f-form-grid">
            <Field label="资金性质">
              <select
                value={kind}
                disabled={!!meal}
                onChange={(e) => {
                  const next = e.target.value as FinanceKind;
                  setKind(next);
                  if (next.startsWith('opening')) {
                    const a = data.accounts.find((a) => a.id === accountId);
                    if (a) setTime(localTime(a.openingAt));
                  }
                  setRelated('');
                  setLines([
                    {
                      id: uid('a'),
                      categoryId: null,
                      content: '其他',
                      nature: 'daily',
                      value: '',
                    },
                  ]);
                }}
              >
                {Object.entries(kinds).map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="发生时间">
              <input
                required
                disabled={kind.startsWith('opening')}
                type="datetime-local"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </Field>
            <Field
              label={
                kind.startsWith('opening')
                  ? '余额基准账户'
                  : [
                        'income',
                        'refund',
                        'collect',
                        'borrow',
                        'custodyReceive',
                      ].includes(kind)
                    ? '收款账户'
                    : '付款账户'
              }
            >
              <select
                required
                value={accountId}
                onChange={(e) => {
                  setAccount(e.target.value);
                  if (kind.startsWith('opening')) {
                    const a = data.accounts.find(
                      (a) => a.id === e.target.value,
                    );
                    if (a) setTime(localTime(a.openingAt));
                  }
                }}
              >
                <option value="">先选择账户</option>
                {accountOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={
                kind.startsWith('opening')
                  ? kinds[kind] + '金额'
                  : kind === 'adjustment'
                    ? '余额增减金额（可为负）'
                    : [
                          'income',
                          'refund',
                          'collect',
                          'borrow',
                          'custodyReceive',
                        ].includes(kind)
                      ? '实际收到'
                      : '实际付出'
              }
            >
              <div className="f-money-input">
                <span>¥</span>
                <input
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </div>
            </Field>
            {kind === 'transfer' && (
              <Field label="转入账户">
                <select
                  required
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">选择转入账户</option>
                  {accountOptions
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {linked && (
              <Field
                label={kind === 'refund' ? '对应原消费' : '对应原往来'}
                className="f-full"
              >
                <select
                  required
                  value={related}
                  onChange={(e) => chooseOriginal(e.target.value)}
                >
                  <option value="">选择关联记录</option>
                  {originals.map((t) => (
                    <option key={t.id} value={t.id}>
                      {localTime(t.occurredAt).slice(0, 10)} ·{' '}
                      {t.counterparty || t.note || kinds[t.kind]} ·{' '}
                      {money(t.amountCents)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {custody && (
              <Field label="代管事项">
                <select
                  required
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                >
                  <option value="">选择代管事项</option>
                  {data.activities
                    .filter((a) => !a.deleted && a.kind === 'custody')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="商家 / 对方">
              <input
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="可留空"
              />
            </Field>
          </div>
          {allocationKind && (
            <section className="f-editor-section">
              <div className="f-row">
                <h3>{kind === 'refund' ? '退还本人消费' : '本人承担'}</h3>
                <label className="f-check">
                  <input
                    type="checkbox"
                    checked={split}
                    onChange={(e) => {
                      setSplit(e.target.checked);
                      if (e.target.checked && !personal) setPersonal(paid);
                    }}
                  />
                  {kind === 'refund'
                    ? '包含退还代垫款'
                    : '实付与本人承担不同 / AA'}
                </label>
              </div>
              {split && (
                <>
                  <Field
                    label={
                      kind === 'refund' ? '退还本人消费的金额' : '本人承担金额'
                    }
                    help={
                      kind === 'refund'
                        ? '剩余退款用于冲减尚未收回的代垫款。'
                        : '实付多于本人承担形成待收，少于本人承担形成待付。'
                    }
                  >
                    <input
                      required
                      inputMode="decimal"
                      value={personal}
                      onChange={(e) => setPersonal(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <div className="f-row">
                <h3>{kind === 'refund' ? '冲减原用途' : '用途分配'}</h3>
                {kind === 'expense' && (
                  <button
                    type="button"
                    className="f-text"
                    onClick={() =>
                      setLines([
                        ...lines,
                        {
                          id: uid('a'),
                          categoryId: null,
                          content: '其他',
                          nature: 'daily',
                          value: '',
                        },
                      ])
                    }
                  >
                    <Plus />
                    拆分用途
                  </button>
                )}
              </div>
              {lines.map((line, index) => (
                <div className="f-allocation" key={line.id}>
                  <div className="f-row">
                    <b>
                      {lines.length > 1 ? `第 ${index + 1} 项` : '消费用途'}
                    </b>
                    {lines.length > 1 && kind === 'expense' && (
                      <button
                        type="button"
                        className="f-icon"
                        aria-label="移除这项分配"
                        onClick={() =>
                          setLines(lines.filter((l) => l.id !== line.id))
                        }
                      >
                        <Trash2 />
                      </button>
                    )}
                  </div>
                  <CategoryPicker
                    categories={data.categories}
                    value={line.categoryId}
                    onChange={(id) => updateLine(line.id, { categoryId: id })}
                  />
                  <div className="f-form-grid f-three">
                    <Field label="消费内容">
                      <input
                        list="finance-content-list"
                        value={line.content}
                        required
                        onChange={(e) =>
                          updateLine(line.id, { content: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="性质">
                      <select
                        value={line.nature}
                        onChange={(e) =>
                          updateLine(line.id, {
                            nature: e.target.value as FinanceNature,
                          })
                        }
                      >
                        {Object.entries(natures).map(([v, n]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="关联活动">
                      <select
                        value={line.activityId || ''}
                        onChange={(e) =>
                          updateLine(line.id, {
                            activityId: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">不关联</option>
                        {data.activities
                          .filter((a) => !a.deleted && a.kind === 'event')
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    {lines.length > 1 && (
                      <Field label="分配金额">
                        <input
                          inputMode="decimal"
                          required
                          value={line.value}
                          onChange={(e) =>
                            updateLine(line.id, { value: e.target.value })
                          }
                        />
                      </Field>
                    )}
                    <Field label="商家地点">
                      <select
                        value={line.merchantId || ''}
                        onChange={(e) =>
                          updateLine(line.id, {
                            merchantId: e.target.value || undefined,
                          })
                        }
                      >
                        <option value="">使用交易对方</option>
                        {data.places
                          .filter((p) => !p.deleted && !p.archived)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field
                      label={
                        data.categories.find((c) => c.id === line.categoryId)
                          ?.other
                          ? '其他用途说明（必填）'
                          : '用途说明'
                      }
                    >
                      <input
                        required={
                          data.categories.find((c) => c.id === line.categoryId)
                            ?.other
                        }
                        value={line.note || ''}
                        onChange={(e) =>
                          updateLine(line.id, { note: e.target.value })
                        }
                      />
                    </Field>
                  </div>
                </div>
              ))}
              {lines.length > 1 && (
                <p className="f-hint">
                  待分配 {money(remaining())} · 分配合计须与本人承担金额一致
                </p>
              )}
              <datalist id="finance-content-list">
                {contents.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </datalist>
            </section>
          )}
          {kind.startsWith('opening') && (
            <p className="f-callout">
              记录账户启用时已经存在的往来或代管款，时间与基准账户一致，不再增减账户余额。
            </p>
          )}
          {kind === 'transfer' && (
            <p className="f-callout">
              饭卡充值、信用还款属于账户互转，不计入消费。
            </p>
          )}
          {[
            'lend',
            'borrow',
            'collect',
            'repay',
            'custodyReceive',
            'custodyPay',
          ].includes(kind) && (
            <p className="f-callout">
              这笔资金只影响账户与往来，不计入个人消费或收入。
            </p>
          )}
          <Field label={kind === 'adjustment' ? '校正原因（必填）' : '备注'}>
            <textarea
              required={kind === 'adjustment'}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="f-row f-wrap">
            <label className="f-check">
              <input
                type="checkbox"
                checked={analysisOnly}
                onChange={(e) => setAnalysis(e.target.checked)}
              />
              仅供历史分析，不影响启用余额
            </label>
            <label className="f-check">
              <input
                type="checkbox"
                checked={unusual}
                onChange={(e) => setUnusual(e.target.checked)}
              />
              非常规 / 大额关注
            </label>
          </div>
          {error && (
            <p className="f-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span className="f-hint">
            {accountOptions.length
              ? '分类不明可留待分类，金额仍计入消费。'
              : '请先到「账户与往来」建立账户。'}
          </span>
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            className="f-primary"
            disabled={busy || !accountOptions.length}
          >
            {busy ? '正在保存…' : '保存记录'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
