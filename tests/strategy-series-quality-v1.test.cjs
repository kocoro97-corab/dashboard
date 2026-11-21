const {test}=require('node:test');
const assert=require('node:assert/strict');
const quality=require('../js/strategy-series-quality-v1.js');
const strategy=require('../js/strategy-evaluation-v1.js');

const DAY=86400000,START=Date.UTC(2025,0,2,15);
const NOW=Date.UTC(2026,10,21,12);
const rows=(n=150)=>Array.from({length:n},(_,i)=>({
 t:START+i*DAY,o:100,h:102,l:98,c:100,v:10000
}));
function data(changes={}){
 return {bars:rows(),market:'US',exchange:'NASDAQ',currency:'USD',
  symbol:'TSLA',interval:'1d',sourceProvider:'SyntheticTest',
  priceConvention:'split_adjusted',finalized:true,purpose:'historical',now:NOW,
  observedAt:Date.UTC(2025,7,1),...changes};
}
const codes=x=>x.map(y=>y.code);

test('P4 data quality: explicit structural readiness never implies verified external source',()=>{
 const x=quality.inspect(data());
 assert.equal(x.status,'structurally_ready');
 assert.equal(x.eligibleForProvisionalBacktest,true);
 assert.equal(x.realSourceVerified,false);
 assert.equal(x.verification,'OFFLINE_STRUCTURE_ONLY');
 assert.equal(x.facts.barCount,150);
 assert.equal(x.facts.exchangeTimeZone,'America/New_York');
 assert.equal(x.errors.length,0);
});
test('P4 rejects malformed or missing series without crashing',()=>{
 for(const input of [null,undefined,[],{},data({bars:null}),data({bars:[]}),data({bars:Array(5001).fill({})})]){
  const result=quality.inspect(input);
  assert.equal(result.status,'block');
  assert.equal(result.eligibleForProvisionalBacktest,false);
 }
});
test('P4 rejects unsupported market, mismatch currency, exchange and ticker',()=>{
 let x=quality.inspect(data({market:'EU'}));
 assert.ok(codes(x.errors).includes('UNSUPPORTED_MARKET'));
 x=quality.inspect(data({currency:'KRW',exchange:'KRX',symbol:'BAD TICKER'}));
 assert.ok(codes(x.errors).includes('MARKET_CURRENCY_MISMATCH'));
 assert.ok(codes(x.errors).includes('EXCHANGE_IDENTITY_REQUIRED'));
 assert.ok(codes(x.errors).includes('SYMBOL_REQUIRED'));
});
test('P4 rejects intraday disguised as daily and enforces order/price geometry',()=>{
 const b=rows();
 b[20].t=b[19].t+60000;
 let x=quality.inspect(data({bars:b}));
 assert.ok(codes(x.errors).includes('NON_DAILY_OR_UNSORTED_TIMESTAMPS'));
 b[20].t=START+20*DAY;b[55].h=95;
 x=quality.inspect(data({bars:b}));
 assert.ok(codes(x.errors).includes('INVALID_OHLC'));
});
test('P4 rejects duplicated local exchange calendar days even when timestamps grow',()=>{
 const b=rows();
 b[0].t=Date.UTC(2025,0,2,5);
 b[1].t=Date.UTC(2025,0,2,23,30);
 let x=quality.inspect(data({bars:b}));
 assert.ok(codes(x.errors).includes('DUPLICATE_EXCHANGE_DATES'));
});
test('P4 price gap anomaly is a review flag rather than an invented split conclusion',()=>{
 const b=rows();
 b[40]={...b[40],o:50,h:52,l:49,c:50};
 let x=quality.inspect(data({bars:b}));
 assert.equal(x.status,'review');
 assert.ok(codes(x.flags).includes('LARGE_PRICE_JUMP_POSSIBLE_CORPORATE_ACTION'));
 assert.ok(x.facts.largePriceJumpExamples[0].changePct<0);
 assert.equal(x.eligibleForProvisionalBacktest,true);
});
test('P4 flags missing volume and price convention separately and never fabricates values',()=>{
 const b=rows();b[30].v=null;b[31].v=0;
 const x=quality.inspect(data({bars:b,priceConvention:'unknown',sourceProvider:null}));
 assert.equal(x.status,'review');
 assert.ok(codes(x.flags).includes('MISSING_VOLUME'));
 assert.ok(codes(x.flags).includes('ZERO_VOLUME_OBSERVATIONS'));
 assert.ok(codes(x.flags).includes('PRICE_ADJUSTMENT_CONVENTION_UNKNOWN'));
 assert.ok(codes(x.flags).includes('SOURCE_IDENTITY_UNDECLARED'));
 assert.equal(b[30].v,null);
});
test('P4 flags long calendar gaps without making holiday claims',()=>{
 const b=rows();for(let i=70;i<b.length;i++)b[i].t+=12*DAY;
 const x=quality.inspect(data({bars:b}));
 assert.equal(x.status,'review');
 assert.ok(codes(x.flags).includes('LONG_CALENDAR_GAPS'));
 assert.ok(x.facts.longestCalendarGapDays>10);
});
test('P4 rejects future timestamps and inconsistent source observation time',()=>{
 const b=rows();b.at(-1).t=NOW+DAY;
 let x=quality.inspect(data({bars:b}));
 assert.ok(codes(x.errors).includes('FUTURE_BAR_TIMESTAMP'));
 const old=quality.inspect(data({observedAt:START-DAY}));
 assert.ok(codes(old.errors).includes('INCONSISTENT_SOURCE_OBSERVATION'));
});
test('P4 rejects unfinalized candles, incorrect intervals, short histories',()=>{
 let x=quality.inspect(data({finalized:false,interval:'1m',bars:rows(20)}));
 assert.ok(codes(x.errors).includes('FINALIZED_DAILY_BARS_REQUIRED'));
 assert.ok(codes(x.errors).includes('DAILY_INTERVAL_REQUIRED'));
 assert.ok(codes(x.errors).includes('TOO_FEW_BARS_FOR_P4'));
});
test('P4 current feed stale warning reflects calendar age, not invented real-time freshness',()=>{
 const x=quality.inspect(data({purpose:'current',observedAt:START+149*DAY}));
 assert.ok(codes(x.flags).includes('CURRENT_SERIES_MAY_BE_STALE'));
 assert.equal(x.realSourceVerified,false);
});
test('P4 Korean market identity and currency are separately accepted',()=>{
 const x=quality.inspect(data({market:'KR',exchange:'KRX',currency:'KRW',symbol:'005930'}));
 assert.equal(x.status,'structurally_ready');
 assert.equal(x.facts.exchangeTimeZone,'Asia/Seoul');
});
test('P4 quality gate is deterministic and never mutates original OHLCV or metadata',()=>{
 const input=data(),before=JSON.stringify(input),a=quality.inspect(input),b=quality.inspect(input);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(input),before);
});
test('P4 rejects invalid negative or string volume rather than marking it missing',()=>{
 for(const v of [-1,'10000',NaN]){
  const b=rows();b[45].v=v;
  const x=quality.inspect(data({bars:b}));
  assert.equal(x.status,'block');
  assert.ok(codes(x.errors).includes('INVALID_VOLUME'));
 }
});
test('P4 gracefully rejects broken final rows and out-of-range timestamps',()=>{
 const b=rows();b[b.length-1]=null;
 let x=quality.inspect(data({bars:b,purpose:'current'}));
 assert.equal(x.status,'block');
 assert.ok(codes(x.errors).includes('INVALID_OHLC'));
 b[b.length-1]={...rows()[149],t:8640000000000001};
 x=quality.inspect(data({bars:b}));
 assert.equal(x.status,'block');
 assert.ok(codes(x.errors).includes('INVALID_OHLC'));
});
test('P4 inherited market prototype keys cannot bypass the exchange identity gate',()=>{
 for(const market of ['constructor','toString','__proto__']){
  const x=quality.inspect(data({market}));
  assert.equal(x.status,'block');
  assert.ok(codes(x.errors).includes('UNSUPPORTED_MARKET'));
 }
});
test('P4 total-return adjustment convention requires explicit consistency review',()=>{
 const x=quality.inspect(data({priceConvention:'total_return_adjusted'}));
 assert.equal(x.status,'review');
 assert.ok(codes(x.flags).includes('TOTAL_RETURN_OHLCV_CONSISTENCY_NEEDS_REVIEW'));
 assert.equal(x.realSourceVerified,false);
});
test('P4 structurally ready series is compatible with isolated original engine',()=>{
 const input=data(),report=quality.inspect(input),simulation=strategy.simulate({
  bars:input.bars,interval:'1d'
 });
 assert.equal(report.status,'structurally_ready');
 assert.equal(simulation.status,'ok');
 assert.equal(simulation.statistics.trades,0);
 assert.equal(report.realSourceVerified,false);
});
