'use strict';
const assert=require('node:assert/strict');
globalThis.MYInvestBokStatsParser=require('../js/economic-bok-stats-parser.js');
const reader=require('../js/economic-bok-stats-calendar.js');
const now=Date.now(),datetime=new Date(now+2*86400000).toISOString();
const parts={};for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(datetime)))if(p.type!=='literal')parts[p.type]=p.value;
const date=parts.year+'-'+parts.month+'-'+parts.day;
const row={id:'bokstat-KR_CSI-'+datetime,date,title:'한국 소비자심리지수 발표',category:'macro',publisher:'BOK',type:'KR_CSI',priority:'high',verified:true,sourceUrl:globalThis.MYInvestBokStatsParser.SOURCE,startsAt:datetime};
const payload={schemaVersion:1,source:'BOK',sourceUrl:globalThis.MYInvestBokStatsParser.SOURCE,retrievedAt:new Date(now).toISOString(),events:[row,row]};
assert.equal(reader.normalize(payload,now).events.length,1);
assert.throws(()=>reader.normalize({...payload,retrievedAt:new Date(now-4*86400000).toISOString()},now),/BOK_SNAPSHOT_STALE/);
assert.throws(()=>reader.normalize({...payload,sourceUrl:'https://attacker.example'},now),/BOK_SNAPSHOT_INVALID/);
assert.throws(()=>reader.normalize({...payload,events:[{...row,date:'2000-01-01'}]},now),/BOK_NO_VERIFIED_EVENTS/);
async function main(){
 let calls=0;const fetcher=async()=>{calls++;return {ok:true,text:async()=>JSON.stringify(payload)}};
 await reader.refresh(true,fetcher);
 assert.equal(reader.current().status,'ready');
 assert.equal(reader.horizon(14).length,1);
 assert.equal(reader.month(Number(date.slice(0,4)),Number(date.slice(5,7))).length,1);
 await reader.refresh(false,fetcher);assert.equal(calls,1);
 reader.reset();assert.equal(reader.current().events.length,0);
 await reader.refresh(true,async()=>({ok:false}));assert.equal(reader.current().status,'unavailable');
 console.log('BOK official statistics snapshot reader PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
