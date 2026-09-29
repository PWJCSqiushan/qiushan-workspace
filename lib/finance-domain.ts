import type {
  FinanceAccount,
  FinanceActivity,
  FinanceAllocation,
  FinanceBase,
  FinanceCategory,
  FinanceCollection,
  FinanceEntity,
  FinanceMeal,
  FinanceMutation,
  FinancePatch,
  FinancePlace,
  FinancePosting,
  FinanceSponsorship,
  FinanceState,
  FinanceTransaction,
} from './finance-types.ts';
import { validateCategoryCodes } from './finance-category-codes.ts';

/**
 * The finance domain deliberately has no personal defaults.  It is a small
 * deterministic ledger engine: all money is integer cents, all references are
 * explicit, and a mutation either produces a complete valid state or throws.
 */

const COLLECTIONS: FinanceCollection[] = [
  'accounts',
  'categories',
  'places',
  'activities',
  'transactions',
  'meals',
  'sponsorships',
];
const NATURES = new Set([
  'daily',
  'durable',
  'rental',
  'subscription',
  'credits',
]);
const MEALS = new Set(['breakfast', 'lunch', 'dinner']);
const KINDS = new Set([
  'expense',
  'income',
  'transfer',
  'refund',
  'lend',
  'borrow',
  'collect',
  'repay',
  'custodyReceive',
  'custodyPay',
  'openingReceivable',
  'openingPayable',
  'openingCustody',
  'adjustment',
]);

type DomainMutation = Exclude<
  FinanceMutation,
  { type: 'undo' | 'redo' | 'batch' | 'configure' }
>;

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function requireId(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.trim().length > 0,
    `${label} must be a non-empty string`,
  );
  return value;
}

function requireDate(value: unknown, label: string): string {
  assert(
    typeof value === 'string' && value.length > 0,
    `${label} must be a date string`,
  );
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} is not a valid date`);
  return value;
}

function dateKey(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  assert(match, `date must start with YYYY-MM-DD: ${value}`);
  const [year, month, day] = match[1].split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  assert(
    check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day,
    `invalid calendar date: ${value}`,
  );
  return match[1];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Add signed integer cents without allowing IEEE-754 precision loss. */
export function addFinanceCents(
  left: number,
  right: number,
  label = 'money',
): number {
  assert(
    Number.isSafeInteger(left) && Number.isSafeInteger(right),
    `${label} must be a safe integer`,
  );
  const result = left + right;
  assert(Number.isSafeInteger(result), `${label} exceeds safe integer range`);
  return result;
}

function entityArray(
  state: FinanceState,
  collection: FinanceCollection,
): FinanceEntity[] {
  return state[collection] as FinanceEntity[];
}

function findEntity(
  state: FinanceState,
  collection: FinanceCollection,
  id: string,
): FinanceEntity | undefined {
  return entityArray(state, collection).find((item) => item.id === id);
}

function findAccount(
  state: FinanceState,
  id: string,
  includeDeleted = false,
): FinanceAccount | undefined {
  return state.accounts.find(
    (item) => item.id === id && (includeDeleted || !item.deleted),
  );
}

function findCategory(
  state: FinanceState,
  id: string,
  includeDeleted = false,
): FinanceCategory | undefined {
  return state.categories.find(
    (item) => item.id === id && (includeDeleted || !item.deleted),
  );
}

function findActivity(
  state: FinanceState,
  id: string,
  includeDeleted = false,
): FinanceActivity | undefined {
  return state.activities.find(
    (item) => item.id === id && (includeDeleted || !item.deleted),
  );
}

function findTransaction(
  state: FinanceState,
  id: string,
  includeDeleted = false,
): FinanceTransaction | undefined {
  return state.transactions.find(
    (item) => item.id === id && (includeDeleted || !item.deleted),
  );
}

function categoryIsLeaf(
  state: FinanceState,
  categoryId: string | null,
): boolean {
  return categoryId === null || findCategory(state, categoryId)?.level === 3;
}

function allocationPersonalCents(transaction: FinanceTransaction): number {
  if (transaction.kind === 'expense') {
    return transaction.personalCents ?? transaction.amountCents;
  }
  if (transaction.kind === 'refund') {
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
  }
  return 0;
}

function expensePersonalCents(transaction: FinanceTransaction): number {
  return transaction.kind === 'expense'
    ? allocationPersonalCents(transaction)
    : 0;
}

function expenseExternalCents(transaction: FinanceTransaction): number {
  return transaction.kind === 'expense'
    ? addFinanceCents(
        transaction.amountCents,
        -expensePersonalCents(transaction),
        `expense ${transaction.id} external amount`,
      )
    : 0;
}

function refundPersonalCents(transaction: FinanceTransaction): number {
  return transaction.kind === 'refund'
    ? allocationPersonalCents(transaction)
    : 0;
}

function refundExternalCents(transaction: FinanceTransaction): number {
  return transaction.kind === 'refund'
    ? addFinanceCents(
        transaction.amountCents,
        -refundPersonalCents(transaction),
        `refund ${transaction.id} external amount`,
      )
    : 0;
}

function addPosting(
  target: FinancePosting[],
  account: string,
  cents: number,
): void {
  if (cents === 0) return;
  target.push({ account, cents });
}

function postingsSum(postings: FinancePosting[]): number {
  return postings.reduce(
    (sum, posting) => addFinanceCents(sum, posting.cents, 'posting total'),
    0,
  );
}

function originalPersonalCents(transaction: FinanceTransaction): number {
  return expensePersonalCents(transaction);
}

function originalExternalCents(transaction: FinanceTransaction): number {
  return expenseExternalCents(transaction);
}

function refundTotals(
  state: FinanceState,
  originalId: string,
): { personal: number; external: number } {
  return state.transactions.reduce(
    (totals, transaction) => {
      if (
        transaction.deleted ||
        transaction.kind !== 'refund' ||
        transaction.relatedId !== originalId
      )
        return totals;
      totals.personal = addFinanceCents(
        totals.personal,
        refundPersonalCents(transaction),
        `refund total ${originalId}`,
      );
      totals.external = addFinanceCents(
        totals.external,
        refundExternalCents(transaction),
        `refund receivable total ${originalId}`,
      );
      return totals;
    },
    { personal: 0, external: 0 },
  );
}

function settledReceivableCents(
  state: FinanceState,
  originalId: string,
): number {
  return state.transactions.reduce((sum, transaction) => {
    if (transaction.deleted) return sum;
    if (transaction.kind === 'collect' && transaction.relatedId === originalId)
      return addFinanceCents(
        sum,
        transaction.amountCents,
        `receivable settlement ${originalId}`,
      );
    if (transaction.kind === 'refund' && transaction.relatedId === originalId)
      return addFinanceCents(
        sum,
        refundExternalCents(transaction),
        `receivable refund ${originalId}`,
      );
    return sum;
  }, 0);
}

function settledPayableCents(state: FinanceState, originalId: string): number {
  return state.transactions.reduce((sum, transaction) => {
    if (
      transaction.deleted ||
      transaction.kind !== 'repay' ||
      transaction.relatedId !== originalId
    )
      return sum;
    return addFinanceCents(
      sum,
      transaction.amountCents,
      `payable settlement ${originalId}`,
    );
  }, 0);
}

function receivablePrincipal(transaction: FinanceTransaction): number {
  if (transaction.kind === 'expense') return expenseExternalCents(transaction);
  if (transaction.kind === 'lend' || transaction.kind === 'openingReceivable')
    return transaction.amountCents;
  return 0;
}

function payablePrincipal(transaction: FinanceTransaction): number {
  if (transaction.kind === 'borrow' || transaction.kind === 'openingPayable')
    return transaction.amountCents;
  if (transaction.kind === 'expense')
    return Math.max(
      0,
      addFinanceCents(
        expensePersonalCents(transaction),
        -transaction.amountCents,
        `expense ${transaction.id} payable`,
      ),
    );
  return 0;
}

function validateRefundAgainstOriginal(
  original: FinanceTransaction,
  refund: FinanceTransaction,
  settledPersonal: number,
  settledExternal: number,
): void {
  const originalPersonal = originalPersonalCents(original);
  const originalExternal = originalExternalCents(original);
  const refundPersonal = refundPersonalCents(refund);
  const refundExternal = refundExternalCents(refund);
  if (originalExternal < 0) {
    // An expense paid by somebody else creates a payable.  A refund may only
    // return money this account actually paid, and must never silently reduce
    // the payable without an explicit payer-side settlement model.
    assert(
      refundExternal === 0,
      `refund ${refund.id} cannot settle a payable expense's external share`,
    );
    assert(
      addFinanceCents(
        settledPersonal,
        refundPersonal,
        `refund ${refund.id} personal total`,
      ) <= original.amountCents,
      `refund ${refund.id} exceeds amount actually paid`,
    );
    return;
  }
  assert(
    addFinanceCents(
      settledPersonal,
      refundPersonal,
      `refund ${refund.id} personal total`,
    ) <= originalPersonal,
    `refund ${refund.id} exceeds original personal amount`,
  );
  assert(
    addFinanceCents(
      settledExternal,
      refundExternal,
      `refund ${refund.id} external total`,
    ) <= originalExternal,
    `refund ${refund.id} exceeds original receivable amount`,
  );
}

