'use strict';
const assert=require('node:assert/strict');
const {collect}=require('../scripts/collect-bea-calendar.cjs');
const sample={file_last_updated:'2026-11-20T12:00:00Z','Gross Domestic Product':{release_dates:['2026-11-25T13:30:00+00:00']},'Personal Income and Outlays':{release_dates:['2026-11-25T13:30:00+00:00']}};
async function main(){
 const stamp=new Date('2026-11-23T01:00:00Z');
 const data=await collect({fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(sample)}),now:stamp});
 assert.equal(data.source,'BEA');
 assert.equal(data.events.length,2);
 assert.deepEqual(data.events.map(e=>e.type),['GDP','PCE']);
 assert.ok(data.events.every(e=>e.verified&&e.date==='2026-11-25'));
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:false}),now:stamp}),/BEA_HTTP_FAILED/);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:true,text:async()=>'<html>invalid</html>'}),now:stamp}),/Unexpected token|JSON/);
 await assert.rejects(()=>collect({fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({})}),now:stamp}),/BEA_NO_VERIFIED_EVENTS/);
 console.log('BEA publisher fail-closed tests PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
