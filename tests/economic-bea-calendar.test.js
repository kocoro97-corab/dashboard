'use strict';
const assert=require('node:assert/strict');
globalThis.MYInvestBeaSchedule=require('../js/economic-bea-parser.js');
const calendar=require('../js/economic-bea-calendar.js');
const now=Date.now(),future=new Date(now+86400000).toISOString();
const parts={};for(const x of new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(future)))if(x.type!=='literal')parts[x.type]=x.value;
const date=parts.year+'-'+parts.month+'-'+parts.day;
const row={id:'bea-GDP-'+future,date,title:'미국 GDP 발표',category:'macro',priority:'critical',publisher:'BEA',type:'GDP',verified:true,sourceUrl:globalThis.MYInvestBeaSchedule.SOURCE,startsAt:future};
const payload={source:'BEA',sourceUrl:globalThis.MYInvestBeaSchedule.SOURCE,retrievedAt:new Date(now).toISOString(),events:[row,row]};
assert.equal(calendar.normalize(payload,now).events.length,1);
assert.throws(()=>calendar.normalize({...payload,events:[{...row,date:'1900-01-01'}]},now),/BEA_NO_VALID_EVENTS/);
assert.throws(()=>calendar.normalize({...payload,retrievedAt:new Date(now-4*86400000).toISOString()},now),/BEA_STALE/);
async function main(){
 let calls=0;const success=async()=>{calls++;return {ok:true,text:async()=>JSON.stringify(payload)}};
 await calendar.refresh(true,success);
 assert.equal(calendar.current().status,'ready');
 assert.equal(calendar.horizon(14).length,1);
 assert.equal(calendar.month(Number(date.slice(0,4)),Number(date.slice(5,7))).length,1);
 await calendar.refresh(false,success);assert.equal(calls,1);
 calendar.reset();assert.equal(calendar.current().events.length,0);
 await calendar.refresh(true,async()=>({ok:false}));
 assert.equal(calendar.current().status,'unavailable');
 console.log('BEA economic calendar reader PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
