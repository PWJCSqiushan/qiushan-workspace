import { build } from 'esbuild';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('work/pdf-sample', { recursive: true });
mkdirSync('output/pdf', { recursive: true });
await build({ entryPoints: ['components/finance-report-pdf.tsx'], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: 'work/pdf-sample/renderer.mjs', jsx: 'automatic' });
const { FinanceReportDocument, registerReportFont } = await import('../work/pdf-sample/renderer.mjs');
const { default: React } = await import('react');
const { renderToFile } = await import('@react-pdf/renderer');
const { buildFinanceReport } = await import('../lib/finance-report-data.ts');
const { makeFinanceReportFixture, REPORT_FIXTURE_RANGE, REPORT_FIXTURE_METADATA } = await import('../tests/fixtures/finance-report-fixture.ts');
const { richReportFixture } = await import('./finance-pdf-fixtures.ts');
registerReportFont(resolve('public/fonts/QiushanReportSans-Regular.ttf'));
const report = buildFinanceReport(richReportFixture(), REPORT_FIXTURE_RANGE, { ...REPORT_FIXTURE_METADATA, pendingCount: 0 });
writeFileSync('output/pdf/sample-data.json', JSON.stringify(report, null, 2));
await renderToFile(React.createElement(FinanceReportDocument, { report }), 'output/pdf/生活账本-合成样稿.pdf');
console.log('Rendered synthetic sample:', report.personalCents, report.expenseCount);
// Render actual edge-case documents as well as business-data tests.
const empty = makeFinanceReportFixture(); empty.transactions = [];
const three = makeFinanceReportFixture(); three.transactions = three.transactions.filter(t => ['food-main','rail-ticket','monthly-rent'].includes(t.id));
const five = makeFinanceReportFixture(); five.transactions = five.transactions.filter(t => ['food-main','rail-ticket','monthly-rent','race-entry','book-purchase'].includes(t.id));
const refunded = makeFinanceReportFixture(); refunded.transactions = refunded.transactions.filter(t => t.id === 'food-main');
refunded.transactions.push({ id:'full-refund',version:1,kind:'refund',occurredAt:'2026-10-02T12:00:00+08:00',accountId:'wallet',amountCents:4500,personalCents:4500,relatedId:'food-main',allocations:[{id:'full-refund-a',categoryId:'life-meal',content:'全额退款',nature:'daily',amountCents:4500,refundOfAllocationId:'food-main-allocation'}] });
const negative = makeFinanceReportFixture(); negative.transactions = negative.transactions.filter(t => ['food-main','unmapped-refund'].includes(t.id));
for (const [name, state] of [['empty', empty], ['sparse', makeFinanceReportFixture()], ['three',three],['five',five],['refunded',refunded],['negative',negative]]) {
  if (name === 'sparse') state.transactions = state.transactions.filter(t => t.id === 'food-main');
  const edgeReport = buildFinanceReport(state, REPORT_FIXTURE_RANGE, { ...REPORT_FIXTURE_METADATA, pendingCount: 0 });
  await renderToFile(React.createElement(FinanceReportDocument, { report: edgeReport }), `output/pdf/qa-${name}.pdf`);
}
