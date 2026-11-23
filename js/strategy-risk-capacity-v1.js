/* MY INVEST V2 — isolated hypothetical risk-capacity calculator.
 * No quotes fetched, account reads, order placement, storage or side effects.
 * All capital/exposure values must be supplied in one explicit currency.
 * Market-evidence and session checks are explanatory, never trade approval.
 */
(function(root){
'use strict';
const PROFILES=Object.freeze({
 day:Object.freeze({maxRiskPct:1,maxAllocationPct:20,minRewardRisk:1.5}),
 swing:Object.freeze({maxRiskPct:1.5,maxAllocationPct:25,minRewardRisk:2})
});
const VALID_MARKETS=Object.freeze({KR:'KRW',US:'USD'});
const BASE_FIELDS=Object.freeze(['mode','market','currency','now','capital','cashAvailable',
 'usedExposure','usedOpenRisk','entry','stop','target','riskPct','allocationPct',
 'feeBps','slippageBps','stressGapPct','lotSize','quotes','sources','receivedAt']);
const deny=(code)=>Object.freeze({status:'invalid',code,
 canPlaceOrder:false,tradeApproved:false,marketTruthVerified:false});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const range=(n,min,max)=>finite(n)&&n>=min&&n<=max;
const boundedPositive=(n,max=1e12)=>range(n,Number.MIN_VALUE,max);
const object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const precise=n=>Number.isFinite(n)?n:null;
function dependencies(){
 if(typeof module==='object'&&module.exports)return {
  gate:require('./market-evidence-gate-v1.js'),
  clock:require('./market-session-context-v1.js')
 };
 return {gate:root.MYInvestMarketEvidenceGateV1,
  clock:root.MYInvestMarketSessionContextV1};
}
function evaluate(input){
 if(!object(input)||Object.keys(input).some(k=>!BASE_FIELDS.includes(k)))
  return deny('INVALID_OR_PRIVATE_FIELDS');
 const {mode,market,currency,now,capital,cashAvailable,usedExposure,usedOpenRisk,
  entry,stop,target,riskPct,allocationPct,feeBps,slippageBps,
  stressGapPct,lotSize,quotes,sources,receivedAt}=input;
 const profile=PROFILES[mode];
 if(!profile||!Object.hasOwn(VALID_MARKETS,market)||
  currency!==VALID_MARKETS[market])return deny('INVALID_MODE_MARKET_CURRENCY');
 if(!Number.isSafeInteger(now)||now<=0||now>=8640000000000000)
  return deny('INVALID_CLOCK');
 if(!boundedPositive(capital)||!range(cashAvailable,0,capital)||
  !range(usedExposure,0,capital)||!range(usedOpenRisk,0,capital)||
  !boundedPositive(entry,1e9)||!boundedPositive(stop,1e9)||
  !boundedPositive(target,1e9)||!(stop<entry&&entry<target))
  return deny('INVALID_CAPITAL_OR_LONG_PRICE');
 if(!range(riskPct,0.01,10)||!range(allocationPct,0.01,100)||
  !range(feeBps,0,100)||!range(slippageBps,0,500)||
  !range(stressGapPct,0,50)||!Number.isSafeInteger(lotSize)||
  lotSize<1||lotSize>1000000)
  return deny('INVALID_RISK_ASSUMPTIONS');
 if(quotes!=null&&!object(quotes)||sources!=null&&!object(sources)||
  receivedAt!=null&&!object(receivedAt))
  return deny('INVALID_MARKET_SNAPSHOT');
 const cappedRiskPct=Math.min(riskPct,profile.maxRiskPct);
 const cappedAllocationPct=Math.min(allocationPct,profile.maxAllocationPct);
 const fee=feeBps/10000,slip=slippageBps/10000;
 const entryNet=entry*(1+slip)*(1+fee);
 const stopNet=stop*(1-slip)*(1-fee);
 const targetNet=target*(1-slip)*(1-fee);
 const stressStopPrice=stop*(1-stressGapPct/100);
 const stressNet=stressStopPrice*(1-slip)*(1-fee);
 const baseLossUnit=entryNet-stopNet;
 const stressLossUnit=entryNet-stressNet;
 const targetGainUnit=targetNet-entryNet;
 const rewardRisk=baseLossUnit>0?targetGainUnit/baseLossUnit:null;
 if(![entryNet,stopNet,targetNet,stressNet,baseLossUnit,stressLossUnit,targetGainUnit,rewardRisk]
  .every(finite)||baseLossUnit<=0||stressLossUnit<baseLossUnit)
  return deny('NONFINITE_EXECUTION_SCENARIO');
 const riskPool=capital*cappedRiskPct/100;
 const allocationPool=capital*cappedAllocationPct/100;
 const availableRisk=Math.max(0,riskPool-usedOpenRisk);
 const availableAllocation=Math.max(0,allocationPool-usedExposure);
 const unitCost=entryNet;
 const boundByRisk=Math.floor(availableRisk/baseLossUnit);
 const boundByStress=Math.floor(availableRisk/stressLossUnit);
 const boundByAllocation=Math.floor(availableAllocation/unitCost);
 const boundByCash=Math.floor(cashAvailable/unitCost);
 const maxCandidate=Math.min(boundByRisk,boundByStress,boundByAllocation,boundByCash);
 const units=Math.floor(Math.max(0,maxCandidate)/lotSize)*lotSize;
 const totalCost=units*unitCost;
 const baseStopLoss=units*baseLossUnit;
 const stressStopLoss=units*stressLossUnit;
 const targetGain=units*targetGainUnit;
 if(![riskPool,allocationPool,availableRisk,availableAllocation,
  boundByRisk,boundByStress,boundByAllocation,boundByCash,units,
  totalCost,baseStopLoss,stressStopLoss,targetGain].every(finite)||
  !Number.isSafeInteger(units)||units>1e9)
  return deny('NUMERIC_OVERFLOW');
 const capReasons=[];
 if(riskPct>profile.maxRiskPct)capReasons.push('REQUESTED_RISK_POLICY_CAPPED');
 if(allocationPct>profile.maxAllocationPct)capReasons.push('REQUESTED_ALLOCATION_POLICY_CAPPED');
 if(availableRisk<=0)capReasons.push('NO_REMAINING_OPEN_RISK_BUDGET');
 if(availableAllocation<=0)capReasons.push('NO_REMAINING_ALLOCATION');
 if(cashAvailable<entryNet*lotSize)capReasons.push('INSUFFICIENT_CASH_FOR_LOT');
 if(rewardRisk===null||rewardRisk<profile.minRewardRisk)
  capReasons.push('REWARD_RISK_BELOW_MODE_THRESHOLD');
 if(units===0)capReasons.push('ZERO_HYPOTHETICAL_QUANTITY');
 const {gate,clock}=dependencies();
 if(!gate||typeof gate.assess!=='function'||!clock||
  typeof clock.context!=='function')return deny('MISSING_MARKET_CONTEXT_DEPENDENCY');
 const session=clock.context({now});
 if(session.status!=='ok')return deny('INVALID_SESSION_CLOCK');
 let evidence=null;
 if(quotes!=null&&sources!=null&&receivedAt!=null)
  evidence=gate.assess({market,now,quotes,sources,receivedAt});
 const gateStatus=evidence?.status||'not-provided';
 const marketWindow=session.regions[market].window;
 const warnings=[...capReasons];
 if(gateStatus!=='qualified-close')warnings.push('MARKET_CLOSE_DATA_NOT_QUALIFIED');
 if(marketWindow!=='regular-clock-window')warnings.push('OUTSIDE_REGULAR_CLOCK_WINDOW');
 warnings.push('NO_EXCHANGE_OR_QUOTE_TRUTH_VERIFICATION');
 warnings.push('GAP_SLIPPAGE_FEES_AND_TAXES_MAY_EXCEED_ASSUMPTIONS');
 const planPermitted=units>0&&rewardRisk>=profile.minRewardRisk;
 const status=!planPermitted?'review-required':'hypothetical';
 return Object.freeze({
  status,mode,market,currency,now,
  policy:Object.freeze({...profile,riskPct:cappedRiskPct,
   allocationPct:cappedAllocationPct,stressGapPct,feeBps,slippageBps,lotSize}),
  inputRiskPct:riskPct,inputAllocationPct:allocationPct,
  available:Object.freeze({
   riskBudget:precise(availableRisk),allocationBudget:precise(availableAllocation),
   cashBudget:cashAvailable,usedOpenRisk,usedExposure
  }),
  bounds:Object.freeze({
   stopLossUnits:boundByRisk,stressUnits:boundByStress,
   allocationUnits:boundByAllocation,cashUnits:boundByCash
  }),
  scenario:Object.freeze({
   quantity:planPermitted?units:0,
   diagnosticUpperBoundUnits:units,
   entryCostPerUnit:entryNet,
   stopExitNetPerUnit:stopNet,targetExitNetPerUnit:targetNet,
   stressExitNetPerUnit:stressNet,
   riskPerUnit:baseLossUnit,stressRiskPerUnit:stressLossUnit,
   potentialProfitPerUnit:targetGainUnit,rewardRisk,
   positionCost:planPermitted?totalCost:0,
   hypotheticalStopLoss:planPermitted?baseStopLoss:0,
   hypotheticalStressLoss:planPermitted?stressStopLoss:0,
   hypotheticalTargetProfit:planPermitted?targetGain:0,
   hypotheticalStressGapPct:stressGapPct
  }),
  marketContext:Object.freeze({
   displayFocus:session.focus,marketWindow,localDate:session.regions[market].localDate,
   gateStatus,evidenceDate:evidence?.marketDate||null,
   exchangeOpenConfirmed:false,quoteVerified:false,
   calendarVerified:false
  }),
  warnings:Object.freeze([...new Set(warnings)]),
  executionAllowed:false,canPlaceOrder:false,tradeApproved:false,
  marketTruthVerified:false,
  leverageEnabled:false,
  fxConversionPerformed:false,
  holdingsAccessed:false,
  providerCalls:0
 });
}
const api=Object.freeze({evaluate,PROFILES});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestStrategyRiskCapacityV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
