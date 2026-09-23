import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TimeClient,clippedMinutes,dayStart,atLocal} from '../lib/time-client.ts';
import {localList} from '../lib/device-db.ts';
test('time offline outbox survives reload; lost receipt retries identical operation once',async()=>{
 const original=globalThis.fetch;let offline=false,lost=false,version=0;const receipts=new Map<string,unknown>();let applied=0;
 const snapshot=()=>({owner:'time-test-offline',version,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});
 globalThis.fetch=async(url,init)=>{if(offline)throw new TypeError('offline');if(String(url).includes('/api/session'))return Response.json({owner:'time-test-offline',expiresAt:Date.now()+60000});if(String(url).includes('/mutations')){const body=JSON.parse(String(init?.body));if(!receipts.has(body.operationId)){version++;applied++;receipts.set(body.operationId,{version});}if(lost){lost=false;throw new TypeError('lost response');}return Response.json(receipts.get(body.operationId));}return Response.json(snapshot());};
 try{const first=new TimeClient('demo',()=>{});await first.start();offline=true;await first.enqueue({type:'timerStart',categoryId:'study',start:'2026-09-20T00:00:00Z'});assert.equal(first.pending.length,1);const operation=first.pending[0].operationId;const reloaded=new TimeClient('demo',()=>{});await reloaded.start();assert.equal(reloaded.pending[0].operationId,operation);offline=false;lost=true;await reloaded.sync();assert.equal(applied,1);assert.equal(reloaded.pending.length,1);await reloaded.sync();assert.equal(applied,1);assert.equal(reloaded.pending.length,0);assert.equal(reloaded.data?.version,1);}finally{globalThis.fetch=original;}
});
test('conflict and expired login preserve pending draft without silent rebase',async()=>{
 const original=globalThis.fetch;let status=200;const snapshot={owner:'time-test-conflict',version:2,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]};
 globalThis.fetch=async(url)=>{if(String(url).includes('session'))return Response.json({owner:snapshot.owner,expiresAt:Date.now()+60000});if(status===401)return Response.json({error:'expired'},{status});if(String(url).includes('mutations'))return Response.json({error:'conflict',latest:snapshot},{status:409});return Response.json(snapshot);};
 try{const c=new TimeClient('personal',()=>{});await c.start();await c.saveDraft({note:'keep private draft'});await c.enqueue({type:'timerStart',categoryId:'sleep'});assert.equal(c.pending[0].state,'conflict');assert.equal(c.pending[0].baseVersion,2);status=401;await c.sync();assert.equal(c.blocked,true);assert.equal(c.data,null);assert.equal(c.pending.length,1);assert.deepEqual(await c.draft(),{note:'keep private draft'});assert.equal((await localList('time/outbox/time-test-conflict/personal/')).length,1);}finally{globalThis.fetch=original;}
});
test('UI statistics clips exact 85 minutes, cross midnight and future denominator',()=>{const rows=[{id:'a',start:atLocal('2026-09-21','14:10'),end:atLocal('2026-09-21','15:35'),categoryId:'study',note:''},{id:'b',start:atLocal('2026-09-21','23:50'),end:atLocal('2026-09-22','07:10'),categoryId:'sleep',note:''}];assert.equal(clippedMinutes(rows,dayStart('2026-09-21'),dayStart('2026-09-22'),dayStart('2026-09-23')),95);assert.equal(clippedMinutes(rows,dayStart('2026-09-22'),dayStart('2026-09-23'),dayStart('2026-09-23')),430);assert.equal(clippedMinutes(rows,dayStart('2026-09-22'),dayStart('2026-09-23'),dayStart('2026-09-22')+60*60000),60);});

test('unchanged sync keeps snapshot identity while a new version updates it',async()=>{
 const original=globalThis.fetch;let version=0;
 globalThis.fetch=async(url)=>String(url).includes('/api/session')?Response.json({owner:'identity-test',expiresAt:Date.now()+60000}):Response.json({owner:'identity-test',version,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});
 try{const c=new TimeClient('demo',()=>{});await c.start();const first=c.data;await c.sync();assert.equal(c.data,first);version++;await c.sync();assert.notEqual(c.data,first);assert.equal(c.data?.version,1);}finally{globalThis.fetch=original;}
});

