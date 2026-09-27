import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseBillRows, parseMoney } from '../lib/finance-imports.ts';
import { emptyFinanceState } from '../lib/finance-types.ts';
const header = [
  '交易时间',
  '交易类型',
  '交易对方',
  '商品',
  '收/支',
  '金额(元)',
  '支付方式',
  '当前状态',
  '交易单号',
];
test('CSV handles BOM quoted comma newline and exact cents without binary rounding', () => {
  assert.deepEqual(parseCsv('\ufeffa,b\r\n"one,two","line\n2"'), [
    ['a', 'b'],
    ['one,two', 'line\n2'],
  ]);
  assert.equal(parseMoney('￥1,234.56'), 123456);
  assert.throws(() => parseMoney('1.001'));
  assert.throws(() => parseCsv('a,"broken'));
});
test('platform import keeps transfers and red packets unclassified, never auto creates meals', () => {
  const result = parseBillRows([
    ['微信支付账单'],
    header,
    [
      '2026-09-01 12:00:00',
      '商户消费',
      '演示商家',
      '午餐',
      '支出',
      '12.50',
      '银行卡',
      '支付成功',
      '42000000000001',
    ],
    [
      '2026-09-01 13:00:00',
      '转账',
      '演示对方',
      '代垫',
      '支出',
      '50',
      '零钱',
      '支付成功',
      '42000000000002',
    ],
    [
      '2026-09-02 13:00:00',
      '红包',
      '演示对方',
      '红包',
      '收入',
      '20',
      '零钱',
      '已存入零钱',
      '42000000000003',
    ],
  ]);
  assert.equal(result.platform, 'wechat');
  assert.equal(result.rows[0].suggestedKind, 'expense');
  assert.equal(result.rows[0].amountCents, 1250);
  assert.equal(result.rows[1].suggestedKind, null);
  assert.equal(result.rows[2].suggestedKind, null);
  assert.equal(result.rows[0].occurredAt, '2026-09-01T04:00:00.000Z');
  assert.equal('meal' in result.rows[0], false);
});
test('import preserves identifiers, refuses rounded numeric IDs and detects deleted source keys', () => {
  const state = emptyFinanceState('test', 'demo');
  state.transactions.push({
    id: 'old',
    version: 1,
    deleted: true,
    kind: 'expense',
    accountId: 'a',
    amountCents: 1250,
    personalCents: 1250,
    occurredAt: '2026-09-01T04:00:00Z',
    allocations: [],
    sourceKey: 'wechat:42000000000001',
  });
  const result = parseBillRows(
    [
      header,
      [
        '2026-09-01 12:00:00',
        '商户消费',
        '甲',
        '商品',
        '支出',
        '12.50',
        '卡',
        '支付成功',
        '42000000000001',
      ],
      [
        '2026-09-01 12:00:00',
        '商户消费',
        '甲',
        '商品',
        '支出',
        '12.50',
        '卡',
        '支付成功',
        Number('420000000000000001'),
      ],
    ],
    state,
  );
  assert.equal(result.rows[0].duplicateId, 'old');
  assert.equal(result.rows[1].sourceKey, undefined);
});
test('Alipay headers and invalid calendars are recognized without dropping malformed rows', () => {
  const result = parseBillRows([
    [
      '交易时间',
      '交易分类',
      '交易对方',
      '商品名称',
      '收/支',
      '金额',
      '收/付款方式',
      '交易状态',
      '交易订单号',
    ],
    [
      '2026-02-30 00:00:00',
      '餐饮',
      '甲',
      '商品',
      '支出',
      '9.90',
      '余额',
      '交易成功',
      '2026000000000001',
    ],
  ]);
  assert.equal(result.platform, 'alipay');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].occurredAt, '');
  assert.match(result.rows[0].warnings.join(' '), /时间/);
});

test('Alipay product-description export header preserves classification evidence', () => {
  const result = parseBillRows([
    [
      '交易时间',
      '交易分类',
      '交易对方',
      '商品说明',
      '收/支',
      '金额',
      '收/付款方式',
      '交易状态',
      '交易订单号',
    ],
    [
      '2026-09-01 12:00:00',
      '餐饮美食',
      '合成餐厅',
      '午餐套餐',
      '支出',
      '18.50',
      '余额',
      '交易成功',
      '20260901000001',
    ],
  ]);
  assert.equal(result.rows[0].description, '午餐套餐');
  assert.equal(result.rows[0].amountCents, 1850);
});
