'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const report=require('../js/investment-research-report-v1.js');
const explain=require('../js/investment-evidence-explanation-v1.js');
const timeline=require('../js/investment-evidence-timeline-v1.js');
const alignment=require('../js/market-sector-stock-alignment-v1.js');
const NOW=Date.parse('2026-11-23T12:00:00+09:00');
const DATES=['2026-11-18','2026-11-19','2026-11-20'];
const clone=x=>JSON.parse(JSON.stringify(x));
function record(day,market='US',step=2,opts={}){
 const us=market==='US';
 const observedAt=Date.parse(day+(us?'T16:00:00-05:00':'T15:30:00+09:00'));
 const capturedAt=Date.parse(day+(us?'T17:05:00-05:00':'T16:05:00+09:00'));
 const e={source:'DEMO',asOf:day,phase:'close',observedAt,receivedAt:capturedAt-60000};
 const m=step===0?{r5:-1,r20:-5,adv:310}:step===1?
  {r5:0.5,r20:0,adv:490}:{r5:2,r20:5,adv:650};
 const candidates=(opts.stockCodes||[us?'SERV':'005930',us?'JOBY':'000660']);
 const sectorList=opts.sectors||['technology','energy'];
 const context=alignment.examine({
  now:capturedAt,market,mode:'swing',
  marketSnapshot:{...e,symbol:us?'^GSPC':'^KS11',
   return5Pct:m.r5,return20Pct:m.r20,
   expectedCount:1000,observedCount:900,advancers:m.adv},
  sectors:sectorList.map((id,i)=>({...e,id,
   relative5Pct:i===0?2:-2,relative20Pct:i===0?3:-1,
   volumeRatio:i===0?1.5:0.9,
   expectedCount:10,observedCount:9,advancers:i===0?7:3})),
  candidates:candidates.map((symbol,i)=>({...e,symbol,
   sectorId:i===0?'technology':'energy',
   return5Pct:4,relative5Pct:3,relative20Pct:4,
   priceVsMa20Pct:3,volumeRatio:1.7,turnoverRatio:1.4}))
 });
 assert.equal(context.status,'coherent-input');
 const output={status:context.status,context,
  mapping:{market:'existing market metrics',sectors:'existing relative strength',
   stocks:'existing technical analysis',movingAverage:'daily 20 closes',
   blockedDayTrading:'intraday unverified'},
  marketSources:{benchmark:opts.benchmarkSource||'DEMO',breadth:'DEMO'},
  observationsComparableNotAuthenticated:true,dataVerified:false,
  realTimeVerified:false,tradeApproved:false,canPlaceOrder:false,
  accountAccessed:false,providerCalls:0};
 assert.equal(explain.explain(output).status,'review-context-only');
 return {asOf:day,capturedAt,adapterOutput:output};
}
function fixture(market='US'){
 return {market,mode:'swing',now:NOW,
  records:DATES.map((day,i)=>record(day,market,i))};
}
const compile=(x=fixture())=>report.build(x);

