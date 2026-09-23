import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1-helper.ts';
import {TimeStore} from '../lib/time-store.ts';
import {exportTimeBackup} from '../lib/time-backup.ts';

function fixture(owner='attendance-owner'){
  const {db,sqlite}=database();
  return {db,sqlite,store:new TimeStore(db,owner)};
}

function op(baseVersion:number,operationId:string,mutation:unknown){
  return {space:'personal' as const,baseVersion,operationId,mutation};
}

function relativeIso(minutes:number){
  return new Date(Date.now()+minutes*60_000).toISOString();
}

function planItem(sourceKey:string,startMinutes:number,endMinutes:number){
  return {
    kind:'plan' as const,
    categoryId:'class',
    start:relativeIso(startMinutes),
    end:relativeIso(endMinutes),
    sourceKey,
  };
}

void test('出勤状态支持多计划保存、重读、更新，并保护导入回拉',async()=>{
  const {store}=fixture();
  const items=[
    planItem('class:attendance:past-1',-120,-60),
    planItem('class:attendance:past-2',-240,-180),
    planItem('class:attendance:future',60,120),
  ];
  const imported=await store.mutate(op(0,'attendance-import',{type:'import',source:'timetable',items}));
  const first=await store.snapshot('personal');
  assert.equal(first.plans.length,3);
  assert.equal(first.intervals.length,0);
  assert.equal(new Set(first.plans.map(plan=>plan.id)).size,3);
  const past1=first.plans.find(plan=>plan.sourceKey===items[0].sourceKey)!;
  const past2=first.plans.find(plan=>plan.sourceKey===items[1].sourceKey)!;
  const future=first.plans.find(plan=>plan.sourceKey===items[2].sourceKey)!;

  const marked=await store.mutate(op(first.version,'attendance-mark-1',{type:'setAttendance',id:past1.id,status:'late_under_5'}));
  const markedSnapshot=await store.snapshot('personal');
  assert.equal(markedSnapshot.plans.find(plan=>plan.id===past1.id)?.attendance,'late_under_5');
  assert.equal(markedSnapshot.plans.find(plan=>plan.id===past1.id)?.status,'planned');
  assert.equal(markedSnapshot.intervals.length,0);
  assert.equal((marked.snapshot as {intervals:unknown[]}).intervals.length,0);

  const updated=await store.mutate(op(markedSnapshot.version,'attendance-upsert-preserve',{type:'upsertPlan',plan:{id:past1.id,start:past1.start,end:past1.end,categoryId:'class',note:'课程备注'}}));
  const updatedSnapshot=await store.snapshot('personal');
  assert.equal(updatedSnapshot.plans.find(plan=>plan.id===past1.id)?.attendance,'late_under_5');
  assert.equal(updatedSnapshot.plans.find(plan=>plan.id===past1.id)?.note,'课程备注');

  const confirmed=await store.mutate(op(updatedSnapshot.version,'attendance-confirm-existing',{type:'confirmPlan',ids:[past2.id]}));
  const confirmedSnapshot=await store.snapshot('personal');
  assert.equal(confirmedSnapshot.intervals.length,1);
  const actualBeforeAttendance=structuredClone(confirmedSnapshot.intervals);
  const second=await store.mutate(op(confirmedSnapshot.version,'attendance-mark-2',{type:'setAttendance',id:past2.id,status:'on_time'}));
  const secondSnapshot=await store.snapshot('personal');
  assert.equal(secondSnapshot.plans.find(plan=>plan.id===past2.id)?.attendance,'on_time');
  assert.deepEqual(secondSnapshot.intervals,actualBeforeAttendance);

  const repull=await store.mutate(op(secondSnapshot.version,'attendance-repull',{type:'import',source:'timetable',items:[{...items[0],end:relativeIso(-30)}]}));
  const repullSnapshot=await store.snapshot('personal');
  assert.equal((repull as {skipped?:unknown}).skipped,undefined);
  assert.equal(repullSnapshot.plans.find(plan=>plan.id===past1.id)?.attendance,'late_under_5');
  assert.equal(repullSnapshot.plans.length,3);
  assert.equal(repullSnapshot.imports.at(-1)?.skipped,1);
  assert.equal(repullSnapshot.plans.find(plan=>plan.id===future.id)?.attendance,undefined);
  void imported;void confirmed;void second;void updated;
});

