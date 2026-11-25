'use strict';
const assert=require('node:assert/strict');
const Adapter=require('../js/analysis-change-snapshot.js');
const Tracker=require('../js/analysis-change-tracker.js');
const day1='2026-11-20',day2='2026-11-23';
function inputs(day,withRisk=false){
 const row={symbol:'SERV',market:'US',intent:'candidate',mode:'swing',asOf:day,
 reviewLane:withRisk?'risk-review':'technical-watch',blocked:withRisk,requiresEvidence:false,
 observedTechnicalCondition:true,blocking:withRisk?['event-near']:[],quantity:172,
 accountNumber:'PRIVATE_ACCOUNT',token:'PRIVATE_TOKEN',avgPrice:10};
 const audit={schemaVersion:1,market:'US',mode:'swing',nowDay:day,status:'ready',canPresentAsVerified:true,
 evidence:['market','sector','stock','event'].map(component=>({component,status:'usable',details:{accountId:'PRIVATE_ACCOUNT'}}))};
 const queue={schemaVersion:1,mode:'swing',evaluatedOn:day,candidateQueue:{items:[row]},holdingQueue:{items:[]},
 owner:'PRIVATE_USER'};
 const regime={region:'US',status:'descriptive',direction:{state:withRisk?'down':'up'},risk:{level:withRisk?'high':'reference-low'},
 evidence:[{referenceDay:day},{referenceDay:day}]};
 const sector={id:'TECH',market:'US',status:'descriptive',asOf:day,rotation:{status:'descriptive',
 relative5dPp:withRisk?1.2:3.6,relative20dPp:4}};
 return {day,audit,queue,regime,sector};
}
const previous=Adapter.make(inputs(day1)),current=Adapter.make(inputs(day2,true));
assert.equal(previous.status,'ready');
assert.equal(current.status,'ready');
assert.equal(previous.snapshot.signals.market.direction,'up');
assert.equal(current.snapshot.signals.market.direction,'down');
assert.equal(JSON.stringify(previous).includes('PRIVATE_'),false);
assert.equal(JSON.stringify(current).includes('"quantity"'),false);
assert.equal(JSON.stringify(current).includes('"avgPrice"'),false);
const changes=Tracker.compare({previous:previous.snapshot,current:current.snapshot,today:'2026-11-24'});
assert.equal(changes.status,'comparable');
assert.equal(changes.changes.some(x=>x.kind==='risk-escalated'),true);
assert.equal(changes.changes.some(x=>x.kind==='market-direction-changed'),true);
assert.equal(changes.changes.some(x=>x.kind==='market-risk-changed'),true);
assert.equal(changes.changes.some(x=>x.kind==='sector-relative-strength-changed'),true);
assert.equal(Adapter.make({...inputs(day2),day:'2026-11-24'}).status,'unavailable','wrong snapshot date');
assert.equal(Adapter.make({...inputs(day2),queue:null}).status,'unavailable');
assert.equal(Adapter.make({...inputs(day2),audit:{...inputs(day2).audit,evidence:[]}}).status,'unavailable');
const absent=Adapter.make({...inputs(day2),regime:null});
assert.equal(absent.status,'ready');
assert.equal(absent.snapshot.signals,undefined,'missing verified market must not create signal');
const corrupt=inputs(day2);corrupt.queue.candidateQueue.items[0].symbol='BAD!';
assert.equal(Adapter.make(corrupt).status,'unavailable');
const cross=inputs(day2);cross.queue.candidateQueue.items[0].market='KR';
assert.equal(Adapter.make(cross).status,'unavailable');
assert.equal(typeof Adapter.fetch,'undefined');
assert.equal(typeof Adapter.placeOrder,'undefined');
console.log('Analysis change snapshot adapter: end-to-end conversion, privacy, missing-source fallback PASS');
