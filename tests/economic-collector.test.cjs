'use strict';
const assert=require('node:assert/strict');
const {collect}=require('../scripts/collect-economic-calendar.cjs');
const sample=['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:bls-cpi-fixture','DTSTART;TZID=America/New_York:20261124T083000','SUMMARY:Consumer Price Index for October 2026','END:VEVENT','END:VCALENDAR'].join('\r\n');
async function main(){
 const clock=new Date('2026-11-23T00:00:00Z');
 const success=async()=>({ok:true,text:async()=>sample});
 const snapshot=await collect({fetchImpl:success,now:clock});
 assert.equal(snapshot.schemaVersion,1);
 assert.equal(snapshot.source,'BLS');
 assert.equal(snapshot.events.length,1);
 assert.equal(snapshot.events[0].date,'2026-11-24');
 assert.equal(snapshot.events[0].startsAt,'2026-11-24T13:30:00.000Z');
 assert.deepEqual(snapshot.events.map(x=>x.type),['CPI']);
 assert.equal(snapshot.events[0].verified,true);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:false}),now:clock}),/BLS_HTTP_FAILED/);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:true,text:async()=>'<html>broken</html>'}),now:clock}),/BLS_ICS_INVALID/);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:true,text:async()=>sample.replace('Consumer Price Index','Unrelated Report')}),now:clock}),/BLS_NO_VERIFIED_EVENTS/);
 console.log('Economic calendar BLS collector PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
