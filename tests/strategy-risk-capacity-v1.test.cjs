'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const risk=require('../js/strategy-risk-capacity-v1.js');

const NOW=Date.parse('2026-11-20T10:30:00+09:00');
function fixture(overrides={}){
 return {
  mode:'swing',market:'KR',currency:'KRW',now:NOW,
  capital:10000000,cashAvailable:5000000,usedExposure:0,usedOpenRisk:0,
  entry:50000,stop:47000,target:60000,
  riskPct:1,allocationPct:20,
  feeBps:10,slippageBps:20,stressGapPct:5,lotSize:1,
  ...overrides
 };
}
const calculate=overrides=>risk.evaluate(fixture(overrides));

test('valid KRW swing scenario is hypothetical only, never an order',()=>{
 const r=calculate();
 assert.equal(r.status,'hypothetical');
 assert.equal(r.market,'KR');
 assert.equal(r.currency,'KRW');
 assert.equal(r.mode,'swing');
 assert.equal(r.executionAllowed,false);
 assert.equal(r.canPlaceOrder,false);
 assert.equal(r.tradeApproved,false);
 assert.equal(r.marketTruthVerified,false);
 assert.equal(r.leverageEnabled,false);
 assert.equal(r.fxConversionPerformed,false);
 assert.equal(r.holdingsAccessed,false);
 assert.equal(r.providerCalls,0);
 assert.equal(r.marketContext.gateStatus,'not-provided');
 assert.equal(r.marketContext.exchangeOpenConfirmed,false);
 assert.ok(r.warnings.includes('MARKET_CLOSE_DATA_NOT_QUALIFIED'));
});

test('risk-limited quantity is an integer and stop/stress losses remain within explicit risk budget',()=>{
 const r=calculate();
 assert.ok(Number.isSafeInteger(r.scenario.quantity));
 assert.ok(r.scenario.quantity>0);
 assert.ok(r.scenario.hypotheticalStopLoss<=r.available.riskBudget+1e-7);
 assert.ok(r.scenario.hypotheticalStressLoss<=r.available.riskBudget+1e-7);
 assert.ok(r.scenario.positionCost<=r.available.allocationBudget+1e-7);
 assert.ok(r.scenario.positionCost<=r.available.cashBudget+1e-7);
 assert.equal(r.scenario.diagnosticUpperBoundUnits,r.scenario.quantity);
});

test('stress gap limits position more than ordinary stop-loss bound',()=>{
 const base=calculate({stressGapPct:0});
 const stressed=calculate({stressGapPct:15});
 assert.ok(stressed.bounds.stressUnits<stressed.bounds.stopLossUnits);
 assert.ok(stressed.scenario.quantity<base.scenario.quantity);
 assert.ok(stressed.scenario.hypotheticalStressLoss<=stressed.available.riskBudget);
});

test('requested day-trading risk beyond conservative policy is capped rather than trusted',()=>{
 const day=calculate({mode:'day',riskPct:3,allocationPct:50});
 assert.equal(day.policy.maxRiskPct,1);
 assert.equal(day.policy.riskPct,1);
 assert.equal(day.policy.maxAllocationPct,20);
 assert.equal(day.policy.allocationPct,20);
 assert.equal(day.inputRiskPct,3);
 assert.ok(day.warnings.includes('REQUESTED_RISK_POLICY_CAPPED'));
 assert.ok(day.warnings.includes('REQUESTED_ALLOCATION_POLICY_CAPPED'));
 assert.equal(day.executionAllowed,false);
});

test('swing limits are separate from day-trading limits',()=>{
 const day=calculate({mode:'day',riskPct:1.5,allocationPct:25});
 const swing=calculate({mode:'swing',riskPct:1.5,allocationPct:25});
 assert.equal(day.policy.riskPct,1);
 assert.equal(day.policy.allocationPct,20);
 assert.equal(day.policy.minRewardRisk,1.5);
 assert.equal(swing.policy.riskPct,1.5);
 assert.equal(swing.policy.allocationPct,25);
 assert.equal(swing.policy.minRewardRisk,2);
});

test('existing open risk must be explicit and reduces remaining risk budget',()=>{
 const fresh=calculate({usedOpenRisk:0});
 const committed=calculate({usedOpenRisk:60000});
 assert.equal(committed.available.riskBudget,fresh.available.riskBudget-60000);
 assert.ok(committed.scenario.quantity<fresh.scenario.quantity);
 const exhausted=calculate({usedOpenRisk:300000});
 assert.equal(exhausted.scenario.quantity,0);
 assert.ok(exhausted.warnings.includes('NO_REMAINING_OPEN_RISK_BUDGET'));
});

