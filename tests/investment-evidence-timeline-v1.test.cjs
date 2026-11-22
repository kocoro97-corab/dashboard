'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const timeline=require('../js/investment-evidence-timeline-v1.js');
const alignment=require('../js/market-sector-stock-alignment-v1.js');
const explanation=require('../js/investment-evidence-explanation-v1.js');

const NOW=Date.parse('2026-11-23T09:00:00+09:00');
const DATES=['2026-11-18','2026-11-19','2026-11-20'];
const dateTime=(date,market,clock)=>{
 const offset=market==='US'?'-05:00':'+09:00';
 return Date.parse(date+'T'+clock+offset);
};
const copy=x=>JSON.parse(JSON.stringify(x));
const metadata=Object.freeze({
 market:'existing market data',sectors:'existing SectorInsights',
 stocks:'existing WorkTradingStrategy',movingAverage:'20 close bars',
 blockedDayTrading:'intraday needs independent proof'
});
function prepared(date,options={}){
 const market=options.market||'US';
 const capturedAt=dateTime(date,market,market==='US'?'17:05:00':'16:05:00');
 const observedAt=dateTime(date,market,market==='US'?'16:00:00':'15:30:00');
 const common={source:'Y',asOf:date,phase:'close',observedAt,receivedAt:capturedAt-60000};
 const symbol=market==='US'?'SERV':'005930',other=market==='US'?'JOBY':'000660';
 const sector={...common,id:'tech',relative5Pct:2,relative20Pct:3,
  volumeRatio:1.5,expectedCount:100,observedCount:90,advancers:72};
 const candidate=(ticker)=>({...common,symbol:ticker,sectorId:'tech',
  return5Pct:5,relative5Pct:4,relative20Pct:6,
  priceVsMa20Pct:3,volumeRatio:1.9,turnoverRatio:1.6});
 const context=alignment.examine({
  now:capturedAt,market,mode:'swing',
  marketSnapshot:{...common,symbol:market==='US'?'^GSPC':'^KS11',
   return5Pct:options.marketFive??2,
   return20Pct:options.marketTwenty??5,
   expectedCount:1000,observedCount:options.observedCount??900,
   advancers:options.advancers??650},
  sectors:[sector],
  candidates:(options.stockSymbols||[symbol]).map(candidate)
 });
 assert.equal(context.status,'coherent-input');
 const output={
  status:context.status,context,mapping:{...metadata},
  marketSources:{benchmark:options.benchmarkSource||'Y',
   breadth:options.breadthSource||'N'},
  observationsComparableNotAuthenticated:true,
  dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,providerCalls:0
 };
 assert.equal(explanation.explain(output).status,'review-context-only');
 return {asOf:date,capturedAt,adapterOutput:output};
}
function fixture(options={}){
 const market=options.market||'US';
 return {market,mode:'swing',now:NOW,
  records:DATES.map(date=>prepared(date,{market,...options}))};
}
const compiled=(x=fixture())=>timeline.compile(x);
const serial=x=>JSON.stringify(x);
const find=(pairs,event)=>pairs.flatMap(x=>x.candidateChanges).find(x=>x.event===event);

