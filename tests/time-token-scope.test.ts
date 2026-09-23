import test from 'node:test';
import assert from 'node:assert/strict';
import {timeFailure,assertGarminTokenRoute,handleTimeRequest} from '../lib/time-api.ts';
import {TimeStore,TimeConflictError} from '../lib/time-store.ts';
import {database} from './d1-helper.ts';
test('Garmin stale commit discloses version but no private snapshot',async()=>{
 const {db,sqlite}=database();try{const store=new TimeStore(db,'private-owner');await store.snapshot('personal');const token=await store.createGarminConnection('personal');await store.mutate({space:'personal',baseVersion:0,operationId:'private-record',mutation:{type:'upsert',interval:{id:'private-record',start:'2026-09-01T01:00:00Z',end:'2026-09-01T02:00:00Z',categoryId:'study',note:'PRIVATE_NOTE_SENTINEL'}}});
 const request=new Request('https://example.test/api/time/garmin/commit',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({space:'personal',token:token.token,baseVersion:0,operationId:'stale-garmin',items:[]})});
 try{await handleTimeRequest(request,store);assert.fail('Expected stale conflict');}catch(error){assert.ok(error instanceof TimeConflictError);const response=timeFailure(error,false),body=await response.json() as Record<string,unknown>;assert.equal(response.status,409);assert.equal(body.version,1);assert.equal(body.latest,undefined);assert.ok(!JSON.stringify(body).includes('PRIVATE_NOTE_SENTINEL'));assert.equal(body.code,'TIME_VERSION_CONFLICT');}
 }finally{sqlite.close();}
});
test('Garmin token cannot use an allowed URL to dispatch a different action',()=>{
 for(const path of ['pull','commit']){const req=new Request('https://example.test/api/time/garmin/'+path,{method:'POST'});for(const action of ['token','revoke','request'])assert.throws(()=>assertGarminTokenRoute(req,{action}));assert.doesNotThrow(()=>assertGarminTokenRoute(req,{}));assert.doesNotThrow(()=>assertGarminTokenRoute(req,{action:path}));}
 assert.throws(()=>assertGarminTokenRoute(new Request('https://example.test/api/time/garmin/pull'),{}));
});
