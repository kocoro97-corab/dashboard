'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const adapter=require('../js/market-sector-stock-adapter-v1.js');
const align=require('../js/market-sector-stock-alignment-v1.js');
const trading=require('../js/work-trading-strategy.js');
const code=fs.readFileSync(path.join(__dirname,'../js/sector-insights.js'),'utf8');
const runtime={window:{}};
vm.runInNewContext(code,runtime,{timeout:2500});
const libs={alignment:align,insights:runtime.window.SectorInsights};
const NOW=Date.parse('2026-11-21T07:05:00+09:00');
function weekdays(end='2026-11-20',count=40){
 const dates=[];let d=new Date(end+'T12:00:00Z');
 while(dates.length<count){
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)
   dates.push(d.toISOString().slice(0,10));
  d=new Date(d.getTime()-86400000);
 }
 return dates.reverse();
}
const DAYS=weekdays();
const asAt=(market,date)=>Date.parse(date+(market==='US'?'T12:00:00-05:00':'T12:00:00+09:00'));
function series(market,rate,volumeLast=170){
 const times=DAYS.map(d=>Math.floor(asAt(market,d)/1000));
 const bars=DAYS.map((d,i)=>100+i*rate);
 const volume=DAYS.map((d,i)=>i===DAYS.length-1?volumeLast:100);
 return {times,bars,volume};
}
function obs(market,source='Y',date='2026-11-20'){
 return {source,asOf:date,phase:'close',
  observedAt:Date.parse(date+(market==='US'?'T16:00:00-05:00':'T15:30:00+09:00')),
  receivedAt:NOW-60000};
}
function tech(s){
 return trading.analyze({
  mode:'swing',interval:'1d',capital:10000000,
  riskPct:1,maxAllocationPct:25,lotSize:1,
  bars:s.times.map((t,i)=>({
   t:t*1000,o:s.bars[i]-0.5,h:s.bars[i]+0.6,
   l:s.bars[i]-1.2,c:s.bars[i],
   volume:s.volume[i],turnover:s.volume[i]*200
  }))
 });
}
function fixture(market='US'){
 const bench=series(market,0.15), sec=series(market,0.45), stk=series(market,1.2,200);
 const source=obs(market);
 const sample=[1,2,3,4].map((i)=>({
  symbol:market==='US'?'STK'+i:String(100000+i),
  change:i===4?-1:i,relative:i===4?-2:i*0.8,
  asOf:source.asOf,observedAt:source.observedAt,source:'N'
 }));
 return {
  now:NOW,market,mode:'swing',
  benchmark:{symbol:market==='US'?'^GSPC':'^KS11',evidence:{...source},
   series:bench},
  marketBreadth:{universe:market==='US'?'US_LISTED':'KR_LISTED',
   expectedCount:1000,observedCount:800,advancers:600,evidence:obs(market,'N')},
  sectors:[{id:'tech',evidence:{...source},series:sec,
   expectedMembers:5,members:sample}],
  stocks:[{symbol:market==='US'?'SERV':'005930',sectorId:'tech',
   evidence:{...source},series:stk,technical:tech(stk)}]
 };
}
const run=(x=fixture())=>adapter.prepare(x,libs);

