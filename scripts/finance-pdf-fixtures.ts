import { makeFinanceReportFixture } from '../tests/fixtures/finance-report-fixture.ts';
import type { FinanceState } from '../lib/finance-types.ts';

/** Synthetic only. Rich enough to exercise both bounded legends and wrapping. */
export function richReportFixture(): FinanceState {
  const state = makeFinanceReportFixture();
  for (const [i, name] of ['电子工具与订阅', '旅行与其他体验'].entries())
    state.categories.push({ id: 'extra-' + i, version: 1, name, level: 1, parentId: null });
  const roots = state.categories.filter(c => c.level === 1);
  for (const [i, root] of roots.entries()) {
    if (i === 0) root.name = '日常生活与长期生活用品补充';
    for (let j = 0; j < 7; j++) {
      const sub = `${root.id}-sample-sub-${j}`, leaf = sub + '-leaf';
      state.categories.push({ id: sub, version: 1, name: j === 2 ? '较长中文次用途名称用于换行检查' : ['基础需求', '日常补充', '', '定期服务', '用品维护', '临时采购', '其他需求'][j], parentId: root.id, level: 2 });
      state.categories.push({ id: leaf, version: 1, name: '合成明细分类', parentId: sub, level: 3 });
      const amount = Math.round((9 - i) * (7 - j) * 113.7);
      state.transactions.push({ id: leaf + '-expense', version: 1, kind: 'expense', occurredAt: `2026-09-${String(j * 3 + 3).padStart(2,'0')}T12:00:00+08:00`, accountId: 'wallet', amountCents: amount, personalCents: amount, counterparty: '合成商户与较长说明文字用于重点明细截短检查', analysisOnly: true, allocations: [{ id: leaf + '-allocation', categoryId: leaf, content: '合成样稿', nature: 'daily', amountCents: amount }] });
    }
  }
  return state;
}
