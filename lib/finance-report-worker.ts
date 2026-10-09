import { renderFinanceReport } from '../components/finance-report-pdf';
import type { FinanceReport } from './finance-report-data';

self.onmessage = async (event: MessageEvent<{ report: FinanceReport; origin: string }>) => {
  try {
    self.postMessage({ status: 'rendering' });
    const blob = await renderFinanceReport(event.data.report, event.data.origin);
    self.postMessage({ status: 'done', blob });
  } catch (error) {
    self.postMessage({ status: 'error', message: error instanceof Error ? error.message : 'PDF生成失败' });
  }
};
