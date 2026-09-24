import {readFileSync,readdirSync,existsSync,mkdirSync,statSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {Store} from '../lib/storage-v2.ts';
import {sha256} from '../lib/protocol.ts';
import {TimeStore} from '../lib/time-store.ts';
import {newTask,FLOWS} from '../lib/domain.ts';
const port=Number(process.env.PREVIEW_PORT||4350),root=resolve(process.env.BUILT_ROOT||'.');
mkdirSync('work/preview-tmp',{recursive:true});process.env.TEMP=resolve('work/preview-tmp');process.env.TMP=resolve('work/preview-tmp');
const {Miniflare}=await import('miniflare');
const assetRoot=resolve(root,'dist/client'),state=resolve(process.env.PREVIEW_STATE||'work/local-state-'+port+'-v2');
const types:Record<string,string>={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.gz':'application/gzip','.woff2':'font/woff2'};
const mf=new Miniflare({host:'127.0.0.1',port,modulesRoot:resolve(root,'dist/server'),modules:['index.js',...readdirSync(resolve(root,'dist/server'),{recursive:true}).map(String).filter(p=>p.endsWith('.js')&&p!=='index.js')].map(p=>({type:'ESModule' as const,path:resolve(root,'dist/server',p)})),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],serviceBindings:{ASSETS:async(request:Request)=>{const path=resolve(assetRoot,'.'+decodeURIComponent(new URL(request.url).pathname));if(!path.startsWith(assetRoot+sep)||!existsSync(path)||!statSync(path).isFile())return new Response('Not found',{status:404});return new Response(readFileSync(path),{headers:{'content-type':types[extname(path)]||'application/octet-stream'}});}},d1Databases:['DB'],d1Persist:state+'/d1',kvNamespaces:['BACKUPS'],kvPersist:state+'/kv',bindings:{AUTH_MODE:'local',MIGRATION_ENABLED:'false'}});
const db=await mf.getD1Database('DB');await db.prepare('CREATE TABLE IF NOT EXISTS local_preview_migrations(name TEXT PRIMARY KEY)').run();for(const name of readdirSync(resolve('drizzle')).filter(x=>x.endsWith('.sql')).sort()){if(await db.prepare('SELECT name FROM local_preview_migrations WHERE name=?').bind(name).first())continue;for(const sql of readFileSync(resolve('drizzle',name),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();await db.prepare('INSERT INTO local_preview_migrations(name) VALUES(?)').bind(name).run();}
const store=new Store(db as unknown as D1Database,'local-qiushan');await store.initialize('local-test');

const time=new TimeStore(db as unknown as D1Database,'local-qiushan');
// Optional read-only baseline clone. This never contacts production and refuses
// to replace data already present in the isolated local state directory.
if(process.env.PREVIEW_SNAPSHOT_DIR){
 const dir=resolve(process.env.PREVIEW_SNAPSHOT_DIR);
 const personal=await time.snapshot('personal');
 if(personal.version===0&&!personal.intervals.length&&!personal.plans.length){const baseline=JSON.parse(readFileSync(resolve(dir,'time.json'),'utf8'));await time.restoreSnapshot('personal',baseline,'local-readonly-baseline-clone',0);}
 const workflow=await store.exportWorkspace('personal');
 if(!workflow.tasks.length&&!workflow.revision){const raw=JSON.parse(readFileSync(resolve(dir,'workflow.json'),'utf8'));const input=raw.workspace;await store.importWorkspace('personal',input,'local-workflow-baseline-clone',await sha256(input),0,'migration');}
}
if(!(await store.exportWorkspace('demo')).tasks.length){
 const tasks=FLOWS.flatMap((flow,i)=>Array.from({length:3},(_,j)=>({...newTask(flow.id),title:['整理课程重点','准备交付验收','推进每周计划'][j]+' · 演示',order:i*3+j})));
 const fixture={schemaVersion:1 as const,space:'demo' as const,revision:1,tasks,settings:{density:'compact' as const}};
 await store.importWorkspace('demo',fixture,'liudiao-synthetic-workflows',await sha256(fixture),0,'migration');
}
const snapshot=await time.snapshot('demo');
if(snapshot.version===0){
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),midnight=Date.parse(today+'T00:00:00+08:00');
 const items:any[]=[];
 for(let day=-54;day<=5;day++){
  const base=midnight+day*86400000,date=new Date(base+8*3600000).toISOString().slice(0,10);
  if(day<0)for(const [hour,minutes,categoryId] of [[0,410,'sleep'],[12,35,'meal'],[18,45,'exercise'],[20,90,'study']] as const){const a=base+hour*3600000;items.push({start:new Date(a).toISOString(),end:new Date(a+minutes*60000).toISOString(),categoryId,note:'合成演示',sourceKey:'demo-'+date+'-'+categoryId,kind:'actual'});}
  if([0,6].includes(new Date(base+8*3600000).getUTCDay()))continue;
  for(const [index,hour] of [8,10,13.5,15.5].entries())for(let half=0;half<2;half++){
   const a=base+hour*3600000+half*55*60000;
   items.push({start:new Date(a).toISOString(),end:new Date(a+45*60000).toISOString(),categoryId:'class',note:['数据结构与算法','概率论与数理统计','大学英语','面向对象程序设计'][index],courseName:['数据结构与算法','概率论与数理统计','大学英语','面向对象程序设计'][index],location:'教学楼 A'+(index+1)+'02',importSource:'synthetic-timetable',sourcePeriods:[index*2+half+1],sourceKey:'demo-course-'+date+'-'+index+'-'+half,kind:'plan'});
  }
 }
 for(let offset=0;offset<items.length;offset+=200){const current=await time.snapshot('demo');await time.mutate({space:'demo',baseVersion:current.version,operationId:'liudiao-synthetic-time-'+offset,mutation:{type:'import',source:'synthetic-timetable',items:items.slice(offset,offset+200)}});}
}
console.log('Isolated Liudiao preview:',String(await mf.ready),'state:',state);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void mf.dispose().finally(()=>process.exit(0));});
if(process.env.PREVIEW_CHECK_CRON==='1'){
 const before=await time.snapshot('demo'),workflowBefore=await sha256(await store.exportWorkspace('demo'));
 const worker=await mf.getWorker();const scheduled=await worker.scheduled({cron:'*/5 * * * *',scheduledTime:new Date()});
 const after=await time.snapshot('demo');await worker.scheduled({cron:'*/5 * * * *',scheduledTime:new Date()});const repeated=await time.snapshot('demo');
 if(scheduled.outcome!=='ok'||after.version!==before.version+1||after.intervals.length<=before.intervals.length||repeated.version!==after.version||workflowBefore!==await sha256(await store.exportWorkspace('demo')))throw new Error('Scheduled course acceptance failed');
 const backup=await worker.scheduled({cron:'0 18 * * *',scheduledTime:new Date()});if(backup.outcome!=='ok')throw new Error('Original backup cron failed');
 console.log(JSON.stringify({cronVerified:true,browserClosed:true,before:before.version,after:after.version,repeated:repeated.version,actualBefore:before.intervals.length,actualAfter:after.intervals.length,backup:backup.outcome,workflowUnchanged:true}));await mf.dispose();
}else await new Promise(()=>{});