function validateAllocation(
  state: FinanceState,
  allocation: FinanceAllocation,
  transaction: FinanceTransaction,
  refund: boolean,
): void {
  requireId(allocation.id, 'allocation.id');
  assert(
    isInteger(allocation.amountCents) && allocation.amountCents > 0,
    `allocation ${allocation.id} amount must be a positive integer`,
  );
  assert(
    typeof allocation.content === 'string' &&
      allocation.content.trim().length > 0,
    `allocation ${allocation.id} content is required`,
  );
  assert(
    NATURES.has(allocation.nature),
    `allocation ${allocation.id} has an invalid nature`,
  );
  assert(
    categoryIsLeaf(state, allocation.categoryId),
    `allocation ${allocation.id} must use a level-3 category or null`,
  );
  if (allocation.categoryId !== null)
    assert(
      !findCategory(state, allocation.categoryId)?.deleted,
      `allocation ${allocation.id} references a deleted category`,
    );
  if (allocation.merchantId !== undefined)
    requireId(allocation.merchantId, 'allocation.merchantId');
  if (allocation.activityId !== undefined) {
    requireId(allocation.activityId, 'allocation.activityId');
    assert(
      !!findActivity(state, allocation.activityId),
      `allocation ${allocation.id} references an unknown activity`,
    );
  }
  if (refund) {
    if (allocation.refundOfAllocationId !== undefined)
      requireId(allocation.refundOfAllocationId, 'refundOfAllocationId');
  } else {
    assert(
      allocation.refundOfAllocationId === undefined,
      `expense allocation ${allocation.id} cannot reference a refund`,
    );
  }
  // The transaction parameter makes it intentional that this validation is
  // performed in the context of the transaction, even though the current
  // shape has no per-allocation account fields.
  void transaction;
}

function validateCategoryDirectory(categories: FinanceCategory[]): void {
  validateCategoryCodes(categories);
  const ids = new Set<string>();
  for (const category of categories) {
    requireId(category.id, 'category.id');
    assert(!ids.has(category.id), `duplicate category id: ${category.id}`);
    ids.add(category.id);
    assert(
      isInteger(category.level) && category.level >= 1 && category.level <= 3,
      `category ${category.id} level must be 1, 2 or 3`,
    );
    if (category.parentId !== null)
      requireId(category.parentId, `category ${category.id}.parentId`);
  }
  const active = categories.filter((category) => !category.deleted);
  if (active.length === 0) return;
  for (const category of active) {
    if (category.level === 1) {
      assert(
        category.parentId === null,
        `level-1 category ${category.id} must not have a parent`,
      );
    } else {
      assert(
        category.parentId !== null,
        `category ${category.id} must have a parent`,
      );
      const parent = categories.find(
        (candidate) => candidate.id === category.parentId,
      );
      assert(
        parent && !parent.deleted,
        `category ${category.id} references a missing/deleted parent`,
      );
      assert(
        parent.level === category.level - 1,
        `category ${category.id} must have a level-${category.level - 1} parent`,
      );
    }
    const seen = new Set<string>();
    let current: FinanceCategory | undefined = category;
    while (current?.parentId) {
      assert(!seen.has(current.id), `category cycle at ${current.id}`);
      seen.add(current.id);
      current = categories.find(
        (candidate) => candidate.id === current?.parentId,
      );
    }
  }
  const levels = new Set(active.map((category) => category.level));
  assert(
    levels.has(1) && levels.has(2) && levels.has(3),
    'category directory must contain all three levels',
  );
}

function validatePlaceDirectory(places: FinancePlace[]): void {
  const ids = new Set<string>();
  const groupNames = new Map<string, string>();
  const groupTones = new Map<string, string>();
  for (const place of places) {
    requireId(place.id, 'place.id');
    assert(
      typeof place.name === 'string' && place.name.trim().length > 0,
      `place ${place.id} name is required`,
    );
    assert(!ids.has(place.id), `duplicate place id: ${place.id}`);
    ids.add(place.id);
    if (place.tone !== undefined) {
      assert(
        ['mint', 'amber', 'blue', 'rose'].includes(place.tone),
        'place tone is invalid',
      );
      assert(place.parentId === null, 'place tone belongs to the root area');
      if (place.summaryGroupId) {
        assert(
          !groupTones.has(place.summaryGroupId) ||
            groupTones.get(place.summaryGroupId) === place.tone,
          'summary group tones must match',
        );
        groupTones.set(place.summaryGroupId, place.tone);
      }
    }
    if (place.brand !== undefined)
      assert(
        typeof place.brand === 'string' &&
          place.brand.trim().length > 0 &&
          place.brand.length <= 100,
        'place brand must be a nonempty name',
      );
    if (place.aliases !== undefined)
      assert(
        Array.isArray(place.aliases) &&
          place.aliases.length <= 50 &&
          place.aliases.every(
            (a) =>
              typeof a === 'string' && a.trim().length > 0 && a.length <= 100,
          ),
        'place aliases must be names',
      );
    if (place.defaultCategoryId !== undefined)
      requireId(place.defaultCategoryId, `place ${place.id}.defaultCategoryId`);
    if (
      place.summaryGroupId !== undefined ||
      place.summaryGroupName !== undefined
    ) {
      assert(
        place.parentId === null,
        'summary group is only allowed on a root place',
      );
      requireId(place.summaryGroupId, 'place.summaryGroupId');
      assert(
        typeof place.summaryGroupName === 'string' &&
          place.summaryGroupName.trim().length > 0 &&
          place.summaryGroupName.length <= 100,
        'summary group name is required',
      );
      assert(
        !groupNames.has(place.summaryGroupId!) ||
          groupNames.get(place.summaryGroupId!) === place.summaryGroupName,
        'summary group names must match',
      );
      groupNames.set(place.summaryGroupId!, place.summaryGroupName);
    }
    if (place.parentId !== null) {
      assert(
        places.find((p) => p.id === place.parentId)?.parentId === null,
        'place directory supports two levels',
      );
      requireId(place.parentId, `place ${place.id}.parentId`);
      assert(
        places.some(
          (candidate) => candidate.id === place.parentId && !candidate.deleted,
        ),
        `place ${place.id} references a missing/deleted parent`,
      );
    }
  }
}

