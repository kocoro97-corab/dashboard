'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const diagnostics=require('../js/market-quality-diagnostics-v1.js');

const NOW=Date.parse('2026-11-21T07:05:00+09:00');
const CLOSE=Date.parse('2026-11-20T16:00:00-05:00');
const RECEIVED=NOW-60*1000;
function fixture(){
 const symbols=['^GSPC','^IXIC','^DJI','^SOX'];
 return {market:'US',now:NOW,
  quotes:Object.fromEntries(symbols.map((symbol,i)=>[symbol,{
   p:105+i,prev:100,phase:'close',observedAt:CLOSE
  }])),
  sources:Object.fromEntries(symbols.map(symbol=>[symbol,'Y'])),
  receivedAt:Object.fromEntries(symbols.map(symbol=>[symbol,RECEIVED])),
  events:[]};
}
function event(code='NH_NO_PRICE',extra={}){
 return {scope:'public',code,target:'future:k3',layer:'nh',
  at:new Date(NOW-2000).toISOString(),http:null,
  ...extra};
}
const run=(opts=fixture())=>diagnostics.diagnose(opts);

test('qualified four US index inputs show coherent but never market-verified status',()=>{
 const x=run();
 assert.equal(x.status,'evidence-coherent');
 assert.equal(x.market,'US');
 assert.equal(x.gateStatus,'qualified-close');
 assert.equal(x.marketDate,'2026-11-20');
 assert.equal(x.direction,'up');
 assert.equal(x.comparedDirection,'up');
 assert.deepEqual(x.cards.map(c=>c.value),['4/4','입력 일치','확인','0건']);
 assert.equal(x.marketDataVerified,false);
 assert.equal(x.calendarVerified,false);
 assert.equal(x.tradeAuthorized,false);
 assert.equal(x.accountDataAccessed,false);
 assert.equal(x.requestsIssued,0);
});

test('known NH_NO_PRICE is informative but does not read or disclose any account',()=>{
 const f=fixture();f.events=[event('NH_NO_PRICE')];
 const x=run(f);
 assert.equal(x.status,'caution');
 assert.equal(x.direction,'unavailable');
 assert.equal(x.gateStatus,'qualified-close');
 assert.equal(x.events.length,1);
 assert.equal(x.events[0].code,'NH_NO_PRICE');
 assert.equal(x.events[0].label,'KOSPI 200 선물');
 assert.equal(x.events[0].title,'선물 시세 미수신');
 assert.match(x.events[0].action,/종목코드|만기/);
 assert.equal(x.cards[3].value,'1건');
});

test('source identity errors from existing data gate become actionable per-symbol findings',()=>{
 const f=fixture();delete f.sources['^SOX'];
 const x=run(f);
 assert.equal(x.status,'hold');
 assert.equal(x.direction,'unavailable');
 assert.ok(x.issues.some(row=>row.symbol==='^SOX'&&row.code==='SOURCE_UNIDENTIFIED'));
 assert.ok(x.issues.some(row=>row.label==='SOX'));
});

test('market cross-date discrepancy is not silently described as current or a bullish signal',()=>{
 const f=fixture();
 f.quotes['^SOX'].observedAt=Date.parse('2026-11-19T16:00:00-05:00');
 const x=run(f);
 assert.equal(x.status,'hold');
 assert.equal(x.marketDate,null);
 assert.equal(x.direction,'unavailable');
 assert.ok(x.issues.some(row=>row.code==='MARKET_DATE_MISMATCH'));
 assert.match(x.summary,/판단 보류/);
});

test('missing required prices never cause synthetic zero or false direction',()=>{
 const f=fixture();delete f.quotes['^IXIC'];
 const x=run(f);
 assert.equal(x.status,'hold');
 assert.equal(x.cards[0].value,'3/4');
 assert.ok(x.issues.some(row=>row.code==='QUOTE_MISSING'));
});

test('declared real-time quote cannot claim confirmed close',()=>{
 const f=fixture();f.quotes['^DJI'].phase='realtime';
 const x=run(f);
 assert.equal(x.gateStatus,'indicative-only');
 assert.equal(x.status,'caution');
 assert.equal(x.direction,'unavailable');
 assert.equal(x.cards[2].value,'미확인');
});

test('stale receipt or last refresh failed makes evidence unusable',()=>{
 const a=fixture();a.receivedAt['^SOX']=NOW-35*60000;
 assert.equal(run(a).status,'hold');
 assert.ok(run(a).issues.some(x=>x.code==='RECEIPT_STALE'));
 const b=fixture();b.quotes['^GSPC'].refreshFailed=true;
 assert.ok(run(b).issues.some(x=>x.code==='LAST_REFRESH_FAILED'));
});

test('known HTTP error is bounded, safe and preserves only non-sensitive integer metadata',()=>{
 const f=fixture();f.events=[event('RELAY_BUSY',{layer:'relay',http:503})];
 const x=run(f);
 assert.equal(x.events[0].http,503);
 assert.equal(x.events[0].layer,'relay');
 assert.equal(x.events[0].severity,'warning');
 assert.match(x.events[0].action,/재시도/);
});

test('known authentication and target mismatch errors require explicit review',()=>{
 const f=fixture();f.events=[event('AUTH_REQUIRED',{layer:'gas'})];
 assert.equal(run(f).status,'review-required');
 f.events=[event('RELAY_TARGET_MISMATCH',{layer:'relay'})];
 assert.equal(run(f).status,'review-required');
});

