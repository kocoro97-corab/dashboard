/* P4 offline backtest audit: daily-close mark-to-market drawdown and buy/hold.
 * Only existing deterministic P4 output + caller-supplied completed OHLCV.
 * No browser state, network, accounts, orders, or parameter fitting.
 */
(function(root){
'use strict';
const VERSION='p4-evaluation-review-v1',ENGINE='p4-swing-breakout-v1';
const isNum=Number.isFinite,positive=v=>isNum(v)&&v>0;
function invalid(code){return {status:'invalid',version:VERSION,code}}
function closeEnough(a,b){return isNum(a)&&isNum(b)&&Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b))}
function curveRisk(curve,capital){
 let peak=capital,maxDrawdownPct=0,drawdownDays=0,worstAt=null;
 for(const p of curve){
  if(!isNum(p.equity))return null;
  peak=Math.max(peak,p.equity);
  const dd=(peak-p.equity)/peak*100;
  if(dd>0)drawdownDays++;
  if(dd>maxDrawdownPct){maxDrawdownPct=dd;worstAt=p.at}
 }
 return {maxDrawdownPct,drawdownDays,worstAt,observation:'DAILY_CLOSE_LIQUIDATION_VALUE'};
}
function benchmarkHold(bars,start,capital,fee,slip){
 const entryOpen=bars[start].o,entryFill=entryOpen*(1+slip);
 const qty=Math.floor(capital/(entryFill*(1+fee)));
 if(!Number.isSafeInteger(qty)||qty<1)return null;
 const entryFee=qty*entryFill*fee,uninvested=capital-qty*entryFill-entryFee;
 const curve=bars.slice(start).map(b=>{
  const liquidatedPrice=b.c*(1-slip);
  return {at:b.t,equity:uninvested+qty*liquidatedPrice*(1-fee)};
 });
 const last=curve.at(-1);
 return {method:'FULL_CAPITAL_BUY_AND_HOLD_NEXT_ELIGIBLE_OPEN',
  entryAt:bars[start].t,exitAt:bars.at(-1).t,entryOpen,entryFill,shares:qty,
  uninvestedCapital:uninvested,finalEquity:last.equity,
  netReturnPct:(last.equity/capital-1)*100,curve,
  drawdown:curveRisk(curve,capital)};
}
function audit({bars,simulation}={}){
 const api=(typeof module==='object'&&module.exports)?require('./strategy-evaluation-v1.js'):root.MYInvestStrategyEvaluation;
 if(!api?.validBars?.(bars))return invalid('INVALID_DAILY_BARS');
 if(!simulation||simulation.status!=='ok'||simulation.version!==ENGINE||
  simulation.validation?.inputProvenance!=='NOT_EXTERNALLY_VERIFIED'||
  simulation.interval!=='1d'||simulation.validation?.barCount!==bars.length||
  !Array.isArray(simulation.trades))return invalid('SIMULATION_MISMATCH');
 const p=simulation.parameters||{},initial=p.initialCapital;
 if(!positive(initial)||!isNum(p.feeBps)||p.feeBps<0||p.feeBps>200||
  !isNum(p.slippageBps)||p.slippageBps<0||p.slippageBps>200)return invalid('SIMULATION_PARAMETERS_INVALID');
 const testAt=simulation.validation.evaluationStartAt;
 let first=21;
 if(testAt!=null){if(!Number.isSafeInteger(testAt))return invalid('INVALID_EVALUATION_START');const at=bars.findIndex(b=>b.t===testAt);if(at<0)return invalid('INVALID_EVALUATION_START');first=Math.max(first,at)}
 if(first>=bars.length)return {status:'insufficient',version:VERSION,code:'INSUFFICIENT_EVALUATION_WINDOW'};
 const fee=p.feeBps/10000,slip=p.slippageBps/10000,trs=simulation.trades;
 let lastExit=-1,netSum=0;
 for(const t of trs){
  if(!t||!Number.isSafeInteger(t.decisionIndex)||!Number.isSafeInteger(t.entryIndex)||
   !Number.isSafeInteger(t.exitIndex)||t.decisionIndex!==t.entryIndex-1||
   t.entryIndex<first||t.entryIndex<=lastExit||t.exitIndex<t.entryIndex||
   t.exitIndex>=bars.length||t.decisionIndex<20||
   !Number.isSafeInteger(t.quantity)||t.quantity<1||
   ![t.entryOpen,t.entryFill,t.exitFill,t.entryFee,t.exitFee,t.netPnl,t.decisionClose].every(isNum)||
   !positive(t.entryOpen)||!positive(t.entryFill)||!positive(t.exitFill)||
   !closeEnough(t.entryOpen,bars[t.entryIndex].o)||
   !closeEnough(t.decisionClose,bars[t.decisionIndex].c)||
   !closeEnough(t.entryAt,bars[t.entryIndex].t)||
   !closeEnough(t.exitAt,bars[t.exitIndex].t)||
   !closeEnough(t.entryFill,t.entryOpen*(1+slip))||
   !closeEnough(t.entryFee,t.quantity*t.entryFill*fee)||
   !closeEnough(t.exitFee,t.quantity*t.exitFill*fee)||
   !closeEnough(t.netPnl,t.quantity*(t.exitFill-t.entryFill)-t.entryFee-t.exitFee)){
   return invalid('TRADE_LEDGER_INVALID');
  }
  lastExit=t.exitIndex;netSum+=t.netPnl;
 }
 if(!closeEnough(initial+netSum,simulation.statistics?.finalEquity)||
  !closeEnough(netSum,simulation.statistics?.netPnl)||
  simulation.statistics?.trades!==trs.length)return invalid('EQUITY_RECONCILIATION_FAILED');
 let realized=0,tradeIndex=0;
 const dailyEquity=[];
 for(let i=first;i<bars.length;i++){
  // Entries are already filled at the current bar open by the independent P4 engine.
  while(tradeIndex<trs.length&&trs[tradeIndex].exitIndex<=i){
   realized+=trs[tradeIndex].netPnl;tradeIndex++;
  }
  const active=trs[tradeIndex],exposed=!!active&&active.entryIndex<=i&&i<active.exitIndex;
  let equity=initial+realized;
  if(exposed){
   const closeLiquidation=bars[i].c*(1-slip);
   equity+=active.quantity*(closeLiquidation-active.entryFill)-active.entryFee-
    active.quantity*closeLiquidation*fee;
  }
  dailyEquity.push({at:bars[i].t,equity,holding:exposed});
 }
 const end=dailyEquity.at(-1);
 if(!closeEnough(end.equity,simulation.statistics.finalEquity))return invalid('DAILY_EQUITY_RECONCILIATION_FAILED');
 const strategyRisk=curveRisk(dailyEquity,initial),hold=benchmarkHold(bars,first,initial,fee,slip);
 const trades=trs.length,grade=trades<30?'LOW_SAMPLE':testAt==null?'NO_PREDECLARED_HOLDOUT':'HOLDOUT_DATE_PRESENT_NOT_PROVEN_INDEPENDENT';
 return {status:'ok',version:VERSION,engine:ENGINE,validation:{
  source:'CALLER_SUPPLIED_UNVERIFIED_DAILY_BARS',
  strategyBarsValidated:true,barCount:bars.length,evaluationStartAt:bars[first].t,
  sameSymbolBuyHoldOnly:true,independentHoldoutProven:false,
  costConvention:'FEES_AND_SLIPPAGE_BOTH_SIDES',
  drawdownConvention:'DAILY_CLOSE_HYPOTHETICAL_LIQUIDATION_NOT_INTRADAY'},
  reliability:{grade,tradeCount:trades,minimumSuggestedTrades:30,
   note:'30회는 표본 경고용 임의 기준이며 통계적 유의성이나 재현성을 보장하지 않습니다.'},
  strategy:{curve:dailyEquity,drawdown:strategyRisk,
   finalEquity:simulation.statistics.finalEquity,netReturnPct:simulation.statistics.netReturnPct,
   realizedOnlyDrawdownPct:simulation.statistics.maxRealizedDrawdownPct},
  buyAndHold:hold,
  comparison:hold?{returnDifferencePctPoints:simulation.statistics.netReturnPct-hold.netReturnPct,
   comparableExposure:false,interpretation:'100% 동일종목 보유 대비 차이; 투자 노출 및 위험배분이 달라 알파로 해석 금지'}:null,
  warnings:['실제 시세 및 수정주가 여부 검증 전까지 결과는 실데이터 성과가 아닙니다.',
   '동일종목 100% 보유와 위험한도 기반 전략은 투자 노출이 달라 수익률 차이를 알파로 해석할 수 없습니다.',
   '최대낙폭은 거래일 종가에 청산한 가상 평가액만 사용하며 장중 최악의 손실은 포착하지 못합니다.',
   '평가 구간 지정만으로 사전 고정된 외표본 검증을 보증하지 않습니다.',
   '세금·환율·배당·상장폐지/생존편향·시장충격 및 가격 원천 품질은 미반영입니다.']};
}
const exported=Object.freeze({audit,curveRisk,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=exported;
else root.MYInvestStrategyReview=exported;
})(typeof globalThis!=='undefined'?globalThis:this);