function validateBase(entity: FinanceBase, label: string): void {
  requireId(entity.id, `${label}.id`);
  assert(
    isNonNegativeInteger(entity.version),
    `${label}.version must be a non-negative integer`,
  );
  if (entity.deleted !== undefined)
    assert(
      typeof entity.deleted === 'boolean',
      `${label}.deleted must be boolean`,
    );
}

function validateAccount(account: FinanceAccount): void {
  validateBase(account, 'account');
  assert(
    account.id !== 'income' &&
      account.id !== 'equity' &&
      !account.id.includes(':'),
    `account ${account.id} conflicts with a virtual ledger account`,
  );
  assert(
    typeof account.name === 'string' && account.name.trim().length > 0,
    `account ${account.id} name is required`,
  );
  assert(
    account.kind === 'asset' || account.kind === 'credit',
    `account ${account.id} kind is invalid`,
  );
  if (account.openingConfirmed !== undefined)
    assert(
      typeof account.openingConfirmed === 'boolean',
      `account ${account.id} openingConfirmed must be boolean`,
    );
  assert(
    isInteger(account.openingCents),
    `account ${account.id} openingCents must be an integer`,
  );
  if (account.openingConfirmed === false)
    assert(
      account.openingCents === 0,
      `unconfirmed account ${account.id} openingCents must be zero`,
    );
  if (account.kind === 'credit')
    assert(
      account.openingCents <= 0,
      `credit account ${account.id} openingCents must be <= 0`,
    );
  requireDate(account.openingAt, `account ${account.id}.openingAt`);
}

function validateActivity(activity: FinanceActivity): void {
  validateBase(activity, 'activity');
  requireId(activity.name, `activity ${activity.id}.name`);
  assert(
    activity.kind === 'event' || activity.kind === 'custody',
    `activity ${activity.id} kind is invalid`,
  );
  if (activity.categoryId !== undefined)
    requireId(activity.categoryId, `activity ${activity.id}.categoryId`);
  if (activity.date !== undefined) dateKey(activity.date);
}

function validateTransactionShape(
  transaction: FinanceTransaction,
  state: FinanceState,
): void {
  validateBase(transaction, 'transaction');
  assert(
    KINDS.has(transaction.kind),
    `transaction ${transaction.id} kind is invalid`,
  );
  requireDate(
    transaction.occurredAt,
    `transaction ${transaction.id}.occurredAt`,
  );
  dateKey(transaction.occurredAt);
  requireId(transaction.accountId, `transaction ${transaction.id}.accountId`);
  if (transaction.sourceKey !== undefined)
    requireId(transaction.sourceKey, `transaction ${transaction.id}.sourceKey`);
  assert(
    isInteger(transaction.amountCents),
    `transaction ${transaction.id} amountCents must be an integer`,
  );
  if (transaction.kind === 'adjustment')
    assert(
      transaction.amountCents !== 0,
      `adjustment ${transaction.id} cannot be zero`,
    );
  else if (transaction.kind === 'expense')
    assert(
      transaction.amountCents >= 0,
      `expense ${transaction.id} amountCents must be non-negative`,
    );
  else
    assert(
      transaction.amountCents > 0,
      `transaction ${transaction.id} amountCents must be positive`,
    );
  if (transaction.personalCents !== undefined)
    assert(
      isInteger(transaction.personalCents) && transaction.personalCents >= 0,
      `transaction ${transaction.id} personalCents must be a non-negative integer`,
    );
  assert(
    Array.isArray(transaction.allocations),
    `transaction ${transaction.id} allocations must be an array`,
  );
  const allocationIds = new Set<string>();
  const isExpenseLike =
    transaction.kind === 'expense' || transaction.kind === 'refund';
  let allocationTotal = 0;
  for (const allocation of transaction.allocations) {
    assert(
      !allocationIds.has(allocation.id),
      `duplicate allocation id: ${allocation.id}`,
    );
    allocationIds.add(allocation.id);
    validateAllocation(
      state,
      allocation,
      transaction,
      transaction.kind === 'refund',
    );
    allocationTotal = addFinanceCents(
      allocationTotal,
      allocation.amountCents,
      `transaction ${transaction.id} allocation total`,
    );
  }
  if (!isExpenseLike)
    assert(
      transaction.allocations.length === 0,
      `${transaction.kind} cannot have expense allocations`,
    );
  if (transaction.kind === 'expense') {
    const personal = transaction.personalCents ?? transaction.amountCents;
    if (transaction.allocations.length > 0)
      assert(
        allocationTotal === personal,
        `expense ${transaction.id} allocations must equal personalCents`,
      );
  }
  if (transaction.kind === 'refund') {
    assert(
      transaction.relatedId !== undefined,
      `refund ${transaction.id} must link an original transaction`,
    );
    const original = findTransaction(state, transaction.relatedId);
    assert(
      original?.kind === 'expense',
      `refund ${transaction.id} must link an expense`,
    );
    const personal = transaction.personalCents ?? allocationTotal;
    assert(
      personal <= transaction.amountCents,
      `refund ${transaction.id} personalCents exceeds amountCents`,
    );
    if (transaction.allocations.length > 0)
      assert(
        allocationTotal === personal,
        `refund ${transaction.id} allocations must equal personalCents`,
      );
    if (
      transaction.personalCents === undefined &&
      originalPersonalCents(original) !== transaction.amountCents &&
      transaction.amountCents > 0
    ) {
      assert(
        transaction.allocations.length > 0,
        `refund ${transaction.id} requires explicit personalCents or allocation mapping`,
      );
    }
    for (const allocation of transaction.allocations) {
      assert(
        allocation.refundOfAllocationId !== undefined,
        `refund ${transaction.id} allocation ${allocation.id} must map to an original allocation`,
      );
      assert(
        original.allocations.some(
          (candidate) => candidate.id === allocation.refundOfAllocationId,
        ),
        `refund ${transaction.id} maps to an unknown original allocation`,
      );
    }
  }
  if (
    transaction.kind === 'income' ||
    transaction.kind === 'transfer' ||
    transaction.kind === 'lend' ||
    transaction.kind === 'borrow' ||
    transaction.kind === 'collect' ||
    transaction.kind === 'repay' ||
    transaction.kind === 'custodyReceive' ||
    transaction.kind === 'custodyPay' ||
    transaction.kind === 'openingReceivable' ||
    transaction.kind === 'openingPayable' ||
    transaction.kind === 'openingCustody' ||
    transaction.kind === 'adjustment'
  ) {
    assert(
      transaction.allocations.length === 0,
      `${transaction.kind} cannot have allocations`,
    );
  }
  if (!transaction.analysisOnly) {
    assert(
      !!findAccount(state, transaction.accountId),
      `transaction ${transaction.id} references an unknown account`,
    );
    const account = findAccount(state, transaction.accountId)!;
    if (account.openingConfirmed !== false)
      assert(
        Date.parse(transaction.occurredAt) >= Date.parse(account.openingAt),
        `transaction ${transaction.id} precedes account openingAt; mark it analysisOnly`,
      );
  }
  if (
    transaction.kind === 'openingReceivable' ||
    transaction.kind === 'openingPayable' ||
    transaction.kind === 'openingCustody'
  ) {
    assert(
      !transaction.analysisOnly,
      `${transaction.kind} cannot be analysisOnly`,
    );
    const openingAccount = findAccount(state, transaction.accountId);
    assert(
      openingAccount && transaction.occurredAt === openingAccount.openingAt,
      `${transaction.kind} occurredAt must equal account openingAt`,
    );
  }
  if (transaction.targetAccountId !== undefined) {
    requireId(
      transaction.targetAccountId,
      `transaction ${transaction.id}.targetAccountId`,
    );
    assert(
      transaction.targetAccountId !== transaction.accountId,
      `transaction ${transaction.id} source and target accounts must differ`,
    );
    if (!transaction.analysisOnly) {
      const target = findAccount(state, transaction.targetAccountId);
      assert(
        !!target,
        `transaction ${transaction.id} target account is unknown`,
      );
      if (target!.openingConfirmed !== false)
        assert(
          Date.parse(transaction.occurredAt) >= Date.parse(target!.openingAt),
          `transaction ${transaction.id} precedes target account openingAt; mark it analysisOnly`,
        );
    }
  }
  switch (transaction.kind) {
    case 'transfer':
      assert(
        transaction.targetAccountId !== undefined,
        `transfer ${transaction.id} needs targetAccountId`,
      );
      break;
    case 'refund':
    case 'collect':
    case 'repay':
      assert(
        transaction.relatedId !== undefined,
        `${transaction.kind} ${transaction.id} needs relatedId`,
      );
      break;
    case 'custodyReceive':
    case 'custodyPay':
      requireId(
        transaction.caseId,
        `${transaction.kind} ${transaction.id}.caseId`,
      );
      break;
    case 'openingCustody':
      requireId(transaction.caseId, `openingCustody ${transaction.id}.caseId`);
      break;
    case 'adjustment':
      assert(
        typeof transaction.note === 'string' &&
          transaction.note.trim().length > 0,
        `adjustment ${transaction.id} needs a note`,
      );
      break;
    default:
      break;
  }
  if (transaction.relatedId !== undefined)
    requireId(transaction.relatedId, `transaction ${transaction.id}.relatedId`);
  if (transaction.caseId !== undefined)
    requireId(transaction.caseId, `transaction ${transaction.id}.caseId`);
  if (transaction.mealId !== undefined) {
    requireId(transaction.mealId, `transaction ${transaction.id}.mealId`);
    assert(
      state.meals.some(
        (meal) =>
          meal.id === transaction.mealId &&
          !meal.deleted &&
          meal.status !== 'skipped',
      ),
      `transaction ${transaction.id} references an unknown meal`,
    );
  }
}

