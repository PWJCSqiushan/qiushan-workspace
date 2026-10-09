import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {emptyInvestmentState,todayShanghai,validateOpening,validateState} from '../lib/investment-domain.ts';
const base='http://127.0.0.1:4388';
async function request(path:string,payload?:unknown){const r=await fetch(base+'/api/investment/'+path+'?space=demo',{method:payload?'POST':'GET',headers:{origin:base,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});assert(r.ok,'Local preview HTTP '+r.status);return r.json() as Promise<any>;}
const session=await request('session'),before=await request('bootstrap');
const state=emptyInvestmentState(session.owner,'demo');state.version=before.version;
state.profile={...state.profile,purpose:'合成测试用途',horizon:'合成测试一年以上',commission_rate:0.0003,minimum_commission:5};
for(const [index,item] of state.instruments.entries()){
 const rows=Array.from({length:80},(_,i)=>{const date=new Date(todayShanghai()+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-79+i);const close=10+index+i*0.01+Math.sin(i/4)*0.2;return {date:date.toISOString().slice(0,10),open:close-0.02,high:close+0.1,low:close-0.1,close,volume:item.kind==='fund'?null:100000+i*100,amount:item.kind==='fund'?null:1000000+i*1000};});
 const last=rows.at(-1)!;
 state.snapshots[item.id]={snapshot_id:'synthetic-preview-'+index,instrument_id:item.id,source:'synthetic-preview',source_url:null,as_of:last.date,fetched_at:new Date().toISOString(),status:'fresh',error:null,quote:{price:last.close,change_pct:0.2,open:last.open,high:last.high,low:last.low,preclose:rows.at(-2)!.close,volume:last.volume,amount:last.amount},history:rows,adjustment:'none',valuation_kind:item.kind==='fund'?'confirmed_nav':'market_price',metrics:{ma20:rows.slice(-20).reduce((s,r)=>s+r.close,0)/20,ma60:rows.slice(-60).reduce((s,r)=>s+r.close,0)/60,return_20d:(last.close/rows.at(-21)!.close-1)*100,range_120d:null,history_count:rows.length},fundamentals:[],evidence:[],warnings:['所有价格/资金/持仓为独立合成预览数据'],quote_source:'synthetic-preview',history_source:'synthetic-preview',history_as_of:last.date,history_status:'fresh',units:{price:'元',volume:item.kind==='fund'?'份':'股/份',amount:'元'}};
}
const item=state.instruments[0],price=state.snapshots[item.id].quote.price!;
state.opening=validateOpening({date:todayShanghai(),cash:8000,positions:[{instrument_id:item.id,quantity:200,average_cost:10,reference_price:10}],confirmed_empty:false},state.instruments);state.profile.holdings_confirmed=true;
validateState(state);
const backup={schema_version:1,owner:session.owner,space:'demo',version:state.version,state,state_sha256:createHash('sha256').update(JSON.stringify(state)).digest('hex')};
await request('backups/restore',{space:'demo',base_version:before.version,operation_id:randomUUID(),backup});
console.log('Isolated local demo restored: four synthetic instruments, one synthetic position, no personal data.');
