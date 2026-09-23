import test from 'node:test';
import assert from 'node:assert/strict';
import {categoryTotals,attendanceTotals,weeklyComparison,weekStart} from '../lib/time-analytics.ts';
const now=Date.parse('2026-09-23T12:00:00+08:00');
const cats=[{id:'class',name:'上课',color:'#abcdef'},{id:'sleep',name:'睡眠',color:'#123456'}];
void test('rolling totals clip both boundaries and retain exact minutes',()=>{
 const rows=[{start:'2026-09-22T11:30+08:00',end:'2026-09-22T12:30+08:00',categoryId:'class'},{start:'2026-09-23T11:45+08:00',end:'2026-09-23T12:30+08:00',categoryId:'class'}];
 assert.equal(categoryTotals(rows,cats,now-86400000,now)[0].value,45);
});
void test('attendance keeps confirmed unknown separate, excludes future and cancelled without a label',()=>{
 const base={start:'2026-09-23T08:00+08:00',end:'2026-09-23T08:45+08:00',categoryId:'class',status:'confirmed'};
 const values=attendanceTotals([base,{...base,status:'cancelled'},{...base,attendance:'late_under_5'},{...base,status:'cancelled',attendance:'excused'},{...base,end:'2026-09-23T18:00+08:00'}],now-86400000,now);
 assert.equal(values.reduce((s,v)=>s+v.value,0),3);assert.equal(values.find(v=>v.id==='unknown')?.value,1);assert.equal(values.find(v=>v.id==='on_time')?.value,0);assert.equal(values.find(v=>v.id==='excused')?.value,1);
});
void test('weekly comparison uses Shanghai Monday boundaries and complete equal length weeks',()=>{
 assert.equal(new Date(weekStart(now)).toISOString(),'2026-09-20T16:00:00.000Z');
 const result=weeklyComparison([{start:'2026-09-20T23:30+08:00',end:'2026-09-21T00:30+08:00',categoryId:'sleep'}],cats,now,2);
 assert.equal(result.series.length,2);assert.ok(result.series.every(w=>w.end-w.start===7*86400000));assert.equal(result.axes.find(a=>a.id==='sleep')?.w1,.5);
});
