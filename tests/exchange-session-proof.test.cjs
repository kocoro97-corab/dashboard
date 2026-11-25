'use strict';
const assert=require('node:assert/strict');
const P=require('../js/exchange-session-proof.js');
const h=(s)=>Math.floor(Date.parse(s)/1000);
const now=Date.parse('2026-11-24T18:00:00Z'); // 13:00 New York, preclose
const dates=['2026-11-20T14:30:00Z','2026-11-23T14:30:00Z','2026-11-24T14:30:00Z'];
const usMeta={exchangeTimezoneName:'America/New_York',regularMarketTime:h('2026-11-24T17:55:00Z'),
 currentTradingPeriod:{regular:{start:h('2026-11-24T14:30:00Z'),end:h('2026-11-24T21:00:00Z')}}};
let r=P.infer({market:'US',meta:usMeta,timestamps:dates.map(h),now});
assert.equal(r.status,'ready');
assert.deepEqual(r.dates,['2026-11-20','2026-11-23','2026-11-24']);
assert.deepEqual(r.closedDates,['2026-11-20','2026-11-23']);
assert.deepEqual(r.openDates,['2026-11-24']);
assert.equal(r.currentSessionVerified,false);
assert.equal(P.localDay(Date.parse('2026-11-24T01:00:00Z'),'America/New_York'),'2026-11-23');
const tomorrow=Date.parse('2026-11-25T06:00:00Z'); // 01:00 New York, next exchange-local date
r=P.infer({market:'US',meta:usMeta,timestamps:dates.map(h),now:tomorrow});
assert.equal(r.closedDates.length,3);
const closeMeta={...usMeta,regularMarketTime:h('2026-11-24T20:58:00Z')};
r=P.infer({market:'US',meta:closeMeta,timestamps:dates.map(h),now:Date.parse('2026-11-24T21:08:00Z')});
assert.equal(r.closedDates.length,3,'current session only after close + 5 minute buffer with trusted regular market time');
const unconfirmed={...usMeta,regularMarketTime:h('2026-11-24T17:55:00Z')};
r=P.infer({market:'US',meta:unconfirmed,timestamps:dates.map(h),now:Date.parse('2026-11-24T21:08:00Z')});
assert.equal(r.openDates.length,1,'last close time is not confirmed by stale regularMarketTime');
const krMeta={exchangeTimezoneName:'Asia/Seoul',currentTradingPeriod:{regular:{start:h('2026-11-24T00:00:00Z'),end:h('2026-11-24T06:30:00Z')}},
 regularMarketTime:h('2026-11-24T06:29:00Z')};
const krTimes=[h('2026-11-23T00:00:00Z'),h('2026-11-24T00:00:00Z')];
r=P.infer({market:'KR',meta:krMeta,timestamps:krTimes,now:Date.parse('2026-11-24T03:00:00Z')});
assert.equal(r.openDates.length,1);
r=P.infer({market:'KR',meta:krMeta,timestamps:krTimes,now:Date.parse('2026-11-24T06:39:00Z')});
assert.equal(r.currentSessionVerified,true);
r=P.infer({market:'KR',meta:{...krMeta,exchangeTimezoneName:'America/New_York'},timestamps:krTimes,now:Date.parse('2026-11-24T06:39:00Z')});
assert.equal(r.status,'unavailable');
const same=[h('2026-11-24T14:30:00Z'),h('2026-11-24T16:00:00Z')];
assert.equal(P.infer({market:'US',meta:usMeta,timestamps:same,now}).status,'unavailable','duplicate session must fail');
const invalidFuture=[h('2026-11-24T14:30:00Z'),h('2026-11-25T14:30:00Z')];
assert.equal(P.infer({market:'US',meta:usMeta,timestamps:invalidFuture,now}).status,'unavailable');
assert.equal(P.infer({market:'US',meta:usMeta,timestamps:[],now}).status,'unavailable');
assert.equal(P.localDay(Date.parse('2026-11-24T03:00:00Z'),'Asia/Seoul'),'2026-11-24');
console.log('Exchange session proof: KR/US DST, local date, open-vs-closed and provenance PASS');
