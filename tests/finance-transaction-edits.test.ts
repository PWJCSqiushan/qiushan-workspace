import test from 'node:test';
import assert from 'node:assert/strict';
import {
  transactionEditBatch,
  transactionPersonalCents,
  preservesUnallocatedExpense,
} from '../lib/finance-transaction-edits.ts';
import { FinanceStore } from '../lib/finance-store.ts';
import type {
  FinanceTransaction,
  FinanceMutation,
} from '../lib/finance-types.ts';
import { database } from './d1-helper.ts';

function expense(id: string): FinanceTransaction {
  return {
    id,
    version: 0,
    kind: 'expense',
    occurredAt: '2026-09-01T12:00:00+08:00',
    accountId: 'cash',
    amountCents: 1000,
    allocations: [],
    note: '原备注',
    sourceKey: 'synthetic-' + id,
  };
}
void test('single metadata edits preserve imported unallocated expenses until a purpose is entered', () => {
  const original = expense('unallocated');
  const line = {
    id: 'draft',
    categoryId: null,
    content: '其他',
    nature: 'daily' as const,
  };
  assert.equal(preservesUnallocatedExpense(original, 'expense', [line]), true);
  assert.equal(
    preservesUnallocatedExpense(original, 'expense', [
      { ...line, categoryId: 'leaf' },
    ]),
    false,
  );
  assert.equal(
    preservesUnallocatedExpense(original, 'expense', [
      { ...line, content: '交通' },
    ]),
    false,
  );
  assert.equal(
    preservesUnallocatedExpense(original, 'expense', [
      line,
      { ...line, id: 'split' },
    ]),
    false,
  );
  assert.equal(
    preservesUnallocatedExpense(undefined, 'expense', [line]),
    false,
  );
});
void test('legacy defaults, zero personal amount, split allocations and metadata are preserved', () => {
  const legacy = expense('legacy');
  assert.equal(transactionPersonalCents(legacy), 1000);
  assert.equal(transactionPersonalCents({ ...legacy, personalCents: 0 }), 0);
  assert.equal(transactionPersonalCents({ ...legacy, kind: 'refund' }), 0);
  const split = {
    ...expense('split'),
    personalCents: 800,
    allocations: [
      {
        id: 'a1',
        categoryId: null,
        content: '餐饮',
        nature: 'daily' as const,
        amountCents: 300,
        note: '保留说明',
      },
      {
        id: 'a2',
        categoryId: null,
        content: '日用品',
        nature: 'durable' as const,
        amountCents: 500,
      },
    ],
  };
  const batch = transactionEditBatch([legacy, split], { categoryId: 'leaf' });
  assert.equal(batch.type, 'batch');
  if (batch.type !== 'batch') return;
  const first = batch.mutations[0],
    second = batch.mutations[1];
  assert.equal(first.type, 'saveTransaction');
  assert.equal(second.type, 'saveTransaction');
  if (first.type !== 'saveTransaction' || second.type !== 'saveTransaction')
    return;
  assert.equal(first.transaction.allocations[0].amountCents, 1000);
  assert.equal(first.transaction.personalCents, undefined);
  assert.equal(first.transaction.sourceKey, legacy.sourceKey);
  assert.deepEqual(
    second.transaction.allocations,
    split.allocations.map((a) => ({ ...a, categoryId: 'leaf' })),
  );
  assert.deepEqual(legacy.allocations, []);
  assert.throws(
    () =>
      transactionEditBatch(
        Array.from({ length: 51 }, (_, i) => expense('t' + i)),
        { note: '新' },
      ),
    /50/,
  );
  assert.throws(() => transactionEditBatch([legacy], {}), /没有需要/);
});