function validateSettlementReferences(state: FinanceState): void {
  const refundByOriginal = new Map<
    string,
    { personal: number; external: number }
  >();
  for (const transaction of state.transactions) {
    if (transaction.deleted) continue;
    if (transaction.kind === 'refund') {
      const original = transaction.relatedId
        ? findTransaction(state, transaction.relatedId)
        : undefined;
      assert(
        original?.kind === 'expense',
        `refund ${transaction.id} has no live expense original`,
      );
      const current = refundByOriginal.get(original.id) ?? {
        personal: 0,
        external: 0,
      };
      validateRefundAgainstOriginal(
        original,
        transaction,
        current.personal,
        current.external,
      );
      current.personal = addFinanceCents(
        current.personal,
        refundPersonalCents(transaction),
        `refund total ${original.id}`,
      );
      current.external = addFinanceCents(
        current.external,
        refundExternalCents(transaction),
        `refund receivable total ${original.id}`,
      );
      refundByOriginal.set(original.id, current);
    }
    if (transaction.kind === 'collect') {
      const original = transaction.relatedId
        ? findTransaction(state, transaction.relatedId)
        : undefined;
      assert(
        original &&
          (original.kind === 'expense' ||
            original.kind === 'lend' ||
            original.kind === 'openingReceivable'),
        `collect ${transaction.id} has no collectible original`,
      );
      assert(
        transaction.amountCents <= receivablePrincipal(original),
        `collect ${transaction.id} exceeds original receivable`,
      );
    }
    if (transaction.kind === 'repay') {
      const original = transaction.relatedId
        ? findTransaction(state, transaction.relatedId)
        : undefined;
      assert(
        original?.kind === 'expense' ||
          original?.kind === 'borrow' ||
          original?.kind === 'openingPayable',
        `repay ${transaction.id} must link a payable expense, borrow or opening payable`,
      );
      assert(
        transaction.amountCents <= payablePrincipal(original),
        `repay ${transaction.id} exceeds original borrowing`,
      );
    }
  }
  for (const [originalId, totals] of refundByOriginal) {
    const original = findTransaction(state, originalId)!;
    const originalExternal = originalExternalCents(original);
    if (originalExternal < 0) {
      assert(
        totals.external === 0,
        `refunds cannot settle a payable expense's external share of ${originalId}`,
      );
      assert(
        totals.personal <= original.amountCents,
        `refunds exceed amount actually paid of ${originalId}`,
      );
    } else {
      assert(
        totals.personal <= originalPersonalCents(original),
        `refunds exceed personal amount of ${originalId}`,
      );
      assert(
        totals.external <= originalExternal,
        `refunds exceed receivable amount of ${originalId}`,
      );
    }
  }
  for (const transaction of state.transactions) {
    if (transaction.deleted) continue;
    if (transaction.kind === 'collect' && transaction.relatedId) {
      const original = findTransaction(state, transaction.relatedId);
      assert(
        original &&
          settledReceivableCents(state, transaction.relatedId) <=
            receivablePrincipal(original),
        `collections exceed receivable of ${transaction.relatedId}`,
      );
    }
    if (transaction.kind === 'repay' && transaction.relatedId) {
      const original = findTransaction(state, transaction.relatedId);
      assert(
        original &&
          (original.kind === 'expense' ||
            original.kind === 'borrow' ||
            original.kind === 'openingPayable') &&
          settledPayableCents(state, transaction.relatedId) <=
            payablePrincipal(original),
        `repayments exceed payable of ${transaction.relatedId}`,
      );
    }
  }
}

