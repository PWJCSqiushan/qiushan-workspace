/** Finance v1 shared contract. Money is integer CNY cents; no personal seed data. */
export type FinanceSpace = 'personal' | 'demo';
export type FinanceCollection =
  | 'accounts'
  | 'categories'
  | 'places'
  | 'activities'
  | 'transactions'
  | 'meals'
  | 'sponsorships';
export type FinanceBase = { id: string; version: number; deleted?: boolean };
export type FinanceAccount = FinanceBase & {
  name: string;
  kind: 'asset' | 'credit';
  openingCents: number;
  openingAt: string;
  openingConfirmed?: boolean;
  archived?: boolean;
};
export type FinanceCategory = FinanceBase & {
  name: string;
  parentId: string | null;
  level: 1 | 2 | 3;
  /** Optional stable display/search code. Level 1/2 only; validated by the domain. */
  code?: string;
  content?: string;
  archived?: boolean;
  other?: boolean;
  quickUse?: 'meal' | 'mealTreat';
};
export type FinancePlace = FinanceBase & {
  name: string;
  parentId: string | null;
  brand?: string;
  aliases?: string[];
  favorite?: boolean;
  archived?: boolean;
  defaultCategoryId?: string;
  summaryGroupId?: string;
  summaryGroupName?: string;
  /** Stable area color. Shared summary-group roots must agree when specified. */
  tone?: FinancePlaceTone;
};
export type FinancePlaceTone = 'mint' | 'amber' | 'blue' | 'rose';
export type FinanceActivity = FinanceBase & {
  name: string;
  kind: 'event' | 'custody';
  categoryId?: string;
  date?: string;
  note?: string;
};
export type FinanceNature =
  | 'daily'
  | 'durable'
  | 'rental'
  | 'subscription'
  | 'credits';
export type FinanceAllocation = {
  id: string;
  categoryId: string | null;
  content: string;
  amountCents: number;
  merchantId?: string;
  activityId?: string;
  nature: FinanceNature;
  note?: string;
  refundOfAllocationId?: string;
};
export type FinanceKind =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'refund'
  | 'lend'
  | 'borrow'
  | 'collect'
  | 'repay'
  | 'custodyReceive'
  | 'custodyPay'
  | 'openingReceivable'
  | 'openingPayable'
  | 'openingCustody'
  | 'adjustment';
export type FinancePosting = { account: string; cents: number };
export type FinanceTransaction = FinanceBase & {
  kind: FinanceKind;
  occurredAt: string;
  accountId: string;
  targetAccountId?: string;
  amountCents: number;
  personalCents?: number;
  allocations: FinanceAllocation[];
  relatedId?: string;
  caseId?: string;
  mealId?: string;
  counterparty?: string;
  note?: string;
  sourceKey?: string;
  importBatchId?: string;
  analysisOnly?: boolean;
  unusual?: boolean;
  postings?: FinancePosting[];
};
export type FinanceMeal = FinanceBase & {
  date: string;
  meal: 'breakfast' | 'lunch' | 'dinner';
  note?: string;
} & (
    | {
        /** Missing status in older backups means eaten. */
        status?: 'eaten';
        placeId: string;
        companions:
          | 'alone'
          | 'classmates'
          | 'friends'
          | 'friendsF'
          | 'friendsL'
          | 'family'
          | 'other'
          | 'unknown';
        payment: 'self' | 'aa' | 'treat' | 'invited' | 'unknown';
        pricePending: boolean;
      }
    | {
        status: 'skipped';
        placeId?: never;
        companions?: never;
        payment?: never;
        pricePending: false;
      }
  );
export type FinanceSponsorship = FinanceBase & {
  date?: string;
  name: string;
  categoryId: string;
  amountCents: number;
  activityId?: string;
  note?: string;
};
export type FinanceEntity =
  | FinanceAccount
  | FinanceCategory
  | FinancePlace
  | FinanceActivity
  | FinanceTransaction
  | FinanceMeal
  | FinanceSponsorship;
