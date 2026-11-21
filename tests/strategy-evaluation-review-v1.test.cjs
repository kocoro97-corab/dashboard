const {test}=require('node:test');
const assert=require('node:assert/strict');
const strategy=require('../js/strategy-evaluation-v1.js');
const review=require('../js/strategy-evaluation-review-v1.js');

const DAY=86400000,BASE=1700000000000;
const flat=(n=65)=>Array.from({length:n},(_,i)=>({t:BASE+i*DAY,o:100,h:101,l:99,c:100,v:100}));
function breakout(){
 const b=flat();
 b[20]={...b[20],o:100,h:106,l:100,c:105,v:250};
 b[21]={...b[21],o:107,h:110,l:100,c:100};
 b[22]={...b[22],o:108,h:140,l:106,c:120};
 return b;
}
function evaluate(b,config={}){const simulation=strategy.simulate({interval:'1d',bars:b,...config});assert.equal(simulation.status,'ok');return {bars:b,simulation}}

test('P4 review includes intratrade mark-to-market losses hidden by realized-only drawdown',()=>{
 const result=review.audit(evaluate(breakout()));
 assert.equal(result.status,'ok');
 assert.equal(result.engine,'p4-swing-breakout-v1');
 assert.equal(result.strategy.realizedOnlyDrawdownPct,0);
 assert.ok(result.strategy.drawdown.maxDrawdownPct>0);
 assert.equal(result.strategy.curve[0].at,BASE+21*DAY);
 assert.equal(result.strategy.curve[0].holding,true);
 assert.equal(result.strategy.curve[1].holding,false);
 assert.equal(result.strategy.curve.at(-1).equity,result.strategy.finalEquity);
 assert.equal(result.reliability.grade,'LOW_SAMPLE');
 assert.equal(result.reliability.tradeCount,1);
 assert.equal(result.validation.independentHoldoutProven,false);
});

test('P4 same-symbol buy and hold applies both-side fee/slippage and unused capital',()=>{
 const b=flat(),p=evaluate(b,{initialCapital:100000,feeBps:100,slippageBps:100});
 const r=review.audit(p);
 assert.equal(r.status,'ok');
 assert.equal(r.reliability.tradeCount,0);
 assert.equal(r.strategy.netReturnPct,0);
 const hold=r.buyAndHold;
 const entryFill=b[21].o*1.01,exitFill=b.at(-1).c*.99;
 const qty=Math.floor(100000/(entryFill*1.01)),uninvested=100000-qty*entryFill*1.01;
 assert.equal(hold.shares,qty);
 assert.ok(Math.abs(hold.finalEquity-(uninvested+qty*exitFill*.99))<1e-7);
 assert.ok(hold.finalEquity<100000);
 assert.ok(r.comparison.returnDifferencePctPoints>0);
 assert.equal(r.comparison.comparableExposure,false);
 assert.equal(hold.entryAt,b[21].t);
});

test('P4 review rejects switched bars, manipulated trade fills, missing ledger or forged PnL',()=>{
 const original=evaluate(breakout());
 const wrongBars=breakout();wrongBars[21]={...wrongBars[21],o:106};
 assert.equal(review.audit({bars:wrongBars,simulation:original.simulation}).code,'TRADE_LEDGER_INVALID');
 const s1=structuredClone(original.simulation);s1.trades[0].netPnl+=50;
 assert.equal(review.audit({bars:original.bars,simulation:s1}).code,'TRADE_LEDGER_INVALID');
 const s2=structuredClone(original.simulation);s2.statistics.finalEquity+=1e6;
 assert.equal(review.audit({bars:original.bars,simulation:s2}).code,'EQUITY_RECONCILIATION_FAILED');
 const s3=structuredClone(original.simulation);s3.trades[0].decisionIndex=s3.trades[0].entryIndex;
 assert.equal(review.audit({bars:original.bars,simulation:s3}).code,'TRADE_LEDGER_INVALID');
 const altered=breakout();altered[22]={...altered[22],h:121,c:120};
 assert.equal(review.audit({bars:altered,simulation:original.simulation}).code,'SIMULATION_REPLAY_MISMATCH');
});

test('P4 review confines evaluation period to eligible next-open fills, warmup excluded',()=>{
 const b=breakout(),start=b[22].t;
 const r=review.audit(evaluate(b,{testStartAt:start}));
 assert.equal(r.status,'ok');
 assert.equal(r.strategy.curve[0].at,start);
 assert.equal(r.reliability.tradeCount,0);
 assert.equal(r.buyAndHold.entryAt,start);
 assert.equal(r.validation.evaluationStartAt,start);
 assert.equal(r.reliability.grade,'LOW_SAMPLE');
});

test('P4 review preserves gap-stop PnL on exit day rather than substituting closing valuation',()=>{
 const b=breakout();b[22]={...b[22],o:80,h:85,l:75,c:83};
 const result=review.audit(evaluate(b));
 assert.equal(result.status,'ok');
 const s=strategy.simulate({interval:'1d',bars:b});
 assert.equal(s.trades[0].reason,'stop_gap');
 const day22=result.strategy.curve.find(x=>x.at===b[22].t);
 assert.ok(Math.abs(day22.equity-(s.parameters.initialCapital+s.trades[0].netPnl))<1e-8);
 assert.equal(day22.holding,false);
});

test('P4 review is deterministic, read-only, and does not claim verified data provenance',()=>{
 const b=breakout(),input=evaluate(b),before=JSON.stringify(input);
 const a=review.audit(input),again=review.audit(input);
 assert.deepEqual(a,again);
 assert.equal(JSON.stringify(input),before);
 assert.equal(a.validation.source,'CALLER_SUPPLIED_UNVERIFIED_DAILY_BARS');
 assert.equal(a.validation.sameSymbolBuyHoldOnly,true);
 assert.ok(a.warnings.some(x=>x.includes('실데이터')));
});

test('P4 review rejects invalid intervals, zero samples and inconsistent metadata',()=>{
 const b=breakout(),s=strategy.simulate({interval:'1d',bars:b});
 assert.equal(review.audit({bars:b,simulation:{...s,version:'not-p4'}}).code,'SIMULATION_MISMATCH');
 assert.equal(review.audit({bars:b,simulation:{...s,validation:{...s.validation,barCount:1}}}).code,'SIMULATION_MISMATCH');
 const invalidBars=breakout();invalidBars[20].t=invalidBars[19].t;
 assert.equal(review.audit({bars:invalidBars,simulation:s}).code,'INVALID_DAILY_BARS');
 assert.equal(review.audit({bars:[],simulation:s}).code,'SIMULATION_MISMATCH');
 assert.equal(review.audit().code,'INVALID_DAILY_BARS');
});

test('P4 review marks evaluation sample as low evidence even if window labelled holdout',()=>{
 const b=breakout(),s=strategy.simulate({interval:'1d',bars:b,testStartAt:b[21].t});
 const r=review.audit({bars:b,simulation:s});
 assert.equal(r.status,'ok');
 assert.equal(r.reliability.grade,'LOW_SAMPLE');
 assert.equal(r.validation.independentHoldoutProven,false);
 assert.ok(r.warnings.some(x=>x.includes('외표본')));
});
