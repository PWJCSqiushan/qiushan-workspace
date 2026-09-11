import {passcodeIdentity} from './passcode-auth';
import {verifyAccess} from './access-jwt';
import {env} from 'cloudflare:workers';
import {createRemoteJWKSet} from 'jose';
import {AppError} from './workspace';
import {Store} from './storage-v2';
import {sha256} from './protocol';

const keySets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
const identities=new WeakMap<Request,Promise<Awaited<ReturnType<typeof resolveIdentity>>>>();
export function identity(request:Request){let value=identities.get(request);if(!value){value=resolveIdentity(request);identities.set(request,value);}return value;}
async function resolveIdentity(request:Request){
 const hostname=new URL(request.url).hostname;
 if(env.AUTH_MODE==='local'&&['localhost','127.0.0.1','[::1]'].includes(hostname))return {owner:'local-qiushan',subject:'local-test',email:'本地隔离测试',expiresAt:Date.now()+86400000,local:true};
 if(env.AUTH_MODE==='passcode')return passcodeIdentity(request,env.DB,env.LOGIN_SECRET_SHA256);
 if(env.AUTH_MODE!=='access'||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ALLOWED_EMAIL)throw new AppError('私有访问尚未配置',503);
 const token=request.headers.get('cf-access-jwt-assertion');if(!token)throw new AppError('请先登录',401);
 const issuer=env.ACCESS_TEAM_DOMAIN.replace(/\/$/,'');if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))throw new AppError('身份配置无效',503);
 let keys=keySets.get(issuer);if(!keys){keys=createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'));keySets.set(issuer,keys);}
 try{const payload=await verifyAccess(token,keys,issuer,env.ACCESS_AUD,env.ALLOWED_EMAIL);return {owner:await sha256(issuer+'|'+payload.sub),subject:issuer+'|'+payload.sub,email:String(payload.email),expiresAt:Number(payload.exp)*1000,local:false};}catch(e){if(e instanceof AppError)throw e;throw new AppError('登录已过期，请重新登录',401);}
}
export async function authorizedStore(request:Request){const user=await identity(request);const store=new Store(env.DB,user.owner);const row=await store.q('SELECT subject FROM owners WHERE owner_id=?',user.owner).first<{subject:string}>();if(!row)await store.initialize(user.subject);else if(row.subject!==user.subject)throw new AppError('身份不匹配',403);return {user,store};}
