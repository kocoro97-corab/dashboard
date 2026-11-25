'use strict';
const assert=require('node:assert/strict');
const {parse,fromNewYork,classify,SOURCE}=require('../js/economic-bls-parser.js');
const sample=['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:cpi-1','DTSTART;TZID=America/New_York:20261124T083000','SUMMARY:Consumer Price Index for October 2026','END:VEVENT','BEGIN:VEVENT','UID:nfp-1','DTSTART;TZID=America/New_York:20261106T083000','SUMMARY:Employment Situation for October 2026','END:VEVENT','BEGIN:VEVENT','UID:ppi-1','DTSTART;TZID=America/New_York:20261125T083000','SUMMARY:Producer Price Index for October 2026','END:VEVENT','BEGIN:VEVENT','UID:unknown','DTSTART;TZID=America/New_York:20261125T100000','SUMMARY:Unrelated press release','END:VEVENT','END:VCALENDAR'].join('\r\n');
const out=parse(sample,{retrievedAt:'2026-11-23T00:00:00Z'});
assert.equal(out.events.length,3);
assert.equal(out.sourceUrl,SOURCE);
assert.deepEqual(out.events.map(e=>e.type),['NFP','CPI','PPI']);
assert.deepEqual(out.events.map(e=>e.date),['2026-11-06','2026-11-24','2026-11-25']);
assert.ok(out.events.every(e=>e.verified&&e.sourceUrl===SOURCE));
assert.equal(out.events.find(e=>e.type==='CPI').priority,'critical');
assert.equal(fromNewYork('20261124T083000'),'2026-11-24T13:30:00.000Z');
assert.equal(fromNewYork('20260724T083000'),'2026-07-24T12:30:00.000Z');
assert.equal(fromNewYork('20261101T013000'),null,'DST ambiguous local time must be rejected');
assert.equal(fromNewYork('20260308T023000'),null,'DST nonexistent local time must be rejected');
assert.equal(classify('Unknown data'),null);
assert.throws(()=>parse('NOT A VCALENDAR'),/BLS_ICS_INVALID/);
assert.equal(parse(sample.replace('America/New_York','Unknown/Zone'),{retrievedAt:'2026-11-23T00:00:00Z'}).events.length,2);
assert.equal(parse(sample.replace('DTSTART;TZID=America/New_York:20261124T083000','DTSTART:20261124T083000'),{retrievedAt:'2026-11-23T00:00:00Z'}).events.length,3,'BLS floating times are explicitly Eastern');
const utcSample=['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:utc-fixture',
 'DTSTART:20261124T133000Z','SUMMARY:Consumer Price Index','END:VEVENT',
 'BEGIN:VEVENT','UID:allday-fixture','DTSTART;VALUE=DATE:20261126',
 'SUMMARY:Employment Situation','END:VEVENT','END:VCALENDAR'].join('\r\n');
const parsedUTC=parse(utcSample,{retrievedAt:'2026-11-23T00:00:00Z'});
assert.equal(parsedUTC.events.length,1,'UTC timestamp accepted, all-day time never invented');
assert.equal(parsedUTC.events[0].startsAt,'2026-11-24T13:30:00.000Z');
assert.equal(parsedUTC.events[0].localTime,'22:30');
assert.equal(parse(sample.replaceAll('America/New_York','US-Eastern')).events.length,3,'official BLS hyphenated TZID');
console.log('Economic BLS parser PASS');