test('unknown error codes are mapped to safe public fallback without echoing raw error',()=>{
 const f=fixture();
 f.events=[event('secret-token-value')];
 const x=run(f);
 assert.equal(x.events[0].code,'UNKNOWN_PUBLIC_READ_FAILURE');
 assert.equal(JSON.stringify(x).includes('secret-token-value'),false);
 assert.equal(x.events[0].title,'공개 시장 오류 원인 미확인');
});

test('unrecognized targets never echo arbitrary URLs or account identifiers',()=>{
 const f=fixture();
 f.events=[event('NH_NO_PRICE',{target:'https://private.example/x?token=secret'})];
 const x=run(f);
 assert.equal(x.events[0].target,'UNKNOWN_TARGET');
 assert.equal(x.events[0].label,'조회 대상 미확인');
 assert.equal(JSON.stringify(x).includes('private.example'),false);
 assert.equal(JSON.stringify(x).includes('token=secret'),false);
});

test('account-scoped diagnostics are never included in public-market output',()=>{
 const f=fixture();f.events=[event('NH_NO_PRICE',{scope:'account',target:'account:sessionInfo',
  message:'private user balance 123456',response:{token:'private'}})];
 const x=run(f);
 assert.equal(x.events.length,0);
 assert.equal(x.cards[3].value,'0건');
 assert.equal(JSON.stringify(x).includes('123456'),false);
});

test('user-provided private metadata cannot leak into public event projection',()=>{
 const f=fixture();
 f.events=[event('READ_NETWORK',{
  id:'PRIVATE-REQUEST-ID',message:'Authorization: Bearer LONGPRIVATEKEY',requestUrl:'https://bank.test',
  body:'private account 123456',headers:{authorization:'secret'},attempts:12
 })];
 const x=run(f);
 const output=JSON.stringify(x);
 for(const secret of ['PRIVATE-REQUEST-ID','LONGPRIVATEKEY','bank.test','123456','secret']){
  assert.equal(output.includes(secret),false,secret);
 }
});

test('repeat events are collapsed and flagged after three occurrences',()=>{
 const f=fixture();f.events=[
  event('NH_NO_PRICE',{at:new Date(NOW-3000).toISOString()}),
  event('NH_NO_PRICE',{at:new Date(NOW-2000).toISOString()}),
  event('NH_NO_PRICE',{at:new Date(NOW-1000).toISOString()})
 ];
 const x=run(f);
 assert.equal(x.events.length,1);
 assert.equal(x.events[0].count,3);
 assert.equal(x.events[0].repeated,true);
 assert.equal(x.cards[3].value,'3건');
 assert.equal(x.events[0].firstSeenAt,NOW-3000);
 assert.equal(x.events[0].lastSeenAt,NOW-1000);
});

test('different public targets are preserved separately without unrecognized target expansion',()=>{
 const f=fixture();f.events=[
  event('NH_NO_PRICE',{target:'future:k3'}),
  event('NH_NO_PRICE',{target:'future:k4'}),
  event('NH_NO_PRICE',{target:'future:k4'})
 ];
 const x=run(f);
 assert.equal(x.events.length,2);
 assert.equal(x.events.find(e=>e.target==='future:k4').count,2);
 assert.equal(x.events.find(e=>e.target==='future:k3').count,1);
});

test('future, ancient and invalid event times are discarded',()=>{
 const f=fixture();f.events=[
  event('NH_NO_PRICE',{at:new Date(NOW+6*60000).toISOString()}),
  event('NH_NO_PRICE',{at:new Date(NOW-8*86400000).toISOString()}),
  event('NH_NO_PRICE',{at:'not a timestamp'})
 ];
 assert.equal(run(f).events.length,0);
 assert.equal(diagnostics.errorTime('2026-11-20T11:20:00Z'),
  Date.parse('2026-11-20T11:20:00Z'));
 assert.equal(diagnostics.errorTime('2026-11-20'),null);
});

test('array cap is fail-closed rather than truncating unknown unbounded data',()=>{
 const f=fixture();f.events=Array.from({length:51},()=>event());
 assert.equal(run(f).status,'invalid');
 assert.equal(run(f).code,'INVALID_EVENT_COLLECTION');
 assert.equal(run({...f,events:'not array'}).code,'INVALID_EVENT_COLLECTION');
});

test('invalid market and clock are rejected without querying external data',()=>{
 assert.equal(run({...fixture(),market:'TICK'}).status,'invalid');
 assert.equal(run({...fixture(),now:NaN}).code,'INVALID_CLOCK');
});

test('read cancelled is informational only and does not imply market data corruption',()=>{
 const f=fixture();f.events=[event('READ_CANCELLED')];
 const x=run(f);
 assert.equal(x.status,'evidence-coherent');
 assert.equal(x.events[0].severity,'info');
});

test('result does not mutate caller input and remains deterministic on repeated calls',()=>{
 const f=fixture();f.events=[event('NH_STALE')];
 const original=JSON.stringify(f);
 const a=run(f),b=run(f);
 assert.equal(JSON.stringify(f),original);
 assert.deepEqual(a,b);
});

test('source is standalone; code never reads network, accounts, body or user storage',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/market-quality-diagnostics-v1.js'),'utf8');
 for(const snippet of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
   'PropertiesService.', 'getAccount(', 'placeOrder(', 'console.log(', 'console.error(']){
  assert.equal(src.includes(snippet),false,snippet);
 }
});
