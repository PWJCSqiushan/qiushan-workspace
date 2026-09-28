import { AppError } from './workspace.ts';
import { sha256, stable } from './protocol.ts';
import {
  applyFinanceMutation,
  validateFinanceState,
} from './finance-domain.ts';
import { calculateFinanceStats } from './finance-stats.ts';
import {
  emptyFinanceState,
  applyFinancePatches,
  type FinanceCollection,
  type FinanceEntity,
  type FinanceEnvelope,
  type FinanceHistory,
  type FinanceMutation,
  type FinancePatch,
  type FinanceReceipt,
  type FinanceSpace,
  type FinanceState,
  type FinanceSync,
  type FinanceTransaction,
} from './finance-types.ts';

const collections: FinanceCollection[] = [
  'accounts',
  'categories',
  'places',
  'activities',
  'transactions',
  'meals',
  'sponsorships',
];
type EntityRow = {
  collection: FinanceCollection;
  entity_id: string;
  data_json: string;
  version: number;
};
const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
function spaceCheck(space: unknown): asserts space is FinanceSpace {
  if (space !== 'personal' && space !== 'demo')
    throw new AppError('账本空间无效');
}
function numericVersion(v: unknown) {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}
function sameEntity(a: FinanceEntity | null, b: FinanceEntity | null) {
  if (a === null || b === null) return a === b;
  const { version: _a, ...av } = a,
    { version: _b, ...bv } = b;
  return stable(av) === stable(bv);
}
export class FinanceConflictError extends AppError {
  constructor(message = '账本记录已在其他设备修改，本机内容已保留。') {
    super(message, 409);
  }
}

