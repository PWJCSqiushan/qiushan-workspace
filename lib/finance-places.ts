import type {
  FinanceMeal,
  FinancePlace,
  FinanceState,
  FinanceStats,
} from './finance-types.ts';

export type MealPlaceLevel = 'area' | 'floor' | 'venue';

/** A shared reporting group combines areas without changing the quick-entry hierarchy. */
export function mealPlaceGroup(
  places: FinancePlace[],
  placeId: string,
  level: MealPlaceLevel,
) {
  const place = places.find((p) => p.id === placeId),
    root = places.find((p) => p.id === (place?.parentId || placeId));
  if (level === 'venue') return { id: placeId, name: place?.name || placeId };
  if (level === 'area' && root?.summaryGroupId)
    return { id: 'group:' + root.summaryGroupId, name: root.summaryGroupName! };
  return {
    id: root?.id || placeId,
    name: root?.name || place?.name || placeId,
  };
}

export function groupMealPlaces(
  places: FinancePlace[],
  rows: FinanceStats['mealPlaces'],
  meals: FinanceMeal[],
  level: MealPlaceLevel,
): FinanceStats['mealPlaces'] {
  const result = new Map<string, FinanceStats['mealPlaces'][number]>(),
    dates = new Map<string, Set<string>>();
  for (const meal of meals) {
    const { id } = mealPlaceGroup(places, meal.placeId, level),
      days = dates.get(id) || new Set<string>();
    days.add(meal.date);
    dates.set(id, days);
  }
  for (const row of rows) {
    const group = mealPlaceGroup(places, row.id, level),
      entry = result.get(group.id) || { ...group, count: 0, cents: 0, days: 0 };
    entry.count += row.count;
    entry.cents += row.cents;
    entry.days = dates.get(group.id)?.size || 0;
    result.set(group.id, entry);
  }
  return [...result.values()].sort(
    (a, b) =>
      b.count - a.count || b.cents - a.cents || a.name.localeCompare(b.name),
  );
}

export function mealNetCents(data: FinanceState, mealId: string) {
  const expenses = data.transactions.filter(
      (t) => !t.deleted && t.kind === 'expense' && t.mealId === mealId,
    ),
    ids = new Set(expenses.map((t) => t.id));
  return (
    expenses.reduce((sum, t) => sum + (t.personalCents ?? t.amountCents), 0) -
    data.transactions
      .filter(
        (t) => !t.deleted && t.kind === 'refund' && ids.has(t.relatedId || ''),
      )
      .reduce(
        (sum, t) =>
          sum +
          (t.personalCents ??
            t.allocations.reduce((n, a) => n + a.amountCents, 0)),
        0,
      )
  );
}

export function mealDefaultCategory(
  data: FinanceState,
  meal?: FinanceMeal,
): string | null {
  if (!meal) return null;
  if (meal.payment === 'treat')
    return (
      data.categories.find(
        (c) =>
          c.quickUse === 'mealTreat' &&
          !c.deleted &&
          !c.archived &&
          c.level === 3,
      )?.id || null
    );
  const place = data.places.find((p) => p.id === meal.placeId),
    root = data.places.find((p) => p.id === place?.parentId),
    id =
      place?.defaultCategoryId ||
      root?.defaultCategoryId ||
      data.categories.find(
        (c) =>
          c.quickUse === 'meal' && !c.deleted && !c.archived && c.level === 3,
      )?.id;
  return data.categories.some(
    (c) => c.id === id && !c.deleted && !c.archived && c.level === 3,
  )
    ? id!
    : null;
}

export function orderedMealAreas(places: FinancePlace[]) {
  const roots = places.filter((p) => !p.parentId && !p.deleted && !p.archived),
    used = new Set<string>(),
    result: FinancePlace[] = [];
  for (const p of roots) {
    if (used.has(p.id)) continue;
    for (const item of p.summaryGroupId
      ? roots.filter((r) => r.summaryGroupId === p.summaryGroupId)
      : [p]) {
      result.push(item);
      used.add(item.id);
    }
  }
  return result;
}

export function mealExpenseRows(data: FinanceState, mealId?: string) {
  return mealId
    ? data.transactions.filter(
        (t) => !t.deleted && t.kind === 'expense' && t.mealId === mealId,
      )
    : [];
}
