'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const gate=require('../js/market-evidence-gate-v1.js');

const NOW=Date.parse('2026-11-21T07:05:00+09:00');
const US_CLOSE=Date.parse('2026-11-20T16:00:00-05:00');
const KR_CLOSE=Date.parse('2026-11-20T15:30:00+09:00');
const REC=NOW-60*1000;
function fixture(market='US',{
  observedAt=market==='US'?US_CLOSE:KR_CLOSE,
  phase='close',movePct=1,receivedAt=REC
}={}){
 const symbols=gate.REQUIRED[market];
 const quotes=Object.fromEntries(symbols.map(k=>[k,{
  p:100*(1+movePct/100),prev:100,observedAt,phase
 }]));
 return {market,now:NOW,quotes,
  sources:Object.fromEntries(symbols.map(k=>[k,market==='US'?'Y':'N'])),
  receivedAt:Object.fromEntries(symbols.map(k=>[k,receivedAt]))};
}

test('US market date uses New York local day across winter/summer DST',()=>{
 assert.equal(gate.dayAt(US_CLOSE,'US'),'2026-11-20');
 assert.equal(gate.dayAt(Date.parse('2026-07-10T16:00:00-04:00'),'US'),'2026-07-10');
 assert.equal(gate.dayAt(US_CLOSE,'KR'),'2026-11-21');
 assert.equal(gate.dayAt(US_CLOSE,'INVALID'),null);
});
test('KR market observation uses Seoul date and cannot be confused with NY clock',()=>{
 assert.equal(gate.dayAt(KR_CLOSE,'KR'),'2026-11-20');
 const result=gate.assess(fixture('KR'));
 assert.equal(result.status,'qualified-close');
 assert.equal(result.marketDate,'2026-11-20');
 assert.equal(result.direction,'up');
 assert.equal(result.requiredCount,2);
 assert.equal(result.observedCount,2);
});
test('all US core indices qualified only with coherent timestamps and declared close phase',()=>{
 const out=gate.assess(fixture());
 assert.equal(out.status,'qualified-close');
 assert.equal(out.marketDate,'2026-11-20');
 assert.equal(out.direction,'up');
 assert.equal(out.requiredCount,4);
 assert.equal(out.phaseVerified,true);
 assert.equal(out.quoteTruthVerified,false);
 assert.equal(out.exchangeCalendarVerified,false);
 assert.equal(out.realTimeVerified,false);
 assert.equal(out.tradingRecommendation,false);
 assert.match(out.note,/독립 검증되지 않았습니다/);
});
test('unverified close phase is shown as indicative only, never a confirmed close',()=>{
 const r=fixture();
 delete r.quotes['^SOX'].phase;
 const x=gate.assess(r);
 assert.equal(x.status,'indicative-only');
 assert.equal(x.phaseVerified,false);
 assert.equal(x.direction,'up');
 assert.ok(x.issues.includes('^SOX:PHASE_UNVERIFIED'));
 assert.match(x.title,/종가 확인 불가/);
});
test('missing one mandatory core index blocks direction and does not fabricate input',()=>{
 const f=fixture();
 delete f.quotes['^DJI'];
 const x=gate.assess(f);
 assert.equal(x.status,'blocked');
 assert.equal(x.direction,'unavailable');
 assert.equal(x.marketDate,null);
 assert.ok(x.issues.includes('^DJI:QUOTE_MISSING'));
 assert.equal(x.observedCount,3);
});
test('corrupted price or previous close blocks regime',()=>{
 const a=fixture();a.quotes['^GSPC'].p=0;
 assert.equal(gate.assess(a).status,'blocked');
 const b=fixture();b.quotes['^IXIC'].prev=null;
 assert.ok(gate.assess(b).issues.includes('^IXIC:PREVIOUS_MISSING_OR_INVALID'));
});
test('receipt older than 30 minutes never counts as verified transport',()=>{
 const f=fixture('US',{receivedAt:NOW-31*60*1000});
 const x=gate.assess(f);
 assert.equal(x.status,'blocked');
 assert.ok(x.issues.includes('^GSPC:RECEIPT_STALE'));
});
test('observations older than five days are invalid even with fresh receipt',()=>{
 const f=fixture('US',{observedAt:NOW-121*60*60*1000});
 assert.equal(gate.assess(f).status,'blocked');
 assert.ok(gate.assess(f).issues.includes('^IXIC:OBSERVATION_TOO_OLD'));
});
test('refreshed error on existing cached quote fails closed',()=>{
 const f=fixture();
 f.quotes['^SOX'].refreshFailed=true;
 const x=gate.assess(f);
 assert.equal(x.status,'blocked');
 assert.ok(x.issues.includes('^SOX:LAST_REFRESH_FAILED'));
});
test('US indices dated one NY session apart cannot be combined into a market regime',()=>{
 const f=fixture();
 f.quotes['^SOX'].observedAt=Date.parse('2026-11-19T16:00:00-05:00');
 const x=gate.assess(f);
 assert.equal(x.status,'blocked');
 assert.ok(x.issues.includes('MARKET_DATE_MISMATCH'));
});
test('same local date but >12h apart observations are not a coherent closing snapshot',()=>{
 const f=fixture();
 f.quotes['^SOX'].observedAt=Date.parse('2026-11-20T02:00:00-05:00');
 const x=gate.assess(f);
 assert.equal(x.status,'blocked');
 assert.ok(x.issues.includes('OBSERVATION_WINDOW_MISMATCH'));
});
test('missing original timestamp or identified source cannot claim verified input',()=>{
 const f=fixture();
 delete f.quotes['^IXIC'].observedAt;
 delete f.sources['^DJI'];
 const x=gate.assess(f);
 assert.equal(x.status,'blocked');
 assert.ok(x.issues.includes('^IXIC:OBSERVED_AT_UNKNOWN'));
 assert.ok(x.issues.includes('^DJI:SOURCE_UNIDENTIFIED'));
});
test('future observation or future receipt invalidates cached quote',()=>{
 const a=fixture();
 a.quotes['^GSPC'].observedAt=NOW+6*60*1000;
 assert.ok(gate.assess(a).issues.includes('^GSPC:FUTURE_OBSERVATION'));
 const b=fixture();
 b.receivedAt['^IXIC']=NOW+6*60*1000;
 assert.ok(gate.assess(b).issues.includes('^IXIC:FUTURE_RECEIPT'));
});
test('extreme change and observation-after-receipt are rejected',()=>{
 const a=fixture();a.quotes['^SOX'].p=200;
 assert.ok(gate.assess(a).issues.includes('^SOX:CHANGE_OUTLIER'));
 const b=fixture();
 b.quotes['^SOX'].observedAt=REC+6*60*1000;
 assert.ok(gate.assess(b).issues.includes('^SOX:OBSERVATION_AFTER_RECEIPT'));
});
test('direction classification is transparent and only after evidence gating',()=>{
 const down=fixture('KR',{movePct:-2});
 assert.equal(gate.assess(down).direction,'down');
 const mixed=fixture('KR');
 mixed.quotes['^KQ11'].p=99;
 assert.equal(gate.assess(mixed).direction,'mixed');
 const flat=fixture('KR',{movePct:0});
 assert.equal(gate.assess(flat).direction,'flat');
});
test('invalid market/clock fails without market lookup or network',()=>{
 assert.equal(gate.assess({market:'TICK',now:NOW}).code,'INVALID_MARKET');
 assert.equal(gate.assess({market:'US',now:NaN}).code,'INVALID_NOW');
 assert.equal(gate.dayAt(0,'US'),null);
});
test('comparison is side-effect-free and does not mutate supplied quotes',()=>{
 const f=fixture('KR');
 const before=JSON.stringify(f);
 gate.assess(f);gate.assess(f);
 assert.equal(JSON.stringify(f),before);
});
test('standalone evaluator contains no network, storage, or account integration',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/market-evidence-gate-v1.js'),'utf8');
 for(const forbidden of ['localStorage.', 'sessionStorage.', 'fetch(', 'XMLHttpRequest',
  'setInterval(', 'placeOrder(', 'api_key=', 'PropertiesService', 'NH_ACCOUNT_SESSION']){
  assert.equal(src.includes(forbidden),false,forbidden);
 }
});
