import {InvestmentStore,type InvestmentMarketProvider} from './investment-store.ts';
import * as market from './investment-market.ts';

/** Weekday operating window, not a claim about the exchange holiday calendar. */
export function investmentRefreshDue(date:Date){
 const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
 const hour=Number(values.hour),minute=Number(values.minute);
 return ['Mon','Tue','Wed','Thu','Fri'].includes(values.weekday)&&minute%5===0&&hour>=9&&(hour<15||(hour===15&&minute<=15));
}

/** Bounded public-data refresh; account records and other boards are untouched. */
export async function refreshInvestmentScheduled(db:D1Database,date=new Date(),provider:InvestmentMarketProvider=market){
 if(!investmentRefreshDue(date))return {skipped:'outside-window'};
 const rows=(await db.prepare("SELECT owner_id FROM investment_states WHERE space='personal' ORDER BY owner_id LIMIT 20").all<{owner_id:string}>()).results;
 if(!rows.length)return {skipped:'no-investment-account'};
 const slot=Math.floor(date.getTime()/300000),row=rows[slot%rows.length];
 const store=new InvestmentStore(db,row.owner_id,provider);
 const state=await store.snapshot('personal');
 const observed=state.instruments.filter(x=>x.watched!==false);
 if(!observed.length)return {skipped:'no-observations'};
 const offset=Math.floor(slot/rows.length)%observed.length;
 const ids=[observed[offset].id];
 try{
  const result=await store.refresh('personal',{base_version:state.version,operation_id:'cron-'+slot,ids,full:slot%3===0});
  return {updated:ids.length,version:result.version};
 }catch(error){
  if(error instanceof Error&&'status' in error&&error.status===409)return {skipped:'concurrent-edit'};
  throw error;
 }
}
