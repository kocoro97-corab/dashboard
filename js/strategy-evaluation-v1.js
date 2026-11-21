/* MY INVEST V2 P4: isolated, deterministic daily-bar strategy evaluation.
 * No network, storage, account access, optimization, chart mutations or orders.
 * Daily OHLCV is assumed FINAL at each decision; bar t may be its OPEN timestamp.
 * Signals are decided after bar i, filled at OPEN of bar i+1, never same-bar close.
 */
(function(root){
'use strict';
const VERSION='p4-swing-breakout-v1',LOOKBACK=20;
const finite=Number.isFinite,positive=x=>finite(x)&&x>0;
const invalid=(code)=>({status:'invalid',code,version:VERSION});
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
function cleanConfig(input){
 const c={initialCapital:input.initialCapital??10000000,riskPct:input.riskPct??1,
  maxAllocationPct:input.maxAllocationPct??25,feeBps:input.feeBps??10,
  slippageBps:input.slippageBps??10,targetR:input.targetR??2,
  maxHoldingBars:input.maxHoldingBars??15,volumeMultiple:input.volumeMultiple??1.5};
 if(!positive(c.initialCapital)||c.initialCapital>1e12||!positive(c.riskPct)||c.riskPct>5||
  !positive(c.maxAllocationPct)||c.maxAllocationPct>100||!finite(c.feeBps)||c.feeBps<0||c.feeBps>200||
  !finite(c.slippageBps)||c.slippageBps<0||c.slippageBps>200||
  !finite(c.targetR)||c.targetR<0.5||c.targetR>10||
  !Number.isSafeInteger(c.maxHoldingBars)||c.maxHoldingBars<1||c.maxHoldingBars>60||
  !finite(c.volumeMultiple)||c.volumeMultiple<1||c.volumeMultiple>5)return null;
 return c;
}
function validBars(bars){
 if(!Array.isArray(bars)||bars.length>5000)return false;
 for(let i=0;i<bars.length;i++){
  const b=bars[i];if(!b||!Number.isSafeInteger(b.t)||b.t<=0||
   i>0&&b.t<=bars[i-1].t||![b.o,b.h,b.l,b.c].every(positive)||
   b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c)||b.h<b.l||
   b.v!=null&&(!finite(b.v)||b.v<0))return false;
 }
 return true;
}
function signalAt(bars,i,c){
 if(i<LOOKBACK||i>=bars.length-1)return null;
 // Inputs are restricted to the completed signal bar and its 20 predecessors.
 const prior=bars.slice(i-LOOKBACK,i),current=bars[i];
 const shortMA=mean(bars.slice(i-4,i+1).map(x=>x.c));
 const longMA=mean(bars.slice(i-19,i+1).map(x=>x.c));
 const high=Math.max(...prior.map(x=>x.h)),low=Math.min(...prior.map(x=>x.l));
 const volume=prior.map(x=>x.v);
 if(volume.some(x=>!finite(x))||!finite(current.v))return null;
 const averageVolume=mean(volume),volumeRatio=averageVolume>0?current.v/averageVolume:null;
 if(current.c<=high||shortMA<=longMA||volumeRatio===null||volumeRatio<c.volumeMultiple)return null;
 return {index:i,decisionAt:current.t,decisionClose:current.c,priorHigh:high,stop:low,
  shortMA,longMA,volumeRatio};
}
function simulate(options={}){
 if(!options||typeof options!=='object'||options.interval!=='1d')return invalid('DAILY_INTERVAL_REQUIRED');
 const bars=options.bars;
 if(!validBars(bars))return invalid('INVALID_BARS');
 const c=cleanConfig(options);
 if(!c)return invalid('INVALID_CONFIGURATION');
 if(bars.length<LOOKBACK+2)return {status:'insufficient',code:'INSUFFICIENT_HISTORY',version:VERSION};
 const startAt=options.testStartAt;
 if(startAt!=null&&(!Number.isSafeInteger(startAt)||!bars.some(x=>x.t===startAt)))return invalid('INVALID_TEST_START');
 const testStartIndex=startAt==null?0:bars.findIndex(x=>x.t===startAt);
 const fees=c.feeBps/10000,slip=c.slippageBps/10000;
 const trades=[],skipped={STOP_ABOVE_ENTRY:0,NO_POSITION_SIZE:0,BEFORE_EVALUATION_WINDOW:0};
 const points=[{at:bars[Math.max(testStartIndex,LOOKBACK)].t,equity:c.initialCapital}];
 let cashEquity=c.initialCapital,position=null,pending=null,signals=0,exposed=0,grossProfit=0,totalCosts=0;
 function settle(exitIndex,rawExit,reason,ambiguous=false){
  const b=bars[exitIndex],exitFill=rawExit*(1-slip),exitFee=position.quantity*exitFill*fees;
  const gross=position.quantity*(exitFill-position.entryFill),net=gross-position.entryFee-exitFee;
  const trade={decisionIndex:position.signal.index,decisionAt:position.signal.decisionAt,
   decisionClose:position.signal.decisionClose,entryIndex:position.entryIndex,
   entryAt:bars[position.entryIndex].t,entryOpen:bars[position.entryIndex].o,
   entryFill:position.entryFill,exitIndex,exitAt:b.t,exitFill,stop:position.stop,
   target:position.target,quantity:position.quantity,holdingBars:exitIndex-position.entryIndex+1,
   reason,ambiguous,entryFee:position.entryFee,exitFee,grossPnl:gross,netPnl:net,
   netR:position.plannedRisk>0?net/position.plannedRisk:null};
  trades.push(trade);cashEquity+=net;grossProfit+=gross;totalCosts+=position.entryFee+exitFee;
  points.push({at:b.t,equity:cashEquity});position=null;
 }
 for(let i=LOOKBACK;i<bars.length;i++){
  const b=bars[i];
  if(!position&&pending&&pending.enterIndex===i){
   const p=pending;pending=null;
   if(i<testStartIndex){skipped.BEFORE_EVALUATION_WINDOW++}
   else{
    const entryFill=b.o*(1+slip),stop=p.signal.stop;
    const plannedStopExit=stop*(1-slip);
    if(!(stop>0&&plannedStopExit<entryFill&&b.o>stop)){skipped.STOP_ABOVE_ENTRY++}
    else{
     const riskUnit=entryFill*(1+fees)-plannedStopExit*(1-fees);
     const qty=Math.min(Math.floor((cashEquity*c.riskPct/100)/riskUnit),
      Math.floor((cashEquity*c.maxAllocationPct/100)/(entryFill*(1+fees))));
     if(!Number.isSafeInteger(qty)||qty<1){skipped.NO_POSITION_SIZE++}
     else{
      const target=entryFill+c.targetR*(entryFill-stop);
      position={signal:p.signal,entryIndex:i,entryFill,stop,target,quantity:qty,
       entryFee:qty*entryFill*fees,plannedRisk:qty*riskUnit};
     }
    }
   }
  }
  if(position){
   exposed++;
   if(b.o<=position.stop)settle(i,b.o,'stop_gap');
   else if(b.o>=position.target)settle(i,position.target,'target_gap_capped');
   else if(b.l<=position.stop&&b.h>=position.target)settle(i,position.stop,'stop_first_ambiguous',true);
   else if(b.l<=position.stop)settle(i,position.stop,'stop');
   else if(b.h>=position.target)settle(i,position.target,b.o>=position.target?'target_gap_capped':'target');
   else if(i-position.entryIndex+1>=c.maxHoldingBars)settle(i,b.c,'time_exit');
   else if(i===bars.length-1)settle(i,b.c,'end_of_sample');
  }
  if(!position&&!pending&&i<bars.length-1){
   const signal=signalAt(bars,i,c);
   if(signal){signals++;pending={signal,enterIndex:i+1}}
  }
 }
 let peak=c.initialCapital,maxDD=0;for(const p of points){peak=Math.max(peak,p.equity);if(peak>0)maxDD=Math.max(maxDD,(peak-p.equity)/peak*100)}
 const wins=trades.filter(t=>t.netPnl>0),losses=trades.filter(t=>t.netPnl<0),
  lossAbs=-losses.reduce((a,t)=>a+t.netPnl,0),winTotal=wins.reduce((a,t)=>a+t.netPnl,0);
 return {status:'ok',version:VERSION,interval:'1d',method:'fixed_20bar_close_breakout_next_open',
  validation:{inputProvenance:'NOT_EXTERNALLY_VERIFIED',outOfSample:startAt!=null,
   evaluationStartAt:startAt??null,barCount:bars.length,lookback:LOOKBACK,
   futureDataUsedForSignal:false,intrabarOrdering:'STOP_FIRST_WHEN_AMBIGUOUS',
   equityDrawdownScope:'REALIZED_TRADES_ONLY'},
  parameters:{...c},signals,skipped,trades,realizedEquity:points,
  statistics:{trades:trades.length,wins:wins.length,losses:losses.length,
   winRatePct:trades.length?wins.length/trades.length*100:null,
   initialCapital:c.initialCapital,finalEquity:cashEquity,netPnl:cashEquity-c.initialCapital,
   netReturnPct:(cashEquity/c.initialCapital-1)*100,grossPnl:grossProfit,grossIncludesSlippage:true,grossExcludesFees:true,
   feeCost:totalCosts,maxRealizedDrawdownPct:maxDD,exposureBars:exposed,
   meanNetR:trades.length?mean(trades.map(t=>t.netR)):null,
   profitFactor:lossAbs>0?winTotal/lossAbs:null},
  warnings:['가상 일봉 과거검증: 실시간 성과나 미래 수익 보장 아님',
   '신호는 확정 일봉 종가 이후 평가하고 다음 봉 시가에 진입',
   '일봉 내 손절·목표 동시 충족 시 손절 우선, 갭 발생 시 실제 시가 반영',
   '유료·무료 원천의 가격·수정주가·거래량·거래비용 정확성은 별도 검증 필요',
   '손익곡선과 낙폭은 실현손익 기준만 반영하며 중간 평가손익을 포함하지 않음',
   '수수료/슬리피지만 반영, 세금·환전·유동성 충격·상장폐지·생존편향 미반영']};
}
const api=Object.freeze({simulate,signalAt,validBars,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestStrategyEvaluation=api;
})(typeof globalThis!=='undefined'?globalThis:this);
