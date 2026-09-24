import test from 'node:test';
import assert from 'node:assert/strict';
import {bucketTimeRanges,centerTimeWindow,clampTimeWindow,dayNumber,dayString,defaultTimeWindow,moveTimeWindow,resizeTimeWindow,timeDateTickIndices,zoomTimeWindow} from '../lib/time-window.ts';
import {summarizeTimeSlot,TIME_SLOT_MS} from '../lib/time-grid.ts';
const domain={start:'2024-01-01',end:'2027-12-31'};
void test('default is 54 past days, today, and five future days across leap boundary',()=>{
 const v=defaultTimeWindow('2024-03-01');assert.deepEqual(v,{start:'2024-01-07',days:60});assert.equal(dayString(dayNumber(v.start)+v.days-1),'2024-03-06');
 assert.throws(()=>dayNumber('2023-02-29'),RangeError);
});
void test('window sizes and inclusive domain bounds clamp correctly',()=>{
 assert.deepEqual(clampTimeWindow({start:'2020-01-01',days:1},domain),{start:domain.start,days:7});
 const v=clampTimeWindow({start:'2030-01-01',days:999},domain);assert.equal(v.days,120);assert.equal(dayString(dayNumber(v.start)+119),domain.end);
 assert.deepEqual(clampTimeWindow({start:'2026-01-01',days:60},{start:'2026-01-01',end:'2026-01-02'}),{start:'2026-01-01',days:7});
 assert.throws(()=>clampTimeWindow(v,{start:'2026-01-02',end:'2026-01-01'}),RangeError);
});
void test('pan and center preserve size near both edges',()=>{
 const v=defaultTimeWindow('2026-09-24');assert.equal(moveTimeWindow(v,-10000,domain).start,domain.start);
 assert.equal(dayString(dayNumber(moveTimeWindow(v,10000,domain).start)+59),domain.end);
 assert.equal(centerTimeWindow(domain.start,60,domain).start,domain.start);
 assert.equal(dayNumber(centerTimeWindow('2026-09-24',7,domain).start),dayNumber('2026-09-24')-3);
});
void test('resize fixes the opposite endpoint and never crosses or exceeds 120',()=>{
 const v=defaultTimeWindow('2026-09-24'),end=dayNumber(v.start)+59;
 for(const delta of [-10000,-60,-1,0,1,60,10000]){
  const left=resizeTimeWindow(v,'start',delta,domain),right=resizeTimeWindow(v,'end',delta,domain);
  assert.equal(dayNumber(left.start)+left.days-1,end);assert.equal(right.start,v.start);
  for(const next of [left,right])assert.ok(next.days>=7&&next.days<=120);
 }
});
void test('zoom preserves cursor anchor within rounding and clamps domain',()=>{
 const v=defaultTimeWindow('2026-09-24');
 for(const anchor of [0,.25,.5,1]){const z=zoomTimeWindow(v,30,anchor,domain);assert.ok(Math.abs(dayNumber(z.start)+z.days*anchor-dayNumber(v.start)-v.days*anchor)<=.5);}
 assert.equal(zoomTimeWindow({start:domain.start,days:60},120,.5,domain).start,domain.start);
});
void test('ticks adapt at required viewport widths without crowding today',()=>{
 for(const viewport of [1366,1920,1024,1180])for(const count of [7,60,120]){
  const width=(viewport-100)*2/3-34,today=Math.min(count-1,54),ticks=[...timeDateTickIndices(count,width,today)].sort((a,b)=>a-b);
  assert.ok(ticks.includes(today));for(let i=1;i<ticks.length;i++)assert.ok((ticks[i]-ticks[i-1])*width/count>=34);
 }
 assert.ok(timeDateTickIndices(120,1200).size>timeDateTickIndices(120,400).size);
});
void test('visible slot index preserves exact summaries, midnight, plans, gaps and tie ordering',()=>{
 const base=Date.parse('2026-09-23T00:00:00+08:00'),range=(a:number,b:number,categoryId:string)=>({start:new Date(base+a*60000).toISOString(),end:new Date(base+b*60000).toISOString(),categoryId});
 const rows=[range(-5,5,'study'),range(5,8,'meal'),range(8,10,'study'),range(1435,1455,'sleep'),range(-100,-90,'outside'),range(2880,2900,'outside'),{start:'bad',end:'bad',categoryId:'bad'}],plans=[range(1440,1500,'class')];
 const actual=bucketTimeRanges(rows,base,288,TIME_SLOT_MS),planned=bucketTimeRanges(plans,base,288,TIME_SLOT_MS);
 for(const now of [base-1,base+7*60000,base+1450*60000,base+2880*60000])for(let i=0;i<288;i++)assert.deepEqual(summarizeTimeSlot(actual[i],base+i*TIME_SLOT_MS,now,planned[i]),summarizeTimeSlot(rows,base+i*TIME_SLOT_MS,now,plans));
 assert.equal(actual[1].length,0);assert.equal(actual[144][0].categoryId,'sleep');assert.equal(actual.flat().some(r=>r.categoryId==='outside'),false);
});
