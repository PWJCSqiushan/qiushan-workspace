import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFinanceMutation,
  buildFinancePostings,
  validateFinanceState,
} from '../lib/finance-domain.ts';
import {
  applyFinancePatches,
  type FinanceCategory,
  type FinanceState,
  type FinanceTransaction,
} from '../lib/finance-types.ts';

const categories: FinanceCategory[] = [
  { id: 'life', version: 1, name: '日常生活', parentId: null, level: 1 },
  { id: 'life-food', version: 1, name: '日常三餐', parentId: 'life', level: 2 },
  {
    id: 'life-food-meal',
    version: 1,
    name: '正餐',
    parentId: 'life-food',
    level: 3,
  },
  { id: 'hobby', version: 1, name: '兴趣爱好', parentId: null, level: 1 },
  { id: 'hobby-run', version: 1, name: '跑步', parentId: 'hobby', level: 2 },
  {
    id: 'hobby-run-race',
    version: 1,
    name: '赛事交通',
    parentId: 'hobby-run',
    level: 3,
  },
];

function baseState(): FinanceState {
  return {
    owner: 'synthetic',
    space: 'demo',
    version: 0,
    accounts: [
      {
        id: 'wallet',
        version: 1,
        name: '现金',
        kind: 'asset',
        openingCents: 100_000,
        openingAt: '2026-01-01T00:00:00+08:00',
      },
      {
        id: 'credit',
        version: 1,
        name: '信用账户',
        kind: 'credit',
        openingCents: 0,
        openingAt: '2026-01-01T00:00:00+08:00',
      },
    ],
    categories,
    places: [{ id: 'canteen', version: 1, name: '学校食堂', parentId: null }],
    activities: [
      {
        id: 'race',
        version: 1,
        name: '赛事',
        kind: 'event',
        categoryId: 'hobby-run',
        date: '2026-09-12',
      },
    ],
    transactions: [],
    meals: [
      {
        id: 'meal-1',
        version: 1,
        date: '2026-09-12',
        meal: 'lunch',
        placeId: 'canteen',
        companions: 'alone',
        payment: 'self',
        pricePending: false,
      },
    ],
    sponsorships: [],
    history: [],
  };
}

function commit(
  state: FinanceState,
  mutation: Parameters<typeof applyFinanceMutation>[1],
): FinanceState {
  const result = applyFinanceMutation(state, mutation);
  return applyFinancePatches(state, result.changes, state.version + 1);
}

function expense(
  overrides: Partial<FinanceTransaction> = {},
): FinanceTransaction {
  return {
    id: 'expense-1',
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-12T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 12_000,
    personalCents: 4_000,
    allocations: [
      {
        id: 'allocation-1',
        categoryId: 'life-food-meal',
        content: '午餐',
        amountCents: 4_000,
        nature: 'daily',
      },
    ],
    ...overrides,
  };
}

test('expense with AA balances personal expense and receivable', () => {
  const state = baseState();
  const transaction = expense({ amountCents: 12_000, personalCents: 4_000 });
  const postings = buildFinancePostings(transaction, state);
  assert.deepEqual(postings, [
    { account: 'expense:allocation-1', cents: 4_000 },
    { account: 'receivable:expense-1', cents: 8_000 },
    { account: 'wallet', cents: -12_000 },
  ]);
  assert.equal(
    postings.reduce((sum, posting) => sum + posting.cents, 0),
    0,
  );
  const result = applyFinanceMutation(state, {
    type: 'saveTransaction',
    transaction,
    expectedVersion: 0,
  });
  assert.equal(state.transactions.length, 0, 'domain must not mutate input');
  const saved = result.changes[0].value as FinanceTransaction;
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.postings, postings);
});

