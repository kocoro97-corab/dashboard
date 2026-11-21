'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const brief=require('../js/news-briefing-archive-v1.js');
const TODAY=Date.parse('2026-11-21T12:00:00+09:00');
const GEN=Date.parse('2026-11-21T07:02:00+09:00');
const OBS=Date.parse('2026-11-21T05:55:00+09:00');
const FETCH=Date.parse('2026-11-21T06:35:00+09:00');
const record=(patch={})=>({
 schemaVersion:1,date:'2026-11-21',origin:'chatgpt-task',visibility:'public-market-only',
 timeZone:'Asia/Seoul',scheduleLocal:'07:00',
 title:'오전 7시 투자 브리핑',
 generatedAt:GEN,observedAt:OBS,retrievedAt:FETCH,
 rawText:null,
 sources:[{id:'fed',title:'Official market data',url:'https://example.org/report#topic',publishedAt:OBS}],
 sections:[{kind:'us-market',heading:'미국장',body:'S&P 500 · SOX · 금리·환율',
  sourceIds:['fed']}],
 ...patch
});
function normalized(r=record()){const x=brief.normalize(r,{now:TODAY});assert.equal(x.ok,true,x.code);return x.record;}

test('accepts structured 07:00 KST public briefing and explicitly refuses false verification claims',()=>{
 const o=brief.normalize(record(),{now:TODAY});
 assert.equal(o.ok,true);
 assert.equal(o.record.date,'2026-11-21');
 assert.equal(o.record.scheduleLocal,'07:00');
 assert.equal(o.record.generatedAt,GEN);
 assert.equal(o.record.sources[0].url,'https://example.org/report');
 assert.deepEqual(o.record.sections[0].sourceIds,['fed']);
 assert.equal(o.verification.originAuthenticated,false);
 assert.equal(o.verification.marketDataVerified,false);
 assert.equal(o.verification.scheduledDeliveryConfirmed,false);
 assert.ok(o.review.includes('SOURCE_ORIGIN_UNVERIFIED'));
});
test('allows text-only scheduled task output without inventing source links',()=>{
 const x=brief.normalize(record({rawText:'지난 미국 증시 마감 요약.\n국내 대응 전략.',
  sections:[],sources:[]}),{now:TODAY});
 assert.equal(x.ok,true);
 assert.equal(x.record.sections.length,0);
 assert.ok(x.review.includes('NO_CITABLE_SOURCES'));
 assert.equal(x.record.rawText.includes('국내'),true);
});
test('KST day boundary and impossible calendar dates are enforced',()=>{
 const earlier=Date.parse('2026-11-20T23:59:59+09:00');
 assert.equal(brief.kstDate(earlier),'2026-11-20');
 assert.equal(brief.kstDate(TODAY),'2026-11-21');
 for(const date of ['2026-02-30','2026-13-01','2026-11-22','bad-date']){
  assert.equal(brief.normalize(record({date}),{now:TODAY}).ok,false);
 }
});
test('KST schedule is a metadata label and cannot be silently changed to 5AM',()=>{
 for(const patch of [{scheduleLocal:'05:00'},{timeZone:'UTC'},{visibility:'account-private'},
  {origin:'untrusted-provider'}]){
  const r=brief.normalize(record(patch),{now:TODAY});
  assert.equal(r.ok,false);
 }
});
test('auto generated time is required, but legacy manual reports preserve missing source timestamps',()=>{
 const task=brief.normalize(record({generatedAt:null}),{now:TODAY});
 assert.equal(task.code,'AUTOMATIC_GENERATED_TIME_REQUIRED');
 const old=brief.legacy({date:'2026-11-20',text:'수동 공개 보고서',at:TODAY-3600000},{now:TODAY});
 assert.equal(old.ok,true);
 assert.equal(old.record.origin,'manual');
 assert.equal(old.record.generatedAt,null);
 assert.equal(old.record.observedAt,null);
 assert.equal(old.record.retrievedAt,null);
 assert.ok(old.review.includes('MARKET_OBSERVATION_UNKNOWN'));
});
test('saved time is not treated as generated time, including manual future time protections',()=>{
 const old=brief.legacy({date:'2026-11-20',text:'공개 시장',at:1},{now:TODAY});
 assert.equal(old.ok,true);assert.equal(old.record.generatedAt,null);
 assert.equal(brief.legacy({date:'2026-11-20',text:'x',at:TODAY+3600000},{now:TODAY}).ok,false);
});
test('rejects future, invalid or inverted market observation/retrieval timestamps',()=>{
 for(const patch of [
  {generatedAt:TODAY+3600000},
  {observedAt:FETCH+1},
  {retrievedAt:GEN+600000},
  {generatedAt:'2026-11-21T07:00:00'},
  {generatedAt:Date.parse('2026-11-20T22:00:00+09:00')}
 ]){
  assert.equal(brief.normalize(record(patch),{now:TODAY}).ok,false);
 }
});
test('URL policy excludes non-HTTPS, embedded credentials, localhost/IP and escaped host tricks',()=>{
 for(const url of ['http://example.com','javascript:alert(1)',
  'https://user:pass@example.org/a','https://localhost/a',
  'https://192.168.0.5/a','https://router.local/a',
  'https://example.com/evil\\url','https://example.com/has space']){
  assert.equal(brief.safeUrl(url),null);
  assert.equal(brief.normalize(record({sources:[{id:'x',title:'A',url}]}),{now:TODAY}).ok,false);
 }
});
test('duplicate source IDs, missing citations and invalid section type are blocked',()=>{
 const original=record();
 const source=original.sources[0];
 for(const patch of [
  {sources:[source,source]},
  {sections:[{kind:'us-market',heading:'미국',body:'data',sourceIds:['missing']}]},
  {sections:[{kind:'server',heading:'x',body:'y',sourceIds:['fed']}]},
  {sections:[{kind:'us-market',heading:'x',body:'y'}]},
  {sections:[],rawText:null}
 ]){
  assert.equal(brief.normalize(record(patch),{now:TODAY}).ok,false);
 }
});
test('public report rejects recognizable bearer tokens or secret-key disclosures',()=>{
 for(const body of [
  'Bearer abcdefghijklmnopqrstuvwxyz',
  'sk-abcdefghijklmnopabcdefghijklmnop',
  'api_key=abcdefghijklmnop'
 ]){
  const output=brief.normalize(record({rawText:body,sections:[]}),{now:TODAY});
  assert.equal(output.code,'POSSIBLE_SECRET_IN_PUBLIC_REPORT');
 }
});
test('XSS-like input remains literal source text, with no HTML renderer in this module',()=>{
 const data=record({rawText:'<img src=x onerror=alert(1)>',sections:[]});
 const out=brief.normalize(data,{now:TODAY});
 assert.equal(out.ok,true);
 assert.equal(out.record.rawText,data.rawText);
 assert.equal(typeof brief.render,'undefined');
});
test('manual report and automatic report of same date can coexist, with latest auto selected',()=>{
 const manual=normalized(record({origin:'manual',title:'수동',generatedAt:null,
  rawText:'공개 수동 기록',sections:[],sources:[]}));
 const auto=normalized();
 const merged=brief.archive([manual],auto,{now:TODAY});
 assert.equal(merged.ok,true);
 assert.equal(merged.records.length,2);
 const selected=brief.selection(merged.records,{now:TODAY});
 assert.equal(selected.ok,true);
 assert.equal(selected.selected.origin,'chatgpt-task');
 assert.equal(selected.isToday,true);
 assert.equal(selected.freshness,'TODAY_UNVERIFIED');
 assert.equal(selected.dates.length,1);
 assert.ok(selected.label.includes('자동 수신 검증 전'));
});
test('archive deduplicates same origin/date and retains later generated entry on repeated updates',()=>{
 const later=record({generatedAt:GEN+360000,rawText:'수정된 버전',sections:[]});
 const existing=[normalized()];
 const first=brief.archive(existing,later,{now:TODAY});
 const second=brief.archive(first.records,record(),{now:TODAY});
 assert.equal(first.records.length,1);
 assert.equal(second.records.length,1);
 assert.equal(second.records[0].rawText,'수정된 버전');
});
test('archive selector always distinguishes today from archived previous date',()=>{
 const prev=record({date:'2026-11-20',generatedAt:GEN-86400000,
  observedAt:OBS-86400000,retrievedAt:FETCH-86400000});
 const out=brief.selection([normalized(prev)],{now:TODAY});
 assert.equal(out.ok,true);
 assert.equal(out.isToday,false);
 assert.equal(out.freshness,'ARCHIVED_NOT_TODAY');
 assert.equal(out.selected.date,'2026-11-20');
 assert.equal(brief.selection([normalized(prev)],{now:TODAY,date:'2026-11-21'}).empty,true);
});
test('public feed is read-only and fails closed for malformed or private-account records',()=>{
 const parsed=brief.parseFeed({type:'public-briefing-feed-v1',schemaVersion:1,records:[record()]},{now:TODAY});
 assert.equal(parsed.ok,true);
 assert.equal(parsed.records.length,1);
 assert.equal(parsed.provenance,'TRANSPORT_UNAUTHENTICATED_NOT_VERIFIED');
 assert.equal(parsed.accountDataIncluded,false);
 assert.equal(parsed.liveMarketDataVerified,false);
 const bad=brief.parseFeed({type:'public-briefing-feed-v1',schemaVersion:1,
  records:[record(),record({visibility:'account-private'})]},{now:TODAY});
 assert.equal(bad.ok,false);
});
test('all operations are deterministic and do not mutate report or existing archive',()=>{
 const original=record(),copy=JSON.stringify(original);
 const a=brief.normalize(original,{now:TODAY}),b=brief.normalize(original,{now:TODAY});
 assert.deepEqual(a,b);
 const saved=[a.record],before=JSON.stringify(saved);
 assert.deepEqual(brief.archive(saved,original,{now:TODAY}),
  brief.archive(saved,original,{now:TODAY}));
 assert.equal(JSON.stringify(saved),before);
 assert.equal(JSON.stringify(original),copy);
});
test('archive rejects overflow, invalid selected day and unsupported future report date',()=>{
 const long=Array(181).fill(normalized());
 assert.equal(brief.archive(long,record(),{now:TODAY}).code,'INVALID_EXISTING_ARCHIVE');
 assert.equal(brief.selection([], {now:TODAY,date:'2026-11-22'}).code,'INVALID_SELECTED_DATE');
 assert.equal(brief.normalize(record({date:'2026-11-22'}),{now:TODAY}).ok,false);
});
