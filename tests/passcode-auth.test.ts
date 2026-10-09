import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './d1-helper.ts';
import {login,logout,loginPage,passcodeIdentity,randomToken,SESSION_COOKIE} from '../lib/passcode-auth.ts';
import {sha256} from '../lib/protocol.ts';
const origin='https://example.test';
function request(secret:string,extra:Record<string,string>={}){return new Request(origin+'/login',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded',...extra},body:new URLSearchParams({passcode:secret})});}
test('passcode session: secure cookie, expiry, revocation and credential rotation',async()=>{const {db,sqlite}=database(),secret=randomToken(),hash=await sha256(secret);const response=await login(request(secret),db,hash);assert.equal(response.status,303);const cookie=response.headers.get('set-cookie')!;for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(cookie.includes(flag));const authenticated=new Request(origin,{headers:{cookie:cookie.split(';')[0]}});assert.equal((await passcodeIdentity(authenticated,db,hash)).owner,'qiushan-owner-v1');await assert.rejects(passcodeIdentity(authenticated,db,await sha256(randomToken())),{status:401});sqlite.exec('UPDATE auth_sessions SET expires_at=0');await assert.rejects(passcodeIdentity(authenticated,db,hash),{status:401});sqlite.exec('UPDATE auth_sessions SET expires_at=9999999999999');await logout(new Request(origin+'/logout',{method:'POST',headers:{origin,cookie:cookie.split(';')[0]}}),db);await assert.rejects(passcodeIdentity(authenticated,db,hash),{status:401});});
test('passcode rejects missing configuration, wrong credential, cross-origin and duplicate cookies',async()=>{const {db}=database(),secret=randomToken(),hash=await sha256(secret);await assert.rejects(login(request(secret),db,undefined),{status:503});await assert.rejects(login(request(randomToken()),db,hash),{status:401});await assert.rejects(login(request(secret,{origin:'https://attacker.test'}),db,hash),{status:403});await assert.rejects(passcodeIdentity(new Request(origin,{headers:{cookie:`${SESSION_COOKIE}=${secret}; ${SESSION_COOKIE}=${secret}`}}),db,hash),{status:401});await assert.rejects(login(request('x'.repeat(1100)),db,hash),{status:413});});
test('passcode rate limit admits at most 10 requests per IP window',async()=>{const {db}=database(),hash=await sha256(randomToken());for(let i=0;i<10;i++)await assert.rejects(login(request(randomToken()),db,hash),{status:401});await assert.rejects(login(request(randomToken()),db,hash),{status:429});});

test('login form retains same-origin Origin header on mobile browsers',()=>{assert.equal(loginPage().headers.get('referrer-policy'),'same-origin');});
test('investment login returns to the protected page and rejects external redirects',async()=>{
 const {db}=database(),secret=randomToken(),hash=await sha256(secret);
 const make=(next:string)=>new Request(origin+'/login?next='+encodeURIComponent(next),{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({passcode:secret})});
 assert.equal((await login(make('/investment'),db,hash)).headers.get('location'),'/investment');
 for(const unsafe of ['https://attacker.test','//attacker.test','/investment?owner=other'])assert.equal((await login(make(unsafe),db,hash)).headers.get('location'),'/');
 assert.ok((await loginPage('',200,'/investment').text()).includes('/login?next=%2Finvestment'));
});
