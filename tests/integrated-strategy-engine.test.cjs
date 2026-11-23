'use strict';
const assert=require('node:assert/strict');
const E=require('../js/integrated-strategy-engine.js');
const date='2026-11-23',symbol='SERV';
const stock={
 status:'descriptive',symbol,market:'US',mode:'swing',asOf:date,
 evidence:{symbol,market:'US',asOf:date,source:'verified source',observations:80},
 setup:{status:'descriptive',trend:'up',candidates:[{type:'breakout_swing',label:'verified observed setup'}]},
 relative:{status:'ready',period5:{status:'ready',relativePp:2.1},period20:{status:'ready',relativePp:4.3}},
 references:{lastClose:15,observedSupport:13,supportStatus:'reference-only',riskToObservedSupportPct:13.3333,atrPct:3.2}};
const regime={status:'descriptive',region:'US',direction:{state:'up'},
 execution:{day:'context-only',swing:'context-only'},
 momentum:{state:'strengthening'},risk:{level:'reference-low'},
 evidence:[{symbol:'^GSPC',referenceDay:date,source:'source 1',asOf:date},{symbol:'^IXIC',referenceDay:date,source:'source 2',asOf:date}]};
const sector={id:'US_TECH',name:'Technology',market:'US',type:'sector_etf_proxy',status:'descriptive',source:'verified constituent list',asOf:date,
 rotation:{status:'descriptive',relative5dPp:3,relative20dPp:5}};
const sectorLink={verified:true,symbol,market:'US',sectorId:'US_TECH',asOf:date,source:'verified membership'};
const event={status:'ready',events:[]};
const holding={verified:true,symbol,market:'US',currency:'USD',quantity:172,avgPrice:10,
 accountNumber:'PRIVATE-1234',broker:'PRIVATE-BROKER',token:'PRIVATE-TOKEN'};
const input={intent:'candidate',mode:'swing',stock,regime,sector,sectorLink,event,nowDay:date};
let r=E.assess(input);
assert.equal(r.status,'observed');
assert.equal(r.action,'review-only');
assert.equal(r.blocking.length,0);
assert.equal(r.conditions.includes('시장 대비 산업 강세 관측'),true);
assert.equal(r.conditions.includes('확정 일봉 스윙 관찰조건 충족'),true);
assert.equal(r.reference.support,13);
assert.equal(r.sectorContext.isProxy,true);
assert.equal(r.evidence.length,4);
assert.equal(r.holding.status,'not-applicable');
assert.equal(JSON.stringify(r).includes('PRIVATE-'),false);
assert.throws(()=>E.assess({...input,mode:'bad'}),/STRATEGY_INPUT_INVALID/);
assert.throws(()=>E.assess({...input,intent:'sell'}),/STRATEGY_INPUT_INVALID/);
r=E.assess({...input,sectorLink:null});
assert.equal(r.blocking.includes('sector-unverified'),true);
assert.equal(r.conditions.includes('시장 대비 산업 강세 관측'),false);
r=E.assess({...input,sectorLink:{...sectorLink,symbol:'SPCH'}});
assert.equal(r.blocking.includes('sector-unverified'),true);
r=E.assess({...input,sectorLink:{...sectorLink,asOf:'2026-11-20'}});
assert.equal(r.blocking.includes('sector-unverified'),true);
r=E.assess({...input,regime:{...regime,evidence:regime.evidence.map(x=>({...x,referenceDay:'2026-11-20'}))}});
assert.equal(r.blocking.includes('market-unverified'),true);
r=E.assess({...input,regime:{...regime,status:'insufficient'}});
assert.equal(r.blocking.includes('market-unverified'),true);
r=E.assess({...input,regime:{...regime,risk:{level:'high'},execution:{day:'caution',swing:'caution'}}});
assert.equal(r.blocking.includes('market-high-risk'),true);
assert.match(r.label,/진입 경계/);
r=E.assess({...input,regime:{...regime,risk:{level:'unknown'}}});
assert.equal(r.blocking.includes('market-risk-unknown'),true);
r=E.assess({...input,event:null});
assert.equal(r.blocking.includes('events-unverified'),true);
r=E.assess({...input,event:{status:'ready',events:[{kind:'economic',date:'2026-11-25',type:'CPI',verified:true}]}});
assert.equal(r.blocking.includes('event-near'),true);
assert.equal(r.events.count,1);
r=E.assess({...input,event:{status:'ready',events:[{kind:'earnings',symbol,market:'US',date:'2026-11-27',verified:true}]}});
assert.equal(r.blocking.includes('event-near'),true);
r=E.assess({...input,event:{status:'ready',events:[{kind:'earnings',symbol:'SPCH',market:'US',date:'2026-11-27',verified:true}]}});
assert.equal(r.events.count,0,'unrelated issuer events ignored');
r=E.assess({...input,event:{status:'ready',events:[{kind:'earnings',symbol,market:'US',date:'2026-11-25',verified:false,dateStatus:'estimated'}]}});
assert.equal(r.events.count,0,'unverified estimates never treated as confirmed');
r=E.assess({...input,nowDay:'2027-01-01'});
assert.equal(r.status,'insufficient');
assert.equal(r.action,'no-action');
r=E.assess({...input,stock:{...stock,status:'unavailable'}});
assert.equal(r.status,'insufficient');
r=E.assess({...input,stock:{...stock,evidence:{...stock.evidence,symbol:'SPCH'}}});
assert.equal(r.status,'insufficient');
r=E.assess({...input,mode:'day',stock:{...stock,mode:'day',setup:{...stock.setup,candidates:[{type:'breakout_volume',label:'20d breakout'}]}}});
assert.equal(r.status,'observed');
assert.equal(r.conditions.includes('확정봉 돌파·거래량 확대 관측'),true);
r=E.assess({...input,intent:'holding',holding});
assert.equal(r.holding.status,'verified');
assert.equal(r.holding.costRelation,'above-cost');
assert.match(r.label,/보유종목/);
assert.equal(JSON.stringify(r).includes('PRIVATE-'),false);
assert.equal(JSON.stringify(r).includes('172'),false,'quantity not disclosed');
r=E.assess({...input,intent:'holding',holding:null});
assert.equal(r.blocking.includes('holding-unverified'),true);
r=E.assess({...input,intent:'holding',holding:{...holding,currency:'KRW'}});
assert.equal(r.blocking.includes('holding-unverified'),true);
r=E.assess({...input,intent:'candidate',holding});
assert.equal(r.holding.status,'not-applicable');
assert.equal(typeof E.placeOrder,'undefined');
console.log('Integrated strategy engine: candidate/holding, evidence boundaries, risk veto and privacy tests PASS');