test('compiles 3 real adapter explanations with an immutable sanitized day-by-day archive',()=>{
 const result=compiled();
 assert.equal(result.status,'compiled');
 assert.equal(result.market,'US');
 assert.equal(result.mode,'swing');
 assert.equal(result.firstDate,'2026-11-18');
 assert.equal(result.lastDate,'2026-11-20');
 assert.equal(result.snapshots.length,3);
 assert.equal(result.comparisons.length,2);
 assert.equal(result.coverage.observedDays,3);
 assert.equal(result.coverage.structurallyUsableDays,3);
 assert.equal(result.coverage.comparablePairs,2);
 assert.equal(result.coverage.withheldPairs,0);
 assert.equal(result.snapshots[0].candidates[0].symbol,'SERV');
 assert.equal(result.snapshots[0].candidates[0].posture,'aligned-watch');
 assert.equal(result.snapshots[0].candidates[0].hypotheticalRiskCeilingPct,1.5);
 assert.equal(result.snapshots[0].benchmarkSource,'Y');
 assert.equal(result.snapshots[0].breadthSource,'N');
 assert.equal(result.stored,false);
 assert.equal(result.archiveReady,true);
 assert.equal(result.automaticTrading,false);
 assert.equal(result.orderApproved,false);
 assert.equal(result.accountAccessed,false);
 assert.equal(result.providerCalls,0);
 assert.equal(result.marketPriceVerified,false);
 assert.equal(result.actualPricePerformanceComputed,false);
});
test('uses the existing Korean market-local date convention instead of UTC asOf on weekends',()=>{
 const r=compiled(fixture({market:'KR'}));
 assert.equal(r.status,'compiled');
 assert.equal(r.snapshots[2].asOf,'2026-11-20');
 assert.equal(r.market,'KR');
 assert.equal(r.snapshots[0].candidates[0].symbol,'005930');
 assert.equal(r.comparisons[0].status,'adjacent-observations-only');
});
test('each adjacent pair is explicitly not a verified consecutive trading session',()=>{
 const r=compiled();
 for(const x of r.comparisons){
  assert.equal(x.calendarDaysApart,1);
  assert.equal(x.consecutiveMarketSessionsVerified,false);
  assert.equal(x.inferredPriceReturn,null);
  assert.equal(x.rankingsAvailable,false);
  assert.equal(x.tradeSignal,null);
 }
 assert.equal(r.trendIsOnlyChangeInClassification,true);
});
test('stable observations classify as unchanged, not numeric return or positive performance',()=>{
 const r=compiled();
 assert.equal(r.comparisons[0].marketClassificationShift,'classification-unchanged');
 assert.equal(r.comparisons[0].candidateChanges[0].event,'context-unchanged');
 assert.equal(r.comparisons[0].candidateChanges[0].label,'관찰 조건 유지');
 assert.equal(r.comparisons[0].candidateChanges[0].confidenceScore,null);
 assert.equal(r.comparisons[0].candidateChanges[0].tradeSignal,null);
});
test('market weakness shifts observation label without suggesting to sell',()=>{
 const f=fixture();
 f.records[2]=prepared('2026-11-20',{marketTwenty:-5});
 const r=compiled(f);
 assert.equal(r.status,'compiled');
 assert.equal(r.snapshots[2].marketPosture,'defensive');
 assert.equal(r.comparisons[1].marketClassificationShift,'classified-weakened');
 const changed=find(r.comparisons,'context-weakened');
 assert.ok(changed);
 assert.equal(changed.previous,'aligned-watch');
 assert.equal(changed.current,'defensive-watch');
 assert.equal(r.orderApproved,false);
});
test('market recovery shifts classification rather than claiming investment returns',()=>{
 const f=fixture();
 f.records[0]=prepared('2026-11-18',{marketTwenty:-5});
 const r=compiled(f);
 assert.equal(r.comparisons[0].marketClassificationShift,'classified-strengthened');
 const change=find(r.comparisons,'context-strengthened');
 assert.ok(change);
 assert.equal(change.previous,'defensive-watch');
 assert.equal(change.current,'aligned-watch');
 assert.equal(r.comparisons[0].inferredPriceReturn,null);
});
test('day reports include only safe derived fields, not raw OHLCV or account snapshots',()=>{
 const r=compiled();
 const s=serial(r);
 for(const token of ['marketSnapshot','technical','series','accountNumber',
  'rawQuotes','holdings','authToken','capital','orderId','entryPrice']){
  assert.equal(s.includes('"'+token+'"'),false,token);
 }
 assert.equal(r.snapshots[0].candidates[0].hypotheticalRiskCeilingPct,1.5);
});
test('weekend gap Friday-to-Monday is not assumed to be actual exchange sessions',()=>{
 const f={market:'US',mode:'swing',now:NOW,records:[
  prepared('2026-11-20'),prepared('2026-11-23')
 ]};
 f.now=Date.parse('2026-11-24T09:00:00+09:00');
 const r=compiled(f);
 assert.equal(r.status,'compiled');
 assert.equal(r.comparisons[0].calendarDaysApart,3);
 assert.equal(r.comparisons[0].status,'adjacent-observations-only');
 assert.equal(r.comparisons[0].consecutiveMarketSessionsVerified,false);
});
test('a gap larger than seven calendar days withholds directional comparison',()=>{
 const f={market:'US',mode:'swing',now:Date.parse('2026-12-03T09:00:00+09:00'),
  records:[prepared('2026-11-20'),prepared('2026-12-01')]};
 const r=compiled(f);
 assert.equal(r.status,'compiled');
 assert.equal(r.comparisons[0].status,'not-comparable');
 assert.ok(r.comparisons[0].limitations.includes('OBSERVATION_GAP_OVER_SEVEN_DAYS'));
 assert.equal(r.comparisons[0].candidateChanges.length,0);
 assert.equal(r.coverage.withheldPairs,1);
});
test('benchmark source change suppresses ungrounded day-to-day improvement claims',()=>{
 const f=fixture();
 f.records[1]=prepared('2026-11-19',{benchmarkSource:'DIFFERENT'});
 const r=compiled(f);
 assert.equal(r.comparisons[0].status,'not-comparable');
 assert.ok(r.comparisons[0].limitations.includes('SOURCE_CHANGED'));
 assert.equal(r.comparisons[0].candidateChanges.length,0);
 assert.equal(r.comparisons[1].status,'not-comparable');
});
test('market breadth provider change also suppresses comparisons',()=>{
 const f=fixture();f.records[2]=prepared('2026-11-20',{breadthSource:'OTHER'});
 const r=compiled(f);
 assert.ok(r.comparisons[1].limitations.includes('SOURCE_CHANGED'));
 assert.equal(r.comparisons[1].marketClassificationShift,null);
});
test('market sample coverage drop of more than 15pp suppresses classification trends',()=>{
 const f=fixture();
 f.records[1]=prepared('2026-11-19',{observedCount:620,advancers:400});
 const r=compiled(f);
 assert.equal(r.comparisons[0].status,'not-comparable');
 assert.ok(r.comparisons[0].limitations.includes('MARKET_SAMPLE_COVERAGE_SHIFT'));
 assert.equal(r.comparisons[0].candidateChanges.length,0);
});
test('exactly 15pp market coverage shift does not silently declare official data verified',()=>{
 const f=fixture();
 f.records[1]=prepared('2026-11-19',{observedCount:750,advancers:500});
 const r=compiled(f);
 assert.equal(r.comparisons[0].status,'adjacent-observations-only');
 assert.equal(r.sourceAuthenticityVerified,false);
 assert.equal(r.calendarVerified,false);
});
test('only the affected adjacent pair is marked not-comparable',()=>{
 const f=fixture();
 f.records[1]=prepared('2026-11-19',{observedCount:650,advancers:430});
 f.records[2]=prepared('2026-11-20',{observedCount:650,advancers:430});
 const r=compiled(f);
 assert.equal(r.comparisons[0].status,'not-comparable');
 assert.equal(r.comparisons[1].status,'adjacent-observations-only');
 assert.equal(r.coverage.comparablePairs,1);
});
test('newly observed symbol is not described as newly listed, recommended or purchased',()=>{
 const f=fixture();
 f.records[1]=prepared('2026-11-19',{stockSymbols:['SERV','JOBY']});
 const r=compiled(f);
 const entry=find(r.comparisons,'new-observation');
 assert.ok(entry);
 assert.equal(entry.symbol,'JOBY');
 assert.equal(entry.previous,null);
 assert.equal(entry.label,'이번 관측에서 처음 등장');
 assert.equal(entry.tradeSignal,null);
});
test('symbol absent in the next snapshot is not called sold or delisted',()=>{
 const f=fixture();
 f.records[0]=prepared('2026-11-18',{stockSymbols:['SERV','JOBY']});
 const r=compiled(f);
 const entry=find(r.comparisons,'not-observed');
 assert.ok(entry);
 assert.equal(entry.symbol,'JOBY');
 assert.equal(entry.current,null);
 assert.equal(entry.label,'이번 관측에서 미관측');
});
test('output candidate events are sorted by symbol and independent of input candidate order',()=>{
 const f=fixture();
 f.records[0]=prepared('2026-11-18',{stockSymbols:['SERV','JOBY']});
 f.records[1]=prepared('2026-11-19',{stockSymbols:['JOBY','SERV']});
 const r=compiled(f);
 assert.deepEqual(r.comparisons[0].candidateChanges.map(x=>x.symbol),['JOBY','SERV']);
});
test('changes in a constituent layer are distinguished from overall posture change',()=>{
 const f=fixture();
 f.records[1].adapterOutput=copy(f.records[1].adapterOutput);
 const day=f.records[1].adapterOutput.context;
 day.marketContext.posture='mixed';
 day.marketContext.breadthPct=50;
 day.candidates[0].marketPosture='mixed';
 day.candidates[0].posture='mixed-watch';
 day.candidates[0].riskMultiplierIllustration=0.75;
 day.candidates[0].hypotheticalPolicyRiskCeilingPct=1.125;
 const r=compiled(f);
 assert.equal(r.status,'compiled');
 assert.equal(r.comparisons[0].candidateChanges[0].event,'context-weakened');
});
test('a structurally blocked archived day is retained as a gap, not force-converted',()=>{
 const f=fixture();
 f.records[1].adapterOutput={
  status:'blocked',code:'SECTOR_SAMPLE_INSUFFICIENT',details:[{index:0}],
  comparison:null,dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,providerCalls:0
 };
 const r=compiled(f);
 assert.equal(r.status,'partial');
 assert.equal(r.snapshots[1].status,'unqualified');
 assert.deepEqual(r.snapshots[1].issues,['SECTOR_SAMPLE_INSUFFICIENT']);
 assert.equal(r.comparisons[0].status,'not-comparable');
 assert.equal(r.comparisons[1].status,'not-comparable');
 assert.equal(r.coverage.structurallyUsableDays,2);
 assert.equal(r.coverage.unqualifiedDays,1);
});
test('an archive of blocked reports is explicitly all-unqualified',()=>{
 const f=fixture();
 const x={status:'blocked',code:'STOCK_TREND_NOT_UP',details:[],
  comparison:null,dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,providerCalls:0};
 f.records=f.records.map(r=>({...r,adapterOutput:copy(x)}));
 const result=compiled(f);
 assert.equal(result.status,'all-unqualified');
 assert.equal(result.coverage.comparablePairs,0);
 assert.equal(result.coverage.unqualifiedDays,3);
});
test('a zero-record archive is empty and does not claim any trading-session continuity',()=>{
 const f=fixture();f.records=[];
 const r=compiled(f);
 assert.equal(r.status,'empty');
 assert.equal(r.firstDate,null);
 assert.equal(r.lastDate,null);
 assert.equal(r.snapshots.length,0);
 assert.equal(r.comparisons.length,0);
 assert.equal(r.archiveReady,true);
});
test('a single snapshot has no comparison event whatsoever',()=>{
 const f=fixture();f.records=f.records.slice(0,1);
 const r=compiled(f);
 assert.equal(r.status,'compiled');
 assert.equal(r.comparisons.length,0);
 assert.equal(r.coverage.comparablePairs,0);
});
test('duplicate same-day observations are rejected rather than silently overwriting',()=>{
 const f=fixture();f.records[1].asOf=f.records[0].asOf;
 assert.equal(compiled(f).code,'INVALID_OR_UNSORTED_RECORD');
});
test('unsorted observation dates are refused rather than secretly reordered',()=>{
 const f=fixture();f.records.reverse();
 assert.equal(compiled(f).code,'INVALID_OR_UNSORTED_RECORD');
});
test('non-increasing capture timestamps are invalid even with correctly sorted asOf days',()=>{
 const f=fixture();f.records[1].capturedAt=f.records[0].capturedAt;
 assert.equal(compiled(f).code,'INVALID_OR_UNSORTED_RECORD');
});
test('capture before its purported market-local observation day is rejected',()=>{
 const f=fixture();
 f.records[1].capturedAt=dateTime('2026-11-18','US','17:10:00');
 assert.equal(compiled(f).code,'CAPTURE_BEFORE_LOCAL_OBSERVATION_DATE');
 const single={market:'US',mode:'swing',now:NOW,records:[prepared('2026-11-20')]};
 single.records[0].capturedAt=dateTime('2026-11-19','US','17:00:00');
 assert.equal(compiled(single).code,'CAPTURE_BEFORE_LOCAL_OBSERVATION_DATE');
});
test('future capture dates beyond five-minute grace are rejected',()=>{
 const f=fixture();f.records[2].capturedAt=NOW+360000;
 assert.equal(compiled(f).code,'INVALID_OR_UNSORTED_RECORD');
});
test('impossible calendar dates cannot enter historical snapshots',()=>{
 const f=fixture();f.records[2].asOf='2026-02-30';
 assert.equal(compiled(f).code,'INVALID_OR_UNSORTED_RECORD');
});
test('market mismatch across snapshots fails closed rather than cross-currency combining',()=>{
 const f=fixture();f.records[1]=prepared('2026-11-19',{market:'KR'});
 assert.equal(compiled(f).code,'INCONSISTENT_ARCHIVED_REPORT');
});
test('day mode explicitly fails closed; this does not invent minute-bar history',()=>{
 const f=fixture();f.mode='day';
 assert.equal(compiled(f).code,'INVALID_OR_PRIVATE_INPUT');
});
test('unknown user input fields carrying secret strings are rejected without echo',()=>{
 const f=fixture();f.accountNumber='PRIVATE_ACC_987';
 const r=compiled(f);
 assert.equal(r.code,'INVALID_OR_PRIVATE_INPUT');
 assert.equal(serial(r).includes('PRIVATE_ACC_987'),false);
});
test('unexpected snapshot field is refused without retaining its content',()=>{
 const f=fixture();f.records[0].bearerToken='Bearer SECRET';
 const r=compiled(f);
 assert.equal(r.code,'INVALID_OR_UNSORTED_RECORD');
 assert.equal(serial(r).includes('SECRET'),false);
});
test('malicious extra raw holdings on archived adapter are rejected, not serialized',()=>{
 const f=fixture();f.records[1].adapterOutput.holdings=[{id:'SECRET123',qty:10}];
 const r=compiled(f);
 assert.equal(r.code,'INVALID_ARCHIVED_EVIDENCE');
 assert.equal(serial(r).includes('SECRET123'),false);
});
test('unknown adapter code with URL is not accepted as an archival blocked fact',()=>{
 const f=fixture();
 f.records[1].adapterOutput={
  status:'blocked',code:'http://token.private/',details:[],comparison:null,
  dataVerified:false,realTimeVerified:false,tradeApproved:false,
  canPlaceOrder:false,accountAccessed:false,providerCalls:0
 };
 const r=compiled(f);
 assert.equal(r.code,'INVALID_ARCHIVED_EVIDENCE');
 assert.equal(serial(r).includes('token.private'),false);
});
test('blocked record detail containing account information is rejected',()=>{
 const f=fixture();
 f.records[1].adapterOutput={
  status:'blocked',code:'STOCK_TREND_NOT_UP',
  details:[{accountNumber:'TOP_SECRET'}],comparison:null,
  dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,providerCalls:0
 };
 const r=compiled(f);
 assert.equal(r.code,'INVALID_ARCHIVED_EVIDENCE');
 assert.equal(serial(r).includes('TOP_SECRET'),false);
});
test('duplicate archived stock symbols are blocked, including a second unqualified record',()=>{
 const f=fixture();
 const output=f.records[1].adapterOutput=copy(f.records[1].adapterOutput);
 const second=copy(output.context.candidates[0]);
 second.status='blocked';second.posture='unavailable';
 second.issues=['DUPLICATE_STOCK_ID'];
 second.riskMultiplierIllustration=null;
 second.hypotheticalPolicyRiskCeilingPct=null;
 output.context.candidates.push(second);
 output.context.coverage.stocksSupplied=2;
 output.context.coverage.stockObservationsCoherent=1;
 output.context.status=output.status='partial';
 assert.equal(explanation.explain(output).status,'partial-evidence');
 const r=compiled(f);
 assert.equal(r.code,'DUPLICATE_ARCHIVED_STOCK_ID');
 assert.equal(r.snapshots.length,0);
});
test('a candidate with manual-review readiness but no stock ID is not a historical trend observation',()=>{
 const f=fixture();
 const output=f.records[1].adapterOutput=copy(f.records[1].adapterOutput);
 output.context.candidates[0].symbol=null;
 assert.equal(explanation.explain(output).status,'review-context-only');
 assert.equal(compiled(f).code,'INVALID_ARCHIVED_CANDIDATE');
});
test('a forged classification context cannot be used as a time series',()=>{
 const f=fixture();
 f.records[1].adapterOutput=copy(f.records[1].adapterOutput);
 f.records[1].adapterOutput.context.candidates[0].posture='aligned-watch';
 f.records[1].adapterOutput.context.candidates[0].riskMultiplierIllustration=0.5;
 assert.equal(compiled(f).code,'INVALID_ARCHIVED_EVIDENCE');
});
test('a forged order approval must never be archived',()=>{
 const f=fixture();f.records[0].adapterOutput.tradeApproved=true;
 const r=compiled(f);
 assert.equal(r.code,'INVALID_ARCHIVED_EVIDENCE');
 assert.equal(r.orderApproved,false);
});
test('more than 90 observations are refused before processing',()=>{
 const f=fixture();
 f.records=Array.from({length:91},(_,i)=>({asOf:'2026-11-20',capturedAt:i+1,adapterOutput:{}}));
 assert.equal(compiled(f).code,'INVALID_OR_PRIVATE_INPUT');
});
test('excessively large record content fails without leaking private metadata',()=>{
 const f=fixture();
 f.records[1].adapterOutput.privateBlob='TOKEN_9919'.repeat(30000);
 const r=compiled(f);
 assert.equal(r.code,'INVALID_OR_UNSORTED_RECORD');
 assert.equal(serial(r).includes('TOKEN_9919'),false);
});
test('bad cyclic record data fails closed instead of throwing or echoing raw values',()=>{
 const f=fixture();
 f.records[1].adapterOutput.self=f.records[1].adapterOutput;
 const r=compiled(f);
 assert.equal(r.code,'INVALID_OR_UNSORTED_RECORD');
 assert.equal(r.providerCalls,0);
});
test('missing required capturedAt is blocked; no automatic Date.now substitution',()=>{
 const f=fixture();delete f.records[0].capturedAt;
 assert.equal(compiled(f).code,'INVALID_OR_UNSORTED_RECORD');
});
test('missing market or mode does not silently infer location or user trading style',()=>{
 const f=fixture();delete f.market;
 assert.equal(compiled(f).code,'INVALID_OR_PRIVATE_INPUT');
 const g=fixture();delete g.mode;
 assert.equal(compiled(g).code,'INVALID_OR_PRIVATE_INPUT');
});
test('input snapshots are not mutated or re-sorted on repeated compilation',()=>{
 const f=fixture();const prior=serial(f);
 const a=compiled(f),b=compiled(f);
 assert.equal(serial(f),prior);
 assert.deepEqual(a,b);
 assert.equal(Object.isFrozen(a),true);
 assert.equal(Object.isFrozen(a.snapshots[0]),true);
 assert.equal(Object.isFrozen(a.comparisons[0].candidateChanges),true);
});
test('module contains no network, storage, account, timer, trade or order execution path',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/investment-evidence-timeline-v1.js'),'utf8');
 for(const text of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
 'PropertiesService', 'NH_ACCOUNT', 'placeOrder(', 'executeOrder(',
 'setInterval(', 'setTimeout(', 'writeFile(', 'sendOrder(']){
  assert.equal(source.includes(text),false,text);
 }
});
