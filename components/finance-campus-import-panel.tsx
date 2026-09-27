'use client';
/* oxlint-disable next/no-img-element -- Private Blob previews must stay local and bypass image servers. */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Check, ArrowLeft } from 'lucide-react';
import { financeRequest, type FinanceClient } from '@/lib/finance-client';
import { localGet, localPut } from '@/lib/device-db';
import {
  recognizeCampusBillImage,
  campusImageFingerprint,
  type CampusImportRow,
} from '@/lib/finance-campus-import';
import type {
  FinanceMeal,
  FinanceMutation,
  FinancePlace,
  FinanceTransaction,
} from '@/lib/finance-types';
import { parseMoney } from '@/lib/finance-imports';
import { chartDay } from '@/lib/finance-chart-data';
import {
  CategoryPicker,
  Dialog,
  Field,
  amount,
  isoTime,
  localTime,
  money,
  today,
  uid,
} from './finance-ui';

type Review = {
  kind?: 'expense' | 'recharge' | '';
  selected: boolean;
  done: boolean;
  time: string;
  merchant: string;
  paid: string;
  personal: string;
  category: string | null;
  place: string;
  match: string;
  meal: string;
  slot?: FinanceMeal['meal'] | '';
};
export type CampusSession = {
  id: string;
  fileName: string;
  image?: Blob;
  rows: CampusImportRow[];
  reviews: Record<string, Review>;
  warnings: string[];
};
type PrivatePreview = {
  campusImages?: { name: string; dataUrl: string }[];
  campusSessions?: CampusSession[];
};
export function FinanceCampusImportPanel({
  client,
  onClose,
  onBack,
}: {
  client: FinanceClient;
  onClose: () => void;
  onBack: () => void;
}) {
  const data = client.data!,
    key = 'finance/campus-drafts/' + data.owner + '/' + data.space;
  const [sessions, setSessions] = useState<CampusSession[]>([]),
    [current, setCurrent] = useState(''),
    [index, setIndex] = useState(0),
    [year, setYear] = useState(Number(today().slice(0, 4))),
    [account, setAccount] = useState(
      data.accounts.find((a) => !a.deleted && a.name === '饭卡')?.id || '',
    ),
    [analysis, setAnalysis] = useState(true),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [preview, setPreview] = useState<PrivatePreview>({}),
    [imageUrl, setImageUrl] = useState('');
  const session = sessions.find((s) => s.id === current) || sessions[0],
    row = session?.rows[index],
    review = row ? session?.reviews[row.id] : undefined;
  const latest = useRef(sessions);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await localGet<CampusSession[]>(key);
      if (!live) return;
      latest.current = stored || [];
      setSessions(stored || []);
      setCurrent(stored?.[0]?.id || '');
      setReady(true);
      if (
        data.space === 'demo' &&
        ['localhost', '127.0.0.1'].includes(location.hostname)
      ) {
        try {
          const fixture = await financeRequest<PrivatePreview>(
            '/api/finance/preview-review?space=demo&asset=campus',
          );
          if (live) setPreview(fixture);
        } catch {
          /* optional private local input */
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [key, data.space]);
  useEffect(() => {
    if (!session?.image) {
      queueMicrotask(() => setImageUrl(''));
      return;
    }
    const url = URL.createObjectURL(session.image);
    let active = true;
    queueMicrotask(() => {
      if (active) setImageUrl(url);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [session?.image]);
  const save = async (next: CampusSession[]) => {
    latest.current = next;
    setSessions(next);
    await localPut(key, next);
    await client.refreshReviewCounts();
  };
  const update = (patch: Partial<Review>) => {
    if (!session || !row) return;
    const next = latest.current.map((s) =>
      s.id === session.id
        ? {
            ...s,
            reviews: {
              ...s.reviews,
              [row.id]: { ...s.reviews[row.id], ...patch },
            },
          }
        : s,
    );
    void save(next).catch((e) => setError(String(e)));
  };
  const aliases = Object.fromEntries(
    data.places.flatMap((p) =>
      ((p as FinancePlace & { aliases?: string[] }).aliases || []).map((a) => [
        a,
        { placeName: p.name, categoryId: p.defaultCategoryId },
      ]),
    ),
  );
  const load = async (files: File[]) => {
    setBusy(true);
    setError('');
    try {
      for (const file of files) {
        const fingerprint = await campusImageFingerprint(file);
        const stored = latest.current.find((s) => s.id === fingerprint);
        if (stored) {
          setCurrent(stored.id);
          setIndex(0);
          setStatus('已恢复同一截图的核对进度');
          continue;
        }
        const result = await recognizeCampusBillImage(file, {
          year,
          state: client.data!,
          aliases,
          mealCategoryId: data.categories.find(
            (c) => c.level === 3 && c.name === '学校食堂',
          )?.id,
          bathCategoryId: data.categories.find(
            (c) => c.level === 3 && c.name === '洗衣及生活服务',
          )?.id,
          onProgress: setStatus,
        });
        const previous = latest.current.find((s) => s.id === result.imageHash);
        if (previous) {
          setCurrent(previous.id);
          setIndex(0);
          setStatus('已恢复同一截图的核对进度');
          continue;
        }
        const reviews: Record<string, Review> = {};
        for (const r of result.rows) {
          const place = data.places.find(
              (p) => !p.deleted && p.name === r.suggestedPlaceName,
            ),
            meal = data.meals.find(
              (m) =>
                !m.deleted &&
                m.date ===
                  (Number.isFinite(Date.parse(r.occurredAt))
                    ? chartDay(r.occurredAt)
                    : '') &&
                m.meal === r.mealSlot,
            );
          reviews[r.id] = {
            selected: false,
            done: !!r.duplicateId,
            time: Number.isFinite(Date.parse(r.occurredAt))
              ? localTime(r.occurredAt)
              : '',
            merchant: r.merchant,
            paid: amount(r.amountCents),
            personal: r.requiresShareReview ? '' : amount(r.amountCents),
            category: r.suggestedCategoryId || null,
            place: place?.id || '',
            match: '',
            meal: r.mealSlot
              ? meal
                ? meal.placeId === place?.id
                  ? meal.id
                  : ''
                : 'new'
              : '',
          };
        }
        const next = {
          id: result.imageHash,
          fileName: file.name,
          image: file,
          rows: result.rows,
          reviews,
          warnings: result.warnings,
        };
        await save([...latest.current, next]);
        setCurrent(next.id);
        setIndex(0);
        setStatus('识别完成，先核对金额和餐次；未知本人份额保持空白。');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setDone = async (id: string) => {
    await save(
      latest.current.map((s) =>
        s.id === session?.id
          ? {
              ...s,
              reviews: {
                ...s.reviews,
                [id]: { ...s.reviews[id], done: true, selected: false },
              },
            }
          : s,
      ),
    );
  };
  const commit = async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const chosen = session.rows.filter(
        (r) => session.reviews[r.id].selected && !session.reviews[r.id].done,
      );
      for (const r of chosen) {
        const v = session.reviews[r.id];
        if (
          (v.kind ??
            (r.direction === '充值'
              ? 'recharge'
              : r.suggestedKind === 'expense'
                ? 'expense'
                : '')) === ''
        )
          throw Error('请核对第' + r.row + '行资金方向');
        if (!v.time) throw Error('请补充第' + r.row + '行日期');
        isoTime(v.time);
        if (
          (v.kind ??
            (r.direction === '充值'
              ? 'recharge'
              : r.suggestedKind === 'expense'
                ? 'expense'
                : '')) === 'recharge'
        ) {
          if (!v.match) throw Error('充值须先选择已有转账，不能重复入账');
          continue;
        }
        if (!v.personal.trim())
          throw Error('第' + r.row + '行本人承担金额未确认');
        if (parseMoney(v.personal) > parseMoney(v.paid))
          throw Error('本人承担不能大于扣款金额');
        if (!account) throw Error('请选择饭卡账户');
        if ((v.slot ?? r.mealSlot) && !v.place)
          throw Error('请选择第' + r.row + '行对应餐厅');
      }
      await localPut(
        'finance/campus-backups/' +
          data.owner +
          '/' +
          data.space +
          '/' +
          Date.now(),
        await financeRequest('/api/finance/export?space=' + data.space),
      );
      let count = 0;
      for (const r of chosen) {
        const v = session.reviews[r.id],
          state = client.data!;
        if (
          (v.kind ??
            (r.direction === '充值'
              ? 'recharge'
              : r.suggestedKind === 'expense'
                ? 'expense'
                : '')) === 'recharge'
        ) {
          const match = state.transactions.find(
            (t) =>
              !t.deleted &&
              t.id === v.match &&
              t.kind === 'transfer' &&
              t.targetAccountId === account &&
              t.amountCents === parseMoney(v.paid) &&
              Math.abs(Date.parse(t.occurredAt) - Date.parse(isoTime(v.time))) <
                180000,
          );
          if (!match) throw Error('匹配转账已变更，请重新核对');
          await setDone(r.id);
          count++;
          continue;
        }
        if (state.transactions.some((t) => t.sourceKey === r.sourceKey)) {
          await setDone(r.id);
          continue;
        }
        const paid = parseMoney(v.paid),
          own = parseMoney(v.personal),
          when = isoTime(v.time),
          mutations: Exclude<FinanceMutation, { type: 'batch' }>[] = [];
        let mealId = v.meal && v.meal !== 'new' ? v.meal : undefined;
        if (
          mealId &&
          !state.meals.some(
            (m) => m.id === mealId && !m.deleted && m.date === chartDay(when),
          )
        )
          throw Error('关联餐次已变更，请重新选择');
        const slot = v.slot ?? r.mealSlot;
        if (v.meal === 'new' && slot) {
          const existing = state.meals.find(
            (m) => !m.deleted && m.date === chartDay(when) && m.meal === slot,
          );
          if (existing) {
            if (existing.placeId !== v.place)
              throw Error('当天已有不同主地点，请选择关联餐次或仅记录消费');
            mealId = existing.id;
          } else {
            const meal: FinanceMeal = {
              id: uid('meal'),
              version: 0,
              date: chartDay(when),
              meal: slot,
              placeId: v.place,
              companions: 'unknown',
              payment: own === paid ? 'self' : 'aa',
              pricePending: false,
              note: '饭卡付款时间推测餐次；同伴未注明',
            };
            mealId = meal.id;
            mutations.push({
              type: 'put',
              collection: 'meals',
              entity: meal,
              expectedVersion: 0,
            });
          }
        }
        const tx: FinanceTransaction = {
          id: uid('campus'),
          version: 0,
          kind: 'expense',
          occurredAt: when,
          accountId: account,
          amountCents: paid,
          personalCents: own,
          allocations: own
            ? [
                {
                  id: uid('alloc'),
                  categoryId: v.category,
                  content: slot ? '餐饮' : '生活服务',
                  nature: 'daily',
                  amountCents: own,
                  ...(v.place ? { merchantId: v.place } : {}),
                },
              ]
            : [],
          counterparty: v.merchant,
          note: '饭卡截图第' + r.row + '行；原始商户：' + r.merchant,
          sourceKey: r.sourceKey,
          importBatchId: session.id,
          analysisOnly: analysis,
          ...(mealId ? { mealId } : {}),
        };
        mutations.push({
          type: 'saveTransaction',
          transaction: tx,
          expectedVersion: 0,
        });
        const result = await client.enqueue({ type: 'batch', mutations });
        await setDone(r.id);
        count++;
        if (result.state === 'queued') {
          setStatus(count + '条已保存在本机，等待同步后继续');
          return;
        }
      }
      setStatus(count + '条已处理，原截图和未确认行继续保留。');
    } catch (e) {
      setError((e as Error).message + '；已完成的行保留，其他行仍待核对。');
    } finally {
      setBusy(false);
    }
  };
  const chosen =
    session?.rows.filter(
      (r) => session.reviews[r.id]?.selected && !session.reviews[r.id]?.done,
    ).length || 0;
  const sourcePreview = row as CampusImportRow & { thumbnailDataUrl?: string };
  return (
    <Dialog
      title="饭卡截图"
      description="原图仅在本机识别。充值关联已有转账，消费逐行核对；未知本人份额不计入消费。"
      wide
      busy={busy}
      onClose={onClose}
    >
      <div className="f-dialog-body f-campus-body">
        <div className="f-campus-toolbar">
          <button disabled={busy} onClick={onBack}>
            <ArrowLeft />
            账单文件
          </button>
          <label className="f-file-button">
            <ImagePlus />
            选择截图
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy || !ready}
              onChange={(e) => {
                if (e.target.files?.length)
                  void load(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
          </label>
          <Field label="年份">
            <input
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
          <Field label="扣款账户">
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">选择饭卡</option>
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
        {preview.campusImages?.map((file, i) => (
          <button
            key={i}
            className="f-text"
            disabled={busy}
            onClick={() => {
              void fetch(file.dataUrl)
                .then((r) => r.blob())
                .then((blob) =>
                  load([new File([blob], file.name, { type: blob.type })]),
                );
            }}
          >
            识别本机待核对截图 · {file.name}
          </button>
        ))}
        {sessions.length > 0 && (
          <select
            aria-label="饭卡截图草稿"
            value={session?.id}
            onChange={(e) => {
              setCurrent(e.target.value);
              setIndex(0);
            }}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fileName} ·{' '}
                {s.rows.filter((r) => !s.reviews[r.id].done).length}条待核对
              </option>
            ))}
          </select>
        )}
        {status && <output className="f-hint">{status}</output>}
        {error && (
          <div className="f-error" role="alert">
            {error}
          </div>
        )}
        {session && (
          <>
            <div className="f-campus-summary">
              <span>{session.rows.length} 条识别记录</span>
              <span>
                扣费{' '}
                {money(
                  session.rows
                    .filter((r) => r.direction !== '充值')
                    .reduce(
                      (sum, r) =>
                        sum +
                        (Number.isFinite(Number(session.reviews[r.id].paid))
                          ? Math.round(Number(session.reviews[r.id].paid) * 100)
                          : 0),
                      0,
                    ),
                )}
              </span>
              <span>
                充值{' '}
                {money(
                  session.rows
                    .filter((r) => r.direction === '充值')
                    .reduce((sum, r) => sum + r.amountCents, 0),
                )}
              </span>
              <button
                className="f-text"
                disabled={busy}
                onClick={() => {
                  void save(
                    sessions.map((s) =>
                      s.id === session.id
                        ? {
                            ...s,
                            reviews: Object.fromEntries(
                              Object.entries(s.reviews).map(([id, v]) => [
                                id,
                                {
                                  ...v,
                                  selected:
                                    !v.done &&
                                    !!v.personal &&
                                    !s.rows.find((r) => r.id === id)?.candidates
                                      .length &&
                                    s.rows.find((r) => r.id === id)
                                      ?.suggestedKind === 'expense' &&
                                    !s.rows.find((r) => r.id === id)?.warnings
                                      .length,
                                },
                              ]),
                            ),
                          }
                        : s,
                    ),
                  );
                }}
              >
                勾选金额明确项
              </button>
            </div>
            {session.warnings.map((w, i) => (
              <p key={i} className="f-hint">
                {w}
              </p>
            ))}
            <div className="f-campus-grid">
              <div className="f-campus-rows">
                {session.rows.map((r, i) => {
                  const v = session.reviews[r.id];
                  return (
                    <div
                      key={r.id}
                      className={
                        'f-campus-row ' + (index === i ? 'is-selected' : '')
                      }
                    >
                      <input
                        aria-label={'勾选饭卡第' + r.row + '行'}
                        type="checkbox"
                        disabled={v.done || busy}
                        checked={v.selected}
                        onChange={(e) => {
                          void save(
                            sessions.map((s) =>
                              s.id === session.id
                                ? {
                                    ...s,
                                    reviews: {
                                      ...s.reviews,
                                      [r.id]: {
                                        ...v,
                                        selected: e.target.checked,
                                      },
                                    },
                                  }
                                : s,
                            ),
                          );
                        }}
                      />
                      <button onClick={() => setIndex(i)}>
                        <span>
                          <b>
                            {data.places.find((p) => p.id === v.place)?.name ||
                              r.suggestedPlaceName ||
                              v.merchant ||
                              '商户待核对'}
                          </b>
                          <small>
                            {v.time.replace('T', ' ')} ·{' '}
                            {v.done
                              ? '已处理'
                              : r.direction === '充值'
                                ? '充值待关联'
                                : v.personal
                                  ? '待确认'
                                  : '本人承担待核对'}
                          </small>
                        </span>
                        <strong>
                          {r.direction === '充值' ? '+' : '−'}
                          {v.paid}
                        </strong>
                        {v.done && <Check />}
                      </button>
                    </div>
                  );
                })}
              </div>
              {row && review && (
                <div className="f-campus-editor">
                  <div className="f-row">
                    <b>第 {row.row} 行</b>
                    <span className="f-hint">原始扣费与本人承担分开核对</span>
                  </div>
                  {sourcePreview.thumbnailDataUrl ? (
                    <img
                      className="f-campus-fragment"
                      src={sourcePreview.thumbnailDataUrl}
                      alt={'原截图第' + row.row + '行'}
                    />
                  ) : (
                    <pre className="f-campus-source">{row.sourceFragment}</pre>
                  )}
                  {imageUrl && (
                    <details>
                      <summary>查看完整原图</summary>
                      <div className="f-campus-original">
                        <img src={imageUrl} alt="饭卡账单原截图" />
                      </div>
                    </details>
                  )}
                  <div className="f-form-grid">
                    <Field label="交易时间">
                      <input
                        type="datetime-local"
                        value={review.time}
                        disabled={review.done || busy}
                        onChange={(e) => update({ time: e.target.value })}
                      />
                    </Field>
                    <Field label="扣费金额">
                      <input
                        inputMode="decimal"
                        value={review.paid}
                        disabled={review.done || busy}
                        onChange={(e) => update({ paid: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="资金方向">
                    <select
                      value={
                        review.kind ??
                        (row.direction === '充值'
                          ? 'recharge'
                          : row.suggestedKind === 'expense'
                            ? 'expense'
                            : '')
                      }
                      disabled={review.done || busy}
                      onChange={(e) =>
                        update({ kind: e.target.value as Review['kind'] })
                      }
                    >
                      <option value="">待核对</option>
                      <option value="expense">消费扣费</option>
                      <option value="recharge">充值（关联既有转账）</option>
                    </select>
                  </Field>
                  {(review.kind ??
                    (row.direction === '充值'
                      ? 'recharge'
                      : row.suggestedKind === 'expense'
                        ? 'expense'
                        : '')) === 'recharge' ? (
                    <Field label="关联已有充值（不新增转账）">
                      <select
                        value={review.match}
                        disabled={review.done || busy}
                        onChange={(e) => update({ match: e.target.value })}
                      >
                        <option value="">选择匹配转账</option>
                        {data.transactions
                          .filter(
                            (t) =>
                              !t.deleted &&
                              t.kind === 'transfer' &&
                              t.targetAccountId === account &&
                              t.amountCents === row.amountCents &&
                              Math.abs(
                                Date.parse(t.occurredAt) -
                                  Date.parse(row.occurredAt),
                              ) < 180000,
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {localTime(t.occurredAt).replace('T', ' ')} ·{' '}
                              {money(t.amountCents)}
                            </option>
                          ))}
                      </select>
                    </Field>
                  ) : (
                    <>
                      <Field
                        label="本人承担金额"
                        help={
                          row.requiresShareReview
                            ? '同餐多笔扣费，未知时保持空白。'
                            : '可调整；不会推测他人承担比例。'
                        }
                      >
                        <input
                          inputMode="decimal"
                          value={review.personal}
                          placeholder="待核对"
                          disabled={review.done || busy}
                          onChange={(e) => update({ personal: e.target.value })}
                        />
                      </Field>
                      <Field label="商户原名">
                        <input
                          value={review.merchant}
                          disabled={review.done || busy}
                          onChange={(e) => update({ merchant: e.target.value })}
                        />
                      </Field>
                      <Field label="餐次 / 非餐饮">
                        <select
                          disabled={review.done || busy}
                          value={review.slot ?? row.mealSlot ?? ''}
                          onChange={(e) =>
                            update({
                              slot: e.target.value as FinanceMeal['meal'] | '',
                              meal: e.target.value ? 'new' : '',
                            })
                          }
                        >
                          <option value="">非餐饮</option>
                          <option value="breakfast">早餐</option>
                          <option value="lunch">午餐</option>
                          <option value="dinner">晚餐</option>
                        </select>
                      </Field>
                      {(review.slot ?? row.mealSlot) && (
                        <>
                          <Field label="对应餐厅">
                            <select
                              value={review.place}
                              disabled={review.done || busy}
                              onChange={(e) =>
                                update({ place: e.target.value })
                              }
                            >
                              <option value="">地点待核对</option>
                              {data.places
                                .filter((p) => !p.deleted && p.parentId)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </select>
                          </Field>
                          <Field label="关联餐次">
                            <select
                              value={review.meal}
                              disabled={review.done || busy}
                              onChange={(e) => update({ meal: e.target.value })}
                            >
                              <option value="">仅记录消费，餐次稍后核对</option>
                              <option value="new">按付款时间建立餐次</option>
                              {data.meals
                                .filter(
                                  (m) =>
                                    !m.deleted &&
                                    m.date === review.time.slice(0, 10),
                                )
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {
                                      {
                                        breakfast: '早餐',
                                        lunch: '午餐',
                                        dinner: '晚餐',
                                      }[m.meal]
                                    }{' '}
                                    ·{' '}
                                    {data.places.find((p) => p.id === m.placeId)
                                      ?.name || '未知地点'}
                                  </option>
                                ))}
                            </select>
                          </Field>
                        </>
                      )}
                      <fieldset disabled={review.done || busy}>
                        <legend>主要用途</legend>
                        <CategoryPicker
                          categories={data.categories}
                          value={review.category}
                          onChange={(category) => update({ category })}
                        />
                      </fieldset>
                    </>
                  )}
                  {row.warnings.map((w, i) => (
                    <p className="f-hint" key={i}>
                      {w}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {!session && (
          <div className="f-empty">
            <ImagePlus />
            <h3>一张长截图，逐笔核对</h3>
            <p>可同时选择多张；进度自动保留，原图不会上传。</p>
          </div>
        )}
      </div>
      <footer>
        <span className="f-hint">已勾选 {chosen} 条</span>
        <button onClick={onClose} disabled={busy}>
          保存草稿并关闭
        </button>
        <button
          className="f-primary"
          disabled={busy || !chosen}
          onClick={() => void commit()}
        >
          {busy ? '处理中…' : '确认所选记录'}
        </button>
      </footer>
    </Dialog>
  );
}