test('refund maps personal and receivable parts and rejects overspend', () => {
  let state = commit(baseState(), {
    type: 'saveTransaction',
    transaction: expense(),
    expectedVersion: 0,
  });
  const refund: FinanceTransaction = {
    id: 'refund-1',
    version: 0,
    kind: 'refund',
    occurredAt: '2026-10-01T12:00:00+08:00',
    accountId: 'wallet',
    amountCents: 2_000,
    personalCents: 1_000,
    relatedId: 'expense-1',
    allocations: [
      {
        id: 'refund-allocation-1',
        categoryId: 'life-food-meal',
        content: '退款',
        amountCents: 1_000,
        nature: 'daily',
        refundOfAllocationId: 'allocation-1',
      },
    ],
  };
  const refundResult = applyFinanceMutation(state, {
    type: 'saveTransaction',
    transaction: refund,
    expectedVersion: 0,
  });
  assert.deepEqual(
    (refundResult.changes[0].value as FinanceTransaction).postings,
    [
      { account: 'wallet', cents: 2_000 },
      { account: 'expense:allocation-1', cents: -1_000 },
      { account: 'receivable:expense-1', cents: -1_000 },
    ],
  );
  state = applyFinancePatches(state, refundResult.changes, 2);
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          ...refund,
          id: 'refund-too-large',
          version: 0,
          amountCents: 50_000,
          personalCents: 1_000,
          allocations: [
            {
              ...refund.allocations[0],
              id: 'refund-too-large-a',
              amountCents: 1_000,
            },
          ],
        },
        expectedVersion: 0,
      }),
    /exceeds original receivable/,
  );
});

test('refund and collection share one receivable ceiling', () => {
  let state = commit(baseState(), {
    type: 'saveTransaction',
    transaction: expense(),
    expectedVersion: 0,
  });
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'collect-1',
      version: 0,
      kind: 'collect',
      occurredAt: '2026-09-13',
      accountId: 'wallet',
      amountCents: 7_000,
      relatedId: 'expense-1',
      allocations: [],
    },
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          id: 'refund-external-too-much',
          version: 0,
          kind: 'refund',
          occurredAt: '2026-09-14',
          accountId: 'wallet',
          amountCents: 2_000,
          personalCents: 0,
          relatedId: 'expense-1',
          allocations: [],
        },
        expectedVersion: 0,
      }),
    /settlements exceed receivable|collections exceed receivable|exceeds original receivable/,
  );
});

test('transfers, credit borrowing and repayments keep virtual balances separate', () => {
  let state = baseState();
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'transfer',
      version: 0,
      kind: 'transfer',
      occurredAt: '2026-09-01',
      accountId: 'wallet',
      targetAccountId: 'credit',
      amountCents: 100,
      allocations: [],
    },
    expectedVersion: 0,
  });
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'borrow',
      version: 0,
      kind: 'borrow',
      occurredAt: '2026-09-02',
      accountId: 'wallet',
      amountCents: 500,
      allocations: [],
    },
    expectedVersion: 0,
  });
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'repay',
      version: 0,
      kind: 'repay',
      occurredAt: '2026-09-03',
      accountId: 'wallet',
      amountCents: 200,
      relatedId: 'borrow',
      allocations: [],
    },
    expectedVersion: 0,
  });
  validateFinanceState(state);
  assert.deepEqual(buildFinancePostings(state.transactions[1], state), [
    { account: 'wallet', cents: 500 },
    { account: 'payable:borrow', cents: -500 },
  ]);
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          id: 'repay-too-much',
          version: 0,
          kind: 'repay',
          occurredAt: '2026-09-03',
          accountId: 'wallet',
          amountCents: 400,
          relatedId: 'borrow',
          allocations: [],
        },
        expectedVersion: 0,
      }),
    /exceeds payable/,
  );
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'repay-2',
      version: 0,
      kind: 'repay',
      occurredAt: '2026-09-04',
      accountId: 'wallet',
      amountCents: 300,
      relatedId: 'borrow',
      allocations: [],
    },
    expectedVersion: 0,
  });
  const deleted = applyFinanceMutation(state, {
    type: 'delete',
    collection: 'transactions',
    id: 'repay-2',
    expectedVersion: 1,
  });
  state = applyFinancePatches(state, deleted.changes, state.version + 1);
  assert.doesNotThrow(() =>
    applyFinanceMutation(state, {
      type: 'saveTransaction',
      transaction: {
        id: 'repay-3',
        version: 0,
        kind: 'repay',
        occurredAt: '2026-09-05',
        accountId: 'wallet',
        amountCents: 300,
        relatedId: 'borrow',
        allocations: [],
      },
      expectedVersion: 0,
    }),
  );
});

