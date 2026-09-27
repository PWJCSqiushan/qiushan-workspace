import { financeMessage } from './finance-messages.ts';
import {
  localGet,
  localPut,
  localList,
  localRemove,
  localReplace,
} from './device-db.ts';
import { applyFinanceMutation } from './finance-domain.ts';
import {
  emptyFinanceState,
  applyFinancePatches,
  type FinanceMutation,
  type FinanceReceipt,
  type FinanceSpace,
  type FinanceState,
  type FinanceSync,
  type FinanceEntity,
} from './finance-types.ts';
export type PendingFinance = {
  operationId: string;
  baseVersion: number;
  mutation: FinanceMutation;
  state: 'queued' | 'conflict' | 'failed';
  error?: string;
  createdAt: string;
};
export type FinanceSaveResult = { state: 'synced' | 'queued'; message: string };
type Session = { owner: string; expiresAt: number };
type Cache = { state: FinanceState; cursor: number };
export class FinanceRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export async function financeRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...init,
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new FinanceRequestError(
      [0, 301, 302, 303, 307, 308, 401].includes(response.status)
        ? '登录已失效，草稿仍保留在本机'
        : `账本服务响应异常（HTTP ${response.status}），修改保留，稍后重试`,
      [0, 301, 302, 303, 307, 308, 401].includes(response.status)
        ? 401
        : response.status || 503,
    );
  let body: Record<string, unknown>;
  try {
    body = await response.json();
  } catch {
    throw new FinanceRequestError('账本服务返回不完整，修改保留在本机', 502);
  }
  if (!response.ok)
    throw new FinanceRequestError(
      financeMessage(body.error || '账本请求失败'),
      response.status,
      body,
    );
  return body as T;
}

