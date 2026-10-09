import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildInvestmentAdvice} from '../lib/investment-advisor.ts';
import {emptyInvestmentState,validateOpening,summarizeInvestment,contextId,type Instrument,type InvestmentState} from '../lib/investment-domain.ts';
const source=process.argv[2];assert(source,'Pass the read-only source directory');
const day='2026-10-09',stamp=day+'T01:00:00.000Z';
const stock:Instrument={id:'stock:SH:600000',kind:'stock',exchange:'SH',code:'600000',name:'合成主板股票',personalized:true};
const etf:Instrument={id:'etf:SH:510300',kind:'etf',exchange:'SH',code:'510300',name:'合成ETF',personalized:true};
const fund:Instrument={id:'fund:OF:110022',kind:'fund',exchange:'OF',code:'110022',name:'合成基金',personalized:true};
function fixture(item=stock,price=160,held=false){
 const state=emptyInvestmentState('advice-parity-synthetic','personal');
 state.profile={...state.profile,purpose:'合成长期研究',horizon:'一年以上',holdings_confirmed:true,commission_rate:0.0003,minimum_commission:5,loss_limit:99999};
 state.instruments=[structuredClone(item)];
 const history=Array.from({length:60},(_,i)=>({date:new Date(Date.parse(day+'T00:00:00Z')-(59-i)*86400000).toISOString().slice(0,10),open:null,high:null,low:null,close:100+i,volume:null,amount:null}));
 state.snapshots[item.id]={snapshot_id:'synthetic-parity-'+item.id,instrument_id:item.id,source:'synthetic-public',source_url:'https://example.invalid/history',quote_source:'synthetic-quote',history_source:'synthetic-history',as_of:day,history_as_of:day,history_status:'fresh',fetched_at:stamp,status:'fresh',error:null,quote:{price,change_pct:null,open:null,high:null,low:null,preclose:null,volume:null,amount:null},history,adjustment:'none',valuation_kind:item.kind==='fund'?'confirmed_nav':'market_price',metrics:{ma20:null,ma60:null,return_20d:null,range_120d:null,history_count:60},fundamentals:[],evidence:[],warnings:[]};
 state.opening=validateOpening({date:day,cash:100000,confirmed_empty:!held,positions:held?[{instrument_id:item.id,quantity:100,average_cost:null,reference_price:160}]:[]},state.instruments);
 state.profile.initial_capital=state.opening.initial_equity;
 return state;
}
const cases:{name:string;state:InvestmentState}[]=[];
const add=(name:string,state:InvestmentState,edit?:(state:InvestmentState)=>void)=>{edit?.(state);cases.push({name,state});};
add('strong-stock-candidate',fixture());add('strong-held-stock',fixture(stock,160,true));add('weak-held-stock',fixture(stock,120,true));add('below-ma20-above-ma60',fixture(stock,135,true));
add('stale-held-stock',fixture(stock,120,true),s=>{s.snapshots[stock.id].status='stale';});
add('missing-history',fixture(),s=>{s.snapshots[stock.id].history=s.snapshots[stock.id].history.slice(-20);s.snapshots[stock.id].metrics.history_count=20;});
add('etf-missing-iopv',fixture(etf));
add('etf-verified-iopv',fixture(etf),s=>{Object.assign(s.snapshots[etf.id],{iopv:160,iopv_as_of:day,iopv_source:'synthetic-iopv',iopv_url:'https://example.invalid/iopv'});});
add('confirmed-fund-nav',fixture(fund));
add('unconfirmed-fees',fixture(),s=>{s.profile.commission_rate=0;s.profile.minimum_commission=0;s.profile.transfer_fee_rate=0;s.profile.stamp_tax_rate=0.001;});
add('loss-pause-preserves-holding-risk',fixture(stock,120,true),s=>{s.profile.loss_limit=100;});
add('invalid-market-counts',fixture(),s=>{s.market={snapshot_id:'synthetic-market',date:day,status:'fresh',fetched_at:stamp,source:'synthetic-market',breadth:{up:1.5,down:1.5,flat:1,total:4,amount:1000},sentiment:{limit_up:1,limit_down:1,broken:1,broken_rate:101,max_streak:1},flow:null,evidence:[],missing_fields:[],warnings:[]};Object.assign(s.market,{sentiment_date:day,sentiment_source:'synthetic-market'});});
const inputs=cases.map(({state})=>({instruments:state.instruments,snapshots:state.snapshots,market:state.market,portfolio:summarizeInvestment(state),profile:state.profile,account_context:state.account_context,as_of:day,generated_at:stamp,context_id:contextId(state)}));
const expected=JSON.parse(execFileSync(process.env.INVESTMENT_REFERENCE_PYTHON||'python',['-B',fileURLToPath(new URL('./investment-advisor-reference.py',import.meta.url)),source],{input:JSON.stringify(inputs),encoding:'utf8',windowsHide:true}));
const normalize=(value:any):any=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='decision_id').map(([key,v])=>[key,normalize(v)])):typeof value==='number'?Math.round(value*1e8)/1e8:value;
const failures:string[]=[];
for(let i=0;i<cases.length;i++){try{
 const actual=buildInvestmentAdvice(cases[i].state,day,stamp);
 if(cases[i].name==='invalid-market-counts'){
  // The final handoff explicitly rejects fractional market counts. The
  // Python source rejects fractional sentiment counts but its breadth path
  // still accepts them; the cloud integration intentionally closes this gap.
  assert.equal(expected[i].market.coverage.available,1);assert.equal(actual.market.coverage.available,0);assert(actual.market.coverage.missing.includes('breadth'));assert(actual.market.coverage.missing.includes('sentiment'));
  console.log('Cloud additionally rejects fractional breadth counts, as required by the final handoff.');continue;
 }
 assert.deepEqual(normalize(actual),normalize(expected[i]),cases[i].name);console.log('Advice reference checked: '+cases[i].name);
}catch(error){failures.push(cases[i].name);console.error(String((error as Error).message).split('\n').slice(0,28).join('\n'));}}
assert.equal(failures.length,0,'Advice mismatch: '+failures.join(', '));
console.log('11 synthetic advice outputs match Python, plus one explicit stricter input-validation case; decision identity is checked separately.');
