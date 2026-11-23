'use strict';
const assert=require('node:assert/strict');
const Tracker=require('../js/analysis-change-tracker.js');
const previousDay='2026-11-20',currentDay='2026-11-23',today='2026-11-24';
function audit(day,quality='usable'){
 const entries=['market','sector','stock','event'].map(component=>({component,status:component==='event'?quality:'usable',reasons:[],basis:[]}));
 return {schemaVersion:1,mode:'swing',market:'US',nowDay:day,
   status:quality==='usable'?'ready':'incomplete',canPresentAsVerified:quality==='usable',evidence:entries};
}
function item(symbol,day,extra={}){
 return {symbol,market:'US',intent:'candidate',mode:'swing',asOf:day,reviewLane:'technical-watch',
  blocked:false,requiresEvidence:false,observedTechnicalCondition:true,blocking:[],conditions:[],
  source:'public-data-source',quantity:172,avgPrice:10,accountNumber:'PRIVATE_ACCOUNT',accessToken:'PRIVATE_TOKEN',...extra};
}
const past={schemaVersion:1,market:'US',mode:'swing',day:previousDay,audit:audit(previousDay),
 candidates:[item('SERV',previousDay),item('SPCH',previousDay)],holdings:[]};
const present={...past,day:currentDay,audit:audit(currentDay),candidates:[
 item('SERV',currentDay,{reviewLane:'risk-review',blocked:true,blocking:['event-near']}),
 item('JOBY',currentDay)]};
let r=Tracker.compare({previous:past,current:present,today});
assert.equal(r.status,'comparable');
assert.equal(r.coverage.previousCount,2);
assert.equal(r.coverage.currentCount,2);
assert.equal(r.changes.some(x=>x.kind==='risk-escalated'&&x.symbol==='SERV'),true);
assert.equal(r.changes.some(x=>x.kind==='new-observation'&&x.symbol==='JOBY'),true);
assert.equal(r.changes.some(x=>x.kind==='no-longer-observed'&&x.symbol==='SPCH'),true);
assert.equal(r.changes[0].kind,'risk-escalated','hazard must lead review lane');
assert.equal(r.recheck.some(x=>x.symbol==='SERV'),true);
assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);
assert.equal(JSON.stringify(r).includes('"quantity"'),false);
assert.equal(JSON.stringify(r).includes('"avgPrice"'),false);
assert.equal(typeof Tracker.placeOrder,'undefined');
assert.equal(typeof Tracker.fetch,'undefined');
r=Tracker.compare({previous:past,current:{...present,candidates:[item('SERV',currentDay)]},today});
assert.equal(r.changes.some(x=>x.kind==='risk-escalated'),false);
r=Tracker.compare({previous:past,current:{...present,candidates:[item('SERV',currentDay,{reviewLane:'needs-evidence',
 requiresEvidence:true,blocked:false,blocking:['stock-unverified']})]},today});
assert.equal(r.changes.some(x=>x.kind==='evidence-need-changed'),true);
r=Tracker.compare({previous:past,current:{...present,day:'2026-11-20',audit:audit('2026-11-20')},today});
assert.equal(r.status,'unavailable','same day snapshots cannot describe daily change');
r=Tracker.compare({previous:past,current:{...present,mode:'day'},today});
assert.equal(r.status,'unavailable','different trading horizon must not be compared');
r=Tracker.compare({previous:{...past,candidates:[item('SERV',previousDay),item('SERV',previousDay)]},
 current:present,today});
assert.equal(r.status,'unavailable','duplicate issuer reports fail closed');
r=Tracker.compare({previous:past,current:{...present,candidates:[{...item('SERV',currentDay),symbol:'NOT VALID!'}]},today});
assert.equal(r.status,'unavailable');
r=Tracker.compare({previous:past,current:{...present,audit:audit(currentDay,'partial')},today});
assert.equal(r.status,'partial');
assert.equal(r.sourceChanges.some(x=>x.component==='event'&&x.direction==='degraded'),true);
assert.equal(r.recheck.some(x=>x.symbol===null),true);
r=Tracker.compare({previous:past,current:{...present,audit:audit(currentDay,'partial'),candidates:[
 item('SERV',currentDay,{reviewLane:'technical-watch'})]},today});
assert.equal(r.status,'partial');
r=Tracker.compare({previous:past,current:{...present,candidates:[item('SERV',currentDay,{asOf:'2026-11-01'})]},today});
assert.equal(r.status,'unavailable','stale observed stock evidence fails closed');
r=Tracker.compare({previous:past,current:{...present,candidates:[item('SERV',currentDay,{market:'KR'})]},today});
assert.equal(r.status,'unavailable');
r=Tracker.compare({previous:past,current:{...present,candidates:[item('SERV',currentDay,{blocked:false,blocking:['event-near']})]},today});
assert.equal(r.status,'unavailable','confirmed risk blocker cannot be falsely marked unblocked');
r=Tracker.compare({previous:past,current:{...present,candidates:[]},today});
assert.equal(r.changes.filter(x=>x.kind==='no-longer-observed').length,2);
assert.equal(r.changes.some(x=>x.kind==='risk-appears-resolved'),false);
assert.throws(()=>Tracker.compare({previous:past,current:present,today:'not-a-date'}),/CHANGE_DATE_REQUIRED/);
const cleaned=Tracker.cleanQueueItem(item('SERV',currentDay),today);
assert.equal(cleaned.quantity,undefined);
assert.equal(cleaned.accountNumber,undefined);
console.log('Analysis change tracker: risk escalation, membership, freshness, coverage and privacy PASS');
