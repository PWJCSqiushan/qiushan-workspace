import type {
  FinanceCategory,
  FinanceState,
  FinanceStats,
} from './finance-types.ts';
import {
  categoryLabel,
  type CategoryLabelMode,
} from './finance-category-codes.ts';
import { mealPlaceGroup } from './finance-places.ts';

export const chartDay = (iso: string) =>
  new Date(Date.parse(iso) + 28800000).toISOString().slice(0, 10);
export const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const chartMonthBounds = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return {
    from: month + '-01',
    to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10),
  };
};
export type ChartRange = { from: string; to: string };
export function chartPreset(
  preset: string,
  today: string,
  month: string,
): ChartRange {
  if (preset === 'month') return chartMonthBounds(month);
  if (preset === 'current') return chartMonthBounds(today.slice(0, 7));
  if (preset === '7' || preset === '30')
    return {
      from: shiftDay(today, 1 - Number(preset)),
      to: shiftDay(today, 1),
    };
  const n = Number(preset.slice(1));
  const [y, m] = today.split('-').map(Number);
  return {
    from: new Date(Date.UTC(y, m - n, 1)).toISOString().slice(0, 10),
    to: shiftDay(today, 1),
  };
}
export function categoryPath(
  categories: FinanceCategory[],
  id: string | null,
): FinanceCategory[] {
  const result: FinanceCategory[] = [],
    seen = new Set<string>();
  let item = categories.find((c) => c.id === id);
  while (item && !seen.has(item.id)) {
    seen.add(item.id);
    result.unshift(item);
    item = categories.find((c) => c.id === item?.parentId);
  }
  return result;
}
const hues = [156, 215, 38, 279, 350, 190, 72];
export function categoryColor(categories: FinanceCategory[], id: string) {
  if (id === 'unclassified') return '#86959d';
  const path = categoryPath(categories, id),
    root = path[0];
  const roots = categories.filter((c) => c.level === 1),
    hue =
      hues[
        Math.max(
          0,
          roots.findIndex((c) => c.id === root?.id),
        ) % hues.length
      ];
  const siblings = categories.filter(
    (c) => c.parentId === path.at(-1)?.parentId,
  );
  const index = Math.max(
    0,
    siblings.findIndex((c) => c.id === id),
  );
  return `hsl(${hue} ${path.length === 1 ? 35 : 30 + (index % 3) * 7}% ${path.length === 1 ? 62 : 48 + (index % 5) * 7}%)`;
}
export function categoryChartModel(data: FinanceState, stats: FinanceStats) {
  const cents = new Map<string, number>(),
    counts = new Map<string, Set<string>>();
  for (const g of stats.categoryTotals)
    for (const c of categoryPath(data.categories, g.id))
      cents.set(c.id, (cents.get(c.id) || 0) + g.cents);
  for (const t of data.transactions) {
    if (t.deleted || t.kind !== 'expense') continue;
    const date = chartDay(t.occurredAt);
    if (date < stats.from || date >= stats.to) continue;
    for (const a of t.allocations)
      for (const c of categoryPath(data.categories, a.categoryId)) {
        const ids = counts.get(c.id) || new Set<string>();
        ids.add(t.id);
        counts.set(c.id, ids);
      }
  }
  const categories = data.categories.filter(
    (c) => !c.deleted && (!c.archived || (counts.get(c.id)?.size || 0) > 0),
  );
  const groups = (parent: string | null, mode: CategoryLabelMode) => {
    const selected = categories.find((c) => c.id === parent);
    const children = categories.filter((c) => c.parentId === parent);
    const entries = (
      children.length ? children : selected ? [selected] : []
    ).map((c) => ({
      id: c.id,
      name: categoryLabel(c, mode),
      fullName: c.name,
      cents: cents.get(c.id) || 0,
      count: counts.get(c.id)?.size || 0,
      color: categoryColor(data.categories, c.id),
    }));
    if (parent === null || parent === 'unclassified') {
      const unknown = {
        id: 'unclassified',
        name: '待分类',
        fullName: '待分类',
        cents: stats.unclassifiedCents,
        count: data.transactions.filter(
          (t) =>
            !t.deleted &&
            t.kind === 'expense' &&
            chartDay(t.occurredAt) >= stats.from &&
            chartDay(t.occurredAt) < stats.to &&
            (!t.allocations.length || t.allocations.some((a) => !a.categoryId)),
        ).length,
        color: '#86959d',
      };
      if (parent === 'unclassified') return [unknown];
      entries.push(unknown);
    }
    return entries;
  };
  return { categories, cents, counts, groups };
}
export function completeDays(data: FinanceState, stats: FinanceStats) {
  const amounts = new Map(stats.daily.map((d) => [d.date, d.cents]));
  const recorded = new Set(
    data.transactions
      .filter((t) => !t.deleted && t.kind === 'expense')
      .map((t) => chartDay(t.occurredAt)),
  );
  const days: { date: string; cents: number; recorded: boolean }[] = [];
  for (let d = stats.from; d < stats.to; d = shiftDay(d, 1))
    days.push({
      date: d,
      cents: amounts.get(d) || 0,
      recorded: recorded.has(d),
    });
  return days;
}
export function monthSeries(
  days: ReturnType<typeof completeDays>,
  range: ChartRange,
  today: string,
) {
  const months = new Map<
    string,
    { date: string; cents: number; recorded: boolean; partial: boolean }
  >();
  for (const d of days) {
    const month = d.date.slice(0, 7),
      b = chartMonthBounds(month);
    const row = months.get(month) || {
      date: month,
      cents: 0,
      recorded: false,
      partial: range.from > b.from || range.to < b.to || today < b.to,
    };
    row.cents += d.cents;
    row.recorded ||= d.recorded;
    months.set(month, row);
  }
  return [...months.values()];
}
export function mealChartGroups(
  data: FinanceState,
  stats: FinanceStats,
  slot: string,
  level: 'area' | 'venue' | 'brand',
  measure: 'count' | 'money',
) {
  const meals = data.meals.filter(
    (m) =>
      !m.deleted &&
      m.date >= stats.from &&
      m.date < stats.to &&
      (slot === 'all' || m.meal === slot),
  );
  const groups = new Map<string, { id: string; name: string; cents: number }>();
  for (const row of stats.mealPlaces) {
    const place = data.places.find((p) => p.id === row.id);
    const group =
      level === 'brand' && place?.brand
        ? { id: 'brand:' + place.brand, name: place.brand }
        : mealPlaceGroup(
            data.places,
            row.id,
            level === 'area' ? 'area' : 'venue',
          );
    const g = groups.get(group.id) || { ...group, cents: 0 };
    g.cents += measure === 'count' ? row.count : row.cents;
    groups.set(group.id, g);
  }
  return {
    groups: [...groups.values()]
      .filter((g) => g.cents > 0)
      .sort((a, b) => b.cents - a.cents),
    pending: meals.filter((m) => m.pricePending || m.payment === 'unknown')
      .length,
    mealCount: meals.length,
  };
}
