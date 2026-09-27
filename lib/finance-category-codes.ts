import type { FinanceCategory } from './finance-types.ts';

/** The three supported ways of presenting a category in the UI and exports. */
export type CategoryLabelMode = 'text' | 'code' | 'both';

type RootRule = {
  code: string;
  names: readonly string[];
};

type SubcategoryRule = {
  rootCode: string;
  name: string;
  code: string;
};

/**
 * The approved catalog codes. The names with "开销" are the names already
 * used by the private catalog; the shorter names are kept as a compatibility
 * alias for older or manually created snapshots.
 */
const ROOT_RULES: readonly RootRule[] = [
  { code: 'L', names: ['日常生活开销', '日常生活'] },
  { code: 'H', names: ['兴趣爱好开销', '兴趣爱好'] },
  { code: 'S', names: ['社交与人情开销', '社交与人情'] },
  { code: 'E', names: ['学习与项目开销', '学习与项目'] },
  { code: 'T', names: ['旅行与返乡开销', '旅行与返乡'] },
  { code: 'M', names: ['健康与医疗开销', '健康与医疗'] },
  { code: 'P', names: ['保障与必要费用'] },
];

const SUBCATEGORY_RULES: readonly SubcategoryRule[] = [
  { rootCode: 'L', name: '日常三餐', code: 'LM' },
  { rootCode: 'L', name: '饮品与零食', code: 'LD' },
  { rootCode: 'L', name: '日用购物与服务', code: 'LG' },
  { rootCode: 'L', name: '服饰与个人形象', code: 'LA' },
  { rootCode: 'L', name: '居住与搬迁', code: 'LH' },
  { rootCode: 'L', name: '日常交通', code: 'LT' },
  { rootCode: 'L', name: '通信', code: 'LC' },
  { rootCode: 'L', name: '通用数码', code: 'LE' },
  { rootCode: 'H', name: '摄影与动态影像', code: 'HP' },
  { rootCode: 'H', name: '跑步', code: 'HR' },
  { rootCode: 'H', name: '其他运动与户外', code: 'HO' },
  { rootCode: 'H', name: '福瑞', code: 'HF' },
  { rootCode: 'H', name: '其他兴趣与娱乐', code: 'HE' },
  { rootCode: 'S', name: '请客与社交聚餐', code: 'SD' },
  { rootCode: 'S', name: '礼物与赠予', code: 'SG' },
  { rootCode: 'S', name: '共同社交活动', code: 'SA' },
  { rootCode: 'S', name: '家庭支持', code: 'SF' },
  { rootCode: 'S', name: '公益捐助', code: 'SC' },
  { rootCode: 'E', name: '课程与知识学习', code: 'EC' },
  { rootCode: 'E', name: '学习竞赛与实践', code: 'EP' },
  { rootCode: 'E', name: '网站与软件基础设施', code: 'EI' },
  { rootCode: 'E', name: 'AI与软件工具', code: 'EA' },
  { rootCode: 'E', name: '学习与项目设备', code: 'EE' },
  { rootCode: 'E', name: '项目制作与交付', code: 'ED' },
  { rootCode: 'T', name: '普通旅行', code: 'TT' },
  { rootCode: 'T', name: '返乡探亲', code: 'TH' },
  { rootCode: 'M', name: '医疗服务', code: 'MS' },
  { rootCode: 'M', name: '药品与医用用品', code: 'MP' },
  { rootCode: 'M', name: '健康照护', code: 'MC' },
  { rootCode: 'P', name: '保险保障', code: 'PI' },
  { rootCode: 'P', name: '证件与行政费用', code: 'PA' },
  { rootCode: 'P', name: '金融费用', code: 'PF' },
  { rootCode: 'P', name: '其他责任费用', code: 'PR' },
];

const ROOT_CODE_BY_NAME = new Map<string, string>(
  ROOT_RULES.flatMap((rule) => rule.names.map((name) => [name, rule.code] as const)),
);
const SUB_CODE_BY_ROOT_AND_NAME = new Map<string, string>(
  SUBCATEGORY_RULES.map((rule) => [`${rule.rootCode}\u0000${rule.name}`, rule.code]),
);

