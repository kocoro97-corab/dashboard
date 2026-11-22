'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const krx=require('../js/invest-calendar-krx-official-v1.js');
const us=require('../js/invest-calendar-official-market-events-v1.js');
const core=require('../js/invest-calendar-core-v2.js');
function combined(){
 // Browser-only module intentionally shares its instance dependencies via
 // globalThis; isolate in this file's V8 context to avoid test contamination.
 const context={MYInvestOfficialMarketEventsV1:us,
  MYInvestKrxOfficialCalendarV1:krx,Intl,Date,TextEncoder};
 const s=fs.readFileSync(path.join(__dirname,
  '../js/invest-calendar-unified-market-v1.js'),'utf8');
 vm.runInNewContext(s,context,{timeout:4000});
 return context.MYInvestUnifiedMarketCalendarV1;
}
const c=combined();
test('KRX source registry contains only four traceable, immutable market dates',()=>{
 const x=krx.all();
 assert.equal(x.length,4);
 assert.ok(Object.isFrozen(x));
 assert.ok(x.every(Object.isFrozen));
 assert.ok(x.every(r=>r.market==='KR'&&r.sourceTimezone==='Asia/Seoul'));
 assert.ok(x.every(r=>r.sourceStatus==='OFFICIAL_SOURCE_SNAPSHOT'));
 assert.ok(x.every(r=>r.liveVerified===false&&r.tradeSessionCertified===false));
 assert.equal(krx.isLive,false);
 assert.equal(krx.checkedAt,'2026-11-22');
});
test('KRX 2026-12-30 is final trading DAY, not holiday or closure',()=>{
 const x=krx.list(2026,12);
 const closing=x.find(r=>r.date==='2026-12-30');
 assert.ok(closing);
 assert.equal(closing.type,'market');
 assert.match(closing.title,/매매거래일/);
 assert.ok(!closing.title.includes('휴장'));
 assert.match(closing.sourceUrl,/kind\.krx\.co\.kr/);
});
test('KRX 2026-12-31 is year-end closure distinct from Dec30',()=>{
 const x=krx.list(2026,12);
 const closed=x.find(r=>r.date==='2026-12-31');
 assert.ok(closed);
 assert.equal(closed.type,'holiday');
 assert.match(closed.title,/연말 휴장/);
 assert.equal(x.filter(r=>r.type==='holiday').length,2);
});
test('KRX 2026 December Christmas is in official KRX calendar',()=>{
 const x=krx.list(2026,12);
 assert.ok(x.some(r=>r.date==='2026-12-25'&&r.type==='holiday'));
 assert.equal(x.filter(r=>r.type==='market').length,1);
});
test('KRX May 1 Workers day is a distinct closure vs generic holiday feeds',()=>{
 const x=krx.list(2026,5);
 assert.equal(x.length,1);
 assert.equal(x[0].date,'2026-05-01');
 assert.equal(x[0].type,'holiday');
 assert.match(x[0].title,/근로자의 날/);
});
test('missing 2027 official Korean calendar is NEVER inferred as open or closed',()=>{
 const x=krx.list(2027,1);
 assert.equal(x.length,0);
 const state=krx.coverage(2027,1);
 assert.equal(state.status,'UNVERIFIED_YEAR');
 assert.equal(state.verified,false);
 assert.match(state.message,/미확인/);
 assert.equal(c.sourceStatus(2027,1,{now:'2026-11-22'}).reviewDue,true);
});
test('2026 coverage is partial and never a certified complete trading calendar',()=>{
 const state=krx.coverage(2026,12);
 assert.equal(state.status,'PARTIAL_OFFICIAL_SOURCE');
 assert.equal(state.verified,false);
 assert.equal(krx.coverage(2026,13).status,'INVALID_PERIOD');
});
test('KR official event source link is genuine KRX domain and has no placeholder',()=>{
 for(const event of krx.all()){
  assert.match(event.sourceUrl,/^https:\/\/kind\.krx\.co\.kr\/external\/dst\/reference\//);
  assert.ok(!event.sourceUrl.includes('example'));
  assert.equal(event.checkedAt,'2026-11-22');
 }
});
test('unified list combines KR/US on 2026-12-25 without duplicate IDs',()=>{
 const x=c.list(2026,12);
 assert.ok(x.some(r=>r.market==='KR'&&r.date==='2026-12-25'&&r.type==='holiday'));
 assert.ok(x.some(r=>r.market==='US'&&r.date==='2026-12-25'&&r.type==='holiday'));
 assert.equal(new Set(x.map(r=>r.id)).size,x.length);
 assert.ok(Object.isFrozen(x));
 assert.ok(x.every(r=>r.readOnly===true));
});
test('US NYSE and KRX 2026 year-end closures remain separate evidence sources',()=>{
 const x=c.list(2026,12);
 const kr=x.filter(r=>r.market==='KR'),us=x.filter(r=>r.market==='US');
 assert.ok(kr.length>=3);
 assert.ok(us.length>=3);
 assert.ok(kr.every(r=>r.sourceLabel==='KRX'));
 assert.ok(us.every(r=>r.market==='US'));
});
test('unified registry source readiness never claims live market availability',()=>{
 const x=c.sourceStatus(2026,12,{now:'2026-11-22'});
 assert.equal(x.status,'SOURCE_SNAPSHOT_ONLY');
 assert.equal(x.liveVerified,false);
 assert.equal(x.tradeSessionCertified,false);
 assert.equal(x.autoRefreshAvailable,false);
 assert.equal(x.ageDays,0);
 assert.equal(x.krxCoverage,'PARTIAL_OFFICIAL_SOURCE');
 assert.ok(x.sources.some(src=>src.includes('kind.krx.co.kr')));
});
test('stale snapshots fail open-date certification and request recheck',()=>{
 const state=c.sourceStatus(2026,12,{now:'2026-12-16'});
 assert.equal(state.status,'SOURCE_RECHECK_REQUIRED');
 assert.equal(state.reviewDue,true);
 assert.ok(state.ageDays>21);
 assert.equal(state.liveVerified,false);
});
test('2027 Korean holiday coverage missing even though US FOMC snapshot exists',()=>{
 const events=c.list(2027,1);
 assert.ok(events.some(r=>r.market==='US'&&r.type==='fomc'));
 assert.equal(events.filter(r=>r.market==='KR').length,0);
 assert.equal(c.sourceStatus(2027,1,{now:'2026-11-22'}).krxCoverage,'UNVERIFIED_YEAR');
});
test('KR yearend ICS events are all-day, not made-up time for official closure',()=>{
 const ics=c.exportMonthICS(2026,12);
 assert.match(ics,/DTSTART;VALUE=DATE:20261231/);
 assert.match(ics,/DTEND;VALUE=DATE:20270101/);
 assert.match(ics,/KRX 2026년 마지막 매매거래일/);
 assert.match(ics,/KRX 연말 휴장/);
 assert.ok(ics.includes('UTC')===false);
});
test('NYSE half-day date imported in KST correctly becomes UTC 18:00',()=>{
 const raw=c.exportMonthICS(2026,11);
 assert.match(raw,/DTSTART:20261127T180000Z/);
 assert.match(raw,/DTEND:20261127T190000Z/);
});
test('unified ICS contains source evidence for both markets, no private data',()=>{
 const raw=c.exportMonthICS(2026,12).replace(/\r\n /g,'');
 assert.match(raw,/kind\.krx\.co\.kr/);
 assert.match(raw,/nyse\.com/);
 assert.match(raw,/BEGIN:VCALENDAR/);
 assert.match(raw,/END:VCALENDAR/);
 assert.ok(!raw.includes('MYINVEST_GOOGLE_CALENDAR_CLIENT_ID'));
 assert.ok(!raw.includes('access_token'));
 assert.ok(!raw.includes('localStorage'));
});
test('combined ICS import into manual calendar is standards parseable and deduplicated',()=>{
 let store='[]';
 const storage={getItem:()=>store,setItem:(k,v)=>{store=v}};
 const raw=c.exportMonthICS(2026,12);
 const r=core.importICS(storage,raw);
 assert.equal(r.ok,true);
 assert.ok(r.added>=4);
 assert.ok(core.read(storage).some(x=>x.title==='KRX 연말 휴장'));
 const repeated=core.importICS(storage,raw);
 assert.equal(repeated.added,0);
});
test('calendar status is deterministic when system time is explicitly supplied',()=>{
 const a=c.sourceStatus(2026,12,{now:'2026-12-01'});
 const b=c.sourceStatus(2026,12,{now:'2026-12-01'});
 assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));
});
test('market sources are read only; no new HTTP, provider credentials, GAS writes',()=>{
 const content=['invest-calendar-krx-official-v1.js',
 'invest-calendar-unified-market-v1.js'].map(p=>
  fs.readFileSync(path.join(__dirname,'../js',p),'utf8')).join('\n');
 for(const banned of ['fetch(', 'XMLHttpRequest','localStorage.',
  'sessionStorage.', 'NH_ACCOUNT', 'executeOrder(', 'placeOrder(', 'PropertiesService'])
  assert.ok(!content.includes(banned),banned);
});


