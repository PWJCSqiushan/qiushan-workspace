import { sha256 } from './protocol.ts';
import { InvestmentValidationError, validateState } from './investment-domain.ts';
import type { InvestmentSpace, InvestmentState } from './investment-domain.ts';

type InvestmentStateRow = {
  owner_id: string;
  space: 'personal' | 'demo';
  version: number;
  state_json: string;
  updated_at: string;
};

const MAX_STATE_BYTES = 2_000_000;
const MAX_BACKUP_ROWS = 200;

export type PortableInvestmentBackup = {
  schema_version: 1;
  owner: string;
  space: InvestmentSpace;
  version: number;
  state: InvestmentState;
  state_sha256: string;
};

/** Validate a JSON backup assembled by an authorized migration task. */
export async function validateInvestmentBackup(input: unknown, expectedOwner: string, expectedSpace: InvestmentSpace) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InvestmentValidationError('备份内容无效', 422);
  const raw = input as Partial<PortableInvestmentBackup>;
  if (raw.schema_version !== 1) throw new InvestmentValidationError('备份schema_version无效', 422);
  if (raw.owner !== expectedOwner || raw.space !== expectedSpace) throw new InvestmentValidationError('备份身份或工作区不匹配', 403);
  if (!Number.isSafeInteger(raw.version) || raw.version! < 0 || !raw.state || !Number.isSafeInteger(raw.state.version) || raw.state.version !== raw.version) throw new InvestmentValidationError('备份版本或状态无效', 422);
  if (typeof raw.state_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.state_sha256)) throw new InvestmentValidationError('备份哈希格式无效', 422);
  validateState(raw.state);
  if (raw.state.owner !== expectedOwner || raw.state.space !== expectedSpace) throw new InvestmentValidationError('备份身份或工作区不匹配', 403);
  const digest = await sha256(JSON.stringify(raw.state));
  if (digest !== raw.state_sha256) throw new InvestmentValidationError('备份哈希校验失败', 422);
  return raw.state;
}

/**
 * Daily KV mirror for the investment JSON rows.
 *
 * This is deliberately separate from backupAll/backupFinanceAll/backupTimeAll:
 * the investment module has its own owner+space namespace and a hard size cap.
 * D1 remains authoritative; a failed KV write is surfaced to the scheduler.
 */
export async function backupInvestmentAll(db: D1Database, kv: KVNamespace) {
  const rows = (
    await db
      .prepare('SELECT owner_id,space,version,state_json,updated_at FROM investment_states ORDER BY owner_id,space LIMIT ?')
      .bind(MAX_BACKUP_ROWS+1)
      .all<InvestmentStateRow>()
  ).results;
  if(rows.length>MAX_BACKUP_ROWS)throw Object.assign(new Error('Investment backup capacity exceeded; no truncated success'),{code:'INVESTMENT_BACKUP_CAPACITY_LIMIT'});
  const failures: Array<{ owner: string; space: string; code: string; error: string }> = [];
  let backedUp = 0;
  for (const row of rows) {
    const bytes = new TextEncoder().encode(row.state_json).byteLength;
    if (bytes > MAX_STATE_BYTES) {
      failures.push({ owner: row.owner_id, space: row.space, code: 'STATE_TOO_LARGE', error: `state_json is ${bytes} bytes` });
      continue;
    }
    try {
      const state=JSON.parse(row.state_json) as InvestmentState;
      const bindings=await db.prepare('SELECT snapshot_id,binding_json FROM investment_export_bindings WHERE owner_id=? AND space=?').bind(row.owner_id,row.space).all<{snapshot_id:string;binding_json:string}>();
      state.exports ||= {};
      for(const binding of bindings.results)state.exports[binding.snapshot_id]=JSON.parse(binding.binding_json);
      const stateHash = await sha256(JSON.stringify(state));
      const ownerKey = await sha256(row.owner_id);
      const envelope = JSON.stringify({
        schema_version: 1,
        owner: row.owner_id,
        space: row.space,
        version: row.version,
        updated_at: row.updated_at,
        state_sha256: stateHash,
        state,
      });
      await kv.put(`investment/${ownerKey}/${row.space}/latest`, envelope, { expirationTtl: 90 * 86400 });
      backedUp++;
    } catch (error) {
      failures.push({ owner: row.owner_id, space: row.space, code: 'KV_WRITE_FAILED', error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (failures.length) {
    const error = new Error(`investment backup failed for ${failures.length} row(s)`);
    Object.assign(error, { code: 'INVESTMENT_BACKUP_FAILED', failures, backedUp, scanned: rows.length });
    throw error;
  }
  return { ok: true, scanned: rows.length, backedUp, namespace: 'investment/' };
}
