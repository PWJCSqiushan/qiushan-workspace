'use client';
import { useRef, useState, type SyntheticEvent } from 'react';
import { Plus, Check, ChevronDown, MapPin, Wallet, Users } from 'lucide-react';
import type { FinanceClient } from '@/lib/finance-client';
import type {
  FinanceMeal,
  FinanceMutation,
  FinanceAccount,
  FinanceTransaction,
} from '@/lib/finance-types';
import {
  mealDefaultCategory,
  orderedMealAreas,
  mealExpenseRows,
} from '@/lib/finance-places';
import { parseMoney } from '@/lib/finance-imports';
import { FinanceReceiptPicker } from './finance-receipt-picker';
import {
  CategoryPicker,
  Dialog,
  Field,
  amount,
  isoTime,
  pathName,
  uid,
} from './finance-ui';
const mealNames = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐' } as const;
const companionNames = {
  unknown: '同伴未注明',
  alone: '独自',
  classmates: '同学',
  friends: '朋友',
  family: '家人',
  other: '其他',
} as const;
const paymentNames = {
  unknown: '结算待核对',
  self: '我付自己',
  aa: 'AA',
  treat: '我请客',
  invited: '别人请客',
} as const;
const channels = {
  wechat: '微信',
  alipay: '支付宝',
  mealcard: '饭卡',
  other: '其他',
} as const;
type Channel = keyof typeof channels;
const channelOf = (name: string): Channel =>
  name.includes('微信')
    ? 'wechat'
    : name.includes('支付宝')
      ? 'alipay'
      : /饭卡|校园卡/.test(name)
        ? 'mealcard'
        : 'other';
