'use strict';
const assert=require('node:assert/strict');
const Integrated=require('../js/integrated-strategy-engine.js');
const Queue=require('../js/opportunity-review-queue.js');
const date='2026-11-23';
const stock={
 status:'descriptive',symbol:'SERV',market:'US',mode:'swing',asOf:date,
 evidence:{symbol:'SERV',market:'US',asOf:date,source:'Verified daily chart'},
 setup:{status:'descriptive',trend:'up',candidates:[{type:'breakout_swing',label:'verified breakout'}]},
 relative:{status:'ready',period5:{status:'ready',relativePp:2},period20:{status:'ready',relativePp:5}},
 references:{lastClose:15,observedSupport:13,supportStatus:'reference-only',riskToObservedSupportPct:13.33,atrPct:3.2}
};
const regime={status:'descriptive',region:'US',direction:{state:'up'},
 execution:{swing:'context-only'},risk:{level:'reference-low'},momentum:{state:'strengthening'},
 evidence:[{symbol:'^GSPC',referenceDay:date,asOf:date,source:'market primary'},
 {symbol:'^IXIC',referenceDay:date,asOf:date,source:'market primary'}]};
const sector={id:'TECH',name:'Technology',market:'US',type:'sector_etf_proxy',status:'descriptive',
 asOf:date,source:'verified holdings',rotation:{status:'descriptive',relative5dPp:2.2,relative20dPp:3.3}};
const sectorLink={verified:true,symbol:'SERV',market:'US',sectorId:'TECH',asOf:date,source:'verified membership'};
const base={stock,regime,sector,sectorLink,event:{status:'ready',coverageVerified:true,events:[]},nowDay:date,mode:'swing'};
const candidate=Integrated.assess({...base,intent:'candidate'});
assert.equal(candidate.status,'observed');
const privateHolding={verified:true,symbol:'SERV',market:'US',currency:'USD',quantity:172,avgPrice:10,
 accountNumber:'PRIVATE-ACCT',userId:'PRIVATE-ID',token:'PRIVATE-TOKEN'};
const holding=Integrated.assess({...base,intent:'holding',holding:privateHolding});
assert.equal(holding.status,'observed');
const candidateRisk=Integrated.assess({...base,intent:'candidate',event:{status:'partial',coverageVerified:false,
 events:[{kind:'economic',type:'CPI',date:'2026-11-24',verified:true}]}});
assert.equal(candidateRisk.status,'review-required');
const result=Queue.collect({mode:'swing',nowDay:date,candidates:[candidate,candidateRisk],holdings:[holding]});
assert.equal(result.candidateQueue.reviewed,1,'duplicate candidate symbols must be deduplicated');
assert.equal(result.candidateQueue.errors.length,1);
assert.equal(result.holdingQueue.reviewed,1);
assert.equal(result.candidateQueue.items[0].reviewLane,'technical-watch');
assert.equal(result.holdingQueue.items[0].reviewLane,'monitor');
const riskOnly=Queue.collect({mode:'swing',nowDay:date,candidates:[candidateRisk]});
assert.equal(riskOnly.candidateQueue.items[0].reviewLane,'risk-review');
assert.equal(riskOnly.candidateQueue.items[0].blocked,true);
assert.equal(JSON.stringify(result).includes('PRIVATE-'),false);
assert.equal(JSON.stringify(result).includes('"quantity"'),false);
assert.equal(typeof Queue.submitOrder,'undefined');
console.log('Integrated strategy -> opportunity queue read-only contract PASS');
