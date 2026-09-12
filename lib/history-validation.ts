import {FLOWS} from './domain.ts';
import {AppError,type HistoryData} from './workspace.ts';
export function validateHistory(value:unknown):HistoryData{
 const h=value as HistoryData;const fail=()=>{throw new AppError('统计历史格式无效，未执行恢复');};
 if(!h||h.version!==1||!Array.isArray(h.events)||h.events.length>50000||!h.coverage||typeof h.coverage.incomplete!=='boolean'||!Number.isSafeInteger(h.coverage.unknown)||h.coverage.unknown<0||!/^\d{4}-\d{2}-\d{2}$/.test(h.coverage.since))return fail();
 if(!Number.isFinite(Date.parse(h.coverage.since))||new Date(h.coverage.since).toISOString().slice(0,10)!==h.coverage.since)return fail();
 const ids=new Set<string>();for(const e of h.events){if(!e||typeof e.id!=='string'||!e.id.trim()||e.id.length>300||ids.has(e.id)||typeof e.taskId!=='string'||!e.taskId.trim()||e.taskId.length>100||!['created','completed','revoked'].includes(e.kind)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||!Number.isFinite(Date.parse(e.date))||new Date(e.date).toISOString().slice(0,10)!==e.date||!(e.flow===''||FLOWS.some(f=>f.id===e.flow))||typeof e.daily!=='boolean'||!['live','historical'].includes(e.source)||!Number.isFinite(Date.parse(e.occurredAt)))return fail();if(e.sequence!==undefined&&(!Number.isSafeInteger(e.sequence)||e.sequence<0))return fail();ids.add(e.id);}
 const map=new Map(h.events.map(e=>[e.id,e]));for(const e of h.events)if(e.kind==='revoked'){const original=map.get(e.reverses||'');if(!original||original.kind!=='completed'||original.taskId!==e.taskId||original.date!==e.date||original.flow!==e.flow||original.daily!==e.daily)return fail();}
 return structuredClone(h);
}