test('expense paid by another person creates payable and supports split repayments', () => {
  let state = baseState();
  const payableExpense = expense({
    id: 'payable-expense',
    amountCents: 0,
    personalCents: 4_000,
    allocations: [
      {
        id: 'payable-expense-a',
        categoryId: 'life-food-meal',
        content: '代付午餐',
        amountCents: 4_000,
        nature: 'daily',
      },
    ],
  });
  const saved = applyFinanceMutation(state, {
    type: 'saveTransaction',
    transaction: payableExpense,
    expectedVersion: 0,
  });
  assert.deepEqual((saved.changes[0].value as FinanceTransaction).postings, [
    { account: 'expense:payable-expense-a', cents: 4_000 },
    { account: 'payable:payable-expense', cents: -4_000 },
  ]);
  state = applyFinancePatches(state, saved.changes, 1);
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'payable-repay-1',
      version: 0,
      kind: 'repay',
      occurredAt: '2026-09-13',
      accountId: 'wallet',
      amountCents: 2_500,
      relatedId: 'payable-expense',
      allocations: [],
    },
    expectedVersion: 0,
  });
  assert.doesNotThrow(() =>
    applyFinanceMutation(state, {
      type: 'saveTransaction',
      transaction: {
        id: 'payable-repay-2',
        version: 0,
        kind: 'repay',
        occurredAt: '2026-09-14',
        accountId: 'wallet',
        amountCents: 1_500,
        relatedId: 'payable-expense',
        allocations: [],
      },
      expectedVersion: 0,
    }),
  );
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          id: 'payable-repay-too-much',
          version: 0,
          kind: 'repay',
          occurredAt: '2026-09-14',
          accountId: 'wallet',
          amountCents: 1_501,
          relatedId: 'payable-expense',
          allocations: [],
        },
        expectedVersion: 0,
      }),
    /exceeds payable/,
  );
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'payable-repay-2',
      version: 0,
      kind: 'repay',
      occurredAt: '2026-09-14',
      accountId: 'wallet',
      amountCents: 1_500,
      relatedId: 'payable-expense',
      allocations: [],
    },
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          id: 'payable-refund-external',
          version: 0,
          kind: 'refund',
          occurredAt: '2026-09-15',
          accountId: 'wallet',
          amountCents: 100,
          personalCents: 50,
          relatedId: 'payable-expense',
          allocations: [],
        },
        expectedVersion: 0,
      }),
    /cannot settle a payable expense/,
  );
});

test('refund of a payable expense is limited to the amount this account actually paid', () => {
  let state = baseState();
  state = commit(state, {
    type: 'saveTransaction',
    transaction: expense({
      id: 'part-paid-expense',
      amountCents: 100,
      personalCents: 400,
      allocations: [
        {
          id: 'part-paid-a',
          categoryId: 'life-food-meal',
          content: '部分代付',
          amountCents: 400,
          nature: 'daily',
        },
      ],
    }),
    expectedVersion: 0,
  });
  const refund = applyFinanceMutation(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'part-paid-refund',
      version: 0,
      kind: 'refund',
      occurredAt: '2026-09-13',
      accountId: 'wallet',
      amountCents: 100,
      personalCents: 100,
      relatedId: 'part-paid-expense',
      allocations: [],
    },
    expectedVersion: 0,
  });
  assert.deepEqual((refund.changes[0].value as FinanceTransaction).postings, [
    { account: 'wallet', cents: 100 },
    { account: 'expense:part-paid-a', cents: -100 },
  ]);
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          id: 'part-paid-refund-too-large',
          version: 0,
          kind: 'refund',
          occurredAt: '2026-09-13',
          accountId: 'wallet',
          amountCents: 101,
          personalCents: 101,
          relatedId: 'part-paid-expense',
          allocations: [],
        },
        expectedVersion: 0,
      }),
    /exceeds amount actually paid/,
  );
});

