import {authorizedStore} from '@/lib/auth';
import {json,failure,spaceOf} from '@/lib/http';
import {aggregateAnalytics} from '@/lib/analytics';
import {readHistory} from '@/lib/coordinated-store';
export async function GET(request:Request){try{const {store}=await authorizedStore(request),q=new URL(request.url).searchParams,space=spaceOf(q.get('space')||'personal'),history=await readHistory(store,space);return json(aggregateAnalytics(history.events,{from:q.get('from')||'',to:q.get('to')||'',bucket:(q.get('bucket')||'day') as 'day'|'week'|'month',flow:q.get('flow')||undefined},history.coverage));}catch(e){return failure(e);}}
