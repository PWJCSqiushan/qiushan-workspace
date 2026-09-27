import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFinanceState } from '../lib/finance-types.ts';
import {
  assignCampusRowBoxes,
  parseCampusOcr,
  type CampusImportOptions,
} from '../lib/finance-campus-import.ts';

function row(merchant: string, amount: string, type: string, time: string) {
  return `${merchant}\n${amount}\n${type}\n${time}`;
}

void test('campus OCR keeps dated rows, maps public aliases, and reconciles page totals', () => {
  // Entirely synthetic fixture, unrelated to personal statement rows.
  const meals = [
    ['校内食堂A/电子账户', '-18.75', '04-10 12:10'],
    ['校内食堂A/电子账户', '-12.35', '04-08 18:10'],
    ['校内食堂B/电子账户', '-13.00', '04-07 18:00'],
    ['校内食堂A/电子账户', '-10.50', '04-07 18:05'],
  ];
  const bath = [
    ['合成校园浴池/电子账户', '-0.15', '04-09 20:00'],
    ['合成校园浴池/电子账户', '-0.20', '04-09 20:03'],
  ];
  const recharges = [
    ['微信支付转账', '+40.00', '充值', '04-07 08:00'],
    ['微信支付转账', '+80.00', '充值', '04-02 08:00'],
  ];
  const text = [
    '本月',
    '支出 ¥54.95',
    '收入 ¥120.00',
    ...meals.map((value) => row(value[0], value[1], '消费', value[2])),
    ...bath.map((value) => row(value[0], value[1], '消费', value[2])),
    ...recharges.map((value) => row(value[0], value[1], value[2], value[3])),
  ].join('\n');
  const result = parseCampusOcr(text, {
    year: 2025,
    imageHash: 'image-a',
    aliases: { 校内食堂A: '食堂甲', 校内食堂B: '食堂乙' },
  });
  assert.equal(result.rows.length, 8);
  assert.equal(result.expenseTotalCents, 5495);
  assert.equal(result.rechargeTotalCents, 12000);
  assert.equal(result.warnings.length, 0);
  const firstMeal = result.rows[0];
  assert.equal(firstMeal.platform, 'campus');
  assert.equal(firstMeal.suggestedPlaceName, '食堂甲');
  assert.equal(firstMeal.mealSlot, 'lunch');
  assert.equal(firstMeal.suggestedKind, 'expense');
  assert.match(firstMeal.sourceKey || '', /^campus:image-a:/);
  assert.equal(result.rows[1].suggestedPlaceName, '食堂甲');
  assert.equal(result.rows[3].requiresShareReview, true);
  const shareReviewRows = result.rows.filter(
    (item) => item.requiresShareReview,
  );
  assert.equal(shareReviewRows.length, 2);
  assert.equal(
    shareReviewRows.reduce((sum, item) => sum + item.amountCents, 0),
    2350,
  );
  const bathRow = result.rows.find((item) => item.merchant.includes('浴池'))!;
  assert.equal(bathRow.mealSlot, undefined);
  assert.match(bathRow.warnings.join(' '), /不是餐饮/);
  const recharge = result.rows.at(-1)!;
  assert.equal(recharge.direction, '充值');
  assert.equal(recharge.suggestedKind, null);
  assert.match(recharge.warnings.join(' '), /不是消费/);
});

void test('campus aliases and category suggestions are caller-owned and source rows are idempotent', () => {
  const state = emptyFinanceState('test', 'demo');
  state.categories.push(
    { id: 'meal', version: 1, parentId: null, level: 3, name: '日常三餐' },
    {
      id: 'bath',
      version: 1,
      parentId: null,
      level: 3,
      name: '洗衣及生活服务',
    },
  );
  state.accounts.push(
    {
      id: 'wechat',
      version: 1,
      name: '微信',
      kind: 'asset',
      openingCents: 0,
      openingAt: '2025-01-01T00:00:00Z',
    },
    {
      id: 'card',
      version: 1,
      name: '饭卡',
      kind: 'asset',
      openingCents: 0,
      openingAt: '2025-01-01T00:00:00Z',
    },
  );
  state.transactions.push(
    {
      id: 'transfer',
      version: 1,
      kind: 'transfer',
      accountId: 'wechat',
      targetAccountId: 'card',
      occurredAt: '2025-04-21T09:35:00.000Z',
      amountCents: 5000,
      personalCents: 0,
      allocations: [],
      sourceKey: 'wechat:transfer-1',
    },
    {
      id: 'old-campus',
      version: 1,
      kind: 'expense',
      accountId: 'card',
      occurredAt: '2025-04-24T04:12:00.000Z',
      amountCents: 1875,
      personalCents: 1875,
      allocations: [],
      sourceKey: 'campus:image-a:1',
    },
  );
  const options: CampusImportOptions = {
    year: 2025,
    imageHash: 'image-a',
    state,
    mealCategoryId: 'meal',
    bathCategoryId: 'bath',
    aliases: { 自定义食堂: { placeName: '我的测试食堂', categoryId: 'meal' } },
  };
  const result = parseCampusOcr(
    '自定义食堂\n-18.75\n消费\n04-24 12:12\n微信支付转账\n+50.00\n充值\n04-21 17:36',
    options,
  );
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].duplicateId, 'old-campus');
  assert.equal(result.rows[0].suggestedPlaceName, '我的测试食堂');
  assert.equal(result.rows[0].suggestedCategoryId, 'meal');
  assert.deepEqual(result.rows[1].candidates, ['transfer']);
  assert.equal(result.rows[1].duplicateId, undefined);
});

