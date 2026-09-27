import type {
  FinanceAllocation,
  FinanceGroup,
  FinanceMeal,
  FinanceNature,
  FinanceStats,
  FinanceState,
  FinanceTransaction,
} from './finance-types.ts';
import {
  addFinanceCents,
  buildFinancePostings,
  validateFinanceState,
} from './finance-domain.ts';

export type FinanceStatsRange = {
  from: string;
  to: string;
  meal?: FinanceMeal['meal'];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function dateKey(value: string): string {
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (dateOnly) {
    const [year, month, day] = dateOnly[1].split('-').map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    assert(
      check.getUTCFullYear() === year &&
        check.getUTCMonth() === month - 1 &&
        check.getUTCDate() === day,
      `invalid date: ${value}`,
    );
    return dateOnly[1];
  }
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `invalid date: ${value}`);
  return SHANGHAI_DATE.format(new Date(parsed));
}

function inRange(date: string, range: FinanceStatsRange): boolean {
  return date >= range.from && date < range.to;
}

function personalCents(transaction: FinanceTransaction): number {
  if (transaction.kind === 'expense')
    return transaction.personalCents ?? transaction.amountCents;
  if (transaction.kind === 'refund')
    return (
      transaction.personalCents ??
      transaction.allocations.reduce(
        (sum, allocation) =>
          addFinanceCents(
            sum,
            allocation.amountCents,
            `transaction ${transaction.id} allocation total`,
          ),
        0,
      )
    );
  return 0;
}

function expensePersonalCents(transaction: FinanceTransaction): number {
  return transaction.kind === 'expense' ? personalCents(transaction) : 0;
}

function refundPersonalCents(transaction: FinanceTransaction): number {
  return transaction.kind === 'refund' ? personalCents(transaction) : 0;
}

type Contribution = {
  amountCents: number;
  transactionId: string;
  allocation: FinanceAllocation | null;
  count: boolean;
  merchantId?: string;
};

type GroupAccumulator = { amountCents: number; ids: Set<string> };

function addGroup(
  groups: Map<string, GroupAccumulator>,
  id: string,
  amountCents: number,
  transactionId: string,
  count: boolean,
): void {
  const item = groups.get(id) ?? { amountCents: 0, ids: new Set<string>() };
  item.amountCents = addFinanceCents(
    item.amountCents,
    amountCents,
    `stats group ${id}`,
  );
  if (count) item.ids.add(transactionId);
  groups.set(id, item);
}

