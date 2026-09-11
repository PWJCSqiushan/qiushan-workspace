import {authorizedStore} from '@/lib/auth';
import {json,failure,spaceOf} from '@/lib/http';
import {AppError} from '@/lib/workspace';
export async function GET(request:Request){try{const {store,user}=await authorizedStore(request),u=new URL(request.url),s=spaceOf(u.searchParams.get('space')||'personal'),raw=u.searchParams.get('cursor'),cursor=raw===null?null:Number(raw);if(cursor!==null&&(!Number.isSafeInteger(cursor)||cursor<0))throw new AppError('游标无效');return json({...await store.sync(s,cursor),owner:user.owner});}catch(e){return failure(e);}}
