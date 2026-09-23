import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1-helper.ts';
import {TimeConflictError,TimeStore} from '../lib/time-store.ts';
import {exportTimeBackup,validateTimeBackup} from '../lib/time-backup.ts';

async function fixture(owner='owner-time'){const {db,sqlite}=database();const store=new TimeStore(db,owner);await store.snapshot('personal');return {db,sqlite,store};}
function op(baseVersion:number,operationId:string,mutation:unknown){return {space:'personal',baseVersion,operationId,mutation};}

test('multiple imported plans keep identities across reads and subset confirmation',async()=>{
  const {store}=await fixture();
  const items=[21,22,23].map(day=>({kind:'plan' as const,categoryId:'class',start:`2026-09-${day}T08:00+08:00`,end:`2026-09-${day}T08:45+08:00`,sourceKey:`class:week3:${day}:1`}));
  const imported=await store.mutate(op(0,'multi-plan-import',{type:'import',source:'timetable',items}));
  const before=await store.snapshot('personal');
  assert.deepEqual(before.plans,(imported.snapshot as any).plans);
  assert.equal(new Set(before.plans.map(plan=>plan.id)).size,3);
  assert.ok(before.plans.every(plan=>plan.id&&plan.id!=='undefined'));
  const ids=before.plans.slice(0,2).map(plan=>plan.id);
  const request=op(before.version,'multi-plan-confirm',{type:'confirmPlan',ids,replace:false});
  const result=await store.mutate(request);
  assert.deepEqual(await store.mutate(request),result);
  const after=await store.snapshot('personal');
  assert.deepEqual(after.plans,(result.snapshot as any).plans);
  assert.equal(after.intervals.length,2);
  assert.deepEqual(after.plans.filter(plan=>plan.status==='confirmed').map(plan=>plan.id),ids);
  assert.equal(after.plans.filter(plan=>plan.status==='planned').length,1);
  assert.equal(after.intervals.reduce((sum,item)=>sum+(Date.parse(item.end)-Date.parse(item.start))/60000,0),90);
  for(const source of after.sources){
    const record=[...after.intervals,...after.plans].find(item=>item.id===source.recordId);
    assert.ok(record,`source ${source.sourceKey} points to a stored record`);
    assert.equal(record.sourceKey,source.sourceKey);
  }
});

test('time store seeds categories, exact upsert is idempotent, and CAS returns latest',async()=>{
  const {store}=await fixture();let snapshot=await store.snapshot('personal');assert.equal(snapshot.version,0);assert.equal(snapshot.categories.length,12);assert.equal(snapshot.categories.find(item=>item.id==='unrecorded')?.name,'未记录');
  const request=op(0,'time-upsert-1',{type:'upsert',interval:{start:'2026-09-21T08:10+08:00',end:'2026-09-21T09:35+08:00',categoryId:'study',note:'85 分钟'}});
  const first=await store.mutate(request);assert.equal(first.version,1);snapshot=await store.snapshot('personal');assert.equal(snapshot.intervals.length,1);assert.equal(Date.parse(snapshot.intervals[0].end)-Date.parse(snapshot.intervals[0].start),85*60000);
  const duplicate=await store.mutate({...request,baseVersion:0});assert.deepEqual(duplicate,first);assert.equal((await store.snapshot('personal')).version,1);
  await assert.rejects(()=>store.mutate(op(0,'time-conflict-1',{type:'category',category:{id:'custom',name:'自定义',color:'#abcdef',active:true}})),(error:unknown)=>error instanceof TimeConflictError&&error.latest.version===1);
});

test('overlap requires explicit replace, split is reversible through correction undo',async()=>{
  const {store}=await fixture();let s=await store.snapshot('personal');
  await store.mutate(op(s.version,'overlap-base',{type:'upsert',interval:{id:'base',start:'2026-09-21T14:00+08:00',end:'2026-09-21T16:00+08:00',categoryId:'study'}}));s=await store.snapshot('personal');
  await assert.rejects(()=>store.mutate(op(s.version,'overlap-reject',{type:'upsert',interval:{id:'next',start:'2026-09-21T15:00+08:00',end:'2026-09-21T17:00+08:00',categoryId:'exercise'}})),/重叠/);
  const replaced=await store.mutate(op(s.version,'overlap-replace',{type:'upsert',interval:{id:'next',start:'2026-09-21T15:00+08:00',end:'2026-09-21T17:00+08:00',categoryId:'exercise'},replace:true}));
  const after=await store.snapshot('personal');assert.equal(after.intervals.length,2);assert.deepEqual(after.intervals.map(item=>[item.start,item.end,item.categoryId]),[['2026-09-21T06:00:00.000Z','2026-09-21T07:00:00.000Z','study'],['2026-09-21T07:00:00.000Z','2026-09-21T09:00:00.000Z','exercise']]);
  const correction=(replaced.snapshot as any).corrections.at(-1);assert.ok(correction?.id);
  const undone=await store.mutate(op(after.version,'overlap-undo',{type:'undo',correctionId:correction.id}));const restored=await store.snapshot('personal');assert.equal(restored.intervals.length,1);assert.equal(restored.intervals[0].id,'base');assert.equal((undone.snapshot as any).version,after.version+1);
});

