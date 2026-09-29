import type { FinanceMeal } from './finance-types.ts';

export const mealCompanionNames = {
  unknown: '同伴未注明',
  alone: '独自吃',
  classmates: '和同学吃',
  friendsF: '和朋友吃[F]',
  friendsL: '和朋友吃[L]',
  friends: '和朋友吃[其他]',
  family: '和家人吃',
  other: '和其他人吃',
} as const;
export const mealPaymentNames = {
  unknown: '结算待核对',
  self: '自付',
  aa: 'AA',
  treat: '我请客',
  invited: '别人请客',
} as const;
const colors = [
  '#83919e',
  '#528a78',
  '#6387ac',
  '#a97892',
  '#8a7fb2',
  '#b69256',
  '#779894',
  '#bc8870',
];

/** Count recorded meals, including unknowns, excluding skipped/deleted slots. */
export function mealSocialGroups(meals: FinanceMeal[]) {
  const eaten = meals.filter((m) => !m.deleted && m.status !== 'skipped');
  const group = (
    names: Record<string, string>,
    field: 'companions' | 'payment',
  ) =>
    Object.entries(names).map(([id, name], i) => ({
      id,
      name,
      color: colors[i],
      cents: eaten.filter((m) => m[field] === id).length,
    }));
  return {
    total: eaten.length,
    companions: group(mealCompanionNames, 'companions'),
    payments: group(mealPaymentNames, 'payment'),
  };
}