test('account ids cannot collide with virtual ledger accounts', () => {
  const state = baseState();
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'accounts',
        entity: {
          id: 'income',
          version: 0,
          name: '伪造收入科目',
          kind: 'asset',
          openingCents: 0,
          openingAt: '2026-01-01T00:00:00+08:00',
        },
        expectedVersion: 0,
      }),
    /virtual ledger account/,
  );
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'accounts',
        entity: {
          id: 'wallet:shadow',
          version: 0,
          name: '伪造子科目',
          kind: 'asset',
          openingCents: 0,
          openingAt: '2026-01-01T00:00:00+08:00',
        },
        expectedVersion: 0,
      }),
    /virtual ledger account/,
  );
});

test('place default category must be an active leaf and blocks category deletion', () => {
  let state = baseState();
  state = commit(state, {
    type: 'put',
    collection: 'places',
    entity: { ...state.places[0], defaultCategoryId: 'life-food-meal' },
    expectedVersion: 1,
  });
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'places',
        entity: { ...state.places[0], defaultCategoryId: 'life-food' },
        expectedVersion: 2,
      }),
    /defaultCategoryId must reference a level-3/,
  );
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'delete',
        collection: 'categories',
        id: 'life-food-meal',
        expectedVersion: 1,
      }),
    /category is a place default/,
  );
});

test('unconfirmed account accepts transactions until one opening baseline is confirmed', () => {
  let state = baseState();
  state = commit(state, {
    type: 'put',
    collection: 'accounts',
    entity: {
      id: 'wechat',
      version: 0,
      name: '微信',
      kind: 'asset',
      openingCents: 0,
      openingAt: '2026-12-01T00:00:00+08:00',
      openingConfirmed: false,
    },
    expectedVersion: 0,
  });
  state = commit(state, {
    type: 'saveTransaction',
    transaction: expense({
      id: 'wechat-expense',
      accountId: 'wechat',
      occurredAt: '2026-09-01T12:00:00+08:00',
      amountCents: 100,
      personalCents: 100,
      allocations: [
        {
          id: 'wechat-expense-a',
          categoryId: 'life-food-meal',
          content: '微信消费',
          amountCents: 100,
          nature: 'daily',
        },
      ],
    }),
    expectedVersion: 0,
  });
  const confirmed = applyFinanceMutation(state, {
    type: 'put',
    collection: 'accounts',
    entity: {
      ...state.accounts.find((account) => account.id === 'wechat')!,
      openingCents: 10_000,
      openingAt: '2026-08-01T00:00:00+08:00',
      openingConfirmed: true,
    },
    expectedVersion: 1,
  });
  assert.equal(
    (confirmed.changes[0].value as (typeof state.accounts)[number])
      .openingConfirmed,
    true,
  );
  state = applyFinancePatches(state, confirmed.changes, state.version + 1);
  assert.equal(
    state.accounts.find((account) => account.id === 'wechat')?.openingCents,
    10_000,
  );
  assert.equal(
    state.transactions.length,
    1,
    'confirmation must not create a duplicate opening transaction',
  );
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'accounts',
        entity: {
          ...state.accounts.find((account) => account.id === 'wechat')!,
          openingCents: 20_000,
        },
        expectedVersion: 2,
      }),
    /opening balance/,
  );
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'accounts',
        entity: {
          ...state.accounts.find((account) => account.id === 'wechat')!,
          openingCents: 0,
          openingConfirmed: false,
        },
        expectedVersion: 2,
      }),
    /cannot unconfirm/,
  );
});