function codeValue(category: FinanceCategory): string | undefined {
  return category.level === 1 || category.level === 2
    ? category.code
    : undefined;
}

/**
 * Return the category label requested by the caller. Level-3 categories do
 * not have codes, and an absent code always falls back to the text label.
 */
export function categoryLabel(
  category: FinanceCategory,
  mode: CategoryLabelMode,
): string {
  if (mode === 'text') return category.name;
  const code = codeValue(category);
  if (!code) return category.name;
  return mode === 'code' ? code : `${code} · ${category.name}`;
}

/**
 * Validate code-specific invariants without requiring a complete directory.
 * The finance domain calls this alongside its parent/level checks. Deleted
 * rows are included so a soft-deleted code remains reserved forever.
 */
export function validateCategoryCodes(
  categories: readonly FinanceCategory[],
): void {
  const used = new Map<string, string>();
  for (const category of categories) {
    if (category.code === undefined) continue;
    if (category.level === 3)
      throw new Error(`level-3 category ${category.id} cannot have a code`);
    if (
      category.level === 1 &&
      !/^[A-Z]$/.test(category.code)
    )
      throw new Error(`category ${category.id} root code must be one uppercase letter`);
    if (
      category.level === 2 &&
      !/^[A-Z]{2}$/.test(category.code)
    )
      throw new Error(`category ${category.id} subcategory code must be two uppercase letters`);
    const previous = used.get(category.code);
    if (previous && previous !== category.id)
      throw new Error(
        `category code ${category.code} is already used by ${previous}`,
      );
    used.set(category.code, category.id);
    if (
      category.level !== 2 ||
      category.parentId === null ||
      category.deleted
    )
      continue;
    const parent = categories.find((candidate) => candidate.id === category.parentId);
    // Old backups may have no parent code. In that case the two-letter code
    // remains valid and can be upgraded once the parent is explicitly coded.
    if (parent?.code !== undefined && category.code[0] !== parent.code)
      throw new Error(
        `category ${category.id} code must start with parent code ${parent.code}`,
      );
  }
}

/**
 * Add only the approved level-1 and level-2 codes to a directory. Existing
 * codes, including codes on archived/deleted rows, always win and reserve
 * their value. Unknown names and all level-3 rows remain text-only.
 */
export function defaultCategoryCodes(
  categories: readonly FinanceCategory[],
): FinanceCategory[] {
  const next = categories.map((category) => ({ ...category }));
  validateCategoryCodes(next);
  const used = new Set(
    next
      .map((category) => category.code)
      .filter((code): code is string => code !== undefined),
  );

  for (const category of next.filter((item) => item.level === 1)) {
    if (category.code !== undefined) continue;
    const candidate = ROOT_CODE_BY_NAME.get(category.name);
    if (!candidate || used.has(candidate)) continue;
    // If an old child already has an unrelated code, assigning the parent
    // code would make a legacy directory invalid. Leave both untouched for
    // an explicit user migration instead of guessing.
    const hasIncompatibleChild = next.some(
      (child) =>
        child.level === 2 &&
        child.parentId === category.id &&
        child.code !== undefined &&
        child.code[0] !== candidate,
    );
    if (hasIncompatibleChild) continue;
    category.code = candidate;
    used.add(candidate);
  }

  for (const category of next.filter((item) => item.level === 2)) {
    if (category.code !== undefined) continue;
    const parent = next.find((candidate) => candidate.id === category.parentId);
    if (!parent) continue;
    const expectedRootCode = ROOT_CODE_BY_NAME.get(parent.name);
    if (!expectedRootCode || parent.code !== expectedRootCode) continue;
    const candidate = SUB_CODE_BY_ROOT_AND_NAME.get(
      `${expectedRootCode}\u0000${category.name}`,
    );
    if (!candidate || used.has(candidate)) continue;
    category.code = candidate;
    used.add(candidate);
  }
  validateCategoryCodes(next);
  return next;
}
