import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import {randomToken} from '../lib/passcode-auth.ts';
import {sha256} from '../lib/protocol.ts';
const secret=randomToken();
const mf=new Miniflare({modules:['index.js',...readdirSync('dist/server',{recursive:true}).map(String).filter(p=>p.endsWith('.js')&&p!=='index.js')].map(p=>({type:'ESModule' as const,path:'dist/server/'+p})),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],serviceBindings:{ASSETS:async()=>new Response(readFileSync('dist/client/workspace-shell.html'),{headers:{'content-type':'text/html'}})},d1Databases:['DB'],kvNamespaces:['BACKUPS'],bindings:{AUTH_MODE:'passcode',LOGIN_SECRET_SHA256:await sha256(secret)}});
try{const db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
const origin='https://example.test';for(const path of ['/api/session','/api/sync','/api/backups','/favicon.svg','/sw.js','/_next/static/test.js'])assert.equal((await mf.dispatchFetch(origin+path)).status,401,path);
const root=await mf.dispatchFetch(origin,{redirect:'manual'});assert.equal(root.status,303);assert.equal(root.headers.get('location'),'/login');
const r=await mf.dispatchFetch(origin+'/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:secret}).toString(),redirect:'manual'});assert.equal(r.status,303,await r.text());const cookie=r.headers.get('set-cookie')!.split(';')[0];
const session=await mf.dispatchFetch(origin+'/api/session',{headers:{cookie}});assert.equal(session.status,200,await session.text());
const shell=await mf.dispatchFetch(origin,{headers:{cookie}});assert.equal(shell.status,200);assert.equal(shell.headers.get('x-workspace-shell'),'1');
assert.equal((await mf.dispatchFetch(origin+'/logout',{method:'POST',headers:{origin:'https://attacker.test',cookie}})).status,403);
assert.equal((await mf.dispatchFetch(origin+'/logout',{method:'POST',headers:{origin,cookie}})).status,200);
assert.equal((await mf.dispatchFetch(origin+'/api/session',{headers:{cookie}})).status,401);
console.log('Production bundle passcode: private routes/assets, login, SSR, CSRF, logout PASS');}finally{await mf.dispose();}
