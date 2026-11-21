'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const archive=require('../js/news-briefing-archive-v1.js');
const feed=require('../js/news-briefing-public-feed-v1.js');

const NOW=Date.parse('2026-11-21T15:00:00+09:00');
const GENERATION=Date.parse('2026-11-21T07:05:00+09:00');
function record(patch={}){
 const out=archive.normalize({
  schemaVersion:1,date:'2026-11-21',origin:'chatgpt-task',
  visibility:'public-market-only',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
  title:'Test public markets only',generatedAt:GENERATION,
  observedAt:GENERATION-3600000,retrievedAt:GENERATION-600000,
  rawText:'Synthetic content. No real prices.',sources:[],sections:[],
  ...patch
 },{now:NOW});
 assert.equal(out.ok,true,out.code);
 return out.record;
}
function payload(records=[record()]){
 return JSON.stringify({type:'public-briefing-feed-v1',schemaVersion:1,records});
}
function response(json,options={}){
 return {
  status:options.status??200,
  headers:{get(name){return name==='content-type'?(options.contentType??'application/json'):
    name==='content-length'?(options.contentLength??null):null}},
  async text(){return json}
 };
}
function fake(json,options={}) {
 const calls=[];
 const fetcher=async (url,opts)=>{
  calls.push({url,opts});
  return response(json,options);
 };
 return {calls,fetcher};
}
function args(fetcher,baseHref='https://example.org/my-invest/index.html#/news'){
 return {fetcher,baseHref,now:NOW};
}
test('fixed same-origin URL handles repo subpaths and hash routes',()=>{
 assert.equal(feed.sourceUrl('https://example.org/my-invest/index.html#/news'),
   'https://example.org/my-invest/data/myinvest-public-briefings-v1.json');
 assert.equal(feed.sourceUrl('https://example.org/my-invest/#/news'),
   'https://example.org/my-invest/data/myinvest-public-briefings-v1.json');
 assert.equal(feed.sourceUrl('https://example.org/my-invest/index.html?x=1#/news'),
   'https://example.org/my-invest/data/myinvest-public-briefings-v1.json');
 assert.equal(feed.sourceUrl('data/evil.json'),null);
 assert.equal(feed.sourceUrl('javascript:alert(1)'),null);
});
test('public feed request never sends tokens, cookies, account state or cross-origin URL',async()=>{
 const {calls,fetcher}=fake(payload());
 const r=await feed.load(args(fetcher));
 assert.equal(r.ok,true,r.code);
 assert.equal(r.verified,false);
 assert.equal(r.chatgptScheduledDeliveryConfirmed,false);
 assert.equal(r.marketDataVerified,false);
 assert.equal(r.records.length,1);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].opts.headers,{Accept:'application/json'});
 assert.equal(calls[0].opts.credentials,'omit');
 assert.equal(calls[0].opts.mode,'same-origin');
 assert.equal(calls[0].opts.redirect,'error');
 assert.equal(calls[0].opts.method,'GET');
 assert.equal(calls[0].opts.cache,'no-store');
 assert.equal(calls[0].url,'https://example.org/my-invest/data/myinvest-public-briefings-v1.json');
 assert.equal(JSON.stringify(calls[0]).includes('accountNumber'),false);
});
test('unpublished feed gives explicit unavailable status without fabricating data',async()=>{
 const {fetcher}=fake('',{status:404});
 const r=await feed.load(args(fetcher));
 assert.deepEqual(r.records,[]);
 assert.equal(r.code,'PUBLIC_FEED_NOT_PUBLISHED');
 assert.equal(r.verified,false);
});
test('expired feed is distinguished from normal current report',async()=>{
 const {fetcher}=fake('',{status:410});
 const r=await feed.load(args(fetcher));
 assert.equal(r.code,'PUBLIC_FEED_NOT_PUBLISHED');
});
test('response failures do not fall back to fabricated report',async()=>{
 const {fetcher}=fake('',{status:500});
 assert.equal((await feed.load(args(fetcher))).code,'PUBLIC_FEED_HTTP_FAILURE');
 const down=await feed.load(args(async()=>{throw Error('offline')}));
 assert.equal(down.code,'FETCH_UNAVAILABLE');
 assert.deepEqual(down.records,[]);
});
test('redirects are blocked at request level and credential isolation remains explicit',async()=>{
 const {calls,fetcher}=fake(payload());
 await feed.load(args(fetcher));
 assert.equal(calls[0].opts.redirect,'error');
 assert.equal(calls[0].opts.credentials,'omit');
});
test('non-JSON content and invalid JSON are rejected',async()=>{
 assert.equal((await feed.load(args(fake('<html>hello</html>',{contentType:'text/html'}).fetcher))).code,
  'NOT_JSON_CONTENT_TYPE');
 assert.equal((await feed.load(args(fake('broken{').fetcher))).code,
  'INVALID_PUBLIC_FEED_JSON');
});
test('oversized headers and oversized bodies are rejected',async()=>{
 const bigHeader=fake(payload(),{contentLength:'3000001'});
 assert.equal((await feed.load(args(bigHeader.fetcher))).code,'PUBLIC_FEED_TOO_LARGE');
 const bigBody=fake(' '.repeat(3000001));
 assert.equal((await feed.load(args(bigBody.fetcher))).code,'PUBLIC_FEED_TOO_LARGE');
});
test('unexpected public feed top-level fields and private holdings are rejected',async()=>{
 const extra=JSON.parse(payload());
 extra.account='DO_NOT_INCLUDE';
 assert.equal((await feed.load(args(fake(JSON.stringify(extra)).fetcher))).code,
  'UNEXPECTED_PUBLIC_FEED_FIELDS');
 const nested=JSON.parse(payload());
 nested.records[0].holdings=[{accountNumber:'123456'}];
 assert.match((await feed.load(args(fake(JSON.stringify(nested)).fetcher))).code,/INVALID_PUBLIC_FEED_RECORD_/);
});
test('explicit possible private account values in text are rejected',async()=>{
 const secret=record({rawText:'계좌번호: 12345678901'});
 const out=await feed.load(args(fake(payload([secret])).fetcher));
 assert.match(out.code,/INVALID_PUBLIC_FEED_RECORD_/);
});
test('one invalid record rejects entire file, never partial successes',async()=>{
 const bad={...record(),visibility:'account-private'};
 const result=await feed.load(args(fake(payload([record(),bad])).fetcher));
 assert.equal(result.ok,false);
 assert.deepEqual(result.records,[]);
});
test('missing records and unsupported versions are rejected',async()=>{
 for(const data of [
  {type:'public-briefing-feed-v1',schemaVersion:1,records:[]},
  {type:'public-briefing-feed-v1',schemaVersion:2,records:[record()]},
  {type:'other',schemaVersion:1,records:[record()]}
 ]){
  const out=await feed.load(args(fake(JSON.stringify(data)).fetcher));
  assert.equal(out.code,'INVALID_PUBLIC_FEED_ENVELOPE');
 }
});
test('a legitimate report can show older date without claiming it is latest',async()=>{
 const old=record({date:'2026-11-20',
  generatedAt:GENERATION-86400000,observedAt:GENERATION-90000000,
  retrievedAt:GENERATION-87000000});
 const result=await feed.load(args(fake(payload([old])).fetcher));
 assert.equal(result.ok,true);
 assert.equal(result.records[0].date,'2026-11-20');
 assert.equal(result.marketDataVerified,false);
});
test('fetch cannot start from unknown base or missing fetcher',async()=>{
 assert.equal((await feed.load(args(async()=>{},'file:///home/index.html'))).code,
  'INVALID_SAME_ORIGIN_BASE');
 assert.equal((await feed.load({baseHref:'https://example.org/index.html',now:NOW})).code,
  'UNAVAILABLE_DEPENDENCY');
});
test('view mount input guard rejects missing host without network',()=>{
 assert.equal(feed.mount(null).code,'INVALID_TARGET');
});
