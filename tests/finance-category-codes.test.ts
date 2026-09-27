import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFinanceMutation,
  validateFinanceState,
} from '../lib/finance-domain.ts';
import {
  categoryLabel,
  defaultCategoryCodes,
  validateCategoryCodes,
} from '../lib/finance-category-codes.ts';
import {
  applyFinancePatches,
  emptyFinanceState,
  type FinanceCategory,
  type FinanceState,
} from '../lib/finance-types.ts';

function category(
  id: string,
  name: string,
  level: 1 | 2 | 3,
  parentId: string | null = null,
  extra: Partial<FinanceCategory> = {},
): FinanceCategory {
  return { id, version: 1, name, level, parentId, ...extra };
}

function approvedCategories(): FinanceCategory[] {
  const roots = [
    ['life', '日常生活开销', 'L'],
    ['hobby', '兴趣爱好开销', 'H'],
    ['social', '社交与人情开销', 'S'],
    ['education', '学习与项目开销', 'E'],
    ['travel', '旅行与返乡开销', 'T'],
    ['medical', '健康与医疗开销', 'M'],
    ['protection', '保障与必要费用', 'P'],
  ] as const;
  const sub = [
    ['life', '日常三餐', 'LM'],
    ['life', '饮品与零食', 'LD'],
    ['life', '日用购物与服务', 'LG'],
    ['life', '服饰与个人形象', 'LA'],
    ['life', '居住与搬迁', 'LH'],
    ['life', '日常交通', 'LT'],
    ['life', '通信', 'LC'],
    ['life', '通用数码', 'LE'],
    ['hobby', '摄影与动态影像', 'HP'],
    ['hobby', '跑步', 'HR'],
    ['hobby', '其他运动与户外', 'HO'],
    ['hobby', '福瑞', 'HF'],
    ['hobby', '其他兴趣与娱乐', 'HE'],
    ['social', '请客与社交聚餐', 'SD'],
    ['social', '礼物与赠予', 'SG'],
    ['social', '共同社交活动', 'SA'],
    ['social', '家庭支持', 'SF'],
    ['social', '公益捐助', 'SC'],
    ['education', '课程与知识学习', 'EC'],
    ['education', '学习竞赛与实践', 'EP'],
    ['education', '网站与软件基础设施', 'EI'],
    ['education', 'AI与软件工具', 'EA'],
    ['education', '学习与项目设备', 'EE'],
    ['education', '项目制作与交付', 'ED'],
    ['travel', '普通旅行', 'TT'],
    ['travel', '返乡探亲', 'TH'],
    ['medical', '医疗服务', 'MS'],
    ['medical', '药品与医用用品', 'MP'],
    ['medical', '健康照护', 'MC'],
    ['protection', '保险保障', 'PI'],
    ['protection', '证件与行政费用', 'PA'],
    ['protection', '金融费用', 'PF'],
    ['protection', '其他责任费用', 'PR'],
  ] as const;
  const result = roots.map(([id, name, code]) =>
    category(id, name, 1, null, { code }),
  );
  for (const [parentId, name, code] of sub)
    result.push(
      category(`${parentId}-${code}`, name, 2, parentId, { code }),
    );
  result.push(category('leaf', '学校食堂', 3, 'life-LM'));
  return result;
}

function codedState(categories: FinanceCategory[]): FinanceState {
  const state = emptyFinanceState('category-code-test', 'demo');
  state.categories = categories;
  return state;
}

void test('defaultCategoryCodes assigns all approved root and second-level codes', () => {
  const input = approvedCategories().map(({ code: _code, ...rest }) => rest);
  const result = defaultCategoryCodes(input);
  assert.equal(result.filter((item) => item.level === 1 && item.code).length, 7);
  assert.equal(result.filter((item) => item.level === 2 && item.code).length, 33);
  assert.equal(result.find((item) => item.name === '摄影与动态影像')?.code, 'HP');
  assert.equal(result.find((item) => item.level === 3)?.code, undefined);
  assert.deepEqual(
    input,
    approvedCategories().map(({ code: _code, ...rest }) => rest),
  );
  validateCategoryCodes(result);
});

void test('default codes preserve existing values and never guess unknown names', () => {
  const input: FinanceCategory[] = [
    category('life', '日常生活开销', 1, null, { code: 'Z' }),
    category('food', '日常三餐', 2, 'life'),
    category('leaf', '自定义明细', 3, 'food'),
    category('custom', '自定义大类', 1),
    category('custom-sub', '自定义小类', 2, 'custom'),
  ];
  const result = defaultCategoryCodes(input);
  assert.equal(result.find((item) => item.id === 'life')?.code, 'Z');
  assert.equal(result.find((item) => item.id === 'food')?.code, undefined);
  assert.equal(result.find((item) => item.id === 'custom')?.code, undefined);
  assert.equal(result.find((item) => item.id === 'custom-sub')?.code, undefined);
});