export class FinanceClient {
  data: FinanceState | null = null;
  pending: PendingFinance[] = [];
  reviewCount = 0;
  private fileReviewCount = 0;
  private campusReviewCount = 0;
  message = '正在连接账本';
  blocked = false;
  session: Session | null = null;
  private confirmed: FinanceState | null = null;
  private cursor = 0;
  private running: Promise<void> | null = null;
  private editing: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    public space: FinanceSpace,
    private notify: () => void,
  ) {}
  private prefix() {
    return this.session?.owner + '/' + this.space;
  }
  private emit() {
    if (!this.stopped) this.notify();
  }
  private edit<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.editing.then(fn);
    this.editing = p.catch(() => {});
    return p;
  }
  private async loadPending() {
    this.pending = (
      await localList<PendingFinance>('finance/outbox/' + this.prefix() + '/')
    )
      .map((r) => r.value)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) ||
          a.operationId.localeCompare(b.operationId),
      );
  }
  private render() {
    if (!this.confirmed) {
      this.data = null;
      return;
    }
    let state = this.confirmed;
    for (const p of this.pending.filter((p) => p.state === 'queued')) {
      if (p.mutation.type === 'undo' || p.mutation.type === 'redo') continue;
      try {
        state = applyFinancePatches(
          state,
          applyFinanceMutation(state, p.mutation, new Date(p.createdAt))
            .changes,
          state.version,
        );
      } catch {
        /* Confirmed server data stays visible if a draft conflicts. */
      }
    }
    this.data = state;
    this.emit();
  }
  private async persist() {
    if (this.confirmed)
      await localPut('finance/cache/' + this.prefix(), {
        state: this.confirmed,
        cursor: this.cursor,
      } satisfies Cache);
  }
  async start() {
    try {
      this.session = await financeRequest<Session>('/api/session');
      await localPut('finance/session/' + this.space, this.session);
    } catch (e) {
      if (e instanceof FinanceRequestError && e.status === 401) {
        this.blocked = true;
        this.message = e.message;
        this.emit();
        return;
      }
      this.blocked = true;
      this.message = '请联网确认当前登录身份，本机账本和待同步修改完整保留';
      this.emit();
      return;
    }
    const cache = await localGet<Cache>('finance/cache/' + this.prefix());
    this.confirmed =
      cache?.state || emptyFinanceState(this.session.owner, this.space);
    this.cursor = cache?.cursor || 0;
    await this.loadPending();
    this.render();
    await this.sync();
    await this.loadImportReview();
    await this.refreshReviewCounts();
    if (typeof window !== 'undefined' && !this.stopped) {
      this.timer = setInterval(() => void this.sync(), 30000);
      window.addEventListener('online', this.onOnline);
    }
  }
  private onOnline = () => {
    void this.sync();
  };
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (typeof window !== 'undefined')
      window.removeEventListener('online', this.onOnline);
  }
  async saveRecoveryBackup(value: unknown) {
    if (!this.session) throw new Error('请先登录');
    await localPut('finance/recovery/' + this.prefix(), value);
  }
  async recoveryBackup<T>() {
    return this.session
      ? localGet<T>('finance/recovery/' + this.prefix())
      : undefined;
  }
  async saveDraft(value: unknown) {
    this.countImportReviews(value);
    this.emit();
    if (this.session) await localPut('finance/draft/' + this.prefix(), value);
  }
  async draft<T>() {
    return this.session
      ? localGet<T>('finance/draft/' + this.prefix())
      : undefined;
  }
  private countImportReviews(value: unknown) {
    const v = value as
      | {
          kind?: string;
          sessions?: {
            rows?: { id: string }[];
            reviews?: Record<string, { done?: boolean }>;
          }[];
        }
      | undefined;
    this.fileReviewCount =
      v?.kind === 'finance-imports'
        ? (v.sessions || []).reduce(
            (sum, session) =>
              sum +
              (session.rows || []).filter(
                (row) => !session.reviews?.[row.id]?.done,
              ).length,
            0,
          )
        : 0;
    this.reviewCount = this.fileReviewCount + this.campusReviewCount;
  }
  async refreshReviewCounts() {
    if (!this.session) return;
    const sessions = await localGet<
      { rows: { id: string }[]; reviews: Record<string, { done?: boolean }> }[]
    >('finance/campus-drafts/' + this.prefix());
    this.campusReviewCount = (sessions || []).reduce(
      (sum, s) => sum + s.rows.filter((r) => !s.reviews[r.id]?.done).length,
      0,
    );
    this.countImportReviews(await this.draft());
    this.emit();
  }
  async copyDemoReviewDrafts() {
    if (this.space !== 'personal' || !this.session || !this.data)
      throw new Error('请先打开个人账本');
    if (this.pending.length) throw new Error('请先完成当前待同步修改');
    const demo = await financeRequest<{ state: FinanceState }>(
      '/api/finance/export?space=demo',
    );
    const ids = new Set(this.data.transactions.map((t) => t.id));
    if (
      !demo.state.transactions.length ||
      demo.state.transactions.some((t) => !ids.has(t.id))
    )
      throw new Error('先完成演示流水迁入，再复制关联核对草稿');
    const source = this.session.owner + '/demo';
    const keys = ['finance/draft/', 'finance/campus-drafts/'];
    const copies: { key: string; value: unknown }[] = [];
    for (const key of keys) {
      const value = await localGet<unknown>(key + source);
      if (!value) continue;
      const current = await localGet<unknown>(key + this.prefix());
      if (current && JSON.stringify(current) !== JSON.stringify(value))
        throw new Error('个人账本已有不同核对草稿，已保留，请先核对');
      copies.push({ key: key + this.prefix(), value });
    }
    if (!copies.length) throw new Error('本机没有可复制的演示核对草稿');
    await localPut('finance/archive/promotion-drafts/' + this.prefix(), copies);
    for (const copy of copies) await localPut(copy.key, copy.value);
    await this.refreshReviewCounts();
  }
  private async loadImportReview() {
    const previous = await this.draft<unknown>();
    this.countImportReviews(previous);
    this.emit();
    if (
      this.space !== 'demo' ||
      typeof window === 'undefined' ||
      !['127.0.0.1', 'localhost'].includes(window.location.hostname)
    )
      return;
    try {
      const seed = await financeRequest<{ id?: string; sessions?: unknown[] }>(
        '/api/finance/preview-review?space=demo',
      );
      if (!seed.id || !Array.isArray(seed.sessions)) return;
      const marker = 'finance/review-seed/' + this.prefix();
      if ((await localGet(marker)) === seed.id) return;
      if (previous)
        await localPut(
          'finance/archive/import-drafts/' + this.prefix() + '/' + seed.id,
          previous,
        );
      await this.saveDraft({
        kind: 'finance-imports',
        sessions: seed.sessions,
      });
      await localPut(marker, seed.id);
    } catch {
      // A missing optional local test fixture must not block ledger synchronization.
    }
  }
  private async refresh() {
    if (!this.session) return;
    let more = true,
      staged =
        this.confirmed || emptyFinanceState(this.session.owner, this.space),
      cursor = this.cursor;
    while (more) {
      const page = await financeRequest<FinanceSync>(
        '/api/finance/sync?space=' + this.space + '&cursor=' + cursor,
      );
      if (
        !Number.isSafeInteger(page.cursor) ||
        page.cursor < cursor ||
        (page.hasMore && page.cursor <= cursor) ||
        !Number.isSafeInteger(page.version) ||
        !Array.isArray(page.changes) ||
        !Array.isArray(page.history)
      )
        throw new FinanceRequestError('账本同步响应无效，修改保留在本机', 502);
      if (page.owner !== this.session.owner || page.space !== this.space)
        throw new FinanceRequestError('登录身份改变，原账本草稿已保留', 401);
      if (page.reset)
        staged = emptyFinanceState(this.session.owner, this.space);
      staged = applyFinancePatches(staged, page.changes, page.version);
      staged.history = page.history;
      cursor = page.cursor;
      more = page.hasMore;
    }
    // Do not expose or persist a half-loaded dependency graph between delta pages.
    this.confirmed = staged;
    this.cursor = cursor;
    await this.persist();
    this.render();
  }
  serverData() {
    return this.confirmed ? structuredClone(this.confirmed) : null;
  }

  async enqueue(mutation: FinanceMutation): Promise<FinanceSaveResult> {
    let id = '';
    await this.edit(async () => {
      if (!this.session || this.blocked || !this.data)
        throw new Error('请先登录并加载账本');
      await this.loadPending();
      if (
        (mutation.type === 'undo' || mutation.type === 'redo') &&
        this.pending.length
      )
        throw new Error('请先处理待同步修改，再撤销或恢复');
      if (mutation.type !== 'undo' && mutation.type !== 'redo') {
        try {
          applyFinanceMutation(this.data, mutation, new Date());
        } catch (error) {
          throw new Error(financeMessage(error));
        }
      }
      id = crypto.randomUUID();
      const item: PendingFinance = {
        operationId: id,
        baseVersion: this.confirmed?.version || 0,
        mutation,
        state: 'queued',
        createdAt: new Date(
          Math.max(
            Date.now(),
            Date.parse(this.pending.at(-1)?.createdAt || '') + 1 || 0,
          ),
        ).toISOString(),
      };
      await localPut('finance/outbox/' + this.prefix() + '/' + id, item);
      await this.loadPending();
      this.message = '已保存到本机 · 等待同步';
      this.render();
    });
    await Promise.race([
      this.sync(),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ]);
    const p = this.pending.find((x) => x.operationId === id);
    if (p && p.state !== 'queued')
      throw new Error(p.error || '记录需要核对，已保留草稿');
    return p
      ? { state: 'queued', message: p.error || this.message }
      : { state: 'synced', message: '已保存' };
  }
  async sync() {
    if (this.running) return this.running;
    if (!this.session || this.blocked || this.stopped) return;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  private async run() {
    try {
      while (!this.stopped) {
        await this.edit(() => this.loadPending());
        const p = this.pending[0];
        if (!p || p.state !== 'queued') break;
        try {
          const receipt = await financeRequest<FinanceReceipt>(
            '/api/finance/mutations',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                space: this.space,
                operationId: p.operationId,
                baseVersion: p.baseVersion,
                mutation: p.mutation,
              }),
            },
          );
          if (
            receipt.operationId !== p.operationId ||
            !Number.isSafeInteger(receipt.version) ||
            !Array.isArray(receipt.changes)
          )
            throw new FinanceRequestError(
              '账本回执不完整，稍后用原操作重试',
              502,
            );
          await this.edit(async () => {
            if (receipt.version >= this.confirmed!.version)
              this.confirmed = applyFinancePatches(
                this.confirmed!,
                receipt.changes,
                receipt.version,
              );
            if (
              receipt.history &&
              !this.confirmed!.history.some((h) => h.id === receipt.history!.id)
            )
              this.confirmed!.history = [
                ...this.confirmed!.history,
                receipt.history,
              ];
            await this.persist();
            await localRemove(
              'finance/outbox/' + this.prefix() + '/' + p.operationId,
            );
            await this.loadPending();
            this.render();
          });
        } catch (error) {
          p.error = financeMessage(error);
          if (
            error instanceof FinanceRequestError &&
            error.status < 500 &&
            ![401, 408, 429].includes(error.status)
          )
            p.state = error.status === 409 ? 'conflict' : 'failed';
          await localPut(
            'finance/outbox/' + this.prefix() + '/' + p.operationId,
            p,
          );
          throw error;
        }
      }
      await this.refresh();
      this.message = this.pending.length
        ? '有修改需要核对，草稿已保留'
        : '已同步 · 账本版本 ' + this.confirmed?.version;
    } catch (error) {
      if (error instanceof FinanceRequestError && error.status === 401) {
        this.blocked = true;
        this.data = null;
      }
      this.message =
        error instanceof Error ? error.message : '同步暂不可用，修改已保留';
      if (error instanceof FinanceRequestError && error.status === 409) {
        try {
          await this.refresh();
        } catch {
          /* Retain original conflict. */
        }
      }
    } finally {
      await this.edit(() => this.loadPending());
      if (!this.blocked) this.render();
      this.emit();
    }
  }
  async resolve(id: string, retry: boolean) {
    if (this.running) await this.running;
    await this.edit(async () => {
      await this.loadPending();
      const item = this.pending.find((p) => p.operationId === id);
      if (!item || !this.confirmed || item.state === 'queued') return;
      if (!retry) {
        await localPut('finance/archive/' + this.prefix() + '/' + id, item);
        await localRemove('finance/outbox/' + this.prefix() + '/' + id);
      } else {
        await this.refresh();
        const versions = new Map<string, number>();
        const rebase = (m: FinanceMutation): FinanceMutation => {
          if (m.type === 'batch')
            return {
              ...m,
              mutations: m.mutations.map(rebase) as typeof m.mutations,
            };
          if (
            m.type === 'put' ||
            m.type === 'delete' ||
            m.type === 'saveTransaction'
          ) {
            const collection =
                m.type === 'saveTransaction' ? 'transactions' : m.collection,
              entityId =
                m.type === 'put'
                  ? m.entity.id
                  : m.type === 'saveTransaction'
                    ? m.transaction.id
                    : m.id;
            const key = collection + '/' + entityId,
              v =
                versions.get(key) ??
                ((this.confirmed![collection] as FinanceEntity[]).find(
                  (e) => e.id === entityId,
                )?.version ||
                  0);
            versions.set(key, v + 1);
            return { ...m, expectedVersion: v };
          }
          return m;
        };
        const next: PendingFinance = {
          ...item,
          operationId: crypto.randomUUID(),
          baseVersion: this.confirmed!.version,
          mutation: rebase(item.mutation),
          state: 'queued',
          error: undefined,
        };
        await localReplace(
          'finance/outbox/' + this.prefix() + '/' + id,
          'finance/outbox/' + this.prefix() + '/' + next.operationId,
          next,
          'finance/archive/' + this.prefix() + '/' + id,
          item,
        );
      }
      await this.loadPending();
      this.render();
    });
    await this.sync();
  }
}
