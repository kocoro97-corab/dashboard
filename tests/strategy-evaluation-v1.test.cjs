const {test}=require('node:test');
const assert=require('node:assert/strict');
const evalP4=require('../js/strategy-evaluation-v1.js');

const DAY=86400000,BASE=1700000000000;
function bars(n=65){
 return Array.from({length:n},(_,i)=>({t:BASE+i*DAY,o:100,h:101,l:99,c:100,v:100}));
}
function breakout(){
 const b=bars();
 b[20]={...b[20],o:100,h:106,l:100,c:105,v:250};
 b[21]={...b[21],o:107,h:110,l:103,c:108};
 b[22]={...b[22],o:108,h:140,l:106,c:120};
 return b;
}
const run=(b,extra={})=>evalP4.simulate({bars:b,interval:'1d',...extra});

test('P4 enters only at NEXT bar open, exits at observed target and records costs',()=>{
 const b=breakout(),out=run(b);
 assert.equal(out.status,'ok');
 assert.equal(out.version,'p4-swing-breakout-v1');
 assert.equal(out.statistics.trades,1);
 const t=out.trades[0];
 assert.equal(t.decisionIndex,20);
 assert.equal(t.entryIndex,21);
 assert.equal(t.exitIndex,22);
 assert.equal(t.decisionClose,105);
 assert.equal(t.entryOpen,107);
 assert.ok(t.entryFill>107);
 assert.equal(t.reason,'target');
 assert.ok(t.target>t.entryFill);
 assert.ok(t.netPnl>0);
 assert.ok(t.grossPnl>t.netPnl);
 assert.ok(t.plannedRisk<=100000+0.001);
 assert.ok(t.quantity*t.entryFill*(1+0.001)<=2500000+0.001);
 assert.equal(t.riskOverrun,false);
 assert.ok(out.statistics.feeCost>0);
 assert.equal(out.validation.futureDataUsedForSignal,false);
 assert.equal(out.validation.inputProvenance,'NOT_EXTERNALLY_VERIFIED');
});
test('P4 uses preceding completed bars, not future high/volume to create a signal',()=>{
 const b=breakout(),first=evalP4.signalAt(b,20,{volumeMultiple:1.5});
 assert.ok(first);assert.equal(first.stop,99);assert.equal(first.priorHigh,101);
 b[21].h=1000;b[22].v=10000;b[30].c=500;b[30].h=501;
 assert.deepEqual(evalP4.signalAt(b,20,{volumeMultiple:1.5}),first);
 const altered=run(b);assert.equal(altered.trades[0].decisionIndex,20);
 assert.equal(altered.trades[0].entryIndex,21);
});
test('P4 makes same-day stop-target ambiguity STOP first instead of optimistic profit',()=>{
 const b=breakout();b[21]={...b[21],h:150,l:80,c:107};
 const out=run(b);assert.equal(out.statistics.trades,1);
 assert.equal(out.trades[0].reason,'stop_first_ambiguous');
 assert.equal(out.trades[0].ambiguous,true);
 assert.ok(out.trades[0].netPnl<0);
});
test('P4 uses worse gap-open stop fills, not the planned stop price',()=>{
 const b=breakout();b[22]={...b[22],o:80,h:85,l:75,c:80};
 const out=run(b);assert.equal(out.trades[0].reason,'stop_gap');
 assert.ok(out.trades[0].exitFill<out.trades[0].stop);
 assert.ok(out.trades[0].netPnl<0);
 assert.equal(out.trades[0].riskOverrun,true);
 assert.ok(-out.trades[0].netPnl>out.trades[0].plannedRisk);
});
test('P4 awards capped target on target-gap open before later intraday stop',()=>{
 const b=breakout();b[21].h=110;
 b[22]={...b[22],o:145,h:150,l:95,c:110};
 const out=run(b);assert.equal(out.statistics.trades,1);
 assert.equal(out.trades[0].reason,'target_gap_capped');
 assert.ok(out.trades[0].netPnl>0);
 assert.ok(out.trades[0].exitFill<out.trades[0].target);
});
test('P4 out-of-sample testStartAt excludes earlier next-open fills, still uses training as warmup only',()=>{
 const b=breakout();
 const includes=run(b,{testStartAt:b[21].t});
 assert.equal(includes.validation.outOfSample,true);
 assert.equal(includes.statistics.trades,1);
 const excludes=run(b,{testStartAt:b[22].t});
 assert.equal(excludes.statistics.trades,0);
 assert.equal(excludes.skipped.BEFORE_EVALUATION_WINDOW,1);
 assert.equal(excludes.statistics.netReturnPct,0);
});
test('P4 validates OHLCV, exact date split and daily-only scope',()=>{
 const b=breakout();
 assert.equal(evalP4.simulate({bars:b,interval:'1m'}).code,'DAILY_INTERVAL_REQUIRED');
 assert.equal(run(b,{riskPct:99}).code,'INVALID_CONFIGURATION');
 assert.equal(run(b,{feeBps:-1}).code,'INVALID_CONFIGURATION');
 assert.equal(run(b,{testStartAt:b[21].t+1}).code,'INVALID_TEST_START');
 assert.equal(run(b.slice(0,20)).status,'insufficient');
 const intraday=b.map((row,i)=>({...row,t:BASE+i*60000}));assert.equal(run(intraday).code,'INVALID_BARS');
 b[7].t=b[6].t;assert.equal(run(b).code,'INVALID_BARS');
 b[7].t=BASE+7*DAY;b[21].h=106;
 assert.equal(run(b).code,'INVALID_BARS');
 b[21].h=110;b[21].v=-100;
 assert.equal(run(b).code,'INVALID_BARS');
});
test('P4 unavailable volume cannot be fabricated into a verified breakout',()=>{
 const b=breakout();b[5].v=null;
 const out=run(b);
 assert.equal(out.status,'ok');
 assert.equal(out.statistics.trades,0);
});
test('P4 fee sensitivity affects net outcomes, one-bar maximum holding closes at close',()=>{
 const b=breakout();
 const free=run(b,{feeBps:0,slippageBps:0});
 const priced=run(b,{feeBps:150,slippageBps:0});
 assert.equal(free.statistics.trades,1);
 assert.equal(priced.statistics.trades,1);
 assert.ok(priced.statistics.netPnl<free.statistics.netPnl);
 const one=run(b,{maxHoldingBars:1});
 assert.equal(one.statistics.trades,1);
 assert.equal(one.trades[0].reason,'time_exit');
 assert.equal(one.trades[0].exitIndex,21);
});
test('P4 result is deterministic and never alters the supplied data',()=>{
 const b=breakout(),original=JSON.stringify(b);
 const x=run(b),y=run(b);
 assert.deepEqual(x,y);
 assert.equal(JSON.stringify(b),original);
 assert.ok(x.statistics.maxRealizedDrawdownPct>=0);
 assert.ok(x.warnings.some(w=>w.includes('미래')));
});
