'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','js','market-source-priority.js'),'utf8');
const page=fs.readFileSync(path.join(__dirname,'..','js','page-market.js'),'utf8');
const market=fs.readFileSync(path.join(__dirname,'..','js','market.js'),'utf8');
function adapter(){const window={};new Function('window',source)(window);return window.MyInvestMarketSourcePriority}
function expiry(days){const d=new Date(Date.now()+days*86400000);return d.toISOString().slice(0,10).replace(/-/g,'')}
test('fallback priorities are ordered and never call unconfigured providers',async()=>{
 const p=adapter(),called=[];
 assert.equal(p.register('futures','NH_FUTURES',async()=>{called.push('NH_FUTURES');throw Object.assign(Error('failed'),{code:'NO_ENTITLEMENT'})}),true);
 assert.equal(p.register('futures','KIS',async()=>{called.push('KIS');return{product:'KOSDAQ150_FUT',verified:true,price:1200,previousClose:1190,contractCode:'A066C000',expiry:expiry(30),observedAt:Date.now()}}),true);
 const r=await p.resolve('futures');
 assert.deepEqual(called,['NH_FUTURES','KIS']);
 assert.equal(r.quote.provider,'KIS');
 assert.deepEqual(r.attempts.map(x=>x.status),['NOT_CONFIGURED','FAILED','OK']);
});
test('NH PLUG real-time provider wins before newly contracted providers',async()=>{
 const p=adapter(),called=[];
 p.register('futures','NH_PLUG_WS',async()=>{called.push('NH_PLUG_WS');return {product:'KOSDAQ150_FUT',verified:true,price:1201,previousClose:1190,contractCode:'A066C000',expiry:expiry(30),observedAt:Date.now()}});
 p.register('futures','NH_FUTURES',async()=>{called.push('NH_FUTURES');throw Error('must not run')});
 const r=await p.resolve('futures');assert.equal(r.quote.provider,'NH_PLUG_WS');assert.deepEqual(called,['NH_PLUG_WS']);
});
test('invalid first provider advances to the next validated contract',async()=>{
 const p=adapter();
 p.register('futures','NH_FUTURES',async()=>({product:'KOSDAQ150',price:1200,verified:true}));
 p.register('futures','KIS',async()=>({product:'KOSDAQ150_FUT',verified:true,price:1200,previousClose:1190,contractCode:'A066C000',expiry:expiry(21),observedAt:Date.now()}));
 const r=await p.resolve('futures');assert.equal(r.quote.provider,'KIS');assert.equal(r.attempts[1].status,'INVALID_OR_STALE');
});
test('future provider must verify instrument identity, expiration and timestamp',()=>{
 const p=adapter(),good={product:'KOSDAQ150_FUT',verified:true,price:1200,previousClose:1190,contractCode:'A066C000',expiry:expiry(30),observedAt:Date.now()};
 assert.ok(p.normalizeFutures(good,'KIS'));
 assert.equal(p.normalizeFutures({...good,product:'KOSDAQ150_INDEX'},'KIS'),null);
 assert.equal(p.normalizeFutures({...good,expiry:expiry(-7)},'KIS'),null);
 assert.equal(p.normalizeFutures({...good,observedAt:Date.now()-8*86400000},'KIS'),null);
});
test('NYSE TICK cannot accept cumulative symbol or stale observations',()=>{
 const p=adapter(),good={symbol:'TICK-NYSE',verified:true,value:1120,observedAt:Date.now()};
 assert.ok(p.normalizeTick(good,'IBKR'));
 assert.equal(p.normalizeTick({...good,symbol:'USI:TICK.NY'},'IBKR'),null);
 assert.ok(p.normalizeTick({...good,symbol:'$TICK'},'DXFEED'));
 assert.equal(p.normalizeTick({...good,symbol:'$TICK'},'IBKR'),null);
 assert.equal(p.normalizeTick({...good,value:50000},'IBKR'),null);
 assert.equal(p.normalizeTick({...good,observedAt:Date.now()-20*60000},'IBKR'),null);
});
test('NYSE TICK signal respects extreme thresholds and avoids false trading certainty',()=>{
 const p=adapter();
 assert.match(p.tickContext(1000),/강한 매수 우위/);
 assert.match(p.tickContext(-1000),/강한 매도 우위/);
 assert.match(p.tickContext(0),/균형/);
 assert.match(p.tickContext(NaN),/미확인/);
});
test('market card shows raw instant TICK widget without unauthorized iframe extraction',()=>{
 assert.match(page,/USI:TICK\.NY/);
 assert.match(page,/s\.tradingview\.com\/embed-widget\/single-quote\//);
 assert.ok(!/embed\(tickWidgetNode/.test(page),'Pages CSP does not permit the external widget bootstrap script');
 assert.match(page,/tickContext/);
 assert.ok(!/contentDocument|contentWindow\.(?:document|body)/.test(page));
 assert.match(market,/fillAuthorizedMarketSources/);
});
