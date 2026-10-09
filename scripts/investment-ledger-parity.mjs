import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
const source=process.argv[2];if(!source)throw new Error('Pass the read-only investment source directory');
const domain=await import(process.env.INVESTMENT_DOMAIN_PATH?pathToFileURL(process.env.INVESTMENT_DOMAIN_PATH):new URL('../lib/investment-domain.ts',import.meta.url));
const date='2026-10-09';
const instruments=[{id:'etf:SH:510300',kind:'etf',exchange:'SH',code:'510300',name:'公开样例ETF'},{id:'fund:OF:110022',kind:'fund',exchange:'OF',code:'110022',name:'公开样例基金'}];
const snapshots=Object.fromEntries(instruments.map(i=>[i.id,{instrument_id:i.id,snapshot_id:'synthetic-'+i.id,status:'fresh',as_of:date,quote:{price:4}}]));
const opening=(cost)=>({date,cash:8000,confirmed_empty:false,positions:[{instrument_id:instruments[0].id,quantity:500,average_cost:cost,reference_price:4,broker_display_cost:-0.2}]});
const transaction=(kind,extra={})=>({kind,date,...extra});
const scenarios=[
 {name:'empty-confirmed',opening:{date,cash:10000,confirmed_empty:true,positions:[]},transactions:[]},
 {name:'known-opening',opening:opening(3.8),transactions:[]},
 {name:'unknown-opening-cost',opening:opening(null),transactions:[]},
 {name:'deposit-withdraw',opening:opening(null),transactions:[transaction('deposit',{amount:1000}),transaction('withdraw',{amount:200})]},
 {name:'unknown-sale-cost',opening:opening(null),transactions:[transaction('sell',{instrument_id:instruments[0].id,quantity:100,price:4,fees:1})]},
 {name:'unknown-buy-fees',opening:opening(3.8),transactions:[transaction('buy',{instrument_id:instruments[0].id,quantity:100,price:4,fees:null})]},
 {name:'fund-pending',opening:opening(3.8),transactions:[transaction('fund_pending',{instrument_id:instruments[1].id,amount:500})]},
].map(s=>({...s,instruments,snapshots,profile:{...domain.DEFAULT_PROFILE,holdings_confirmed:true}}));
const expected=JSON.parse(execFileSync(process.env.INVESTMENT_REFERENCE_PYTHON||'python',['-B',fileURLToPath(new URL('./investment-ledger-reference.py',import.meta.url)),source],{input:JSON.stringify(scenarios),encoding:'utf8',windowsHide:true}));
const keys=['initial_capital','net_contributions','cash','market_value','total_equity','realized_pnl','unrealized_pnl','total_pnl','total_fees','opening_pnl','valuation_complete','provisional','cash_estimated','total_equity_estimated','loss_triggered'];
const failures=[];
for(let index=0;index<scenarios.length;index++){
 const s=scenarios[index],state=domain.emptyInvestmentState('parity-synthetic','personal');state.profile=s.profile;state.instruments=s.instruments;state.snapshots=s.snapshots;state.opening=domain.validateOpening(s.opening,s.instruments);
 state.transactions=s.transactions.map((t,i)=>({...domain.validateTransactionInput(t,s.instruments),id:'parity-'+i,created_at:date+'T00:00:0'+i+'Z'}));
 const actual=domain.summarizeInvestment(state);
 for(const key of keys){try{if(typeof actual[key]==='number'&&typeof expected[index][key]==='number')assert.ok(Math.abs(actual[key]-expected[index][key])<1e-8,s.name+': '+key);else assert.deepEqual(actual[key],expected[index][key],s.name+': '+key);}catch{failures.push({scenario:s.name,key,actual:actual[key],reference:expected[index][key]});}}
 assert.equal(actual.pending.length,expected[index].pending.length,s.name+': pending');
 console.log('Reference scenario checked:',s.name);
}
assert.deepEqual(failures,[],'Reference parity failures: '+JSON.stringify(failures));
