import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {TimeStore} from '../lib/time-store.ts';
import {DEFAULT_TIME_CATEGORIES,type TimeSnapshot} from '../lib/time-domain.ts';

test('real D1 retains large history and replays compressed receipts exactly',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-05-15'});
 try{
  const db=await mf.getD1Database('DB');for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()){for(const sql of readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();}
  const intervals=Array.from({length:80},(_,i)=>({id:'interval-'+i,start:new Date(Date.UTC(2026,0,1,i)).toISOString(),end:new Date(Date.UTC(2026,0,1,i)+1800000).toISOString(),categoryId:'study',note:'synthetic '.repeat(100)}));
  const plans=[{id:'course',start:'2026-01-01T08:00:00.000Z',end:'2026-01-01T09:00:00.000Z',categoryId:'class',status:'planned' as const}];
  const core={categories:[...DEFAULT_TIME_CATEGORIES],intervals,plans,timer:null,sources:[]};
  const snapshot:TimeSnapshot={...core,owner:'synthetic',space:'personal',version:0,imports:[],corrections:Array.from({length:23},(_,i)=>({id:'correction-'+i,operationId:'prior-'+i,kind:'upsert',before:core,after:core,undone:false,createdAt:'2026-01-05T00:00:00.000Z'}))};
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot))>3500000);
  const store=new TimeStore(db as unknown as D1Database,'synthetic');await store.restoreSnapshot('personal',snapshot,'large-history',0);
  const op={space:'personal',baseVersion:1,operationId:'attendance-large',mutation:{type:'setAttendance',id:'course',status:'on_time'}};
  const result=await store.mutate(op);assert.equal(result.version,2);assert.deepEqual(await store.mutate(op),result);
  const raw=await db.prepare('SELECT result_json FROM time_receipts WHERE operation_id=?').bind(op.operationId).first<{result_json:string}>();assert.ok(raw!.result_json.startsWith('gzip:'));assert.ok(Buffer.byteLength(raw!.result_json)<2000000);
  const current=await store.snapshot('personal');assert.equal(current.corrections.length,24);assert.equal(current.intervals.length,80);assert.equal(current.plans[0].attendance,'on_time');
  await store.mutate({space:'personal',baseVersion:2,operationId:'upsert-large',mutation:{type:'upsert',interval:{id:'new',start:'2026-02-01T08:00:00.000Z',end:'2026-02-01T08:30:00.000Z',categoryId:'study'}}});assert.equal((await store.snapshot('personal')).intervals.length,81);
  assert.deepEqual(await store.mutate(op),result);assert.equal((await store.snapshot('personal')).version,3);
 }finally{await mf.dispose();}
});

