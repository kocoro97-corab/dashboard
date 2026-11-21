'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {project}=require('../js/strategy-market-link-v1.js');
const now=Date.parse('2026-11-20T22:00:00Z');
function fixture(kr=true){
 const symbol=kr?'005930':'AAPL',bars=Array.from({length:65},(_,i)=>({t:now-(66-i)*86400000,o:100+i,h:103+i,l:99+i,c:101+i}));
 return {selection:{symbol,name:'test',market:kr?'KR':'US'},analysis:{symbol,provider:kr?symbol+'.KS':symbol,exchange:kr?'KSC':'NMS',currency:kr?'KRW':'USD',source:'Yahoo Finance',bars,metrics:{last:bars.at(-1).c},observedAt:bars.at(-1).t,receivedAt:now-1000}};
}
const cases=[{name:'existing swing case',entry:160,stop:150,target2:180}];
test('projects KR and US public analysis; no account mapping or new signal generation',()=>{
 for(const kr of [true,false]){const f=fixture(kr),s=project(f.analysis,f.selection,{now,scenarios:cases});assert.equal(s.status,'ready');assert.equal(s.currency,kr?'KRW':'USD');assert.equal(s.lastClose,165);assert.equal(s.cases[0].target,180);assert.equal(s.daySignalsAvailable,false);assert.equal(s.accountConnected,false);assert.equal(s.priceBasis,'DAILY_BAR_C_NOT_REALTIME_OR_FINALIZED')}
});
test('wrong symbol/currency/provider/exchange fails closed',()=>{
 for(const [key,value] of [['symbol','000660'],['currency','USD'],['provider','000660.KS'],['exchange','NMS']]){const f=fixture();f.analysis[key]=value;assert.equal(project(f.analysis,f.selection,{now}).status,'unavailable')}
});
test('missing, future and stale bar/received times are not replaced',()=>{
 for(const [key,value] of [['observedAt',null],['observedAt',now+1],['observedAt',now-5*86400000],['receivedAt',null],['receivedAt',now+1],['receivedAt',now-300001]]){const f=fixture();f.analysis[key]=value;assert.equal(project(f.analysis,f.selection,{now}).status,'unavailable')}
});
test('duplicate/reversed/future/malformed bars and price mismatch rejected',()=>{
 const mutations=[a=>a.bars[2].t=a.bars[1].t,a=>a.bars.reverse(),a=>a.bars[2].t=now+1,a=>a.bars[3].h=0,a=>a.metrics.last=1,a=>a.bars=a.bars.slice(-59)];
 for(const mutate of mutations){const f=fixture();mutate(f.analysis);assert.equal(project(f.analysis,f.selection,{now}).status,'unavailable')}
});
test('invalid cases omitted, inputs unchanged, private account fields not projected',()=>{
 const f=fixture();f.analysis.accountNumber='PRIVATE';const before=JSON.stringify(f);const out=project(f.analysis,f.selection,{now,scenarios:[{...cases[0],stop:200}]});assert.equal(out.status,'ready');assert.deepEqual(out.cases,[]);assert.equal(JSON.stringify(out).includes('PRIVATE'),false);assert.equal(JSON.stringify(f),before)
});
