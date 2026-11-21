/* MY INVEST V2 — isolated adapter for already-existing SectorInsights and
 * WorkTradingStrategy outputs. Research only; never fetch, save, trade or
 * assume that caller-declared metadata proves a provider/market close.
 */
(function(root){
'use strict';
const K=Object.freeze(['now','market','mode','benchmark','marketBreadth','sectors','stocks']);
const E=Object.freeze(['source','asOf','phase','observedAt','receivedAt']);
const S=Object.freeze(['times','bars','volume']);
const B=Object.freeze(['universe','expectedCount','observedCount','advancers','evidence']);
const LIMIT=Object.freeze({sectors:25,stocks:60,members:300,maxBars:300});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const num=x=>typeof x==='number'&&Number.isFinite(x);
const pos=x=>num(x)&&x>0;
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8640000000000000;
const strict=(x,keys)=>exact(x,keys);
const blocked=(code,details=[])=>Object.freeze({
 status:'blocked',code,details:Object.freeze(details.slice(0,20)),comparison:null,
 dataVerified:false,realTimeVerified:false,tradeApproved:false,
 canPlaceOrder:false,accountAccessed:false,providerCalls:0
});
function deps(){
 if(typeof module==='object'&&module.exports)
  return {alignment:require('./market-sector-stock-alignment-v1.js'),insights:root.SectorInsights};
 return {alignment:root.MYInvestMarketSectorStockAlignmentV1,insights:root.SectorInsights};
}
function prepare(input,libs){
 if(!strict(input,K)||!['KR','US'].includes(input.market)||
  !['day','swing'].includes(input.mode)||!time(input.now)||
  !Array.isArray(input.sectors)||input.sectors.length>LIMIT.sectors||
  !Array.isArray(input.stocks)||input.stocks.length>LIMIT.stocks)
  return blocked('INVALID_OR_PRIVATE_INPUT');
 // Day technicals require actual intraday bars. Daily sector/index closes alone
 // cannot substantiate 1m/5m/VWAP timing or a day-trade entry.
 if(input.mode==='day')return blocked('DAY_INTRADAY_EVIDENCE_NOT_CONNECTED');
 const {alignment,insights}=libs||deps();
 if(!alignment||typeof alignment.examine!=='function'||!insights||
  typeof insights.metrics!=='function'||typeof insights.sampleBreadth!=='function')
  return blocked('MISSING_EXISTING_ANALYSIS_DEPENDENCY');
 const day=alignment.localDay,market=input.market,mode=input.mode,now=input.now;
 function evidence(e,expected){
  if(!exact(e,E))return false;
  if(typeof e.source!=='string'||!/^[A-Z][A-Z0-9_-]{0,15}$/.test(e.source)||
   typeof e.asOf!=='string'||e.phase!=='close'||
   !time(e.observedAt)||!time(e.receivedAt))return false;
  if(day(e.observedAt,market)!==e.asOf||expected&&e.asOf!==expected||
   e.observedAt>now+300000||e.receivedAt>now+300000||
   now-e.observedAt>96*3600000||now-e.receivedAt>30*60000||
   e.observedAt>e.receivedAt+300000)return false;
  return true;
 }
 function series(s,e,referenceDates=null){
  if(!exact(s,S)||!Array.isArray(s.times)||!Array.isArray(s.bars)||
   !Array.isArray(s.volume)||s.times.length<21||
   s.times.length>LIMIT.maxBars||s.bars.length!==s.times.length||
   s.volume.length!==s.times.length)return null;
  const dates=[];let prev=0,lastDay=null;
  for(let i=0;i<s.times.length;i++){
   const t=s.times[i],at=t*1000;
   if(!Number.isSafeInteger(t)||t<=prev||!time(at)||
    at>now+300000||!pos(s.bars[i])||!num(s.volume[i])||s.volume[i]<0)return null;
   const date=day(at,market);
   // Existing SectorInsights aligns on UTC dates. If they differ from actual
   // local trading dates, block instead of silently joining wrong candles.
   if(new Date(at).toISOString().slice(0,10)!==date||lastDay===date)return null;
   lastDay=date;dates.push(date);prev=t;
  }
  if(dates.at(-1)!==e.asOf)return null;
  if(referenceDates){
   const tail=dates.slice(-21),ref=referenceDates.slice(-21);
   if(tail.length!==21||tail.some((d,i)=>d!==ref[i]))return null;
  }
  return dates;
 }
 function windowMetrics(metrics,e){
  if(!obj(metrics)||!obj(metrics.windows))return null;
  const w5=metrics.windows[5],w20=metrics.windows[20];
  if(!w5||!w20||!num(w5.change)||!num(w20.change)||
   !num(w5.relative)||!num(w20.relative)||!time(w5.asof)||
   !time(w20.asof)||day(w5.asof,market)!==e.asOf||
   day(w20.asof,market)!==e.asOf||
   !num(metrics.volumeChange))return null;
  const vol=1+metrics.volumeChange/100;
  if(!Number.isFinite(vol)||vol<0||vol>100)return null;
  return {w5,w20,volumeRatio:vol};
 }
 const bench=input.benchmark;
 if(!exact(bench,['symbol','evidence','series'])||
  bench.symbol!==(market==='KR'?'^KS11':'^GSPC')||
  !evidence(bench.evidence))return blocked('BENCHMARK_EVIDENCE_INVALID');
 const benchDates=series(bench.series,bench.evidence);
 if(!benchDates)return blocked('BENCHMARK_DAILY_SERIES_INVALID');
 const benchMetrics=windowMetrics(insights.metrics(bench.series,bench.series),bench.evidence);
 if(!benchMetrics||Math.abs(benchMetrics.w5.relative)>1e-9||
  Math.abs(benchMetrics.w20.relative)>1e-9)
  return blocked('BENCHMARK_METRICS_UNAVAILABLE');
 const breadth=input.marketBreadth;
 if(!exact(breadth,B)||breadth.universe!==(market==='KR'?'KR_LISTED':'US_LISTED')||
  !evidence(breadth.evidence,bench.evidence.asOf)||
  !Number.isSafeInteger(breadth.expectedCount)||
  !Number.isSafeInteger(breadth.observedCount)||
  !Number.isSafeInteger(breadth.advancers)||
  breadth.expectedCount<20||breadth.expectedCount>100000||
  breadth.observedCount<20||breadth.observedCount>breadth.expectedCount||
  breadth.advancers<0||breadth.advancers>breadth.observedCount||
  breadth.observedCount/breadth.expectedCount<0.6)
  return blocked('MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
 const stageMarket={
  ...bench.evidence,symbol:bench.symbol,
  return5Pct:benchMetrics.w5.change,return20Pct:benchMetrics.w20.change,
  expectedCount:breadth.expectedCount,observedCount:breadth.observedCount,
  advancers:breadth.advancers
 };
 const builtSectors=[],ids=new Set();
 for(let i=0;i<input.sectors.length;i++){
  const row=input.sectors[i];
  if(!exact(row,['id','evidence','series','expectedMembers','members'])||
   typeof row.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,27}$/.test(row.id)||
   ids.has(row.id)||!evidence(row.evidence,bench.evidence.asOf)||
   !series(row.series,row.evidence,benchDates)||
   !Number.isSafeInteger(row.expectedMembers)||row.expectedMembers<3||
   row.expectedMembers>100000||!Array.isArray(row.members)||
   row.members.length>LIMIT.members)
   return blocked('SECTOR_SOURCE_OR_ID_INVALID',[{index:i}]);
  ids.add(row.id);
  const members=[];
  for(const member of row.members){
   if(!strict(member,['symbol','change','relative','asOf','observedAt','source'])||
    typeof member.symbol!=='string'||!(market==='KR'?
     /^[0-9]{6}$/.test(member.symbol):/^[A-Z][A-Z0-9.-]{0,12}$/.test(member.symbol))||
    !num(member.change)||!num(member.relative)||
    !time(member.observedAt)||day(member.observedAt,market)!==bench.evidence.asOf||
    member.asOf!==bench.evidence.asOf||typeof member.source!=='string'||
    !/^[A-Z][A-Z0-9_-]{0,15}$/.test(member.source))
    return blocked('SECTOR_MEMBER_EVIDENCE_INVALID',[{index:i}]);
   members.push({symbol:member.symbol,change:member.change,relative:member.relative});
  }
  const sample=insights.sampleBreadth(members,row.expectedMembers);
  if(sample.coverage===null||sample.coverage<0.6||sample.observed<3||
   sample.observed>sample.expected||sample.up>sample.observed)
   return blocked('SECTOR_SAMPLE_INSUFFICIENT',[{index:i}]);
  const m=windowMetrics(insights.metrics(row.series,bench.series),row.evidence);
  if(!m)return blocked('SECTOR_METRICS_UNAVAILABLE',[{index:i}]);
  builtSectors.push({...row.evidence,id:row.id,relative5Pct:m.w5.relative,
   relative20Pct:m.w20.relative,volumeRatio:m.volumeRatio,
   expectedCount:sample.expected,observedCount:sample.observed,advancers:sample.up});
 }
 const builtStocks=[],symbols=new Set();
 for(let i=0;i<input.stocks.length;i++){
  const row=input.stocks[i];
  if(!exact(row,['symbol','sectorId','evidence','series','technical'])||
   typeof row.symbol!=='string'||!(market==='KR'?
    /^[0-9]{6}$/.test(row.symbol):/^[A-Z][A-Z0-9.-]{0,12}$/.test(row.symbol))||
   symbols.has(row.symbol)||!ids.has(row.sectorId)||
   !evidence(row.evidence,bench.evidence.asOf)||
   !series(row.series,row.evidence,benchDates))
   return blocked('STOCK_SOURCE_OR_ID_INVALID',[{index:i}]);
  symbols.add(row.symbol);
  const m=windowMetrics(insights.metrics(row.series,bench.series),row.evidence);
  const tech=row.technical;
  if(!m||!obj(tech)||tech.status!=='ok'||tech.mode!=='swing'||
   !time(tech.asOf)||tech.asOf!==row.series.times.at(-1)*1000||
   !num(tech.momentumPct)||!num(tech.volumeRatio)||
   !num(tech.turnoverRatio)||tech.volumeRatio<0||tech.turnoverRatio<0||
   Math.abs(tech.momentumPct-m.w5.change)>0.051||
   Math.abs(tech.volumeRatio-m.volumeRatio)>0.015||
   !['up','down','mixed'].includes(tech.trend))
   return blocked('STOCK_TECHNICAL_SNAPSHOT_MISMATCH',[{index:i}]);
  // A daily confirmed-close context cannot promote an ambiguous/down technical
  // trend to a leader. Caller can still inspect it on its existing strategy page.
  if(tech.trend!=='up')return blocked('STOCK_TREND_NOT_UP',[{index:i}]);
  const last20=row.series.bars.slice(-20),average=last20.reduce((a,b)=>a+b,0)/20;
  const close=row.series.bars.at(-1),priceVsMa20Pct=(close/average-1)*100;
  if(!Number.isFinite(priceVsMa20Pct))
   return blocked('STOCK_MA20_INVALID',[{index:i}]);
  builtStocks.push({...row.evidence,symbol:row.symbol,sectorId:row.sectorId,
   return5Pct:m.w5.change,relative5Pct:m.w5.relative,relative20Pct:m.w20.relative,
   priceVsMa20Pct,volumeRatio:tech.volumeRatio,turnoverRatio:tech.turnoverRatio});
 }
 const result=alignment.examine({
  now,market,mode,marketSnapshot:stageMarket,sectors:builtSectors,candidates:builtStocks
 });
 if(result.status==='invalid'||result.status==='blocked')
  return blocked('ALIGNMENT_EVIDENCE_REJECTED');
 return Object.freeze({
  status:result.status,context:result,
  mapping:Object.freeze({
   market:'SectorInsights.metrics(benchmark,benchmark) + independently sourced breadth',
   sectors:'SectorInsights.metrics(sector,benchmark) + SectorInsights.sampleBreadth',
   stocks:'SectorInsights.metrics(stock,benchmark) + WorkTradingStrategy.analyze precomputed result',
   movingAverage:'20 equally-date-aligned observed daily closes',
   blockedDayTrading:'day requires separately validated intraday bars'
  }),
  marketSources:Object.freeze({
   benchmark:bench.evidence.source,breadth:breadth.evidence.source
  }),
  observationsComparableNotAuthenticated:true,
  dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,
  providerCalls:0
 });
}
const api=Object.freeze({prepare,LIMIT});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestMarketSectorStockAdapterV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
