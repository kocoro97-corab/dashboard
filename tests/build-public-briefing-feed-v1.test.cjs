'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const archive=require('../js/news-briefing-archive-v1.js');
const transfer=require('../js/news-briefing-transfer-v1.js');
const publisher=require('../tools/build_public_briefing_feed_v1.cjs');
const NOW=Date.parse('2026-11-21T15:00:00+09:00');
const GEN=Date.parse('2026-11-21T07:03:00+09:00');
function makeRecord(patch={}){
 const value=archive.normalize({
  schemaVersion:1,date:'2026-11-21',origin:'chatgpt-task',
  title:'공개 시장 동향',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
  visibility:'public-market-only',generatedAt:GEN,
  observedAt:GEN-7200000,retrievedAt:GEN-1800000,
  rawText:'합성 공개 시장 전용 요약',sections:[],sources:[],...patch
 },{now:NOW});
 assert.equal(value.ok,true,value.code);return value.record;
}
function backup(rows=[makeRecord()]){
 const out=transfer.exportJSON(rows,{now:NOW});
 assert.equal(out.ok,true,out.code);return out.json;
}
test('builder outputs exact same-origin public feed schema and no publish claim',()=>{
 const out=publisher.convert(backup(),{now:NOW});
 assert.equal(out.ok,true,out.code);
 const data=JSON.parse(out.json);
 assert.deepEqual(Object.keys(data),['type','schemaVersion','records']);
 assert.equal(data.type,'public-briefing-feed-v1');
 assert.equal(data.records.length,1);
 assert.equal(out.originAuthenticated,false);
 assert.equal(out.marketDataVerified,false);
 assert.equal(out.scheduledDeliveryConfirmed,false);
 assert.equal(out.autoPublished,false);
 assert.equal(archive.parseFeed(data,{now:NOW}).ok,true);
});
test('private account fields and credentials are blocked before public JSON generation',()=>{
 const fake=JSON.parse(backup());
 fake.records[0].accountNumber='1234567';
 assert.equal(publisher.convert(JSON.stringify(fake),{now:NOW}).ok,false);
 delete fake.records[0].accountNumber;
 fake.records[0].rawText='계좌번호: 123456';
 assert.equal(publisher.convert(JSON.stringify(fake),{now:NOW}).ok,false);
});
test('empty input and 3MB+ payload fail without generating a file',()=>{
 assert.equal(publisher.convert(backup([]),{now:NOW}).code,'NO_PUBLIC_BRIEFINGS');
 assert.equal(publisher.convert(' '.repeat(3000001),{now:NOW}).code,'INPUT_TOO_LARGE');
 assert.equal(publisher.convert('not-json',{now:NOW}).ok,false);
});
test('public feed generator preserves timestamp and declared origin without inventing provenance',()=>{
 const record=makeRecord({origin:'manual',generatedAt:null,observedAt:null,retrievedAt:null});
 const data=publisher.convert(backup([record]),{now:NOW});
 assert.equal(data.ok,true);
 const body=JSON.parse(data.json).records[0];
 assert.equal(body.generatedAt,null);
 assert.equal(body.origin,'manual');
});
