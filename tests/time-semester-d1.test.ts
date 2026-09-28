import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare} from 'miniflare';
import {TimeStore} from '../lib/time-store.ts';
import {SCHOOL_PERIODS,type SemesterPreset} from '../lib/time-semester.ts';
import {exportTimeBackup,validateTimeBackup} from '../lib/time-backup.ts';
test('real local D1 handles a 360 occurrence semester, rollover, CAS receipts and backup',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],compatibilityDate:'2026-05-15'});
 try{const db=await mf.getD1Database('DB');for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())for(const sql of readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 const p:SemesterPreset={id:'stress-synthetic',name:'合成全学期',startDate:'2026-09-07',endWeek:30,periods:SCHOOL_PERIODS,calendar:[],calendarVerifiedThrough:'2026-10-10',lessons:Array.from({length:12},(_,i)=>({code:'SYN'+i,section:'01',name:'合成课程'+i,weekday:Math.floor(i/2)+1,weeks:Array.from({length:30},(_,w)=>w+1),periods:i%2?[5,6,7,8]:[1,2,3,4],location:'合成地点',deliveryMode:'in_person' as const,cells:[]}))};
 const store=new TimeStore(db as unknown as D1Database,'synthetic');await store.mutate({space:'demo',operationId:'preset',baseVersion:0,mutation:{type:'saveSemester',preset:p}});
 const envelope={space:'demo',operationId:'semester-apply',baseVersion:1,mutation:{type:'applySemester'}};const first=await store.mutate(envelope);assert.deepEqual(await store.mutate(envelope),first);const s=await store.snapshot('demo');assert.equal(s.plans.filter(p=>p.categoryId==='class').length,360);assert.ok(s.plans.filter(p=>p.generatedBy==='commute').length>500);
 const rollover=await store.rollover('demo');assert.equal(rollover.changed,true);const repeat=await store.rollover('demo');assert.equal(repeat.changed,false);const after=await store.snapshot('demo');assert.ok(after.intervals.some(r=>r.generatedBy==='course'));
 await store.mutate({space:'demo',operationId:'semester-repeat',baseVersion:after.version,mutation:{type:'applySemester'}});assert.equal((await store.snapshot('demo')).plans.filter(p=>p.categoryId==='class').length,360);
 const backup=await exportTimeBackup(store,'demo');await validateTimeBackup(backup);assert.ok(backup.time.sources.some(s=>s.sourceKey==='semester-preset:stress-synthetic'));
 console.log(JSON.stringify({kind:'semester-d1-evidence',courses:360,plans:s.plans.length,receiptBytes:Buffer.byteLength(JSON.stringify(first)),backupBytes:Buffer.byteLength(JSON.stringify(backup)),rolloverVersion:after.version}));
 }finally{await mf.dispose();}
});