test('unconfirmed account must start at zero and confirmation cannot start after existing activity', () => {
  const state = baseState();
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'accounts',
        entity: {
          id: 'alipay',
          version: 0,
          name: '支付宝',
          kind: 'asset',
          openingCents: 1,
          openingAt: '2026-01-01T00:00:00+08:00',
          openingConfirmed: false,
        },
        expectedVersion: 0,
      }),
    /openingCents must be zero/,
  );
  let withAccount = commit(state, {
    type: 'put',
    collection: 'accounts',
    entity: {
      id: 'alipay',
      version: 0,
      name: '支付宝',
      kind: 'asset',
      openingCents: 0,
      openingAt: '2026-12-01T00:00:00+08:00',
      openingConfirmed: false,
    },
    expectedVersion: 0,
  });
  withAccount = commit(withAccount, {
    type: 'saveTransaction',
    transaction: expense({
      id: 'alipay-expense',
      accountId: 'alipay',
      occurredAt: '2026-09-01T12:00:00+08:00',
      amountCents: 100,
      personalCents: 100,
      allocations: [
        {
          id: 'alipay-expense-a',
          categoryId: 'life-food-meal',
          content: '支付宝消费',
          amountCents: 100,
          nature: 'daily',
        },
      ],
    }),
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      applyFinanceMutation(withAccount, {
        type: 'put',
        collection: 'accounts',
        entity: {
          ...withAccount.accounts.find((account) => account.id === 'alipay')!,
          openingCents: 10_000,
          openingAt: '2026-10-01T00:00:00+08:00',
          openingConfirmed: true,
        },
        expectedVersion: 1,
      }),
    /existing transactions/,
  );
});

test('analysisOnly permits pre-opening history but does not create account postings', () => {
  const state = baseState();
  const historical = expense({
    id: 'history',
    occurredAt: '2025-12-01',
    amountCents: 1_000,
    personalCents: 1_000,
    allocations: [
      {
        id: 'history-a',
        categoryId: 'life-food-meal',
        content: '历史餐饮',
        amountCents: 1_000,
        nature: 'daily',
      },
    ],
    analysisOnly: true,
  });
  assert.deepEqual(buildFinancePostings(historical, state), []);
  assert.doesNotThrow(() =>
    applyFinanceMutation(state, {
      type: 'saveTransaction',
      transaction: historical,
      expectedVersion: 0,
    }),
  );
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: { ...historical, id: 'bad-history', analysisOnly: false },
        expectedVersion: 0,
      }),
    /precedes account openingAt/,
  );
});

test('deleting referenced records is blocked and soft delete is versioned', () => {
  let state = commit(baseState(), {
    type: 'saveTransaction',
    transaction: expense(),
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'delete',
        collection: 'categories',
        id: 'life-food-meal',
        expectedVersion: 1,
      }),
    /used by an allocation/,
  );
  state = commit(state, {
    type: 'put',
    collection: 'categories',
    entity: { ...categories[2], name: '正餐更新' },
    expectedVersion: 1,
  });
  assert.equal(
    state.categories.find((category) => category.id === 'life-food-meal')
      ?.version,
    2,
  );
  const deleted = applyFinanceMutation(state, {
    type: 'delete',
    collection: 'transactions',
    id: 'expense-1',
    expectedVersion: 1,
  });
  assert.equal((deleted.changes[0].value as FinanceTransaction).deleted, true);
});

test('configure enforces a complete three-level tree and only runs once', () => {
  const state = baseState();
  state.categories = [];
  state.activities = [];
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'configure',
        categories: [{ ...categories[0] }],
      }),
    /all three levels/,
  );
  const result = applyFinanceMutation(state, {
    type: 'configure',
    categories,
    places: [{ id: 'p', version: 0, name: '地点', parentId: null }],
  });
  assert.equal(result.changes.length, categories.length + 1);
  const configured = applyFinancePatches(state, result.changes, 1);
  assert.throws(
    () => applyFinanceMutation(configured, { type: 'configure', categories }),
    /empty category directory/,
  );
});

