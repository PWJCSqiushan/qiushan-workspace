import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1-helper.ts';
import {TimeStore} from '../lib/time-store.ts';
import {applyTimeMutation,DEFAULT_TIME_CATEGORIES,previewCourseMigration,type TimeSnapshot,type TimePlan} from '../lib/time-domain.ts';
import {handleTimeRequest} from '../lib/time-api.ts';
import {exportTimeBackup,validateTimeBackup} from '../lib/time-backup.ts';
const now=new Date('2026-09-24T12:00:00+08:00');
function plan(id='p1',patch:Partial<TimePlan>={}):TimePlan{return {id,start:'2026-09-21T00:00:00.000Z',end:'2026-09-21T00:45:00.000Z',categoryId:'class',status:'planned',courseName:'数据结构',importSource:'semester',sourcePeriods:[1],...patch};}
function state(plans:TimePlan[]):TimeSnapshot{return {owner:'test',space:'personal',version:0,categories:structuredClone([...DEFAULT_TIME_CATEGORIES]),intervals:[],plans,sources:[],timer:null,imports:[],corrections:[]};}
function apply(s:TimeSnapshot,mutation:Parameters<typeof applyTimeMutation>[1]){const result=applyTimeMutation(s,mutation,crypto.randomUUID(),now);if(result.correction)result.snapshot.corrections.push(result.correction);return result.snapshot;}
function pair(){return [plan(),plan('p2',{start:'2026-09-21T00:55:00.000Z',end:'2026-09-21T01:40:00.000Z',sourcePeriods:[2]})];}

