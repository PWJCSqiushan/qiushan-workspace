import { sha256, stable } from './protocol.ts';
import {buildInvestmentAdvice} from './investment-advisor.ts';
import {
  DEFAULT_PROFILE,
  InvestmentConflictError,
  InvestmentValidationError,
  SYNTHETIC_DEMO_INSTRUMENTS,
  emptyInvestmentState,
  freshness,
  summarizeInvestment,
  todayShanghai,
  contextId,
  validateState,
} from './investment-domain.ts';
import type { InvestmentSpace, InvestmentState, Instrument, Job, Market, Snapshot, SourceHealth } from './investment-domain.ts';

export type InvestmentMarketProvider = {
  fetchInvestmentSnapshot?: (
    instrument: Instrument,
    previous?: Snapshot,
  ) => Promise<Snapshot | null> | Snapshot | null;
  searchInvestmentInstruments?: (
    query: string,
  ) => Promise<Instrument[]> | Instrument[];
  refreshInvestmentMarket?: (
    previous: Market | null,
  ) => Promise<Market | null> | Market | null;
  investmentSeeds?: () => Promise<Instrument[]> | Instrument[];
};

export type InvestmentMutationReceipt<T = Record<string, unknown>> = T & {
  operation_id: string;
  version: number;
};

type StateRow = {
  version: number;
  state_json: string;
  updated_at: string;
};
type OperationRow = {
  request_hash: string;
  result_json: string;
  result_version: number;
};
type BackupRow = {
  name: string;
  version: number;
  payload_json: string;
  sha256: string;
  created_at: string;
};

const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const namePattern = /^\d{8}-\d{6}-[a-f0-9]{8}\.json$/;

function spaceCheck(value: unknown): asserts value is InvestmentSpace {
  if (value !== 'personal' && value !== 'demo') throw new InvestmentValidationError('工作区无效');
}

function versionCheck(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InvestmentValidationError('账本版本无效');
}

function now() {
  return new Date().toISOString();
}

function jobSummary(job: Job) {
  return structuredClone(job);
}

function freshMarket(market: Market | null, nowValue = new Date()) {
  if (!market) return null;
  const next = structuredClone(market);
  if (next.status === 'fresh' && next.date && next.date.slice(0, 10) !== todayShanghai(nowValue)) next.status = 'stale';
  return next;
}