test('reuses existing explanation and timeline rather than recalculating close returns',()=>{
 const x=fixture(),history=timeline.compile(x),current=explain.explain(x.records[2].adapterOutput);
 const r=compile(x);
 assert.equal(history.status,'compiled');
 assert.equal(current.status,'review-context-only');
 assert.equal(r.status,'manual-review');
 assert.equal(r.marketSummary.classification,current.marketAssessment.title);
 assert.equal(r.history.observedCount,history.snapshots.length);
 assert.equal(r.history.lastComparison.marketClassificationShift,
  history.comparisons.at(-1).marketClassificationShift);
 assert.equal(r.candidateRows.length,current.candidates.length);
 assert.equal(r.candidateRows[0].hypotheticalPolicyRiskCeilingPct,
  current.candidates[0].hypotheticalRiskCeilingPct);
});
test('US report shows source and single-date market context without mislabeling live quotes',()=>{
 const r=compile();
 assert.equal(r.market,'US');assert.equal(r.mode,'swing');
 assert.equal(r.asOf,'2026-11-20');
 assert.equal(r.marketSummary.benchmark,'^GSPC');
 assert.equal(r.sources.benchmark,'DEMO');
 assert.equal(r.sources.breadth,'DEMO');
 assert.equal(r.sources.providerAuthenticated,false);
 assert.equal(r.marketSummary.classification,'우호적 관찰');
 assert.equal(r.marketSummary.coveragePct,90);
 assert.equal(r.marketSummary.breadthPct,65);
 assert.equal(r.livePriceVerified,false);
 assert.equal(r.sourceAuthenticated,false);
 assert.equal(r.investmentRecommendation,false);
 assert.equal(r.rankingAvailable,false);
 assert.equal(r.tradeApproved,false);
 assert.equal(r.canPlaceOrder,false);
 assert.equal(r.providerCalls,0);
});
test('KR report preserves local date and six-digit symbols without USD conversion',()=>{
 const r=compile(fixture('KR'));
 assert.equal(r.status,'manual-review');
 assert.equal(r.market,'KR');
 assert.equal(r.marketSummary.benchmark,'^KS11');
 assert.deepEqual(r.candidateRows.map(x=>x.symbol),['005930','000660']);
 assert.equal(r.rankingAvailable,false);
});
test('sector observations are original classifications and not a market-wide ranking',()=>{
 const r=compile();
 assert.equal(r.sectorRows.length,2);
 assert.equal(r.sectorRows[0].id,'technology');
 assert.equal(r.sectorRows[0].classification,'상대강세 관찰');
 assert.equal(r.sectorRows[0].relative5Pct,2);
 assert.equal(r.sectorRows[0].relative20Pct,3);
 assert.equal(r.sectorRows[0].breadthPct,70);
 assert.equal(r.sectorRows[0].fullIndustryRanking,false);
 assert.equal(r.sectorRows[1].classification,'상대약세 관찰');
 assert.equal(r.sectorRows[1].relative5Pct,-2);
});
test('stock explanations include separate market, sector and stock layers',()=>{
 const r=compile();
 const us=r.candidateRows[0];
 assert.equal(us.symbol,'SERV');
 assert.equal(us.sectorId,'technology');
 assert.equal(us.status,'manual-review-only');
 assert.equal(us.observation,'계층 일치 관찰');
 assert.deepEqual(us.layers.map(x=>x.layer),['market','sector','stock']);
 assert.equal(us.hypotheticalPolicyRiskCeilingPct,1.5);
 assert.equal(us.isRecommended,false);
 assert.equal(us.tradeSignal,null);
 assert.equal(us.orderApproved,false);
 const second=r.candidateRows[1];
 assert.equal(second.symbol,'JOBY');
 assert.equal(second.observation,'방어적 관찰');
 assert.equal(second.hypotheticalPolicyRiskCeilingPct,0.75);
});
test('date strip reflects observed discrete dates and not verified market sessions',()=>{
 const r=compile();
 assert.deepEqual(r.history.days.map(x=>x.asOf),DATES);
 assert.deepEqual(r.history.days.map(x=>x.marketClassification),
  ['방어적 관찰','혼조 관찰','우호적 관찰']);
 assert.equal(r.history.observedCount,3);
 assert.equal(r.history.status,'adjacent-observations-only');
 assert.equal(r.history.lastComparison.calendarDaysApart,1);
 assert.equal(r.history.lastComparison.consecutiveMarketSessionsVerified,false);
 assert.equal(r.historicalPricesVerified,false);
 assert.equal(r.exchangeCalendarVerified,false);
});
test('latest observation changes display known classifications, never stock price performance',()=>{
 const r=compile();
 assert.equal(r.history.lastComparison.marketClassificationShift,'classified-strengthened');
 assert.equal(r.history.lastComparison.changes.length,2);
 assert.equal(r.history.lastComparison.changes[0].symbol,'JOBY');
 assert.equal(r.history.lastComparison.changes[1].symbol,'SERV');
 assert.equal(r.history.lastComparison.changes[1].tradeSignal,null);
 assert.equal(r.tradingRecommendation,undefined);
});
test('missing latest observation blocks the entire current report rather than showing previous day',()=>{
 const x=fixture();
 x.records[2].adapterOutput={
  status:'blocked',code:'SECTOR_SAMPLE_INSUFFICIENT',
  details:[{index:0}],comparison:null,
  dataVerified:false,realTimeVerified:false,tradeApproved:false,
  canPlaceOrder:false,accountAccessed:false,providerCalls:0
 };
 const r=compile(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'LATEST_OBSERVATION_NOT_QUALIFIED');
 assert.equal(r.marketSummary,null);
 assert.equal(r.candidateRows.length,0);
 assert.equal(r.history.observedCount,0);
});
test('previous unqualified day allows current manual context but withholds comparison',()=>{
 const x=fixture();
 x.records[1].adapterOutput={
  status:'blocked',code:'SECTOR_SAMPLE_INSUFFICIENT',
  details:[{index:0}],comparison:null,
  dataVerified:false,realTimeVerified:false,tradeApproved:false,
  canPlaceOrder:false,accountAccessed:false,providerCalls:0
 };
 const r=compile(x);
 assert.equal(r.status,'manual-review');
 assert.equal(r.history.status,'withheld');
 assert.equal(r.history.lastComparison.changes.length,0);
 assert.match(r.history.reason,/검증 보류/);
});
test('provider source change withholds candidate trend comparison',()=>{
 const x=fixture();
 x.records[1].adapterOutput.marketSources.benchmark='OTHER';
 const r=compile(x);
 assert.equal(r.status,'manual-review');
 assert.equal(r.history.status,'withheld');
 assert.match(r.history.reason,/출처/);
 assert.equal(r.history.lastComparison.marketClassificationShift,null);
 assert.equal(r.history.lastComparison.changes.length,0);
});
test('large coverage shift withholds misleading comparison',()=>{
 const x=fixture();
 const v=clone(x.records[1].adapterOutput);
 v.context.marketContext.coveragePct=65;
 x.records[1].adapterOutput=v;
 const r=compile(x);
 assert.equal(r.status,'blocked'); // upstream explanation refuses ungrounded partial forgery
 assert.equal(r.code,'INVALID_HISTORY_INPUT');
});
test('single valid observation shows market context but no inferred prior trend',()=>{
 const x=fixture();x.records=[x.records[2]];
 const r=compile(x);
 assert.equal(r.status,'manual-review');
 assert.equal(r.history.status,'no-prior');
 assert.equal(r.history.lastComparison,null);
 assert.deepEqual(r.history.days.map(y=>y.asOf),['2026-11-20']);
});
test('empty observed record list yields empty state, without fake default market data',()=>{
 const x=fixture();x.records=[];
 const r=compile(x);
 assert.equal(r.status,'empty');
 assert.equal(r.marketSummary,null);
 assert.equal(r.candidateRows.length,0);
 assert.equal(r.livePriceVerified,false);
});
test('day trading is not silently extrapolated from daily close analysis',()=>{
 const x=fixture();x.mode='day';
 assert.equal(compile(x).code,'INVALID_OR_PRIVATE_INPUT');
});
test('partial candidate remains clearly unqualified and cannot be recommended',()=>{
 const x=fixture();
 const latest=clone(x.records[2].adapterOutput);
 latest.status=latest.context.status='partial';
 latest.context.candidates[1].status='blocked';
 latest.context.candidates[1].posture='unavailable';
 latest.context.candidates[1].issues=['STOCK_MOMENTUM_INPUT_INVALID'];
 latest.context.candidates[1].riskMultiplierIllustration=null;
 latest.context.candidates[1].hypotheticalPolicyRiskCeilingPct=null;
 latest.context.coverage.stockObservationsCoherent=1;
 assert.equal(explain.explain(latest).status,'partial-evidence');
 x.records[2].adapterOutput=latest;
 const r=compile(x);
 assert.equal(r.status,'partial-evidence');
 assert.equal(r.candidateRows[1].status,'insufficient-evidence');
 assert.equal(r.candidateRows[1].hypotheticalPolicyRiskCeilingPct,null);
 assert.equal(r.candidateRows[1].isRecommended,false);
 assert.equal(r.candidateRows[0].status,'manual-review-only');
});
test('misaligned last adapter trading date is blocked, not rewritten to last timeline date',()=>{
 const x=fixture();
 x.records[2].asOf='2026-11-21';
 assert.equal(compile(x).status,'blocked');
});
test('market mismatch with last adapter source never converted with invented FX',()=>{
 const x=fixture();
 x.records[2]=record('2026-11-20','KR',2);
 assert.equal(compile(x).status,'blocked');
});
test('missing previous data cannot be auto-inferred as one previous trading day',()=>{
 const x=fixture();x.records=x.records.slice(1);
 const r=compile(x);
 assert.equal(r.history.observedCount,2);
 assert.equal(r.history.days.length,2);
 assert.equal(r.history.lastComparison.consecutiveMarketSessionsVerified,false);
});
test('new candidate appearing only in last input is described as observation, not new buy',()=>{
 const x=fixture();
 x.records[1]=record('2026-11-19','US',1,{stockCodes:['SERV']});
 const r=compile(x);
 assert.equal(r.status,'manual-review');
 assert.equal(r.history.status,'adjacent-observations-only');
 const entry=r.history.lastComparison.changes.find(c=>c.symbol==='JOBY');
 assert.equal(entry.event,'new-observation');
 assert.equal(entry.description,'이번 관찰에서 등장');
 assert.equal(entry.tradeSignal,null);
});
test('removing last candidate is only absence of observation, not an actual sale',()=>{
 const x=fixture();
 x.records[2]=record('2026-11-20','US',2,{stockCodes:['SERV']});
 const r=compile(x);
 const missing=r.history.lastComparison.changes.find(c=>c.symbol==='JOBY');
 assert.equal(missing.event,'not-observed');
 assert.equal(missing.current,'미관측');
});
test('unknown top-level private fields are refused without echoing them',()=>{
 const x=fixture();x.accountNumber='SECRET_ACC_123';
 const r=compile(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'INVALID_OR_PRIVATE_INPUT');
 assert.equal(JSON.stringify(r).includes('SECRET_ACC_123'),false);
});
test('raw private account or token inside archived output is excluded from report',()=>{
 const x=fixture();
 x.records[0].adapterOutput.brokerToken='PRIVATE_12345';
 const r=compile(x);
 assert.equal(r.status,'blocked');
 assert.equal(JSON.stringify(r).includes('PRIVATE_12345'),false);
});
test('a forged market context flag does not become a provider-authentication claim',()=>{
 const x=fixture();
 x.records[2].adapterOutput=clone(x.records[2].adapterOutput);
 x.records[2].adapterOutput.context.marketDataVerified=true;
 const r=compile(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.livePriceVerified,false);
});
test('faked probability/ordering added to a stock is rejected as private metadata',()=>{
 const x=fixture();
 x.records[2].adapterOutput=clone(x.records[2].adapterOutput);
 x.records[2].adapterOutput.context.candidates[0].probability=0.99;
 const r=compile(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.rankingAvailable,false);
});
test('injurious buy recommendation is never inserted into a research observation',()=>{
 const r=compile();
 for(const row of r.candidateRows){
  assert.equal(Object.hasOwn(row,'recommendation'),false);
  assert.equal(Object.hasOwn(row,'entry'),false);
  assert.equal(Object.hasOwn(row,'target'),false);
  assert.equal(Object.hasOwn(row,'quantity'),false);
 }
 assert.equal(r.investmentRecommendation,false);
 assert.equal(r.canPlaceOrder,false);
});
test('multiple latest candidates preserve input order, not silently ranked by risk cap',()=>{
 const r=compile();
 assert.deepEqual(r.candidateRows.map(c=>c.symbol),['SERV','JOBY']);
 assert.equal(r.candidateRows[0].hypotheticalPolicyRiskCeilingPct,1.5);
 assert.equal(r.candidateRows[1].hypotheticalPolicyRiskCeilingPct,0.75);
 assert.equal(r.rankingAvailable,false);
});
test('model reports no storage / provider interface and is deterministic for exact inputs',()=>{
 const x=fixture(),prior=JSON.stringify(x);
 const a=compile(x),b=compile(x);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(x),prior);
 assert.ok(Object.isFrozen(a));
 assert.ok(Object.isFrozen(a.candidateRows));
 assert.ok(Object.isFrozen(a.history.days));
 assert.equal(a.providerCalls,0);
 assert.equal(a.accountAccessed,false);
});
test('model has no forbidden network, account, order, or storage writes',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/investment-research-report-v1.js'),'utf8');
 for(const s of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService','NH_ACCOUNT','placeOrder(', 'executeOrder(', 'writeFile(']){
  assert.equal(source.includes(s),false,s);
 }
});
test('standalone panel uses safe DOM, mobile breakpoints, and no user data interpolation',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/investment-research-report-panel-v1.js'),'utf8');
 assert.ok(source.includes('textContent='));
 assert.ok(source.includes('max-width:620px'));
 assert.ok(source.includes('data-filter'));
 assert.ok(source.includes('destroy:'));
 assert.equal(source.includes('innerHTML'),false);
 assert.equal(source.includes('fetch('),false);
 assert.equal(source.includes('localStorage.'),false);
});
test('preview makes only local script requests and clearly labels synthetic inputs',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../preview/investment-research-report-v1.html'),'utf8');
 assert.ok(html.includes('합성 데이터 전용'));
 assert.ok(html.includes('viewport'));
 assert.ok(html.includes('data-demo-market="US"'));
 assert.ok(html.includes('data-demo-market="KR"'));
 assert.ok(html.includes('data-demo-market="BLOCKED"'));
 assert.ok(!/<script\s+src="https?:/i.test(html));
 assert.ok(!/<form\s+action=/i.test(html));
});