function toGroups(
  groups: Map<string, GroupAccumulator>,
  nameFor: (id: string) => string,
): FinanceGroup[] {
  return Array.from(groups, ([id, value]) => ({
    id,
    name: nameFor(id),
    cents: value.amountCents,
    count: value.ids.size,
  })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

function addContribution(
  contribution: Contribution,
  groups: {
    category: Map<string, GroupAccumulator>;
    content: Map<string, GroupAccumulator>;
    merchant: Map<string, GroupAccumulator>;
    activity: Map<string, GroupAccumulator>;
    nature: Map<string, GroupAccumulator>;
  },
  daily: Map<string, number>,
  date: string,
): void {
  const allocation = contribution.allocation;
  const amount = contribution.amountCents;
  const categoryId = allocation?.categoryId ?? '__unclassified__';
  addGroup(
    groups.category,
    categoryId,
    amount,
    contribution.transactionId,
    contribution.count,
  );
  addGroup(
    groups.content,
    allocation?.content ?? '__unclassified__',
    amount,
    contribution.transactionId,
    contribution.count,
  );
  addGroup(
    groups.merchant,
    contribution.merchantId ?? allocation?.merchantId ?? '__unknown__',
    amount,
    contribution.transactionId,
    contribution.count,
  );
  addGroup(
    groups.activity,
    allocation?.activityId ?? '__unassociated__',
    amount,
    contribution.transactionId,
    contribution.count,
  );
  addGroup(
    groups.nature,
    allocation?.nature ?? '__unknown__',
    amount,
    contribution.transactionId,
    contribution.count,
  );
  daily.set(
    date,
    addFinanceCents(daily.get(date) ?? 0, amount, `daily total ${date}`),
  );
}

function categoryName(state: FinanceState, id: string): string {
  if (id === '__unclassified__') return '待分类';
  return state.categories.find((category) => category.id === id)?.name ?? id;
}

function merchantName(state: FinanceState, id: string): string {
  if (id === '__unknown__') return '未指定商家';
  return state.places.find((place) => place.id === id)?.name ?? id;
}

function activityName(state: FinanceState, id: string): string {
  if (id === '__unassociated__') return '未关联活动';
  return state.activities.find((activity) => activity.id === id)?.name ?? id;
}

function natureName(id: string): string {
  const labels: Record<FinanceNature, string> = {
    daily: '日常消耗',
    durable: '耐用品',
    rental: '租赁',
    subscription: '订阅',
    credits: '额度充值',
  };
  if (id === '__unknown__') return '未指定性质';
  return labels[id as FinanceNature] ?? id;
}

function validateRange(range: FinanceStatsRange): void {
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(range.from),
    'stats.from must be YYYY-MM-DD',
  );
  assert(/^\d{4}-\d{2}-\d{2}$/.test(range.to), 'stats.to must be YYYY-MM-DD');
  assert(range.from < range.to, 'stats.from must be before stats.to');
  dateKey(range.from);
  dateKey(range.to);
  if (range.meal !== undefined)
    assert(
      range.meal === 'breakfast' ||
        range.meal === 'lunch' ||
        range.meal === 'dinner',
      'stats.meal is invalid',
    );
}

function originalForRefund(
  state: FinanceState,
  transaction: FinanceTransaction,
): FinanceTransaction | undefined {
  if (transaction.kind !== 'refund' || !transaction.relatedId) return undefined;
  return state.transactions.find(
    (candidate) => candidate.id === transaction.relatedId && !candidate.deleted,
  );
}

function refundByAllocation(
  state: FinanceState,
  originalId: string,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const refund of state.transactions) {
    if (
      refund.deleted ||
      refund.kind !== 'refund' ||
      refund.relatedId !== originalId
    )
      continue;
    for (const allocation of refund.allocations) {
      if (!allocation.refundOfAllocationId) continue;
      result.set(
        allocation.refundOfAllocationId,
        addFinanceCents(
          result.get(allocation.refundOfAllocationId) ?? 0,
          allocation.amountCents,
          `refund allocation ${allocation.refundOfAllocationId}`,
        ),
      );
    }
  }
  return result;
}

/**
 * Calculate period statistics. Refunds are applied to their original expense
 * date, so a later refund corrects the month in which the purchase happened.
 * Unknown allocation purpose remains a visible `待分类` group.
 */
