import {body,json} from './http.ts';
import {sha256} from './protocol.ts';
import {AppError} from './workspace.ts';
import {InvestmentStore} from './investment-store.ts';
import {validateInvestmentBackup} from './investment-backup.ts';
import {InvestmentValidationError,InvestmentConflictError,validateInstrument,validateProfile,validateAccountContext,validateOpening,validateTransactionInput,validPlanDate,validDate,numeric,replayTransactions,summarizeInvestment,contextId,orderCheck,freshness,validateReportSections,reportScoreLabel,MARKET_SECTIONS,DIAGNOSIS_SECTIONS,todayShanghai} from './investment-domain.ts';
import type {InvestmentState,InvestmentSpace,Instrument,Snapshot,Plan,InvestmentReport,Transaction} from './investment-domain.ts';
import * as market from './investment-market.ts';

type Input=Record<string,unknown>&{base_version:number;operation_id:string};
const idPattern=/^[A-Za-z0-9_-]{1,120}$/;
const now=()=>new Date().toISOString();
const spaceOf=(value:unknown):InvestmentSpace=>{if(value!=='personal'&&value!=='demo')throw new InvestmentValidationError('工作区无效');return value;};
function text(value:unknown,label:string,max=5000,required=false){if(value===undefined||value===null){if(required)throw new InvestmentValidationError(label+'不能为空');return '';}if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new InvestmentValidationError(label+'无效');return value;}
function safeUrl(value:unknown){const s=text(value,'来源链接',2000,true);try{if(!['https:','http:'].includes(new URL(s).protocol))throw 0;}catch{throw new InvestmentValidationError('来源必须是http/https原文链接');}return s;}
function instrument(state:InvestmentState,id:unknown){const result=state.instruments.find(x=>x.id===id);if(!result)throw new InvestmentValidationError('未知品种，需选择完整品种身份',404);return result;}
function pathParts(url:URL){try{return url.pathname.split('/').filter(Boolean).slice(2).map(decodeURIComponent);}catch{throw new InvestmentValidationError('请求路径无效');}}
function cleanInput(input:Input){const {base_version:_version,operation_id:_operation,space:_space,owner:_owner,...value}=input;return value;}
function currentMarket(state:InvestmentState){const value=state.market?structuredClone(state.market):null;if(value?.status==='fresh'&&value.date!==todayShanghai())value.status='stale';return value;}
function reports(state:InvestmentState){return [...state.reports].map(report=>{const snapshot=report.report_type==='market'?currentMarket(state):freshness(state.snapshots[report.instrument_id||'']);return {...report,is_stale:report.is_stale||snapshot?.snapshot_id!==report.snapshot_id||snapshot?.status!=='fresh'||report.context_id!==contextId(state)};}).sort((a,b)=>b.created_at.localeCompare(a.created_at));}

export function investmentFailure(error:unknown){
 if(error instanceof InvestmentValidationError)return json({error:error.message,code:error instanceof InvestmentConflictError?'INVESTMENT_CONFLICT':undefined,...(error instanceof InvestmentConflictError&&error.latest?{version:error.latest.version}: {})},error.status);
 if(error instanceof AppError)return json({error:error.message},error.status);
 console.error(JSON.stringify({code:'INVESTMENT_REQUEST_FAILED',name:error instanceof Error?error.name:'unknown'}));
 return json({error:'理财投资服务暂时不可用，未提交内容保留在本机，请重试'},500);
}

export async function investmentRoute(request:Request){
 try{const {identity}=await import('./auth.ts');const {env}=await import('cloudflare:workers');const user=await identity(request);return await handleInvestmentRequest(request,new InvestmentStore(env.DB,user.owner,market));}
 catch(error){return investmentFailure(error);}
}

