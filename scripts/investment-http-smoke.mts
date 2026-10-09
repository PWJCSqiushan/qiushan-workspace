import {Miniflare} from 'miniflare';
import {readdirSync,readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const secret=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(secret).digest('hex');
const origin='https://investment-smoke.test';
const mf=new Miniflare({modules:['index.js',...readdirSync('dist/server',{recursive:true}).map(String).filter(p=>p.endsWith('.js')&&p!=='index.js')].map(p=>({type:'ESModule' as const,path:'dist/server/'+p})),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],bindings:{AUTH_MODE:'passcode',LOGIN_SECRET_SHA256:hash},d1Databases:['DB'],kvNamespaces:['BACKUPS'],serviceBindings:{ASSETS:async()=>new Response(readFileSync('dist/client/investment-shell.html'),{headers:{'content-type':'text/html'}})}});
try{
 const db=await mf.getD1Database('DB');
 for(const file of readdirSync('drizzle').filter(n=>n.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))await db.prepare(sql).run();
 for(const space of ['personal','demo'])assert.equal((await mf.dispatchFetch(origin+'/api/investment/bootstrap?space='+space)).status,401);
 const protectedPage=await mf.dispatchFetch(origin+'/investment',{redirect:'manual'});assert.equal(protectedPage.status,303);assert(protectedPage.headers.get('location')?.includes('/investment')||protectedPage.headers.get('location')?.includes('%2Finvestment'));
 const login=await mf.dispatchFetch(origin+'/login?next=/investment',{redirect:'manual',method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:secret}).toString()});
 assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/investment');
 const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const request=async(path:string,payload?:unknown,originValue=origin)=>mf.dispatchFetch(origin+'/api/investment/'+path,{method:payload?'POST':'GET',headers:{cookie,origin:originValue,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});
 const initial=await (await request('bootstrap?space=personal')).json() as any;assert.equal(initial.instruments.length,0);
 const payload={space:'personal',base_version:initial.version,operation_id:'http-add-synthetic',id:'etf:SH:990011',code:'990011',name:'合成HTTP品种',kind:'etf',exchange:'SH'};
 assert.equal((await request('watchlist?space=personal',payload,'https://cross.test')).status,403);
 assert.equal((await request('watchlist?space=personal',{...payload,owner:'other-owner'})).status,403);
 assert.equal((await request('watchlist?space=demo',payload)).status,403);
 const first=await request('watchlist?space=personal',payload);assert.equal(first.status,200);const receipt=await first.json();
 assert.deepEqual(await (await request('watchlist?space=personal',payload)).json(),receipt);
 assert.equal((await request('watchlist?space=personal',{...payload,operation_id:'http-stale-write',name:'拒绝覆盖'})).status,409);
 const demo=await (await request('bootstrap?space=demo')).json() as any;assert(demo.instruments.every((i:any)=>i.name.includes('合成')));assert(!demo.instruments.some((i:any)=>i.id===payload.id));
 await db.prepare('UPDATE auth_sessions SET expires_at=0').run();
 assert.equal((await request('bootstrap?space=personal')).status,401);
 console.log('Compiled Worker HTTP passed: passcode deep link, anonymous/expired rejection, origin/owner/space isolation, CAS and idempotency. All input synthetic.');
}finally{await mf.dispose();}
