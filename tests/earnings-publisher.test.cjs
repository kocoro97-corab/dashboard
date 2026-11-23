'use strict';
const assert=require('node:assert/strict');
const {build}=require('../scripts/build-earnings-snapshot.cjs');
const now=new Date('2026-11-23T06:00:00.000Z');
const record={eventId:'reviewed-fixture-1',market:'US',symbol:'SERV',name:'Example Issuer',period:'2026 Q4',
 eventType:'earnings',date:'2026-11-25',dateStatus:'confirmed',evidence:'issuer_announcement',
 sourceUrl:'https://www.sec.gov/Archives/edgar/data/123/fixture.htm',verifiedAt:now.toISOString()};
const input={events:[record]};
const out=build(input,{now});
assert.equal(out.schemaVersion,1);assert.equal(out.events.length,1);
assert.equal(out.events[0].verifiedAt,undefined,'verification metadata stays private');
assert.equal(out.events[0].symbol,'SERV');
const privateInput=build({events:[{...record,accountNumber:'PRIVATE_ACCOUNT',shares:172,averagePrice:100.5,apiToken:'PRIVATE_KEY',memo:'Do not share'}]},{now});
assert.ok(!JSON.stringify(privateInput).includes('PRIVATE_')&&!JSON.stringify(privateInput).includes('172')&&!JSON.stringify(privateInput).includes('Do not share'),'public snapshot drops all extra account and note fields');
assert.throws(()=>build({events:[]},{now}),/EARNINGS_INPUT_EMPTY_OR_OVERSIZED/);
assert.throws(()=>build({events:[{...record,verifiedAt:'2026-11-19T00:00:00Z'}]},{now}),/EARNINGS_EVIDENCE_STALE/);
assert.throws(()=>build({events:[{...record,dateStatus:'confirmed',evidence:'vendor_estimate'}]},{now}),/EARNINGS_EVIDENCE_INVALID/);
assert.throws(()=>build({events:[{...record,sourceUrl:'https://attacker.example/file'}]},{now}),/EARNINGS_EVIDENCE_INVALID/);
assert.throws(()=>build({events:[record,record]},{now}),/EARNINGS_DUPLICATE_ID/);
const vendor={...record,eventId:'vendor-fixture-1',dateStatus:'estimated',evidence:'vendor_estimate',
 sourceUrl:'https://api.earningscalendar.net/calendar',licenseApproved:true};
assert.equal(build({events:[vendor]},{now}).events[0].licenseApproved,undefined,'license details not published');
assert.throws(()=>build({events:[{...vendor,licenseApproved:false}]},{now}),/EARNINGS_VENDOR_LICENSE_NOT_APPROVED/);
assert.throws(()=>build({events:[{...record,eventType:'ir'}]},{now}),/EARNINGS_EVIDENCE_INVALID/);

console.log('Verified earnings publisher tests PASS');