export async function handleInvestmentRequest(request:Request,store:InvestmentStore):Promise<Response>{
 try{
  const url=new URL(request.url),parts=pathParts(url),action=parts.join('/'),method=request.method;
  const querySpace=spaceOf(url.searchParams.get('space')||'personal');
  if(method==='GET'){
   if(action==='session')return json({owner:store.owner,space:querySpace});
   if(action==='health')return json({status:'ok',runtime:'cloudflare-worker',space:querySpace});
   if(action===''||action==='bootstrap')return json({...await store.readBootstrap(querySpace),owner:store.owner});
   if(action==='search')return json({items:await store.search(querySpace,url.searchParams.get('q')||'')});
   const state=await store.snapshot(querySpace);
   if(action==='instruments'||action==='watchlist')return json(state.instruments.filter(x=>x.watched!==false));
   if(parts[0]==='instruments'&&parts[2]==='snapshot'&&parts.length===3){instrument(state,parts[1]);const snapshot=freshness(state.snapshots[parts[1]]);if(!snapshot)throw new InvestmentValidationError('还没有行情快照，请先刷新',404);return json(snapshot);}
   if(parts[0]==='jobs'&&parts.length===2){const job=state.jobs.find(x=>x.id===parts[1]);if(!job)throw new InvestmentValidationError('刷新任务不存在',404);return json(job);}
   if(action==='profile')return json(state.profile);
   if(action==='account-context')return json(state.account_context);
   if(action==='plans')return json([...state.plans].sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at)));
   if(action==='transactions')return json([...state.transactions].sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at)));
   if(action==='reports')return json(reports(state));
   if(action==='portfolio')return json(summarizeInvestment({...state,snapshots:Object.fromEntries(Object.entries(state.snapshots).map(([id,snapshot])=>[id,freshness(snapshot)!]))}));
   if(action==='backups')return json(await store.backups(querySpace));
   if(action==='export')return json({schema_version:1,owner:store.owner,space:querySpace,version:state.version,state,state_sha256:await sha256(JSON.stringify(state))});
   if(action==='order-check'){
    const item=instrument(state,url.searchParams.get('instrument_id'));
    const budget=Number(url.searchParams.get('budget')),price=Number(url.searchParams.get('price'));
    const check=orderCheck(item,state.profile,price,budget),portfolio=summarizeInvestment(state),snapshot=freshness(state.snapshots[item.id]);
    const reject=(reason:string)=>{check.eligible=false;check.quantity=null;check.cost=null;check.reasons.push(reason);};
    if(snapshot?.status!=='fresh')reject('缺少当日有效参考行情，暂不输出数量');
    if(portfolio.loss_triggered)reject('累计净亏损已达到暂停线，请先复盘');
    if(!portfolio.valuation_complete||portfolio.total_pnl===null)reject('账本估值或实际费用尚未核对完整，暂不输出数量');
    if(budget>portfolio.cash)reject('预算超过账本可用现金，请先核对资金');
    return json(check);
   }
   if(action==='analysis-package'){
    const type=url.searchParams.get('type')||'market';if(type!=='market'&&type!=='diagnosis')throw new InvestmentValidationError('报告类型无效');
    const item=type==='diagnosis'?instrument(state,url.searchParams.get('instrument_id')):null;
    const snapshot=item?freshness(state.snapshots[item.id]):currentMarket(state);
    if(item&&!snapshot)throw new InvestmentValidationError('尚无数据快照，请先刷新');
    const snapshotId=snapshot?.snapshot_id||'market:missing',context=contextId(state),stamp=now();
    const template={report_type:type,instrument_id:item?.id||null,snapshot_id:snapshotId,context_id:context,conclusion:'待补充',score:null,strategy:'待补充',position_range:'待补充',sections:(type==='market'?MARKET_SECTIONS:DIAGNOSIS_SECTIONS).map(title=>({title,body:'待补充'})),sources:[]};
    const prompt='请基于附带真实数据及可核验原文分析，结论前置；事实、推断与待核验内容分开。不编造缺失数值，不把评分当上涨概率，不承诺收益。保留数据日期、来源、风险和证伪条件。旧行情、未知费用或未核对资金用途/期限/持仓时不给个性化数量。保持report_template的品种、快照、上下文和章节标题顺序。请输出对应JSON。';
    const value={version:1,report_type:type,instrument_id:item?.id||null,snapshot_id:snapshotId,exported_at:stamp,profile_context:Object.fromEntries(['initial_capital','loss_limit','purpose','horizon','holdings_confirmed'].map(k=>[k,state.profile[k as keyof typeof state.profile]])),account_context:state.account_context,portfolio_context:summarizeInvestment(state),data:item?{instrument:item,snapshot}:{market:snapshot||{snapshot_id:snapshotId,status:'missing',missing_fields:['市场快照待补充']},indices:state.instruments.filter(x=>x.kind==='index').map(x=>freshness(state.snapshots[x.id])).filter(Boolean)},report_template:template,prompt};
    await store.registerExport(querySpace,snapshotId,{instrument_id:item?.id||null,report_type:type,context_id:context,exported_at:stamp});
    return json({...value,context_id:context,markdown:'# 投资工作台分析包\n\n'+prompt+'\n\n```json\n'+JSON.stringify(value,null,2)+'\n```'});
   }
   throw new InvestmentValidationError('接口不存在',404);
  }
  if(!['POST','PUT','DELETE'].includes(method))return json({error:'请求方法不支持'},405);
  const raw=await body(request,2_500_000);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InvestmentValidationError('请求内容必须是对象');
  const input=raw as Input,space=spaceOf(input.space||querySpace);if(space!==querySpace)throw new InvestmentValidationError('请求空间不一致',403);
  if(input.owner!==undefined&&input.owner!==store.owner)throw new InvestmentValidationError('请求身份不匹配',403);
  const payload=cleanInput(input);
  if(action==='refresh'&&method==='POST'){
   if(input.ids!==undefined&&(!Array.isArray(input.ids)||input.ids.some(x=>typeof x!=='string')))throw new InvestmentValidationError('刷新品种列表无效');
   if(input.full!==undefined&&typeof input.full!=='boolean')throw new InvestmentValidationError('刷新选项无效');
   return json(await store.refresh(space,{...input,ids:input.ids as string[]|undefined,full:input.full as boolean|undefined}));
  }
  if(action==='backups'&&method==='POST')return json(await store.mutate(space,input,async()=>({...await store.createBackup(space)})));
  if(action==='backups/restore'&&method==='POST'){
   const restored=payload.backup?await validateInvestmentBackup(payload.backup,store.owner,space):(await store.loadBackup(space,text(payload.name,'备份名称',100,true))).envelope.state;
   return json(await store.mutate(space,input,state=>{Object.assign(state,structuredClone(restored));state.owner=store.owner;state.space=space;return {restored:true};},{backupBefore:true}));
  }
  return json(await store.mutate(space,input,async state=>{
   if((action==='watchlist'||action==='instruments')&&method==='POST'){
    const item=validateInstrument({...payload,id:payload.id||`${payload.kind}:${payload.exchange}:${payload.code}`});
    item.personalized=true;item.watched=true;
    const found=state.instruments.findIndex(x=>x.id===item.id);if(found>=0)state.instruments[found]=item;else state.instruments.push(item);return {...item};
   }
   if((parts[0]==='watchlist'||parts[0]==='instruments')&&parts.length===2&&method==='DELETE'){
    const item=instrument(state,parts[1]);const portfolio=summarizeInvestment(state);
    if(portfolio.positions.some(x=>x.instrument_id===item.id)||portfolio.pending.some(x=>x.instrument_id===item.id))throw new InvestmentValidationError('该品种有持仓或待确认记录，不能从关注列表移除');
    item.watched=false;return {removed:item.id};
   }
   if(action==='profile'&&method==='PUT'){
    const next=validateProfile(payload,state.profile);
    if(next.holdings_confirmed&&!state.profile.holdings_confirmed)throw new InvestmentValidationError('请先录入初始账本或显式核对完整历史记录，不能仅勾选确认');
    if((state.opening||state.transactions.length)&&next.initial_capital!==state.profile.initial_capital)throw new InvestmentConflictError('已有账本记录，初始本金不能改写，请记录实际入金或出金');
    state.profile=next;return {...state.profile};
   }
   if(action==='account-context'&&method==='PUT'){state.account_context={...validateAccountContext(payload,state.instruments),recorded_at:now()};return {...state.account_context};}
   if(action==='ledger/initialize'&&method==='POST'){
    if(state.opening||state.transactions.length)throw new InvestmentValidationError('初始开账已存在或已有成交，不能覆盖；纠错请从备份恢复');
    state.opening=validateOpening(payload,state.instruments);state.profile.holdings_confirmed=true;state.profile.initial_capital=state.opening.initial_equity;
    return {opening:state.opening,portfolio:summarizeInvestment(state)};
   }
   if(action==='ledger/confirm'&&method==='POST'){
    if(payload.confirmed!==true||state.opening||!state.transactions.length)throw new InvestmentValidationError('仅供已逐笔完整补录历史成交与现金流的账本确认，空账本请登记初始状态');
    replayTransactions(state);
    state.profile.holdings_confirmed=true;return {profile:state.profile};
   }
   if(action==='plans'&&method==='POST'){
    const item=instrument(state,payload.instrument_id),date=validPlanDate(payload.date);
    if(!['observe','consider','no_trade'].includes(String(payload.action)))throw new InvestmentValidationError('预案行动无效');
    const budget=payload.budget===undefined||payload.budget===null?null:numeric(payload.budget,'budget');if(budget!==null&&budget<0)throw new InvestmentValidationError('预案预算不能为负数');
    const id=payload.id===undefined?crypto.randomUUID():text(payload.id,'预案id',120,true);if(!idPattern.test(id))throw new InvestmentValidationError('预案id无效');
    const prior=state.plans.find(x=>x.id===id);if(prior&&prior.instrument_id!==item.id)throw new InvestmentValidationError('不能改变既有预案的品种身份');
    const plan:Plan={id,instrument_id:item.id,date,action:payload.action as Plan['action'],observation:text(payload.observation,'观察'),buy_condition:text(payload.buy_condition,'买入条件'),exit_condition:text(payload.exit_condition,'退出条件'),invalidation:text(payload.invalidation,'证伪条件'),budget,notes:text(payload.notes,'备注'),created_at:prior?.created_at||now(),updated_at:now()};
    state.plans=state.plans.filter(x=>x.id!==id);state.plans.push(plan);return {...plan};
   }
   if(action==='transactions'&&method==='POST'){
    const value=validateTransactionInput(payload,state.instruments);if(state.opening&&value.date<state.opening.date)throw new InvestmentValidationError('成交日期不能早于开账基准');
    if(value.plan_id&&!state.plans.some(x=>x.id===value.plan_id&&x.instrument_id===value.instrument_id))throw new InvestmentValidationError('预案关联品种不匹配');
    const transaction:Transaction={...value,id:crypto.randomUUID(),created_at:now()};state.transactions.push(transaction);replayTransactions(state);return {...transaction};
   }
   if(action==='reports'&&method==='POST'){
    const type=payload.report_type;if(type!=='market'&&type!=='diagnosis')throw new InvestmentValidationError('报告类型无效');
    const id=type==='diagnosis'?instrument(state,payload.instrument_id).id:null;if(type==='market'&&payload.instrument_id!=null)throw new InvestmentValidationError('市场报告不能绑定单一品种');
    const snapshotId=text(payload.snapshot_id,'快照id',150,true),binding=state.exports[snapshotId];if(!binding)throw new InvestmentValidationError('请先导出分析包，再导入对应报告');
    if(binding.instrument_id!==id||binding.report_type!==type)throw new InvestmentValidationError('报告快照与品种不匹配');
    const reportContext=payload.context_id==null?binding.context_id:text(payload.context_id,'报告上下文',100,true);if(reportContext!==binding.context_id)throw new InvestmentValidationError('报告个人上下文与导出的分析包不匹配');
    const score=payload.score==null?null:payload.score;if(score!==null&&(typeof score!=='number'||!Number.isInteger(score)||score<0||score>100))throw new InvestmentValidationError('报告分数必须为0至100的整数或null');
    const sources=payload.sources===undefined?[]:payload.sources;if(!Array.isArray(sources)||sources.length>100)throw new InvestmentValidationError('报告来源列表无效');
    const current=type==='market'?currentMarket(state):freshness(state.snapshots[id!]);
    const report:InvestmentReport={id:crypto.randomUUID(),report_type:type,instrument_id:id,snapshot_id:snapshotId,context_id:reportContext,conclusion:text(payload.conclusion,'结论',5000,true),score,strategy:text(payload.strategy,'策略'),position_range:text(payload.position_range,'仓位区间'),sections:validateReportSections(type,payload.sections),sources:sources.map(safeUrl),created_at:now(),is_stale:current?.snapshot_id!==snapshotId||current?.status!=='fresh'||reportContext!==contextId(state),score_label:reportScoreLabel(score)};
    state.reports.push(report);return {...report};
   }
   if(action==='import/history'&&method==='POST'){
    const item=instrument(state,payload.instrument_id);if(!Array.isArray(payload.rows)||!payload.rows.length||payload.rows.length>2000)throw new InvestmentValidationError('历史数据需要1至2000行');
    const seen=new Set<string>();const rows=payload.rows.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InvestmentValidationError('历史行无效');const row=raw as Record<string,unknown>,date=validDate(row.date);if(seen.has(date))throw new InvestmentValidationError('历史日期不能重复');seen.add(date);const close=numeric(row.close,'close',false,true) as number;const price=(key:string)=>numeric(row[key],key,true,true);const volume=numeric(row.volume,'volume',true),amount=numeric(row.amount,'amount',true);if((volume!==null&&volume<0)||(amount!==null&&amount<0))throw new InvestmentValidationError('成交量和金额不能为负数');const open=price('open'),high=price('high'),low=price('low');if((high!==null&&high<close)||(low!==null&&low>close)||(high!==null&&low!==null&&high<low))throw new InvestmentValidationError('历史高低价格关系无效');return {date,open,high,low,close,volume,amount};}).sort((a,b)=>a.date.localeCompare(b.date));
    const last=rows.at(-1)!,source=text(payload.source_label,'历史来源',300,true),status=last.date===todayShanghai()?'fresh':'stale';
    const average=(period:number)=>rows.length>=period?rows.slice(-period).reduce((sum,row)=>sum+row.close,0)/period:null;
    const range=rows.length>=120?rows.slice(-120).map(row=>row.close):null,min=range?Math.min(...range):null,max=range?Math.max(...range):null;
    const snapshot:Snapshot={snapshot_id:await sha256({instrument_id:item.id,source,rows}),instrument_id:item.id,source:'manual',source_url:null,as_of:last.date,fetched_at:now(),status,error:null,quote:{price:last.close,change_pct:null,open:last.open,high:last.high,low:last.low,preclose:rows.length>1?rows.at(-2)!.close:null,volume:last.volume,amount:last.amount},history:rows,adjustment:'none',valuation_kind:item.kind==='fund'?'confirmed_nav':'market_price',metrics:{ma20:average(20),ma60:average(60),return_20d:rows.length>20?(last.close/rows.at(-21)!.close-1)*100:null,range_120d:range&&max!==min?((last.close-min!)/(max!-min!))*100:null,history_count:rows.length},fundamentals:[],evidence:[],warnings:['手动历史来源：'+source],quote_source:'manual',history_source:'manual',history_as_of:last.date,history_status:status,units:{price:'元',volume:item.kind==='fund'?'份':'股/份',amount:'元'}};
    state.snapshots[item.id]=snapshot;return {...snapshot};
   }
   throw new InvestmentValidationError('接口不存在或方法不匹配',404);
  },{backupBefore:action==='account-context'||action==='ledger/initialize'}));
 }catch(error){return investmentFailure(error);}
}
