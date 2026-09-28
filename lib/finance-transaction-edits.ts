import type {
  FinanceAllocation,
  FinanceKind,
  FinanceMutation,
  FinanceTransaction,
} from './finance-types.ts';

/** Editing metadata must not invent an allocation for an imported expense. */
export function preservesUnallocatedExpense(
  initial: FinanceTransaction | undefined,
  kind: FinanceKind,
  lines: Omit<FinanceAllocation, 'amountCents'>[],
): boolean {
  return (
    initial?.kind === 'expense' &&
    initial.allocations.length === 0 &&
    kind === 'expense' &&
    lines.length === 1 &&
    lines.every(
      (l) =>
        l.categoryId === null &&
        l.content === '其他' &&
        l.nature === 'daily' &&
        !l.merchantId &&
        !l.activityId &&
        !l.note,
    )
  );
}

/** Same defaults as the ledger domain, including legacy unallocated refunds. */
export function transactionPersonalCents(t: FinanceTransaction): number {
  if (t.kind === 'expense') return t.personalCents ?? t.amountCents;
  if (t.kind === 'refund')
    return (
      t.personalCents ??
      t.allocations.reduce((sum, a) => sum + a.amountCents, 0)
    );
  return 0;
}

export type TransactionEdits = {
  categoryId?: string | null;
  counterparty?: string;
  note?: string;
};

/** One version-guarded batch; never split a user action into partial commits. */
export function transactionEditBatch(
  transactions: FinanceTransaction[],
  edits: TransactionEdits,
): FinanceMutation {
  if (!transactions.length) throw new Error('请先选择流水');
  if (transactions.length > 50)
    throw new Error('一次最多修改 50 笔，请缩小选择范围；尚未修改任何流水');
  if (new Set(transactions.map((t) => t.id)).size !== transactions.length)
    throw new Error('选择的流水重复，请重新选择');
  const mutations: Extract<FinanceMutation, { type: 'saveTransaction' }>[] = [];
  for (const t of transactions) {
    if (t.deleted) throw new Error('部分流水已删除，请关闭面板并重新选择');
    const transaction = { ...t };
    if (edits.counterparty !== undefined)
      transaction.counterparty = edits.counterparty.trim() || undefined;
    if (edits.note !== undefined)
      transaction.note = edits.note.trim() || undefined;
    if (
      edits.categoryId !== undefined &&
      t.kind === 'expense' &&
      transactionPersonalCents(t) > 0
    ) {
      transaction.allocations = t.allocations.length
        ? t.allocations.map((a) => ({ ...a, categoryId: edits.categoryId! }))
        : [
            {
              id: 'a-' + crypto.randomUUID(),
              categoryId: edits.categoryId,
              content: '其他',
              nature: 'daily',
              amountCents: transactionPersonalCents(t),
            },
          ];
    }
    if (JSON.stringify(transaction) !== JSON.stringify(t))
      mutations.push({
        type: 'saveTransaction',
        transaction,
        expectedVersion: t.version,
      });
  }
  if (!mutations.length)
    throw new Error(
      '没有需要修改的内容；用途分类适用于有本人消费金额的消费流水',
    );
  return { type: 'batch', mutations };
}