void test('25 and 50 row batches are atomic in D1, undo/redo and stale failure', async () => {
  const { db, sqlite } = database();
  const store = new FinanceStore(db, 'edit-test');
  let sequence = 0;
  const send = (mutation: FinanceMutation) =>
    store.mutate({
      space: 'demo',
      baseVersion: 0,
      operationId: 'edit-' + ++sequence,
      mutation,
    });
  try {
    await send({
      type: 'put',
      collection: 'accounts',
      expectedVersion: 0,
      entity: {
        id: 'cash',
        version: 0,
        name: '合成账户',
        kind: 'asset',
        openingCents: 100000,
        openingAt: '2026-01-01T00:00:00Z',
      },
    });
    await send({
      type: 'batch',
      mutations: Array.from({ length: 50 }, (_, i) => ({
        type: 'saveTransaction' as const,
        transaction: expense('t' + i),
        expectedVersion: 0,
      })),
    });
    const before = await store.snapshot('demo');
    const receipt = await send(
      transactionEditBatch(before.transactions.slice(0, 25), {
        categoryId: null,
        counterparty: '统一商家',
      }),
    );
    let after = await store.snapshot('demo');
    assert.equal(
      after.transactions.filter((t) => t.counterparty === '统一商家').length,
      25,
    );
    assert.ok(
      after.transactions
        .filter((t) => t.counterparty)
        .every((t) => t.allocations[0].amountCents === 1000),
    );
    await send({ type: 'undo', historyId: receipt.history!.id });
    after = await store.snapshot('demo');
    assert.ok(
      after.transactions.every(
        (t) => !t.counterparty && t.allocations.length === 0,
      ),
    );
    await send({ type: 'redo', historyId: receipt.history!.id });
    after = await store.snapshot('demo');
    const stale = transactionEditBatch(after.transactions, {
      note: '不应部分保存',
    });
    await send(
      transactionEditBatch([after.transactions.at(-1)!], {
        note: '另一设备修改',
      }),
    );
    const unchanged = await store.snapshot('demo');
    await assert.rejects(send(stale), /其他设备修改/);
    assert.deepEqual(await store.snapshot('demo'), unchanged);
    await send(
      transactionEditBatch(unchanged.transactions, { note: '50笔一起修改' }),
    );
    assert.ok(
      (await store.snapshot('demo')).transactions.every(
        (t) => t.note === '50笔一起修改',
      ),
    );
  } finally {
    sqlite.close();
  }
});

void test('classification preserves refund mapping and settled AA balances', async () => {
  const { db, sqlite } = database();
  const store = new FinanceStore(db, 'linked-edits');
  let sequence = 0;
  const send = (mutation: FinanceMutation) =>
    store.mutate({
      space: 'demo',
      baseVersion: 0,
      operationId: 'link-' + ++sequence,
      mutation,
    });
  try {
    await send({
      type: 'put',
      collection: 'accounts',
      expectedVersion: 0,
      entity: {
        id: 'cash',
        version: 0,
        name: '测试账户',
        kind: 'asset',
        openingCents: 100000,
        openingAt: '2026-01-01T00:00:00Z',
      },
    });
    await send({
      type: 'batch',
      mutations: [
        { id: 'root', name: '一级', level: 1 as const, parentId: null },
        { id: 'middle', name: '二级', level: 2 as const, parentId: 'root' },
        { id: 'leaf', name: '三级', level: 3 as const, parentId: 'middle' },
      ].map((entity) => ({
        type: 'put' as const,
        collection: 'categories' as const,
        entity: { ...entity, version: 0 },
        expectedVersion: 0,
      })),
    });
    const original: FinanceTransaction = {
      ...expense('original'),
      personalCents: 800,
      allocations: [
        {
          id: 'a1',
          categoryId: null,
          content: '餐饮',
          amountCents: 300,
          nature: 'daily',
        },
        {
          id: 'a2',
          categoryId: null,
          content: '用品',
          amountCents: 500,
          nature: 'durable',
        },
      ],
    };
    const refund: FinanceTransaction = {
      ...expense('refund'),
      kind: 'refund',
      relatedId: original.id,
      amountCents: 200,
      personalCents: 200,
      allocations: [
        {
          id: 'r1',
          refundOfAllocationId: 'a1',
          categoryId: null,
          content: '餐饮',
          amountCents: 200,
          nature: 'daily',
        },
      ],
    };
    const collect: FinanceTransaction = {
      ...expense('collect'),
      kind: 'collect',
      relatedId: original.id,
      amountCents: 200,
      allocations: [],
    };
    await send({
      type: 'batch',
      mutations: [original, refund, collect].map((transaction) => ({
        type: 'saveTransaction' as const,
        transaction,
        expectedVersion: 0,
      })),
    });
    const before = await store.snapshot('demo');
    await send(
      transactionEditBatch(before.transactions, { categoryId: 'leaf' }),
    );
    const after = await store.snapshot('demo');
    assert.deepEqual(
      after.transactions.find((t) => t.id === 'refund'),
      before.transactions.find((t) => t.id === 'refund'),
    );
    assert.deepEqual(
      after.transactions.find((t) => t.id === 'collect'),
      before.transactions.find((t) => t.id === 'collect'),
    );
    const updated = after.transactions.find((t) => t.id === 'original')!;
    assert.deepEqual(
      updated.postings,
      before.transactions.find((t) => t.id === 'original')!.postings,
    );
    assert.deepEqual(
      updated.allocations.map((a) => a.id),
      ['a1', 'a2'],
    );
    assert.ok(updated.allocations.every((a) => a.categoryId === 'leaf'));
    await send(
      transactionEditBatch(after.transactions, {
        note: '关联仍保留',
        counterparty: '',
      }),
    );
    const final = await store.snapshot('demo');
    assert.equal(
      final.transactions.find((t) => t.id === 'refund')!.relatedId,
      'original',
    );
    assert.equal(
      final.transactions.find((t) => t.id === 'collect')!.relatedId,
      'original',
    );
  } finally {
    sqlite.close();
  }
});
