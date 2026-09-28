import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSemesterGrid,parseWeeks,previewSemester,applySemester,SCHOOL_PERIODS,type SemesterPreset} from '../lib/time-semester.ts';
import {applyTimeMutation,DEFAULT_TIME_CATEGORIES,validateTimeCoreSnapshot,type TimeSnapshot} from '../lib/time-domain.ts';
import {TimeStore} from '../lib/time-store.ts';
import {database} from './d1-helper.ts';
const now=new Date('2026-09-28T12:00:00+08:00');
export function empty():TimeSnapshot{return {owner:'synthetic',space:'demo',version:0,categories:structuredClone([...DEFAULT_TIME_CATEGORIES]),intervals:[],plans:[],sources:[],timer:null,imports:[],corrections:[]};}
export function fixture():SemesterPreset{return {id:'synthetic',name:'合成课程',startDate:'2026-09-07',endWeek:20,periods:SCHOOL_PERIODS,calendar:[],calendarVerifiedThrough:'2026-10-10',lessons:[{code:'AA123',name:'合成课程',section:'01',weeks:[4,5],weekday:1,periods:[1,2,3,4],location:'无',deliveryMode:'in_person',cells:[]}]};}
function mutate(s:TimeSnapshot,m:Parameters<typeof applyTimeMutation>[1]){const r=applyTimeMutation(s,m,crypto.randomUUID(),now);if(r.correction)r.snapshot.corrections.push(r.correction);return r.snapshot;}
test('grid reads multi-course cells, noncontinuous weeks, duplicates and full lesson spans',()=>{
 const block='AA123-合成课程[01]\n2周,9周,星期1,第1节-第4节无';
 const {preset,issues}=parseSemesterGrid([['2026-2027学年第1学期','9月7日为第一周第一天'],['节次/星期','星期一','星期二','星期三','星期四','星期五','星期六','星期日'],['第1节-第2节',block+'\n\nBB456-线上课[02]\n1-8周(单),星期1,第1节-第2节线上教学-前卫'],['第3节-第4节',block]]);
 assert.deepEqual(issues,[]);assert.equal(preset.lessons.length,2);assert.deepEqual(preset.lessons[0].weeks,[2,9]);assert.equal(preset.lessons[0].cells.length,2);assert.equal(preset.lessons[0].location,'无');assert.equal(preset.lessons[0].deliveryMode,'in_person');assert.deepEqual(preset.lessons[1].weeks,[1,3,5,7]);assert.equal(preset.lessons[1].deliveryMode,'online');
 const rows=previewSemester(empty(),preset).rows.filter(r=>r.item.courseCode==='AA123');assert.equal(rows.length,2);assert.equal((Date.parse(rows[0].item.end)-Date.parse(rows[0].item.start))/60000,220);
 assert.deepEqual(parseWeeks('2周,9周'),[2,9]);assert.deepEqual(parseWeeks('1-8双周'),[2,4,6,8]);assert.throws(()=>parseWeeks('1-2-3周'));
});
test('stable identity excludes delivery/location, competing variants never silently overwrite',()=>{
 const p=fixture(),a=previewSemester(empty(),p).rows[0].item;const q=structuredClone(p);q.lessons[0].deliveryMode='online';q.lessons[0].location='线上';assert.equal(previewSemester(empty(),q).rows[0].item.logicalOccurrenceId,a.logicalOccurrenceId);
 q.lessons.push(p.lessons[0]);assert.equal(previewSemester(empty(),q).counts.conflict,4);
 const different=fixture();different.lessons.push({...different.lessons[0],code:'other'});assert.equal(previewSemester(empty(),different).counts.conflict,4);
});
test('calendar stops, unknown dates, moves and additions preserve teaching week; explicit teaching wins holiday',()=>{
 const p=fixture();p.calendar=[{id:'stop',date:'2026-09-28',action:'stop',note:'停课'},{id:'unknown',date:'2026-10-05',action:'unknown',note:'待确认'}];assert.deepEqual(previewSemester(empty(),p).rows.map(r=>r.state),['stopped','review']);assert.equal(applySemester(empty(),p,{},now).plans.length,0);
 p.calendar.push({id:'move',date:'2026-10-10',action:'move',originalDate:'2026-09-28',note:'明确移动'},{id:'extra',date:'2026-10-11',action:'add',originalDate:'2026-09-28',note:'加课'});const rows=previewSemester(empty(),p).rows;assert.equal(rows[0].item.teachingWeek,4);assert.equal(rows[0].item.teachingDate,'2026-09-28');assert.equal(rows[0].item.start.slice(0,10),'2026-10-10');assert.notEqual(rows[0].item.logicalOccurrenceId,rows[1].item.logicalOccurrenceId);assert.equal(rows[1].item.teachingWeek,4);
 p.calendar=[{id:'stop',date:'2026-09-28',action:'stop',note:''},{id:'teach',date:'2026-09-28',action:'teach',note:'明确安排'}];assert.equal(previewSemester(empty(),p).rows[0].state,'new');assert.match(previewSemester(empty(),p).notices[0],/2027/);
});
test('private preset, incremental repeated apply, cancellation and old IDs remain protected',()=>{
 let s=mutate(empty(),{type:'saveSemester',preset:fixture()});s=mutate(s,{type:'applySemester'});const count=s.plans.filter(p=>p.categoryId==='class').length;const ids=s.plans.map(p=>p.id);s=mutate(s,{type:'applySemester'});assert.equal(s.plans.filter(p=>p.categoryId==='class').length,count);assert.deepEqual(s.plans.map(p=>p.id),ids);
 const p=s.plans.find(p=>p.categoryId==='class')!;s=mutate(s,{type:'setCourseState',id:p.id,cancelled:true});s=mutate(s,{type:'applySemester'});assert.equal(s.plans.find(x=>x.id===p.id)?.status,'cancelled');
 const old=empty();old.plans=[{...p,id:'legacy',logicalOccurrenceId:undefined,sourceKey:'timetable:old',manual:true,status:'cancelled',attendance:'excused'}];const preview=previewSemester(old,fixture());assert.equal(preview.rows[0].state,'review');const mapped=applySemester(old,fixture(),{[preview.rows[0].item.logicalOccurrenceId!]:['legacy']},now);assert.equal(mapped.plans[0].id,'legacy');assert.equal(mapped.plans[0].attendance,'excused');assert.equal(mapped.plans[0].status,'cancelled');assert.ok(mapped.plans[0].logicalOccurrenceId);
});
test('explicit OCR identity mapping retains old entities and repeated apply is a no-op',()=>{
 let s=mutate(empty(),{type:'saveSemester',preset:fixture()});s=mutate(s,{type:'applySemester'});const version=s.version;s=mutate(s,{type:'applySemester'});assert.equal(s.version,version);
 const original=s.plans.find(p=>p.categoryId==='class')!;const old=empty();old.plans=[{...original,id:'ocr',sourceKey:'legacy-ocr',courseName:'合成课错字',note:'合成课错字',logicalOccurrenceId:undefined,status:'planned',attendance:'excused',manual:true}];
 const row=previewSemester(old,fixture()).rows[0];assert.equal(row.state,'conflict');assert.deepEqual(row.candidateIds,['ocr']);const applied=applySemester(old,fixture(),{[row.item.logicalOccurrenceId!]:['ocr']},now);assert.deepEqual({...applied.plans[0],logicalOccurrenceId:undefined},old.plans[0]);
});

test('D1 persists private preset and semester provenance with CAS, full backup core validates',async()=>{
 const {db,sqlite}=database();try{const store=new TimeStore(db,'test');await store.mutate({space:'personal',operationId:'save',baseVersion:0,mutation:{type:'saveSemester',preset:fixture()}});await store.mutate({space:'personal',operationId:'apply',baseVersion:1,mutation:{type:'applySemester'}});const s=await store.snapshot('personal');assert.equal(s.sources.find(s=>s.sourceKey==='semester-preset:synthetic')?.payload?.preset!=null,true);assert.equal(s.plans.find(p=>p.categoryId==='class')?.teachingWeek,4);assert.ok(s.plans.some(p=>p.generatedBy==='commute'||p.categoryId==='class'));validateTimeCoreSnapshot(s,{now:new Date('2027-01-01')});await assert.rejects(store.mutate({space:'personal',operationId:'stale',baseVersion:0,mutation:{type:'applySemester'}}));}finally{sqlite.close();}
});
