/* MY INVEST V2 P4 — fixed-rule, lookahead-safe regime attribution.
 * Deterministic and offline. No data acquisition, storage, account access, trading
 * signals or selection of a "best regime". Only finalized daily benchmark closes.
 */
(function(root){
'use strict';
const VERSION='p4-regime-attribution-v1';
const WINDOW=20,THRESHOLD_PCT=3,MAX_BARS=5000,BUCKETS=['uptrend','sideways','downtrend'];
const finite=Number.isFinite,positive=x=>finite(x)&&x>0;
const failure=(code,details)=>({status:'blocked',version:VERSION,code,
 ...(details===undefined?{}:{details}),verification:{benchmarkSourceVerified:false,
 historicalPriceSourceVerified:false,independentHoldoutProven:false,noOrderAuthority:true}});
function get(name){
 if(typeof module==='object'&&module.exports){
  if(name==='engine')return require('./strategy-evaluation-v1.js');
  if(name==='quality')return require('./strategy-series-quality-v1.js');
  return require('./strategy-evaluation-review-v1.js');
 }
 return name==='engine'?root.MYInvestStrategyEvaluation:
  name==='quality'?root.MYInvestSeriesQuality:root.MYInvestStrategyReview;
}
function bucket(pct){return pct>=THRESHOLD_PCT?'uptrend':pct<=-THRESHOLD_PCT?'downtrend':'sideways'}
function classify(benchmark,index){
 if(!Array.isArray(benchmark)||!Number.isSafeInteger(index)||index<WINDOW||index>=benchmark.length)return null;
 for(let k=index-WINDOW;k<=index;k++){
  if(!benchmark[k]||!positive(benchmark[k].c))return null;
 }
 const ret=(benchmark[index].c/benchmark[index-WINDOW].c-1)*100;
 return {regime:bucket(ret),trailingReturnPct:ret,asOf:benchmark[index].t,fromAt:benchmark[index-WINDOW].t};
}
function validateBenchmark(benchmark,series,now){
 if(!benchmark||typeof benchmark!=='object'||Array.isArray(benchmark))return 'BENCHMARK_METADATA_REQUIRED';
 const market=series.market,currency=series.currency;
 if(benchmark.market!==market||benchmark.currency!==currency)return 'BENCHMARK_MARKET_CURRENCY_MISMATCH';
 if(benchmark.interval!=='1d'||benchmark.finalized!==true)return 'BENCHMARK_FINALIZED_DAILY_REQUIRED';
 if(typeof benchmark.symbol!=='string'||!/^[A-Za-z0-9.^_-]{1,32}$/.test(benchmark.symbol)||
    typeof benchmark.sourceProvider!=='string'||!/^[-_A-Za-z0-9. ]{2,60}$/.test(benchmark.sourceProvider))
   return 'BENCHMARK_SOURCE_IDENTITY_MISSING';
 if(!['price_return','split_adjusted_price'].includes(benchmark.priceConvention))return 'BENCHMARK_RETURN_CONVENTION_REQUIRED';
 if(!Array.isArray(benchmark.bars)||benchmark.bars.length!==series.bars.length||
    benchmark.bars.length<120||benchmark.bars.length>MAX_BARS)return 'BENCHMARK_WINDOW_OR_LENGTH_MISMATCH';
 if(!Number.isSafeInteger(benchmark.observedAt)||
    benchmark.observedAt<benchmark.bars.at(-1)?.t||benchmark.observedAt>now+300000)
    return 'BENCHMARK_OBSERVATION_TIME_INVALID';
 for(let i=0;i<benchmark.bars.length;i++){
  const b=benchmark.bars[i],s=series.bars[i];
  // Exact timestamp identity is deliberately strict. A later data adapter may
  // normalize exchange-local sessions but must not silently align different days.
  if(!b||!s||!Number.isSafeInteger(b.t)||b.t!==s.t||!positive(b.c))
   return 'BENCHMARK_DAILY_ALIGNMENT_OR_CLOSE_INVALID';
  // A discontinuity may be a split, a bad tick or an exceptional market move.
  // Never guess which: require external confirmation before stratification.
  if(i>0&&Math.abs(b.c/benchmark.bars[i-1].c-1)*100>=40)
   return 'BENCHMARK_PRICE_DISCONTINUITY_REVIEW_REQUIRED';
 }
 return null;
}
function wilson(wins,total){
 if(!total)return null;
 const z=1.959963984540054,z2=z*z,p=wins/total,den=1+z2/total;
 const c=(p+z2/(2*total))/den;
 const h=z*Math.sqrt(p*(1-p)/total+z2/(4*total*total))/den;
 return {lowPct:Math.max(0,100*(c-h)),highPct:Math.min(100,100*(c+h)),
  independenceAssumedNotProven:true};
}
function summarize(group,initialCapital){
 const n=group.trades.length,wins=group.trades.filter(t=>t.netPnl>0),
  losses=group.trades.filter(t=>t.netPnl<0);
 const net=group.trades.reduce((acc,t)=>acc+t.netPnl,0);
 const profit=wins.reduce((acc,t)=>acc+t.netPnl,0),
  lossAbs=-losses.reduce((acc,t)=>acc+t.netPnl,0);
 let streak=0,worstStreak=0;
 for(const t of group.trades){
  if(t.netPnl<0){streak++;worstStreak=Math.max(streak,worstStreak)}else streak=0;
 }
 return {
  regime:group.regime,decisionDays:group.days,
  shareOfClassifiedDecisionDaysPct:null,
  trades:n,wins:wins.length,losses:losses.length,
  winRatePct:n?100*wins.length/n:null,winRateWilson95:wilson(wins.length,n),
  netPnl:net,initialCapitalContributionPctPoints:100*net/initialCapital,
  averageNetPnlPerTrade:n?net/n:null,
  meanNetR:n?group.trades.reduce((s,t)=>s+t.netR,0)/n:null,
  worstNetR:n?Math.min(...group.trades.map(t=>t.netR)):null,
  maxConsecutiveLosses:worstStreak,
  riskBudgetOverrunTrades:group.trades.filter(t=>t.riskOverrun===true).length,
  profitFactor:lossAbs>0?profit/lossAbs:null,
  sampleGrade:n<30?'LOW_SAMPLE':'ADEQUATE_COUNT_NOT_INDEPENDENT_PROOF'
 };
}
function analyze(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  !Number.isSafeInteger(input.now)||input.now<=0)return failure('EXPLICIT_NOW_REQUIRED');
 const series=input.series,benchmark=input.benchmark,now=input.now;
 if(!series||typeof series!=='object'||Array.isArray(series))return failure('SERIES_REQUIRED');
 const quality=get('quality').inspect({...series,now});
 if(quality.status!=='structurally_ready'||quality.eligibleForProvisionalBacktest!==true)
  return failure('SERIES_QUALITY_NOT_READY',{errors:quality.errors||[],flags:quality.flags||[]});
 const problem=validateBenchmark(benchmark,series,now);
 if(problem)return failure(problem);
 const strategy=input.strategy??{};
 if(!strategy||typeof strategy!=='object'||Array.isArray(strategy))return failure('INVALID_STRATEGY');
 // Never allow a strategy object to bypass the inspected instrument or bar set.
 const sim=get('engine').simulate({...strategy,interval:'1d',bars:series.bars});
 if(sim.status!=='ok')return failure('SIMULATION_'+(sim.code||sim.status));
 const audit=get('review').audit({bars:series.bars,simulation:sim});
 if(audit.status!=='ok')return failure('AUDIT_'+(audit.code||audit.status));
 const evaluationIndex=sim.validation.evaluationStartAt==null?0:
  series.bars.findIndex(b=>b.t===sim.validation.evaluationStartAt);
 if(evaluationIndex<0)return failure('INVALID_EVALUATION_START');
 const firstDecision=Math.max(WINDOW,evaluationIndex-1);
 const groups=Object.fromEntries(BUCKETS.map(regime=>[regime,{regime,days:0,trades:[]}]));
 const classification=[];
 for(let i=firstDecision;i<series.bars.length-1;i++){
  const c=classify(benchmark.bars,i);
  if(!c)return failure('BENCHMARK_CLASSIFICATION_FAILED',{index:i});
  groups[c.regime].days++;
  classification.push({index:i,at:series.bars[i].t,regime:c.regime,
   trailingReturnPct:c.trailingReturnPct,eligibleForNextOpen:true});
 }
 for(const t of sim.trades){
  const idx=t.decisionIndex;
  if(idx<firstDecision||idx>=series.bars.length-1)return failure('TRADE_OUTSIDE_EVALUATION_WINDOW');
  const c=classify(benchmark.bars,idx);
  if(!c)return failure('TRADE_REGIME_UNKNOWN');
  groups[c.regime].trades.push(t);
 }
 const groupRows=BUCKETS.map(k=>summarize(groups[k],sim.statistics.initialCapital));
 const decisions=classification.length;
 for(const row of groupRows){
  row.shareOfClassifiedDecisionDaysPct=decisions?100*row.decisionDays/decisions:null;
  delete groups[row.regime].trades;
 }
 const groupsPnl=groupRows.reduce((s,r)=>s+r.netPnl,0);
 if(Math.abs(groupsPnl-sim.statistics.netPnl)>1e-7*Math.max(1,Math.abs(sim.statistics.netPnl)))
  return failure('REGIME_NET_PNL_RECONCILIATION_FAILED');
 const count=groupRows.reduce((s,r)=>s+r.trades,0);
 if(count!==sim.statistics.trades)return failure('REGIME_TRADE_COUNT_RECONCILIATION_FAILED');
 let transitions=0;for(let i=1;i<classification.length;i++)
  if(classification[i].regime!==classification[i-1].regime)transitions++;
 return {status:'descriptive_only',version:VERSION,
  method:{basis:'BENCHMARK_TRAILING_20_COMPLETED_DAILY_CLOSE_RETURN',
   thresholdUpPct:THRESHOLD_PCT,thresholdDownPct:-THRESHOLD_PCT,
   classifiedAt:'SIGNAL_DECISION_BAR_CLOSE',entryAt:'NEXT_BAR_OPEN',
   attribution:'ENTIRE_TRADE_PNL_ASSIGNED_TO_SIGNAL_DATE_REGIME',
   pnlContributionDenominator:'SAME_INITIAL_CAPITAL_NOT_STANDALONE_RETURN'},
  verification:{benchmarkSourceVerified:false,historicalPriceSourceVerified:false,
   independentHoldoutProven:false,noOrderAuthority:true,actualMarketRegimeProven:false},
  benchmark:{symbol:benchmark.symbol,market:benchmark.market,currency:benchmark.currency,
   sourceProvider:benchmark.sourceProvider,priceConvention:benchmark.priceConvention,
   observedAt:benchmark.observedAt},
  instrument:{symbol:series.symbol,market:series.market,currency:series.currency,
   exchange:series.exchange,sourceProvider:series.sourceProvider,
   observedAt:series.observedAt},
  period:{firstDecisionAt:classification[0]?.at??null,
   lastDecisionAt:classification.at(-1)?.at??null,
   classifiedDecisionDays:decisions,transitions},
  groups:groupRows,tradeCount:sim.statistics.trades,totalNetPnl:sim.statistics.netPnl,
  totalNetReturnPct:sim.statistics.netReturnPct,
  classification,
  warnings:['상승/횡보/하락은 20봉 후행 수익률 ±3%의 임의 기술 분류로, 경제학적 장세 판정이 아닙니다.',
   '신호일 종가까지의 벤치마크 데이터만 사용하고 다음 일봉 시가로 진입합니다.',
   '매매 손익 전체를 신호일 장세에 귀속하므로 보유 중 장세 변화의 영향으로 해석할 수 없습니다.',
   '장세별 초기자본 대비 순손익 기여도는 독립 운용 수익률이나 알파가 아닙니다.',
   '표본 부족·생존편향·비독립 거래·데이터 스누핑 및 가격 원천 미검증 문제가 남아 있습니다.',
   '실시간 추천·시장 예측·주문 실행 기능이 아닙니다.']};
}
const api=Object.freeze({analyze,classify,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestRegimeAttribution=api;
})(typeof globalThis!=='undefined'?globalThis:this);
