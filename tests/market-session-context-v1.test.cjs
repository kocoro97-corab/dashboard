'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const session=require('../js/market-session-context-v1.js');
const iso=(s)=>session.context({now:Date.parse(s)});
const winter='2026-11-02';
const summer='2026-03-09';

test('KST 07:00 and 21:00 affect home display priority, not trading eligibility',()=>{
 assert.equal(iso('2026-11-20T06:59:00+09:00').focus,'US');
 assert.equal(iso('2026-11-20T07:00:00+09:00').focus,'KR');
 assert.equal(iso('2026-11-20T20:59:00+09:00').focus,'KR');
 assert.equal(iso('2026-11-20T21:00:00+09:00').focus,'US');
 assert.deepEqual(iso('2026-11-20T21:00:00+09:00').displayOrder,['US','KR']);
});
test('day/night focus never asserts a market exchange is open',()=>{
 for(const value of ['2026-11-20T08:00:00+09:00','2026-11-20T22:00:00+09:00']){
  const result=iso(value);
  assert.equal(result.marketOpenVerified,false);
  assert.equal(result.stockExchangeCalendarVerified,false);
  for(const m of ['KR','US']){
   assert.equal(result.regions[m].tradingOpenConfirmed,false);
   assert.equal(result.regions[m].holidayVerified,false);
   assert.equal(result.regions[m].exchangeStatusVerified,false);
  }
 }
});
test('US summer NYSE 09:30 ET is 22:30 KST',()=>{
 const before=iso(summer+'T22:29:00+09:00').regions.US;
 const at=iso(summer+'T22:30:00+09:00').regions.US;
 assert.equal(before.window,'before-regular-window');
 assert.equal(at.window,'regular-clock-window');
 assert.equal(at.referenceKst.opening.kstTime,'22:30');
 assert.equal(at.referenceKst.opening.kstDate,summer);
 assert.equal(session.offsetMinutes(Date.parse(summer+'T22:30:00+09:00'),'America/New_York'),-240);
});
test('US winter NYSE 09:30 ET is 23:30 KST',()=>{
 const before=iso(winter+'T23:29:00+09:00').regions.US;
 const at=iso(winter+'T23:30:00+09:00').regions.US;
 assert.equal(before.window,'before-regular-window');
 assert.equal(at.window,'regular-clock-window');
 assert.equal(at.referenceKst.opening.kstTime,'23:30');
 assert.equal(session.offsetMinutes(Date.parse(winter+'T23:30:00+09:00'),'America/New_York'),-300);
});
test('US summer regular close 16:00 ET is 05:00 KST next day',()=>{
 const before=iso('2026-03-10T04:59:00+09:00').regions.US;
 const at=iso('2026-03-10T05:00:00+09:00').regions.US;
 assert.equal(before.window,'regular-clock-window');
 assert.equal(at.window,'after-regular-window');
 assert.equal(at.referenceKst.closing.kstTime,'05:00');
 assert.equal(at.referenceKst.closing.kstDate,'2026-03-10');
});
test('US winter close 16:00 ET is 06:00 KST next day',()=>{
 const before=iso('2026-11-03T05:59:00+09:00').regions.US;
 const at=iso('2026-11-03T06:00:00+09:00').regions.US;
 assert.equal(before.window,'regular-clock-window');
 assert.equal(at.window,'after-regular-window');
 assert.equal(at.referenceKst.closing.kstTime,'06:00');
 assert.equal(at.referenceKst.closing.kstDate,'2026-11-03');
});
test('KR core index session begins 09:00 KST and ends 15:30 KST',()=>{
 assert.equal(iso('2026-11-20T08:59:00+09:00').regions.KR.window,'before-regular-window');
 assert.equal(iso('2026-11-20T09:00:00+09:00').regions.KR.window,'regular-clock-window');
 assert.equal(iso('2026-11-20T15:29:00+09:00').regions.KR.window,'regular-clock-window');
 assert.equal(iso('2026-11-20T15:30:00+09:00').regions.KR.window,'after-regular-window');
});
test('KRX 2026-09-14 onwards selected equities afterhours 16:00–19:59',()=>{
 assert.equal(iso('2026-11-20T15:59:00+09:00').regions.KR.window,'after-regular-window');
 const market=iso('2026-11-20T16:00:00+09:00').regions.KR;
 assert.equal(market.window,'eligible-equities-afterhours-window');
 assert.equal(market.afterhoursSelectedEquitiesOnly,true);
 assert.equal(market.regularClockWindow,false);
 assert.equal(market.eligibleInstrumentVerified,false);
 assert.equal(iso('2026-11-20T19:59:00+09:00').regions.KR.window,'eligible-equities-afterhours-window');
 assert.equal(iso('2026-11-20T20:00:00+09:00').regions.KR.window,'after-regular-window');
});
test('pre-2026-09-14 KR afterhours is not retroactively claimed',()=>{
 assert.equal(iso('2026-09-11T17:00:00+09:00').regions.KR.window,'after-regular-window');
 assert.equal(iso('2026-09-14T17:00:00+09:00').regions.KR.window,'eligible-equities-afterhours-window');
});
test('Korean weekend never becomes an afterhours equity session',()=>{
 const saturday=iso('2026-11-21T17:00:00+09:00');
 assert.equal(saturday.regions.KR.window,'weekend');
 assert.equal(saturday.regions.KR.afterhoursSelectedEquitiesOnly,false);
 assert.equal(saturday.focus,'KR');
 assert.equal(saturday.regions.KR.calendarBasis,'weekend-by-local-calendar');
});
test('Saturday before dawn in Seoul remains Friday regular US market time',()=>{
 const saturday=iso('2026-11-21T03:00:00+09:00');
 assert.equal(saturday.regions.KR.window,'weekend');
 assert.equal(saturday.regions.US.window,'regular-clock-window');
 assert.equal(saturday.regions.US.localDate,'2026-11-20');
 assert.equal(saturday.focus,'US');
});
test('weekday clock window never claims holiday verification',()=>{
 const x=iso('2026-11-20T10:00:00+09:00');
 assert.equal(x.regions.KR.window,'regular-clock-window');
 assert.equal(x.regions.KR.calendarBasis,'weekdays-only-holiday-unverified');
 assert.equal(x.regions.KR.tradingOpenConfirmed,false);
});
test('explicitly supplied holiday closure blocks regular-session window with clear provenance',()=>{
 const now=Date.parse('2026-11-20T10:00:00+09:00');
 const x=session.context({now,calendar:{KR:{'2026-11-20':'closed'}}});
 assert.equal(x.regions.KR.window,'calendar-supplied-closed');
 assert.equal(x.regions.KR.calendarBasis,'owner-supplied-calendar-unverified');
 assert.equal(x.regions.KR.tradingOpenConfirmed,false);
 assert.equal(x.regions.KR.suppliedCalendarStatus,'closed');
});
test('NYSE supplied early close modifies time window but never proves official schedule',()=>{
 const override={US:{'2026-11-27':{status:'early-close',closeMinute:13*60}}};
 const before=session.context({now:Date.parse('2026-11-28T02:59:00+09:00'),calendar:override});
 const after=session.context({now:Date.parse('2026-11-28T03:00:00+09:00'),calendar:override});
 assert.equal(before.regions.US.localDate,'2026-11-27');
 assert.equal(before.regions.US.window,'regular-clock-window');
 assert.equal(after.regions.US.window,'after-regular-window');
 assert.equal(after.regions.US.referenceKst.closing.kstTime,'03:00');
 assert.equal(after.regions.US.calendarBasis,'owner-supplied-calendar-unverified');
 assert.equal(after.regions.US.holidayVerified,false);
});
test('bad supplied early close does not silently invent official exchange schedules',()=>{
 const now=Date.parse('2026-11-28T04:00:00+09:00');
 const x=session.context({now,calendar:{US:{'2026-11-27':{
  status:'early-close',closeMinute:1
 }}}});
 assert.equal(x.regions.US.window,'regular-clock-window');
 assert.equal(x.regions.US.suppliedCalendarStatus,null);
 assert.equal(x.regions.US.calendarBasis,'weekdays-only-holiday-unverified');
});
test('unknown calendar values and bogus weekend overrides cannot invent market opening',()=>{
 const weekend=Date.parse('2026-11-21T10:00:00+09:00');
 const x=session.context({now:weekend,calendar:{KR:{'2026-11-21':'open'}}});
 assert.equal(x.regions.KR.window,'weekend');
 const weekday=session.context({now:Date.parse('2026-11-20T09:30:00+09:00'),
  calendar:{KR:{'2026-11-20':'open'}}});
 assert.equal(weekday.regions.KR.window,'regular-clock-window');
 assert.equal(weekday.regions.KR.calendarBasis,'weekdays-only-holiday-unverified');
});
test('weekend reference local zone includes both correct market clocks',()=>{
 const x=iso('2026-11-21T12:00:00+09:00');
 assert.equal(x.regions.KR.zone,'Asia/Seoul');
 assert.equal(x.regions.US.zone,'America/New_York');
 assert.equal(x.regions.KR.localDate,'2026-11-21');
 assert.equal(x.regions.US.localDate,'2026-11-20');
});
test('weekend and supplied closures never expose hypothetical regular-session instants',()=>{
 const weekend=session.context({now:Date.parse('2026-03-08T15:00:00+09:00')});
 assert.equal(weekend.regions.US.localDate,'2026-03-08');
 assert.equal(weekend.regions.US.window,'weekend');
 assert.equal(weekend.regions.US.referenceKst.opening,null);
 assert.equal(weekend.regions.US.referenceKst.closing,null);
 const closed=session.context({
  now:Date.parse('2026-11-20T11:00:00+09:00'),
  calendar:{KR:{'2026-11-20':'closed'}}
 });
 assert.equal(closed.regions.KR.window,'calendar-supplied-closed');
 assert.equal(closed.regions.KR.referenceKst.opening,null);
 assert.equal(closed.regions.KR.referenceKst.closing,null);
});
test('invalid timestamp is explicit failure without consulting Date.now',()=>{
 for(const now of [undefined,NaN,0,Infinity,-1,'2026-11-20']){
  const value=session.context({now});
  assert.equal(value.status,'invalid');
  assert.equal(value.code,'INVALID_CLOCK');
 }
});
test('result is pure and preserves supplied calendar input',()=>{
 const calendar={US:{'2026-11-27':{status:'early-close',closeMinute:780}}};
 const original=JSON.stringify(calendar);
 const now=Date.parse('2026-11-28T02:00:00+09:00');
 const a=session.context({now,calendar}),b=session.context({now,calendar});
 assert.equal(JSON.stringify(calendar),original);
 assert.deepEqual(a,b);
});
test('session module exposes no network, storage, NH, GAS, or order paths',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../js/market-session-context-v1.js'),'utf8');
 for(const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService', 'NH_ACCOUNT', 'placeOrder(', 'createOrder(']){
  assert.equal(src.includes(forbidden),false,forbidden);
 }
});
