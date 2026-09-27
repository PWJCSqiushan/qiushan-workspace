import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAmountCandidates,
  normalizeOcrText,
} from '../lib/finance-ocr.ts';

test('normalizes full-width currency and digits', () => {
  assert.equal(normalizeOcrText('实付：￥１８．５０'), '实付：¥18.50');
});

test('returns the payment amount as a candidate', () => {
  const candidates = extractAmountCandidates(
    '订单金额 ¥20.00\n优惠 -¥1.50\n实付 ¥18.50',
  );
  assert.ok(candidates.some((candidate) => candidate.cents === 1850));
  assert.ok(candidates.some((candidate) => candidate.label.includes('实付')));
});

test('keeps multiple plausible amounts and does not choose the largest', () => {
  const candidates = extractAmountCandidates(
    '商品 A ¥18.50\n商品 B ¥32.00\n合计 ¥50.50',
  );
  assert.deepEqual(
    candidates.slice(0, 3).map((candidate) => candidate.cents),
    [5050, 1850, 3200],
  );
  assert.equal(candidates[0].cents, 5050);
  assert.ok(candidates.length >= 3);
});

test('rejects dates, percentages and long transaction IDs', () => {
  const candidates = extractAmountCandidates(
    '2026-09-24 18:30\n优惠 20%\n交易号 202609241830123456\n实付 18.50',
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.cents),
    [1850],
  );
});

test('limits candidates to six and preserves strong financial labels', () => {
  const text = [
    '实付 18.50',
    '合计 20.00',
    '支付 21.00',
    '小计 22.00',
    '金额 23.00',
    '¥24.00',
    '¥25.00',
    '¥26.00',
  ].join('\n');
  const candidates = extractAmountCandidates(text);
  assert.equal(candidates.length, 6);
  assert.equal(candidates[0].cents, 1850);
  assert.equal(candidates[1].cents, 2100);
  assert.ok(candidates.some((candidate) => candidate.cents === 2000));
});

test('thousands separators and uppercase payment labels preserve the amount', () => {
  assert.equal(extractAmountCandidates('PAID ¥1,234.50')[0].cents, 123450);
  assert.equal(extractAmountCandidates('实付 ¥0.00')[0].cents, 0);
});
