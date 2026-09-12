import {authorizedStore} from '@/lib/auth';
import {body,json,failure,spaceOf} from '@/lib/http';
import {coordinationPreview,enableCoordination} from '@/lib/coordinated-store';
import {AppError} from '@/lib/workspace';
export async function GET(request:Request){try{const {store}=await authorizedStore(request);return json(await coordinationPreview(store,spaceOf(new URL(request.url).searchParams.get('space')||'personal')));}catch(e){return failure(e);}}
export async function POST(request:Request){try{const {store}=await authorizedStore(request),data=await body(request);if(data.confirm!==true)throw new AppError('请先核对编号预览');return json(await enableCoordination(store,spaceOf(data.space),data.expectedRevision));}catch(e){return failure(e);}}