test('global market page can request evidence only for the relevant US date window',()=>{
 const r=c.evidenceForRange({market:'US',startDate:'2026-12-01',
  endDate:'2026-12-12',now:'2026-11-22'});
 assert.equal(r.status,'EVIDENCE_SNAPSHOT_ONLY');
 assert.ok(r.records.some(x=>x.type==='fomc'));
 assert.ok(r.records.some(x=>x.title.includes('CPI')));
 assert.equal(r.records.some(x=>x.market==='KR'),false);
 assert.equal(r.canBeShownAsEvidence,true);
 assert.equal(r.shownByDefault,false);
 assert.equal(r.providerCalls,0);
 assert.equal(r.calendarFetches,0);
});
test('strategy may request only KR December closures without any US events or re-fetch',()=>{
 const r=c.evidenceForRange({market:'KR',startDate:'2026-12-24',
  endDate:'2026-12-31',types:['holiday'],now:'2026-11-22'});
 assert.deepEqual(r.records.map(x=>x.date),['2026-12-25','2026-12-31']);
 assert.ok(r.records.every(x=>x.market==='KR'&&x.type==='holiday'));
 assert.equal(r.tradingSessionCertified,false);
 assert.equal(r.accountAccessed,false);
 assert.equal(r.ordersPlaced,0);
});
test('KR and US shared source records remain references rather than duplicate queries',()=>{
 const range=c.evidenceForRange({market:'ALL',startDate:'2026-12-24',
  endDate:'2026-12-31',now:'2026-11-22'});
 const month=c.list(2026,12);
 assert.ok(range.records.some(x=>x.market==='KR'));
 assert.ok(range.records.some(x=>x.market==='US'));
 assert.equal(range.records[0],month.find(x=>x.id===range.records[0].id));
 assert.equal(range.providerCalls,0);
});
test('unverified 2027 Korean sessions are withheld even when US FOMC exists',()=>{
 const range=c.evidenceForRange({market:'KR',startDate:'2027-01-01',
  endDate:'2027-01-31',now:'2026-11-22'});
 assert.equal(range.records.length,0);
 assert.equal(range.status,'SOURCE_RECHECK_REQUIRED');
 assert.equal(range.liveVerified,false);
});
test('market evidence source recheck after threshold does not invent replacements',()=>{
 const r=c.evidenceForRange({market:'US',startDate:'2026-12-01',
  endDate:'2026-12-12',now:'2027-01-01'});
 assert.equal(r.status,'SOURCE_RECHECK_REQUIRED');
 assert.ok(r.records.some(x=>x.type==='fomc'));
 assert.equal(r.providerCalls,0);
});
test('invalid and unbounded evidence queries fail closed, no API calls',()=>{
 for(const x of [
  {market:'KR',startDate:'2026-12-01',endDate:'2027-12-01'},
  {market:'US',startDate:'2026-12-31',endDate:'2026-12-01'},
  {market:'US',startDate:'2026-02-30',endDate:'2026-03-01'},
  {market:'ALL',startDate:'2026-12-01',endDate:'2027-03-31'},
  {market:'KR',startDate:'2026-12-01',endDate:'2026-12-06',types:'all'}
 ]){
  const r=c.evidenceForRange(x);
  assert.equal(r.status,'INVALID_QUERY');
  assert.equal(r.providerCalls,0);
  assert.equal(r.records.length,0);
 }
});