void test('出勤状态只允许已结束的课程，非法状态和非课程会被拒绝',async()=>{
  const {store}=fixture('attendance-validation-owner');
  const imported=await store.mutate(op(0,'validation-import',{type:'import',source:'timetable',items:[planItem('class:attendance:ended',-120,-60),planItem('class:attendance:future',60,120)]}));
  let snapshot=await store.snapshot('personal');
  const ended=snapshot.plans.find(plan=>plan.sourceKey==='class:attendance:ended')!;
  const future=snapshot.plans.find(plan=>plan.sourceKey==='class:attendance:future')!;
  await assert.rejects(()=>store.mutate(op(snapshot.version,'invalid-attendance',{type:'setAttendance',id:ended.id,status:'unknown'} as unknown)),/出勤状态无效/);
  snapshot=await store.snapshot('personal');
  await assert.rejects(()=>store.mutate(op(snapshot.version,'direct-attendance-bypass',{type:'upsertPlan',plan:{id:ended.id,start:ended.start,end:ended.end,categoryId:'class',attendance:'absent'}} as unknown)),/setAttendance/);
  snapshot=await store.snapshot('personal');
  await assert.rejects(()=>store.mutate(op(snapshot.version,'future-attendance',{type:'setAttendance',id:future.id,status:'absent'})),/尚未结束/);
  snapshot=await store.snapshot('personal');
  await store.mutate(op(snapshot.version,'mark-ended',{type:'setAttendance',id:ended.id,status:'on_time'}));
  snapshot=await store.snapshot('personal');
  await assert.rejects(()=>store.mutate(op(snapshot.version,'retime-labeled-future',{type:'upsertPlan',plan:{id:ended.id,start:relativeIso(60),end:relativeIso(120),categoryId:'class'}})),/未来/);
  snapshot=await store.snapshot('personal');
  await assert.rejects(()=>store.mutate(op(snapshot.version,'retag-labeled-study',{type:'upsertPlan',plan:{id:ended.id,start:ended.start,end:ended.end,categoryId:'study'}})),/课程分类/);
  const final=await store.snapshot('personal');
  assert.equal(final.plans.find(plan=>plan.id===ended.id)?.attendance,'on_time');
  assert.equal(final.intervals.length,0);
  assert.equal((imported.snapshot as {intervals:unknown[]}).intervals.length,0);
});

void test('出勤元数据参与 undo 和备份恢复，恢复后保持完整',async()=>{
  const {store}=fixture('attendance-backup-owner');
  await store.mutate(op(0,'backup-import',{type:'import',source:'timetable',items:[planItem('class:attendance:backup',-180,-120)]}));
  let snapshot=await store.snapshot('personal');
  const plan=snapshot.plans[0];
  const marked=await store.mutate(op(snapshot.version,'backup-mark',{type:'setAttendance',id:plan.id,status:'excused'}));
  snapshot=await store.snapshot('personal');
  assert.equal(snapshot.plans[0].attendance,'excused');
  const correction=snapshot.corrections.at(-1)!;
  const undone=await store.mutate(op(snapshot.version,'backup-undo',{type:'undo',correctionId:correction.id}));
  const undoneSnapshot=await store.snapshot('personal');
  assert.equal(undoneSnapshot.plans[0].attendance,undefined);
  assert.equal(undoneSnapshot.intervals.length,0);
  void undone;void marked;

  snapshot=await store.snapshot('personal');
  await store.mutate(op(snapshot.version,'backup-mark-again',{type:'setAttendance',id:plan.id,status:'late_over_5'}));
  const backup=await exportTimeBackup(store,'personal');
  snapshot=await store.snapshot('personal');
  await store.mutate(op(snapshot.version,'backup-change',{type:'setAttendance',id:plan.id,status:'on_time'}));
  snapshot=await store.snapshot('personal');
  await store.mutate(op(snapshot.version,'backup-restore',{type:'restore',backup} as unknown));
  const restored=await store.snapshot('personal');
  assert.equal(restored.plans[0].attendance,'late_over_5');
  assert.equal(restored.intervals.length,0);
  assert.deepEqual(restored.plans.map(({id,attendance})=>({id,attendance})),backup.time.plans.map(({id,attendance})=>({id,attendance})));
});
