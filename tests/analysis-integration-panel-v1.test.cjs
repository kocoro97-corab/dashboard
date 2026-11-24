'use strict';
const assert=require('node:assert/strict');
const P=require('../js/analysis-integration-panel-v1.js');
const now=Date.parse('2026-11-24T10:00:00Z'),symbol='SERV';
const times=Array.from({length:25},(_,i)=>({t:now-(25-i)*86400000,o:100+i,h:102+i,l:99+i,c:101+i,v:1000}));
function data(){return {symbol,currency:'USD',exchange:'NMS',source:'Yahoo Finance (SERV)',bars:times,observedAt:now-600000,receivedAt:now-300000}}
function input(){return {selection:{symbol,market:'US',mode:'swing'},analysis:data(),now,
 quotes:{'^GSPC':{p:6000,prev:5900,observedAt:now-600000},'^IXIC':{p:22000,prev:21900,observedAt:now-600000}},
 quoteSources:{'^GSPC':'Y','^IXIC':'Y'},received:{'^GSPC':now-300000,'^IXIC':now-300000}}}
let r=P.evaluate(input());
assert.equal(r.status,'partial');
assert.equal(r.symbol,'SERV');
assert.equal(r.checks.length,6);
assert.equal(r.checks.find(x=>x.key==='ohlcv').state,'received');
assert.equal(r.checks.find(x=>x.key==='session').state,'missing');
assert.equal(r.canUseStrictStockSetup,false);
assert.equal(r.receivedAt,new Date(now-300000).toISOString());
const staleSource=P.evaluate({...input(),analysis:{...data(),observedAt:now-5*86400000}});
assert.equal(staleSource.checks.find(x=>x.key==='ohlcv').state,'missing',
 'fresh receipt of 5-day-old price cannot be reported as verified');
const malformed=P.evaluate({...input(),analysis:{...data(),bars:times.map((b,i)=>i===0?{...b,h:5}:b)}});
assert.equal(malformed.checks.find(x=>x.key==='ohlcv').state,'missing',
 'inconsistent OHLC bars cannot be accepted');

assert.equal(JSON.stringify(r).includes('PRIVATE_ACCOUNT'),false);
r=P.evaluate({...input(),selection:null});
assert.equal(r.status,'unavailable');
r=P.evaluate({...input(),analysis:{...data(),currency:'KRW'}});
assert.equal(r.checks.find(x=>x.key==='ohlcv').state,'missing');
r=P.evaluate({...input(),analysis:{...data(),receivedAt:now-7200000}});
assert.equal(r.checks.find(x=>x.key==='ohlcv').state,'missing');
r=P.evaluate({...input(),selection:{symbol:'005930',market:'KR',mode:'day'}});
assert.equal(r.symbol,'005930');
assert.equal(r.mode,'day');
r=P.evaluate({...input(),selection:{symbol:'SERV',market:'KR'}});
assert.equal(r.status,'unavailable');
const engine=require('../js/market-regime-engine.js');
const before=globalThis.MYInvestMarketRegime;
globalThis.MYInvestMarketRegime=engine;
try{
 const verified=P.evaluate(input());
 assert.equal(verified.checks.find(x=>x.key==='market').state,'usable');
 assert.equal(verified.marketRegime.direction.state,'up');
 assert.equal(verified.checks.find(x=>x.key==='marketRisk').state,'missing',
  'missing VIX cannot imply low risk');
 assert.equal(verified.canUseStrictStockSetup,false,'market proof never fabricates stock daily session dates');
}finally{globalThis.MYInvestMarketRegime=before}
assert.equal(typeof P.fetch,'undefined');
assert.equal(typeof P.placeOrder,'undefined');
assert.throws(()=>P.evaluate({now:Infinity}),/ANALYSIS_BRIDGE_DATE_INVALID/);
console.log('Strategy integration readiness panel: cached real input gating, no-fetch and privacy PASS');
