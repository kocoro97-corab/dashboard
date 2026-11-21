'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const archive=require('../js/news-briefing-archive-v1.js');
const io=require('../js/news-briefing-transfer-v1.js');
const NOW=Date.parse('2026-11-21T15:00:00+09:00');
const GEN=Date.parse('2026-11-21T07:03:00+09:00');
const OBS=Date.parse('2026-11-21T05:55:00+09:00');
const FETCH=Date.parse('2026-11-21T06:50:00+09:00');
function draft(overrides={}){
 return {
  schemaVersion:1,date:'2026-11-21',origin:'chatgpt-task',
  visibility:'public-market-only',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
  title:'투자 브리핑',generatedAt:GEN,observedAt:OBS,retrievedAt:FETCH,
  rawText:null,
  sources:[{id:'s1',title:'공개 보도자료',url:'https://example.org/article#part',publishedAt:OBS}],
  sections:[{kind:'us-market',heading:'미국 증시',body:'실제 수치가 아닌 단위 테스트 텍스트',
   sourceIds:['s1']}],
  ...overrides
 };
}
const normal=(d=draft())=>{const r=archive.normalize(d,{now:NOW});assert.equal(r.ok,true,r.code);return r.record;};
const exportOne=(records=[normal()])=>{const r=io.exportJSON(records,{now:NOW});assert.equal(r.ok,true,r.code);return r;};

