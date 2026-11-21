/* MY INVEST V2 P4 — fixed-rule, anchored chronological holdout audit.
 * No parameter search, data fetch, credentials, browser state or trade authority.
 * Each fold only sees a prefix ending on its evaluation window's final bar.
 * This is a retrospective time-split stress test, NOT independently proven OOS.
 */
(function(root){
'use strict';
const VERSION='p4-walkforward-v1',MAX_FOLDS=6,MIN_TRAIN=120,MIN_EVAL=40;
const failure=(code,detail)=>({status:'blocked',version:VERSION,code,
 ...(detail===undefined?{}:{detail}),
 verification:{priceSourceVerified:false,independentHoldoutProven:false,
  parametersPreRegistered:false,noOrderAuthority:true}});
const goodInt=n=>Number.isSafeInteger(n)&&n>0;
function dep(which){
 if(typeof module==='object'&&module.exports){
  if(which==='engine')return require('./strategy-evaluation-v1.js');
  if(which==='quality')return require('./strategy-series-quality-v1.js');
  return require('./strategy-evaluation-review-v1.js');
 }
 return which==='engine'?root.MYInvestStrategyEvaluation:
  which==='quality'?root.MYInvestSeriesQuality:root.MYInvestStrategyReview;
}
function median(numbers){
 if(!numbers.length)return null;
 const a=[...numbers].sort((x,y)=>x-y),mid=Math.floor(a.length/2);
 return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
}
function evaluate(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  !goodInt(input.now))return failure('EXPLICIT_AS_OF_REQUIRED');
 const {series,trainBars,evalBars,foldCount}=input;
 if(!series||typeof series!=='object'||Array.isArray(series))return failure('SERIES_REQUIRED');
 if(!goodInt(trainBars)||trainBars<MIN_TRAIN||
  !goodInt(evalBars)||evalBars<MIN_EVAL||
  !goodInt(foldCount)||foldCount<2||foldCount>MAX_FOLDS)
  return failure('INVALID_CHRONOLOGICAL_FOLD_POLICY');
 const needed=trainBars+evalBars*foldCount;
 if(!Number.isSafeInteger(needed)||needed>5000||
  !Array.isArray(series.bars)||series.bars.length!==needed)
  return failure('FOLDS_MUST_COVER_ALL_SERIES_BARS',
   {requiredBars:needed,actualBars:Array.isArray(series.bars)?series.bars.length:null});
 const q=dep('quality').inspect({...series,now:input.now});
 if(q.status!=='structurally_ready'||q.eligibleForProvisionalBacktest!==true)
  return failure('SERIES_QUALITY_NOT_READY',{errors:q.errors||[],flags:q.flags||[]});
 const policy=input.strategy??{};
 if(!policy||typeof policy!=='object'||Array.isArray(policy))return failure('INVALID_FIXED_STRATEGY');
 // No per-fold or future-conditioned parameter choice. The caller may nevertheless
 // have tuned this fixed configuration on the whole dataset: that cannot be proved.
 const engine=dep('engine'),review=dep('review'),folds=[];
 let tradeCount=0,totalNetPnl=0,positiveFolds=0,emptyFolds=0,forcedExits=0;
 for(let n=0;n<foldCount;n++){
  const start=trainBars+n*evalBars,endExclusive=start+evalBars;
  const prefix=series.bars.slice(0,endExclusive);
  const result=engine.simulate({...policy,interval:'1d',bars:prefix,testStartAt:prefix[start].t});
  if(result.status!=='ok')return failure('FOLD_SIMULATION_'+(result.code||result.status),{fold:n+1});
  const checked=review.audit({bars:prefix,simulation:result});
  if(checked.status!=='ok')return failure('FOLD_AUDIT_'+(checked.code||checked.status),{fold:n+1});
  if(result.trades.some(t=>t.entryIndex<start||t.exitIndex>=endExclusive))
   return failure('FOLD_TRADE_OUTSIDE_EVALUATION',{fold:n+1});
  const stats=result.statistics,ended=result.trades.filter(t=>t.reason==='end_of_sample').length;
  const riskExceeded=result.trades.filter(t=>t.riskOverrun===true).length;
  tradeCount+=stats.trades;totalNetPnl+=stats.netPnl;positiveFolds+=stats.netPnl>0?1:0;
  emptyFolds+=stats.trades===0?1:0;forcedExits+=ended;
  folds.push({
   fold:n+1,
   training:{startAt:prefix[0].t,endAt:prefix[start-1].t,
    observedBars:start,usedForParameterFitting:false},
   evaluation:{startAt:prefix[start].t,endAt:prefix.at(-1).t,
    firstIndexInclusive:start,lastIndexInclusive:endExclusive-1,observedBars:evalBars},
   restrictions:{dataCutoffAt:prefix.at(-1).t,
    zeroBarsReadAfterFoldEnd:true,
    initialCapitalResetPerFold:true,
    forcedEndOfFoldLiquidations:ended,tradeSpilloverAllowed:false},
   outcomes:{trades:stats.trades,wins:stats.wins,losses:stats.losses,
    netPnl:stats.netPnl,netReturnPct:stats.netReturnPct,
    winRatePct:stats.winRatePct,meanNetR:stats.meanNetR,
    maxDailyCloseLiquidationDrawdownPct:checked.strategy.drawdown.maxDrawdownPct,
    riskBudgetOverrunTrades:riskExceeded,feeCost:stats.feeCost},
   reliability:{grade:checked.reliability.grade,
    externalSourceProven:false,preRegistrationProven:false}
  });
 }
 const returns=folds.map(f=>f.outcomes.netReturnPct);
 const totalTrades=folds.reduce((a,f)=>a+f.outcomes.trades,0);
 const recomputedPnl=folds.reduce((a,f)=>a+f.outcomes.netPnl,0);
 if(totalTrades!==tradeCount||Math.abs(recomputedPnl-totalNetPnl)>1e-8*Math.max(1,Math.abs(totalNetPnl)))
  return failure('FOLD_AGGREGATION_MISMATCH');
 return {status:'descriptive_only',version:VERSION,
  verification:{priceSourceVerified:false,independentHoldoutProven:false,
   parametersPreRegistered:false,parameterSearchPerformed:false,
   noOrderAuthority:true,realTradingObserved:false},
  method:{name:'ANCHORED_FIXED_RULE_NONOVERLAPPING_CHRONOLOGICAL_WINDOWS',
   trainBars,evalBars,foldCount,
   strategyParametersNotReoptimized:true,
   simulationCutoff:'LAST_COMPLETED_BAR_OF_EACH_FOLD',
   capitalResetBetweenFolds:true,wealthCompoundingAssumed:false,
   testWindowsOverlap:false},
  identity:{market:series.market,exchange:series.exchange,currency:series.currency,
   symbol:series.symbol,sourceProvider:series.sourceProvider,
   priceConvention:series.priceConvention,observedAt:series.observedAt},
  folds,
  stability:{foldsWithPositiveNetPnl:positiveFolds,
   foldWinFractionPct:100*positiveFolds/foldCount,
   foldsWithNoTrades:emptyFolds,
   totalTradeObservations:tradeCount,
   meanFoldReturnPct:returns.reduce((a,b)=>a+b,0)/returns.length,
   medianFoldReturnPct:median(returns),
   worstFoldReturnPct:Math.min(...returns),
   bestFoldReturnPct:Math.max(...returns),
   totalIndependentFoldNetPnlSameInitialCapital:totalNetPnl,
   totalCompoundedReturnPct:null,
   forcedEndOfFoldLiquidations:forcedExits,
   evidenceGrade:tradeCount<30?'LOW_TRADE_SAMPLE':'COUNT_ONLY_NOT_INDEPENDENT_PROOF'},
  warnings:['고정 규칙을 과거의 앞선 시계열만으로 반복 평가했을 뿐 독립 외표본이나 사전 등록 전략임을 입증하지 않습니다.',
   '같은 종목의 인접 평가기간은 서로 독립 표본이 아니며 데이터 스누핑/생존편향이 남습니다.',
   '각 구간은 동일 초기자본으로 재시작합니다. 손익을 이어 붙이거나 누적 복리 수익률로 표시하지 마세요.',
   '구간 마지막 봉에서 포지션 강제청산이 있을 수 있습니다. 실제 계속 보유했을 때와 다른 가상 결과입니다.',
   '과거 자료의 출처 명칭과 완료 표시만으로 실제 종가·기업행동 조정 여부를 검증할 수 없습니다.',
   '단타/분봉 전략, 실시간 매수 신호, 주문 또는 검증된 투자 성과가 아닙니다.']};
}
const api=Object.freeze({evaluate,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestWalkForward=api;
})(typeof globalThis!=='undefined'?globalThis:this);
