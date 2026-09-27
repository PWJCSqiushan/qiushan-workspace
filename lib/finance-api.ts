import { body, json } from './http.ts';
import { AppError } from './workspace.ts';
import { FinanceStore, FinanceConflictError } from './finance-store.ts';
import {
  exportFinanceBackup,
  validateFinanceBackup,
  restoreFinanceBackup,
} from './finance-backup.ts';
import type { FinanceSpace } from './finance-types.ts';
const spaceOf = (v: unknown): FinanceSpace => {
  if (v !== 'personal' && v !== 'demo') throw new AppError('账本空间无效');
  return v;
};
export function financeFailure(error: unknown) {
  if (error instanceof AppError)
    return json(
      {
        error: error.message,
        code:
          error instanceof FinanceConflictError
            ? 'FINANCE_CONFLICT'
            : undefined,
      },
      error.status,
    );
  console.error(
    JSON.stringify({
      code: 'FINANCE_REQUEST_FAILED',
      name: error instanceof Error ? error.name : 'unknown',
    }),
  );
  return json({ error: '账本服务暂时不可用，修改保留在本机，请重试' }, 500);
}
export async function financeRoute(request: Request) {
  try {
    const { identity } = await import('./auth.ts');
    const { env } = await import('cloudflare:workers');
    const user = await identity(request);
    // Explicit local test input only; never expose private fixture files on a deployed worker.
    if (
      new URL(request.url).pathname === '/api/finance/preview-review' &&
      request.method === 'GET'
    ) {
      const binding = env as typeof env & { FINANCE_PREVIEW_REVIEW?: string };
      const fixture =
        env.AUTH_MODE === 'local' &&
        new URL(request.url).searchParams.get('space') === 'demo' &&
        binding.FINANCE_PREVIEW_REVIEW
          ? JSON.parse(binding.FINANCE_PREVIEW_REVIEW)
          : { sessions: [] };
      return json(
        new URL(request.url).searchParams.get('asset') === 'campus'
          ? { campusImages: fixture.campusImages || [] }
          : { id: fixture.id, sessions: fixture.sessions || [] },
      );
    }
    return await handleFinanceRequest(
      request,
      new FinanceStore(env.DB, user.owner),
    );
  } catch (error) {
    return financeFailure(error);
  }
}
export async function handleFinanceRequest(
  request: Request,
  store: FinanceStore,
) {
  const u = new URL(request.url),
    action = u.pathname.split('/').filter(Boolean).slice(2).join('/'),
    method = request.method;
  if (method === 'GET') {
    const space = spaceOf(u.searchParams.get('space') || 'personal');
    if (action === 'sync' || !action)
      return json(
        await store.sync(space, Number(u.searchParams.get('cursor') || 0)),
      );
    if (action === 'stats') {
      const from = u.searchParams.get('from') || '',
        to = u.searchParams.get('to') || '',
        meal = u.searchParams.get('meal') || 'all';
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
        from >= to ||
        !['all', 'breakfast', 'lunch', 'dinner'].includes(meal)
      )
        throw new AppError('统计日期或餐次无效');
      return json(
        await store.stats(space, {
          from,
          to,
          meal: meal as 'all' | 'breakfast' | 'lunch' | 'dinner',
        }),
      );
    }
    if (action === 'export')
      return json(await exportFinanceBackup(store, space));
  }
  if (method === 'POST') {
    const input = (await body(
      request,
      action === 'restore' ? 25_000_000 : 4_000_000,
    )) as Record<string, unknown>;
    if (action === 'mutations' || action === 'import')
      return json(await store.mutate(input));
    if (action === 'restore') {
      const backup = await validateFinanceBackup(input.backup, store.owner),
        space = spaceOf(input.space || backup.space);
      if (space !== backup.space) throw new AppError('备份所属空间不一致');
      const current = await store.snapshot(space);
      if (input.confirm !== true)
        return json({
          preview: true,
          currentVersion: current.version,
          incoming: {
            accounts: backup.state.accounts.length,
            transactions: backup.state.transactions.length,
            meals: backup.state.meals.length,
          },
          current: {
            accounts: current.accounts.length,
            transactions: current.transactions.length,
            meals: current.meals.length,
          },
          sha256: backup.sha256,
        });
      return json(
        await restoreFinanceBackup(
          store,
          backup,
          typeof input.operationId === 'string' ? input.operationId : '',
          Number(input.expectedVersion),
        ),
      );
    }
  }
  return json({ error: '账本接口不存在' }, 404);
}
