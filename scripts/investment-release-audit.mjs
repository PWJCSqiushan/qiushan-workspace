import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

// Credential and response contents stay in memory or ignored local private files.
const base='https://qiushan-workspace.dongzongyue.workers.dev';
const root=resolve('private/release-20261009');
await mkdir(root,{recursive:true});
const credential=JSON.parse(await readFile('D:/丘山/R_个人工作台/work/multidevice-v2/private/credential.json','utf8'));
const login=await fetch(base+'/login?next=/investment',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{origin:base,'content-type':'application/x-www-form-urlencoded','user-agent':'QiushanWorkspace-InvestmentAudit/1.0'},body:new URLSearchParams({passcode:credential.passcode})});
if(login.status!==303)throw new Error('Login HTTP '+login.status);
const cookie=login.headers.get('set-cookie')?.split(';')[0];
if(!cookie)throw new Error('Login did not return a session');
export async function request(endpoint,payload,method=payload?'POST':'GET'){
 let response;
 for(let attempt=0;attempt<3;attempt++){
  response=await fetch(base+endpoint,{method,redirect:'manual',signal:AbortSignal.timeout(45000),headers:{cookie,origin:base,'content-type':'application/json','user-agent':'QiushanWorkspace-InvestmentAudit/1.0'},body:payload===undefined?undefined:JSON.stringify(payload)});
  if(method!=='GET'||![429,502,503,504].includes(response.status)||attempt===2)break;
  await response.body?.cancel();await new Promise(done=>setTimeout(done,1200*(attempt+1)));
 }
 if(!response.ok)throw new Error('Request '+endpoint.split('?')[0]+' HTTP '+response.status);
 return response.headers.get('content-type')?.includes('application/json')?response.json():response.text();
}
export async function probe(endpoint){
 const response=await fetch(base+endpoint,{redirect:'manual',signal:AbortSignal.timeout(45000),headers:{cookie,origin:base,'user-agent':'QiushanWorkspace-InvestmentAudit/1.0'}});
 const bytes=await response.arrayBuffer();
 return {status:response.status,bytes:bytes.byteLength};
}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
if(process.argv.includes('--baseline')){
 const manifest={};
 for(const [name,endpoint] of Object.entries({finance:'/api/finance/export?space=personal',time:'/api/time/export?space=personal',workflow:'/api/export?space=personal',garmin:'/api/time/garmin/status?space=personal'})){
  const value=await request(endpoint);await writeFile(resolve(root,'before-'+name+'.json'),JSON.stringify(value));
  manifest[name]={sha256:hash(value),captured_at:new Date().toISOString()};
 }
 await writeFile(resolve(root,'baseline-manifest.json'),JSON.stringify(manifest,null,2));
 console.log('Authenticated baseline exports saved privately; no response contents printed.');
}
if(process.argv.includes('--verify')){
 const report={pages:{},isolation:{},modules:{}};
 for(const path of ['/','/time','/finance','/investment']){const html=await request(path);report.pages[path]={html:typeof html==='string',investment_navigation:html.includes('理财投资')};}
 for(const path of ['/api/investment/bootstrap?space=personal','/api/investment/bootstrap?space=demo']){
  const anonymous=await fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(30000)});report.isolation[path]={anonymous_status:anonymous.status};
  if(anonymous.status!==401)throw new Error('Anonymous investment access was not rejected');
 }
 for(const [name,endpoint] of Object.entries({finance:'/api/finance/export?space=personal',time:'/api/time/export?space=personal',workflow:'/api/export?space=personal'})){
  const before=JSON.parse(await readFile(resolve(root,'before-'+name+'.json'),'utf8'));const after=await request(endpoint);
  await writeFile(resolve(root,'after-'+name+'.json'),JSON.stringify(after));
  if(name==='finance')report.modules[name]={state_unchanged:hash(before.state)===hash(after.state),history_unchanged:hash(before.history)===hash(after.history)};
  if(name==='workflow')report.modules[name]={unchanged:hash(before)===hash(after)};
  if(name==='time')report.modules[name]={manual_intervals_unchanged:hash(before.time.intervals.filter(x=>x.manual===true))===hash(after.time.intervals.filter(x=>x.manual===true)),manual_plans_unchanged:hash(before.time.plans.filter(x=>x.manual===true))===hash(after.time.plans.filter(x=>x.manual===true)),before_version:before.version,after_version:after.version};
 }
 const beforeGarmin=JSON.parse(await readFile(resolve(root,'before-garmin.json'),'utf8')),afterGarmin=await request('/api/time/garmin/status?space=personal');
 const stableGarmin=value=>Object.fromEntries(['connectionId','status','scopes','helperStatus','errorCode'].map(key=>[key,value[key]]));
 report.modules.garmin={status_unchanged:hash(stableGarmin(beforeGarmin))===hash(stableGarmin(afterGarmin))};
 await writeFile(resolve(root,'production-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 for(const [name,checks] of Object.entries(report.modules))for(const [key,value] of Object.entries(checks))if(key.endsWith('unchanged')&&!value)throw new Error('Existing module changed: '+name+'.'+key);
}