test('course rollover merges provenance-confirmed periods including break, defaults attendance and is content-idempotent',()=>{
 const s=apply(state(pair()),{type:'rolloverCourses'});assert.equal(s.plans.length,1);assert.equal(s.plans[0].attendance,'on_time');assert.deepEqual(s.plans[0].sourcePeriods,[1,2]);assert.equal(s.intervals.length,1);assert.equal((Date.parse(s.intervals[0].end)-Date.parse(s.intervals[0].start))/60000,100);assert.deepEqual(apply(s,{type:'rolloverCourses'}),s);
});
test('manual entry overrides automatic class without replace and rollover fills only gaps',()=>{
 let s=apply(state(pair()),{type:'rolloverCourses'});s=apply(s,{type:'upsert',interval:{id:'manual',start:'2026-09-21T00:30:00.000Z',end:'2026-09-21T01:10:00.000Z',categoryId:'study'}});s=apply(s,{type:'rolloverCourses'});
 assert.equal(s.intervals.length,3);assert.equal(s.intervals.find(r=>r.id==='manual')?.generatedBy,undefined);assert.equal(s.intervals.filter(r=>r.generatedBy==='course').reduce((n,r)=>n+(Date.parse(r.end)-Date.parse(r.start))/60000,0),60);assert.deepEqual(apply(s,{type:'rolloverCourses'}),s);
});
test('setCourseState derives lateness buckets and excludes only linked actual; undo restores cancellation',()=>{
 let s=apply(state(pair()),{type:'rolloverCourses'});s=apply(s,{type:'setCourseState',id:'p1',lateMinutes:5});assert.equal(s.plans[0].attendance,'late_under_5');assert.equal(s.intervals[0].start,'2026-09-21T00:05:00.000Z');s=apply(s,{type:'setCourseState',id:'p1',lateMinutes:6});assert.equal(s.plans[0].attendance,'late_over_5');
 s=apply(s,{type:'upsert',interval:{id:'unrelated',start:'2026-09-21T04:00:00.000Z',end:'2026-09-21T05:00:00.000Z',categoryId:'study'}});const before=structuredClone(s);s=apply(s,{type:'setCourseState',id:'p1',cancelled:true});assert.deepEqual(s.intervals.map(r=>r.id),['unrelated']);s=apply(s,{type:'undo',correctionId:s.corrections.at(-1)!.id});assert.deepEqual(s.intervals,before.intervals);assert.equal(s.plans[0].status,before.plans[0].status);
 for(const status of ['absent','excused'] as const){const t=apply(before,{type:'setCourseState',id:'p1',status});assert.deepEqual(t.intervals.map(r=>r.id),['unrelated']);}
 const online=apply(before,{type:'setCourseState',id:'p1',deliveryMode:'online'});assert.deepEqual(online.intervals.map(r=>r.id),['unrelated']);assert.equal(apply(online,{type:'setCourseState',id:'p1',deliveryMode:'in_person'}).intervals.length,2);
});
test('future course permits exception presets but contributes no attendance or actual',()=>{
 let s=state([plan('future',{start:'2026-09-25T00:00:00.000Z',end:'2026-09-25T00:45:00.000Z'})]);s=apply(s,{type:'rolloverCourses'});assert.equal(s.plans[0].attendance,undefined);assert.equal(s.intervals.length,0);
 s=apply(s,{type:'setCourseState',id:'future',status:'excused',deliveryMode:'online',cancelled:true});assert.equal(s.intervals.length,0);assert.throws(()=>apply(s,{type:'setCourseState',id:'future',lateMinutes:2}),/结束/);s=apply(s,{type:'setCourseState',id:'future',cancelled:false});assert.equal(s.plans[0].status,'planned');
});
test('legacy missing provenance and contradictory half-periods remain untouched until explicit review; migration undo is exact',()=>{
 const plans=pair().map((p,i)=>({...p,courseName:undefined,importSource:undefined,sourcePeriods:undefined,sourceKey:'timetable:old'+i,note:'同一课程',attendance:i?'absent' as const:'on_time' as const,status:i?'cancelled' as const:'planned' as const}));const old=state(plans);const preview=previewCourseMigration(old);assert.equal(preview.conflicts.length,1);assert.ok(preview.conflicts[0].reasons.includes('partial_cancellation'));assert.deepEqual(apply(old,{type:'rolloverCourses'}),old);
 const groupKey=preview.groups[0].groupKey;assert.throws(()=>apply(old,{type:'migrateCourses',decisions:[{groupKey,action:'merge'}]}),/核对/);const migrated=apply(old,{type:'migrateCourses',decisions:[{groupKey,action:'merge',status:'on_time',cancelled:false}]});assert.equal(migrated.plans.length,1);assert.equal(migrated.intervals.length,1);const restored=apply(migrated,{type:'undo',correctionId:migrated.corrections.at(-1)!.id});assert.deepEqual(restored.plans,old.plans);assert.deepEqual(restored.intervals,old.intervals);
 const kept=apply(old,{type:'migrateCourses',decisions:[{groupKey,action:'keep'}]});assert.equal(kept.plans.length,2);assert.equal(previewCourseMigration(kept).conflicts.length,0);
});
test('legacy lateness without minutes keeps original actual and never invents an arrival',()=>{
 const old=state([plan('p1',{attendance:'late_over_5'})]);old.intervals=[{id:'actual-p1',start:old.plans[0].start,end:old.plans[0].end,categoryId:'class',manual:true}];const s=apply(old,{type:'rolloverCourses'});assert.equal(s.plans[0].lateMinutes,undefined);assert.equal(s.plans[0].attendance,'late_over_5');assert.equal(s.intervals[0].start,old.intervals[0].start);assert.equal(s.intervals[0].end,old.intervals[0].end);
});
test('same note or nearby time alone never authorizes automatic merge',()=>{
 const s=state(pair().map((p,i)=>({...p,courseName:undefined,importSource:undefined,sourcePeriods:undefined,note:'相同备注',sourceKey:'timetable:'+i})));assert.equal(apply(s,{type:'rolloverCourses'}).plans.length,2);
 const separate=state([plan(),plan('p2',{sourcePeriods:[2],importSource:'different',start:'2026-09-21T00:55:00.000Z',end:'2026-09-21T01:40:00.000Z'})]);assert.equal(apply(separate,{type:'rolloverCourses'}).plans.length,2);
});
test('course metadata survives D1, HTTP rollover, backup restore and repeated HTTP calls without version growth',async()=>{
 const {db}=database();const store=new TimeStore(db,'courses');await store.mutate({space:'personal',baseVersion:0,operationId:'seed',mutation:{type:'import',source:'semester',items:pair().map(p=>({...p,kind:'plan'}))}});
 const request=()=>new Request('https://test/api/time/courses/rollover',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({space:'personal'})});const first=await (await handleTimeRequest(request(),store)).json() as any;assert.equal(first.changed,true);assert.equal(first.snapshot.plans.length,1);const second=await (await handleTimeRequest(request(),store)).json() as any;assert.equal(second.changed,false);assert.equal(second.version,first.version);assert.deepEqual(second,{version:first.version,changed:false});assert.deepEqual(await store.snapshot('personal'),first.snapshot);
 const backup=await exportTimeBackup(store,'personal');await validateTimeBackup(backup);const {db:other}=database();const target=new TimeStore(other,'restored');await target.restoreSnapshot('personal',backup.time,'restore',0);assert.deepEqual((await target.snapshot('personal')).plans,backup.time.plans);assert.deepEqual((await target.snapshot('personal')).intervals,backup.time.intervals);
 const response=await handleTimeRequest(new Request('https://test/api/time/courses/migration?space=personal'),store);assert.equal(response.status,200);assert.equal((await response.json() as any).conflicts.length,0);
});

test('concurrent rollover requests converge at one changed version',async()=>{
 const {db}=database();const store=new TimeStore(db,'concurrent-courses');await store.mutate({space:'personal',baseVersion:0,operationId:'seed',mutation:{type:'import',source:'semester',items:pair().map(p=>({...p,kind:'plan'}))}});
 await Promise.all([store.rollover('personal'),store.rollover('personal')]);const s=await store.snapshot('personal');assert.equal(s.version,2);assert.equal(s.plans.length,1);assert.equal(s.intervals.length,1);
});
test('an explicitly timed named imported single course needs no migration decision',()=>{
 const s=apply(state([plan('direct',{sourceKey:'timetable:direct',sourcePeriods:undefined})]),{type:'rolloverCourses'});assert.equal(s.plans[0].attendance,'on_time');assert.equal(s.intervals.length,1);
});

