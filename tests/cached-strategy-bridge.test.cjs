'use strict';
const assert=require('node:assert/strict');
const Bridge=require('../js/cached-strategy-bridge.js');
const Integrated=require('../js/integrated-strategy-engine.js');
const Events=require('../js/integrated-event-adapter.js');
const Queue=require('../js/opportunity-review-queue.js');
const day='2026-11-23',symbol='SERV';
const stock={status:'descriptive',symbol,market:'US',mode:'swing',asOf:day,
 evidence:{symbol,market:'US',source:'Yahoo verified',asOf:day,observations:80},
 setup:{status:'descriptive',trend:'up',candidates:[{type:'breakout_swing',label:'verified'}]},
 references:{lastClose:15,supportStatus:'reference-only',observedSupport:13,
  riskToObservedSupportPct:13.33,atrPct:3.2},
 relative:{status:'unavailable',reason:'benchmark not connected'}};
const marketRegime={status:'descriptive',region:'US',direction:{state:'up'},
 execution:{swing:'context-only'},momentum:{state:'strengthening'},
 risk:{level:'reference-low'},evidence:[{symbol:'^GSPC',referenceDay:day,source:'index',asOf:day},
 {symbol:'^IXIC',referenceDay:day,source:'index',asOf:day}]};
const coverage={BLS:true,BEA:true,BOK_STAT:true,EARNINGS:true,FED:true,BOK_MPC:true};
const event={category:'earnings',publisher:'',type:'earnings',date:'2026-11-25',dateStatus:'confirmed',
 verified:true,symbol,sourceUrl:'https://www.sec.gov/edgar/'};
const publicEvents={coverage,events:[event]};
const privateRecord={verified:true,symbol,market:'US',currency:'USD',quantity:172,avgPrice:10,
 accountNumber:'SECRET-ACCOUNT',broker:'SECRET-BROKER',token:'SECRET-TOKEN'};
const input={selection:{symbol,market:'US',mode:'swing'},stockSetup:stock,
 marketRegime,publicEvents,holdingRows:[privateRecord],nowDay:day};
const old={integrated:globalThis.MYInvestIntegratedStrategy,
 events:globalThis.MYInvestIntegratedEventAdapter,queue:globalThis.MYInvestOpportunityQueue};
globalThis.MYInvestIntegratedStrategy=Integrated;
globalThis.MYInvestIntegratedEventAdapter=Events;
globalThis.MYInvestOpportunityQueue=Queue;
try{
 let out=Bridge.evaluate(input);
 assert.equal(out.status,'review-required');
 assert.equal(out.candidate.action,'review-only');
 assert.equal(out.candidate.eventCoverage,'complete');
 assert.equal(out.candidate.verifiedEvents,1);
 assert.equal(out.candidate.blocking.includes('event-near'),true,'confirmed issuer earnings risk must survive public adapter');
 assert.equal(out.candidate.blocking.includes('sector-unverified'),true,'do not invent issuer/sector links');
 assert.equal(out.candidate.blocking.includes('relative-unverified'),true,'stock benchmark must stay unknown');
 assert.equal(out.holdingCount,1);
 assert.equal(out.holdingQueueAvailable,true);
 assert.equal(out.holdings[0].blocking.includes('event-near'),true);
 assert.equal(out.queue.candidateQueue[0].reviewLane,'risk-review');
 assert.equal(out.queue.holdingQueue[0].reviewLane,'risk-review');
 assert.equal(JSON.stringify(out).includes('SECRET-'),false);
 assert.equal(JSON.stringify(out).includes('"quantity"'),false);
 assert.equal(JSON.stringify(out).includes('"avgPrice"'),false);
 assert.equal(JSON.stringify(out).includes('costReturnPct'),false);
 const multiple=Bridge.evaluate({...input,holdingRows:[privateRecord,{...privateRecord,avgPrice:18,accountNumber:'SECRET-SECOND'}]});
 assert.equal(multiple.holdingCount,2);
 assert.equal(multiple.holdingQueueAvailable,false,'never let first of multiple accounts stand in for every account');
 assert.equal(multiple.queue.holdingQueue.length,0);
 assert.equal(JSON.stringify(multiple).includes('SECRET-'),false);
 out=Bridge.evaluate({...input,holdingRows:[{...privateRecord,currency:'KRW'}]});
 assert.equal(out.holdingCount,0);
 out=Bridge.evaluate({...input,publicEvents:{coverage:{...coverage,EARNINGS:false},events:[event]}});
 assert.equal(out.candidate.eventCoverage,'partial');
 assert.equal(out.candidate.blocking.includes('event-near'),true,'known event remains a warning despite incomplete coverage');
 out=Bridge.evaluate({...input,publicEvents:null});
 assert.equal(out.candidate.blocking.includes('events-unverified'),true);
 out=Bridge.evaluate({...input,marketRegime:{...marketRegime,region:'KR'}});
 assert.equal(out.candidate.blocking.includes('market-unverified'),true);
 out=Bridge.evaluate({...input,stockSetup:{...stock,status:'insufficient'}});
 assert.equal(out.status,'insufficient');
 out=Bridge.evaluate({...input,selection:{...input.selection,symbol:'005930',market:'US'}});
 assert.equal(out.status,'unavailable');
 assert.equal(typeof Bridge.fetch,'undefined');
 assert.equal(typeof Bridge.placeOrder,'undefined');
}finally{
 globalThis.MYInvestIntegratedStrategy=old.integrated;
 globalThis.MYInvestIntegratedEventAdapter=old.events;
 globalThis.MYInvestOpportunityQueue=old.queue;
}
console.log('Cached strategy bridge: issuer-specific events, candidate/holding separation, missing-sector fail closed, privacy PASS');
