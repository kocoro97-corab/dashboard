'use strict';
const assert=require('node:assert/strict');
const P=require('../js/strategy-alert-planner.js');
const date='2026-11-24',prior='2026-11-23';
const c={schemaVersion:1,status:'comparable',market:'US',mode:'swing',previousDay:prior,currentDay:date,
 coverage:{previousVerified:true,currentVerified:true},sourceChanges:[],recheck:[],
 changes:[
 {kind:'risk-escalated',symbol:'SERV',intent:'holding',status:'warning',newBlocking:['event-near']},
 {kind:'risk-escalated',symbol:'SPCH',intent:'candidate',status:'warning',newBlocking:['market-high-risk']},
 {kind:'market-risk-changed',symbol:null,intent:null,status:'warning',from:'elevated',to:'high'},
 {kind:'sector-relative-strength-changed',symbol:null,intent:null,status:'observed',sectorId:'US_TECH',delta5dPp:-1.3},
 {kind:'risk-appears-resolved',symbol:'SMR',intent:'holding',status:'requires-context'},
 {kind:'new-observation',symbol:'JOBY',intent:'candidate',status:'requires-context'}
 ]};
let result=P.plan({comparison:c,today:date,allowNotifications:true});
assert.equal(result.status,'ready');
assert.equal(result.delivery.executed,false);
assert.equal(result.delivery.eligible,3);
assert.equal(result.alerts[0].symbol,'SERV');
assert.equal(result.alerts[0].severity,'urgent');
assert.equal(result.alerts[1].symbol,'SPCH');
assert.equal(result.alerts.some(x=>x.kind==='sector-relative-strength-changed'&&x.severity==='review'),true);
assert.equal(result.alerts.find(x=>x.kind==='risk-appears-resolved').eligibleForNotification,false);
assert.equal(result.alerts.every(x=>x.requiresManualReview),true);
assert.equal(result.alerts.every(x=>x.label.includes('매수/매도')),true);
assert.equal(JSON.stringify(result).includes('accountNumber'),false);
assert.equal(typeof P.send,'undefined');
assert.equal(typeof P.placeOrder,'undefined');
const first=result.alerts[0];
result=P.plan({comparison:c,today:date,allowNotifications:true,delivered:[{id:first.id,day:date}]});
assert.equal(result.delivery.eligible,2);
assert.equal(result.alerts.some(x=>x.id===first.id),false);
assert.equal(result.suppressed.some(x=>x.id===first.id),true);
assert.equal(P.plan({comparison:c,today:date,allowNotifications:false}).delivery.eligible,0);
const partial={...c,status:'partial',coverage:{previousVerified:true,currentVerified:false},
 sourceChanges:[{component:'event',from:'usable',to:'missing',direction:'degraded'}]};
result=P.plan({comparison:partial,today:date,allowNotifications:true});
assert.equal(result.status,'partial');
assert.equal(result.alerts.some(x=>x.kind==='risk-appears-resolved'),false);
assert.equal(result.alerts.some(x=>x.kind==='risk-escalated'&&x.symbol==='SERV'),true);
assert.equal(result.alerts.some(x=>x.kind==='source-degraded'),true);
assert.equal(result.delivery.eligible,0,'partial coverage disables push eligibility');
const contradictory={...c,sourceChanges:[{component:'market',from:'usable',to:'missing',direction:'degraded'}]};
const contradiction=P.plan({comparison:contradictory,today:date,allowNotifications:true});
assert.equal(contradiction.status,'partial','degraded source overrides comparable claim');
assert.equal(contradiction.delivery.eligible,0,'no urgent push eligibility with degraded source');
const missingPrevious=P.plan({comparison:{...c,coverage:{previousVerified:false,currentVerified:true}},today:date,allowNotifications:true});
assert.equal(missingPrevious.delivery.eligible,0,'old snapshot must also be verified');
assert.equal(result.alerts.every(x=>x.eligibleForNotification===false),true);
assert.equal(result.alerts.some(x=>x.kind==='sector-relative-strength-changed'&&x.delta5dPp<0),true);
const cdup={...c,changes:[c.changes[0],{...c.changes[0]},c.changes[1]]};
result=P.plan({comparison:cdup,today:date});
assert.equal(result.alerts.length,2,'duplicate same risk is one alert');
const anotherDay=P.plan({comparison:{...c,previousDay:'2026-11-22',currentDay:'2026-11-23'},today:date});
assert.equal(anotherDay.alerts[0].day,'2026-11-23');
const old={...c,previousDay:'2026-11-01',currentDay:'2026-11-02'};
assert.equal(P.plan({comparison:old,today:date}).status,'unavailable');
assert.equal(P.plan({comparison:{...c,mode:'unknown'},today:date}).status,'unavailable');
assert.equal(P.plan({comparison:{...c,changes:[{...c.changes[0],symbol:'INVALID / TOKEN'}]},today:date}).alerts.length,0);
assert.equal(P.plan({comparison:{...c,changes:[{...c.changes[0],status:'observed'}]},today:date}).alerts.length,0);
assert.equal(P.plan({comparison:{...c,changes:[{...c.changes[2],from:'high',to:'elevated'}]},today:date}).alerts[0].eligibleForNotification,false);
assert.equal(P.plan({comparison:{...c,changes:[{...c.changes[3],delta5dPp:0.5}]},today:date}).alerts[0].severity,'informational');
assert.equal(P.plan({comparison:{...c,changes:[{...c.changes[3],delta5dPp:Infinity}]},today:date}).alerts.length,0);
assert.equal(P.plan({comparison:{...c,changes:[{...c.changes[1],account:'PRIVATE-ACCOUNT',position:172}]},today:date}).alerts[0].account,undefined);
assert.equal(JSON.stringify(P.plan({comparison:{...c,changes:[{...c.changes[1],account:'PRIVATE-ACCOUNT',position:172}]},today:date})).includes('PRIVATE-ACCOUNT'),false);
const dayOld={id:'mi-v1-12345678',day:'2026-10-01'};
assert.equal(P.validHistory([dayOld],date),null);
assert.equal(P.validHistory([{id:'not-valid',day:date}],date),null);
assert.throws(()=>P.plan({comparison:c,today:'bad-date'}),/ALERT_PLAN_INPUT_INVALID/);
assert.throws(()=>P.plan({comparison:c,today:date,maxAlerts:0}),/ALERT_PLAN_INPUT_INVALID/);
assert.equal(P.plan({comparison:c,today:date,maxAlerts:1}).truncated,true);
console.log('Strategy alert planner: urgency, dedupe, partial-data veto, privacy and no-send PASS');
