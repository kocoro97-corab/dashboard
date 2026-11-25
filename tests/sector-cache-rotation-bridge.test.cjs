'use strict';
const assert=require('node:assert/strict');
const Proof=require('../js/exchange-session-proof.js');
const Adapter=require('../js/sector-rotation-adapter.js');
const Engine=require('../js/sector-rotation-engine.js');
const Bridge=require('../js/sector-cache-rotation-bridge.js');
const now=Date.now(),today=Proof.localDay(now,'America/New_York');
const until=Date.parse(today+'T00:00:00Z'),days=[];
for(let i=145;i>=1;i--){
 const d=new Date(until-i*86400000);
 if(![0,6].includes(d.getUTCDay()))days.push(d.toISOString().slice(0,10));
}
const t=days.map(x=>Math.floor(Date.parse(x+'T16:00:00Z')/1000));
const meta={exchangeTimezoneName:'America/New_York'};
const proof=Proof.infer({market:'US',meta,timestamps:t,now});
assert.equal(proof.status,'ready');
const series=(symbol,step)=>({symbol,currency:'USD',exchange:'NMS',instrumentType:'ETF',
 bars:days.map((_,i)=>100+i*step),times:t,volume:days.map(()=>10000),
 sessionDates:proof.dates,sessionProof:{status:'ready',zone:proof.zone,closedDates:proof.closedDates}});
const spy=series('SPY',0.5),tech=series('XLK',1.0),fin=series('XLF',0.2);
const saved={adapter:globalThis.MYInvestSectorSeriesAdapter,engine:globalThis.MYInvestSectorRotation};
try{
 globalThis.MYInvestSectorSeriesAdapter=Adapter;
 globalThis.MYInvestSectorRotation=Engine;
 let r=Bridge.evaluate({market:'US',benchmark:spy,
  rows:[{symbol:'XLK',name:'Technology',v:tech},{symbol:'XLF',name:'Financials',v:fin}],nowDay:today});
 assert.equal(r.status,'descriptive');
 assert.equal(r.candidates.length,2);
 assert.equal(r.rotation[0].id,'XLK');
 assert.equal(r.candidates[0].periods['1d'].status,'ready');
 assert.equal(r.candidates[0].periods['5d'].status,'ready');
 assert.equal(r.candidates[0].periods['20d'].status,'ready');
 assert.equal(r.candidates[0].periods['60d'].status,'ready');
 assert.equal(r.candidates[0].breadth.status,'unavailable','ETF is not breadth');
 assert.equal(r.candidates[0].turnover.status,'unavailable','ETF-only quote is not an industry capital flow');
 assert.equal(r.candidates[0].isProxy,true);
 r=Bridge.evaluate({market:'US',benchmark:spy,
  rows:[{symbol:'XLK',name:'Technology',v:{...tech,sessionProof:{status:'unavailable'}}}],nowDay:today});
 assert.equal(r.status,'unavailable');
 r=Bridge.evaluate({market:'US',benchmark:{...spy,symbol:'XLF'},
  rows:[{symbol:'XLK',name:'Technology',v:tech}],nowDay:today});
 assert.equal(r.status,'unavailable');
 assert.equal(typeof Bridge.fetch,'undefined');
}finally{
 globalThis.MYInvestSectorSeriesAdapter=saved.adapter;
 globalThis.MYInvestSectorRotation=saved.engine;
}
console.log('Cached SPY and sector ETF -> strict session adapter -> rotation engine PASS');
