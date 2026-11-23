'use strict';
const assert=require('node:assert/strict');
globalThis.MYInvestBlsSchedule=require('../js/economic-bls-parser.js');
const calendar=require('../js/economic-calendar.js');
const now=Date.now(),instant=new Date(now+2*86400000).toISOString();
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));
const row={id:'bls-CPI-'+instant,date,title:'미국 CPI 발표',category:'macro',publisher:'BLS',type:'CPI',priority:'critical',verified:true,sourceUrl:globalThis.MYInvestBlsSchedule.SOURCE,startsAt:instant};
const payload={schemaVersion:1,retrievedAt:new Date(now).toISOString(),events:[row,{...row}]};
const normalized=calendar.normalize(payload,now);
assert.equal(normalized.status,'ready');assert.equal(normalized.events.length,1);
assert.equal(normalized.events[0].priority,'critical');
assert.throws(()=>calendar.normalize({...payload,retrievedAt:new Date(now-3*86400000).toISOString()},now),/ECON_STALE/);
assert.throws(()=>calendar.normalize({...payload,retrievedAt:new Date(now+86400000).toISOString()},now),/ECON_STALE/);
let fetchCount=0;
async function goodFetch(){fetchCount++;return {ok:true,text:async()=>JSON.stringify(payload)}}
async function run(){
 await calendar.refresh(true,goodFetch);
 assert.equal(calendar.current().events.length,1);
 assert.equal(calendar.horizon(14).length,1);
 assert.equal(calendar.month(Number(date.slice(0,4)),Number(date.slice(5,7))).length,1);
 await calendar.refresh(false,goodFetch);assert.equal(fetchCount,1,'15-minute cache');
 calendar.reset();assert.equal(calendar.current().events.length,0);
 await calendar.refresh(true,async()=>({ok:false}));
 assert.equal(calendar.current().status,'unavailable');
 console.log('Economic calendar snapshot reader PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1});
