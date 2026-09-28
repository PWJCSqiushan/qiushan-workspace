import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1-helper.ts';
import {TimeStore} from '../lib/time-store.ts';
import {handleTimeRequest,assertGarminTokenRoute} from '../lib/time-api.ts';
test('duplicate request coalesces; heartbeat claims, commit replay completes once; revoked and stale heartbeat visible',async()=>{
 const {db,sqlite}=database();try{const store=new TimeStore(db,'synthetic');const token=await store.createGarminConnection('personal');
 const call=async(action:string,data:Record<string,unknown>={})=>(await handleTimeRequest(new Request('https://test/api/time/garmin/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({space:'personal',connectionId:token.connectionId,token:token.token,...data})}),store)).json() as Promise<any>;
 const requests=await Promise.all(Array.from({length:5},()=>store.queueGarminSync('personal')));assert.equal(new Set(requests.map(r=>r.requestId)).size,1);
 assert.equal((await store.garminStatus('personal')).helperStatus,'offline');const pull=await call('pull');assert.equal(pull.status,'queued');assert.equal(pull.requestStatus,'queued');
 await call('heartbeat',{state:'reading',requestId:pull.requestId});assert.equal((await call('pull')).requestStatus,'running');assert.equal((await store.queueGarminSync('personal')).requestId,pull.requestId);
 const commit={requestId:pull.requestId,operationId:'sync-one',baseVersion:pull.baseVersion,items:[]};const first=await call('commit',commit);assert.deepEqual(await call('commit',commit),first);assert.equal((await store.garminStatus('personal')).pendingRequest,undefined);assert.equal((await store.garminStatus('personal')).helperStatus,'completed');
 await call('heartbeat',{state:'reauth_required',errorCode:'reauth_required'});assert.equal((await store.garminStatus('personal')).helperStatus,'reauth');await assert.rejects(call('heartbeat',{state:'error',errorCode:'PRIVATE SECRET'}));
 sqlite.prepare("UPDATE time_garmin_runtime SET heartbeat_at='2026-01-01T00:00:00Z'").run();assert.equal((await store.garminStatus('personal')).helperStatus,'offline');await store.revokeGarmin('personal',token.connectionId);assert.equal((await store.garminStatus('personal')).helperStatus,'site_token_revoked');await assert.rejects(call('heartbeat',{state:'idle'}));
 }finally{sqlite.close();}
});
test('heartbeat token cannot dispatch another action and cannot complete another connection request',async()=>{
 const req=new Request('https://test/api/time/garmin/heartbeat',{method:'POST'});assert.doesNotThrow(()=>assertGarminTokenRoute(req,{action:'heartbeat'}));assert.throws(()=>assertGarminTokenRoute(req,{action:'token'}));
 const {db,sqlite}=database();try{const store=new TimeStore(db,'test'),a=await store.createGarminConnection('personal'),b=await store.createGarminConnection('personal'),q=await store.queueGarminSync('personal');await store.verifyGarminRequest('personal',a.connectionId,q.requestId);await assert.rejects(store.verifyGarminRequest('personal',b.connectionId,q.requestId));}finally{sqlite.close();}
});
