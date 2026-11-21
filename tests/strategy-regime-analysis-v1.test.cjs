const {test}=require('node:test');
const assert=require('node:assert/strict');
const regime=require('../js/strategy-regime-analysis-v1.js');
const engine=require('../js/strategy-evaluation-v1.js');

const DAY=86400000,START=Date.UTC(2025,0,2,15),NOW=Date.UTC(2026,10,21,12),N=150;
function bars(n=N){
 return Array.from({length:n},(_,i)=>({t:START+i*DAY,o:100,h:101,l:99,c:100,v:100}));
}
function pulses(b,indexes=[20,60,100]){
 for(const i of indexes){
  b[i]={...b[i],o:100,h:106,l:100,c:105,v:250};
  b[i+1]={...b[i+1],o:107,h:110,l:100,c:100};
  b[i+2]={...b[i+2],o:108,h:140,l:106,c:120};
 }
 return b;
}
function benchmark(ohlc){
 let p=100;
 return ohlc.map((b,i)=>{
  if(i>=50&&i<=89)p*=1.01;
  if(i>=90&&i<=119)p*=0.985;
  return {t:b.t,c:p};
 });
}
function fixture(tradeIndexes=[20,60,100]){
 const b=pulses(bars(),tradeIndexes),ref=benchmark(b);
 return {now:NOW,series:{bars:b,market:'US',currency:'USD',exchange:'NASDAQ',symbol:'SERV',
  interval:'1d',finalized:true,priceConvention:'split_adjusted',
  observedAt:b.at(-1).t+3600000,sourceProvider:'SYNTHETIC_FIXTURE',
  purpose:'historical'},
 benchmark:{bars:ref,market:'US',currency:'USD',symbol:'SPY',interval:'1d',
  finalized:true,priceConvention:'price_return',sourceProvider:'SYNTHETIC_FIXTURE',
  observedAt:b.at(-1).t+3600000},
 strategy:{riskPct:1,maxAllocationPct:25,feeBps:10,slippageBps:10,targetR:2}};
}
function code(out){return out.code}
const mapRows=r=>Object.fromEntries(r.groups.map(x=>[x.regime,x]));

