'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const cal=require('../js/invest-calendar-official-market-events-v1.js');

test('official source snapshot is immutable and not portrayed as live verified',()=>{
 const a=cal.all();
 assert.ok(Object.isFrozen(a));
 assert.ok(a.length>=45);
 assert.ok(a.every(x=>Object.isFrozen(x)));
 assert.ok(a.every(x=>x.status==='OFFICIAL_SOURCE_SNAPSHOT'&&
  x.liveVerified===false&&x.tradeSessionCertified===false&&x.readOnly===true));
 assert.equal(cal.checkedAt,'2026-11-22');
 assert.equal(cal.isLive,false);
});
test('NYSE November 2026 Thanksgiving closure and the next-day early close are separate',()=>{
 const xs=cal.list(2026,11);
 const a=xs.find(x=>x.date==='2026-11-26'&&x.type==='holiday');
 const b=xs.find(x=>x.date==='2026-11-27'&&x.type==='early-close');
 assert.ok(a&&b);
 assert.equal(b.sourceTime,'13:00');
 assert.equal(b.kstDate,'2026-11-28');
 assert.equal(b.kstTime,'03:00');
 assert.match(a.sourceUrl,/nyse\.com/);
});
test('NYSE Christmas 2026 early closure 24th and 25th holiday distinguished',()=>{
 const a=cal.list(2026,12);
 assert.ok(a.find(x=>x.date==='2026-12-24'&&x.type==='early-close'));
 assert.ok(a.find(x=>x.date==='2026-12-25'&&x.type==='holiday'));
});
test('NYSE 2027 Juneteenth and Independence Day observed dates are correct',()=>{
 const a=cal.list(2027,6),b=cal.list(2027,7);
 assert.ok(a.find(x=>x.date==='2027-06-18'&&x.type==='holiday'));
 assert.ok(b.find(x=>x.date==='2027-07-05'&&x.type==='holiday'));
 assert.ok(!b.some(x=>x.date==='2027-07-04'));
});
test('2027 NYSE Christmas observed Friday 24th and early Thanksgiving next day',()=>{
 const a=cal.list(2027,12),b=cal.list(2027,11);
 assert.ok(a.find(x=>x.date==='2027-12-24'&&x.type==='holiday'));
 assert.ok(b.find(x=>x.date==='2027-11-26'&&x.type==='early-close'));
});
test('FOMC 2026 December 8-9 includes SEP and retains unverified decision time',()=>{
 const a=cal.list(2026,12);
 assert.ok(a.find(x=>x.date==='2026-12-08'&&x.type==='fomc'));
 const b=a.find(x=>x.date==='2026-12-09'&&x.type==='fomc');
 assert.ok(b);assert.match(b.title,/경제전망/);
 assert.equal(b.sourceTime,'');
 assert.equal(b.kstDate,null);
});
test('2027 FOMC schedule is revised November 12, tentative, and contains 8 meetings',()=>{
 const a=cal.all().filter(x=>x.date.startsWith('2027')&&x.type==='fomc');
 assert.equal(a.length,16);
 assert.ok(a.every(x=>x.tentative===true));
 assert.ok(a.every(x=>x.sourceUrl.includes('20261112a')));
});
test('Oct 2027 Fed strategy-only meeting is never mistaken for a rate decision',()=>{
 const a=cal.list(2027,10).filter(x=>x.type==='fomc');
 assert.equal(a.length,2);
 assert.match(a[1].title,/금리표결 없음/);
 assert.ok(!a.some(x=>x.title.includes('금리결정 예정')));
});
test('BLS employment and CPI December 2026 verified 8:30 EST becomes 22:30 KST',()=>{
 const a=cal.list(2026,12).filter(x=>x.type==='macro');
 assert.equal(a.length,3);
 for(const r of a){
  assert.equal(r.sourceTime,'08:30');
  assert.equal(r.kstTime,'22:30');
  assert.equal(r.kstDate,r.date);
 }
 assert.ok(a.some(x=>x.title.includes('고용보고서')&&x.date==='2026-12-04'));
 assert.ok(a.some(x=>x.title.includes('소비자물가지수')&&x.date==='2026-12-10'));
});
test('BEA PCE November 25 and December 23 official releases remain source-linked',()=>{
 for(const date of ['2026-11-25','2026-12-23']){
  const [a,b]=date.split('-').map(Number);
  const x=cal.list(a,b).find(x=>x.date===date&&x.type==='macro');
  assert.ok(x);
  assert.equal(x.sourceLabel,'BEA');
  assert.equal(x.kstTime,'22:30');
 }
});
test('NYSE holiday and Google public holiday have distinct origins and cannot establish KRX closure',()=>{
 const all=cal.all();
 assert.ok(all.every(x=>x.market==='US'));
 assert.ok(all.every(x=>x.sourceTimezone==='America/New_York'));
 assert.ok(!all.some(x=>x.market==='KR'));
 assert.ok(!all.some(x=>x.tradeSessionCertified));
});
test('date-scoped type filter and invalid month are handled without network calls',()=>{
 assert.equal(cal.list(2025,12).length,0);
 assert.equal(cal.list(2028,1).length,0);
 assert.equal(cal.list(2027,0).length,0);
 assert.equal(cal.list(2027,13).length,0);
 const a=cal.list(2027,10,{types:['fomc']});
 assert.equal(a.length,2);
 assert.ok(a.every(x=>x.type==='fomc'));
 assert.equal(cal.list(2026,11,{types:[]}).length,0);
});
test('no duplicated market snapshot event IDs or source-url placeholders',()=>{
 const all=cal.all();
 assert.equal(new Set(all.map(x=>x.id)).size,all.length);
 assert.ok(all.every(x=>x.sourceUrl.startsWith('https://')));
 assert.ok(!all.some(x=>/example\.com/.test(x.sourceUrl)));
});
test('source modules provide data records only: no network, localStorage, OAuth or orders',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const text=fs.readFileSync(path.join(__dirname,'../js/invest-calendar-official-market-events-v1.js'),'utf8');
 for(const forbidden of ['fetch(','localStorage','sessionStorage','access_token',
  'NH_ACCOUNT','placeOrder(','createEvent(','PropertiesService'])
  assert.equal(text.includes(forbidden),false,forbidden);
});
