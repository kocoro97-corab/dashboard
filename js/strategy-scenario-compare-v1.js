/* MY INVEST V2 — hypothetical day-vs-swing scenario comparison model.
 * Alternatives only: results are NOT additive holdings or executable orders.
 * Pure, no API, network, storage, account access, AI generation, or trade signals.
 */
(function(root){
'use strict';
const MODES=Object.freeze(['day','swing']);
const COMMON=Object.freeze(['market','currency','now','capital','cashAvailable',
 'usedExposure','usedOpenRisk','feeBps','slippageBps','lotSize']);
const PER_MODE=Object.freeze(['entry','stop','target','riskPct','allocationPct','stressGapPct']);
const fail=code=>Object.freeze({status:'invalid',code,comparison:null,
  canPlaceOrder:false,tradeApproved:false,providerCalls:0});
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(obj,keys)=>plain(obj)&&
 Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
function risk(){
 if(typeof module==='object'&&module.exports)return require('./strategy-risk-capacity-v1.js');
 return root.MYInvestStrategyRiskCapacityV1;
}
function explain(mode,result){
 if(!result||result.status==='invalid')
  return Object.freeze({mode,status:'invalid',reason:result?.code||'INVALID_RESULT',
   quantity:0,cost:null,baseRisk:null,stressRisk:null,reward:null,rewardRisk:null,
   maxRiskBudget:null,maxAllocationBudget:null,gateStatus:null,sessionWindow:null,
   warnings:Object.freeze(['INVALID_SCENARIO'])});
 const s=result.scenario;
 return Object.freeze({
  mode,status:result.status,reason:result.status==='review-required'?
   'RECHECK_PARAMETERS':'HYPOTHETICAL_ONLY',
  quantity:s.quantity,
  // May be useful to explain why the scenario cannot be simulated.
  diagnosticUpperBoundUnits:s.diagnosticUpperBoundUnits,
  cost:s.positionCost,baseRisk:s.hypotheticalStopLoss,
  stressRisk:s.hypotheticalStressLoss,reward:s.hypotheticalTargetProfit,
  rewardRisk:s.rewardRisk,
  maxRiskBudget:result.available.riskBudget,
  maxAllocationBudget:result.available.allocationBudget,
  gateStatus:result.marketContext.gateStatus,
  sessionWindow:result.marketContext.marketWindow,
  warnings:Object.freeze([...result.warnings])
 });
}
function compare(input){
 if(!exact(input,['common','scenarios'])||
  !exact(input.common,COMMON)||!exact(input.scenarios,MODES)||
  MODES.some(mode=>!exact(input.scenarios[mode],PER_MODE)))
  return fail('INVALID_OR_PRIVATE_FIELDS');
 const model=risk();
 if(!model||typeof model.evaluate!=='function')return fail('RISK_ENGINE_UNAVAILABLE');
 const outputs={};
 for(const mode of MODES){
  const raw=model.evaluate({...input.common,...input.scenarios[mode],mode});
  outputs[mode]=explain(mode,raw);
 }
 const day=outputs.day,swing=outputs.swing;
 const validDay=day.status!=='invalid',validSwing=swing.status!=='invalid';
 if(!validDay&&!validSwing)
  return Object.freeze({status:'invalid-scenarios',code:'BOTH_SCENARIOS_INVALID',
   market:input.common.market,currency:input.common.currency,
   day,swing,comparison:null,canPlaceOrder:false,tradeApproved:false,providerCalls:0});
 const both=validDay&&validSwing;
 const comparable=both&&day.status==='hypothetical'&&swing.status==='hypothetical';
 const difference=comparable?Object.freeze({
  swingMinusDayQuantity:swing.quantity-day.quantity,
  swingMinusDayCost:swing.cost-day.cost,
  swingMinusDayStressRisk:swing.stressRisk-day.stressRisk,
  swingMinusDayPotentialGain:swing.reward-day.reward,
  swingMinusDayRewardRisk:swing.rewardRisk-day.rewardRisk
 }):null;
 return Object.freeze({
  status:both?'compared':'partial',
  market:input.common.market,currency:input.common.currency,
  basis:'SAME_MANUAL_CAPITAL_ALTERNATIVES_NOT_ADDITIVE',
  day,swing,comparison:difference,
  comparable,
  note:comparable?
   '공통 현금·기존 위험예산에서 두 시나리오를 각각 계산했습니다. 차이는 가정치의 차이이며 추천 순위가 아닙니다.':
   '유효하지 않거나 손익비 기준 미달인 시나리오가 있어 숫자 차이 비교를 보류했습니다.',
  marketDataVerified:false,accountConnected:false,brokerConnected:false,
  automaticTrading:false,canPlaceOrder:false,tradeApproved:false,
  providerCalls:0
 });
}
const api=Object.freeze({compare,MODES});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestStrategyScenarioCompareV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