function validateReferencesBeforeDelete(
  state: FinanceState,
  collection: FinanceCollection,
  id: string,
): void {
  const ref = (message: string) =>
    fail(`cannot delete ${collection}/${id}: ${message}`);
  if (collection === 'accounts') {
    if (
      state.transactions.some(
        (transaction) =>
          !transaction.deleted &&
          !transaction.analysisOnly &&
          (transaction.accountId === id || transaction.targetAccountId === id),
      )
    )
      ref('account is referenced by a transaction');
  } else if (collection === 'categories') {
    if (
      state.categories.some(
        (category) => !category.deleted && category.parentId === id,
      )
    )
      ref('category has children');
    if (
      state.transactions.some(
        (transaction) =>
          !transaction.deleted &&
          transaction.allocations.some(
            (allocation) => allocation.categoryId === id,
          ),
      )
    )
      ref('category is used by an allocation');
    if (
      state.sponsorships.some(
        (sponsorship) => !sponsorship.deleted && sponsorship.categoryId === id,
      )
    )
      ref('category is used by a sponsorship');
    if (
      state.activities.some(
        (activity) => !activity.deleted && activity.categoryId === id,
      )
    )
      ref('category is used by an activity');
    if (
      state.places.some(
        (place) => !place.deleted && place.defaultCategoryId === id,
      )
    )
      ref('category is a place default');
  } else if (collection === 'places') {
    if (state.places.some((place) => !place.deleted && place.parentId === id))
      ref('place has children');
    if (state.meals.some((meal) => !meal.deleted && meal.placeId === id))
      ref('place is used by a meal');
  } else if (collection === 'activities') {
    if (
      state.transactions.some(
        (transaction) =>
          !transaction.deleted &&
          transaction.allocations.some(
            (allocation) => allocation.activityId === id,
          ),
      )
    )
      ref('activity is used by an allocation');
    if (
      state.sponsorships.some(
        (sponsorship) => !sponsorship.deleted && sponsorship.activityId === id,
      )
    )
      ref('activity is used by a sponsorship');
  } else if (collection === 'transactions') {
    if (
      state.transactions.some(
        (transaction) => !transaction.deleted && transaction.relatedId === id,
      )
    )
      ref('transaction is linked by a settlement or refund');
  } else if (collection === 'meals') {
    if (
      state.transactions.some(
        (transaction) => !transaction.deleted && transaction.mealId === id,
      )
    )
      ref('meal is linked by a transaction');
  }
}

/** Validate all invariants of a finance snapshot. */
export function validateFinanceState(state: FinanceState): void {
  assert(state && typeof state === 'object', 'finance state is required');
  assert(typeof state.owner === 'string', 'finance owner is required');
  assert(
    state.space === 'personal' || state.space === 'demo',
    'finance space is invalid',
  );
  assert(
    isNonNegativeInteger(state.version),
    'finance state version must be a non-negative integer',
  );
  for (const collection of COLLECTIONS) {
    assert(Array.isArray(state[collection]), `${collection} must be an array`);
    const ids = new Set<string>();
    for (const entity of entityArray(state, collection)) {
      validateBase(entity, collection.slice(0, -1));
      assert(!ids.has(entity.id), `duplicate ${collection} id: ${entity.id}`);
      ids.add(entity.id);
    }
  }
  for (const account of state.accounts) validateAccount(account);
  validateCategoryDirectory(state.categories);
  validatePlaceDirectory(state.places);
  for (const place of state.places) {
    if (place.deleted || place.defaultCategoryId === undefined) continue;
    assert(
      findCategory(state, place.defaultCategoryId)?.level === 3,
      `place ${place.id}.defaultCategoryId must reference a level-3 category`,
    );
  }
  for (const activity of state.activities) validateActivity(activity);
  for (const activity of state.activities) {
    if (activity.categoryId !== undefined)
      assert(
        !!findCategory(state, activity.categoryId),
        `activity ${activity.id} references an unknown category`,
      );
  }
  for (const meal of state.meals) {
    requireId(meal.id, 'meal.id');
    dateKey(meal.date);
    assert(MEALS.has(meal.meal), `meal ${meal.id} meal is invalid`);
    assert(
      meal.status === undefined ||
        meal.status === 'eaten' ||
        meal.status === 'skipped',
      `meal ${meal.id} status is invalid`,
    );
    if (meal.status === 'skipped') {
      assert(
        meal.pricePending === false,
        `skipped meal ${meal.id} cannot have pricePending`,
      );
      assert(
        meal.placeId === undefined &&
          meal.payment === undefined &&
          meal.companions === undefined,
        `skipped meal ${meal.id} cannot have dining details`,
      );
      continue;
    }
    assert(
      state.places.some((place) => place.id === meal.placeId && !place.deleted),
      `meal ${meal.id} references an unknown place`,
    );
    assert(
      [
        'alone',
        'classmates',
        'friends',
        'friendsF',
        'friendsL',
        'family',
        'other',
        'unknown',
      ].includes(meal.companions),
      `meal ${meal.id} companions is invalid`,
    );
    assert(
      ['self', 'aa', 'treat', 'invited', 'unknown'].includes(meal.payment),
      `meal ${meal.id} payment is invalid`,
    );
    assert(
      typeof meal.pricePending === 'boolean',
      `meal ${meal.id} pricePending must be boolean`,
    );
  }
  const mealSlots = new Map<string, string>();
  for (const meal of state.meals) {
    if (meal.deleted) continue;
    const slot = `${meal.date}|${meal.meal}`;
    const previous = mealSlots.get(slot);
    assert(
      !previous || previous === meal.id,
      `duplicate active meal slot: ${slot}`,
    );
    mealSlots.set(slot, meal.id);
  }
  for (const sponsorship of state.sponsorships) {
    requireId(sponsorship.name, `sponsorship ${sponsorship.id}.name`);
    dateKey(sponsorship.date ?? '1970-01-01');
    assert(
      isInteger(sponsorship.amountCents) && sponsorship.amountCents > 0,
      `sponsorship ${sponsorship.id} amount must be positive`,
    );
    const category = findCategory(state, sponsorship.categoryId);
    assert(
      category?.level === 3,
      `sponsorship ${sponsorship.id} must use a level-3 category`,
    );
    if (sponsorship.activityId !== undefined)
      assert(
        !!findActivity(state, sponsorship.activityId),
        `sponsorship ${sponsorship.id} references an unknown activity`,
      );
  }
  // Soft-deleted records remain in the change log and may intentionally keep
  // references to archived/deleted catalogue rows. They are historical data,
  // not active ledger entries, so only active transactions participate in the
  // live reference and settlement checks below.
  for (const transaction of state.transactions) {
    if (!transaction.deleted) validateTransactionShape(transaction, state);
  }
  const sourceKeys = new Map<string, string>();
  for (const transaction of state.transactions) {
    if (transaction.sourceKey === undefined) continue;
    const previous = sourceKeys.get(transaction.sourceKey);
    assert(
      !previous || previous === transaction.id,
      `duplicate transaction sourceKey: ${transaction.sourceKey}`,
    );
    sourceKeys.set(transaction.sourceKey, transaction.id);
  }
  validateSettlementReferences(state);
  const custodyTotals = new Map<string, number>();
  for (const transaction of state.transactions) {
    if (
      transaction.deleted ||
      transaction.analysisOnly ||
      (transaction.kind !== 'custodyReceive' &&
        transaction.kind !== 'custodyPay')
    )
      continue;
    const caseId = transaction.caseId!;
    const held = custodyTotals.get(caseId) ?? 0;
    custodyTotals.set(
      caseId,
      addFinanceCents(
        held,
        transaction.kind === 'custodyReceive'
          ? transaction.amountCents
          : -transaction.amountCents,
        `custody ${caseId} total`,
      ),
    );
  }
  for (const [caseId, held] of custodyTotals)
    assert(held >= 0, `custody payments exceed receipts for ${caseId}`);
  for (const transaction of state.transactions) {
    if (transaction.deleted || transaction.analysisOnly) continue;
    const account = findAccount(state, transaction.accountId);
    assert(account, `transaction ${transaction.id} account is missing`);
    if (transaction.kind === 'transfer')
      assert(
        transaction.targetAccountId !== undefined &&
          !!findAccount(state, transaction.targetAccountId),
        `transfer ${transaction.id} target account is missing`,
      );
    const canonical = buildFinancePostings(transaction, state);
    if (transaction.postings !== undefined) {
      assert(
        transaction.postings.length === canonical.length,
        `transaction ${transaction.id} postings are not canonical`,
      );
      canonical.forEach((posting, index) => {
        const given = transaction.postings![index];
        assert(
          given.account === posting.account && given.cents === posting.cents,
          `transaction ${transaction.id} postings are not canonical`,
        );
      });
    }
  }
  // A refund and a collection both settle the same external receivable. They
  // must share the remaining amount; validating each class independently
  // would allow the combined settlements to exceed it.
  for (const original of state.transactions) {
    if (
      original.deleted ||
      (original.kind !== 'expense' && original.kind !== 'openingReceivable')
    )
      continue;
    const principal = receivablePrincipal(original);
    assert(
      principal >= 0
        ? settledReceivableCents(state, original.id) <= principal
        : settledReceivableCents(state, original.id) === 0,
      `settlements exceed receivable of ${original.id}`,
    );
  }
}