/** Independent record store: no full-history receipts or whole-ledger rewrites. */
export class FinanceStore {
  constructor(
    public db: D1Database,
    public owner: string,
  ) {}
  q(sql: string, ...args: unknown[]) {
    return this.db.prepare(sql).bind(...args);
  }
  async version(space: FinanceSpace) {
    spaceCheck(space);
    return Number(
      (
        await this.q(
          'SELECT version FROM finance_heads WHERE owner_id=? AND space=?',
          this.owner,
          space,
        ).first<{ version: number }>()
      )?.version || 0,
    );
  }
  private async ensure(space: FinanceSpace) {
    spaceCheck(space);
    await this.q(
      'INSERT OR IGNORE INTO finance_heads(owner_id,space,version) VALUES(?,?,0)',
      this.owner,
      space,
    ).run();
  }
  async history(space: FinanceSpace, limit = 100): Promise<FinanceHistory[]> {
    const rows = await this.q(
      'SELECT history_id,label,created_at,undone,redo_invalidated FROM finance_history WHERE owner_id=? AND space=? ORDER BY created_at DESC,history_id DESC LIMIT ?',
      this.owner,
      space,
      limit,
    ).all<{
      history_id: string;
      label: string;
      created_at: string;
      undone: number;
      redo_invalidated: number;
    }>();
    return rows.results
      .map((r) => ({
        id: r.history_id,
        label: r.label,
        createdAt: r.created_at,
        undone: !!r.undone,
        redoInvalidated: !!r.redo_invalidated,
      }))
      .reverse();
  }
  private state(rows: EntityRow[], space: FinanceSpace, version: number) {
    const state = emptyFinanceState(this.owner, space);
    state.version = version;
    for (const row of rows) {
      if (collections.includes(row.collection))
        (state[row.collection] as FinanceEntity[]).push(
          JSON.parse(row.data_json),
        );
    }
    return state;
  }
  async snapshot(space: FinanceSpace): Promise<FinanceState> {
    spaceCheck(space);
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.version(space),
        rows = await this.q(
          'SELECT collection,entity_id,data_json,version FROM finance_entities WHERE owner_id=? AND space=?',
          this.owner,
          space,
        ).all<EntityRow>(),
        history = await this.history(space);
      if (before === (await this.version(space)))
        return { ...this.state(rows.results, space, before), history };
    }
    throw new FinanceConflictError('账本正在更新，请稍后重试');
  }
  async sync(space: FinanceSpace, cursor = 0): Promise<FinanceSync> {
    spaceCheck(space);
    if (!numericVersion(cursor)) throw new AppError('同步游标无效');
    const rows = await this.q(
      'SELECT cursor,collection,entity_id,data_json FROM finance_changes WHERE owner_id=? AND space=? AND cursor>? ORDER BY cursor LIMIT 201',
      this.owner,
      space,
      cursor,
    ).all<{
      cursor: number;
      collection: FinanceCollection;
      entity_id: string;
      data_json: string | null;
    }>();
    const page = rows.results.slice(0, 200);
    return {
      owner: this.owner,
      space,
      version: await this.version(space),
      cursor: page.at(-1)?.cursor ?? cursor,
      hasMore: rows.results.length > 200,
      changes: page.map((r) => ({
        collection: r.collection,
        id: r.entity_id,
        value: r.data_json ? JSON.parse(r.data_json) : null,
      })),
      history: await this.history(space),
    };
  }
  private async restoreVersion(space: FinanceSpace) {
    return Number(
      (
        await this.q(
          'SELECT restore_version FROM finance_heads WHERE owner_id=? AND space=?',
          this.owner,
          space,
        ).first<{ restore_version: number }>()
      )?.restore_version || 0,
    );
  }
  private async receipt(
    space: FinanceSpace,
    operationId: string,
    hash: string,
  ): Promise<FinanceReceipt | null> {
    const row = await this.q(
      'SELECT request_hash,result_json,result_version FROM finance_receipts WHERE owner_id=? AND space=? AND operation_id=?',
      this.owner,
      space,
      operationId,
    ).first<{
      request_hash: string;
      result_json: string;
      result_version: number;
    }>();
    if (!row) return null;
    if (row.request_hash !== hash)
      throw new FinanceConflictError('同一操作标识不能用于不同内容');
    if (
      row.result_version &&
      row.result_version <= (await this.restoreVersion(space))
    )
      throw new FinanceConflictError(
        '该操作发生在备份恢复前，请核对恢复后的草稿',
      );
    return row.result_version ? JSON.parse(row.result_json) : null;
  }
  private flatten(m: FinanceMutation): FinanceMutation[] {
    return m.type === 'batch'
      ? m.mutations.flatMap((x) => this.flatten(x))
      : [m];
  }
  /** Load catalog plus only transactions linked to this edit. Large history remains in D1. */
  private async mutationState(
    space: FinanceSpace,
    mutation: FinanceMutation,
  ): Promise<FinanceState> {
    if (
      ['undo', 'redo'].includes(mutation.type) ||
      this.flatten(mutation).some((m) => m.type === 'skipMeal')
    )
      return this.snapshot(space);
    const observedVersion = await this.version(space);
    const ms = this.flatten(mutation),
      ids = new Set<string>(),
      accountIds = new Set<string>(),
      caseIds = new Set<string>(),
      sourceKeys = new Set<string>();
    for (const m of ms) {
      if (m.type === 'saveTransaction') {
        ids.add(m.transaction.id);
        if (m.transaction.relatedId) ids.add(m.transaction.relatedId);
        if (m.transaction.caseId) caseIds.add(m.transaction.caseId);
        if (m.transaction.sourceKey) sourceKeys.add(m.transaction.sourceKey);
      }
      if (m.type === 'delete') ids.add(m.id);
      if (m.type === 'put') {
        ids.add(m.entity.id);
        if (m.collection === 'accounts') accountIds.add(m.entity.id);
      }
    }
    const catalogs = await this.q(
      "SELECT collection,entity_id,data_json,version FROM finance_entities WHERE owner_id=? AND space=? AND collection!='transactions'",
      this.owner,
      space,
    ).all<EntityRow>();
    // Catalog moves/deletions and account opening edits require dependency validation.
    const needsReferences = ms.some(
      (m) =>
        m.type === 'delete' ||
        (m.type === 'put' &&
          ['accounts', 'categories', 'places', 'activities', 'meals'].includes(
            m.collection,
          )),
    );
    let transactions: EntityRow[] = [];
    if (needsReferences) {
      transactions = (
        await this.q(
          "SELECT collection,entity_id,data_json,version FROM finance_entities WHERE owner_id=? AND space=? AND collection='transactions'",
          this.owner,
          space,
        ).all<EntityRow>()
      ).results;
    } else if (ids.size || caseIds.size || sourceKeys.size) {
      // JSON indexes are not needed for the bounded matching sets; related_id and source_key are indexed.
      const found = new Map<string, EntityRow>();
      const queried = new Set<string>();
      const lookup = async (
        values: string[],
        column: string,
        related = false,
      ) => {
        for (let start = 0; start < values.length; start += 40) {
          const chunk = values.slice(start, start + 40),
            marks = chunk.map(() => '?').join(','),
            args = related ? [...chunk, ...chunk] : chunk;
          const rows = await this.q(
            `SELECT collection,entity_id,data_json,version FROM finance_entities WHERE owner_id=? AND space=? AND collection='transactions' AND (${column} IN (${marks})${related ? ` OR related_id IN (${marks})` : ''})`,
            this.owner,
            space,
            ...args,
          ).all<EntityRow>();
          for (const row of rows.results) found.set(row.entity_id, row);
        }
      };
      await lookup([...caseIds], "json_extract(data_json,'$.caseId')");
      await lookup([...sourceKeys], 'source_key');
      // Also load the old origin if an edit changes its relationship.
      for (let pass = 0; pass < 4; pass++) {
        const todo = [...ids].filter((id) => !queried.has(id));
        if (todo.length) {
          await lookup(todo, 'entity_id', true);
          todo.forEach((id) => queried.add(id));
        }
        for (const row of found.values()) {
          const tx = JSON.parse(row.data_json) as FinanceTransaction;
          if (tx.relatedId) ids.add(tx.relatedId);
        }
        if ([...ids].every((id) => queried.has(id))) break;
      }
      transactions = [...found.values()];
    }
    if (observedVersion !== (await this.version(space)))
      throw new FinanceConflictError();
    return this.state(
      [...catalogs.results, ...transactions],
      space,
      observedVersion,
    );
  }
  private async replayHistory(
    space: FinanceSpace,
    mutation: Extract<FinanceMutation, { type: 'undo' | 'redo' }>,
    before: FinanceState,
  ) {
    const row = await this.q(
      'SELECT before_json,after_json,undone,redo_invalidated,label FROM finance_history WHERE owner_id=? AND space=? AND history_id=?',
      this.owner,
      space,
      mutation.historyId,
    ).first<{
      before_json: string;
      after_json: string;
      undone: number;
      redo_invalidated: number;
      label: string;
    }>();
    if (
      !row ||
      (mutation.type === 'undo' && row.undone) ||
      (mutation.type === 'redo' && (!row.undone || row.redo_invalidated))
    )
      throw new FinanceConflictError('该修改当前不能撤销或恢复');
    const history = await this.history(space, 10000),
      active = history.filter((h) => !h.undone);
    if (mutation.type === 'undo' && active.at(-1)?.id !== mutation.historyId)
      throw new FinanceConflictError('请先撤销最近一次修改');
    if (
      mutation.type === 'redo' &&
      history.filter((h) => h.undone && !h.redoInvalidated).at(0)?.id !==
        mutation.historyId
    )
      throw new FinanceConflictError('请按顺序恢复修改');
    const expected: FinancePatch[] = JSON.parse(
        mutation.type === 'undo' ? row.after_json : row.before_json,
      ),
      desired: FinancePatch[] = JSON.parse(
        mutation.type === 'undo' ? row.before_json : row.after_json,
      );
    const changes = desired.map((p) => {
      const current =
          (before[p.collection] as FinanceEntity[]).find(
            (e) => e.id === p.id,
          ) || null,
        match =
          expected.find((e) => e.collection === p.collection && e.id === p.id)
            ?.value || null;
      if (
        !sameEntity(
          current?.deleted ? null : current,
          match?.deleted ? null : match,
        )
      )
        throw new FinanceConflictError('关联记录已有后续修改，不能覆盖');
      return {
        collection: p.collection,
        id: p.id,
        value: p.value
          ? { ...p.value, version: (current?.version || 0) + 1 }
          : current
            ? { ...current, version: current.version + 1, deleted: true }
            : null,
      };
    });
    validateFinanceState(
      applyFinancePatches(before, changes, before.version + 1),
    );
    return {
      changes,
      label: (mutation.type === 'undo' ? '撤销：' : '恢复：') + row.label,
    };
  }
  async mutate(input: unknown): Promise<FinanceReceipt> {
    const e = input as FinanceEnvelope;
    if (
      !e ||
      !idPattern.test(e.operationId || '') ||
      !numericVersion(e.baseVersion) ||
      !e.mutation ||
      typeof e.mutation.type !== 'string'
    )
      throw new AppError('账本操作无效');
    spaceCheck(e.space);
    const { space, operationId, mutation } = e;
    if (
      mutation.type === 'batch' &&
      (!Array.isArray(mutation.mutations) ||
        mutation.mutations.length > 50 ||
        mutation.mutations.some(
          (m) =>
            String(m.type) === 'batch' || ['undo', 'redo'].includes(m.type),
        ))
    )
      throw new AppError('每批最多50条普通修改');
    await this.ensure(space);
    const hash = await sha256(e),
      prior = await this.receipt(space, operationId, hash);
    if (prior) return prior;
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await this.mutationState(space, mutation);
      let applied: { changes: FinancePatch[]; label: string };
      try {
        applied =
          mutation.type === 'undo' || mutation.type === 'redo'
            ? await this.replayHistory(space, mutation, before)
            : applyFinanceMutation(before, mutation, new Date());
      } catch (error) {
        if (error instanceof AppError) throw error;
        const message = error instanceof Error ? error.message : '账本修改无效';
        if (/version conflict/.test(message))
          throw new FinanceConflictError(
            '该记录已在其他设备修改，本机内容已保留，请核对后重试',
          );
        const status = Number((error as { status?: number }).status) || 400;
        throw new AppError(message, status);
      }
      // The heads CAS serializes writers; record versions in domain allow disjoint offline edits.
      const unique = new Map(
        applied.changes.map((p) => [p.collection + '/' + p.id, p]),
      );
      const changes = [...unique.values()];
      if (!changes.length)
        return { operationId, version: before.version, changes: [] };
      const lastStamp = (
        await this.q(
          'SELECT MAX(created_at) AS stamp FROM finance_history WHERE owner_id=? AND space=?',
          this.owner,
          space,
        ).first<{ stamp: string | null }>()
      )?.stamp;
      const nextVersion = before.version + 1,
        stamp = new Date(
          Math.max(Date.now(), lastStamp ? Date.parse(lastStamp) + 1 : 0),
        ).toISOString();
      const history: FinanceHistory = {
        id: operationId,
        label: applied.label,
        createdAt: stamp,
        undone: false,
      };
      const result: FinanceReceipt = {
        operationId,
        version: nextVersion,
        changes,
        ...(['undo', 'redo'].includes(mutation.type) ? {} : { history }),
      };
      const receiptText = JSON.stringify(result);
      if (new TextEncoder().encode(receiptText).length > 1500000)
        throw new AppError('本批修改过多，请分批提交', 413);
      const guard =
          'EXISTS(SELECT 1 FROM finance_heads WHERE owner_id=? AND space=? AND version=? AND last_operation_id=?)',
        g = [this.owner, space, nextVersion, operationId];
      const statements: D1PreparedStatement[] = [
        this.q(
          'INSERT INTO finance_receipts(owner_id,space,operation_id,request_hash,created_at) VALUES(?,?,?,?,?)',
          this.owner,
          space,
          operationId,
          hash,
          stamp,
        ),
        this.q(
          'UPDATE finance_heads SET version=?,last_operation_id=? WHERE owner_id=? AND space=? AND version=?',
          nextVersion,
          operationId,
          this.owner,
          space,
          before.version,
        ),
      ];
      for (const p of changes) {
        const v = p.value;
        const raw = v ? JSON.stringify(v) : null;
        const tx =
          p.collection === 'transactions' ? (v as FinanceTransaction) : null;
        if (v)
          statements.push(
            this.q(
              `INSERT INTO finance_entities(owner_id,space,collection,entity_id,version,deleted,occurred_at,related_id,source_key,data_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard} ON CONFLICT(owner_id,space,collection,entity_id) DO UPDATE SET version=excluded.version,deleted=excluded.deleted,occurred_at=excluded.occurred_at,related_id=excluded.related_id,source_key=excluded.source_key,data_json=excluded.data_json`,
              this.owner,
              space,
              p.collection,
              p.id,
              v.version,
              v.deleted ? 1 : 0,
              tx?.occurredAt || ('date' in v ? v.date : null) || null,
              tx?.relatedId || null,
              tx?.sourceKey || null,
              raw,
              ...g,
            ),
          );
        else
          statements.push(
            this.q(
              `DELETE FROM finance_entities WHERE owner_id=? AND space=? AND collection=? AND entity_id=? AND ${guard}`,
              this.owner,
              space,
              p.collection,
              p.id,
              ...g,
            ),
          );
        statements.push(
          this.q(
            `INSERT INTO finance_changes(owner_id,space,version,operation_id,collection,entity_id,data_json) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
            this.owner,
            space,
            nextVersion,
            operationId,
            p.collection,
            p.id,
            raw,
            ...g,
          ),
        );
        if (p.collection === 'transactions') {
          statements.push(
            this.q(
              `DELETE FROM finance_postings WHERE owner_id=? AND space=? AND transaction_id=? AND ${guard}`,
              this.owner,
              space,
              p.id,
              ...g,
            ),
          );
          if (tx && !tx.deleted && !tx.analysisOnly)
            for (const [ordinal, post] of (tx.postings || []).entries())
              statements.push(
                this.q(
                  `INSERT INTO finance_postings(owner_id,space,transaction_id,ordinal,account,cents) SELECT ?,?,?,?,?,? WHERE ${guard}`,
                  this.owner,
                  space,
                  p.id,
                  ordinal,
                  post.account,
                  post.cents,
                  ...g,
                ),
              );
        }
      }
      if (mutation.type === 'undo' || mutation.type === 'redo')
        statements.push(
          this.q(
            `UPDATE finance_history SET undone=? WHERE owner_id=? AND space=? AND history_id=? AND ${guard}`,
            mutation.type === 'undo' ? 1 : 0,
            this.owner,
            space,
            mutation.historyId,
            ...g,
          ),
        );
      else {
        const beforeChanges = changes.map((p) => ({
          collection: p.collection,
          id: p.id,
          value:
            (before[p.collection] as FinanceEntity[]).find(
              (x) => x.id === p.id,
            ) || null,
        }));
        statements.push(
          this.q(
            `UPDATE finance_history SET redo_invalidated=1 WHERE owner_id=? AND space=? AND undone=1 AND ${guard}`,
            this.owner,
            space,
            ...g,
          ),
          this.q(
            `INSERT INTO finance_history(owner_id,space,history_id,label,created_at,before_json,after_json) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
            this.owner,
            space,
            operationId,
            applied.label,
            stamp,
            JSON.stringify(beforeChanges),
            JSON.stringify(changes),
            ...g,
          ),
        );
      }
      statements.push(
        this.q(
          `UPDATE finance_receipts SET result_json=?,result_version=? WHERE owner_id=? AND space=? AND operation_id=? AND ${guard}`,
          receiptText,
          nextVersion,
          this.owner,
          space,
          operationId,
          ...g,
        ),
      );
      try {
        await this.db.batch(statements);
      } catch (error) {
        const replay = await this.receipt(space, operationId, hash);
        if (replay) return replay;
        if (String(error).includes('UNIQUE'))
          throw new FinanceConflictError(
            '这笔来源交易已存在，或记录同时被修改，请核对',
          );
        throw error;
      }
      const committed = await this.q(
        'SELECT result_version FROM finance_receipts WHERE owner_id=? AND space=? AND operation_id=?',
        this.owner,
        space,
        operationId,
      ).first<{ result_version: number }>();
      if (committed?.result_version)
        return (await this.receipt(space, operationId, hash))!;
      await this.q(
        'DELETE FROM finance_receipts WHERE owner_id=? AND space=? AND operation_id=? AND result_version=0',
        this.owner,
        space,
        operationId,
      ).run();
    }
    throw new FinanceConflictError();
  }
  async stats(
    space: FinanceSpace,
    options: {
      from: string;
      to: string;
      meal?: 'all' | 'breakfast' | 'lunch' | 'dinner';
    },
  ) {
    return calculateFinanceStats(await this.snapshot(space), {
      ...options,
      meal: options.meal === 'all' ? undefined : options.meal,
    });
  }
}