test('existing same-currency exposure reduces allocation capacity',()=>{
 const fresh=calculate({usedExposure:0});
 const committed=calculate({usedExposure:1900000});
 assert.ok(committed.scenario.quantity<fresh.scenario.quantity);
 assert.ok(committed.available.allocationBudget<fresh.available.allocationBudget);
 const exhausted=calculate({usedExposure:5000000});
 assert.equal(exhausted.scenario.quantity,0);
 assert.ok(exhausted.warnings.includes('NO_REMAINING_ALLOCATION'));
});

test('cash shortage does not manufacture a leveraged purchase',()=>{
 const r=calculate({cashAvailable:10000});
 assert.equal(r.scenario.quantity,0);
 assert.ok(r.warnings.includes('INSUFFICIENT_CASH_FOR_LOT'));
 assert.equal(r.leverageEnabled,false);
});

test('market lot size rounds down without fractional shares',()=>{
 const one=calculate({lotSize:1});
 const ten=calculate({lotSize:10});
 assert.equal(ten.scenario.quantity%10,0);
 assert.ok(ten.scenario.quantity<=one.scenario.quantity);
 assert.ok(Number.isSafeInteger(ten.scenario.quantity));
});

test('target profit and stop risk include user-entered fees/slippage assumptions',()=>{
 const clean=calculate({feeBps:0,slippageBps:0});
 const costs=calculate({feeBps:100,slippageBps:100});
 assert.ok(costs.scenario.entryCostPerUnit>clean.scenario.entryCostPerUnit);
 assert.ok(costs.scenario.stopExitNetPerUnit<clean.scenario.stopExitNetPerUnit);
 assert.ok(costs.scenario.potentialProfitPerUnit<clean.scenario.potentialProfitPerUnit);
 assert.ok(costs.scenario.riskPerUnit>clean.scenario.riskPerUnit);
});

test('fees and slippage may push effective reward-risk below threshold',()=>{
 const x=calculate({target:52000,feeBps:100,slippageBps:100});
 assert.equal(x.status,'review-required');
 assert.equal(x.scenario.quantity,0);
 assert.ok(x.scenario.diagnosticUpperBoundUnits>0);
 assert.ok(x.warnings.includes('REWARD_RISK_BELOW_MODE_THRESHOLD'));
});

test('invalid price order is rejected, no short-selling path invented',()=>{
 for(const x of [
  {entry:47000,stop:47000},{stop:50000},
  {target:50000},{target:40000},{entry:-1},
  {stop:0},{target:Infinity}
 ]){
  const r=calculate(x);
  assert.equal(r.status,'invalid');
  assert.equal(r.code,'INVALID_CAPITAL_OR_LONG_PRICE');
 }
});

test('cross-currency exposure and capital are not silently converted',()=>{
 for(const x of [
  {market:'US',currency:'KRW'}, {market:'KR',currency:'USD'},
  {market:'FUTURES'}, {mode:'order'}, {currency:'JPY'}
 ]){
  const r=calculate(x);
  assert.equal(r.status,'invalid');
  assert.equal(r.code,'INVALID_MODE_MARKET_CURRENCY');
 }
});

test('valid USD case is treated in its own currency without FX conversion',()=>{
 const r=calculate({
  market:'US',currency:'USD',capital:10000,cashAvailable:5000,
  usedOpenRisk:0,usedExposure:0,entry:100,stop:95,target:120
 });
 assert.equal(r.status,'hypothetical');
 assert.equal(r.currency,'USD');
 assert.equal(r.fxConversionPerformed,false);
 assert.equal(r.scenario.quantity>0,true);
 assert.equal(r.marketContext.displayFocus,'KR');
});

test('invalid capital, cash or declared used risk is blocked rather than defaulted to zero',()=>{
 for(const x of [
  {capital:NaN},{capital:0},{cashAvailable:-1},{cashAvailable:11000000},
  {usedOpenRisk:-1},{usedOpenRisk:Infinity},{usedOpenRisk:undefined},
  {usedExposure:10000001},{usedExposure:undefined}
 ]){
  const r=calculate(x);
  assert.equal(r.status,'invalid',JSON.stringify(x));
 }
});

test('missing fee, slippage and stress inputs cannot be silently assumed zero',()=>{
 for(const name of ['feeBps','slippageBps','stressGapPct','riskPct','allocationPct']){
  const input=fixture();delete input[name];
  const r=risk.evaluate(input);
  assert.equal(r.status,'invalid',name);
  assert.equal(r.code,'INVALID_RISK_ASSUMPTIONS');
 }
});