export function calculateFinanceStats(
  state: FinanceState,
  range: FinanceStatsRange,
): FinanceStats {
  validateRange(range);
  validateFinanceState(state);
  const category = new Map<string, GroupAccumulator>();
  const content = new Map<string, GroupAccumulator>();
  const merchant = new Map<string, GroupAccumulator>();
  const activity = new Map<string, GroupAccumulator>();
  const nature = new Map<string, GroupAccumulator>();
  const daily = new Map<string, number>();
  const refundApplied = new Set<string>();
  const groups = { category, content, merchant, activity, nature };
  let personalTotal = 0;
  let incomeTotal = 0;

  const expenses = state.transactions.filter(
    (transaction) => !transaction.deleted && transaction.kind === 'expense',
  );
  for (const expense of expenses) {
    const date = dateKey(expense.occurredAt);
    if (!inRange(date, range)) continue;
    const originalPersonal = expensePersonalCents(expense);
    const byAllocation = refundByAllocation(state, expense.id);
    const refunds = state.transactions.filter(
      (transaction) =>
        !transaction.deleted &&
        transaction.kind === 'refund' &&
        transaction.relatedId === expense.id,
    );
    const mappedRefund = new Map(byAllocation);
    const mappedRefundTotal = Array.from(mappedRefund.values()).reduce(
      (sum, value) =>
        addFinanceCents(sum, value, `mapped refunds for ${expense.id}`),
      0,
    );
    const refundTotal = refunds.reduce(
      (sum, refund) =>
        addFinanceCents(
          sum,
          refundPersonalCents(refund),
          `refunds for ${expense.id}`,
        ),
      0,
    );
    const unmappedRefund = addFinanceCents(
      refundTotal,
      -mappedRefundTotal,
      `unmapped refunds for ${expense.id}`,
    );
    const lines: Contribution[] = [];
    if (expense.allocations.length === 0) {
      lines.push({
        amountCents: originalPersonal,
        transactionId: expense.id,
        allocation: null,
        count: true,
        merchantId: expense.counterparty ?? '__unknown__',
      });
    } else {
      for (const allocation of expense.allocations) {
        lines.push({
          amountCents: addFinanceCents(
            allocation.amountCents,
            -(mappedRefund.get(allocation.id) ?? 0),
            `allocation ${allocation.id} net amount`,
          ),
          transactionId: expense.id,
          allocation,
          count: true,
          merchantId:
            allocation.merchantId ?? expense.counterparty ?? '__unknown__',
        });
      }
    }
    if (unmappedRefund > 0) {
      // Without a refund allocation mapping, assigning the refund to one of
      // several purposes would be a guess. Keep it visible as unclassified.
      lines.push({
        amountCents: -unmappedRefund,
        transactionId: expense.id,
        allocation: null,
        count: false,
        merchantId: expense.counterparty ?? '__unknown__',
      });
    }
    for (const line of lines) addContribution(line, groups, daily, date);
    personalTotal = addFinanceCents(
      personalTotal,
      addFinanceCents(
        originalPersonal,
        -refundTotal,
        `expense ${expense.id} net amount`,
      ),
      'personal total',
    );
    refunds.forEach((refund) => refundApplied.add(refund.id));
  }

  // A malformed/orphan refund is rejected by validateFinanceState. This
  // branch is defensive and ensures a valid analysis never silently drops a
  // refund if the original was outside the selected range.
  for (const refund of state.transactions.filter(
    (transaction) =>
      !transaction.deleted &&
      transaction.kind === 'refund' &&
      !refundApplied.has(transaction.id),
  )) {
    const original = originalForRefund(state, refund);
    if (!original) continue;
    const originalDate = dateKey(original.occurredAt);
    if (inRange(originalDate, range)) {
      personalTotal = addFinanceCents(
        personalTotal,
        -refundPersonalCents(refund),
        'personal total',
      );
      refundApplied.add(refund.id);
    }
  }

  for (const transaction of state.transactions) {
    if (transaction.deleted || transaction.kind !== 'income') continue;
    if (inRange(dateKey(transaction.occurredAt), range))
      incomeTotal = addFinanceCents(
        incomeTotal,
        transaction.amountCents,
        'income total',
      );
  }

  const accountTotals = new Map<string, number>();
  for (const account of state.accounts.filter(
    (candidate) => !candidate.deleted,
  ))
    accountTotals.set(account.id, account.openingCents);
  let receivable = 0;
  let payable = 0;
  let custody = 0;
  for (const transaction of state.transactions) {
    if (transaction.deleted || transaction.analysisOnly) continue;
    if (dateKey(transaction.occurredAt) >= range.to) continue;
    for (const posting of buildFinancePostings(transaction, state)) {
      if (accountTotals.has(posting.account))
        accountTotals.set(
          posting.account,
          addFinanceCents(
            accountTotals.get(posting.account)!,
            posting.cents,
            `account ${posting.account} balance`,
          ),
        );
      if (posting.account.startsWith('receivable:'))
        receivable = addFinanceCents(
          receivable,
          posting.cents,
          'receivable total',
        );
      if (posting.account.startsWith('payable:'))
        payable = addFinanceCents(payable, posting.cents, 'payable total');
      if (posting.account.startsWith('custody:'))
        custody = addFinanceCents(custody, -posting.cents, 'custody total');
    }
  }

  const mealRows = state.meals.filter(
    (meal) =>
      !meal.deleted &&
      inRange(meal.date, range) &&
      (range.meal === undefined || meal.meal === range.meal),
  );
  const mealIds = new Set(mealRows.map((meal) => meal.id));
  const mealById = new Map(mealRows.map((meal) => [meal.id, meal]));
  const mealPlaceMap = new Map<
    string,
    { count: number; days: Set<string>; cents: number }
  >();
  for (const meal of mealRows) {
    const row = mealPlaceMap.get(meal.placeId) ?? {
      count: 0,
      days: new Set<string>(),
      cents: 0,
    };
    row.count += 1;
    row.days.add(meal.date);
    mealPlaceMap.set(meal.placeId, row);
  }
  const addMealAmount = (merchantId: string, amountCents: number): void => {
    const row = mealPlaceMap.get(merchantId) ?? {
      count: 0,
      days: new Set<string>(),
      cents: 0,
    };
    row.cents = addFinanceCents(
      row.cents,
      amountCents,
      `meal merchant ${merchantId}`,
    );
    mealPlaceMap.set(merchantId, row);
  };
  for (const expense of expenses) {
    if (!expense.mealId) {
      // Known dining payments count toward restaurant spending even when the
      // meal link is still under review. They never invent a meal count/slot.
      if (range.meal === undefined) {
        const refunded = refundByAllocation(state, expense.id);
        for (const allocation of expense.allocations.filter(
          (a) => a.content === '餐饮',
        ))
          addMealAmount(
            allocation.merchantId ?? expense.counterparty ?? '__unknown__',
            allocation.amountCents - (refunded.get(allocation.id) || 0),
          );
      }
      continue;
    }
    if (!mealIds.has(expense.mealId)) continue;
    const meal = mealById.get(expense.mealId)!;
    const byAllocation = refundByAllocation(state, expense.id);
    const refunds = state.transactions.filter(
      (transaction) =>
        !transaction.deleted &&
        transaction.kind === 'refund' &&
        transaction.relatedId === expense.id,
    );
    const refundTotal = refunds.reduce(
      (sum, refund) =>
        addFinanceCents(
          sum,
          refundPersonalCents(refund),
          `meal refunds for ${expense.id}`,
        ),
      0,
    );
    if (expense.allocations.length === 0) {
      addMealAmount(
        meal.placeId,
        addFinanceCents(
          expensePersonalCents(expense),
          -refundTotal,
          `meal ${meal.id} net amount`,
        ),
      );
      continue;
    }
    let mappedRefundTotal = 0;
    for (const allocation of expense.allocations) {
      const refunded = byAllocation.get(allocation.id) ?? 0;
      mappedRefundTotal = addFinanceCents(
        mappedRefundTotal,
        refunded,
        `meal mapped refunds for ${expense.id}`,
      );
      const merchantId =
        allocation.merchantId ?? expense.counterparty ?? meal.placeId;
      addMealAmount(
        merchantId,
        addFinanceCents(
          allocation.amountCents,
          -refunded,
          `meal allocation ${allocation.id} net amount`,
        ),
      );
    }
    const unmappedRefund = addFinanceCents(
      refundTotal,
      -mappedRefundTotal,
      `meal unmapped refunds for ${expense.id}`,
    );
    if (unmappedRefund > 0) addMealAmount('__unknown__', -unmappedRefund);
  }
  const sponsorCents = state.sponsorships
    .filter(
      (sponsorship) =>
        !sponsorship.deleted &&
        sponsorship.date !== undefined &&
        inRange(sponsorship.date, range),
    )
    .reduce(
      (sum, sponsorship) =>
        addFinanceCents(sum, sponsorship.amountCents, 'sponsorship total'),
      0,
    );

  const accountBalances = state.accounts
    .filter((account) => !account.deleted)
    .map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      cents: accountTotals.get(account.id) ?? account.openingCents,
    }));
  const mealPlaces = Array.from(mealPlaceMap, ([id, value]) => ({
    id,
    name: merchantName(state, id),
    count: value.count,
    days: value.days.size,
    cents: value.cents,
  })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
  const categoryTotals = toGroups(category, (id) => categoryName(state, id));
  const contentTotals = toGroups(content, (id) =>
    id === '__unclassified__' ? '待分类' : id,
  );
  const merchantTotals = toGroups(merchant, (id) => merchantName(state, id));
  const activityTotals = toGroups(activity, (id) => activityName(state, id));
  const natureTotals = toGroups(nature, natureName);
  const dailyRows = Array.from(daily, ([date, cents]) => ({
    date,
    cents,
  })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    from: range.from,
    to: range.to,
    personalCents: personalTotal,
    incomeCents: incomeTotal,
    unclassifiedCents: category.get('__unclassified__')?.amountCents ?? 0,
    categoryTotals,
    contentTotals,
    merchantTotals,
    activityTotals,
    natureTotals,
    daily: dailyRows,
    accountBalances,
    receivableCents: Math.max(0, receivable),
    payableCents: Math.max(0, -payable),
    custodyCents: Math.max(0, custody),
    sponsorCents,
    mealCount: mealRows.length,
    pendingMealCount: mealRows.filter((meal) => meal.pricePending).length,
    mealPlaces,
  };
}