test('timer has one active record, long records require confirmation, and imports preserve cancelled sources',async()=>{
  const {store}=await fixture();let s=await store.snapshot('personal');await store.mutate(op(s.version,'timer-start',{type:'timerStart',start:'2026-09-21T08:00+08:00',categoryId:'study'}));s=await store.snapshot('personal');await assert.rejects(()=>store.mutate(op(s.version,'timer-start-2',{type:'timerStart',categoryId:'exercise'})),/已有计时/);
  await assert.rejects(()=>store.mutate(op(s.version,'timer-stop-long',{type:'timerStop',end:'2026-09-22T04:00+08:00'})),/18 小时/);s=await store.snapshot('personal');const stopped=await store.mutate(op(s.version,'timer-stop-ok',{type:'timerStop',end:'2026-09-21T09:00+08:00'}));assert.equal((stopped.snapshot as any).timer,null);
  s=await store.snapshot('personal');const candidate={start:'2026-09-25T10:00+08:00',end:'2026-09-25T11:00+08:00',categoryId:'class',sourceKey:'class:2026-09-25:1',kind:'plan' as const};const imported=await store.mutate(op(s.version,'class-import-1',{type:'import',source:'timetable',items:[candidate]}));s=await store.snapshot('personal');const plan=s.plans[0];assert.equal(plan.status,'planned');await store.mutate(op(s.version,'class-cancel',{type:'cancelPlan',id:plan.id}));s=await store.snapshot('personal');await store.mutate(op(s.version,'class-import-2',{type:'import',source:'timetable',items:[candidate]}));s=await store.snapshot('personal');assert.equal(s.plans.find(item=>item.id===plan.id)?.status,'cancelled');assert.equal(s.plans.length,1);assert.equal((imported.snapshot as any).plans.length,1);
});

test('time backup hash is verifiable and restore does not depend on workflow tables',async()=>{
  const source=await fixture('owner-backup-a');let s=await source.store.snapshot('personal');await source.store.mutate(op(s.version,'backup-item',{type:'upsert',interval:{start:'2026-09-21T08:10+08:00',end:'2026-09-21T09:35+08:00',categoryId:'study'}}));const backup=await exportTimeBackup(source.store,'personal');assert.equal((await validateTimeBackup(backup)).sha256,backup.sha256);await assert.rejects(()=>validateTimeBackup({...backup,sha256:'bad'}),/校验失败/);
  const target=new TimeStore(source.db,'owner-backup-b');const restored=await target.restoreSnapshot('personal',backup.time,'restore-time-1',0);assert.equal((restored.snapshot as any).intervals.length,1);assert.equal((await target.snapshot('personal')).intervals.length,1);
});

test('UI restore verifies hash and restores import and correction history',async()=>{
 const {store}=await fixture();await store.mutate(op(0,'restore-base',{type:'upsert',interval:{id:'restore-item',start:'2026-09-20T14:10+08:00',end:'2026-09-20T15:35+08:00',categoryId:'study'}}));
 const backup=await exportTimeBackup(store,'personal');const tampered=structuredClone(backup);tampered.time.intervals[0].categoryId='sleep';
 await assert.rejects(()=>store.mutate(op(1,'restore-tampered',{type:'restore',backup:tampered})),/哈希|校验/);
 await store.mutate(op(1,'delete-before-restore',{type:'delete',id:'restore-item'}));
 const request=op(2,'ui-restore',{type:'restore',backup});const receipt=await store.mutate(request);
 assert.deepEqual(await store.mutate(request),receipt);const s=await store.snapshot('personal');assert.deepEqual(s.corrections,backup.time.corrections);assert.deepEqual(s.intervals,backup.time.intervals);
});
test('Garmin recheck updates untouched day, removes obsolete segments, protects whole manually edited day',async()=>{
 const {store}=await fixture();
 const item={kind:'actual',categoryId:'sleep',start:'2026-09-20T00:00+08:00',end:'2026-09-20T07:00+08:00',sourceKey:'garmin:cn:2026-09-20:sleep:0',estimated:false};
 await store.mutate(op(0,'sleep-first',{type:'import',source:'garmin-cn',items:[item]}));
 await store.mutate(op(1,'sleep-update',{type:'import',source:'garmin-cn',items:[{...item,end:'2026-09-20T06:30+08:00'}]}));
 let s=await store.snapshot('personal');assert.equal(s.intervals.length,1);assert.equal(s.intervals[0].end,'2026-09-19T22:30:00.000Z');
 await store.mutate(op(2,'manual-sleep',{type:'upsert',interval:{...s.intervals[0],end:'2026-09-20T06:15+08:00'}}));
 await store.mutate(op(3,'sleep-protected',{type:'import',source:'garmin-cn',items:[item]}));
 s=await store.snapshot('personal');assert.equal(s.intervals[0].end,'2026-09-19T22:15:00.000Z');assert.equal(s.imports.at(-1)?.skipped,1);
});