/** Build the balanced signed ledger entries for one transaction. */
export function buildFinancePostings(
  transaction: FinanceTransaction,
  state: FinanceState,
): FinancePosting[] {
  validateTransactionShape(transaction, state);
  if (transaction.analysisOnly) return [];
  const postings: FinancePosting[] = [];
  const account = transaction.accountId;
  switch (transaction.kind) {
    case 'expense': {
      let personal = 0;
      for (const allocation of transaction.allocations) {
        personal = addFinanceCents(
          personal,
          allocation.amountCents,
          `transaction ${transaction.id} allocation total`,
        );
        addPosting(
          postings,
          `expense:${allocation.id}`,
          allocation.amountCents,
        );
      }
      if (personal === 0 && expensePersonalCents(transaction) > 0)
        addPosting(
          postings,
          `expense:${transaction.id}:unclassified`,
          expensePersonalCents(transaction),
        );
      const external = addFinanceCents(
        transaction.amountCents,
        -expensePersonalCents(transaction),
        `expense ${transaction.id} external amount`,
      );
      if (external >= 0)
        addPosting(postings, `receivable:${transaction.id}`, external);
      else addPosting(postings, `payable:${transaction.id}`, external);
      addPosting(postings, account, -transaction.amountCents);
      break;
    }
    case 'income':
      addPosting(postings, account, transaction.amountCents);
      addPosting(postings, 'income', -transaction.amountCents);
      break;
    case 'transfer':
      addPosting(postings, account, -transaction.amountCents);
      addPosting(
        postings,
        transaction.targetAccountId!,
        transaction.amountCents,
      );
      break;
    case 'refund': {
      addPosting(postings, account, transaction.amountCents);
      const personal = refundPersonalCents(transaction);
      const original = findTransaction(state, transaction.relatedId!);
      const mapped =
        transaction.allocations.length > 0 ? transaction.allocations : [];
      if (mapped.length > 0) {
        for (const allocation of mapped)
          addPosting(
            postings,
            `expense:${allocation.refundOfAllocationId!}`,
            -allocation.amountCents,
          );
      } else if (personal > 0) {
        addPosting(
          postings,
          `expense:${original?.allocations[0]?.id ?? `${original?.id ?? transaction.relatedId!}:unclassified`}`,
          -personal,
        );
      }
      addPosting(
        postings,
        `receivable:${transaction.relatedId!}`,
        -refundExternalCents(transaction),
      );
      break;
    }
    case 'lend':
      addPosting(
        postings,
        `receivable:${transaction.id}`,
        transaction.amountCents,
      );
      addPosting(postings, account, -transaction.amountCents);
      break;
    case 'borrow':
      addPosting(postings, account, transaction.amountCents);
      addPosting(
        postings,
        `payable:${transaction.id}`,
        -transaction.amountCents,
      );
      break;
    case 'collect':
      addPosting(postings, account, transaction.amountCents);
      addPosting(
        postings,
        `receivable:${transaction.relatedId!}`,
        -transaction.amountCents,
      );
      break;
    case 'repay':
      addPosting(
        postings,
        `payable:${transaction.relatedId!}`,
        transaction.amountCents,
      );
      addPosting(postings, account, -transaction.amountCents);
      break;
    case 'custodyReceive':
      addPosting(postings, account, transaction.amountCents);
      addPosting(
        postings,
        `custody:${transaction.caseId!}`,
        -transaction.amountCents,
      );
      break;
    case 'custodyPay':
      addPosting(
        postings,
        `custody:${transaction.caseId!}`,
        transaction.amountCents,
      );
      addPosting(postings, account, -transaction.amountCents);
      break;
    case 'openingReceivable':
      addPosting(
        postings,
        `receivable:${transaction.id}`,
        transaction.amountCents,
      );
      addPosting(postings, 'equity', -transaction.amountCents);
      break;
    case 'openingPayable':
      addPosting(postings, 'equity', transaction.amountCents);
      addPosting(
        postings,
        `payable:${transaction.id}`,
        -transaction.amountCents,
      );
      break;
    case 'openingCustody':
      addPosting(postings, 'equity', transaction.amountCents);
      addPosting(
        postings,
        `custody:${transaction.caseId!}`,
        -transaction.amountCents,
      );
      break;
    case 'adjustment':
      addPosting(postings, account, transaction.amountCents);
      addPosting(postings, 'equity', -transaction.amountCents);
      break;
    default:
      fail(
        `unsupported transaction kind: ${(transaction as FinanceTransaction).kind}`,
      );
  }
  assert(
    postingsSum(postings) === 0,
    `transaction ${transaction.id} postings are not balanced`,
  );
  return postings;
}

function checkExpectedVersion(
  state: FinanceState,
  collection: FinanceCollection,
  id: string,
  expectedVersion: number,
): FinanceEntity | undefined {
  assert(
    isNonNegativeInteger(expectedVersion),
    `expectedVersion for ${collection}/${id} must be a non-negative integer`,
  );
  const current = findEntity(state, collection, id);
  if (current)
    assert(
      current.version === expectedVersion,
      `version conflict for ${collection}/${id}: expected ${expectedVersion}, current ${current.version}`,
    );
  else
    assert(
      expectedVersion === 0,
      `new ${collection}/${id} must use expectedVersion 0`,
    );
  return current;
}