test('concurrent attendance edits drain with distinct versions and receipt snapshots',async()=>{
 const original=globalThis.fetch;let version=0;const seen:number[]=[];
 const snapshot=()=>({owner:'concurrent-attendance',version,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});
 globalThis.fetch=async(url,init)=>{if(String(url).includes('session'))return Response.json({owner:snapshot().owner,expiresAt:Date.now()+60000});if(String(url).includes('mutations')){const body=JSON.parse(String(init?.body));seen.push(body.baseVersion);if(body.baseVersion!==version)return Response.json({error:'conflict'},{status:409});await new Promise(r=>setTimeout(r,10));version++;return Response.json({version,snapshot:snapshot()});}return Response.json(snapshot());};
 try{const c=new TimeClient('personal',()=>{});await c.start();await Promise.all(Array.from({length:6},(_,i)=>c.enqueue({type:'setAttendance',planId:String(i),attendance:'on_time'})));assert.deepEqual(seen,[0,1,2,3,4,5]);assert.equal(c.pending.length,0);assert.equal(c.data?.version,6);}finally{globalThis.fetch=original;}
});

test('HTML gateway failures keep the same operation retryable without logging out',async()=>{
 const original=globalThis.fetch;let fail=true;const ids:string[]=[];
 globalThis.fetch=async(url,init)=>{if(String(url).includes('session'))return Response.json({owner:'gateway-test',expiresAt:Date.now()+60000});if(String(url).includes('mutations')){ids.push(JSON.parse(String(init?.body)).operationId);return fail?new Response('Bad gateway',{status:502}):Response.json({version:1});}return Response.json({owner:'gateway-test',version:0,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});};
 try{const c=new TimeClient('personal',()=>{});await c.start();await c.enqueue({type:'setAttendance'});assert.equal(c.blocked,false);assert.equal(c.pending[0].state,'queued');fail=false;await c.sync();assert.equal(c.pending.length,0);assert.equal(ids[0],ids[1]);}finally{globalThis.fetch=original;}
});

test('discarding a conflict immediately resumes the next queued item without silently rebasing it',async()=>{
 const original=globalThis.fetch;let version=0,offline=false;const seen:number[]=[];
 globalThis.fetch=async(url,init)=>{if(offline)throw new TypeError('offline');if(String(url).includes('session'))return Response.json({owner:'discard-test',expiresAt:Date.now()+60000});if(String(url).includes('mutations')){const body=JSON.parse(String(init?.body));seen.push(body.baseVersion);return Response.json({error:'conflict'},{status:409});}return Response.json({owner:'discard-test',version,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});};
 try{const c=new TimeClient('personal',()=>{});await c.start();offline=true;await c.enqueue({type:'setAttendance',planId:'a'});await c.enqueue({type:'setAttendance',planId:'b'});offline=false;version=5;await c.sync();await c.resolve(c.pending[0].operationId,false);assert.deepEqual(seen,[0,1]);assert.equal(c.pending.length,1);assert.equal(c.pending[0].state,'conflict');assert.equal(c.pending[0].baseVersion,1);}finally{globalThis.fetch=original;}
});

test('server 500 persists its actual reason across reload and remains retryable',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>String(url).includes('session')?Response.json({owner:'server-error-test',expiresAt:Date.now()+60000}):String(url).includes('mutations')?Response.json({error:'storage unavailable'},{status:500}):Response.json({owner:'server-error-test',version:0,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});
 try{const c=new TimeClient('personal',()=>{});await c.start();await c.enqueue({type:'setAttendance'});assert.equal(c.pending[0].state,'queued');assert.match(c.pending[0].error!,/HTTP 500.*storage unavailable/);const id=c.pending[0].operationId;const reload=new TimeClient('personal',()=>{});await reload.start();assert.equal(reload.pending[0].operationId,id);assert.match(reload.pending[0].error!,/HTTP 500/);assert.equal(reload.blocked,false);}finally{globalThis.fetch=original;}
});