test('P4: 20-day momentum classifies trade-date uptrend, sideways and downtrend without future prices',()=>{
 const f=fixture(),out=regime.analyze(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.version,'p4-regime-attribution-v1');
 assert.equal(out.method.classifiedAt,'SIGNAL_DECISION_BAR_CLOSE');
 assert.equal(out.method.entryAt,'NEXT_BAR_OPEN');
 assert.equal(out.method.thresholdUpPct,3);
 assert.equal(out.method.thresholdDownPct,-3);
 const trades=engine.simulate({interval:'1d',bars:f.series.bars,...f.strategy}).trades;
 assert.deepEqual(trades.map(x=>x.decisionIndex),[20,60,100]);
 const c=out.classification;
 assert.equal(c.find(x=>x.index===20).regime,'sideways');
 assert.equal(c.find(x=>x.index===60).regime,'uptrend');
 assert.equal(c.find(x=>x.index===100).regime,'downtrend');
 const rows=mapRows(out);
 assert.deepEqual(rows.sideways.trades,1);
 assert.equal(rows.uptrend.trades,1);
 assert.equal(rows.downtrend.trades,1);
 assert.equal(out.tradeCount,3);
 assert.equal(out.verification.historicalPriceSourceVerified,false);
 assert.equal(out.verification.benchmarkSourceVerified,false);
 assert.equal(out.verification.noOrderAuthority,true);
});
test('P4: partitioned regime PnL and trade counts reconcile to independently simulated totals',()=>{
 const f=fixture(),out=regime.analyze(f);
 const rows=out.groups,sim=engine.simulate({interval:'1d',bars:f.series.bars,...f.strategy});
 assert.equal(out.status,'descriptive_only');
 assert.ok(Math.abs(rows.reduce((s,x)=>s+x.netPnl,0)-sim.statistics.netPnl)<1e-8);
 assert.equal(rows.reduce((s,x)=>s+x.trades,0),sim.statistics.trades);
 assert.ok(Math.abs(rows.reduce((s,x)=>s+x.initialCapitalContributionPctPoints,0)-sim.statistics.netReturnPct)<1e-10);
 assert.equal(rows.reduce((s,x)=>s+x.decisionDays,0),out.period.classifiedDecisionDays);
 assert.ok(Math.abs(rows.reduce((s,x)=>s+x.shareOfClassifiedDecisionDaysPct,0)-100)<1e-10);
 assert.ok(out.warnings.some(x=>x.includes('독립 운용 수익률')));
});
test('P4: changing benchmark future bars never reclassifies an earlier signal',()=>{
 const f=fixture(),baseline=regime.analyze(f),original=baseline.classification.find(x=>x.index===60);
 const modified=structuredClone(f);
 for(let i=61;i<modified.benchmark.bars.length;i++)modified.benchmark.bars[i].c*=20;
 const changed=regime.analyze(modified);
 assert.equal(changed.status,'descriptive_only');
 assert.deepEqual(changed.classification.find(x=>x.index===60),original);
 assert.equal(regime.classify(modified.benchmark.bars,60).regime,'uptrend');
});
test('P4: loss attribution stays attached to SIGNAL regime when trade exits in a later regime',()=>{
 const f=fixture([20]),d=regime.analyze(f);
 assert.equal(d.status,'descriptive_only');
 assert.equal(mapRows(d).sideways.trades,1);
 assert.equal(mapRows(d).downtrend.trades,0);
 assert.equal(d.method.attribution,'ENTIRE_TRADE_PNL_ASSIGNED_TO_SIGNAL_DATE_REGIME');
});
test('P4: zero trades produce null win-rate and no fake profit-factor',()=>{
 const f=fixture([]),out=regime.analyze(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.tradeCount,0);
 for(const row of out.groups){
  assert.equal(row.trades,0);
  assert.equal(row.winRatePct,null);
  assert.equal(row.winRateWilson95,null);
  assert.equal(row.profitFactor,null);
  assert.equal(row.meanNetR,null);
  assert.equal(row.worstNetR,null);
  assert.equal(row.netPnl,0);
  assert.equal(row.sampleGrade,'LOW_SAMPLE');
 }
});
test('P4: exact +/-3% boundaries are deterministic and do not require later bars',()=>{
 const b=Array.from({length:22},(_,i)=>({t:START+i*DAY,c:100}));
 b[20].c=103;
 assert.equal(regime.classify(b,20).regime,'uptrend');
 b[20].c=97;
 assert.equal(regime.classify(b,20).regime,'downtrend');
 b[20].c=100;
 assert.equal(regime.classify(b,20).regime,'sideways');
 assert.equal(regime.classify(b,19),null);
 assert.equal(regime.classify(b,22),null);
});
test('P4: explicit metadata, market/currency, finalized bars and benchmark close convention are required',()=>{
 const f=fixture();
 for(const change of [
  {market:'KR'}, {currency:'KRW'},{interval:'1m'},{finalized:false},
  {symbol:''},{sourceProvider:''},{priceConvention:'total_return_adjusted'}
 ]){
  const x=structuredClone(f);Object.assign(x.benchmark,change);
  assert.equal(regime.analyze(x).status,'blocked');
 }
 assert.equal(code(regime.analyze({...f,now:0})),'EXPLICIT_NOW_REQUIRED');
});
test('P4: strict timestamp matching blocks shifted and missing benchmark daily bars',()=>{
 const f=fixture();
 let x=structuredClone(f);x.benchmark.bars[40].t+=3600000;
 assert.equal(code(regime.analyze(x)),'BENCHMARK_DAILY_ALIGNMENT_OR_CLOSE_INVALID');
 x=structuredClone(f);x.benchmark.bars.pop();
 assert.equal(code(regime.analyze(x)),'BENCHMARK_WINDOW_OR_LENGTH_MISMATCH');
 x=structuredClone(f);x.benchmark.bars[60].c=NaN;
 assert.equal(code(regime.analyze(x)),'BENCHMARK_DAILY_ALIGNMENT_OR_CLOSE_INVALID');
});
test('P4: missing/invalid source observation cannot be confused with real benchmark provenance',()=>{
 const f=fixture(),x=structuredClone(f);
 x.benchmark.observedAt=1;
 assert.equal(code(regime.analyze(x)),'BENCHMARK_OBSERVATION_TIME_INVALID');
 x.benchmark.observedAt=NOW+3600000;
 assert.equal(code(regime.analyze(x)),'BENCHMARK_OBSERVATION_TIME_INVALID');
 x.benchmark.observedAt=f.benchmark.observedAt;
 const out=regime.analyze(x);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.verification.actualMarketRegimeProven,false);
});
test('P4: quality review blocks historical regime score rather than showing misleading metrics',()=>{
 const f=fixture();
 f.series.bars[30].v=null;
 const out=regime.analyze(f);
 assert.equal(out.status,'blocked');
 assert.equal(out.code,'SERIES_QUALITY_NOT_READY');
 assert.ok(out.details.flags.some(x=>x.code==='MISSING_VOLUME'));
 assert.equal(out.groups,undefined);
});
test('P4: evaluation start preserves signal on previous day for valid next-open entry',()=>{
 const f=fixture([20]),first=f.series.bars[21].t;
 f.strategy.testStartAt=first;
 const out=regime.analyze(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.period.firstDecisionAt,f.series.bars[20].t);
 assert.equal(out.tradeCount,1);
 const shifted=structuredClone(f);shifted.strategy.testStartAt=f.series.bars[22].t;
 const noEntry=regime.analyze(shifted);
 assert.equal(noEntry.status,'descriptive_only');
 assert.equal(noEntry.tradeCount,0);
 assert.equal(noEntry.period.firstDecisionAt,f.series.bars[21].t);
});
test('P4: no more than 5000 observations and insufficient history do not bypass quality gate',()=>{
 const x=fixture([]);
 x.series.bars=x.series.bars.slice(0,30);
 x.series.observedAt=x.series.bars.at(-1).t+3600000;
 x.benchmark.bars=x.benchmark.bars.slice(0,30);
 x.benchmark.observedAt=x.series.observedAt;
 const out=regime.analyze(x);
 assert.equal(out.status,'blocked');
 assert.equal(out.code,'SERIES_QUALITY_NOT_READY');
});
test('P4: method is stable, deterministic and does not mutate either input array',()=>{
 const f=fixture(),before=JSON.stringify(f);
 const a=regime.analyze(f),b=regime.analyze(f);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(f),before);
 assert.deepEqual(a.groups.map(x=>x.regime),['uptrend','sideways','downtrend']);
 assert.ok(a.groups.every(x=>x.sampleGrade==='LOW_SAMPLE'));
 assert.ok(a.period.transitions>=2);
});
test('P4: malicious strategy config cannot override inspected series and interval',()=>{
 const f=fixture(),base=regime.analyze(f);
 f.strategy={...f.strategy,bars:[],interval:'1m',riskPct:1};
 const out=regime.analyze(f);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.totalNetPnl,base.totalNetPnl);
});