test('reuses real existing SectorInsights and WorkTradingStrategy output, not alternate formulas',()=>{
 assert.equal(typeof libs.insights.metrics,'function');
 assert.equal(typeof libs.insights.sampleBreadth,'function');
 assert.equal(trading.analyze({mode:'swing',interval:'1d',capital:1,bars:[]}).status,'insufficient');
 const x=run();
 assert.equal(x.status,'coherent-input');
 assert.equal(x.context.marketContext.posture,'supportive');
 assert.equal(x.context.sectorContexts[0].posture,'strong');
 assert.equal(x.context.candidates[0].posture,'aligned-watch');
 assert.equal(x.context.candidates[0].symbol,'SERV');
 assert.equal(x.marketSources.benchmark,'Y');
 assert.equal(x.marketSources.breadth,'N');
 assert.equal(x.context.candidates[0].hypotheticalPolicyRiskCeilingPct,1.5);
});
test('Korean market and six-digit stock symbols follow matching day/currency context',()=>{
 const x=run(fixture('KR'));
 assert.equal(x.status,'coherent-input');
 assert.equal(x.context.market,'KR');
 assert.equal(x.context.candidates[0].symbol,'005930');
 assert.equal(x.context.marketContext.breadthPct,75);
});
test('market benchmark return calculations reuse existing index metrics',()=>{
 const x=fixture();
 const metrics=libs.insights.metrics(x.benchmark.series,x.benchmark.series);
 const r=run(x);
 assert.equal(r.context.marketContext.status,'coherent');
 assert.equal(r.context.asOf,'2026-11-20');
 assert.equal(metrics.windows[5].change>0,true);
 assert.equal(metrics.windows[20].change>0,true);
 assert.equal(r.context.marketContext.posture,'supportive');
});
test('sector relative metrics and breadth use existing modules and cannot become full market ranks',()=>{
 const x=fixture(),v=run(x);
 const expectedMetrics=libs.insights.metrics(x.sectors[0].series,x.benchmark.series);
 const breadth=libs.insights.sampleBreadth(
  x.sectors[0].members.map(m=>({symbol:m.symbol,change:m.change,relative:m.relative})),5
 );
 assert.equal(v.context.sectorContexts[0].relative5Pct,expectedMetrics.windows[5].relative);
 assert.equal(v.context.sectorContexts[0].relative20Pct,expectedMetrics.windows[20].relative);
 assert.equal(v.context.sectorContexts[0].breadthPct,breadth.breadth);
 assert.equal(v.context.sectorContexts[0].coveragePct,80);
 assert.equal(v.context.methodology.rankingAllowed,false);
});
test('stock MA20 computed only from same-series 20 observed closes, not from current index',()=>{
 const x=fixture();
 const r=run(x),values=x.stocks[0].series.bars.slice(-20);
 const ma=values.reduce((a,b)=>a+b,0)/20;
 assert.equal(r.context.candidates[0].stockPosture,'strong');
 assert.ok(values.at(-1)>ma);
 assert.ok(r.context.candidates[0].verifiedMarketPrice===false);
});
test('adapter never claims provider authenticity, market open, or order authorization',()=>{
 const x=run();
 assert.equal(x.dataVerified,false);
 assert.equal(x.realTimeVerified,false);
 assert.equal(x.tradeApproved,false);
 assert.equal(x.canPlaceOrder,false);
 assert.equal(x.accountAccessed,false);
 assert.equal(x.providerCalls,0);
 assert.equal(x.context.marketDataVerified,false);
 assert.equal(x.context.tradingRecommendation,false);
 assert.equal(x.context.automaticOrders,false);
});
test('day mode is blocked because existing WorkTradingStrategy day bars are intraday',()=>{
 const x=fixture();x.mode='day';
 const r=run(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'DAY_INTRADAY_EVIDENCE_NOT_CONNECTED');
 assert.equal(r.comparison,null);
});
test('missing broad-market breadth does not fall back to sector constituent sample',()=>{
 const x=fixture();x.marketBreadth=null;
 assert.equal(run(x).code,'MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
});
test('sector sample declared as broad-market universe is explicitly refused',()=>{
 const x=fixture();x.marketBreadth.universe='US_TECH';
 assert.equal(run(x).code,'MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
});
test('invalid market breadth population counts or below 60% coverage are refused',()=>{
 for(const fields of [
  {observedCount:1001},{observedCount:500},{advancers:801},
  {observedCount:5},{expectedCount:10},{expectedCount:Infinity}
 ]){
  const x=fixture();Object.assign(x.marketBreadth,fields);
  assert.equal(run(x).code,'MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
 }
});
test('market breadth observation local day must agree with index close day',()=>{
 const x=fixture();x.marketBreadth.evidence.asOf='2026-11-19';
 assert.equal(run(x).code,'MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
});
test('empty or missing market-wide source identification cannot be treated as verified',()=>{
 for(const source of ['',null,'https://private.example/?token=1234']){
  const x=fixture();x.marketBreadth.evidence.source=source;
  assert.equal(run(x).code,'MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
  assert.equal(JSON.stringify(run(x)).includes('private.example'),false);
 }
});
test('market benchmark symbol must match local market, not some other index',()=>{
 const x=fixture();x.benchmark.symbol='^KS11';
 assert.equal(run(x).code,'BENCHMARK_EVIDENCE_INVALID');
});
test('index observation may not be missing, future or older than 96 hours',()=>{
 for(const v of [null,NOW+360000,NOW-100*3600000]){
  const x=fixture();x.benchmark.evidence.observedAt=v;
  assert.equal(run(x).code,'BENCHMARK_EVIDENCE_INVALID');
 }
});
test('recent local receipt is necessary and not equivalent to a recent source observation',()=>{
 const x=fixture();x.benchmark.evidence.receivedAt=NOW-31*60000;
 assert.equal(run(x).code,'BENCHMARK_EVIDENCE_INVALID');
 const y=fixture();y.benchmark.evidence.observedAt=NOW-97*3600000;
 assert.equal(run(y).code,'BENCHMARK_EVIDENCE_INVALID');
});
test('index series duplicate daily timestamps or future timestamp is forbidden',()=>{
 const x=fixture();x.benchmark.series.times[4]=x.benchmark.series.times[3];
 assert.equal(run(x).code,'BENCHMARK_DAILY_SERIES_INVALID');
 const y=fixture();y.benchmark.series.times.at(-1);
 y.benchmark.series.times[y.benchmark.series.times.length-1]=Math.floor((NOW+360000)/1000);
 assert.equal(run(y).code,'BENCHMARK_DAILY_SERIES_INVALID');
});
test('index close arrays must have at least 21 aligned daily bars',()=>{
 const x=fixture();for(const name of ['times','bars','volume'])
  x.benchmark.series[name]=x.benchmark.series[name].slice(-20);
 assert.equal(run(x).code,'BENCHMARK_DAILY_SERIES_INVALID');
});
test('index source with mismatched observation-local asOf is blocked',()=>{
 const x=fixture();x.benchmark.evidence.asOf='2026-11-21';
 assert.equal(run(x).code,'BENCHMARK_EVIDENCE_INVALID');
});
test('sector missing real source clock or missing membership provenance blocks',()=>{
 const x=fixture();x.sectors[0].evidence.observedAt=null;
 assert.equal(run(x).code,'SECTOR_SOURCE_OR_ID_INVALID');
 const y=fixture();y.sectors[0].members[1].observedAt=null;
 assert.equal(run(y).code,'SECTOR_MEMBER_EVIDENCE_INVALID');
});
test('same-date future sector member quote is rejected despite a matching date',()=>{
 const x=fixture();x.sectors[0].members[0].observedAt=NOW+360000;
 assert.equal(run(x).code,'SECTOR_MEMBER_EVIDENCE_INVALID');
});
test('sector member quote cannot occur after its source receipt',()=>{
 const x=fixture();
 x.sectors[0].evidence.receivedAt=NOW-25*60000;
 x.sectors[0].members[0].observedAt=NOW-15*60000;
 assert.equal(run(x).code,'SECTOR_MEMBER_EVIDENCE_INVALID');
});
test('extra secret fields in a technical output are rejected without being echoed',()=>{
 const x=fixture();x.stocks[0].technical.token='PRIVATE_TECH_TOKEN';
 const y=run(x);
 assert.equal(y.code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
 assert.equal(JSON.stringify(y).includes('PRIVATE_TECH_TOKEN'),false);
});
test('sector members from wrong trading date cannot be used as breadth',()=>{
 const x=fixture();x.sectors[0].members[1].asOf='2026-11-19';
 assert.equal(run(x).code,'SECTOR_MEMBER_EVIDENCE_INVALID');
});
test('sector component sample below expected 60 percent coverage blocked',()=>{
 const x=fixture();x.sectors[0].expectedMembers=10;
 assert.equal(run(x).code,'SECTOR_SAMPLE_INSUFFICIENT');
});
test('incomplete member relative returns cannot be replaced with zeros',()=>{
 const x=fixture();x.sectors[0].members[0].relative=null;
 assert.equal(run(x).code,'SECTOR_MEMBER_EVIDENCE_INVALID');
});
test('source member duplicates do not make a larger eligible sample',()=>{
 const x=fixture();
 for(let i=1;i<4;i++)x.sectors[0].members[i].symbol=x.sectors[0].members[0].symbol;
 assert.equal(run(x).code,'SECTOR_SAMPLE_INSUFFICIENT');
});
test('sector close dates must match 21 reference daily dates, not just final close',()=>{
 const x=fixture();const series=x.sectors[0].series;
 series.times[series.times.length-11]+=86400;
 assert.equal(run(x).code,'SECTOR_SOURCE_OR_ID_INVALID');
});
test('stock missing sector reference is blocked without inventing a leader',()=>{
 const x=fixture();x.stocks[0].sectorId='other';
 assert.equal(run(x).code,'STOCK_SOURCE_OR_ID_INVALID');
});
test('stock technical mode must correspond to confirmed daily swing timeframe',()=>{
 const x=fixture();x.stocks[0].technical.mode='day';
 assert.equal(run(x).code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
});
test('stock technical snapshot must be the same final chart bar, no look-ahead',()=>{
 const x=fixture();x.stocks[0].technical.asOf+=86400000;
 assert.equal(run(x).code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
});
test('stock momentum cannot disagree with SectorInsights five-day close change',()=>{
 const x=fixture();x.stocks[0].technical.momentumPct+=2;
 assert.equal(run(x).code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
});
test('stock volume ratio cannot conflict with source close volume samples',()=>{
 const x=fixture();x.stocks[0].technical.volumeRatio+=1.2;
 assert.equal(run(x).code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
});
test('stock turnover ratio absent cannot be silently assumed zero',()=>{
 const x=fixture();x.stocks[0].technical.turnoverRatio=null;
 assert.equal(run(x).code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
});
test('non-up swing technical analysis is not promoted to confirmed leadership',()=>{
 const x=fixture();x.stocks[0].technical.trend='down';
 assert.equal(run(x).code,'STOCK_TREND_NOT_UP');
});
test('source member data present but industry group close volume missing fails',()=>{
 const x=fixture();x.sectors[0].series.volume.pop();
 assert.equal(run(x).code,'SECTOR_SOURCE_OR_ID_INVALID');
});
test('input cannot contain account number or private metadata even if other fields valid',()=>{
 const x=fixture();x.brokerAccount='PRIVATE_ACC_12345';
 const y=run(x);
 assert.equal(y.code,'INVALID_OR_PRIVATE_INPUT');
 assert.equal(JSON.stringify(y).includes('PRIVATE_ACC_12345'),false);
});
test('unexpected extra source metadata carrying a token fails closed',()=>{
 const x=fixture();x.sectors[0].members[0].token='PRIVATE_TOKEN_123';
 const y=run(x);
 assert.equal(y.code,'SECTOR_MEMBER_EVIDENCE_INVALID');
 assert.equal(JSON.stringify(y).includes('PRIVATE_TOKEN_123'),false);
});
test('unknown stock property containing account holdings cannot be leaked',()=>{
 const x=fixture();x.stocks[0].holdings=[{balance:100000}];
 const y=run(x);
 assert.equal(y.code,'STOCK_SOURCE_OR_ID_INVALID');
 assert.equal(JSON.stringify(y).includes('100000'),false);
});
test('invalid stock price bar or non-monotonic day cannot be interpreted as real',()=>{
 const x=fixture();x.stocks[0].series.bars[9]=0;
 assert.equal(run(x).code,'STOCK_SOURCE_OR_ID_INVALID');
 const y=fixture();y.stocks[0].series.times[9]=y.stocks[0].series.times[8];
 assert.equal(run(y).code,'STOCK_SOURCE_OR_ID_INVALID');
});
test('strict series field list protects from accepting an account response structure',()=>{
 const x=fixture();x.benchmark.series.accountNumber='PRIVATE_BALANCE';
 const y=run(x);
 assert.equal(y.code,'BENCHMARK_DAILY_SERIES_INVALID');
 assert.equal(JSON.stringify(y).includes('PRIVATE_BALANCE'),false);
});
test('multiple market sector stock inputs are bounded for browser safety',()=>{
 const x=fixture();
 x.stocks=Array.from({length:61},(_,i)=>({...x.stocks[0],symbol:'STK'+i}));
 assert.equal(run(x).code,'INVALID_OR_PRIVATE_INPUT');
 const y=fixture();
 y.sectors=Array.from({length:26},(_,i)=>({...y.sectors[0],id:'SEC'+i}));
 assert.equal(run(y).code,'INVALID_OR_PRIVATE_INPUT');
});
test('without injected existing analysis dependencies the adapter fails closed',()=>{
 const x=fixture();
 assert.equal(adapter.prepare(x,{alignment:align}).code,'MISSING_EXISTING_ANALYSIS_DEPENDENCY');
 assert.equal(adapter.prepare(x,{insights:libs.insights}).code,'MISSING_EXISTING_ANALYSIS_DEPENDENCY');
});
test('same exact input is deterministic, no mutation, no storage and no order functions',()=>{
 const x=fixture(),before=JSON.stringify(x);
 const a=run(x),b=run(x);
 assert.equal(JSON.stringify(x),before);
 assert.deepEqual(a,b);
 const src=fs.readFileSync(path.join(__dirname,'../js/market-sector-stock-adapter-v1.js'),'utf8');
 for(const s of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService', 'NH_ACCOUNT', 'placeOrder(', 'executeOrder(']){
  assert.equal(src.includes(s),false,s);
 }
});
