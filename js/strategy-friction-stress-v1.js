/* MY INVEST V2 P4 — deterministic offline transaction-friction sensitivity.
 * A descriptive historical simulation, NOT a forecast, VaR, or executable order.
 * No network, credentials, external storage, model fitting, or trading authority.
 */
(function(root){
'use strict';
const VERSION='p4-friction-stress-v1',BUMP=[10,30],GAP_PCT=[5,10];
const isNum=Number.isFinite;
function fail(code,detail){
 return {status:'blocked',version:VERSION,code,...(detail===undefined?{}:{detail}),
  verification:{sourceVerified:false,independentHoldoutProven:false,noOrderAuthority:true}};
}
function dependency(name){
 if(typeof module==='object'&&module.exports){
  if(name==='quality')return require('./strategy-series-quality-v1.js');
  if(name==='engine')return require('./strategy-evaluation-v1.js');
  return require('./strategy-evaluation-review-v1.js');
 }
 return name==='quality'?root.MYInvestSeriesQuality:
  name==='engine'?root.MYInvestStrategyEvaluation:root.MYInvestStrategyReview;
}
function measuredCase(id,label,params,bars,engine,review){
 const result=engine.simulate({...params,interval:'1d',bars});
 if(result.status!=='ok')return {ok:false,code:'SIMULATION_'+(result.code||result.status)};
 const audited=review.audit({bars,simulation:result});
 if(audited.status!=='ok')return {ok:false,code:'LEDGER_AUDIT_'+(audited.code||audited.status)};
 const st=result.statistics,trs=result.trades;
 return {ok:true,id,label,params:result.parameters,raw:result,
  presentation:{
   id,label,feeBps:result.parameters.feeBps,slippageBps:result.parameters.slippageBps,
   trades:st.trades,winRatePct:st.winRatePct,netPnl:st.netPnl,
   netReturnPct:st.netReturnPct,feeCost:st.feeCost,
   maxDailyCloseDrawdownPct:audited.strategy.drawdown.maxDrawdownPct,
   realizedDrawdownPct:st.maxRealizedDrawdownPct,
   riskBudgetOverrunTrades:trs.filter(t=>t.riskOverrun===true).length,
   totalInitialCapital:st.initialCapital,
   maxObservedSingleTradeLoss:trs.length?Math.min(0,...trs.map(t=>t.netPnl)):null,
   meanNetR:st.meanNetR,profitFactor:st.profitFactor}
 };
}
function gapShock(trades,params,pct){
 const fee=params.feeBps/10000,slip=params.slippageBps/10000;
 let worst=null,overruns=0;
 for(const t of trades){
  // In this counterfactual every OBSERVED entry is individually stressed:
  // an exit opens pct below its planned stop, with adverse execution slippage.
  // This is never a new price bar or an actual observed transaction.
  const hypotheticalGapOpen=t.stop*(1-pct/100);
  const exitFill=hypotheticalGapOpen*(1-slip);
  const exitFee=t.quantity*exitFill*fee;
  const net=t.quantity*(exitFill-t.entryFill)-t.entryFee-exitFee;
  const netR=t.plannedRisk>0?net/t.plannedRisk:null;
  if(net< -t.plannedRisk)overruns++;
  if(!worst||net<worst.netPnl)
   worst={entryAt:t.entryAt,signalAt:t.decisionAt,hypotheticalGapOpen,
    hypotheticalExitFill:exitFill,quantity:t.quantity,plannedRisk:t.plannedRisk,
    netPnl:net,netR,exceedsPlannedRisk:net< -t.plannedRisk};
 }
 return {gapBelowStopPct:pct,tradesIndividuallyStressed:trades.length,
  assumedOccurrence:'ONE_TRADE_AT_A_TIME_HYPOTHETICAL',
  worstSingleTrade:worst,riskBudgetOverrunIfShockedCount:overruns,
  portfolioReturnPct:null,portfolioVar:null,
  interpretation:'Only hypothetical post-entry execution on observed trade sizes; no market probability or joint portfolio simulation'};
}
function analyze(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  !Number.isSafeInteger(input.now)||input.now<=0)return fail('EXPLICIT_AS_OF_REQUIRED');
 const series=input.series;
 if(!series||typeof series!=='object'||Array.isArray(series))return fail('SERIES_REQUIRED');
 const quality=dependency('quality').inspect({...series,now:input.now});
 if(quality.status!=='structurally_ready'||quality.eligibleForProvisionalBacktest!==true)
  return fail('SERIES_QUALITY_NOT_READY',{errors:quality.errors||[],flags:quality.flags||[]});
 const strategy=input.strategy??{};
 if(!strategy||typeof strategy!=='object'||Array.isArray(strategy))
  return fail('INVALID_STRATEGY');
 const engine=dependency('engine'),review=dependency('review');
 const base=measuredCase('baseline','기준 가정',strategy,series.bars,engine,review);
 if(!base.ok)return fail('BASELINE_'+base.code);
 const f=base.params.feeBps,s=base.params.slippageBps;
 if(f>BUMP.at(-1)?false:false){} // no-op removed in later audit if present
 if(f+BUMP.at(-1)>200||s+BUMP.at(-1)>200)
  return fail('COST_STRESS_BEYOND_ALLOWED_MODEL_LIMIT',{feeBps:f,slippageBps:s,maxAdditionalBps:BUMP.at(-1)});
 const cost=[base.presentation],deltas=[];
 for(const bump of BUMP){
  for(const kind of ['fee','slippage','combined']){
   const next={...base.params,feeBps:f+(kind==='fee'||kind==='combined'?bump:0),
    slippageBps:s+(kind==='slippage'||kind==='combined'?bump:0)};
   const id=kind+'-plus-'+bump+'bps';
   const outcome=measuredCase(id,kind+' +'+bump+'bp',next,series.bars,engine,review);
   if(!outcome.ok)return fail('STRESS_'+outcome.code,{scenario:id});
   const m=outcome.presentation;
   m.deltaNetPnlFromBaseline=m.netPnl-base.presentation.netPnl;
   m.deltaNetReturnPctPoints=m.netReturnPct-base.presentation.netReturnPct;
   m.tradePathOrSizingMayChange=true;
   cost.push(m);
   deltas.push({id,netPnlDelta:m.deltaNetPnlFromBaseline,
    tradeCountDifference:m.trades-base.presentation.trades});
  }
 }
 const shocks=GAP_PCT.map(p=>gapShock(base.raw.trades,base.params,p));
 const anyLossOverrun=shocks.some(x=>x.riskBudgetOverrunIfShockedCount>0);
 return {status:'descriptive_only',version:VERSION,
  identity:{market:series.market,exchange:series.exchange,currency:series.currency,
   symbol:series.symbol,sourceProvider:series.sourceProvider,
   priceConvention:series.priceConvention,observedAt:series.observedAt},
  verification:{sourceVerified:false,independentHoldoutProven:false,
   parameterSearchPerformed:false,noOrderAuthority:true,realTradingObserved:false},
  method:{base:'FIXED_20BAR_DAILY_SWING_BREAKOUT',costBumpBps:[...BUMP],
   gapBelowPlannedStopPct:[...GAP_PCT],
   fillsAndPositionSizingRerunPerCostScenario:true,
   stressTradePathsAreNotHeldConstant:true,
   gapShockIsHypotheticalPerObservedEntry:true,
   portfolioVaRCalculated:false,liveSignals:false},
  baseline:base.presentation,costSensitivity:cost,gapShockScenarios:shocks,
  observations:{scenarioCount:cost.length,nonBaselineScenarioCount:deltas.length,
   baselineTradeCount:base.raw.trades.length,
   gapLossCanExceedConfiguredRisk:anyLossOverrun,
   nonBaselineTradeCountChanged:deltas.filter(x=>x.tradeCountDifference!==0).map(x=>x.id)},
  warnings:['가격·시장·종목 출처의 진위는 별도 확인이 필요합니다. 모든 수치는 합성 또는 외부 제공 과거 봉의 가상 재현입니다.',
   '수수료/슬리피지 변화는 체결가·목표가·포지션 수량·매매 경로에도 영향을 줄 수 있습니다. 순손익 차이를 순수 비용 효과로 단정하지 않습니다.',
   '갭 충격은 과거에 실제 발생한 사건이나 그 발생확률이 아닙니다. 포트폴리오 VaR/최악 손실 보장치가 아닙니다.',
   '동일 전략의 과거 규칙 재실행이며 외표본 독립성, 기업행동·상폐 편향, 가격 원천 신뢰성을 증명하지 않습니다.',
   '자동 매수·매도 추천, 실시간 단타 매매, 주문 또는 수익률 보장이 아닙니다.']};
}
const api=Object.freeze({analyze,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestFrictionStress=api;
})(typeof globalThis!=='undefined'?globalThis:this);
