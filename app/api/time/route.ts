import {timeFailure,timeRoute} from '@/lib/time-api';

export async function GET(request:Request){try{return await timeRoute(request);}catch(error){return timeFailure(error);}}
export async function POST(request:Request){try{return await timeRoute(request);}catch(error){return timeFailure(error);}}
