import {authorizedStore} from '@/lib/auth';
import {body,json,failure} from '@/lib/http';
export async function POST(request:Request){try{const {store}=await authorizedStore(request);return json(await store.mutate(await body(request)));}catch(e){return failure(e);}}
