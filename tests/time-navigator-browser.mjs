// Standalone synthetic browser acceptance; no worker, database or app API is started.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const vite=await createServer({configFile:false,plugins:[react(),{name:'fixture',configureServer(server){server.middlewares.use('/timeline-fixture',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/timeline-fixture','<html><body style="margin:0"><div id="root"></div><script type="module" src="/tests/time-navigator-fixture.tsx"></script></body></html>'));});}}],server:{host:'127.0.0.1',port:0}});
await vite.listen();
const profile=await mkdtemp(join(tmpdir(),'qiushan-timeline-'));
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let socket;const pending=new Map();let sequence=0;
try{
 const endpoint=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),20000);chrome.stderr.on('data',d=>{text+=d;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
 const origin=endpoint.replace('ws:','http:').split('/devtools/')[0],targets=await(await fetch(origin+'/json/list')).json();
 socket=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown')console.error(JSON.stringify(message.params));if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.reject(new Error(JSON.stringify(message.error)));else p.resolve(message.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
 await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:`http://127.0.0.1:${vite.httpServer.address().port}/timeline-fixture`});
 for(let i=0;i<100;i++){if(await evaluate('!!document.querySelector(".time-navigator-pan")'))break;await pause();}
 assert.ok(await evaluate('!!document.querySelector(".time-navigator-pan")'),JSON.stringify(await evaluate('({url:location.href,html:document.documentElement.outerHTML,resources:performance.getEntriesByType("resource").map(r=>({name:r.name,status:r.responseStatus}))})')));
 const value=()=>evaluate('JSON.parse(document.querySelector("#value").textContent)');
 const box=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`);
 const drag=async(selector,dx)=>{const r=await box(selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});for(let i=1;i<=5;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:r.x+dx*i/5,y:r.y,button:'left',buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x+dx,y:r.y,button:'left',clickCount:1});await pause();};
 for(const [width,height] of [[1366,768],[1920,1080],[1024,768],[1180,820]]){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause();
  for(const selector of ['.time-navigator-pan','.time-navigator-handle.start','.time-navigator-handle.end']){const r=await box(selector);assert.ok(r.width>=44&&r.height>=44,`${width} ${selector} hit size`);}
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no horizontal overflow');
  assert.ok(await evaluate('document.querySelector(".time-navigator-domain").getBoundingClientRect().bottom<=innerHeight'),'navigation fits viewport');
 }
 let before=await value();await drag('.time-navigator-pan',40);let after=await value();assert.equal(after.days,before.days);assert.notEqual(after.start,before.start);
 before=after;await drag('.time-navigator-handle.start',-15);after=await value();assert.equal(Date.parse(after.start)+after.days*86400000,Date.parse(before.start)+before.days*86400000);assert.ok(after.days>before.days);
 before=after;await drag('.time-navigator-handle.end',-15);after=await value();assert.equal(after.start,before.start);assert.ok(after.days<before.days);
 await evaluate('document.querySelector(".time-navigator-pan").focus()');before=await value();await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight'});await pause();after=await value();assert.equal(Date.parse(after.start)-Date.parse(before.start),86400000);
 const r=await box('.time-navigator-pan');before=after;await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:r.x,y:r.y,deltaX:0,deltaY:-100,modifiers:1});await pause();after=await value();assert.ok(after.days<before.days);
 await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});const touch=await box('.time-navigator-pan');before=after;await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touch.x,y:touch.y}]});await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+20,y:touch.y}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause();after=await value();assert.equal(after.days,before.days);assert.notEqual(after.start,before.start);
 assert.deepEqual(await evaluate('performance.getEntriesByType("resource").filter(r=>new URL(r.name).pathname.startsWith("/api/")).map(r=>r.name)'),[]);
 console.log(JSON.stringify({passed:true,viewports:4,checks:['44px hit targets','viewport fit','mouse pan','both resize handles','keyboard','Alt wheel','touch pan','no API requests'],profile},null,2));
}finally{socket?.close();chrome.kill();await vite.close();}
