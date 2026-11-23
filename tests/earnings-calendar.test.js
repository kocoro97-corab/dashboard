'use strict';
const assert=require('node:assert/strict');
const svc=require('../js/earnings-calendar.js');
const now=Date.parse('2026-11-23T06:00:00.000Z');
const a={eventId:'fixture-US-1',market:'US',symbol:'SERV',name:'Example US Issuer',period:'2026 Q4',eventType:'earnings',date:'2026-11-25',
 dateStatus:'confirmed',evidence:'issuer_announcement',sourceUrl:'https://www.sec.gov/Archives/edgar/data/123/fixture.htm'};
const b={eventId:'fixture-KR-1',market:'KR',symbol:'005930',name:'Example Korea Issuer',period:'2026 Q4',eventType:'ir',date:'2026-11-27',
 dateStatus:'confirmed',evidence:'issuer_announcement',earningsRelated:true,sourceUrl:'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=12345'};
const payload={schemaVersion:1,source:'VERIFIED_EARNINGS',retrievedAt:new Date(now).toISOString(),events:[a,b]};
assert.equal(svc.normalize(payload,now).events.length,2);
assert.equal(svc.normalize({...payload,events:[{...a,date:'2026-11-32'}]},now).events.length,0);
assert.equal(svc.normalize({...payload,events:[{...a,sourceUrl:'https://untrusted.example/announcement'}]},now).events.length,0);
assert.equal(svc.normalize({...payload,events:[{...a,dateStatus:'confirmed',evidence:'vendor_estimate'}]},now).events.length,0);
assert.equal(svc.normalize({...payload,events:[{...a,startsAt:'2026-11-24T14:00:00.000Z'}]},now).events.length,0,'incorrect KST day rejected only if mismatch');
assert.throws(()=>svc.normalize({...payload,retrievedAt:'2026-11-20T00:00:00.000Z'},now),/EARNINGS_SNAPSHOT_STALE/);
assert.throws(()=>svc.normalize({...payload,events:new Array(501).fill(a)},now),/EARNINGS_SCHEMA_INVALID/);
assert.equal(svc.normalize({...payload,events:[a,a]},now).events.length,1,'duplicate symbol quarter collapsed');
assert.equal(svc.normalize({...payload,events:[{...a,dateStatus:'estimated',evidence:'vendor_estimate',date:'2026-11-24'},a]},now).events.length,1);
async function main(){
 let read=0;const fetcher=async()=>{read++;return {ok:true,text:async()=>JSON.stringify(payload)}};
 await svc.refresh(true,fetcher);
 assert.equal(svc.current().status,'ready');
 assert.equal(svc.month(2026,11).length,2);
 assert.equal(svc.matches({holdings:['SERV'],watch:['005930']}).length,2);
 assert.deepEqual(svc.matches({holdings:['SERV'],watch:['SERV']}).map(x=>x.relation),['holding']);
 await svc.refresh(false,fetcher);assert.equal(read,1);
 svc.reset();assert.equal(svc.current().events.length,0);
 await svc.refresh(true,async()=>({ok:false}));
 assert.equal(svc.current().status,'unavailable');
 console.log('Public earnings calendar tests PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1});