async function withTimeout<T>(value: Promise<T> | T, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('市场采集超时')), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class InvestmentStore {
  constructor(
    public db: D1Database,
    public owner: string,
    public marketProvider: InvestmentMarketProvider | null = null,
  ) {
    if (!owner || owner.length > 200) throw new InvestmentValidationError('身份无效', 401);
  }

  q(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).bind(...args);
  }

  async ensure(space: InvestmentSpace) {
    spaceCheck(space);
    const seedState = emptyInvestmentState(this.owner, space);
    await this.q(
      'INSERT OR IGNORE INTO investment_states(owner_id,space,version,state_json,updated_at) VALUES(?,?,?,?,?)',
      this.owner,
      space,
      0,
      JSON.stringify(seedState),
      now(),
    ).run();
  }

  private async row(space: InvestmentSpace) {
    await this.ensure(space);
    return (await this.q(
      'SELECT version,state_json,updated_at FROM investment_states WHERE owner_id=? AND space=?',
      this.owner,
      space,
    ).first<StateRow>())!;
  }

  async snapshot(space: InvestmentSpace): Promise<InvestmentState> {
    spaceCheck(space);
    const row = await this.row(space);
    let state: InvestmentState;
    try {
      state = JSON.parse(row.state_json) as InvestmentState;
    } catch {
      throw new InvestmentValidationError('投资状态无法读取', 500);
    }
    state.owner = this.owner;
    state.space = space;
    state.version = Number(row.version);
    if (!state.profile) state.profile = { ...DEFAULT_PROFILE };
    state.instruments ||= [];
    state.snapshots ||= {};
    state.plans ||= [];
    state.transactions ||= [];
    state.reports ||= [];
    state.jobs ||= [];
    state.source_health ||= [];
    state.observations ||= [];
    state.exports ||= {};
    const bindings=await this.q('SELECT snapshot_id,binding_json FROM investment_export_bindings WHERE owner_id=? AND space=?',this.owner,space).all<{snapshot_id:string;binding_json:string}>();
    for(const binding of bindings.results)state.exports[binding.snapshot_id]=JSON.parse(binding.binding_json);
    state.snapshots = Object.fromEntries(Object.entries(state.snapshots).map(([id, snapshot]) => [id, freshness(snapshot)!]));
    state.market = freshMarket(state.market);
    validateState(state);
    return state;
  }

  async version(space: InvestmentSpace) {
    return (await this.snapshot(space)).version;
  }

  private async priorOperation(space: InvestmentSpace, operationId: string, requestHash: string) {
    const row = await this.q(
      'SELECT request_hash,result_json,result_version FROM investment_operations WHERE owner_id=? AND space=? AND operation_id=?',
      this.owner,
      space,
      operationId,
    ).first<OperationRow>();
    if (!row) return null;
    if (row.request_hash !== requestHash) throw new InvestmentConflictError('同一operation_id不能用于不同内容');
    if (!row.result_json || row.result_version < 0) return null;
    try {
      return JSON.parse(row.result_json) as Record<string, unknown>;
    } catch {
      throw new InvestmentValidationError('幂等收据无法读取', 500);
    }
  }

  async mutate<T extends Record<string, unknown>>(
    space: InvestmentSpace,
    input: { base_version: number; operation_id: string; [key: string]: unknown },
    apply: (state: InvestmentState) => T | Promise<T>,
    options: { backupBefore?: boolean; replaceExportBindings?:boolean } = {},
  ): Promise<InvestmentMutationReceipt<T>> {
    spaceCheck(space);
    versionCheck(input?.base_version);
    if (!idPattern.test(input?.operation_id || '')) throw new InvestmentValidationError('operation_id无效');
    const requestHash = await sha256({ space, payload: input });
    const previousResult = await this.priorOperation(space, input.operation_id, requestHash);
    if (previousResult) return previousResult as InvestmentMutationReceipt<T>;
    const before = await this.snapshot(space);
    if (before.version !== input.base_version) throw new InvestmentConflictError(undefined, before);
    if (options.backupBefore) await this.createBackup(space);
    const draft = structuredClone(before);
    const result = await apply(draft);
    draft.owner = this.owner;
    draft.space = space;
    draft.version = before.version + 1;
    validateState(draft);
    const resultValue = { ...result, operation_id: input.operation_id, version: draft.version } as InvestmentMutationReceipt<T>;
    const resultText = JSON.stringify(resultValue);
    try {
      const stateText = JSON.stringify(draft);
      // Keep the CAS update and its idempotency receipt in one D1 batch. The
      // CASE/NOT NULL guard makes a zero-row version update abort the batch,
      // so a stale writer cannot leave a committed state without a receipt.
      const statements=[
        this.q(
          'UPDATE investment_states SET version=?,state_json=?,updated_at=? WHERE owner_id=? AND space=? AND version=?',
          draft.version,
          stateText,
          now(),
          this.owner,
          space,
          before.version,
        ),
        this.q(
          'INSERT INTO investment_operations(owner_id,space,operation_id,request_hash,result_json,result_version,created_at) SELECT CASE WHEN changes()=1 THEN ? ELSE NULL END,?,?,?,?,?,?',
          this.owner,
          space,
          input.operation_id,
          requestHash,
          resultText,
          draft.version,
          now(),
        ),
      ];
      if(options.replaceExportBindings)statements.push(this.q('DELETE FROM investment_export_bindings WHERE owner_id=? AND space=?',this.owner,space));
      await this.db.batch(statements);
    } catch (error) {
      const replay = await this.priorOperation(space, input.operation_id, requestHash);
      if (replay) return replay as InvestmentMutationReceipt<T>;
      const latest = await this.snapshot(space);
      if (latest.version !== before.version) throw new InvestmentConflictError(undefined, latest);
      throw error;
    }
    const receipt = await this.priorOperation(space, input.operation_id, requestHash);
    if (!receipt) throw new InvestmentValidationError('投资操作收据写入失败', 500);
    return receipt as InvestmentMutationReceipt<T>;
  }

  async readBootstrap(space: InvestmentSpace) {
    const state = await this.snapshot(space);
    const snapshots = state.snapshots;
    const market = state.market;
    const reports = state.reports.map((report) => {
      const currentSnapshot = report.report_type === 'market' ? market : snapshots[report.instrument_id || ''];
      return {
        ...report,
        is_stale: report.snapshot_id !== currentSnapshot?.snapshot_id || currentSnapshot?.status !== 'fresh' || report.context_id !== contextId(state),
      };
    });
    return {
      profile: state.profile,
      instruments: state.instruments.filter(x=>x.watched!==false),
      snapshots,
      opening: state.opening,
      account_context: state.account_context,
      market,
      plans: state.plans,
      reports,
      transactions: state.transactions,
      portfolio: summarizeInvestment({ ...state, snapshots }),
      jobs: [...state.jobs].reverse().slice(0, 10),
      source_health: state.source_health,
      advice:await buildInvestmentAdvice(state),
      version: state.version,
      space,
      sample_notice: state.sample_notice,
    };
  }

  async search(space: InvestmentSpace, query: string) {
    const state = await this.snapshot(space);
    const q = query.trim().slice(0, 80);
    if (!q) return state.instruments;
    if (this.marketProvider?.searchInvestmentInstruments) {
      const provided = await this.marketProvider.searchInvestmentInstruments(q);
      return provided.filter((x) => x && x.id && x.code && x.name).slice(0, 100);
    }
    const lower = q.toLowerCase();
    return state.instruments.filter((x) => x.id.toLowerCase() === lower || x.code === q || x.name.toLowerCase().includes(lower)).slice(0, 100);
  }

  async seeds(space: InvestmentSpace) {
    if (this.marketProvider?.investmentSeeds) {
      const values = await this.marketProvider.investmentSeeds();
      if (space === 'demo') return values.filter((x) => x.id.startsWith('demo:') || x.name.includes('合成')).slice(0, 100);
    }
    return space === 'demo' ? SYNTHETIC_DEMO_INSTRUMENTS : [];
  }

  async createBackup(space: InvestmentSpace, suppliedName?: string) {
    const state = await this.snapshot(space);
    const payload = JSON.stringify({ owner: this.owner, space, version: state.version, state });
    const digest = await sha256(payload);
    const name = suppliedName || `${todayShanghai().replaceAll('-', '')}-${new Date().toISOString().slice(11, 19).replaceAll(':', '')}-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}.json`;
    if (!namePattern.test(name)) throw new InvestmentValidationError('备份名称无效');
    await this.q(
      'INSERT INTO investment_backups(owner_id,space,name,version,payload_json,sha256,created_at) VALUES(?,?,?,?,?,?,?)',
      this.owner,
      space,
      name,
      state.version,
      payload,
      digest,
      now(),
    ).run();
    return { name, created_at: now(), bytes: new TextEncoder().encode(payload).byteLength, version: state.version, sha256: digest };
  }

  async backups(space: InvestmentSpace) {
    const rows = await this.q(
      'SELECT name,version,sha256,created_at,LENGTH(payload_json) AS bytes FROM investment_backups WHERE owner_id=? AND space=? ORDER BY created_at DESC LIMIT 100',
      this.owner,
      space,
    ).all<{ name: string; version: number; sha256: string; created_at: string; bytes: number }>();
    return rows.results;
  }

  async loadBackup(space: InvestmentSpace, name: string) {
    if (!namePattern.test(name)) throw new InvestmentValidationError('备份名称无效');
    const row = await this.q(
      'SELECT name,version,payload_json,sha256,created_at FROM investment_backups WHERE owner_id=? AND space=? AND name=?',
      this.owner,
      space,
      name,
    ).first<BackupRow>();
    if (!row) throw new InvestmentValidationError('未找到该工作区备份', 404);
    const digest = await sha256(row.payload_json);
    if (digest !== row.sha256) throw new InvestmentValidationError('备份哈希校验失败', 422);
    let envelope: { owner: string; space: InvestmentSpace; version: number; state: InvestmentState };
    try { envelope = JSON.parse(row.payload_json); } catch { throw new InvestmentValidationError('备份内容无效', 422); }
    if (envelope.owner !== this.owner || envelope.space !== space) throw new InvestmentValidationError('备份身份或工作区不匹配', 403);
    if (!envelope.state || envelope.state.owner !== this.owner || envelope.state.space !== space) throw new InvestmentValidationError('备份身份或工作区不匹配', 403);
    validateState(envelope.state);
    return { ...row, envelope };
  }

  async registerExport(space: InvestmentSpace, snapshotId: string, binding: { instrument_id: string | null; report_type: 'market' | 'diagnosis'; context_id: string; exported_at: string }) {
    const state = await this.snapshot(space);
    state.exports[snapshotId] = binding;
    validateState(state);
    // Export metadata has its own row so GET requests never overwrite a
    // concurrent ledger write or another exported snapshot's binding.
    const result=await this.q(`INSERT INTO investment_export_bindings(owner_id,space,snapshot_id,binding_json)
      SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM investment_export_bindings WHERE owner_id=? AND space=? AND snapshot_id=?)
      OR (SELECT COUNT(*) FROM (SELECT key FROM json_each((SELECT state_json FROM investment_states WHERE owner_id=? AND space=?),'$.exports') UNION SELECT snapshot_id FROM investment_export_bindings WHERE owner_id=? AND space=?))<1000
      ON CONFLICT(owner_id,space,snapshot_id) DO UPDATE SET binding_json=excluded.binding_json`,this.owner,space,snapshotId,JSON.stringify(binding),this.owner,space,snapshotId,this.owner,space,this.owner,space).run();
    if(result.meta.changes!==1)throw new InvestmentValidationError('分析包绑定数量超过上限',413);
    return binding;
  }

  async refresh(
    space: InvestmentSpace,
    input: { base_version: number; operation_id: string; ids?: string[]; full?: boolean; cursor?: string; [key: string]: unknown },
  ) {
    return this.mutate(space, input, async (state) => {
      if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length > 5)) throw new InvestmentValidationError('刷新品种列表无效；每批最多5个品种');
      if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 120)) throw new InvestmentValidationError('刷新游标无效');
      if (input.ids?.length && input.cursor) throw new InvestmentValidationError('刷新游标不能与显式品种列表同时使用');
      if (input.ids && input.ids.some((id) => !state.instruments.some((x) => x.id === id))) throw new InvestmentValidationError('刷新品种不存在');
      const observed=state.instruments.filter(x=>x.watched!==false);
      const selected: Instrument[] = input.ids?.length
        ? observed.filter((x) => input.ids!.includes(x.id))
        : (() => {
            const start = input.cursor ? Math.max(0, observed.findIndex((x) => x.id === input.cursor) + 1) : 0;
            if (input.cursor && !observed.some((x) => x.id === input.cursor)) throw new InvestmentValidationError('刷新游标不存在');
            return observed.slice(start, start + 5);
          })();
      const selectedIds = new Set(selected.map((x) => x.id));
      const remainingIds = input.ids?.length ? [] : observed.filter((x) => !selectedIds.has(x.id) && observed.indexOf(x) > observed.indexOf(selected.at(-1) || observed.at(-1)!)).map((x) => x.id);
      const nextCursor = remainingIds.length ? selected.at(-1)?.id || input.cursor || null : null;
      const job: Job = { id: crypto.randomUUID(), status: 'running', progress: 0, message: '正在采集参考行情与历史数据', started_at: now(), finished_at: null, error: null };
      state.jobs.push(job);
      const sourceHealth: SourceHealth[] = [];
      let count = 0;
      const provider = this.marketProvider;
      if (!provider?.fetchInvestmentSnapshot) {
        job.status = 'completed'; job.progress = 100; job.message = '市场数据 worker 尚未接入；保留已有快照'; job.finished_at = now();
        sourceHealth.push({ source: 'investment-market', status: 'missing', message: '待部署市场数据 worker', checked_at: now() });
      } else {
        let failed = 0;
        for (let i = 0; i < selected.length; i++) {
          const instrument = selected[i];
          try {
            const value = await withTimeout(provider.fetchInvestmentSnapshot(instrument, state.snapshots[instrument.id]), 12_000);
            if (value) {
              value.warnings=[...new Set(value.warnings)].slice(-80);
              const trace=value as Snapshot&{source_attempts?:unknown[]};if(Array.isArray(trace.source_attempts))trace.source_attempts=trace.source_attempts.slice(-30);
              state.snapshots[instrument.id] = value; count++; if(value.status!=='fresh'||value.error||value.history_status==='missing'||value.history_status==='stale'||value.warnings.some(w=>/获取失败|沿用.*缓存/.test(w)))failed++;
            }
            else throw new Error('市场 worker 未返回快照');
            job.progress = Math.min(99, Math.floor(((i + 1) / Math.max(1, selected.length)) * 100));
          } catch (error) {
            failed++;
            const previous = state.snapshots[instrument.id];
            if (previous) state.snapshots[instrument.id] = { ...previous, status: 'stale', error: error instanceof Error ? error.message : '采集失败', warnings: [...new Set([...previous.warnings, '本次刷新失败，保留上次缓存'])] };
          }
          job.progress = Math.min(99, Math.floor(((i + 1) / Math.max(1, selected.length)) * 100));
        }
        if (input.full && provider.refreshInvestmentMarket) {
          try {
            const market = await withTimeout(provider.refreshInvestmentMarket(state.market), 12_000);
            if (!market) throw new Error('市场 worker 未返回市场快照');
            market.warnings=[...new Set(market.warnings)].slice(-80);
            const trace=market as Market&{source_attempts?:unknown[]};if(Array.isArray(trace.source_attempts))trace.source_attempts=trace.source_attempts.slice(-30);
            state.market = market;
            if(market.status!=='fresh'||market.missing_fields.length)failed++;
          } catch (error) {
            failed++;
            if (state.market) state.market = { ...state.market, status: 'stale', warnings: [...new Set([...state.market.warnings, error instanceof Error ? error.message : '市场快照刷新失败'])] };
          }
        }
        job.status = 'completed'; job.progress = 100; job.message = '自动采集完成；缺失与缓存状态请查看来源标签'; job.finished_at = now();
        sourceHealth.push({ source: 'investment-market', status: failed === 0 ? 'ok' : count === 0 ? 'failed' : 'degraded', message:failed?'部分采集失败、缺失或使用旧缓存；请核验各快照日期':'采集结果含有效数据，请核验适用日期', checked_at: now() });
      }
      job.result = { count, source_health: sourceHealth, selected_ids: selected.map((x) => x.id), remaining: remainingIds.length, remaining_ids: remainingIds.slice(0, 100), next_cursor: nextCursor };
      state.source_health = sourceHealth;
      if (state.jobs.length > 50) state.jobs = state.jobs.slice(-50);
      return { job_id: job.id, status: job.status, job: jobSummary(job) };
    });
  }
}