export function FinanceMealEditor({
  client,
  initial,
  onClose,
  onSaved,
}: {
  client: FinanceClient;
  initial: { date: string; meal: FinanceMeal['meal']; existing?: FinanceMeal };
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const data = client.data!,
    old = initial.existing,
    linked = mealExpenseRows(data, old?.id),
    editable =
      linked.length === 1 && linked[0].allocations.length <= 1
        ? linked[0]
        : undefined;
  const locations = data.places.filter((p) => !p.deleted && !p.archived),
    roots = orderedMealAreas(locations),
    prefKey = 'qs-meal-payment/' + data.owner + '/' + data.space;
  const [date, setDate] = useState(initial.date),
    [meal, setMeal] = useState(initial.meal),
    [parent, setParent] = useState(
      data.places.find((p) => p.id === old?.placeId)?.parentId ||
        roots[0]?.id ||
        '',
    ),
    [place, setPlace] = useState(old?.placeId || ''),
    [companion, setCompanion] = useState<FinanceMeal['companions']>(
      old?.companions || 'alone',
    ),
    [payment, setPayment] = useState<FinanceMeal['payment']>(
      old?.payment || 'self',
    );
  const [channel, setChannel] = useState<Channel>(() => {
      if (editable)
        return channelOf(
          data.accounts.find((a) => a.id === editable.accountId)?.name || '',
        );
      const prior = localStorage.getItem(prefKey);
      return prior && prior in channels ? (prior as Channel) : 'wechat';
    }),
    [paid, setPaid] = useState(editable ? amount(editable.amountCents) : ''),
    [own, setOwn] = useState(
      editable ? amount(editable.personalCents ?? editable.amountCents) : '',
    ),
    [note, setNote] = useState(old?.note || ''),
    [customCategory, setCustomCategory] = useState<string | null | undefined>(
      editable?.allocations[0]?.categoryId,
    ),
    [showCategory, setShowCategory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [adding, setAdding] = useState<'area' | 'venue'>(),
    [newName, setNewName] = useState(''),
    [ocrBusy, setOcrBusy] = useState(false);
  const priceRef = useRef<HTMLInputElement>(null),
    children = locations.filter((p) => p.parentId === parent);
  const mealValue: FinanceMeal = {
    id: old?.id || 'draft',
    version: old?.version || 0,
    date,
    meal,
    placeId: place,
    companions: companion,
    payment,
    note,
    pricePending: false,
  };
  const category =
    customCategory === undefined
      ? mealDefaultCategory(data, mealValue)
      : customCategory;
  const areaGroups = [
    ...new Set(roots.map((p) => p.summaryGroupId || p.id)),
  ].map((key, index) => ({
    key,
    name:
      roots.find((p) => (p.summaryGroupId || p.id) === key)!.summaryGroupName ||
      roots.find((p) => p.id === key)!.name,
    roots: roots.filter((p) => (p.summaryGroupId || p.id) === key),
    tone: ['mint', 'amber', 'blue', 'rose'][index % 4],
  }));
  const area = areaGroups.find((g) => g.roots.some((p) => p.id === parent));
  const chooseRoot = (id: string) => {
    setParent(id);
    setPlace('');
    setCustomCategory(undefined);
  };
  const addPlace = async () => {
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const id = uid('place');
      await client.enqueue({
        type: 'put',
        collection: 'places',
        expectedVersion: 0,
        entity: {
          id,
          version: 0,
          name: newName.trim(),
          parentId: adding === 'venue' ? parent : null,
        },
      });
      if (adding === 'area') chooseRoot(id);
      else {
        setPlace(id);
        setCustomCategory(undefined);
      }
      setAdding(undefined);
      setNewName('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: SyntheticEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!place) {
      setError('先选择一家餐厅');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const hasPrice = payment === 'invited' || paid.trim() !== '',
        cents = payment === 'invited' ? 0 : hasPrice ? parseMoney(paid) : 0,
        personal =
          payment === 'invited'
            ? 0
            : payment === 'aa' && hasPrice
              ? parseMoney(own)
              : cents;
      if (payment === 'invited' && linked.length > 0 && !editable)
        throw new Error('这餐已有多笔消费，请先在流水中核对，再改为别人请客。');
      const m: FinanceMeal = {
        ...mealValue,
        id: old?.id || uid('meal'),
        pricePending: hasPrice ? false : (old?.pricePending ?? true),
      };
      const mutations: Exclude<FinanceMutation, { type: 'batch' }>[] = [
        {
          type: 'put',
          collection: 'meals',
          entity: m,
          expectedVersion: old?.version || 0,
        },
      ];
      if (hasPrice && (cents > 0 || personal > 0 || editable)) {
        const occurredAt =
          editable && initial.date === date
            ? editable.occurredAt
            : isoTime(
                date +
                  'T' +
                  { breakfast: '08:00', lunch: '12:00', dinner: '18:00' }[meal],
              );
        const oldAccount = editable
          ? data.accounts.find((a) => a.id === editable.accountId)
          : undefined;
        let account =
          oldAccount && channelOf(oldAccount.name) === channel
            ? oldAccount
            : data.accounts.find(
                (a) =>
                  !a.deleted && !a.archived && a.name === channels[channel],
              );
        if (!account) {
          account = {
            id: data.accounts.some((a) => a.id === 'quick-account-' + channel)
              ? uid('account')
              : 'quick-account-' + channel,
            version: 0,
            name: channels[channel],
            kind: 'asset',
            openingCents: 0,
            openingAt: occurredAt,
            openingConfirmed: false,
          } as FinanceAccount;
          mutations.unshift({
            type: 'put',
            collection: 'accounts',
            entity: account,
            expectedVersion: 0,
          });
        }
        const transaction: FinanceTransaction = {
          ...editable,
          id: editable?.id || uid('tx'),
          version: editable?.version || 0,
          kind: 'expense',
          accountId: account.id,
          amountCents: cents,
          personalCents: personal,
          occurredAt,
          mealId: m.id,
          counterparty: locations.find((p) => p.id === place)?.name,
          note: note || undefined,
          allocations: personal
            ? [
                {
                  ...editable?.allocations[0],
                  id: editable?.allocations[0]?.id || uid('a'),
                  categoryId: category,
                  content: '餐饮',
                  amountCents: personal,
                  nature: 'daily',
                  merchantId: place,
                },
              ]
            : [],
        };
        mutations.push({
          type: 'saveTransaction',
          transaction,
          expectedVersion: editable?.version || 0,
        });
        localStorage.setItem(prefKey, channel);
      }
      const result = await client.enqueue({ type: 'batch', mutations });
      localStorage.setItem(prefKey, channel);
      onSaved(result.message);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={old ? '这一餐' : '记一餐'}
      onClose={onClose}
      busy={busy}
      wide
    >
      <form onSubmit={save}>
        <div className="f-dialog-body f-meal-quick">
          <div className="f-quick-date">
            <input
              aria-label="用餐日期"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <div className="f-segment">
              {Object.entries(mealNames).map(([key, name]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={meal === key}
                  onClick={() => setMeal(key as FinanceMeal['meal'])}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="f-quick-columns">
            <section className="f-quick-block f-quick-location">
              <h3>
                <MapPin />
                吃在哪里
              </h3>
              <div className="f-quick-areas">
                {areaGroups.map((g) => (
                  <button
                    type="button"
                    key={g.key}
                    disabled={busy}
                    data-tone={g.tone}
                    aria-pressed={area?.key === g.key}
                    onClick={() => chooseRoot(g.roots[0].id)}
                  >
                    {g.name}
                  </button>
                ))}
                <button
                  type="button"
                  className="f-add-small"
                  disabled={busy}
                  onClick={() => {
                    setAdding('area');
                    setNewName('');
                  }}
                >
                  <Plus />
                  新地点
                </button>
              </div>
              {area && area.roots.length > 1 && (
                <div className="f-quick-floors">
                  {area.roots.map((r) => (
                    <button
                      type="button"
                      disabled={busy}
                      key={r.id}
                      aria-pressed={parent === r.id}
                      onClick={() => chooseRoot(r.id)}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="f-quick-restaurants">
                {children.map((p) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={p.id}
                    aria-pressed={place === p.id}
                    onClick={() => {
                      setPlace(p.id);
                      setCustomCategory(undefined);
                      priceRef.current?.focus();
                    }}
                  >
                    {p.name}
                    {place === p.id && <Check />}
                  </button>
                ))}
                {parent && (
                  <button
                    type="button"
                    disabled={busy}
                    className="f-add-small"
                    onClick={() => {
                      setAdding('venue');
                      setNewName('');
                    }}
                  >
                    <Plus />
                    新餐厅
                  </button>
                )}
              </div>
              {adding && (
                <div className="f-place-create">
                  <Field
                    label={adding === 'area' ? '新地点名称' : '新餐厅名称'}
                  >
                    <input
                      data-autofocus
                      value={newName}
                      maxLength={100}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void addPlace();
                        }
                      }}
                    />
                  </Field>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAdding(undefined)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="f-primary"
                    disabled={busy || !newName.trim()}
                    onClick={() => void addPlace()}
                  >
                    添加
                  </button>
                </div>
              )}
            </section>
            <section className="f-quick-block f-quick-payment">
              <h3>
                <Wallet />
                花了多少
              </h3>
              <div className="f-quick-money">
                <span>¥</span>
                <input
                  ref={priceRef}
                  aria-label="用餐实付金额"
                  inputMode="decimal"
                  placeholder="0.00"
                  disabled={payment === 'invited'}
                  value={payment === 'invited' ? '0' : paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </div>
              {payment !== 'invited' && (
                <>
                  <div className="f-quick-channels">
                    {Object.entries(channels).map(([key, name]) => (
                      <button
                        type="button"
                        key={key}
                        data-channel={key}
                        aria-pressed={channel === key}
                        onClick={() => setChannel(key as Channel)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <span className="f-hint">
                    沿用上次付款方式 · 金额可稍后补
                  </span>
                  <FinanceReceiptPicker
                    value={paid}
                    onAmount={setPaid}
                    onBusy={setOcrBusy}
                  />
                </>
              )}
              {payment === 'aa' && (
                <Field label="其中自己承担">
                  <input
                    inputMode="decimal"
                    required={paid !== ''}
                    value={own}
                    onChange={(e) => setOwn(e.target.value)}
                    placeholder="自己的那份金额"
                  />
                </Field>
              )}
              {linked.length > 1 && (
                <p className="f-hint">
                  这餐已有 {linked.length} 笔消费，本次填写会追加一笔。
                </p>
              )}
              <div className="f-quick-purpose">
                <span>用途</span>
                <b>
                  {category ? pathName(data.categories, category) : '待分类'}
                </b>
                <button
                  type="button"
                  className="f-text"
                  onClick={() => setShowCategory(!showCategory)}
                >
                  调整
                  <ChevronDown />
                </button>
              </div>
              {showCategory && (
                <CategoryPicker
                  categories={data.categories}
                  value={category}
                  onChange={setCustomCategory}
                />
              )}
            </section>
          </div>
          <section className="f-quick-block f-quick-social">
            <div>
              <h3>
                <Users />
                一起吃
              </h3>
              <div className="f-quick-pills">
                {Object.entries(companionNames)
                  .filter(
                    ([key]) => key !== 'unknown' || companion === 'unknown',
                  )
                  .map(([key, name]) => (
                    <button
                      type="button"
                      aria-pressed={companion === key}
                      key={key}
                      onClick={() =>
                        setCompanion(key as FinanceMeal['companions'])
                      }
                    >
                      {name}
                    </button>
                  ))}
              </div>
            </div>
            <div>
              <h3>谁来付</h3>
              <div className="f-quick-pills">
                {Object.entries(paymentNames)
                  .filter(([key]) => key !== 'unknown' || payment === 'unknown')
                  .map(([key, name]) => (
                    <button
                      type="button"
                      aria-pressed={payment === key}
                      key={key}
                      onClick={() => {
                        setPayment(key as FinanceMeal['payment']);
                        setCustomCategory(undefined);
                      }}
                    >
                      {name}
                    </button>
                  ))}
              </div>
            </div>
          </section>
          <input
            className="f-quick-note"
            aria-label="用餐备注"
            value={note}
            placeholder="备注（可不填）"
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <p className="f-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          <span className="f-hint">
            {locations.find((p) => p.id === place)?.name || '选一家餐厅'} ·{' '}
            {mealNames[meal]}
          </span>
          <button type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="f-primary" disabled={busy || ocrBusy || !place}>
            {busy
              ? '保存中…'
              : payment === 'invited'
                ? '保存 · 本人零支出'
                : paid.trim()
                  ? '保存这一餐'
                  : '先记地点'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