test('opening balance changes are rejected after account activity', () => {
  const state = commit(baseState(), {
    type: 'saveTransaction',
    transaction: expense(),
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'accounts',
        entity: { ...state.accounts[0], openingCents: 200_000 },
        expectedVersion: 1,
      }),
    /opening balance/,
  );
});

test('source keys remain unique across soft-deleted import tombstones', () => {
  let state = baseState();
  state = commit(state, {
    type: 'saveTransaction',
    transaction: {
      ...expense({ id: 'imported', sourceKey: 'platform:123' }),
      amountCents: 100,
      personalCents: 100,
      allocations: [
        {
          id: 'imported-a',
          categoryId: null,
          content: '待分类',
          amountCents: 100,
          nature: 'daily',
        },
      ],
    },
    expectedVersion: 0,
  });
  const deleted = applyFinanceMutation(state, {
    type: 'delete',
    collection: 'transactions',
    id: 'imported',
    expectedVersion: 1,
  });
  state = applyFinancePatches(state, deleted.changes, state.version + 1);
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'saveTransaction',
        transaction: {
          ...expense({ id: 'duplicate', sourceKey: 'platform:123' }),
          amountCents: 100,
          personalCents: 100,
          allocations: [
            {
              id: 'duplicate-a',
              categoryId: null,
              content: '待分类',
              amountCents: 100,
              nature: 'daily',
            },
          ],
        },
        expectedVersion: 0,
      }),
    /duplicate transaction sourceKey/,
  );
});

test('active meal date and meal slot is unique, while a soft-deleted slot can be recreated', () => {
  const state = baseState();
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'meals',
        entity: {
          id: 'meal-duplicate',
          version: 0,
          date: '2026-09-12',
          meal: 'lunch',
          placeId: 'canteen',
          companions: 'alone',
          payment: 'self',
          pricePending: true,
        },
        expectedVersion: 0,
      }),
    /duplicate active meal slot/,
  );
  const deleted = applyFinanceMutation(state, {
    type: 'delete',
    collection: 'meals',
    id: 'meal-1',
    expectedVersion: 1,
  });
  const afterDelete = applyFinancePatches(
    state,
    deleted.changes,
    state.version + 1,
  );
  assert.doesNotThrow(() =>
    applyFinanceMutation(afterDelete, {
      type: 'put',
      collection: 'meals',
      entity: {
        id: 'meal-recreated',
        version: 0,
        date: '2026-09-12',
        meal: 'lunch',
        placeId: 'canteen',
        companions: 'alone',
        payment: 'self',
        pricePending: true,
      },
      expectedVersion: 0,
    }),
  );
});

test('custody pay cannot exceed custody receipts', () => {
  const state = baseState();
  const received = commit(state, {
    type: 'saveTransaction',
    transaction: {
      id: 'custody-in',
      version: 0,
      kind: 'custodyReceive',
      occurredAt: '2026-09-01',
      accountId: 'wallet',
      amountCents: 500,
      caseId: 'club',
      allocations: [],
    },
    expectedVersion: 0,
  });
  assert.throws(
    () =>
      applyFinanceMutation(received, {
        type: 'saveTransaction',
        transaction: {
          id: 'custody-out',
          version: 0,
          kind: 'custodyPay',
          occurredAt: '2026-09-02',
          accountId: 'wallet',
          amountCents: 600,
          caseId: 'club',
          allocations: [],
        },
        expectedVersion: 0,
      }),
    /custody payments exceed receipts/,
  );
});

test('bill-derived meals retain unspecified companions and settlement instead of inventing defaults', () => {
  const state = baseState();
  state.meals.push({id:'bill-meal',version:1,date:'2026-09-01',meal:'lunch',placeId:'canteen',companions:'unknown',payment:'unknown',pricePending:false,note:'餐次根据付款时间推测'});
  assert.doesNotThrow(() => validateFinanceState(state));
  assert.equal(state.meals.at(-1)?.companions, 'unknown');
  assert.equal(state.meals.at(-1)?.payment, 'unknown');
});
