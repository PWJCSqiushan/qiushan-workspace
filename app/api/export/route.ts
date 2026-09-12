import {authorizedStore} from '@/lib/auth';
import {json,failure,spaceOf} from '@/lib/http';
export async function GET(request:Request){try{const {store}=await authorizedStore(request);return json(await store.exportWorkspace(spaceOf(new URL(request.url).searchParams.get('space')||'personal')));}catch(e){return failure(e);}}
