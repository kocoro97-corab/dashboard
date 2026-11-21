'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const archive=require('../js/news-briefing-archive-v1.js');
const transfer=require('../js/news-briefing-transfer-v1.js');
const panel=require('../js/news-briefing-panel-v1.js');
const NOW=Date.parse('2026-11-21T15:00:00+09:00');
const GEN=Date.parse('2026-11-21T07:02:00+09:00');
const OBS=Date.parse('2026-11-21T06:00:00+09:00');
const FETCH=Date.parse('2026-11-21T06:55:00+09:00');
function row(patch={}){
 const result=archive.normalize({
  schemaVersion:1,date:'2026-11-21',origin:'chatgpt-task',
  visibility:'public-market-only',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
  title:'07시 시장전략',generatedAt:GEN,observedAt:OBS,retrievedAt:FETCH,
  rawText:'가상의 테스트 시장 요약. 실제 수치가 아님.',sections:[],sources:[],...patch
 },{now:NOW});
 assert.equal(result.ok,true,result.code);
 return result.record;
}
function backup(rows){
 const result=transfer.exportJSON(rows,{now:NOW});
 assert.equal(result.ok,true,result.code);
 return result.json;
}
class Storage{
 constructor(){this.map=new Map();this.writes=0;this.failWrite=false}
 getItem(k){return this.map.has(k)?this.map.get(k):null}
 setItem(k,v){if(this.failWrite)throw new Error('quota');this.writes++;this.map.set(k,v)}
}
test('empty store is read-only and exports a valid empty public-only backup',()=>{
 const storage=new Storage(),read=panel.read(storage,{now:NOW});
 assert.deepEqual(read.records,[]);
 assert.equal(storage.writes,0);
 const result=panel.exportBackup(storage,{now:NOW});
 assert.equal(result.ok,true);
 assert.equal(JSON.parse(result.json).records.length,0);
 assert.equal(storage.writes,0);
});
test('file import explicitly saves validated public market record',()=>{
 const storage=new Storage();
 const result=panel.importBackup(backup([row()]),storage,{now:NOW});
 assert.equal(result.ok,true,result.code);
 assert.equal(result.stats.added,1);
 assert.equal(result.storageModified,true);
 assert.equal(storage.writes,1);
 const loaded=panel.read(storage,{now:NOW});
 assert.equal(loaded.records.length,1);
 assert.equal(loaded.records[0].origin,'chatgpt-task');
 assert.equal(loaded.records[0].generatedAt,GEN);
 assert.equal(loaded.records[0].observedAt,OBS);
});
test('identical reimport is idempotent and does not mutate browser storage',()=>{
 const storage=new Storage(),file=backup([row()]);
 panel.importBackup(file,storage,{now:NOW});
 const result=panel.importBackup(file,storage,{now:NOW});
 assert.equal(result.ok,true);
 assert.equal(result.stats.unchanged,1);
 assert.equal(result.storageModified,false);
 assert.equal(storage.writes,1);
});
test('same generation timestamp conflicting import is kept as existing',()=>{
 const storage=new Storage();
 panel.importBackup(backup([row()]),storage,{now:NOW});
 const changed=row({rawText:'서로 다른 브리핑'});
 const result=panel.importBackup(backup([changed]),storage,{now:NOW});
 assert.equal(result.ok,true);
 assert.equal(result.stats.equalTimeConflicts,1);
 assert.equal(result.storageModified,false);
 assert.equal(panel.read(storage,{now:NOW}).records[0].rawText,row().rawText);
});
test('invalid or private fields in a JSON file never overwrite existing archive',()=>{
 const storage=new Storage(),valid=backup([row()]);
 panel.importBackup(valid,storage,{now:NOW});
 const snapshot=storage.getItem(panel.storageKey),writes=storage.writes;
 for(const badFile of [
  '{', JSON.stringify({type:'myinvest-public-briefing-backup-v1',schemaVersion:1,
   exportedAt:NOW,records:[{...row(),accountNumber:'123456'}]}),
 ]){
  const result=panel.importBackup(badFile,storage,{now:NOW});
  assert.equal(result.ok,false);
 }
 const sensitive={...row(),rawText:'계좌번호: 1234567'};
 const json={type:'myinvest-public-briefing-backup-v1',schemaVersion:1,
  exportedAt:NOW,records:[sensitive]};
 assert.equal(panel.importBackup(JSON.stringify(json),storage,{now:NOW}).ok,false);
 assert.equal(storage.getItem(panel.storageKey),snapshot);
 assert.equal(storage.writes,writes);
});
test('invalid stored JSON blocks replacement instead of silently erasing it',()=>{
 const storage=new Storage(),file=backup([row()]);
 storage.setItem(panel.storageKey,'{BROKEN');
 const before=storage.getItem(panel.storageKey),writes=storage.writes;
 const result=panel.importBackup(file,storage,{now:NOW});
 assert.equal(result.code,'STORED_ARCHIVE_JSON_INVALID');
 assert.equal(storage.getItem(panel.storageKey),before);
 assert.equal(storage.writes,writes);
});
test('read refuses stored extra private properties and preserves original text',()=>{
 const storage=new Storage(),value=JSON.stringify([{...row(),holdings:['account']}]);
 storage.setItem(panel.storageKey,value);
 const result=panel.read(storage,{now:NOW});
 assert.equal(result.ok,false);
 assert.equal(storage.getItem(panel.storageKey),value);
});
test('storage quota errors block write with no success report',()=>{
 const storage=new Storage();storage.failWrite=true;
 const result=panel.importBackup(backup([row()]),storage,{now:NOW});
 assert.equal(result.code,'STORAGE_WRITE_FAILED');
 assert.equal(storage.writes,0);
});
test('explicit migration copies legacy manual reports without editing legacy source',()=>{
 const storage=new Storage(),text=JSON.stringify([{
  date:'2026-11-20',text:'수동 작성한 시장 동향',source:'user',at:NOW-3600000
 }]);
 storage.setItem(panel.legacyKey,text);
 const result=panel.migrateLegacy(storage,{now:NOW});
 assert.equal(result.ok,true,result.code);
 assert.equal(result.legacyCount,1);
 assert.equal(result.legacyPreserved,true);
 assert.equal(storage.getItem(panel.legacyKey),text);
 assert.equal(panel.read(storage,{now:NOW}).records[0].origin,'manual');
 assert.equal(panel.read(storage,{now:NOW}).records[0].generatedAt,null);
});
test('manual legacy and same-day task report remain separate by origin',()=>{
 const storage=new Storage();
 storage.setItem(panel.legacyKey,JSON.stringify([{
  date:'2026-11-21',text:'기존 수동 시장 보고서',at:NOW-3600000
 }]));
 panel.importBackup(backup([row()]),storage,{now:NOW});
 const result=panel.migrateLegacy(storage,{now:NOW});
 assert.equal(result.ok,true);
 const records=panel.read(storage,{now:NOW}).records;
 assert.equal(records.length,2);
 assert.deepEqual(records.map(r=>r.origin).sort(),['chatgpt-task','manual']);
});
test('corrupt legacy backup fails closed and leaves destination unchanged',()=>{
 const storage=new Storage(),value=JSON.stringify([{
  date:'2026-11-20',text:'private',at:NOW-3600000,token:'SECRET'
 }]);
 storage.setItem(panel.legacyKey,value);
 const writes=storage.writes;
 const result=panel.migrateLegacy(storage,{now:NOW});
 assert.equal(result.ok,false);
 assert.equal(storage.getItem(panel.storageKey),null);
 assert.equal(storage.getItem(panel.legacyKey),value);
 assert.equal(storage.writes,writes);
});
test('no legacy records gives no writes and an explicit no-legacy reason',()=>{
 const storage=new Storage(),result=panel.migrateLegacy(storage,{now:NOW});
 assert.equal(result.ok,true);
 assert.equal(result.reason,'NO_LEGACY');
 assert.equal(storage.writes,0);
});
test('DOM panel mount is exposed, but import does not initiate network/AI/orders',()=>{
 assert.equal(typeof panel.mount,'function');
 assert.equal(panel.importBackup(backup([row()]),new Storage(),{now:NOW}).verification.externalOriginAuthenticated,false);
 assert.equal(panel.mount(null).code,'INVALID_TARGET');
});