void test('assignCampusRowBoxes unions real OCR line boxes without uniform row estimates', () => {
  const parsed = parseCampusOcr(
    '测试食堂A\n-18.75\n消费\n04-24 12:12\n测试食堂B\n-12.35\n消费\n04-22 18:29',
    {
      year: 2025,
      imageHash: 'boxes',
      aliases: { 测试食堂A: '食堂甲', 测试食堂B: '食堂乙' },
    },
  );
  const rows = assignCampusRowBoxes(parsed.rows, [
    {
      text: '测试食堂A/电子账户',
      confidence: 92,
      bbox: { x0: 20, y0: 100, x1: 260, y1: 130 },
    },
    {
      text: '-18.75',
      confidence: 96,
      bbox: { x0: 300, y0: 100, x1: 380, y1: 130 },
    },
    {
      text: '消费',
      confidence: 88,
      bbox: { x0: 20, y0: 132, x1: 70, y1: 148 },
    },
    {
      text: '04-24 12:12',
      confidence: 97,
      bbox: { x0: 20, y0: 150, x1: 150, y1: 176 },
    },
    {
      text: '测试食堂B/电子账户',
      confidence: 91,
      bbox: { x0: 20, y0: 210, x1: 260, y1: 240 },
    },
    {
      text: '-12.35',
      confidence: 95,
      bbox: { x0: 300, y0: 210, x1: 380, y1: 240 },
    },
    {
      text: '消费',
      confidence: 89,
      bbox: { x0: 20, y0: 242, x1: 70, y1: 258 },
    },
    {
      text: '04-22 18:29',
      confidence: 96,
      bbox: { x0: 20, y0: 260, x1: 150, y1: 286 },
    },
  ]);
  assert.deepEqual(
    rows.map((item) => item.bbox),
    [
      { x0: 20, y0: 100, x1: 380, y1: 176 },
      { x0: 20, y0: 210, x1: 380, y1: 286 },
    ],
  );
  assert.deepEqual(
    rows.map((item) => item.bboxConfidence),
    [88, 89],
  );
});

void test('cross-image expense matches remain weak candidates and uncertain rows are retained', () => {
  const state = emptyFinanceState('test', 'demo');
  state.transactions.push({
    id: 'possible',
    version: 1,
    kind: 'expense',
    accountId: 'card',
    occurredAt: '2025-04-24T04:10:00.000Z',
    amountCents: 1875,
    personalCents: 1875,
    allocations: [],
    sourceKey: 'campus:other-image:99',
  });
  const result = parseCampusOcr(
    '未知地点\n-18.75\n消费\n04-24 12:12\n未知行\n消费\n04-24 13:00',
    { year: 2025, imageHash: 'new-image', state },
  );
  assert.deepEqual(result.rows[0].candidates, ['possible']);
  assert.equal(result.rows[1].amountCents, 0);
  assert.match(result.rows[1].warnings.join(' '), /金额未识别/);
  assert.match(result.warnings.join(' '), /金额缺失/);
});

void test('unknown direction stays unresolved, Unicode negatives and grouped amounts are accepted', () => {
  const options = { year: 2025, imageHash: 'direction-fixture' };
  const unknown = parseCampusOcr('合成商户\n+10.00\n04-01 12:00', options);
  assert.equal(unknown.rows[0].suggestedKind, null);
  const unsigned = parseCampusOcr('合成商户\n10.00\n04-01 12:00', options);
  assert.equal(unsigned.rows[0].suggestedKind, null);
  const expense = parseCampusOcr(
    '充值金额 ¥200.00\n合成餐厅\n−1,234.56\n消费\n04-01\n12:00',
    options,
  );
  assert.equal(expense.rows.length, 1);
  assert.equal(expense.rows[0].amountCents, 123456);
  assert.equal(expense.rows[0].suggestedKind, 'expense');
  assert.equal(expense.rows[0].direction, '支出');
});