export type FinanceHistory = {
  id: string;
  label: string;
  createdAt: string;
  undone: boolean;
  redoInvalidated?: boolean;
};
export type FinanceState = {
  owner: string;
  space: FinanceSpace;
  version: number;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  places: FinancePlace[];
  activities: FinanceActivity[];
  transactions: FinanceTransaction[];
  meals: FinanceMeal[];
  sponsorships: FinanceSponsorship[];
  history: FinanceHistory[];
};
export type FinancePatch = {
  collection: FinanceCollection;
  id: string;
  value: FinanceEntity | null;
};
export type FinanceMutation =
  | {
      type: 'skipMeal';
      meal: Extract<FinanceMeal, { status: 'skipped' }>;
      expectedVersion: number;
      /** Exact previewed association set; guards both changed and new links. */
      expectedTransactions: { id: string; version: number }[];
    }
  | {
      type: 'put';
      collection: Exclude<FinanceCollection, 'transactions'>;
      entity: FinanceEntity;
      expectedVersion: number;
    }
  | {
      type: 'saveTransaction';
      transaction: FinanceTransaction;
      expectedVersion: number;
    }
  | {
      type: 'delete';
      collection: FinanceCollection;
      id: string;
      expectedVersion: number;
    }
  | { type: 'undo' | 'redo'; historyId: string }
  | {
      type: 'configure';
      categories: FinanceCategory[];
      places?: FinancePlace[];
    }
  | { type: 'batch'; mutations: Exclude<FinanceMutation, { type: 'batch' }>[] };
export type FinanceEnvelope = {
  space: FinanceSpace;
  operationId: string;
  baseVersion: number;
  mutation: FinanceMutation;
};
export type FinanceReceipt = {
  operationId: string;
  version: number;
  changes: FinancePatch[];
  history?: FinanceHistory;
};
export type FinanceSync = {
  owner: string;
  space: FinanceSpace;
  version: number;
  cursor: number;
  hasMore: boolean;
  reset?: boolean;
  changes: FinancePatch[];
  history: FinanceHistory[];
};
export type FinanceGroup = {
  id: string;
  name: string;
  cents: number;
  count: number;
};
export type FinanceStats = {
  from: string;
  to: string;
  personalCents: number;
  incomeCents: number;
  unclassifiedCents: number;
  categoryTotals: FinanceGroup[];
  contentTotals: FinanceGroup[];
  merchantTotals: FinanceGroup[];
  activityTotals: FinanceGroup[];
  natureTotals: FinanceGroup[];
  daily: { date: string; cents: number }[];
  accountBalances: {
    id: string;
    name: string;
    kind: 'asset' | 'credit';
    cents: number;
  }[];
  receivableCents: number;
  payableCents: number;
  custodyCents: number;
  sponsorCents: number;
  mealCount: number;
  pendingMealCount: number;
  skippedMealCount: number;
  unlinkedMealCents: number;
  unlinkedMealTransactionIds: string[];
  mealPlaces: {
    id: string;
    name: string;
    count: number;
    days: number;
    cents: number;
  }[];
};
export function emptyFinanceState(
  owner = '',
  space: FinanceSpace = 'personal',
): FinanceState {
  return {
    owner,
    space,
    version: 0,
    accounts: [],
    categories: [],
    places: [],
    activities: [],
    transactions: [],
    meals: [],
    sponsorships: [],
    history: [],
  };
}
export function applyFinancePatches(
  state: FinanceState,
  patches: FinancePatch[],
  version: number,
): FinanceState {
  const next = { ...state, version };
  for (const collection of new Set(patches.map((p) => p.collection))) {
    const map = new Map<string, FinanceEntity>(
      (state[collection] as FinanceEntity[]).map((v) => [v.id, v]),
    );
    for (const p of patches.filter((p) => p.collection === collection)) {
      if (p.value) map.set(p.id, p.value);
      else map.delete(p.id);
    }
    (next[collection] as FinanceEntity[]) = Array.from(map.values());
  }
  return next;
}