function ensureEntityCollection(
  collection: Exclude<FinanceCollection, 'transactions'>,
  entity: FinanceEntity,
): void {
  assert(
    entity && typeof entity === 'object',
    `entity for ${collection} is required`,
  );
  // The shared union has no discriminant.  Validate the fields that uniquely
  // identify the collection before placing the value into the state.
  switch (collection) {
    case 'accounts':
      assert(
        'kind' in entity && 'openingCents' in entity && 'openingAt' in entity,
        'entity is not an account',
      );
      validateAccount(entity as FinanceAccount);
      break;
    case 'categories':
      assert(
        'level' in entity && 'parentId' in entity,
        'entity is not a category',
      );
      validateBase(entity, 'category');
      break;
    case 'places':
      assert('parentId' in entity && 'name' in entity, 'entity is not a place');
      validateBase(entity, 'place');
      break;
    case 'activities':
      assert('kind' in entity && 'name' in entity, 'entity is not an activity');
      validateActivity(entity as FinanceActivity);
      break;
    case 'meals':
      assert('date' in entity && 'meal' in entity, 'entity is not a meal');
      validateBase(entity, 'meal');
      break;
    case 'sponsorships':
      assert(
        'amountCents' in entity && 'categoryId' in entity && 'name' in entity,
        'entity is not a sponsorship',
      );
      validateBase(entity, 'sponsorship');
      break;
    default:
      fail(`unsupported collection: ${String(collection)}`);
  }
}

function accountHasActivity(state: FinanceState, id: string): boolean {
  return state.transactions.some(
    (transaction) =>
      !transaction.deleted &&
      !transaction.analysisOnly &&
      (transaction.accountId === id || transaction.targetAccountId === id),
  );
}

/**
 * A batch is applied to a cloned state and validated once at the end. This
 * permits a root category code and all of its child codes to be changed in
 * one atomic operation without rejecting the intentional intermediate state.
 */
type ApplyOptions = { deferStateValidation?: boolean };

function assertOpeningAtCoversActivity(
  state: FinanceState,
  id: string,
  openingAt: string,
): void {
  const openingTime = Date.parse(openingAt);
  const earlier = state.transactions.find(
    (transaction) =>
      !transaction.deleted &&
      !transaction.analysisOnly &&
      (transaction.accountId === id || transaction.targetAccountId === id) &&
      Date.parse(transaction.occurredAt) < openingTime,
  );
  assert(
    !earlier,
    `account ${id} openingAt precedes all existing transactions; ${earlier?.id ?? 'transaction'} is earlier than the confirmed openingAt`,
  );
}

function applyPut(
  state: FinanceState,
  mutation: Extract<FinanceMutation, { type: 'put' }>,
  options: ApplyOptions = {},
): FinancePatch {
  const current = checkExpectedVersion(
    state,
    mutation.collection,
    mutation.entity.id,
    mutation.expectedVersion,
  );
  ensureEntityCollection(mutation.collection, mutation.entity);
  const incoming = clone(mutation.entity);
  if (incoming.deleted && !current?.deleted)
    validateReferencesBeforeDelete(state, mutation.collection, incoming.id);
  if (mutation.collection === 'categories' && !options.deferStateValidation) {
    const category = incoming as FinanceCategory;
    const categories = state.categories
      .filter((item) => item.id !== category.id)
      .concat(category);
    validateCategoryDirectory(categories);
  }
  if (mutation.collection === 'places' && !options.deferStateValidation) {
    const places = state.places
      .filter((item) => item.id !== incoming.id)
      .concat(incoming as FinancePlace);
    validatePlaceDirectory(places);
  }
  if (mutation.collection === 'accounts' && current) {
    const old = current as FinanceAccount;
    const next = incoming as FinanceAccount;
    const oldConfirmed = old.openingConfirmed !== false;
    const nextConfirmed = next.openingConfirmed !== false;
    if (oldConfirmed && !nextConfirmed)
      fail(`cannot unconfirm account ${old.id}`);
    if (!oldConfirmed && nextConfirmed) {
      assertOpeningAtCoversActivity(state, old.id, next.openingAt);
    } else if (
      oldConfirmed &&
      nextConfirmed &&
      (old.openingAt !== next.openingAt ||
        old.openingCents !== next.openingCents) &&
      accountHasActivity(state, old.id)
    ) {
      fail(`cannot change opening balance of account ${old.id} after activity`);
    }
  }
  if (mutation.collection === 'accounts')
    validateAccount(incoming as FinanceAccount);
  if (mutation.collection === 'activities')
    validateActivity(incoming as FinanceActivity);
  if (mutation.collection === 'sponsorships') {
    const sponsorship = incoming as FinanceSponsorship;
    assert(
      !!findCategory(state, sponsorship.categoryId),
      `sponsorship ${sponsorship.id} category is unknown`,
    );
  }
  if (
    mutation.collection === 'meals' &&
    (incoming as FinanceMeal).status !== 'skipped'
  ) {
    const meal = incoming as FinanceMeal;
    dateKey(meal.date);
    assert(MEALS.has(meal.meal), `meal ${meal.id} meal is invalid`);
    assert(
      !!state.places.find(
        (place) => place.id === meal.placeId && !place.deleted,
      ),
      `meal ${meal.id} place is unknown`,
    );
  }
  const entity = {
    ...incoming,
    version: addFinanceCents(
      current?.version ?? 0,
      1,
      `${mutation.collection}/${incoming.id} version`,
    ),
  } as FinanceEntity;
  const collection = entityArray(state, mutation.collection);
  const index = collection.findIndex((item) => item.id === entity.id);
  if (index >= 0) collection[index] = entity;
  else collection.push(entity);
  if (mutation.collection === 'categories' && !options.deferStateValidation)
    validateCategoryDirectory(state.categories);
  if (mutation.collection === 'places' && !options.deferStateValidation)
    validatePlaceDirectory(state.places);
  if (!options.deferStateValidation) validateFinanceState(state);
  return {
    collection: mutation.collection,
    id: entity.id,
    value: clone(entity),
  };
}

function applyDelete(
  state: FinanceState,
  mutation: Extract<FinanceMutation, { type: 'delete' }>,
  options: ApplyOptions = {},
): FinancePatch {
  const current = checkExpectedVersion(
    state,
    mutation.collection,
    mutation.id,
    mutation.expectedVersion,
  );
  assert(
    current,
    `cannot delete missing ${mutation.collection}/${mutation.id}`,
  );
  assert(
    !current.deleted,
    `${mutation.collection}/${mutation.id} is already deleted`,
  );
  validateReferencesBeforeDelete(state, mutation.collection, mutation.id);
  const entity = {
    ...clone(current),
    deleted: true,
    version: addFinanceCents(
      current.version,
      1,
      `${mutation.collection}/${mutation.id} version`,
    ),
  } as FinanceEntity;
  const collection = entityArray(state, mutation.collection);
  const index = collection.findIndex((item) => item.id === mutation.id);
  assert(index >= 0, `cannot find ${mutation.collection}/${mutation.id}`);
  collection[index] = entity;
  if (!options.deferStateValidation) validateFinanceState(state);
  return {
    collection: mutation.collection,
    id: mutation.id,
    value: clone(entity),
  };
}

