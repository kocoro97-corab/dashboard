/* MY INVEST V2 — isolated cross-layer evidence alignment v1.
 * Deterministic, read-only research classification from caller-supplied,
 * same-session market/sector/stock close observations. No quote, account,
 * orders, API, storage, ranking or live execution advice.
 */
(function(root){
'use strict';
const ZONES=Object.freeze({KR:'Asia/Seoul',US:'America/New_York'});
const BENCHMARKS=Object.freeze({KR:'^KS11',US:'^GSPC'});
const RISK_MODES=Object.freeze({day:1,swing:1.5});
const LIMITS=Object.freeze({sectors:25,stocks:60,ageMs:96*3600000,receiptMs:30*60000,graceMs:5*60000});
const BASE=Object.freeze(['source','asOf','phase','observedAt','receivedAt']);
const FIELDSET=Object.freeze({
 market:Object.freeze([...BASE,'symbol','return5Pct','return20Pct','expectedCount','observedCount','advancers']),
 sector:Object.freeze([...BASE,'id','relative5Pct','relative20Pct','volumeRatio','expectedCount','observedCount','advancers']),
 stock:Object.freeze([...BASE,'symbol','sectorId','return5Pct','relative5Pct','relative20Pct','priceVsMa20Pct','volumeRatio','turnoverRatio'])
});
const inputKeys=Object.freeze(['now','market','mode','marketSnapshot','sectors','candidates']);
const obj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const exact=(o,keys)=>obj(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const num=x=>typeof x==='number'&&Number.isFinite(x);
const inRange=(x,min,max)=>num(x)&&x>=min&&x<=max;
const posTime=t=>Number.isSafeInteger(t)&&t>0&&t<8640000000000000;
const isDate=s=>{
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const [year,month,day]=s.split('-').map(Number);
 if(year<2000||year>2100)return false;
 const test=new Date(Date.UTC(year,month-1,day));
 return !Number.isNaN(test.getTime())&&test.getUTCFullYear()===year&&
  test.getUTCMonth()===month-1&&test.getUTCDate()===day;
};
const validSource=s=>typeof s==='string'&&/^[A-Z][A-Z0-9_-]{0,15}$/.test(s);
const sectorId=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,27}$/.test(s);
const symbolId=(s,market)=>typeof s==='string'&&(market==='KR'?
 /^[0-9]{6}$/.test(s):/^[A-Z][A-Z0-9.-]{0,12}$/.test(s));
function localDay(t,market){
 if(!posTime(t)||!Object.hasOwn(ZONES,market))return null;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:ZONES[market],year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date(t)).map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function commonReasons(row,kind,market,now,expectedDay){
 const problems=[];
 if(!exact(row,FIELDSET[kind]))return ['INVALID_OR_PRIVATE_RECORD_FIELDS'];
 if(!validSource(row.source))problems.push('SOURCE_UNIDENTIFIED');
 if(!isDate(row.asOf))problems.push('INVALID_SESSION_DATE');
 if(row.phase!=='close')problems.push('CLOSE_PHASE_UNCONFIRMED');
 if(!posTime(row.observedAt))problems.push('OBSERVATION_TIME_MISSING');
 else{
  if(row.observedAt>now+LIMITS.graceMs)problems.push('FUTURE_OBSERVATION');
  if(now-row.observedAt>LIMITS.ageMs)problems.push('OBSERVATION_STALE');
  if(isDate(row.asOf)&&localDay(row.observedAt,market)!==row.asOf)
   problems.push('OBSERVATION_LOCAL_DAY_MISMATCH');
 }
 if(!posTime(row.receivedAt))problems.push('RECEIPT_TIME_MISSING');
 else{
  if(row.receivedAt>now+LIMITS.graceMs)problems.push('FUTURE_RECEIPT');
  if(now-row.receivedAt>LIMITS.receiptMs)problems.push('RECEIPT_STALE');
  if(posTime(row.observedAt)&&row.observedAt>row.receivedAt+LIMITS.graceMs)
   problems.push('OBSERVATION_AFTER_RECEIPT');
 }
 if(isDate(row.asOf)&&expectedDay!==null&&row.asOf!==expectedDay)
  problems.push('TRADE_DATE_MISMATCH');
 return problems;
}
function breadth(row,minimum){
 if(!Number.isInteger(row.expectedCount)||row.expectedCount<minimum||
  row.expectedCount>100000||!Number.isInteger(row.observedCount)||
  row.observedCount<minimum||row.observedCount>row.expectedCount||
  !Number.isInteger(row.advancers)||row.advancers<0||
  row.advancers>row.observedCount)
  return {ok:false,coveragePct:null,breadthPct:null};
 const coveragePct=100*row.observedCount/row.expectedCount;
 const breadthPct=100*row.advancers/row.observedCount;
 return {ok:coveragePct>=60,coveragePct,breadthPct};
}
function marketEvidence(row,market,now){
 const issues=commonReasons(row,'market',market,now,null);
 let b={ok:false,coveragePct:null,breadthPct:null};
 if(exact(row,FIELDSET.market)){
  if(row.symbol!==BENCHMARKS[market])issues.push('BENCHMARK_IDENTITY_MISMATCH');
  if(!inRange(row.return5Pct,-99.99,500)||!inRange(row.return20Pct,-99.99,500))
   issues.push('MARKET_RETURN_INVALID');
  b=breadth(row,20);
  if(!b.ok)issues.push('MARKET_BREADTH_COVERAGE_INSUFFICIENT');
 }
 if(issues.length)return {status:'blocked',issues,asOf:null,phase:'unqualified',
  posture:'unavailable',coveragePct:b.coveragePct,breadthPct:b.breadthPct};
 const posture=row.return20Pct<=-3||b.breadthPct<40?'defensive':
  row.return20Pct>0&&row.return5Pct>0&&b.breadthPct>=55?'supportive':'mixed';
 return {status:'coherent',issues:[],asOf:row.asOf,phase:'caller-declared-close',
  posture,coveragePct:b.coveragePct,breadthPct:b.breadthPct};
}
function sectorEvidence(row,market,now,day){
 const issues=commonReasons(row,'sector',market,now,day);
 let b={ok:false,coveragePct:null,breadthPct:null};
 if(exact(row,FIELDSET.sector)){
  if(!sectorId(row.id))issues.push('SECTOR_ID_INVALID');
  if(!inRange(row.relative5Pct,-200,200)||!inRange(row.relative20Pct,-200,200))
   issues.push('SECTOR_RELATIVE_INVALID');
  if(!inRange(row.volumeRatio,0,100))issues.push('SECTOR_VOLUME_RATIO_INVALID');
  b=breadth(row,3);
  if(!b.ok)issues.push('SECTOR_BREADTH_COVERAGE_INSUFFICIENT');
 }
 if(issues.length)return {id:sectorId(row?.id)?row.id:null,status:'blocked',
  issues,posture:'unavailable',breadthPct:b.breadthPct,coveragePct:b.coveragePct};
 const posture=row.relative5Pct<0&&row.relative20Pct<0||b.breadthPct<40?'weak':
  row.relative5Pct>0&&row.relative20Pct>0&&b.breadthPct>=55&&row.volumeRatio>=1?
   'strong':'mixed';
 return {id:row.id,status:'coherent',issues:[],posture,
  breadthPct:b.breadthPct,coveragePct:b.coveragePct,
  relative5Pct:row.relative5Pct,relative20Pct:row.relative20Pct,
  volumeRatio:row.volumeRatio};
}
function stockEvidence(row,market,now,day){
 const issues=commonReasons(row,'stock',market,now,day);
 if(exact(row,FIELDSET.stock)){
  if(!symbolId(row.symbol,market))issues.push('STOCK_ID_INVALID');
  if(!sectorId(row.sectorId))issues.push('STOCK_SECTOR_ID_INVALID');
  if(!inRange(row.return5Pct,-99.99,1000)||
   !inRange(row.relative5Pct,-200,200)||
   !inRange(row.relative20Pct,-200,200)||
   !inRange(row.priceVsMa20Pct,-99.99,1000))
   issues.push('STOCK_MOMENTUM_INPUT_INVALID');
  if(!inRange(row.volumeRatio,0,100)||!inRange(row.turnoverRatio,0,100))
   issues.push('STOCK_ACTIVITY_INVALID');
 }
 if(issues.length)return {symbol:symbolId(row?.symbol,market)?row.symbol:null,
  sectorId:sectorId(row?.sectorId)?row.sectorId:null,
  status:'blocked',issues,posture:'unavailable'};
 const posture=row.return5Pct<0&&row.relative5Pct<0||row.priceVsMa20Pct<0?
  'weak':row.return5Pct>0&&row.relative5Pct>0&&row.relative20Pct>0&&
  row.priceVsMa20Pct>0&&row.volumeRatio>=1.2&&row.turnoverRatio>=1.1?
  'strong':'mixed';
 return {symbol:row.symbol,sectorId:row.sectorId,
  status:'coherent',issues:[],posture,
  return5Pct:row.return5Pct,relative5Pct:row.relative5Pct,
  relative20Pct:row.relative20Pct,volumeRatio:row.volumeRatio,
  turnoverRatio:row.turnoverRatio};
}
const riskFactor=Object.freeze({supportive:1,strong:1,mixed:0.75,
 defensive:0.5,weak:0.5});
function examine(input){
 if(!exact(input,inputKeys)||!Object.hasOwn(ZONES,input.market)||
  !Object.hasOwn(RISK_MODES,input.mode)||!posTime(input.now)||
  !Array.isArray(input.sectors)||input.sectors.length>LIMITS.sectors||
  !Array.isArray(input.candidates)||input.candidates.length>LIMITS.stocks)
  return Object.freeze({status:'invalid',code:'INVALID_OR_PRIVATE_INPUT',
   automaticOrders:false,realTimeVerified:false});
 const {market,mode,now}=input;
 const marketRow=marketEvidence(input.marketSnapshot,market,now);
 const sectorCounts=new Map();
 for(const value of input.sectors){
  if(obj(value)&&sectorId(value.id))
   sectorCounts.set(value.id,(sectorCounts.get(value.id)||0)+1);
 }
 const allSectors=[],sectorMap=new Map();
 for(const value of input.sectors){
  const row=sectorEvidence(value,market,now,marketRow.asOf);
  if(row.id!==null&&sectorCounts.get(row.id)>1){
   row.status='blocked';row.posture='unavailable';row.issues.push('DUPLICATE_SECTOR_ID');
  }
  const locked=Object.freeze({...row,issues:Object.freeze([...new Set(row.issues)])});
  allSectors.push(locked);
  if(locked.id)sectorMap.set(locked.id,locked);
 }
 const seenSymbols=new Set(),candidates=[];
 for(const value of input.candidates){
  const row=stockEvidence(value,market,now,marketRow.asOf);
  const issueSet=new Set(row.issues);
  if(row.symbol){
   if(seenSymbols.has(row.symbol))issueSet.add('DUPLICATE_STOCK_ID');
   seenSymbols.add(row.symbol);
  }
  if(marketRow.status!=='coherent')issueSet.add('MARKET_EVIDENCE_BLOCKED');
  const sec=row.sectorId?sectorMap.get(row.sectorId):null;
  if(!sec)issueSet.add('SECTOR_NOT_FOUND');
  else if(sec.status!=='coherent')issueSet.add('SECTOR_EVIDENCE_BLOCKED');
  const blocked=issueSet.size>0;
  const posture=blocked?'unavailable':
   [marketRow.posture,sec.posture,row.posture].includes('defensive')||
   [marketRow.posture,sec.posture,row.posture].includes('weak')?'defensive-watch':
   marketRow.posture==='supportive'&&sec.posture==='strong'&&row.posture==='strong'?
   'aligned-watch':'mixed-watch';
  const multiplier=blocked?null:Math.min(riskFactor[marketRow.posture],
   riskFactor[sec.posture],riskFactor[row.posture]);
  candidates.push(Object.freeze({
   symbol:row.symbol,sectorId:row.sectorId,status:blocked?'blocked':'coherent-input',
   posture,issues:Object.freeze([...issueSet]),
   marketPosture:marketRow.posture,sectorPosture:sec?.posture||'unavailable',
   stockPosture:row.posture,
   hypotheticalPolicyRiskCeilingPct:multiplier===null?null:
    Number((multiplier*RISK_MODES[mode]).toFixed(4)),
   riskMultiplierIllustration:multiplier,
   hypotheticalOnly:true,tradeSignal:null,verifiedMarketPrice:false
  }));
 }
 const blocked=candidates.filter(x=>x.status==='blocked').length;
 const status=marketRow.status!=='coherent'?'blocked':
  candidates.length===0||allSectors.length===0?'insufficient':
  blocked===candidates.length?'blocked':blocked>0?'partial':'coherent-input';
 return Object.freeze({
  status,market,mode,asOf:marketRow.asOf,
  benchmark:BENCHMARKS[market],
  marketContext:Object.freeze({...marketRow,issues:Object.freeze([...new Set(marketRow.issues)])}),
  sectorContexts:Object.freeze(allSectors),
  candidates:Object.freeze(candidates),
  coverage:Object.freeze({sectorsSupplied:allSectors.length,
   stocksSupplied:candidates.length,stockObservationsCoherent:candidates.length-blocked}),
  methodology:Object.freeze({
   baseRiskPct:RISK_MODES[mode],observationsMustShareLocalTradingDay:true,
   minimumCoveragePct:60,receiptAgeLimitMinutes:30,
   observationAgeLimitHours:96,riskCapMeaning:'ILLUSTRATIVE_POLICY_CEILING_NOT_A_RECOMMENDATION',
   rankingAllowed:false,stockEntryTimingVerified:false
  }),
  sourceAuthenticityVerified:false,exchangeHolidayVerified:false,
  phaseExternallyVerified:false,marketDataVerified:false,
  intradayDataVerified:false,tradingRecommendation:false,
  automaticOrders:false,accountsAccessed:false,providerCalls:0
 });
}
const api=Object.freeze({examine,localDay,LIMITS});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestMarketSectorStockAlignmentV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