test('JSON backup exports deterministic schema, literal source links and no storage side effects',()=>{
 const r=exportOne(),doc=JSON.parse(r.json);
 assert.equal(r.filename,'myinvest-public-briefings-2026-11-21.json');
 assert.equal(r.mimeType,'application/json;charset=utf-8');
 assert.equal(r.storageModified,false);
 assert.equal(doc.type,'myinvest-public-briefing-backup-v1');
 assert.equal(doc.schemaVersion,1);
 assert.equal(doc.records.length,1);
 assert.equal(doc.records[0].sources[0].url,'https://example.org/article');
 assert.equal(r.verification.externalOriginAuthenticated,false);
 assert.equal(r.verification.contentSignatureVerified,false);
});
test('backup import roundtrip keeps origin, market clock and source citation without claiming authenticity',()=>{
 const original=normal(),exported=exportOne([original]);
 const loaded=io.parseJSON(exported.json,{now:NOW});
 assert.equal(loaded.ok,true);
 assert.deepEqual(loaded.records,[original]);
 assert.equal(loaded.verification.marketDataVerified,false);
 assert.equal(loaded.storageModified,false);
});
test('top-level unknown fields and extra private account fields are rejected instead of silently stripped',()=>{
 const obj=JSON.parse(exportOne().json);
 obj.accountBalances={accountNumber:'100012345678'};
 assert.equal(io.parseJSON(JSON.stringify(obj),{now:NOW}).code,'INVALID_BACKUP_ENVELOPE');
 delete obj.accountBalances;
 obj.records[0].accountNumber='100012345678';
 assert.equal(io.parseJSON(JSON.stringify(obj),{now:NOW}).code,'UNEXPECTED_OR_PRIVATE_RECORD_FIELD');
 const row=normal();
 row.secret='top-secret';
 assert.equal(io.exportJSON([row],{now:NOW}).code,'UNEXPECTED_OR_PRIVATE_RECORD_FIELD');
});
test('unknown nested source and section properties are blocked',()=>{
 const s=normal();s.sources[0].privateToken='x';
 assert.equal(io.exportJSON([s],{now:NOW}).code,'UNEXPECTED_NESTED_FIELD');
 const t=normal();t.sections[0].accountId='1000';
 assert.equal(io.exportJSON([t],{now:NOW}).code,'UNEXPECTED_NESTED_FIELD');
});
test('obvious private information and credential-shaped source query parameters block public export',()=>{
 for(const rawText of ['계좌번호: 1234567890','주민등록번호: 901010-1234567',
  'password=secret12345','access_token=Bearer123456']){
  const r=io.exportJSON([normal(draft({rawText,sections:[]}))],{now:NOW});
  assert.ok(['POSSIBLE_PRIVATE_INFORMATION','INVALID_RECORD_POSSIBLE_SECRET_IN_PUBLIC_REPORT'].includes(r.code),rawText);
 }
 const link=normal(draft({sources:[{id:'s1',title:'원문',url:'https://example.org/?api_key=something-secret'}]}));
 assert.equal(io.exportJSON([link],{now:NOW}).code,'POSSIBLE_PRIVATE_INFORMATION');
});
test('a single malformed record blocks the whole import instead of dropping and misreporting completeness',()=>{
 const data=JSON.parse(exportOne().json);
 data.records.push({...data.records[0],date:'2026-11-20',generatedAt:1,
  visibility:'account-private'});
 const x=io.parseJSON(JSON.stringify(data),{now:NOW});
 assert.equal(x.ok,false);
 assert.equal(x.records,null);
});
test('BOM and whitespace are accepted; malformed JSON and future exportedAt are rejected',()=>{
 const text=exportOne().json;
 assert.equal(io.parseJSON('\uFEFF'+text,{now:NOW}).ok,true);
 assert.equal(io.parseJSON(' {not JSON}',{now:NOW}).code,'INVALID_JSON_SYNTAX');
 const bad=JSON.parse(text);bad.exportedAt=NOW+3600000;
 assert.equal(io.parseJSON(JSON.stringify(bad),{now:NOW}).code,'INVALID_BACKUP_ENVELOPE');
});
test('identical duplicate rows de-duplicate; conflicting duplicates in one backup fail closed',()=>{
 const original=normal(),copy=structuredClone(original);
 const x=io.exportJSON([original,copy],{now:NOW});
 assert.equal(x.ok,true);
 assert.equal(JSON.parse(x.json).records.length,1);
 copy.rawText='다른 내용';
 assert.equal(io.exportJSON([original,copy],{now:NOW}).code,'CONFLICTING_DUPLICATE_IN_FILE');
});
test('merge adds new reports while preserving same-day manual and ChatGPT task origin separately',()=>{
 const manual=normal(draft({origin:'manual',generatedAt:null,rawText:'직접 붙여넣기',
  sections:[],sources:[]}));
 const blob=exportOne();
 const out=io.mergeJSON(blob.json,[manual],{now:NOW});
 assert.equal(out.ok,true);
 assert.equal(out.records.length,2);
 assert.equal(out.stats.added,1);
 assert.equal(out.stats.updated,0);
 assert.deepEqual(out.records.map(x=>x.origin).sort(),['chatgpt-task','manual']);
 assert.equal(out.storageModified,false);
});
test('merge never silently overwrites conflicting same-time reports; opt-in override works',()=>{
 const current=normal();
 const altered=normal(draft({sections:[],rawText:'같은 시각 다른 본문'}));
 const blob=exportOne([altered]);
 const keep=io.mergeJSON(blob.json,[current],{now:NOW});
 assert.equal(keep.ok,true);
 assert.equal(keep.stats.equalTimeConflicts,1);
 assert.equal(keep.records[0].sections[0].kind,'us-market');
 assert.deepEqual(keep.conflicts,[{date:'2026-11-21',origin:'chatgpt-task'}]);
 const replace=io.mergeJSON(blob.json,[current],{now:NOW,onConflict:'replace-on-equal'});
 assert.equal(replace.ok,true);
 assert.equal(replace.records[0].rawText,'같은 시각 다른 본문');
 assert.equal(replace.stats.updated,1);
});
test('merge automatically accepts newer declared generation and ignores older reports',()=>{
 const original=normal();
 const updated=normal(draft({generatedAt:GEN+60000,sections:[],rawText:'새 버전'}));
 const fromNew=io.mergeJSON(exportOne([updated]).json,[original],{now:NOW});
 assert.equal(fromNew.ok,true);
 assert.equal(fromNew.stats.updated,1);
 assert.equal(fromNew.records[0].rawText,'새 버전');
 const fromOld=io.mergeJSON(exportOne([original]).json,[updated],{now:NOW});
 assert.equal(fromOld.ok,true);
 assert.equal(fromOld.stats.olderIgnored,1);
 assert.equal(fromOld.records[0].rawText,'새 버전');
});
test('same report import does not change archive, and repeated import is idempotent',()=>{
 const row=normal(),json=exportOne([row]).json;
 const once=io.mergeJSON(json,[row],{now:NOW});
 const twice=io.mergeJSON(json,once.records,{now:NOW});
 assert.equal(once.stats.unchanged,1);
 assert.equal(twice.stats.unchanged,1);
 assert.deepEqual(once.records,twice.records);
});
test('manual legacy rows are explicitly upgraded, saved receipt is not promoted to generation time',()=>{
 const text=JSON.stringify([{date:'2026-11-20',text:'시장 브리핑',at:NOW-3600000}]);
 const o=io.parseLegacyJSON(text,{now:NOW});
 assert.equal(o.ok,true);
 assert.equal(o.records[0].origin,'manual');
 assert.equal(o.records[0].generatedAt,null);
 assert.equal(o.records[0].observedAt,null);
 assert.equal(o.records[0].rawText,'시장 브리핑');
 assert.equal(io.parseLegacyJSON(JSON.stringify([{date:'2026-11-20',text:'본문',
   at:NOW-3600000,holdings:[{symbol:'TSLA'}]}]),{now:NOW}).code,'INVALID_LEGACY_ROW');
});
test('backup importer never interprets legacy JSON as the public backup envelope',()=>{
 const legacy=JSON.stringify([{date:'2026-11-20',text:'본문',at:1}]);
 assert.equal(io.parseJSON(legacy,{now:NOW}).code,'INVALID_BACKUP_ENVELOPE');
 assert.equal(io.parseLegacyJSON(legacy,{now:NOW}).ok,true);
});
test('limits reject unsupported files, >90 records and oversized content',()=>{
 assert.equal(io.parseJSON('x'.repeat(3000001),{now:NOW}).code,'INVALID_JSON_SIZE');
 assert.equal(io.exportJSON(Array(91).fill(normal()),{now:NOW}).code,'RECORD_LIMIT_EXCEEDED');
 assert.equal(io.mergeJSON(exportOne().json,Array(91).fill(normal()),{now:NOW}).code,
  'INVALID_EXISTING_RECORD_LIMIT_EXCEEDED');
 const rows=Array.from({length:31},()=>({date:'2026-11-20',text:'x',at:1}));
 assert.equal(io.parseLegacyJSON(JSON.stringify(rows),{now:NOW}).code,'INVALID_LEGACY_COLLECTION');
});
test('explicit now and conflict policy required; report XSS stays literal and inert',()=>{
 assert.equal(io.exportJSON([]).code,'EXPLICIT_NOW_REQUIRED');
 assert.equal(io.parseJSON('{}').code,'EXPLICIT_NOW_REQUIRED');
 assert.equal(io.mergeJSON('[]',[],{now:NOW,onConflict:'silent-overwrite'}).code,'INVALID_CONFLICT_POLICY');
 const text='<img src=x onerror=alert(1)>';
 const exported=exportOne([normal(draft({rawText:text,sections:[]}))]);
 assert.equal(io.parseJSON(exported.json,{now:NOW}).records[0].rawText,text);
 assert.equal(typeof io.render,'undefined');
});
test('roundtrip and merge are deterministic and immutable',()=>{
 const old=[normal()],data=exportOne(),before=JSON.stringify(old);
 const a=io.mergeJSON(data.json,old,{now:NOW}),b=io.mergeJSON(data.json,old,{now:NOW});
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(old),before);
 const p=io.parseJSON(data.json,{now:NOW});
 assert.deepEqual(p,io.parseJSON(data.json,{now:NOW}));
 assert.equal(io.format,'myinvest-public-briefing-backup-v1');
});
