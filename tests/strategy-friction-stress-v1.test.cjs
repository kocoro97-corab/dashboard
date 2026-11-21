const {test}=require('node:test');
const assert=require('node:assert/strict');
const stress=require('../js/strategy-friction-stress-v1.js');
const baseEngine=require('../js/strategy-evaluation-v1.js');
const DAY=86400000,START=Date.UTC(2025,0,2,15),NOW=Date.UTC(2026,10,21,12);
function candles(n=160){
 return Array.from({length:n},(_,i)=>({t:START+i*DAY,o:100,h:101,l:99,c:100,v:100}));
}
function addTrade(b,i){
 b[i]={...b[i],o:100,h:106,l:100,c:105,v:250};
 b[i+1]={...b[i+1],o:107,h:110,l:103,c:108};
 b[i+2]={...b[i+2],o:108,h:140,l:106,c:120};
}
function fixture({trades=true}={}){
 const b=candles();
 if(trades)for(const i of [20,60,100])addTrade(b,i);
 return {now:NOW,series:{bars:b,interval:'1d',market:'US',
  currency:'USD',exchange:'NASDAQ',symbol:'SERV',
  sourceProvider:'SyntheticTest',priceConvention:'split_adjusted',
  purpose:'historical',finalized:true,observedAt:b.at(-1).t+3600000},
  strategy:{initialCapital:10000000,riskPct:1,maxAllocationPct:25,
   feeBps:10,slippageBps:10,targetR:2}};
}
const codes=()=>['baseline','fee-plus-10bps','slippage-plus-10bps','combined-plus-10bps',
 'fee-plus-30bps','slippage-plus-30bps','combined-plus-30bps'];