test('fee and slippage controls have bounded, explicit units in basis points',()=>{
 for(const x of [{feeBps:101},{feeBps:-1},{slippageBps:501},
  {slippageBps:-1},{stressGapPct:51},{stressGapPct:-1},
  {lotSize:0},{lotSize:1.5},{lotSize:1000001},{riskPct:11},{allocationPct:101}]){
  assert.equal(calculate(x).code,'INVALID_RISK_ASSUMPTIONS');
 }
});

test('unexpected private field cannot be supplied to portfolio-free risk calculator',()=>{
 const x=calculate({holdings:[{accountNumber:'12345678'}]});
 assert.equal(x.status,'invalid');
 assert.equal(x.code,'INVALID_OR_PRIVATE_FIELDS');
 assert.equal(JSON.stringify(x).includes('12345678'),false);
});

test('market context must be supplied with all evidence keys to qualify',()=>{
 const base=calculate({quotes:{},sources:{},receivedAt:{}});
 assert.equal(base.marketContext.gateStatus,'blocked');
 assert.equal(base.scenario.quantity>0,true);
 assert.equal(base.tradeApproved,false);
 assert.ok(base.warnings.includes('MARKET_CLOSE_DATA_NOT_QUALIFIED'));
});

test('fully supplied, same-day US observation can be format-qualified but never price-verified',()=>{
 const now=Date.parse('2026-11-20T23:45:00+09:00');
 const stamp=Date.parse('2026-11-20T09:40:00-05:00');
 const symbols=['^GSPC','^IXIC','^DJI','^SOX'];
 const quotes=Object.fromEntries(symbols.map(x=>[x,{p:110,prev:100,phase:'close',observedAt:stamp}]));
 const sources=Object.fromEntries(symbols.map(x=>[x,'Y']));
 const receivedAt=Object.fromEntries(symbols.map(x=>[x,now-1000]));
 const r=calculate({
  now,market:'US',currency:'USD',capital:10000,cashAvailable:5000,
  entry:100,stop:95,target:120,quotes,sources,receivedAt
 });
 assert.equal(r.marketContext.gateStatus,'qualified-close');
 assert.equal(r.marketContext.marketWindow,'regular-clock-window');
 assert.equal(r.marketTruthVerified,false);
 assert.equal(r.marketContext.exchangeOpenConfirmed,false);
 assert.equal(r.tradeApproved,false);
});

test('missing or stale market quote never changes calculated input price or approves an order',()=>{
 const before=calculate();
 const bad=calculate({quotes:{'^KS11':{p:1,prev:2,observedAt:1}},
  sources:{'^KS11':'N'},receivedAt:{'^KS11':NOW-99999999}});
 assert.equal(bad.marketContext.gateStatus,'blocked');
 assert.equal(bad.scenario.entryCostPerUnit,before.scenario.entryCostPerUnit);
 assert.equal(bad.executionAllowed,false);
});

test('weekend markets are always unverified even with a computed scenario',()=>{
 const x=calculate({now:Date.parse('2026-11-21T15:00:00+09:00')});
 assert.equal(x.marketContext.marketWindow,'weekend');
 assert.ok(x.warnings.includes('OUTSIDE_REGULAR_CLOCK_WINDOW'));
 assert.equal(x.executionAllowed,false);
 assert.equal(x.status,'hypothetical');
});

test('all numeric outputs remain finite and overflow is refused',()=>{
 for(const x of [{capital:1e14},{entry:1e11},{lotSize:1e9}]){
  assert.equal(calculate(x).status,'invalid');
 }
 const x=calculate({capital:1e12,cashAvailable:1e12,
   entry:0.000001,stop:0.0000005,target:0.000003,
   usedOpenRisk:0,usedExposure:0,feeBps:0,slippageBps:0});
 assert.equal(x.status,'invalid');
 assert.equal(x.code,'NUMERIC_OVERFLOW');
});

test('no input object mutation across repeated evaluations',()=>{
 const f=fixture();
 const before=JSON.stringify(f);
 const a=risk.evaluate(f),b=risk.evaluate(f);
 assert.equal(JSON.stringify(f),before);
 assert.deepEqual(a,b);
});

test('module contains no network, storage, broker, billing or order execution path',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/strategy-risk-capacity-v1.js'),'utf8');
 for(const fragment of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService', 'NH_ACCOUNT', 'placeOrder(', 'executeOrder(', 'brokerToken',
  'GAS_URL', 'payment(', 'setInterval(']){
  assert.equal(src.includes(fragment),false,fragment);
 }
});
