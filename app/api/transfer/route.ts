import {env} from 'cloudflare:workers';
import {authorizedStore} from '@/lib/auth';
import {body,json,failure,spaceOf} from '@/lib/http';
import {AppError} from '@/lib/workspace';
export async function POST(request:Request){try{const {store,user}=await authorizedStore(request);const b=await body(request),space=spaceOf(b.space);if(!['migration','restore'].includes(b.kind))throw new AppError('传输类型无效');if(b.kind==='migration'&&!user.local&&env.MIGRATION_ENABLED!=='true')throw new AppError('迁移入口已关闭',403);if(b.action==='preview')return json(await store.preview(space,b.workspace,b.kind));if(b.action!=='commit'||b.confirm!==true)throw new AppError('请先预览并明确确认');return json(await store.importWorkspace(space,b.workspace,b.runId,b.sourceHash,b.expectedRevision,b.kind));}catch(e){return failure(e);}}
