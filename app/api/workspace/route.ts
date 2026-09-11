import {authorizedStore} from '@/lib/auth';
import {json,failure,spaceOf} from '@/lib/http';
export async function GET(request:Request){try{const {store}=await authorizedStore(request);return json((await store.snapshot(spaceOf(new URL(request.url).searchParams.get('space')||'personal'))).workspace);}catch(e){return failure(e);}}
export async function POST(request:Request){try{await authorizedStore(request);return json({error:'旧版整库写入已停用，请刷新应用使用逐事项同步'},410);}catch(e){return failure(e);}}