void test('soft-deleted codes remain reserved and cannot be assigned to another category', () => {
  const input = [
    category('old', '已停用分类', 1, null, { code: 'L', deleted: true }),
    category('life', '日常生活开销', 1),
    category('food', '日常三餐', 2, 'life'),
    category('leaf', '明细', 3, 'food'),
  ];
  const result = defaultCategoryCodes(input);
  assert.equal(result.find((item) => item.id === 'old')?.code, 'L');
  assert.equal(result.find((item) => item.id === 'life')?.code, undefined);
  assert.equal(result.find((item) => item.id === 'food')?.code, undefined);
});

void test('categoryLabel falls back to text for uncoded and level-3 categories', () => {
  const coded = category('photo', '摄影与动态影像', 2, 'hobby', { code: 'HP' });
  const leaf = category('leaf', '镜头购置', 3, 'photo');
  assert.equal(categoryLabel(coded, 'text'), '摄影与动态影像');
  assert.equal(categoryLabel(coded, 'code'), 'HP');
  assert.equal(categoryLabel(coded, 'both'), 'HP · 摄影与动态影像');
  assert.equal(categoryLabel(leaf, 'code'), '镜头购置');
  assert.equal(categoryLabel(leaf, 'both'), '镜头购置');
});

void test('domain validates format, uniqueness, parent prefix and level-3 prohibition', () => {
  const valid = codedState([
    category('root', '大类', 1, null, { code: 'L' }),
    category('sub', '小类', 2, 'root', { code: 'LM' }),
    category('leaf', '明细', 3, 'sub'),
  ]);
  validateFinanceState(valid);
  assert.throws(
    () => validateCategoryCodes([{ ...valid.categories[0], code: 'll' }]),
    /one uppercase letter/,
  );
  assert.throws(
    () =>
      validateCategoryCodes([
        ...valid.categories.slice(0, 1),
        { ...valid.categories[1], code: 'HM' },
        valid.categories[2],
      ]),
    /start with parent code/,
  );
  assert.throws(
    () =>
      validateCategoryCodes([
        valid.categories[0],
        valid.categories[1],
        { ...valid.categories[2], code: 'LX' },
      ]),
    /level-3.*cannot have a code/,
  );
  assert.throws(
    () =>
      validateCategoryCodes([
        valid.categories[0],
        valid.categories[1],
        { ...valid.categories[1], id: 'other-sub', code: 'LM' },
        valid.categories[2],
      ]),
    /already used/,
  );
});

void test('old no-code backups remain valid and coded fields survive a configure', () => {
  const categories = [
    category('root', '大类', 1),
    category('sub', '小类', 2, 'root'),
    category('leaf', '明细', 3, 'sub'),
  ];
  const old = codedState(categories);
  validateFinanceState(old);
  const configured = emptyFinanceState('category-code-test', 'demo');
  const result = applyFinanceMutation(configured, {
    type: 'configure',
    categories: [
      category('root', '大类', 1, null, { code: 'L' }),
      category('sub', '小类', 2, 'root', { code: 'LM' }),
      category('leaf', '明细', 3, 'sub'),
    ],
  });
  const next = applyFinancePatches(configured, result.changes, 1);
  assert.deepEqual(
    next.categories.map((item) => item.code),
    ['L', 'LM', undefined],
  );
  validateFinanceState(next);
});

void test('root and child code changes are accepted atomically in one batch', () => {
  const state = codedState([
    category('root', '大类', 1, null, { code: 'L' }),
    category('sub', '小类', 2, 'root', { code: 'LM' }),
    category('leaf', '明细', 3, 'sub'),
  ]);
  const result = applyFinanceMutation(state, {
    type: 'batch',
    mutations: [
      {
        type: 'put',
        collection: 'categories',
        entity: { ...state.categories[0], code: 'H' },
        expectedVersion: 1,
      },
      {
        type: 'put',
        collection: 'categories',
        entity: { ...state.categories[1], code: 'HP' },
        expectedVersion: 1,
      },
    ],
  });
  const next = applyFinancePatches(state, result.changes, 1);
  assert.equal(next.categories.find((item) => item.id === 'root')?.code, 'H');
  assert.equal(next.categories.find((item) => item.id === 'sub')?.code, 'HP');
  validateFinanceState(next);
  assert.throws(
    () =>
      applyFinanceMutation(state, {
        type: 'put',
        collection: 'categories',
        entity: { ...state.categories[0], code: 'H' },
        expectedVersion: 1,
      }),
    /start with parent code/,
  );
});
