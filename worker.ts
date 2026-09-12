import * as analyticsRoute from './app/api/analytics/route';
import * as coordinationRoute from './app/api/coordination/route';
import * as exportRoute from './app/api/export/route';
import * as sessionRoute from './app/api/session/route';
import * as syncRoute from './app/api/sync/route';
import * as mutationsRoute from './app/api/mutations/route';
import * as transferRoute from './app/api/transfer/route';
import * as backupsRoute from './app/api/backups/route';
import * as backup_statusRoute from './app/api/backup-status/route';
import * as workspaceRoute from './app/api/workspace/route';
import {login,logout,loginPage} from './lib/passcode-auth';
import {AppError} from './lib/workspace';
import app from 'vinext/server/fetch-handler';
import {identity} from './lib/auth';
import {backupAll} from './lib/backup';
import {failure} from './lib/http';
const routes:Record<string,Record<string,(request:Request)=>Promise<Response>>>={'/api/analytics':analyticsRoute,'/api/coordination':coordinationRoute,'/api/export':exportRoute,'/api/session':sessionRoute,'/api/sync':syncRoute,'/api/mutations':mutationsRoute,'/api/transfer':transferRoute,'/api/backups':backupsRoute,'/api/backup-status':backup_statusRoute,'/api/workspace':workspaceRoute};
export default {
 async fetch(request:Request,environment:Env,ctx:ExecutionContext){try{const path=new URL(request.url).pathname;if(environment.AUTH_MODE==='passcode'&&path==='/login'){if(request.method==='GET')return loginPage();if(request.method==='POST'){try{return await login(request,environment.DB,environment.LOGIN_SECRET_SHA256);}catch(e){if(e instanceof AppError)return loginPage(e.message,e.status);throw e;}}return new Response(null,{status:405,headers:{Allow:'GET, POST'}});}if(environment.AUTH_MODE==='passcode'&&path==='/logout'){if(request.method!=='POST')return new Response(null,{status:405,headers:{Allow:'POST'}});return await logout(request,environment.DB);}try{await identity(request);}catch(e){if(e instanceof AppError&&e.status===401&&request.method==='GET'&&path==='/')return new Response(null,{status:303,headers:{Location:'/login','Cache-Control':'no-store'}});throw e;}const route=routes[path];const response=path.startsWith('/api/')?(route?.[request.method]?await route[request.method](request):new Response(null,{status:route?405:404})):path==='/'?(environment.AUTH_MODE==='local'||request.method!=='GET'||!!new URL(request.url).search||request.headers.get('accept')?.includes('text/x-component')||['rsc','next-router-state-tree','next-router-prefetch','next-router-segment-prefetch'].some(h=>request.headers.has(h))?await app.fetch(request,environment,ctx):await environment.ASSETS.fetch(new Request(new URL('/workspace-shell.html',request.url),request))):await environment.ASSETS.fetch(request);const headers=new Headers(response.headers);headers.set('X-Content-Type-Options','nosniff');if(new URL(request.url).pathname==='/'&&headers.get('content-type')?.includes('text/html'))headers.set('X-Workspace-Shell','1');headers.set('Referrer-Policy','same-origin');headers.set('X-Frame-Options','DENY');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');if(!new URL(request.url).pathname.startsWith('/_next/static/'))headers.set('Cache-Control','no-store');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}catch(e){return failure(e);}},
 async scheduled(_controller:ScheduledController,_environment:Env,ctx:ExecutionContext){ctx.waitUntil(backupAll(_environment.DB,_environment.BACKUPS));}
};

