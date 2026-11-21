const {test}=require('node:test');
const assert=require('node:assert/strict');
const walk=require('../js/strategy-walkforward-v1.js');
const DAY=86400000,START=Date.UTC(2025,0,2,15),NOW=Date.UTC(2026,10,21,12);
const CAP=10000000;
function bars(n=240){
 return Array.from({length:n},(_,i)=>({t:START+i*DAY,o:100,h:101,l:99,c:100,v:100}));
}
function win(b,i){
 b[i]={...b[i],o:100,h:106,l:100,c:105,v:250};
 b[i+1]={...b[i+1],o:107,h:110,l:103,c:108};
 b[i+2]={...b[i+2],o:108,h:140,l:106,c:120};
}
function fixture(){
 const b=bars();for(const i of [130,170,210])win(b,i);
 return {now:NOW,trainBars:120,evalBars:40,foldCount:3,
  series:{market:'US',currency:'USD',exchange:'NASDAQ',symbol:'SERV',
   finalized:true,interval:'1d',sourceProvider:'SyntheticTest',
   priceConvention:'split_adjusted',purpose:'historical',
   observedAt:b.at(-1).t+3600000,bars:b},
  strategy:{riskPct:1,maxAllocationPct:25,feeBps:10,slippageBps:10,targetR:2}};
}
function rows(out){return out.folds.map(x=>x.outcomes)}
test('P4 walkforward: three strictly increasing nonoverlapping fixed-length evaluation folds',()=>{
 const f=fixture(),out=walk.evaluate(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.version,'p4-walkforward-v1');
 assert.equal(out.folds.length,3);
 assert.deepEqual(out.folds.map(x=>x.evaluation.firstIndexInclusive),[120,160,200]);
 assert.deepEqual(out.folds.map(x=>x.evaluation.lastIndexInclusive),[159,199,239]);
 assert.deepEqual(out.folds.map(x=>x.training.observedBars),[120,160,200]);
 assert.ok(out.folds.every(x=>x.restrictions.zeroBarsReadAfterFoldEnd===true));
 assert.ok(out.folds.every(x=>x.restrictions.initialCapitalResetPerFold));
 assert.equal(out.method.testWindowsOverlap,false);
 assert.equal(out.method.strategyParametersNotReoptimized,true);
 assert.equal(out.method.wealthCompoundingAssumed,false);
 assert.equal(out.verification.parametersPreRegistered,false);
 assert.equal(out.verification.independentHoldoutProven,false);
 assert.equal(out.verification.noOrderAuthority,true);
});
test('P4 walkforward: each segment sees only own prefix and later changed bars cannot affect first fold',()=>{
 const f=fixture(),old=walk.evaluate(f);
 assert.equal(old.status,'descriptive_only');
 const next=structuredClone(f);
 next.series.bars[220]={...next.series.bars[220],o:100,h:101,l:98,c:99};
 next.series.bars[225]={...next.series.bars[225],o:100,h:103,l:99,c:101};
 const fresh=walk.evaluate(next);
 assert.equal(fresh.status,'descriptive_only');
 assert.deepEqual(fresh.folds[0],old.folds[0]);
 assert.deepEqual(fresh.folds[1],old.folds[1]);
});
test('P4 walkforward: trade entry is after test starts and each fold PnL is evaluated independently',()=>{
 const out=walk.evaluate(fixture());
 assert.equal(out.status,'descriptive_only');
 assert.ok(rows(out).every(x=>x.trades===1));
 assert.ok(rows(out).every(x=>x.netPnl>0));
 assert.equal(out.stability.totalTradeObservations,3);
 assert.equal(out.stability.foldsWithPositiveNetPnl,3);
 assert.equal(out.stability.foldWinFractionPct,100);
 assert.equal(out.stability.totalCompoundedReturnPct,null);
 assert.ok(Math.abs(rows(out).reduce((a,x)=>a+x.netPnl,0)-
  out.stability.totalIndependentFoldNetPnlSameInitialCapital)<1e-8);
});
test('P4 walkforward: a signal one bar before test start may enter only on first evaluation open',()=>{
 const f=fixture();win(f.series.bars,119);
 const out=walk.evaluate(f);
 assert.equal(out.status,'descriptive_only');
 assert.ok(out.folds[0].outcomes.trades>=1);
 assert.equal(out.folds[0].evaluation.firstIndexInclusive,120);
 assert.equal(out.folds[0].training.endAt,f.series.bars[119].t);
});
test('P4 walkforward: snapshot-rejected time split cannot silently omit a trailing interval',()=>{
 const f=fixture();f.series.bars.push({t:START+240*DAY,o:100,h:101,l:99,c:100,v:100});
 const out=walk.evaluate(f);
 assert.equal(out.status,'blocked');
 assert.equal(out.code,'FOLDS_MUST_COVER_ALL_SERIES_BARS');
 assert.equal(out.detail.requiredBars,240);
 assert.equal(out.detail.actualBars,241);
});
test('P4 walkforward: parameter config cannot override inspected input bars, time split or daily interval',()=>{
 const f=fixture(),original=walk.evaluate(f);
 f.strategy={...f.strategy,testStartAt:1,interval:'1m',bars:[{t:1,o:1,h:1,l:1,c:1,v:1}]};
 const x=walk.evaluate(f);
 assert.equal(x.status,'descriptive_only');
 assert.deepEqual(x.folds,original.folds);
});
test('P4 walkforward: sample quality errors and missing volume block evaluation',()=>{
 const f=fixture();f.series.bars[47].v=null;
 const o=walk.evaluate(f);
 assert.equal(o.status,'blocked');
 assert.equal(o.code,'SERIES_QUALITY_NOT_READY');
 assert.ok(o.detail.flags.some(x=>x.code==='MISSING_VOLUME'));
 assert.equal(o.folds,undefined);
});
test('P4 walkforward: no trades is valid descriptive evidence with no fake win rate',()=>{
 const f=fixture();
 f.series.bars=bars();
 f.series.observedAt=f.series.bars.at(-1).t+3600000;
 const out=walk.evaluate(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.stability.totalTradeObservations,0);
 assert.equal(out.stability.foldsWithNoTrades,3);
 assert.equal(out.stability.meanFoldReturnPct,0);
 assert.equal(out.stability.worstFoldReturnPct,0);
 assert.ok(rows(out).every(x=>x.winRatePct===null));
 assert.equal(out.stability.evidenceGrade,'LOW_TRADE_SAMPLE');
});
test('P4 walkforward: explicit fold length limits and missing timestamps fail closed',()=>{
 const f=fixture();
 for(const settings of [
  {trainBars:119,evalBars:40,foldCount:3},
  {trainBars:120,evalBars:39,foldCount:3},
  {trainBars:120,evalBars:40,foldCount:1},
  {trainBars:120,evalBars:40,foldCount:7},
  {trainBars:120,evalBars:-40,foldCount:3},
  {trainBars:Infinity,evalBars:40,foldCount:3}
 ]){
  assert.equal(walk.evaluate({...f,...settings}).code,'INVALID_CHRONOLOGICAL_FOLD_POLICY');
 }
 assert.equal(walk.evaluate({...f,now:undefined}).code,'EXPLICIT_AS_OF_REQUIRED');
 assert.equal(walk.evaluate({...f,now:1.1}).code,'EXPLICIT_AS_OF_REQUIRED');
 assert.equal(walk.evaluate({...f,series:null}).code,'SERIES_REQUIRED');
});
test('P4 walkforward: no structural in-sample claims from a caller-declared split',()=>{
 const f=fixture(),out=walk.evaluate(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.verification.priceSourceVerified,false);
 assert.equal(out.verification.parametersPreRegistered,false);
 assert.equal(out.verification.parameterSearchPerformed,false);
 assert.ok(out.warnings.some(x=>x.includes('사전 등록')));
 assert.ok(out.warnings.some(x=>x.includes('강제청산')));
});
test('P4 walkforward: end-of-fold liquidation disclosed and never reported as compounded wealth',()=>{
 const f=fixture();f.series.bars=bars();
 const b=f.series.bars;f.series.observedAt=b.at(-1).t+3600000;
 b[157]={...b[157],o:100,h:106,l:100,c:105,v:250};
 b[158]={...b[158],o:107,h:110,l:103,c:108};
 b[159]={...b[159],o:108,h:110,l:105,c:108};
 const out=walk.evaluate(f);
 assert.equal(out.status,'descriptive_only');
 assert.ok(out.folds[0].restrictions.forcedEndOfFoldLiquidations>=1);
 assert.ok(out.stability.forcedEndOfFoldLiquidations>=1);
 assert.equal(out.stability.totalCompoundedReturnPct,null);
});
test('P4 walkforward: deterministic read-only output without mutating source or strategy',()=>{
 const f=fixture(),unchanged=JSON.stringify(f),a=walk.evaluate(f),b=walk.evaluate(f);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(f),unchanged);
 assert.equal(walk.version,'p4-walkforward-v1');
});
