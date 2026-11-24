'use strict';
const assert=require('node:assert/strict');
const Session=require('../js/exchange-session-proof.js');
const Adapter=require('../js/stock-setup-adapter.js');
const Setup=require('../js/stock-setup-engine.js');
const Panel=require('../js/analysis-integration-panel-v1.js');
const SectorAdapter=require('../js/sector-rotation-adapter.js');
const now=Date.now(),dayMS=86400000;
const chartDays=[];
const before=new Date(Session.localDay(now,'America/New_York')+'T00:00:00Z');
for(let i=100;i>=1;i--){
 const date=new Date(Date.UTC(before.getUTCFullYear(),before.getUTCMonth(),before.getUTCDate())-i*dayMS);
 if(date.getUTCDay()===0||date.getUTCDay()===6)continue;
 chartDays.push(date.toISOString().slice(0,10));
}
const stamps=chartDays.map(d=>Date.parse(d+'T16:00:00Z'));
const bars=chartDays.map((d,i)=>{
 const c=100+i*0.6;
 return {t:stamps[i],o:c-0.5,h:c+1,l:c-1,c,v:i===chartDays.length-1?2000:1000};
});
const metadata={exchangeTimezoneName:'America/New_York',regularMarketTime:Math.floor((now-60000)/1000)};
const proof=Session.infer({market:'US',meta:metadata,timestamps:stamps.map(t=>Math.floor(t/1000)),now});
assert.equal(proof.status,'ready');
assert.equal(proof.dates.length,bars.length);
assert.equal(proof.closedDates.length,bars.length);
const analysis={symbol:'SERV',provider:'SERV',currency:'USD',exchange:'NMS',
 source:'Yahoo Finance (SERV)',bars,observedAt:stamps.at(-1),receivedAt:now-1000,
 sessionProof:proof};
const adapted=Adapter.adaptCached(analysis,{symbol:'SERV',market:'US'});
assert.equal(adapted.status,'ready');
assert.equal(adapted.bars.length,bars.length);
assert.equal(adapted.asOf,proof.dates.at(-1));
const newNowDay=Session.localDay(now,'America/New_York');
const setup=Setup.assess({symbol:'SERV',market:'US',currency:'USD',bars:adapted.bars,verified:true,
 source:adapted.source,nowDay:newNowDay,mode:'swing'});
assert.equal(setup.status,'descriptive');
assert.equal(setup.setup.trend,'up');
const old={session:globalThis.MYInvestExchangeSessionProof,adapter:globalThis.MYInvestStockSetupAdapter,
 setup:globalThis.MYInvestStockSetup};
try{
 globalThis.MYInvestExchangeSessionProof=Session;
 globalThis.MYInvestStockSetupAdapter=Adapter;
 globalThis.MYInvestStockSetup=Setup;
 const result=Panel.evaluate({selection:{symbol:'SERV',market:'US',mode:'swing'},analysis,now});
 assert.equal(result.canUseStrictStockSetup,true);
 assert.equal(result.checks.find(c=>c.key==='session').state,'usable');
 assert.equal(result.stockSetup.status,'descriptive');
 assert.equal(result.checks.find(c=>c.key==='industry').state,'missing');
 assert.equal(result.status,'partial','sector membership and public events still unverified');
 const bad=Panel.evaluate({selection:{symbol:'SERV',market:'US',mode:'swing'},
  analysis:{...analysis,sessionProof:{status:'unavailable',reason:'invalid timezone'}},now});
 assert.equal(bad.canUseStrictStockSetup,false);
 const mismatch=Panel.evaluate({selection:{symbol:'SERV',market:'US',mode:'swing'},
  analysis:{...analysis,sessionProof:{...proof,zone:'Asia/Seoul'}},now});
 assert.equal(mismatch.canUseStrictStockSetup,false);
 assert.equal(Adapter.adaptCached({...analysis,provider:'SPCH'},{symbol:'SERV',market:'US'}).status,'unavailable');
}finally{
 globalThis.MYInvestExchangeSessionProof=old.session;
 globalThis.MYInvestStockSetupAdapter=old.adapter;
 globalThis.MYInvestStockSetup=old.setup;
}
const sectorCache={symbol:'XLK',currency:'USD',exchange:'NMS',instrumentType:'ETF',
 bars:bars.map(x=>x.c),times:stamps.map(t=>Math.floor(t/1000)),volume:bars.map(x=>x.v),
 sessionDates:proof.dates,
 sessionProof:{status:'ready',zone:proof.zone,closedDates:proof.closedDates}};
const sector=SectorAdapter.adaptCached(sectorCache,{symbol:'XLK',market:'US'});
assert.equal(sector.status,'ready');
assert.equal(sector.bars.length,bars.length);
assert.equal(sector.bars.at(-1).date,proof.dates.at(-1));
assert.equal(SectorAdapter.adaptCached({...sectorCache,symbol:'XLF'},{symbol:'XLK',market:'US'}).status,'unavailable');
assert.equal(SectorAdapter.adaptCached({...sectorCache,sessionProof:{status:'unavailable'}},{symbol:'XLK',market:'US'}).status,'unavailable');
console.log('Existing Yahoo OHLCV cache -> exchange session proof -> strict stock engine -> strategy panel PASS');