function applySaveTransaction(
  state: FinanceState,
  mutation: Extract<FinanceMutation, { type: 'saveTransaction' }>,
  options: ApplyOptions = {},
): FinancePatch {
  const current = checkExpectedVersion(
    state,
    'transactions',
    mutation.transaction.id,
    mutation.expectedVersion,
  );
  const previous = state.transactions;
  if (current)
    state.transactions = previous.filter(
      (transaction) => transaction.id !== current.id,
    );
  const transaction = clone(mutation.transaction);
  transaction.version = addFinanceCents(
    current?.version ?? 0,
    1,
    `transactions/${transaction.id} version`,
  );
  transaction.deleted = false;
  if (transaction.sourceKey !== undefined) {
    const duplicate = state.transactions.find(
      (candidate) =>
        candidate.sourceKey === transaction.sourceKey &&
        candidate.id !== transaction.id,
    );
    assert(
      !duplicate,
      `duplicate transaction sourceKey: ${transaction.sourceKey}`,
    );
  }
  validateTransactionShape(transaction, state);
  if (transaction.kind === 'refund') {
    const original = findTransaction(state, transaction.relatedId!);
    assert(original, `refund ${transaction.id} original is missing`);
    const totals = refundTotals(state, original.id);
    validateRefundAgainstOriginal(
      original,
      transaction,
      totals.personal,
      totals.external,
    );
  }
  if (transaction.kind === 'collect') {
    const original = findTransaction(state, transaction.relatedId!);
    assert(original, `collect ${transaction.id} original is missing`);
    assert(
      addFinanceCents(
        settledReceivableCents(state, original.id),
        transaction.amountCents,
        `collect ${transaction.id} total`,
      ) <= receivablePrincipal(original),
      `collect ${transaction.id} exceeds receivable`,
    );
  }
  if (transaction.kind === 'repay') {
    const original = findTransaction(state, transaction.relatedId!);
    assert(original, `repay ${transaction.id} original is missing`);
    assert(
      original.kind === 'expense' ||
        original.kind === 'borrow' ||
        original.kind === 'openingPayable',
      `repay ${transaction.id} must link a payable expense, borrow or opening payable`,
    );
    assert(
      addFinanceCents(
        settledPayableCents(state, original.id),
        transaction.amountCents,
        `repay ${transaction.id} total`,
      ) <= payablePrincipal(original),
      `repay ${transaction.id} exceeds payable`,
    );
  }
  transaction.postings = buildFinancePostings(transaction, state);
  state.transactions.push(transaction);
  if (!options.deferStateValidation) {
    try {
      validateFinanceState(state);
    } catch (error) {
      state.transactions = previous;
      throw error;
    }
  }
  return {
    collection: 'transactions',
    id: transaction.id,
    value: clone(transaction),
  };
}

function applyConfigure(
  state: FinanceState,
  mutation: Extract<FinanceMutation, { type: 'configure' }>,
): FinancePatch[] {
  assert(
    state.categories.length === 0,
    'configure is only allowed on an empty category directory',
  );
  assert(mutation.categories.length > 0, 'configure requires categories');
  validateCategoryDirectory(mutation.categories);
  const patches: FinancePatch[] = [];
  for (const category of mutation.categories) {
    validateBase(category, 'category');
    const entity = {
      ...clone(category),
      version: 1,
      deleted: false,
    } as FinanceCategory;
    state.categories.push(entity);
    patches.push({
      collection: 'categories',
      id: entity.id,
      value: clone(entity),
    });
  }
  if (mutation.places) {
    validatePlaceDirectory(mutation.places);
    for (const place of mutation.places) {
      const entity = {
        ...clone(place),
        version: 1,
        deleted: false,
      } as FinancePlace;
      state.places.push(entity);
      patches.push({
        collection: 'places',
        id: entity.id,
        value: clone(entity),
      });
    }
  }
  validateFinanceState(state);
  return patches;
}

function applySkipMeal(
  state: FinanceState,
  mutation: Extract<FinanceMutation, { type: 'skipMeal' }>,
  options: ApplyOptions,
): FinancePatch[] {
  assert(
    mutation.meal.status === 'skipped' && !mutation.meal.deleted,
    'skipMeal requires an active skipped meal',
  );
  checkExpectedVersion(
    state,
    'meals',
    mutation.meal.id,
    mutation.expectedVersion,
  );
  const linked = state.transactions.filter(
    (t) => !t.deleted && t.mealId === mutation.meal.id,
  );
  const expected = mutation.expectedTransactions;
  assert(
    Array.isArray(expected) &&
      expected.length === linked.length &&
      new Set(expected.map((t) => t.id)).size === expected.length &&
      linked.every((t) =>
        expected.some((e) => e.id === t.id && e.version === t.version),
      ),
    'version conflict: meal associations changed; preview again',
  );
  // Only the meal association and entity revision change. Preserve postings,
  // refund origins, AA relationships, allocations and every financial field.
  const patches: FinancePatch[] = linked.map((t) => {
    const detached = {
      ...t,
      version: addFinanceCents(t.version, 1, 'transaction version'),
    };
    delete detached.mealId;
    state.transactions[state.transactions.indexOf(t)] = detached;
    return { collection: 'transactions', id: t.id, value: clone(detached) };
  });
  patches.push(
    applyPut(
      state,
      {
        type: 'put',
        collection: 'meals',
        entity: mutation.meal,
        expectedVersion: mutation.expectedVersion,
      },
      options,
    ),
  );
  return patches;
}

function applyOne(
  state: FinanceState,
  mutation: DomainMutation,
  options: ApplyOptions = {},
): FinancePatch[] {
  switch (mutation.type) {
    case 'skipMeal':
      return applySkipMeal(state, mutation, options);
    case 'put':
      return [applyPut(state, mutation, options)];
    case 'saveTransaction':
      return [applySaveTransaction(state, mutation, options)];
    case 'delete':
      return [applyDelete(state, mutation, options)];
    default:
      fail(
        `unsupported finance mutation: ${(mutation as { type: string }).type}`,
      );
  }
}

/** Apply a non-history finance mutation without changing the caller's state. */
export function applyFinanceMutation(
  state: FinanceState,
  mutation: FinanceMutation,
  now: Date | string = new Date(),
): { changes: FinancePatch[]; label: string } {
  void now;
  validateFinanceState(state);
  const next = clone(state);
  let changes: FinancePatch[];
  let label: string;
  switch (mutation.type) {
    case 'configure':
      changes = applyConfigure(next, mutation);
      label = '初始化分类与地点';
      break;
    case 'batch': {
      assert(mutation.mutations.length > 0, 'batch cannot be empty');
      changes = [];
      for (const child of mutation.mutations) {
        assert(
          child.type !== 'undo' &&
            child.type !== 'redo' &&
            child.type !== 'configure',
          `${child.type} cannot be nested in a batch`,
        );
        changes.push(
          ...applyOne(next, child as DomainMutation, {
            deferStateValidation: true,
          }),
        );
      }
      validateFinanceState(next);
      label = '批量更新';
      break;
    }
    case 'put':
      changes = applyOne(next, mutation);
      label = `更新${mutation.collection}`;
      break;
    case 'skipMeal':
      changes = applyOne(next, mutation);
      label = '标记未用餐（保留账务）';
      break;
    case 'saveTransaction':
      changes = applyOne(next, mutation);
      label = `保存${mutation.transaction.kind === 'expense' ? '消费' : '交易'}`;
      break;
    case 'delete':
      changes = applyOne(next, mutation);
      label = `删除${mutation.collection}`;
      break;
    case 'undo':
    case 'redo':
      fail(`${mutation.type} is handled by the store`);
  }
  return { changes: clone(changes), label };
}
