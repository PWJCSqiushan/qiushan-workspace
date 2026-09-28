import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCommutes,previewHistoricalCommutes,commuteEdge} from '../lib/time-commute.ts';
import {applyTimeMutation,DEFAULT_TIME_CATEGORIES,type TimeSnapshot,type TimePlan} from '../lib/time-domain.ts';
const now=new Date('2026-09-28T20:00:00+08:00');
function course(id:string,start:string,end:string):TimePlan{return {id,start:'2026-09-28T'+start+':00+08:00',end:'2026-09-28T'+end+':00+08:00',categoryId:'class',status:'planned',manual:false,courseName:id,originalPlanIds:[id]};}
function empty(plans:TimePlan[]):TimeSnapshot{return {owner:'test',space:'demo',version:0,categories:structuredClone([...DEFAULT_TIME_CATEGORIES]),intervals:[],plans,sources:[],timer:null,imports:[],corrections:[]};}
function mutate(s:TimeSnapshot,m:Parameters<typeof applyTimeMutation>[1]){const r=applyTimeMutation(s,m,crypto.randomUUID(),now);if(r.correction)r.snapshot.corrections.push(r.correction);return r.snapshot;}
function minutes(s:ReturnType<typeof reconcileCommutes>){return s.intervals.filter(r=>r.generatedBy==='commute').reduce((n,r)=>n+(Date.parse(r.end)-Date.parse(r.start))/60000,0);}
test('10+10 needs union without double counting and long gaps keep only their endpoints',()=>{
 assert.equal(minutes(reconcileCommutes(empty([course('a','08:00','09:40'),course('b','10:00','11:40')]),now)),40);
 const union=reconcileCommutes(empty([course('a','08:00','09:40'),course('b','10:00','11:40')]),now);assert.equal(union.intervals.length,3);const journey=union.intervals[1];assert.equal((Date.parse(journey.end)-Date.parse(journey.start))/60000,20);assert.equal(journey.commuteEdges?.length,2);
 assert.equal(minutes(reconcileCommutes(empty([course('a','08:00','09:40'),course('b','09:50','11:40')]),now)),30);
 const s=reconcileCommutes(empty([course('a','08:00','09:40'),course('b','13:30','15:10')]),now);assert.equal(minutes(s),40);assert.ok(!s.intervals.some(r=>Date.parse(r.start)<Date.parse('2026-09-28T12:00:00+08:00')&&Date.parse(r.end)>Date.parse('2026-09-28T12:00:00+08:00')));
});
test('late removes only own pre; cancel online absent excused remove own needs and retain neighbour',()=>{
 for(const patch of [{status:'cancelled' as const},{deliveryMode:'online' as const},{attendance:'absent' as const},{attendance:'excused' as const}])assert.equal(minutes(reconcileCommutes(empty([{...course('a','08:00','09:40'),...patch},course('b','09:50','11:40')]),now)),20);
 assert.equal(minutes(reconcileCommutes(empty([{...course('a','08:00','09:40'),attendance:'late_under_5'},course('b','09:50','11:40')]),now)),20);
});
test('effective Shanghai boundary, future hollow plans, historical preview never mutates',()=>{
 const p=course('old','08:00','09:40');p.start=p.start.replace('09-28','09-27');p.end=p.end.replace('09-28','09-27');const s=empty([p,course('new','08:00','09:40')]);assert.equal(minutes(reconcileCommutes(s,now)),20);assert.equal(previewHistoricalCommutes(s,now).length,2);assert.equal(s.intervals.length,0);
 const future=reconcileCommutes(empty([course('a','08:00','09:40')]),new Date('2026-09-28T07:00:00+08:00'));assert.equal(future.intervals.length,0);assert.equal(future.plans.filter(p=>p.categoryId==='commute').length,2);
});
test('manual fill gaps, deletion suppresses occurrence edge, restore and undo survive rollover',()=>{
 let s=mutate(empty([course('a','08:00','09:40')]),{type:'rolloverCourses'});const edge=s.intervals.find(r=>r.generatedBy==='commute')!;s=mutate(s,{type:'delete',id:edge.id});assert.equal(minutes(s),10);s=mutate(s,{type:'rolloverCourses'});assert.equal(minutes(s),10);
 s=mutate(s,{type:'restoreCommute',edges:edge.commuteEdges!});assert.equal(minutes(s),20);s=mutate(s,{type:'undo',correctionId:s.corrections.at(-1)!.id});assert.equal(minutes(s),10);
 s=mutate(s,{type:'restoreCommute',edges:edge.commuteEdges!});s=mutate(s,{type:'upsert',interval:{id:'manual',start:'2026-09-28T07:55:00+08:00',end:'2026-09-28T08:00:00+08:00',categoryId:'study'}});assert.equal(minutes(s),15);assert.ok(s.intervals.some(r=>r.id==='manual'));
});
test('manual change auto edge suppresses its regeneration; legacy attendance queue recomputes',()=>{
 let s=mutate(empty([course('a','08:00','09:40')]),{type:'rolloverCourses'});const edge=s.intervals.find(r=>r.generatedBy==='commute')!;s=mutate(s,{type:'upsert',interval:{...edge,end:'2026-09-28T07:55:00+08:00'}});assert.ok(s.sources.some(x=>x.sourceKey===commuteEdge(s.plans.find(p=>p.id==='a')!,'pre')&&x.payload?.suppressed));s=mutate(s,{type:'rolloverCourses'});assert.equal(minutes(s),10);
 s=mutate(s,{type:'setAttendance',id:'a',status:'absent'});assert.equal(minutes(s),0);
 assert.equal(s.intervals.filter(r=>r.categoryId==='class').length,0);
});
