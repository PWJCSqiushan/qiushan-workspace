import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateTimeStats,canonicalTimestamp,parseTimeText,periodBounds} from '../lib/time-domain.ts';

const interval=(start:string,end:string,categoryId='study')=>({id:`i-${start}`,start:canonicalTimestamp(start),end:canonicalTimestamp(end),categoryId,manual:true,version:1});
const categories=[
  {id:'sleep',name:'睡眠',color:'#8ECBE6',active:true},
  {id:'study',name:'专注学习',color:'#73C6A2',active:true},
  {id:'free',name:'自由时间',color:'#B8C5C6',active:true},
  {id:'unrecorded',name:'未记录',color:'#5B6572',active:true},
];

test('stats count exact minutes, cross-midnight clipping, and future denominator',()=>{
  const snapshot={categories,intervals:[
    interval('2026-09-22T23:50+08:00','2026-09-23T01:10+08:00','sleep'),
    interval('2026-09-23T14:10+08:00','2026-09-23T15:35+08:00','study'),
    interval('2026-09-24T14:10+08:00','2026-09-24T15:35+08:00','free'),
  ]};
  const stats=calculateTimeStats(snapshot,{from:'2026-09-23T00:00+08:00',to:'2026-09-24T00:00+08:00',now:new Date('2026-09-23T16:00:00+08:00')});
  assert.equal(stats.elapsedMinutes,960); // 16 hours elapsed on 23 Sep after midnight
  assert.equal(stats.recordedMinutes,70+85);
  assert.equal(stats.unrecordedMinutes,805);
  assert.equal(stats.categories.find(item=>item.categoryId==='study')?.minutes,85);
  assert.equal(stats.categories.find(item=>item.categoryId==='sleep')?.minutes,70);
  assert.equal(stats.categories.find(item=>item.categoryId==='free')?.minutes,0);
  assert.equal(stats.coverage,(155/960));
});

test('ten-minute buckets preserve exact durations and text parser remains preview-only',()=>{
  const stats=calculateTimeStats({categories,intervals:[interval('2026-09-23T14:10+08:00','2026-09-23T15:35+08:00')]},{from:'2026-09-23T14:00+08:00',to:'2026-09-23T16:00+08:00',now:new Date('2026-09-23T16:00:00+08:00')});
  assert.equal(stats.recordedMinutes,85);
  assert.deepEqual(stats.slots.slice(0,2).map(item=>item.parts[0]?.minutes),[10,10]);
  const parsed=parseTimeText('今天14:10到15:35学习',new Date('2026-09-23T01:00:00Z'));
  assert.deepEqual(parsed.errors,[]);assert.equal(parsed.categoryId,'study');assert.equal(Date.parse(parsed.end!)-Date.parse(parsed.start!),85*60000);
  const nap=parseTimeText('昨晚23:50到今天7:10睡觉',new Date('2026-09-23T02:00:00Z'));
  assert.deepEqual(nap.errors,[]);assert.equal(nap.categoryId,'sleep');assert.equal(Date.parse(nap.end!)-Date.parse(nap.start!),7*60*60000+20*60000);
});

test('period bounds use Beijing midnight and Monday week start',()=>{
  const day=periodBounds('day',new Date('2026-09-23T03:00:00Z'));assert.equal(day.from,'2026-09-22T16:00:00.000Z');assert.equal(day.to,'2026-09-23T16:00:00.000Z');
  const week=periodBounds('week',new Date('2026-09-23T03:00:00Z'));assert.equal(week.from,'2026-09-20T16:00:00.000Z');assert.equal(week.to,'2026-09-27T16:00:00.000Z');
});
