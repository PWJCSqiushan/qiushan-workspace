import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TimeClient,timeRequest,TimeRequestError} from '../lib/time-client.ts';

test('an edit made during rollover uses its receipt version; automatic work never overtakes outbox',async()=>{
 const original=globalThis.fetch;let version=0,hold=false,offline=false;const calls:string[]=[];
 let entered!:()=>void,release!:()=>void;
 const enteredPromise=new Promise<void>(r=>entered=r),releasePromise=new Promise<void>(r=>release=r);
 const snapshot=()=>({owner:'rollover-version-reservation',version,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]});
 globalThis.fetch=async(url,init)=>{
  if(offline)throw new TypeError('offline');
  if(String(url).includes('session'))return Response.json({owner:snapshot().owner,expiresAt:Date.now()+60000});
  if(String(url).includes('/rollover')){calls.push('rollover');if(hold){hold=false;entered();await releasePromise;version++;return Response.json({version,changed:true,snapshot:snapshot()});}return Response.json({version,changed:false,snapshot:snapshot()});}
  if(String(url).includes('/mutations')){const b=JSON.parse(String(init?.body));calls.push('edit:'+b.baseVersion);assert.equal(b.baseVersion,version);version++;return Response.json({version,snapshot:snapshot()});}
  return Response.json(snapshot());
 };
 try{const client=new TimeClient('personal',()=>{});await client.start();calls.length=0;hold=true;const sync=client.sync();await enteredPromise;const edit=client.enqueue({type:'setCourseState',id:'course',status:'on_time'});release();await Promise.all([sync,edit]);assert.deepEqual(calls.slice(0,2),['rollover','edit:1']);assert.equal(client.pending.length,0);offline=true;assert.equal((await client.enqueue({type:'setCourseState',id:'course',status:'absent'})).state,'queued');calls.length=0;offline=false;await client.sync();assert.equal(calls[0],'edit:2');assert.equal(calls[1],'rollover');}finally{globalThis.fetch=original;}
});

test('rollover does not run with unresolved conflict, and failed saves surface their reason',async()=>{
 const original=globalThis.fetch;let rollover=0;
 const data={owner:'rollover-conflict-gate',version:0,categories:[],intervals:[],plans:[],timer:null,imports:[],corrections:[]};
 globalThis.fetch=async url=>{if(String(url).includes('session'))return Response.json({owner:data.owner,expiresAt:Date.now()+60000});if(String(url).includes('mutations'))return Response.json({error:'课程合并关系需要核对'},{status:409});if(String(url).includes('rollover')){rollover++;return Response.json({version:0,changed:false,snapshot:data});}return Response.json(data);};
 try{const c=new TimeClient('personal',()=>{});await c.start();assert.equal(rollover,1);await assert.rejects(c.enqueue({type:'setCourseState',id:'old-half'}),/合并关系需要核对/);await c.sync();assert.equal(rollover,1);assert.equal(c.pending[0].state,'conflict');}finally{globalThis.fetch=original;}
});

test('HTTP and malformed responses are distinguishable from network failure',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>new Response('gateway',{status:502});await assert.rejects(timeRequest('/api/time/sync'),(e:unknown)=>e instanceof TimeRequestError&&e.status===502&&e.message.includes('HTTP 502'));globalThis.fetch=async()=>new Response('{',{headers:{'Content-Type':'application/json'}});await assert.rejects(timeRequest('/api/time/sync'),(e:unknown)=>e instanceof TimeRequestError&&e.message.includes('响应不完整'));}finally{globalThis.fetch=original;}
});
