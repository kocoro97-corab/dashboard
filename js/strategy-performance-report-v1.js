/* MY INVEST V2 P4: deterministic, offline strategy-risk review.
 * No network, storage, account access, optimization, "best" strategy selection,
 * portfolio actions, or orders. All source data remains UNVERIFIED.
 */
(function(root){
'use strict';
const VERSION='p4-performance-report-v1',MAX_CASES=6;
const integer=Number.isSafeInteger,finite=Number.isFinite;
const invalid=code=>({status:'invalid',version:VERSION,code,
 verification:{sourceVerified:false,independentHoldoutProven:false,noOrderAuthority:true}});
function dependency(name){
 if(typeof module==='object'&&module.exports){
  if(name==='quality')return require('./strategy-series-quality-v1.js');
  if(name==='engine')return require('./strategy-evaluation-v1.js');
  return require('./strategy-evaluation-review-v1.js');
 }
 return name==='quality'?root.MYInvestSeriesQuality:
  name==='engine'?root.MYInvestStrategyEvaluation:root.MYInvestStrategyReview;
}
function safeName(s,max){
 return typeof s==='string'&&s.length>0&&s.length<=max&&
  !/[\u0000-\u001F\u007F<>]/.test(s)?s:null;
}
function median(arr){
 if(!arr.length)return null;
 const sorted=[...arr].sort((a,b)=>a-b),m=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[m]:(sorted[m-1]+sorted[m])/2;
}
function estimateExecutionDrag(trades,slip){
 let fees=0,slippage=0;
 for(const t of trades){
  const opening=t.entryOpen,rawExit=t.exitFill/(1-slip);
  const f=t.entryFee+t.exitFee;
  // This is a fill-price distance, NOT a no-slippage counterfactual P&L.
  slippage+=t.quantity*((t.entryFill-opening)+(rawExit-t.exitFill));
  fees+=f;
 }
 return {feeCost:fees,fillDistanceSlippageEstimate:slippage,
  feeAndFillDistanceSum:fees+slippage,
  interpretation:'Executed trade fill-distance proxy, not a counterfactual P&L impact'};
}
function summarizeCase(value,now,deps){
 if(!value||typeof value!=='object'||Array.isArray(value)||
  !safeName(value.id,50)||!safeName(value.label,100))
  return {id:null,label:null,status:'blocked',reason:'INVALID_CASE_ID_OR_LABEL'};
 const identity={market:value.series?.market||null,symbol:value.series?.symbol||null,
  exchange:value.series?.exchange||null,currency:value.series?.currency||null,
  priceConvention:value.series?.priceConvention||null,
  sourceProvider:value.series?.sourceProvider||null};
 const quality=deps.quality.inspect({...value.series,now});
 const response={id:value.id,label:value.label,identity,status:'blocked',
  quality:{status:quality.status,errors:quality.errors||[],flags:quality.flags||[],
   facts:quality.facts||{},realSourceVerified:false},
  evidence:{priceSourceVerified:false,independentHoldoutProven:false,
   actualTradingObserved:false},metrics:null};
 if(quality.status==='block'){response.reason='DATA_STRUCTURE_BLOCKED';return response}
 if(quality.status!=='structurally_ready'||quality.eligibleForProvisionalBacktest!==true){
  response.status='review_required';response.reason='DATA_QUALITY_REVIEW_REQUIRED';return response
 }
 const config=value.strategy||{};
 if(config==null||typeof config!=='object'||Array.isArray(config)){
  response.reason='INVALID_STRATEGY_CONFIGURATION';return response;
 }
 // A caller-supplied strategy cannot replace bars, interval or provenance.
 const simulated=deps.engine.simulate({...config,interval:'1d',bars:value.series.bars});
 if(simulated.status!=='ok'){response.reason='STRATEGY_SIMULATION_'+(simulated.code||simulated.status);return response}
 const checked=deps.review.audit({bars:value.series.bars,simulation:simulated});
 if(checked.status!=='ok'){response.reason='REVIEW_RECONCILIATION_'+(checked.code||checked.status);return response}
 const st=simulated.statistics,trs=simulated.trades,
  risks=trs.map(t=>t.netR).filter(finite),losses=trs.filter(t=>t.netPnl<0);
 const duration=checked.strategy.curve.length;
 const overrun=trs.filter(t=>t.riskOverrun===true).length;
 const costs=estimateExecutionDrag(trs,simulated.parameters.slippageBps/10000);
 response.status='descriptive_only';
 response.reason='DATA_ORIGIN_AND_HOLDOUT_UNVERIFIED';
 response.metrics={
  period:{firstAt:checked.validation.evaluationStartAt,
   lastAt:value.series.bars.at(-1).t,completedDailyBars:duration},
  parameters:{...simulated.parameters},
  outcomes:{trades:st.trades,wins:st.wins,losses:st.losses,
   winRatePct:st.winRatePct,winRateWilson95:checked.reliability.winRateWilson95,
   totalNetReturnPct:st.netReturnPct,totalNetPnl:st.netPnl,finalEquity:st.finalEquity,
   meanNetR:st.meanNetR,medianNetR:median(risks),
   meanNetPnlPerTrade:trs.length?st.netPnl/trs.length:null,
   profitFactor:st.profitFactor,
   worstNetR:losses.length?Math.min(...losses.map(t=>t.netR)):null},
  risk:{dailyCloseLiquidationMaxDrawdownPct:checked.strategy.drawdown.maxDrawdownPct,
   realizedTradesOnlyMaxDrawdownPct:checked.strategy.realizedOnlyDrawdownPct,
   drawdownScope:'DAILY_CLOSE_LIQUIDATION_NOT_INTRADAY',
   riskBudgetOverrunTrades:overrun,
   shareOfBarsWithPositionPct:duration?100*simulated.statistics.exposureBars/duration:null},
  costs,
  reference:{fullCapitalBuyHoldReturnPct:checked.buyAndHold?.netReturnPct??null,
   allocationCappedBuyHoldReturnPct:checked.allocationMatchedBuyAndHold?.netReturnPct??null,
   investmentExposureComparable:false},
  reliability:{grade:checked.reliability.grade,tradeCount:trs.length,
   minimumSuggestedTrades:checked.reliability.minimumSuggestedTrades,
   knownExternalDataVerification:false,predeclaredOutOfSampleProven:false}
 };
 response.warnings=[...checked.warnings,
  '수익률은 재현 가능한 과거 모의값이며 매수·매도 권고나 AI 예측이 아닙니다.'];
 return response;
}
function sameBars(a,b){
 if(!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length)return false;
 for(let i=0;i<a.length;i++){
  const x=a[i],y=b[i];
  if(!x||!y||['t','o','h','l','c','v'].some(k=>x[k]!==y[k]))return false;
 }
 return true;
}
function comparability(values,items){
 if(items.length<2)return {eligible:false,reason:'NEED_TWO_SCENARIOS',observations:[]};
 if(items.some(x=>x.status!=='descriptive_only'))
  return {eligible:false,reason:'UNREVIEWED_OR_BLOCKED_INPUT',observations:[]};
 const base=values[0],bp=items[0].metrics.parameters,ident=items[0].identity;
 for(let i=1;i<items.length;i++){
  const v=values[i],p=items[i].metrics.parameters,other=items[i].identity;
  if(Object.keys(ident).some(k=>ident[k]!==other[k])||
   !sameBars(base.series.bars,v.series.bars)||
   bp.initialCapital!==p.initialCapital||bp.feeBps!==p.feeBps||
   bp.slippageBps!==p.slippageBps||
   (base.strategy?.testStartAt??null)!==(v.strategy?.testStartAt??null))
   return {eligible:false,reason:'DIFFERENT_INSTRUMENT_HISTORY_PERIOD_OR_COSTS',observations:[]};
 }
 return {eligible:true,reason:'SAME_HISTORICAL_INPUT_DESCRIPTIVE_ONLY',
  note:'시나리오 순위·최적값을 계산하지 않습니다. 동일 과거 자료에서 전략을 골랐다면 데이터 스누핑 편향이 있습니다.',
  exposureVaries:items.some(x=>x.metrics.parameters.riskPct!==bp.riskPct||
   x.metrics.parameters.maxAllocationPct!==bp.maxAllocationPct),
  observations:items.map(x=>({id:x.id,label:x.label,
   netReturnPct:x.metrics.outcomes.totalNetReturnPct,
   maxDailyCloseDrawdownPct:x.metrics.risk.dailyCloseLiquidationMaxDrawdownPct,
   trades:x.metrics.outcomes.trades,winRatePct:x.metrics.outcomes.winRatePct,
   feeCost:x.metrics.costs.feeCost,
   sourceVerified:false}))};
}
function generate(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  !Array.isArray(input.cases)||input.cases.length<1||input.cases.length>MAX_CASES)
  return invalid('CASE_COUNT_1_TO_6_REQUIRED');
 if(!integer(input.now)||input.now<=0)return invalid('EXPLICIT_NOW_REQUIRED');
 const dep={quality:dependency('quality'),engine:dependency('engine'),review:dependency('review')};
 if(!dep.quality?.inspect||!dep.engine?.simulate||!dep.review?.audit)return invalid('P4_DEPENDENCY_MISSING');
 const ids=new Set();
 for(const c of input.cases){
  if(!c||!safeName(c.id,50)||ids.has(c.id))return invalid('DUPLICATE_OR_INVALID_CASE_ID');
  ids.add(c.id);
 }
 const cases=input.cases.map(c=>summarizeCase(c,input.now,dep));
 const comparison=comparability(input.cases,cases);
 return {status:cases.every(x=>x.status==='descriptive_only')?'descriptive_only':
  cases.some(x=>x.status==='descriptive_only')?'partial_review':'blocked',
  version:VERSION,verification:{sourceVerified:false,independentHoldoutProven:false,
   recommendation:false,noOrderAuthority:true,liveData:false},
  cases,comparison,
  interpretation:'과거 자료의 탐색적·기술적 비교만 제공; 검증된 시세·독립 평가기간·실제 성과를 주장하지 않음',
  warnings:['본 모듈은 원천 가격의 진위 또는 시장 데이터 제공자의 권한을 검증하지 않습니다.',
   '동일 과거 표본에서 전략 조건을 선택하면 성과 과대평가 위험이 있습니다.',
   '종목·기간·비용·자본 기준이 다르면 수익률 비교를 차단합니다.',
   '성과 비교는 전략 추천, 주문 승인 또는 금융계좌 접근을 수행하지 않습니다.']};
}
const api=Object.freeze({generate,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestPerformanceReport=api;
})(typeof globalThis!=='undefined'?globalThis:this);
