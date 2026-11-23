'use strict';
const assert=require('node:assert/strict');
const Queue=require('../js/opportunity-review-queue.js');
const date='2026-11-23';
const base={
 schemaVersion:1,intent:'candidate',mode:'swing',symbol:'SERV',market:'US',asOf:date,status:'observed',
 action:'review-only',label:'검증된 관찰조건',reasons:[],blocking:[],
 conditions:['확정 일봉 스윙 관찰조건 충족','종목 5일 상대강도 우위'],
 evidence:[{kind:'stock',symbol:'SERV',asOf:date,source:'confirmed OHLCV'},
   {kind:'market',symbol:'^GSPC',source:'verified market',asOf:date}],
 marketContext:{status:'verified',direction:'up',riskLevel:'reference-low'},
 sectorContext:{status:'verified',asOf:date,source:'verified membership'},
 reference:{status:'observed',support:14,referenceLossPct:6.67,atrPct:3.14},
 holding:{costReturnPct:12,quantity:172,accountNumber:'SECRET-ACCOUNT',avgPrice:11},
 token:'SECRET-TOKEN',orders:['SECRET-ORDER']};
const good=Queue.summarize(base,date);
assert.equal(good.status,'ready');
assert.equal(good.reviewLane,'technical-watch');
assert.equal(good.reviewOrder,2);
assert.equal(good.observedTechnicalCondition,true);
assert.equal(good.risk.observedSupport,14);
assert.ok(!JSON.stringify(good).includes('SECRET-'));
assert.ok(!JSON.stringify(good).includes('"quantity"'));
assert.ok(!JSON.stringify(good).includes('"avgPrice"'));
assert.equal(Queue.summarize({...base,symbol:'SPCH'},date).status,'invalid','stock evidence must match symbol');
assert.equal(Queue.summarize({...base,market:'KR'},date).status,'invalid','6 digit KR symbol only');
assert.equal(Queue.summarize({...base,asOf:'2026-11-01'},date).status,'invalid','stale ten-day gate');
assert.equal(Queue.summarize({...base,asOf:'2026-11-25'},date).status,'invalid','future bar');
assert.equal(Queue.summarize({...base,evidence:[]},date).status,'invalid','no verified stock evidence');
assert.equal(Queue.summarize({...base,action:'buy'},date).status,'invalid','no automatic actions');
assert.equal(Queue.summarize({...base,status:'insufficient',action:'review-only'},date).status,'invalid','insufficient forbids review-only');
const candidateRisk={...base,symbol:'SPCH',evidence:[{kind:'stock',symbol:'SPCH',source:'verified',asOf:date}],
 status:'review-required',blocking:['market-high-risk','event-near'],
 reasons:['시장 변동성 위험 높음'],conditions:['확정 일봉 스윙 관찰조건 충족']};
assert.equal(Queue.summarize(candidateRisk,date).reviewLane,'risk-review');
assert.equal(Queue.summarize({...candidateRisk,blocking:['event-near']},date).blocked,true);
const incomplete={...base,symbol:'SMR',evidence:[{kind:'stock',symbol:'SMR',source:'verified',asOf:date}],
 status:'review-required',blocking:['events-unverified'],conditions:['확정 일봉 스윙 관찰조건 충족']};
assert.equal(Queue.summarize(incomplete,date).reviewLane,'needs-evidence');
const weak={...base,symbol:'JOBY',evidence:[{kind:'stock',symbol:'JOBY',source:'verified',asOf:date}],
 conditions:['종목 5일 상대강도 우위']};
assert.equal(Queue.summarize(weak,date).reviewLane,'needs-evidence','missing observed setup is not strong opportunity');
const holding={...base,intent:'holding',holding:{quantity:172,avgPrice:11,broker:'SECRET-BROKER'},
 symbol:'005930',market:'KR',evidence:[{kind:'stock',symbol:'005930',asOf:date,source:'verified KR chart'}],
 conditions:['확정 일봉 스윙 관찰조건 충족']};
assert.equal(Queue.summarize(holding,date).reviewLane,'monitor');
const heldRisk={...holding,symbol:'000660',evidence:[{kind:'stock',symbol:'000660',asOf:date,source:'verified KR chart'}],
 reasons:['종목의 확정 일봉 하락 추세']};
assert.equal(Queue.summarize(heldRisk,date).reviewLane,'risk-review');
const heldNeeds={...holding,symbol:'035420',evidence:[{kind:'stock',symbol:'035420',asOf:date,source:'verified KR chart'}],
 blocking:['holding-unverified'],status:'review-required'};
assert.equal(Queue.summarize(heldNeeds,date).reviewLane,'needs-evidence');
const result=Queue.collect({mode:'swing',nowDay:date,candidates:[good,candidateRisk]});
assert.equal(result.candidateQueue.reviewed,1,'sanitized queue entry is not a replacement for signed upstream strategy');
const queue=Queue.collect({mode:'swing',nowDay:date,
 candidates:[weak,base,candidateRisk,incomplete,{...base,symbol:'SERV'},null],
 holdings:[holding,heldNeeds,heldRisk]});
assert.equal(queue.status,'ready');
assert.deepEqual(queue.candidateQueue.items.map(x=>x.symbol),['SPCH','SMR','JOBY','SERV']);
assert.deepEqual(queue.holdingQueue.items.map(x=>x.symbol),['000660','035420','005930']);
assert.equal(queue.candidateQueue.errors.length,2);
assert.equal(queue.coverage.candidates.total,6);
assert.equal(queue.coverage.candidates.verified,4);
assert.equal(queue.coverage.holdings.verified,3);
assert.equal(queue.candidateQueue.items.every(x=>x.intent==='candidate'),true);
assert.equal(queue.holdingQueue.items.every(x=>x.intent==='holding'),true);
assert.equal(JSON.stringify(queue).includes('SECRET-'),false);
const truncated=Queue.collect({mode:'swing',nowDay:date,maxResults:1,candidates:[base,candidateRisk]});
assert.equal(truncated.candidateQueue.truncated,true);
assert.equal(truncated.candidateQueue.items.length,1);
assert.equal(truncated.candidateQueue.reviewed,2);
const empty=Queue.collect({mode:'swing',nowDay:date});
assert.equal(empty.status,'insufficient');
assert.equal(empty.candidateQueue.reviewed,0);
assert.equal(empty.holdingQueue.reviewed,0);
assert.throws(()=>Queue.collect({mode:'swing',nowDay:'2026-02-30'}),/OPPORTUNITY_INPUT_INVALID/);
assert.throws(()=>Queue.collect({mode:'invalid',nowDay:date}),/OPPORTUNITY_INPUT_INVALID/);
assert.throws(()=>Queue.collect({mode:'swing',nowDay:date,maxResults:0}),/OPPORTUNITY_INPUT_INVALID/);
assert.equal(typeof Queue.placeOrder,'undefined');
console.log('Opportunity review queue: separate candidate/holding, veto, deterministic review order, privacy, malformed input PASS');
