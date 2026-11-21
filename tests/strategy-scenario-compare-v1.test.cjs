'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const compare=require('../js/strategy-scenario-compare-v1.js');

const NOW=Date.parse('2026-11-20T10:30:00+09:00');
function input(){
 return {
  common:{market:'KR',currency:'KRW',now:NOW,
   capital:10000000,cashAvailable:5000000,usedExposure:0,usedOpenRisk:0,
   feeBps:10,slippageBps:20,lotSize:1},
  scenarios:{
   day:{entry:50000,stop:48000,target:57000,riskPct:1,
    allocationPct:20,stressGapPct:5},
   swing:{entry:50000,stop:46000,target:62000,riskPct:1.5,
    allocationPct:25,stressGapPct:8}
  }
 };
}
test('both modes are strictly independent alternatives, not aggregated holdings',()=>{
 const r=compare.compare(input());
 assert.equal(r.status,'compared');
 assert.equal(r.basis,'SAME_MANUAL_CAPITAL_ALTERNATIVES_NOT_ADDITIVE');
 assert.equal(r.market,'KR');
 assert.equal(r.currency,'KRW');
 assert.equal(r.comparable,true);
 assert.equal(r.day.status,'hypothetical');
 assert.equal(r.swing.status,'hypothetical');
 assert.equal(r.providerCalls,0);
 assert.equal(r.marketDataVerified,false);
 assert.equal(r.accountConnected,false);
 assert.equal(r.brokerConnected,false);
 assert.equal(r.automaticTrading,false);
 assert.equal(r.canPlaceOrder,false);
 assert.equal(r.tradeApproved,false);
});
test('per-mode quantities stay below individual hypothetical risk and allocation constraints',()=>{
 const r=compare.compare(input());
 assert.ok(r.day.quantity>0);
 assert.ok(r.swing.quantity>0);
 assert.ok(r.day.baseRisk<=r.day.maxRiskBudget);
 assert.ok(r.day.stressRisk<=r.day.maxRiskBudget);
 assert.ok(r.day.cost<=r.day.maxAllocationBudget);
 assert.ok(r.swing.baseRisk<=r.swing.maxRiskBudget);
 assert.ok(r.swing.stressRisk<=r.swing.maxRiskBudget);
 assert.ok(r.swing.cost<=r.swing.maxAllocationBudget);
});
test('difference is swing minus day, not the sum of risk or capital',()=>{
 const r=compare.compare(input());
 const d=r.comparison;
 assert.equal(d.swingMinusDayQuantity,r.swing.quantity-r.day.quantity);
 assert.equal(d.swingMinusDayCost,r.swing.cost-r.day.cost);
 assert.equal(d.swingMinusDayStressRisk,r.swing.stressRisk-r.day.stressRisk);
 assert.equal(d.swingMinusDayPotentialGain,r.swing.reward-r.day.reward);
 assert.equal(d.swingMinusDayRewardRisk,r.swing.rewardRisk-r.day.rewardRisk);
 assert.match(r.note,/추천 순위가 아닙니다/);
});
test('single invalid scenario remains visible without destroying valid alternative',()=>{
 const x=input();x.scenarios.day.stop=x.scenarios.day.entry;
 const r=compare.compare(x);
 assert.equal(r.status,'partial');
 assert.equal(r.day.status,'invalid');
 assert.equal(r.day.reason,'INVALID_CAPITAL_OR_LONG_PRICE');
 assert.equal(r.swing.status,'hypothetical');
 assert.equal(r.comparable,false);
 assert.equal(r.comparison,null);
});
test('two invalid scenarios fail closed and do not produce comparison deltas',()=>{
 const x=input();x.scenarios.day.entry=-1;x.scenarios.swing.entry=-1;
 const r=compare.compare(x);
 assert.equal(r.status,'invalid-scenarios');
 assert.equal(r.code,'BOTH_SCENARIOS_INVALID');
 assert.equal(r.comparison,null);
 assert.equal(r.tradeApproved,false);
});
test('minimum reward-risk miss suppresses buying-sized output and difference',()=>{
 const x=input();x.scenarios.day.target=50100;
 const r=compare.compare(x);
 assert.equal(r.status,'compared');
 assert.equal(r.comparable,false);
 assert.equal(r.comparison,null);
 assert.equal(r.day.status,'review-required');
 assert.equal(r.day.quantity,0);
 assert.ok(r.day.warnings.includes('REWARD_RISK_BELOW_MODE_THRESHOLD'));
});
test('strategy sizing stays independent of risk hints when no market data is provided',()=>{
 const r=compare.compare(input());
 assert.equal(r.day.gateStatus,'not-provided');
 assert.equal(r.swing.gateStatus,'not-provided');
 assert.ok(r.day.warnings.includes('MARKET_CLOSE_DATA_NOT_QUALIFIED'));
});
test('cash shortage blocks both plans rather than inventing margin funding',()=>{
 const x=input();x.common.cashAvailable=0;
 const r=compare.compare(x);
 assert.equal(r.comparison,null);
 assert.equal(r.day.quantity,0);
 assert.equal(r.swing.quantity,0);
 assert.ok(r.day.warnings.includes('NO_REMAINING_ALLOCATION')===false);
 assert.ok(r.day.warnings.includes('INSUFFICIENT_CASH_FOR_LOT'));
});
test('increasing stress gap cannot increase computed quantity',()=>{
 const a=input(),b=input();b.scenarios.day.stressGapPct=20;
 const before=compare.compare(a).day.quantity,after=compare.compare(b).day.quantity;
 assert.ok(after<=before);
});
test('changing one mode leaves the other mode unchanged',()=>{
 const x=input(),y=input();
 y.scenarios.swing.target=70000;y.scenarios.swing.stop=44000;
 const a=compare.compare(x),b=compare.compare(y);
 assert.deepEqual(a.day,b.day);
 assert.notDeepEqual(a.swing,b.swing);
});
test('currency mismatch is never converted using an invented exchange rate',()=>{
 const x=input();x.common.market='US';x.common.currency='KRW';
 const r=compare.compare(x);
 assert.equal(r.status,'invalid-scenarios');
 assert.equal(r.day.reason,'INVALID_MODE_MARKET_CURRENCY');
 assert.equal(r.swing.reason,'INVALID_MODE_MARKET_CURRENCY');
});
test('no hidden defaults for missing capital or trade-cost assumptions',()=>{
 const x=input();delete x.common.usedOpenRisk;
 assert.equal(compare.compare(x).code,'INVALID_OR_PRIVATE_FIELDS');
 const y=input();delete y.common.feeBps;
 assert.equal(compare.compare(y).code,'INVALID_OR_PRIVATE_FIELDS');
});
test('unknown field containing account, holdings, token or order metadata fails closed',()=>{
 for(const [where,key] of [['common','accountNumber'],['common','holdings'],
  ['common','accessToken'],['day','orderId'],['swing','brokerSession']]){
  const x=input();
  if(where==='common')x.common[key]='PRIVATE987654';
  else x.scenarios[where][key]='PRIVATE987654';
  const r=compare.compare(x);
  assert.equal(r.status,'invalid');
  assert.equal(r.code,'INVALID_OR_PRIVATE_FIELDS');
  assert.equal(JSON.stringify(r).includes('PRIVATE987654'),false);
 }
});
test('unknown top-level fields and missing scenario mode fail closed',()=>{
 const x=input();x.meta={token:'secret'};
 assert.equal(compare.compare(x).code,'INVALID_OR_PRIVATE_FIELDS');
 const y=input();delete y.scenarios.swing;
 assert.equal(compare.compare(y).code,'INVALID_OR_PRIVATE_FIELDS');
});
test('input objects are not mutated; result is deterministic for fixed clock',()=>{
 const x=input();const before=JSON.stringify(x);
 const a=compare.compare(x),b=compare.compare(x);
 assert.equal(JSON.stringify(x),before);
 assert.deepEqual(a,b);
});
test('comparison source has no network, storage, account or execution path',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/strategy-scenario-compare-v1.js'),'utf8');
 for(const code of ['fetch(', 'XMLHttpRequest','localStorage.', 'sessionStorage.',
  'PropertiesService','NH_ACCOUNT','placeOrder(', 'executeOrder(','setInterval(']){
  assert.equal(src.includes(code),false,code);
 }
});
test('standalone preview loads existing gates and local modules without changing dashboard index',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../preview/strategy-scenario-compare-v1.html'),'utf8');
 const includes=['../js/market-evidence-gate-v1.js','../js/market-session-context-v1.js',
 '../js/strategy-risk-capacity-v1.js','../js/strategy-scenario-compare-v1.js',
 '../js/strategy-scenario-compare-panel-v1.js'];
 for(const path of includes)assert.ok(html.includes(path),path);
 assert.ok(html.includes('viewport'));
 assert.ok(html.includes('합성 테스트 화면'));
 assert.ok(!/https?:\/\/|<iframe|<form\s+action|<script\s+src="https?:/i.test(html));
});
test('comparison panel only writes safe text nodes, offers mobile columns and cleanup',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/strategy-scenario-compare-panel-v1.js'),'utf8');
 assert.ok(src.includes('textContent='));
 assert.ok(src.includes('max-width:650px'));
 assert.ok(src.includes('data-result'));
 assert.ok(src.includes('replaceChildren()'));
 assert.ok(src.includes('destroy:'));
 assert.ok(!src.includes('innerHTML'));
 assert.ok(!src.includes('fetch('));
 assert.ok(!src.includes('localStorage'));
});
