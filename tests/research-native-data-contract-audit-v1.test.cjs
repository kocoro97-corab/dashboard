'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const audit=require('../js/research-native-data-contract-audit-v1.js');
const ROOT=path.join(__dirname,'..');
const load=path=>fs.readFileSync(path,'utf8');
const sandbox={window:{},console,Date,Intl};
for(const file of ['js/home-market-policy.js','js/industry-data.js','js/sector-insights.js'])
 vm.runInNewContext(load(path.join(ROOT,file)),sandbox,{timeout:3000});
const Home=sandbox.window.HomeMarketPolicy;
const Industry=sandbox.window.IndustryData;
const Sector=sandbox.window.SectorInsights;
const NOW=Date.parse('2026-11-22T09:45:00+09:00');
const clone=x=>JSON.parse(JSON.stringify(x));
const dateTimes=(market)=>{
 const days=[];let d=Date.parse('2026-11-20T12:00:00Z');
 while(days.length<60){
  const v=new Date(d);if(v.getUTCDay()!==0&&v.getUTCDay()!==6)days.push(v.toISOString().slice(0,10));
  d-=86400000;
 }
 return days.reverse().map(day=>Date.parse(day+
  (market==='KR'?'T15:30:00+09:00':'T16:00:00-05:00')));
};
function sectorHistory(market='US',benchmarkSymbol=market==='US'?'SPY':'^KS11'){
 const ms=dateTimes(market),times=ms.map(x=>x/1000),bars=times.map((_,i)=>100+i);
 const vol=times.map((_,i)=>100+i);
 const benchmarkSeries={times,bars,volume:vol,currency:market==='US'?'USD':'KRW',
  exchange:market==='US'?'PCX':'KSC',instrumentType:market==='US'?'ETF':'INDEX',
  last:ms.at(-1)};
 assert.ok(Sector.metrics(benchmarkSeries,benchmarkSeries).windows[20]);
 return {category:'industry',benchmarkSeries,rows:[],
  benchmark:2,benchmarkSymbol,received:NOW-60000,period:'20d',
  market,failures:[],themes:[],asof:ms.at(-1)};
}
function stockAnalysis(market='US'){
 const ms=dateTimes(market),bars=ms.map((t,i)=>({
  t,o:100+i,h:102+i,l:99+i,c:101+i,v:200+i
 }));
 const tail=bars.at(-1),prior=bars.at(-2);
 return {symbol:market==='US'?'SERV':'005930',
  provider:market==='US'?'SERV':'005930.KS',
  currency:market==='US'?'USD':'KRW',
  exchange:market==='US'?'NMS':'KSC',
  bars,metrics:{
   last:tail.c,change:(tail.c/prior.c-1)*100,
   ma5:158,ma20:149,ma60:130,rsi:63,high20:160,low20:120,
   volumeRatio:1.3,trend:'상승 추세 관찰'
  },source:market==='US'?'Yahoo Finance (SERV)':'Yahoo Finance (005930.KS)',
  observedAt:ms.at(-1),receivedAt:NOW-60000};
}
function homeQuote(market='US'){
 const id=market==='US'?'^GSPC':'^KS11';
 const quotes={[id]:{p:6100,prev:6080,observedAt:NOW-3600000}};
 const sources={[id]:'Y'},receipt={[id]:NOW-30000};
 return Home.quote(id,quotes,sources,receipt,NOW);
}
function industryRead(){
 const src='https://m.stock.naver.com/api/stocks/industry';
 const groups=Industry.groups({groups:[{no:10,name:'기술',totalCount:3,riseCount:2,
  fallCount:1,steadyCount:0,changeRate:'1.3'}]});
 const raw=[
  {itemCode:'005930',stockName:'삼성전자',stockExchangeType:{nameEng:'KOSPI'},
   localTradedAt:'2026-11-20T15:30:00+09:00',
   closePriceRaw:'10000',fluctuationsRatio:'1.1',
   accumulatedTradingValueRaw:'111000',accumulatedTradingVolumeRaw:'100'},
  {itemCode:'000660',stockName:'하이닉스',stockExchangeType:{nameEng:'KOSPI'},
   localTradedAt:'2026-11-20T15:30:00+09:00',
   closePriceRaw:'20000',fluctuationsRatio:'-0.5',
   accumulatedTradingValueRaw:'150000',accumulatedTradingVolumeRaw:'90'}
 ];
 const members=Industry.members({groupInfo:{no:10},stocks:raw},'10');
 return {groups:{rows:groups,total:1,receivedAt:NOW-60000,source:src+'?page=1&pageSize=100'},
 members:{rows:members,total:3,receivedAt:NOW-60000,
  source:src+'/10?page=1&pageSize=100'}};
}
function fixture(market='US'){
 return {market,mode:'swing',now:NOW,
  homeQuote:homeQuote(market),
  sectorPage:sectorHistory(market),
  industryRead:market==='KR'?industryRead():null,
  stockAnalysis:stockAnalysis(market)};
}
const run=(x=fixture())=>audit.audit(x);
const layer=(x,n)=>x.layers.find(l=>l.name===n);
const codes=x=>x.needs.map(n=>n.code);
test('the currently implemented HomeMarketPolicy.quote contract is parsed without copying prices or source strings',()=>{
 const h=homeQuote();
 assert.equal(h.valid,true);assert.equal(h.id,'^GSPC');
 assert.equal(h.source,'Yahoo');assert.equal(h.timely,true);
 const r=run();assert.equal(layer(r,'home').status,'structure-present');
 assert.equal(JSON.stringify(r).includes('6100'),false);
 assert.equal(JSON.stringify(r).includes('6080'),false);
 assert.ok(codes(r).includes('HOME_NOT_HISTORY'));
});
test('US industry SPY proxy is explicitly incompatible with required ^GSPC benchmark',()=>{
 const r=run();assert.equal(r.status,'review-required');
 assert.equal(layer(r,'sector').status,'blocked');
 assert.ok(codes(r).includes('US_SPY_PROXY'));
 assert.ok(codes(r).includes('US_SECTOR_ETF_NOT_INDUSTRY'));
 assert.ok(codes(r).includes('US_THEME_NOT_EXCHANGE'));
 assert.equal(r.originalInterfaces.exchangeCloseVerified,false);
 assert.equal(r.fullReportEligible,false);
 assert.equal(r.canUseAsLiveMarketData,false);
});
test('US ^GSPC daily series has structurally matchable bars but never certifies close or market breadth',()=>{
 const x=fixture();x.sectorPage=sectorHistory('US','^GSPC');
 const r=run(x);
 assert.equal(layer(r,'sector').status,'structure-present');
 assert.ok(!codes(r).includes('US_SPY_PROXY'));
 assert.ok(codes(r).includes('SECTOR_CLOSE_UNVERIFIED'));
 assert.ok(codes(r).includes('MARKET_BREADTH_NOT_EXPORTED'));
 assert.equal(r.fullReportEligible,false);
});
test('KR industry read reuses actual IndustryData.groups/member transforms and preserves the 2-of-3 sample limit',()=>{
 const i=industryRead();
 assert.equal(i.groups.rows[0].breadth,2/3*100);
 assert.equal(i.members.rows.length,2);
 assert.equal(i.members.rows[0].code,'005930');
 assert.equal(i.members.rows[0].observedAt,'2026-11-20T15:30:00+09:00');
 const r=run(fixture('KR'));
 assert.equal(layer(r,'sector').status,'structure-present');
 assert.equal(layer(r,'industry').status,'partial-structure');
 assert.ok(codes(r).includes('KR_INDUSTRY_PARTIAL'));
 assert.ok(codes(r).includes('KR_INDUSTRY_NOT_WHOLE_MARKET'));
 assert.equal(r.fullReportEligible,false);
});
test('the model never mislabels KR industry breadth as exchange-wide breadth',()=>{
 const r=run(fixture('KR'));
 assert.equal(layer(r,'breadth').status,'unavailable');
 assert.ok(codes(r).includes('MARKET_BREADTH_NOT_EXPORTED'));
 assert.equal(r.originalInterfaces.marketWideBreadthExported,false);
});
test('missing private analytics Map is reported as not exported; DOM scraping is unnecessary',()=>{
 const x=fixture();x.sectorPage=null;const r=run(x);
 assert.equal(layer(r,'sector').status,'not-exported');
 assert.ok(codes(r).includes('SECTOR_PRIVATE_MAP'));
 assert.equal(r.originalInterfaces.sectorMapReadOnlyExported,false);
});
test('home quote alone cannot satisfy market 20-day return and advance/decline requirements',()=>{
 const x=fixture();x.sectorPage=null;x.industryRead=null;x.stockAnalysis=null;
 const r=run(x);assert.equal(layer(r,'home').status,'structure-present');
 assert.equal(layer(r,'stock').status,'absent');
 assert.ok(codes(r).includes('STOCK_MISSING'));
 assert.ok(codes(r).includes('HOME_NOT_HISTORY'));
});
test('missing or mismatched home symbol is blocked, never automatically substituted',()=>{
 const x=fixture();x.homeQuote={id:'^KS11',valid:true,price:3000};
 const r=run(x);assert.equal(layer(r,'home').status,'blocked');
 assert.ok(codes(r).includes('HOME_MISSING'));
});
test('home source without observedAt is stale despite a fresh transport receipt',()=>{
 const x=fixture();const id='^GSPC';
 x.homeQuote=Home.quote(id,{[id]:{p:6000,prev:5900}},
  {[id]:'Y'},{[id]:NOW-3000},NOW);
 assert.equal(x.homeQuote.timely,true);
 const r=run(x);assert.equal(layer(r,'home').status,'blocked');
 assert.ok(codes(r).includes('HOME_STALE'));
});
test('old home receipt cannot be promoted by a fresh market price',()=>{
 const x=fixture();x.homeQuote.receivedAt=NOW-60*60000;
 const r=run(x);assert.ok(codes(r).includes('HOME_STALE'));
});
test('the actual US sector benchmark currency proxy mismatch can never be silently re-labeled',()=>{
 const x=fixture('US');x.sectorPage.benchmarkSymbol='^KS11';
 assert.ok(codes(run(x)).includes('SECTOR_BENCHMARK_ID'));
});
test('sector benchmark with fewer than 21 bars is incomplete',()=>{
 const x=fixture();x.sectorPage.benchmarkSeries.times=x.sectorPage.benchmarkSeries.times.slice(-10);
 x.sectorPage.benchmarkSeries.bars=x.sectorPage.benchmarkSeries.bars.slice(-10);
 x.sectorPage.benchmarkSeries.volume=x.sectorPage.benchmarkSeries.volume.slice(-10);
 x.sectorPage.benchmarkSeries.last=x.sectorPage.benchmarkSeries.times.at(-1)*1000;
 assert.ok(codes(run(x)).includes('SECTOR_SERIES_MISSING'));
});
test('sector duplicate daily dates or irregular arrays reject structural eligibility',()=>{
 const x=fixture();x.sectorPage.benchmarkSeries.times[20]=x.sectorPage.benchmarkSeries.times[19];
 assert.ok(codes(run(x)).includes('SECTOR_SERIES_INVALID'));
 const y=fixture();y.sectorPage.benchmarkSeries.volume.pop();
 assert.ok(codes(run(y)).includes('SECTOR_SERIES_MISSING'));
});
test('future quote timestamps are not accepted as current observations',()=>{
 const x=fixture();x.sectorPage.received=NOW+600000;
 assert.ok(codes(run(x)).includes('SECTOR_RECEIPT_STALE'));
 const y=fixture();y.stockAnalysis.observedAt=NOW+3600000;
 assert.ok(codes(run(y)).includes('STOCK_STALE'));
});
test('existing page-stocks native OHLCV format is structurally recognized but not equivalent to standalone trading-engine output',()=>{
 const r=run();assert.equal(layer(r,'stock').status,'structure-present');
 assert.ok(codes(r).includes('STOCK_TECH_NOT_EQUIVALENT'));
 assert.ok(codes(r).includes('STOCK_TURNOVER_NOT_EXPORTED'));
 assert.ok(codes(r).includes('STOCK_CLOSE_UNVERIFIED'));
 assert.equal(r.originalInterfaces.technicalContractEquivalent,false);
});
test('KR exact 6-digit symbol, .KS provider and KRW currency are preserved without exchange conversion',()=>{
 const x=fixture('KR');const r=run(x);
 assert.equal(layer(r,'stock').status,'structure-present');
 assert.equal(r.market,'KR');
 assert.equal(r.canUseAsLiveMarketData,false);
});
test('bad stock symbol, currency, provider or extra secret field fail closed',()=>{
 for(const change of [
  x=>x.stockAnalysis.currency='KRW',
  x=>x.stockAnalysis.symbol='@@@',
  x=>x.stockAnalysis.provider='NOT-SERV',
  x=>x.stockAnalysis.apiKey='SECRET_TOKEN_717'
 ]){
  const x=fixture();change(x);const r=run(x);
  assert.equal(layer(r,'stock').status,'blocked');
  assert.ok(codes(r).includes('STOCK_IDENTITY'));
  assert.equal(JSON.stringify(r).includes('SECRET_TOKEN_717'),false);
 }
});
test('stock invalid OHLC or broken bar chronology stops native shape qualification',()=>{
 const x=fixture();x.stockAnalysis.bars[31].h=0;
 const r=run(x);assert.ok(codes(r).includes('STOCK_BARS'));
 const y=fixture();y.stockAnalysis.bars[32].t=y.stockAnalysis.bars[31].t;
 assert.ok(codes(run(y)).includes('STOCK_BARS'));
});
test('stock stale receipt or close observation is identified even if last price was valid',()=>{
 const x=fixture();x.stockAnalysis.receivedAt=NOW-86400000;
 const r=run(x);assert.ok(codes(r).includes('STOCK_STALE'));
});
test('stock fewer than 21 bars is insufficient for basic MA20, let alone 60-day swing context',()=>{
 const x=fixture();x.stockAnalysis.bars=x.stockAnalysis.bars.slice(-20);
 const r=run(x);assert.ok(codes(r).includes('STOCK_BARS'));
});
test('partial Naver member missing localTradedAt is not inferred from receivedAt',()=>{
 const x=fixture('KR');x.industryRead.members.rows[0].observedAt=null;
 assert.ok(codes(run(x)).includes('KR_INDUSTRY_OBS_MISSING'));
});
test('same symbol repeated in industry member response blocks member identity',()=>{
 const x=fixture('KR');x.industryRead.members.rows[1].code='005930';
 assert.ok(codes(run(x)).includes('KR_INDUSTRY_MISSING'));
});
test('nonrepresentative KR group with unknown total cannot claim whole-industry member coverage',()=>{
 const x=fixture('KR');x.industryRead.members.total=null;
 assert.ok(codes(run(x)).includes('KR_INDUSTRY_COVERAGE_UNKNOWN'));
});
test('US ignores KR IndustryData even if supplied; it remains an ETF proxy only',()=>{
 const x=fixture('US');x.industryRead=industryRead();
 const r=run(x);assert.equal(layer(r,'industry').status,'proxy-only');
 assert.ok(codes(r).includes('US_SECTOR_ETF_NOT_INDUSTRY'));
 assert.equal(r.fullReportEligible,false);
});
test('day trading mode adds intraday evidence block; it never upgrades daily bars',()=>{
 const x=fixture();x.mode='day';const r=run(x);
 assert.ok(codes(r).includes('DAY_INTRADAY_MISSING'));
 assert.equal(layer(r,'intraday').status,'not-connected');
 assert.equal(r.ordersPlaced,0);
});
test('private extra root keys are blocked with no token echo',()=>{
 const x=fixture();x.accountSecret='TOP_SECRET_1133';
 const r=run(x);assert.equal(r.status,'blocked');
 assert.equal(r.code,'INVALID_INPUT');
 assert.equal(JSON.stringify(r).includes('TOP_SECRET_1133'),false);
});
test('raw account/holding data is not accepted as stock analysis',()=>{
 const x=fixture();x.stockAnalysis={accountId:'NO_LOG',holdings:[1]};
 const r=run(x);assert.equal(layer(r,'stock').status,'blocked');
 assert.equal(JSON.stringify(r).includes('NO_LOG'),false);
});
test('report gate never returns a fabricated ranking, probability, execution signal or closing attestation',()=>{
 const r=run();
 assert.equal(r.fullReportEligible,false);
 assert.equal(r.canUseAsLiveMarketData,false);
 assert.equal(r.providerCalls,0);
 assert.equal(r.ordersPlaced,0);
 assert.equal(r.accountAccessed,false);
 for(const n of ['winProbability','tradeSignal','verifiedClose','recommendedAllocation','orderQuantity'])
  assert.equal(JSON.stringify(r).includes('"'+n+'"'),false);
});
test('input is never mutated or written, reports are deterministic',()=>{
 const x=fixture(),before=JSON.stringify(x);
 const a=run(x),b=run(x);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(x),before);
 assert.ok(Object.isFrozen(a));assert.ok(Object.isFrozen(a.layers));
 assert.ok(Object.isFrozen(a.needs));
});
test('native page-sectors Map really is local and the page exports no read-only series snapshot',()=>{
 const source=load(path.join(ROOT,'js/page-sectors.js'));
 assert.match(source,/const SERIES_CACHE=new Map/);
 assert.match(source,/let ctxRef=.*analytics=new Map/);
 assert.match(source,/analytics\.set\(key,/);
 assert.equal(/root\.(?:SectorAnalytics|SectorSnapshot|ResearchDataExport)\s*=/.test(source),false);
});
test('core analyzer exports supported native fields, not WorkTradingStrategy official output',()=>{
 const stockSource=load(path.join(ROOT,'js/page-stocks.js'));
 assert.match(stockSource,/function publicAnalysis\(sym\)/);
 assert.match(stockSource,/metrics:calculate\(bars\)/);
 assert.match(stockSource,/root\.InvestWorkflow\?\.registerAnalyzer\(publicAnalysis\)/);
 assert.equal(/WorkTradingStrategy\.analyze/.test(stockSource),false);
});
test('module has no network, storage, NH, GAS or order methods',()=>{
 const src=load(path.join(ROOT,'js/research-native-data-contract-audit-v1.js'));
 for(const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage.',
  'sessionStorage.', 'PropertiesService','NH_ACCOUNT','placeOrder(',
  'executeOrder(', 'writeFile(', 'setInterval('])
  assert.equal(src.includes(forbidden),false,forbidden);
});
