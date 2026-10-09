import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {request} from './investment-release-audit.mjs';

// Authorized personal-space refresh only updates reference data. Account values
// remain in memory and ignored private evidence; stdout contains public dates.
const root='private/release-20261009';
const before=await request('/api/investment/export?space=personal');
const ledgerKeys=['profile','instruments','opening','account_context','plans','transactions','reports'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids=before.state.instruments.filter(x=>x.watched!==false).map(x=>x.id);
const jobs=[];
for(let start=0;start<ids.length;start+=3){
 const batch=ids.slice(start,start+3);
 const current=await request('/api/investment/bootstrap?space=personal');
 const payload={space:'personal',base_version:current.version,operation_id:randomUUID(),ids:batch,full:false};
 await writeFile(root+'/refresh-operation-'+start+'.json',JSON.stringify(payload));
 jobs.push(await request('/api/investment/refresh?space=personal',payload));
 console.log(JSON.stringify({refreshed_batch:batch.length,completed:start+batch.length,total:ids.length}));
}
// A single instrument plus market stays within the HTTP audit deadline.
const current=await request('/api/investment/bootstrap?space=personal');
jobs.push(await request('/api/investment/refresh?space=personal',{space:'personal',base_version:current.version,operation_id:randomUUID(),ids:ids.slice(0,1),full:true}));
const after=await request('/api/investment/export?space=personal');
const unchanged=Object.fromEntries(ledgerKeys.map(key=>[key,digest(before.state[key])===digest(after.state[key])]));
assert(Object.values(unchanged).every(Boolean),'Refresh altered account records');
const summary={captured_at:new Date().toISOString(),account_records_unchanged:unchanged,jobs:jobs.map(x=>({status:x.status,version:x.version})),snapshots:ids.map(id=>{const x=after.state.snapshots[id];return {id,status:x?.status,quote_as_of:x?.quote?.as_of,quote_source:x?.quote?.source,history_status:x?.history_status,history_as_of:x?.history_as_of,history_rows:x?.history?.length,error:x?.error,warnings:x?.warnings,source_attempts:x?.source_attempts};}),market:{status:after.state.market?.status,date:after.state.market?.date,source:after.state.market?.source,missing_fields:after.state.market?.missing_fields,warnings:after.state.market?.warnings},source_health:after.state.source_health};
await writeFile(root+'/investment-after-refresh.json',JSON.stringify(after));
await writeFile(root+'/production-market-verification.json',JSON.stringify(summary,null,2));
const advice=await request('/api/investment/advice?space=personal');
await writeFile(root+'/production-advice.json',JSON.stringify(advice));
const migrated=JSON.parse(await readFile(root+'/investment-after-migration.json','utf8'));
for(const key of ledgerKeys)assert.deepEqual(after.state[key],migrated.state[key]);
console.log(JSON.stringify({account_records_unchanged:true,snapshot_counts:Object.fromEntries(['fresh','stale','missing'].map(status=>[status,summary.snapshots.filter(x=>x.status===status).length])),market_status:summary.market.status,market_missing_fields:summary.market.missing_fields,advice_as_of:advice.as_of}));