function legacyActualFixture(){
 const plans=pair().map((p,i)=>({...p,courseName:undefined,importSource:undefined,sourcePeriods:undefined,sourceKey:'timetable:review'+i,note:'核对课程'}));
 const s=state(plans);
 s.intervals=[{id:'old-first',sourceKey:plans[0].sourceKey,start:plans[0].start,end:'2026-09-21T00:20:00.000Z',categoryId:'class',manual:true},
 {id:'independent',start:'2026-09-21T00:20:00.000Z',end:'2026-09-21T00:30:00.000Z',categoryId:'study',manual:true,note:'自主记录'},
 {id:'actual-p2',start:plans[1].start,end:plans[1].end,categoryId:'class',manual:true}];
 s.sources=[{sourceKey:plans[0].sourceKey!,kind:'actual',status:'active',manual:true,recordId:'old-first'}];return s;
}
test('migration accurate lateness and explicit normal replace only linked legacy actual and undo exactly',()=>{
 for(const decision of [{lateMinutes:6},{status:'on_time' as const}]){
  const old=legacyActualFixture();const groupKey=previewCourseMigration(old).groups[0].groupKey;
  const s=apply(old,{type:'migrateCourses',decisions:[{groupKey,action:'merge',...decision}]});
  assert.deepEqual(s.intervals.find(r=>r.id==='independent'),old.intervals[1]);assert.ok(!s.intervals.some(r=>['old-first','actual-p2'].includes(r.id)));
  const course=s.intervals.filter(r=>r.generatedBy==='course');assert.equal(course[0].start,decision.lateMinutes?'2026-09-21T00:06:00.000Z':old.plans[0].start);
  assert.equal(course.reduce((n,r)=>n+(Date.parse(r.end)-Date.parse(r.start))/60000,0),decision.lateMinutes?84:90);
  assert.equal(s.sources[0].kind,'plan');assert.equal(s.sources[0].recordId,'p1');
  const restored=apply(s,{type:'undo',correctionId:s.corrections.at(-1)!.id});assert.deepEqual(restored.intervals,old.intervals);assert.deepEqual(restored.sources,old.sources);assert.deepEqual(restored.plans,old.plans);
 }
});
test('keep assigns legacy actual association and later cancellation removes only that kept course',()=>{
 const old=legacyActualFixture();old.plans[0].courseGroupKey='old-key';old.intervals[0].courseGroupKey='old-key';delete old.intervals[0].sourceKey;old.sources=[];
 const groupKey=previewCourseMigration(old).groups[0].groupKey;const kept=apply(old,{type:'migrateCourses',decisions:[{groupKey,action:'keep'}]});
 assert.equal(kept.intervals.find(r=>r.id==='old-first')?.courseGroupKey,kept.plans[0].courseGroupKey);
 assert.equal(kept.intervals.find(r=>r.id==='actual-p2')?.courseGroupKey,kept.plans[1].courseGroupKey);
 const cancelled=apply(kept,{type:'setCourseState',id:'p1',cancelled:true});assert.ok(!cancelled.intervals.some(r=>r.id==='old-first'));assert.ok(cancelled.intervals.some(r=>r.id==='actual-p2'));assert.deepEqual(cancelled.intervals.find(r=>r.id==='independent'),old.intervals[1]);
 const restored=apply(cancelled,{type:'undo',correctionId:cancelled.corrections.at(-1)!.id});assert.deepEqual(restored.intervals,kept.intervals);
});

test('legacy queued first and second half IDs reject merged attendance operations, while current new UI ID works',()=>{
 const s=apply(state(pair()),{type:'rolloverCourses'});
 for(const id of ['p1','p2'])for(const mutation of [{type:'setAttendance' as const,id,status:'absent' as const},{type:'cancelPlan' as const,id},{type:'confirmPlan' as const,ids:[id]}]){
  assert.throws(()=>apply(s,mutation),(error:any)=>error.status===409&&error.details.code==='TIME_COURSE_MERGED_REVIEW_REQUIRED'&&error.details.currentPlanId==='p1'&&error.details.requestedId===id&&/原草稿保留/.test(error.message));
 }
 assert.throws(()=>apply(s,{type:'setCourseState',id:'p2',status:'absent'}),(error:any)=>error.status===409&&error.details.currentPlanId==='p1');
 const changed=apply(s,{type:'setCourseState',id:'p1',status:'absent'});assert.equal(changed.plans[0].attendance,'absent');assert.equal(changed.intervals.length,0);
});
test('reviewed single kept course remains compatible with legacy queue mutations',()=>{
 const old=state(pair());const groupKey=previewCourseMigration(old).groups[0].groupKey;const s=apply(old,{type:'migrateCourses',decisions:[{groupKey,action:'keep'}]});
 assert.equal(apply(s,{type:'setAttendance',id:'p1',status:'absent'}).plans[0].attendance,'absent');assert.equal(apply(s,{type:'cancelPlan',id:'p2'}).plans[1].status,'cancelled');
});
