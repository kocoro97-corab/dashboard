'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const composer=require('../js/news-briefing-market-composer-v1.js');
const build=require('../tools/compose_morning_briefing_v1.cjs');
const archive=require('../js/news-briefing-archive-v1.js');
const NOW=Date.parse('2026-11-21T07:00:00+09:00'),OBS=NOW-5*3600000;
function snapshot(patch={}){
 return {type:'myinvest-public-market-snapshot-v1',schemaVersion:1,
  visibility:'public-market-only',timeZone:'Asia/Seoul',reportDate:'2026-11-21',
  collectedAt:NOW-30000,
  sources:[{id:'provider',title:'Synthetic public provider',url:'https://example.org/market',publishedAt:null}],
  quotes:['sp500','nasdaq','dow','sox'].map((key,i)=>({
   key,value:5000+i*500,changePct:i%2===0?1:-1,
   phase:'close',observedAt:OBS,sourceId:'provider'})),...patch};
}
const make=(snap=snapshot())=>composer.compose(snap,{now:NOW});
test('rule-based briefing preserves observed/retrieved/generated timestamps and no verification claims',()=>{
 const x=make();assert.equal(x.ok,true,x.code);
 assert.equal(x.record.origin,'dashboard-pipeline');
 assert.equal(x.record.generatedAt,NOW);assert.equal(x.record.observedAt,OBS);
 assert.equal(x.record.retrievedAt,NOW-30000);
 assert.equal(x.record.sections.length,8);
 assert.equal(x.record.sections.find(s=>s.kind==='us-market').sourceIds[0],'provider');
 assert.equal(x.marketDataVerified,false);assert.equal(x.autoPublished,false);
 assert.equal(x.ruleBasedNotAI,true);
 assert.equal(archive.normalize(x.record,{now:NOW}).ok,true);
});
test('unavailable markets explicitly marked as unverified without invented prices',()=>{
 const r=make().record;
 assert.match(r.sections.find(x=>x.kind==='futures').body,/선물: 미확인/);
 assert.match(r.sections.find(x=>x.kind==='rates-fx').body,/원\/달러: 미확인/);
 assert.match(r.sections.find(x=>x.kind==='risk').body,/TICK/);
 assert.equal(r.sections.find(x=>x.kind==='risk').body.includes('+1000'),false);
});
test('optional sourced numeric inputs appear with declared phase and observation',()=>{
 const s=snapshot();
 s.quotes.push({key:'esf',value:6500.5,changePct:0.2,
  phase:'realtime',observedAt:NOW-100000,sourceId:'provider'});
 const r=make(s);
 assert.equal(r.ok,true,r.code);
 assert.match(r.record.sections.find(x=>x.kind==='futures').body,/6,500.5/);
 assert.match(r.record.sections.find(x=>x.kind==='futures').body,/장중/);
});
test('today KST and fresh collection required',()=>{
 assert.equal(make(snapshot({reportDate:'2026-11-20'})).code,'REPORT_DATE_NOT_TODAY_KST');
 assert.equal(make(snapshot({collectedAt:NOW-13*3600000})).code,'STALE_OR_FUTURE_COLLECTION');
 assert.equal(make(snapshot({collectedAt:NOW+900000})).code,'STALE_OR_FUTURE_COLLECTION');
});
test('four confirmed US close metrics are mandatory',()=>{
 const s=snapshot();
 assert.equal(make(snapshot({quotes:s.quotes.slice(1)})).code,'US_CLOSE_CORE_INCOMPLETE');
 assert.equal(make(snapshot({quotes:s.quotes.map((v,i)=>i?{...v,phase:'realtime'}:v)})).code,'US_CLOSE_CORE_INCOMPLETE');
 assert.equal(make(snapshot({quotes:s.quotes.map((v,i)=>i?{...v,changePct:null}:v)})).code,'US_CLOSE_CORE_INCOMPLETE');
});
test('unapproved quote names including TICK are rejected',()=>{
 const s=snapshot();
 s.quotes.push({key:'nyseTick',value:999,changePct:0,
  phase:'realtime',observedAt:NOW-10000,sourceId:'provider'});
 assert.equal(make(s).code,'INVALID_QUOTE');
});
test('private fields, unsafe URLs and secrets are rejected',()=>{
 const extra=snapshot();extra.accountNumbers=['123456'];
 assert.equal(make(extra).code,'INVALID_SNAPSHOT');
 const link=snapshot();link.sources[0].url='https://example.org/quote?access_token=secret';
 assert.equal(make(link).code,'UNSAFE_URL');
 const privateTitle=snapshot();privateTitle.sources[0].title='계좌번호: 1234567890';
 assert.match(make(privateTitle).code,/PUBLIC_ONLY_/);
});
test('duplicate, future and stale quotes reject entire snapshot',()=>{
 const dup=snapshot();dup.quotes.push({...dup.quotes[0]});
 assert.equal(make(dup).code,'INVALID_QUOTE');
 const stale=snapshot();stale.quotes[0].observedAt=NOW-97*3600000;
 assert.equal(make(stale).code,'INVALID_QUOTE');
 const future=snapshot();future.quotes[0].observedAt=NOW+3600000;
 assert.equal(make(future).code,'INVALID_QUOTE');
});
test('offline feed builder returns exact public static schema without publishing',()=>{
 const r=build.convert(JSON.stringify(snapshot()),{now:NOW});
 assert.equal(r.ok,true,r.code);
 assert.equal(r.ruleBasedNotAI,true);
 const data=JSON.parse(r.json);
 assert.deepEqual(Object.keys(data),['type','schemaVersion','records']);
 assert.equal(data.type,'public-briefing-feed-v1');
 assert.equal(data.records.length,1);
 assert.equal(archive.parseFeed(data,{now:NOW}).ok,true);
});
test('invalid and large input returns no output',()=>{
 assert.equal(build.convert('{',{now:NOW}).code,'INVALID_JSON');
 assert.equal(build.convert(' '.repeat(3000001),{now:NOW}).code,'INPUT_TOO_LARGE');
 const s=snapshot();s.token='private';
 assert.equal(build.convert(JSON.stringify(s),{now:NOW}).ok,false);
});
