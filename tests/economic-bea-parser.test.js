'use strict';
const assert=require('node:assert/strict');
const {SOURCE,parse}=require('../js/economic-bea-parser.js');
const fixture={
 'Gross Domestic Product':{release_dates:['2026-11-25T13:30:00+00:00','2026-11-25T13:30:00+00:00','2027-04-29T12:30:00+00:00']},
 'Personal Income and Outlays':{release_dates:['2026-11-25T13:30:00+00:00']},
 'U.S. International Trade in Goods and Services':{release_dates:['2026-12-08T13:30:00+00:00']},
 'Not recognized':{release_dates:['2026-11-24T13:30:00+00:00']}
};
const result=parse(fixture,{retrievedAt:'2026-11-23T01:00:00.000Z'});
assert.equal(result.events.length,4,'duplicate GDP release removed, unknown topics ignored');
assert.equal(result.sourceUrl,SOURCE);
const gdp=result.events.find(x=>x.type==='GDP'&&x.startsAt.startsWith('2026'));
assert.equal(gdp.date,'2026-11-25');assert.equal(gdp.priority,'critical');
assert.equal(result.events.find(x=>x.type==='PCE').title,'미국 개인소득·소비지출(PCE) 발표');
assert.equal(result.events.find(x=>x.type==='TRADE').priority,'high');
assert.equal(result.events.find(x=>x.startsAt.startsWith('2027')).date,'2027-04-29');
assert.throws(()=>parse({}),/BEA_NO_VERIFIED_EVENTS/);
assert.throws(()=>parse({'Gross Domestic Product':{release_dates:'bad'}}),/BEA_SCHEMA_INVALID/);
assert.throws(()=>parse(null),/BEA_INVALID/);
const malformed=parse({'Gross Domestic Product':{release_dates:['2026-11-25T13:30:00','2026-11-25T13:30:00+00:00']}});
assert.equal(malformed.events.length,1,'timezone-less timestamps rejected');
console.log('BEA economic schedule parser PASS');
