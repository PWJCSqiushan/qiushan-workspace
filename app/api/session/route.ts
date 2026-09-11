import {env} from 'cloudflare:workers';
import {authorizedStore} from '@/lib/auth';
import {json,failure} from '@/lib/http';
export async function GET(request:Request){try{const {user}=await authorizedStore(request);return json({...user,serverTime:new Date().toISOString(),schemaVersion:2,migrationEnabled:user.local||env.MIGRATION_ENABLED==='true',spaces:['personal','demo']});}catch(e){return failure(e);}}
