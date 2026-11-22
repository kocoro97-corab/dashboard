'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const candidate=require('../js/five-minute-read-candidate-v1.js');
const NOW=Date.parse('2026-11-20T22:00:00Z'),start=NOW/1000-3600,end=start+900;
function fixture(){return {chart:{error:null,result:[{meta:{symbol:'AAPL',currency:'USD',exchangeName:'NMS',exchangeTimezoneName:'America/New_York',instrumentType:'EQUITY',dataGranularity:'5m',currentTradingPeriod:{regular:{start,end}}},timestamp:[start,start+300,start+600,end],indicators:{quote:[{open:[10,11,12,13],high:[12,13,14,13],low:[9,10,11,13],close:[11,12,13,13],volume:[100,200,300,0]}]}}]}}}
test('disabled by default: zero transport calls and no browser fallback',async()=>{
 let calls=0;const reader=candidate.create({readJSON:async()=>{calls++;return fixture()}});
 const r=await reader.read('AAPL');assert.equal(r.code,'INTRADAY_NOT_ACTIVATED');assert.equal(calls,0);assert.equal(r.canPlaceOrder,false);
});
test('only exact pilot URL; query expansion, redirects and other instruments not granted',()=>{
 const p=candidate.plan('AAPL');assert.equal(p.status,'DISABLED_CANDIDATE');assert.equal(candidate.candidateUrl(p.url),true);
 for(const value of [p.url+'&token=x',p.url+'#x',p.url.replace('https:','http:'),p.url.replace('AAPL','MSFT'),p.url.replace('5m','1m'),p.url.replace('1d','5d'),p.url.replace('yahoo.com','yahoo.com.evil'),p.url.replace('/AAPL','/%41APL')])assert.equal(candidate.candidateUrl(value),false,value);
 assert.equal(candidate.plan('005930').code,'KR_SESSION_WINDOW_UNRESOLVED');assert.equal(candidate.plan('MSFT').code,'UNVERIFIED_INTRADAY_PILOT');
});
test('reference schema excludes terminal point and cannot masquerade as daily analysis',()=>{
 const r=candidate.parse(fixture(),NOW);assert.equal(r.status,'REFERENCE_ONLY');assert.equal(r.data.candles.length,3);assert.equal(r.data.terminalPointsExcluded,1);assert.equal(r.data.providerWindowFullyObserved,true);
 for(const key of ['realTimeVerified','exchangeSessionVerified','priceFinalizedVerified','tradeVwapVerified','signalReady','accountConnected','canPlaceOrder'])assert.equal(r[key],false);
 assert.equal(r.symbol,undefined);assert.equal(r.bars,undefined);
});
test('wrong currency, instrument, timezone or timeframe rejected',()=>{
 for(const [key,value] of [['currency','KRW'],['symbol','005930.KS'],['instrumentType','ETF'],['exchangeTimezoneName','UTC'],['dataGranularity','1d']]){const f=fixture();f.chart.result[0].meta[key]=value;assert.equal(candidate.parse(f,NOW).code,'IDENTITY_CURRENCY_TIMEFRAME_MISMATCH')}
});
test('future/duplicate bars, missing volume and malformed prices never fabricated',()=>{
 const mutations=[r=>r.timestamp[1]=r.timestamp[0],r=>r.timestamp[1]++,r=>r.timestamp[3]=NOW/1000+1,r=>r.indicators.quote[0].volume[1]=null,r=>r.indicators.quote[0].low[1]=100,r=>r.indicators.quote[0].volume[3]=99];
 for(const mutate of mutations){const f=fixture();mutate(f.chart.result[0]);assert.equal(candidate.parse(f,NOW).ok,false)}
});
test('unclosed bar excluded; partial provider window is not certified complete',()=>{
 const r=candidate.parse(fixture(),(start+750)*1000);assert.equal(r.ok,false); // Future terminal marker invalidates this response.
 const f=fixture();for(const k of ['timestamp'])f.chart.result[0][k].pop();for(const k of ['open','high','low','close','volume'])f.chart.result[0].indicators.quote[0][k].pop();
 const partial=candidate.parse(f,(start+750)*1000);assert.equal(partial.ok,true);assert.equal(partial.data.incompleteBarsExcluded,1);assert.equal(partial.data.providerWindowFullyObserved,false);assert.equal(partial.signalReady,false);
 f.chart.result[0].indicators.quote[0].close[2]=null;assert.equal(candidate.parse(f,(start+750)*1000).ok,true); // An unfinished, unused bar is not zero-filled.
});
test('explicit mock capability calls only the supplied transport once; concurrent reads coalesce',async()=>{
 let calls=0,resolve;const reader=candidate.create({readJSON:url=>{assert.equal(candidate.candidateUrl(url),true);calls++;return new Promise(r=>resolve=r)},capability:()=>true,now:()=>NOW});
 const a=reader.read('AAPL'),b=reader.read('AAPL');assert.equal(calls,1);assert.equal(a,b);resolve(fixture());assert.equal((await a).ok,true);
});
test('invalidation and destruction discard late results without retaining source data',async()=>{
 let resolve;const reader=candidate.create({capability:()=>true,now:()=>NOW,readJSON:()=>new Promise(r=>resolve=r)});
 const request=reader.read('AAPL');reader.invalidate();resolve(fixture());assert.equal((await request).code,'STALE_RESULT_DISCARDED');
 const next=reader.read('AAPL');reader.destroy();resolve(fixture());assert.equal((await next).code,'STALE_RESULT_DISCARDED');assert.equal((await reader.read('AAPL')).code,'DESTROYED');
});
test('raw errors/private fields not echoed and no retry/fallback',async()=>{
 let calls=0;const reader=candidate.create({capability:()=>true,readJSON:async()=>{calls++;throw Error('PRIVATE_TOKEN')}});const r=await reader.read('AAPL');assert.equal(r.code,'INTRADAY_READ_FAILED');assert.equal(JSON.stringify(r).includes('PRIVATE_TOKEN'),false);assert.equal(calls,1);
 const f=fixture();f.secret='PRIVATE_TOKEN';assert.equal(JSON.stringify(candidate.parse(f,NOW)).includes('PRIVATE_TOKEN'),false);
});
test('capability revoked during a read discards its result even without an explicit invalidation',async()=>{
 let enabled=true,resolve;const reader=candidate.create({capability:()=>enabled,now:()=>NOW,readJSON:()=>new Promise(r=>resolve=r)});
 const pending=reader.read('AAPL');enabled=false;resolve(fixture());assert.equal((await pending).code,'STALE_RESULT_DISCARDED');
});