test('P4 friction report has predeclared 7 baseline/cost cases without optimizer or trading access',()=>{
 const r=stress.analyze(fixture());
 assert.equal(r.status,'descriptive_only');
 assert.equal(r.version,'p4-friction-stress-v1');
 assert.deepEqual(r.costSensitivity.map(x=>x.id),codes());
 assert.equal(r.baseline.trades,3);
 assert.equal(r.observations.nonBaselineScenarioCount,6);
 assert.equal(r.verification.sourceVerified,false);
 assert.equal(r.verification.independentHoldoutProven,false);
 assert.equal(r.verification.parameterSearchPerformed,false);
 assert.equal(r.verification.noOrderAuthority,true);
 assert.equal(r.method.portfolioVaRCalculated,false);
 assert.equal(r.method.stressTradePathsAreNotHeldConstant,true);
 assert.ok(!('recommended' in r));
 assert.ok(!('winner' in r));
});
test('P4 cost runs preserve independent original result and metrics audit',()=>{
 const f=fixture(),r=stress.analyze(f);
 const raw=baseEngine.simulate({...f.strategy,interval:'1d',bars:f.series.bars});
 assert.equal(r.baseline.netPnl,raw.statistics.netPnl);
 assert.equal(r.baseline.netReturnPct,raw.statistics.netReturnPct);
 assert.equal(r.baseline.feeCost,raw.statistics.feeCost);
 assert.equal(r.baseline.maxObservedSingleTradeLoss,0);
 for(const c of r.costSensitivity.slice(1)){
  assert.equal(c.deltaNetPnlFromBaseline,c.netPnl-r.baseline.netPnl);
  assert.ok(Math.abs(c.deltaNetReturnPctPoints-(c.netReturnPct-r.baseline.netReturnPct))<1e-10);
  assert.ok(c.feeBps>=r.baseline.feeBps);
  assert.ok(c.slippageBps>=r.baseline.slippageBps);
  assert.equal(c.tradePathOrSizingMayChange,true);
 }
});
test('P4 5% vs 10% gap shock estimates worse single-trade hypothetical loss, never portfolio VaR',()=>{
 const r=stress.analyze(fixture()),[five,ten]=r.gapShockScenarios;
 assert.equal(r.status,'descriptive_only');
 assert.deepEqual(r.method.gapBelowPlannedStopPct,[5,10]);
 assert.equal(five.tradesIndividuallyStressed,3);
 assert.equal(five.assumedOccurrence,'ONE_TRADE_AT_A_TIME_HYPOTHETICAL');
 assert.ok(five.worstSingleTrade.netPnl<0);
 assert.ok(ten.worstSingleTrade.netPnl<five.worstSingleTrade.netPnl);
 assert.ok(ten.worstSingleTrade.hypotheticalGapOpen<five.worstSingleTrade.hypotheticalGapOpen);
 assert.equal(five.portfolioVar,null);
 assert.equal(ten.portfolioReturnPct,null);
 assert.ok(five.riskBudgetOverrunIfShockedCount>=1);
 assert.equal(r.observations.gapLossCanExceedConfiguredRisk,true);
});
test('P4 gap shock arithmetic respects planned stop and adverse exit fee/slippage',()=>{
 const f=fixture(),r=stress.analyze(f);
 const first=baseEngine.simulate({...f.strategy,interval:'1d',bars:f.series.bars}).trades[0];
 const shock=r.gapShockScenarios[0],worst=shock.worstSingleTrade;
 const assumedPrice=first.stop*.95,exitFill=assumedPrice*(1-first.exitFee/(first.quantity*first.exitFill)*0+0); // overwritten below
 assert.ok(Math.abs(worst.hypotheticalGapOpen-assumedPrice)<1e-9);
 const sell=assumedPrice*(1-f.strategy.slippageBps/10000);
 const pnl=first.quantity*(sell-first.entryFill)-first.entryFee-
  first.quantity*sell*(f.strategy.feeBps/10000);
 assert.ok(Math.abs(worst.netPnl-pnl)<1e-7);
 assert.ok(worst.netR< -1);
});
test('P4 quality warnings prevent publishing computed hypothetical strategy metrics',()=>{
 const f=fixture();
 f.series.bars[34].v=null;
 let o=stress.analyze(f);
 assert.equal(o.status,'blocked');
 assert.equal(o.code,'SERIES_QUALITY_NOT_READY');
 assert.ok(o.detail.flags.some(x=>x.code==='MISSING_VOLUME'));
 assert.equal(o.costSensitivity,undefined);
 f.series.bars[34].v=100;f.series.bars[40].h=40;
 o=stress.analyze(f);
 assert.equal(o.code,'SERIES_QUALITY_NOT_READY');
});
test('P4 timeframe, calendar and metadata validation are fail-closed',()=>{
 for(const patch of [
  {interval:'1m'},{finalized:false},{currency:'KRW'},{symbol:'NOT A SYMBOL'},
  {sourceProvider:null},{priceConvention:'total_return_adjusted'}
 ]){
  const f=fixture();Object.assign(f.series,patch);
  assert.equal(stress.analyze(f).code,'SERIES_QUALITY_NOT_READY');
 }
 const bad=fixture();bad.now=0;
 assert.equal(stress.analyze(bad).code,'EXPLICIT_AS_OF_REQUIRED');
 assert.equal(stress.analyze(null).code,'EXPLICIT_AS_OF_REQUIRED');
});
test('P4 invalid fixed baseline strategy and unsupported stress cost ceiling are handled cleanly',()=>{
 const f=fixture();
 f.strategy.riskPct=100;
 assert.equal(stress.analyze(f).code,'BASELINE_SIMULATION_INVALID_CONFIGURATION');
 f.strategy.riskPct=1;f.strategy.feeBps=175;
 assert.equal(stress.analyze(f).code,'COST_STRESS_BEYOND_ALLOWED_MODEL_LIMIT');
 f.strategy.feeBps=10;f.strategy.slippageBps=185;
 assert.equal(stress.analyze(f).code,'COST_STRESS_BEYOND_ALLOWED_MODEL_LIMIT');
});
test('P4 declared later evaluation start survives all fee/slippage reruns',()=>{
 const f=fixture(),all=stress.analyze(f);
 f.strategy.testStartAt=f.series.bars[61].t;
 const later=stress.analyze(f);
 assert.equal(later.status,'descriptive_only');
 assert.ok(all.baseline.trades>later.baseline.trades);
 assert.equal(later.baseline.trades,2);
 assert.ok(later.costSensitivity.every(x=>x.trades<=2));
});
test('P4 zero trades report null worst shock without inventing risk events',()=>{
 const f=fixture({trades:false}),r=stress.analyze(f);
 assert.equal(r.status,'descriptive_only');
 assert.equal(r.baseline.trades,0);
 assert.equal(r.baseline.netPnl,0);
 assert.equal(r.observations.gapLossCanExceedConfiguredRisk,false);
 assert.ok(r.costSensitivity.every(x=>x.trades===0));
 assert.ok(r.gapShockScenarios.every(x=>x.tradesIndividuallyStressed===0&&x.worstSingleTrade===null));
});
test('P4 strategy cannot replace pre-inspected bars or daily interval',()=>{
 const f=fixture(),expected=stress.analyze(f);
 f.strategy={...f.strategy,bars:[{t:1,c:1}],interval:'1m'};
 const r=stress.analyze(f);
 assert.equal(r.status,'descriptive_only');
 assert.deepEqual(r.baseline,expected.baseline);
 assert.deepEqual(r.costSensitivity,expected.costSensitivity);
});
test('P4 output is stable, pure and source flags never assert verified market evidence',()=>{
 const f=fixture(),before=JSON.stringify(f);
 const a=stress.analyze(f),b=stress.analyze(f);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(f),before);
 assert.ok(a.warnings.some(x=>x.includes('순수 비용 효과로 단정하지')));
 assert.ok(a.warnings.some(x=>x.includes('포트폴리오 VaR')));
 assert.equal(a.verification.realTradingObserved,false);
});
