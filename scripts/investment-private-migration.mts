import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {emptyInvestmentState,validateState,summarizeInvestment} from '../lib/investment-domain.ts';
import {validateInvestmentBackup} from '../lib/investment-backup.ts';

// Only the authorized handoff export is read; never open or modify source runtime.
const sourcePath='D:/丘山/R_投资/runtime/private-imports/20261009-cloud-handoff.json';
const expectedHash='B38CB5C376B58E687B45914807F4D136140AE8456BB6DC4C3E3C3C57306205C0';
const privateRoot='private/release-20261009';
const bytes=await readFile(sourcePath);
const sourceHash=createHash('sha256').update(bytes).digest('hex').toUpperCase();
assert.equal(sourceHash,expectedHash,'The authorized export changed; verify a new handoff before migration');
const source=JSON.parse(bytes.toString('utf8')).data;
assert(source&&typeof source==='object','Missing bootstrap data');
const migrating=process.argv.includes('--migrate');
const verifyAccount=process.argv.includes('--verify-account');
const verifying=process.argv.includes('--verify-cloud')||verifyAccount;
let owner='private-migration-validation',version=0;
let request:((endpoint:string,payload?:unknown,method?:string)=>Promise<any>)|undefined;
if(migrating||verifying){
 ({request}=await import('./investment-release-audit.mjs'));
 const session=await request!('/api/investment/session?space=personal');owner=session.owner;
 const cloud=await request!('/api/investment/bootstrap?space=personal');version=cloud.version;
 if(migrating)assert(!cloud.opening&&!cloud.transactions.length&&!cloud.plans.length&&!cloud.reports.length,'Cloud investment is already populated; do not overwrite it');
}
const state=emptyInvestmentState(owner,'personal');state.version=version;
// Whitelist domain state; deliberately exclude source jobs, credentials, files,
// HTTP diagnostics, generated advice and report-export registrations.
for(const key of ['profile','instruments','snapshots','market','opening','account_context','plans','transactions','reports'] as const){
 assert(key in source,'Handoff missing '+key);
 (state as unknown as Record<string,unknown>)[key]=structuredClone(source[key]);
}
state.observations=[];state.exports={};state.jobs=[];state.source_health=[];
validateState(state);
const backup={schema_version:1 as const,owner,space:'personal' as const,version,state,state_sha256:createHash('sha256').update(JSON.stringify(state)).digest('hex')};
await validateInvestmentBackup(backup,owner,'personal');
const summary=summarizeInvestment(state);
assert.equal(state.instruments.length,14);assert.equal(state.opening?.positions.length,4);
assert.equal(state.plans.length,4);assert.equal(state.reports.length,5);assert.equal(state.transactions.length,0);
assert.equal(state.opening?.opening_pnl,null);
assert(state.opening?.positions.every(x=>x.average_cost===null));
assert.equal(summary.cash,state.opening?.cash);
assert.equal(summary.net_contributions,state.opening?.initial_equity);
assert.equal(summary.equity_curve.length,0);
await mkdir(privateRoot,{recursive:true});
await writeFile(privateRoot+'/investment-migration-backup.json',JSON.stringify(backup));
const audit={source_sha256:sourceHash,prepared_at:new Date().toISOString(),counts:{instruments:state.instruments.length,snapshots:Object.keys(state.snapshots).length,positions:summary.positions.length,plans:state.plans.length,reports:state.reports.length,transactions:state.transactions.length},unknown_cost_preserved:true,external_cash_excluded_from_ledger:true,historical_curve_not_fabricated:true,migrated:false};
if(migrating||verifying){
 let result:{version:number}={version};
 if(migrating){
 const operation_id=randomUUID();
 await writeFile(privateRoot+'/investment-migration-operation.json',JSON.stringify({operation_id,base_version:version}));
 result=await request!('/api/investment/backups/restore?space=personal',{space:'personal',base_version:version,operation_id,backup});
 }
 const cloud=await request!('/api/investment/export?space=personal');
 // Date freshness may mark snapshots stale on read; their original content
 // and every personal account field must remain unchanged.
 for(const key of ['profile','instruments','opening','account_context','plans','transactions','reports'])assert.deepEqual(cloud.state[key],(state as any)[key]);
 for(const [id,snapshot] of verifyAccount?[]:Object.entries(state.snapshots)){
  const actual=cloud.state.snapshots[id];assert(actual);assert.equal(actual.snapshot_id,snapshot.snapshot_id);assert.deepEqual(actual.quote,snapshot.quote);assert.deepEqual(actual.history,snapshot.history);
 }
 const demo=await request!('/api/investment/bootstrap?space=demo');
 assert.equal(demo.account_context,null);assert.equal(demo.transactions.length,0);assert.equal(demo.reports.length,0);
 assert(demo.instruments.every((x:any)=>x.name.includes('合成')));
 audit.migrated=true;(audit as any).cloud_version=result.version;
 await writeFile(privateRoot+'/investment-after-migration.json',JSON.stringify(cloud));
}
await writeFile(privateRoot+'/investment-migration-audit.json',JSON.stringify(audit,null,2));
console.log(JSON.stringify(audit));
