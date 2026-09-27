import { AppError } from './workspace.ts';
import { sha256 } from './protocol.ts';
import { FinanceConflictError, FinanceStore } from './finance-store.ts';
import { validateFinanceState } from './finance-domain.ts';
import type {
  FinanceCollection,
  FinanceEntity,
  FinancePatch,
  FinanceSpace,
  FinanceState,
  FinanceTransaction,
} from './finance-types.ts';

type HistoryRow = {
  history_id: string;
  label: string;
  created_at: string;
  before_json: string;
  after_json: string;
  undone: number;
  redo_invalidated: number;
};
export type FinanceBackup = {
  schemaVersion: 1;
  kind: 'finance-board';
  exportedAt: string;
  space: FinanceSpace;
  sha256: string;
  state: FinanceState;
  history: HistoryRow[];
};
const collections: FinanceCollection[] = [
  'accounts',
  'categories',
  'places',
  'activities',
  'transactions',
  'meals',
  'sponsorships',
];
function validPatches(value: unknown): value is FinancePatch[] {
  if (!Array.isArray(value)) return false;
  return value.every((raw) => {
    if (!raw || typeof raw !== 'object') return false;
    const patch = raw as {
      collection?: unknown;
      id?: unknown;
      value?: unknown;
    };
    if (
      !collections.includes(patch.collection as FinanceCollection) ||
      typeof patch.id !== 'string'
    )
      return false;
    return (
      patch.value === null ||
      (!!patch.value &&
        typeof patch.value === 'object' &&
        (patch.value as { id?: unknown }).id === patch.id)
    );
  });
}
function historyProjection(history: HistoryRow[]) {
  return [...history]
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) ||
        a.history_id.localeCompare(b.history_id),
    )
    .slice(-100)
    .map((h) => ({
      id: h.history_id,
      label: h.label,
      createdAt: h.created_at,
      undone: !!h.undone,
      redoInvalidated: !!h.redo_invalidated,
    }));
}
export async function exportFinanceBackup(
  store: FinanceStore,
  space: FinanceSpace,
): Promise<FinanceBackup> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await store.version(space),
      state = await store.snapshot(space);
    const history = (
      await store
        .q(
          'SELECT history_id,label,created_at,before_json,after_json,undone,redo_invalidated FROM finance_history WHERE owner_id=? AND space=? ORDER BY created_at,history_id',
          store.owner,
          space,
        )
        .all<HistoryRow>()
    ).results;
    if (version !== (await store.version(space))) continue;
    return {
      schemaVersion: 1,
      kind: 'finance-board',
      exportedAt: new Date().toISOString(),
      space,
      state,
      history,
      sha256: await sha256({ state, history }),
    };
  }
  throw new FinanceConflictError('账本正在修改，请稍后重新导出');
}
export async function validateFinanceBackup(
  value: unknown,
  owner?: string,
): Promise<FinanceBackup> {
  const b = value as FinanceBackup;
  if (
    !b ||
    b.schemaVersion !== 1 ||
    b.kind !== 'finance-board' ||
    !b.state ||
    !Array.isArray(b.history) ||
    !['personal', 'demo'].includes(b.space) ||
    b.state.space !== b.space ||
    (owner !== undefined && b.state.owner !== owner)
  )
    throw new AppError(
      owner !== undefined && b?.state?.owner !== owner
        ? '备份所属账户不一致'
        : '不支持的生活账本备份',
    );
  if ((await sha256({ state: b.state, history: b.history })) !== b.sha256)
    throw new AppError('备份校验失败');
  validateFinanceState(b.state);
  if (!Array.isArray(b.state.history)) throw new AppError('备份历史投影无效');
  const ids = new Set<string>();
  for (const h of b.history) {
    if (
      !h ||
      typeof h.history_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(h.history_id) ||
      ids.has(h.history_id) ||
      typeof h.label !== 'string' ||
      typeof h.created_at !== 'string' ||
      !Number.isFinite(Date.parse(h.created_at)) ||
      !Number.isInteger(h.undone) ||
      !Number.isInteger(h.redo_invalidated) ||
      ![0, 1].includes(h.undone) ||
      ![0, 1].includes(h.redo_invalidated) ||
      typeof h.before_json !== 'string' ||
      typeof h.after_json !== 'string'
    )
      throw new AppError('备份历史记录无效');
    ids.add(h.history_id);
    for (const text of [h.before_json, h.after_json]) {
      let patches: unknown;
      try {
        patches = JSON.parse(text);
      } catch {
        throw new AppError('备份历史内容无效');
      }
      if (!validPatches(patches)) throw new AppError('备份历史内容无效');
    }
  }
  const projected = historyProjection(b.history);
  if (
    b.state.history.length !== projected.length ||
    b.state.history.some((h, i) => {
      const expected = projected[i];
      return (
        h.id !== expected.id ||
        h.label !== expected.label ||
        h.createdAt !== expected.createdAt ||
        h.undone !== expected.undone ||
        !!h.redoInvalidated !== expected.redoInvalidated
      );
    })
  )
    throw new AppError('备份历史投影无效');
  return b;
}
export async function restoreFinanceBackup(
  store: FinanceStore,
  backup: FinanceBackup,
  operationId: string,
  expectedVersion: number,
) {
  if (
    !/^[A-Za-z0-9_-]{1,120}$/.test(operationId) ||
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 0
  )
    throw new AppError('恢复标识或版本无效');
  if (backup.state.owner !== store.owner)
    throw new AppError('备份所属账户不一致');
  const space = backup.space,
    hash = await sha256({
      operationId,
      expectedVersion,
      sha256: backup.sha256,
    });
  const prior = await store
    .q(
      'SELECT r.request_hash,r.result_json,r.result_version,COALESCE(h.restore_version,0) AS restore_version FROM finance_receipts r LEFT JOIN finance_heads h ON h.owner_id=r.owner_id AND h.space=r.space WHERE r.owner_id=? AND r.space=? AND r.operation_id=?',
      store.owner,
      space,
      operationId,
    )
    .first<{
      request_hash: string;
      result_json: string;
      result_version: number;
      restore_version: number;
    }>();
  if (prior) {
    if (prior.request_hash !== hash)
      throw new FinanceConflictError('恢复操作标识已被其他内容使用');
    if (
      prior.result_version &&
      prior.result_version <= Number(prior.restore_version || 0)
    )
      throw new FinanceConflictError('该恢复操作早于后续恢复，请重新核对备份');
    if (prior.result_version) return JSON.parse(prior.result_json);
    await store
      .q(
        'DELETE FROM finance_receipts WHERE owner_id=? AND space=? AND operation_id=? AND result_version=0',
        store.owner,
        space,
        operationId,
      )
      .run();
  }
  await store
    .q(
      'INSERT OR IGNORE INTO finance_heads(owner_id,space,version) VALUES(?,?,0)',
      store.owner,
      space,
    )
    .run();
  const current = await store.snapshot(space);
  if (current.version !== expectedVersion)
    throw new FinanceConflictError('账本已有修改，请重新预览恢复');
  const version = expectedVersion + 1,
    g = [store.owner, space, version, operationId],
    guard =
      'EXISTS(SELECT 1 FROM finance_heads WHERE owner_id=? AND space=? AND version=? AND last_operation_id=?)',
    stamp = new Date().toISOString();
  const stmts: D1PreparedStatement[] = [
    store.q(
      'INSERT INTO finance_receipts(owner_id,space,operation_id,request_hash,created_at) VALUES(?,?,?,?,?)',
      store.owner,
      space,
      operationId,
      hash,
      stamp,
    ),
    store.q(
      'UPDATE finance_heads SET version=?,last_operation_id=?,restore_version=? WHERE owner_id=? AND space=? AND version=?',
      version,
      operationId,
      expectedVersion,
      store.owner,
      space,
      expectedVersion,
    ),
  ];
  for (const table of [
    'finance_entities',
    'finance_postings',
    'finance_history',
  ])
    stmts.push(
      store.q(
        `DELETE FROM ${table} WHERE owner_id=? AND space=? AND ${guard}`,
        store.owner,
        space,
        ...g,
      ),
    );
  for (const collection of collections) {
    const incoming = backup.state[collection] as FinanceEntity[],
      priorEntities = current[collection] as FinanceEntity[],
      present = new Set(incoming.map((x) => x.id));
    for (const old of priorEntities.filter((e) => !present.has(e.id)))
      stmts.push(
        store.q(
          `INSERT INTO finance_changes(owner_id,space,version,operation_id,collection,entity_id,data_json) SELECT ?,?,?,?,?,?,NULL WHERE ${guard}`,
          store.owner,
          space,
          version,
          operationId,
          collection,
          old.id,
          ...g,
        ),
      );
    for (const entity of incoming) {
      const value = {
          ...entity,
          version:
            Math.max(
              entity.version,
              priorEntities.find((x) => x.id === entity.id)?.version || 0,
            ) + 1,
        },
        tx =
          collection === 'transactions' ? (value as FinanceTransaction) : null,
        raw = JSON.stringify(value);
      stmts.push(
        store.q(
          `INSERT INTO finance_entities(owner_id,space,collection,entity_id,version,deleted,occurred_at,related_id,source_key,data_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,
          store.owner,
          space,
          collection,
          value.id,
          value.version,
          value.deleted ? 1 : 0,
          tx?.occurredAt || ('date' in value ? value.date : null) || null,
          tx?.relatedId || null,
          tx?.sourceKey || null,
          raw,
          ...g,
        ),
        store.q(
          `INSERT INTO finance_changes(owner_id,space,version,operation_id,collection,entity_id,data_json) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
          store.owner,
          space,
          version,
          operationId,
          collection,
          value.id,
          raw,
          ...g,
        ),
      );
      if (tx && !tx.deleted && !tx.analysisOnly)
        for (const [ordinal, p] of (tx.postings || []).entries())
          stmts.push(
            store.q(
              `INSERT INTO finance_postings(owner_id,space,transaction_id,ordinal,account,cents) SELECT ?,?,?,?,?,? WHERE ${guard}`,
              store.owner,
              space,
              tx.id,
              ordinal,
              p.account,
              p.cents,
              ...g,
            ),
          );
    }
  }
  for (const h of backup.history)
    stmts.push(
      store.q(
        `INSERT INTO finance_history(owner_id,space,history_id,label,created_at,before_json,after_json,undone,redo_invalidated) SELECT ?,?,?,?,?,?,?,?,? WHERE ${guard}`,
        store.owner,
        space,
        h.history_id,
        h.label,
        h.created_at,
        h.before_json,
        h.after_json,
        h.undone,
        h.redo_invalidated,
        ...g,
      ),
    );
  const result = { operationId, version, restored: true };
  stmts.push(
    store.q(
      `UPDATE finance_receipts SET result_json=?,result_version=? WHERE owner_id=? AND space=? AND operation_id=? AND ${guard}`,
      JSON.stringify(result),
      version,
      store.owner,
      space,
      operationId,
      ...g,
    ),
  );
  await store.db.batch(stmts);
  const check = await store
    .q(
      'SELECT result_version FROM finance_receipts WHERE owner_id=? AND space=? AND operation_id=?',
      store.owner,
      space,
      operationId,
    )
    .first<{ result_version: number }>();
  if (!check?.result_version) {
    await store
      .q(
        'DELETE FROM finance_receipts WHERE owner_id=? AND space=? AND operation_id=? AND result_version=0',
        store.owner,
        space,
        operationId,
      )
      .run();
    throw new FinanceConflictError();
  }
  return result;
}
export async function backupFinanceAll(db: D1Database, kv: KVNamespace) {
  const owners = await db
    .prepare('SELECT owner_id,space FROM finance_heads')
    .all<{ owner_id: string; space: FinanceSpace }>();
  const results = [];
  for (const o of owners.results) {
    const store = new FinanceStore(db, o.owner_id),
      id = new Date().toISOString().slice(0, 10) + '-finance-daily';
    try {
      const b = await exportFinanceBackup(store, o.space),
        raw = JSON.stringify(b),
        bytes = new TextEncoder().encode(raw).length;
      if (bytes > 24000000)
        throw new Error('账本备份超过单份容量，需要分卷导出');
      await kv.put(`finance/${o.owner_id}/${o.space}/${id}/${b.sha256}`, raw, {
        metadata: { sha256: b.sha256, version: b.state.version },
      });
      await store
        .q(
          "INSERT OR REPLACE INTO finance_backup_runs(owner_id,space,id,status,bytes,sha256,error,created_at) VALUES(?,?,?,'success',?,?,NULL,?)",
          o.owner_id,
          o.space,
          id,
          bytes,
          b.sha256,
          new Date().toISOString(),
        )
        .run();
      results.push({ space: o.space, status: 'success' });
    } catch (error) {
      await store
        .q(
          "INSERT OR REPLACE INTO finance_backup_runs(owner_id,space,id,status,bytes,error,created_at) VALUES(?,?,?,'failed',0,?,?)",
          o.owner_id,
          o.space,
          id,
          error instanceof Error ? error.message : 'BACKUP_FAILED',
          new Date().toISOString(),
        )
        .run();
      results.push({ space: o.space, status: 'failed' });
    }
  }
  return results;
}
