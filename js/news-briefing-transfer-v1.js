/* MY INVEST V2 — portable, public-only briefing JSON transfer.
 * A PURE data adapter. Does not read files, save browser data, fetch URLs,
 * authenticate ChatGPT tasks, or make NH/GAS/market API calls.
 */
(function(root){
'use strict';
const VERSION=1, FORMAT='myinvest-public-briefing-backup-v1',MAX_RECORDS=90;
const MAX_JSON_CHARS=3000000;
const KEYS={
 envelope:['type','schemaVersion','exportedAt','records'],
 record:['schemaVersion','date','origin','title','visibility','timeZone','scheduleLocal',
  'generatedAt','observedAt','retrievedAt','rawText','sections','sources'],
 source:['id','title','url','publishedAt'],
 section:['kind','heading','body','sourceIds'],
 legacy:['date','text','at','generatedAt','observedAt','retrievedAt']
};
const bad=(code)=>({ok:false,code,records:null,storageModified:false});
const isObj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const keysAllowed=(obj,kind)=>isObj(obj)&&
 Object.keys(obj).every(k=>KEYS[kind].includes(k));
const validClock=t=>Number.isSafeInteger(t)&&t>0&&t<8640000000000000;
function dependency(){
 if(typeof module==='object'&&module.exports)return require('./news-briefing-archive-v1.js');
 return root.MYInvestBriefingArchiveV1;
}
function hasPrivateText(s){
 if(typeof s!=='string')return false;
 return /(?:계좌번호|주민등록번호|비밀번호|인증번호|계좌잔고)\s*[:=]\s*\S{2,}|\b(?:account[_-]?number|account[_-]?balance|password|passcode|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key)\s*[:=]\s*\S{3,}|\b\d{6}-[1-4]\d{6}\b/i.test(s);
}
function inspectRecord(row,{now}={}){
 if(!keysAllowed(row,'record'))return bad('UNEXPECTED_OR_PRIVATE_RECORD_FIELD');
 if(!Array.isArray(row.sections)||!Array.isArray(row.sources)||
  !row.sections.every(s=>keysAllowed(s,'section'))||
  !row.sources.every(s=>keysAllowed(s,'source')))
  return bad('UNEXPECTED_NESTED_FIELD');
 const norm=dependency().normalize(row,{now});
 if(!norm.ok)return bad('INVALID_RECORD_'+norm.code);
 const r=norm.record;
 const text=[r.title,r.rawText||'',
  ...r.sections.flatMap(x=>[x.heading,x.body]),
  ...r.sources.flatMap(x=>[x.id,x.title,x.url])].join('\n');
 if(hasPrivateText(text))return bad('POSSIBLE_PRIVATE_INFORMATION');
 return {ok:true,record:r};
}
function validateList(records,{now}={}){
 if(!validClock(now))return bad('EXPLICIT_NOW_REQUIRED');
 if(!Array.isArray(records)||records.length>MAX_RECORDS)return bad('RECORD_LIMIT_EXCEEDED');
 const map=new Map();
 for(const row of records){
  const check=inspectRecord(row,{now});
  if(!check.ok)return check;
  const r=check.record,key=r.date+'|'+r.origin;
  if(map.has(key)){
   if(JSON.stringify(map.get(key))!==JSON.stringify(r))return bad('CONFLICTING_DUPLICATE_IN_FILE');
   continue;
  }
  map.set(key,r);
 }
 return {ok:true,records:[...map.values()].sort((a,b)=>
  b.date.localeCompare(a.date)||(b.generatedAt??0)-(a.generatedAt??0)||
  a.origin.localeCompare(b.origin))};
}
function exportJSON(records,{now}={}){
 const result=validateList(records,{now});
 if(!result.ok)return result;
 const payload={type:FORMAT,schemaVersion:VERSION,exportedAt:now,records:result.records};
 const json=JSON.stringify(payload,null,2);
 if(json.length>MAX_JSON_CHARS)return bad('JSON_SIZE_LIMIT_EXCEEDED');
 return {ok:true,filename:'myinvest-public-briefings-'+dependency().kstDate(now)+'.json',
  mimeType:'application/json;charset=utf-8',json,recordCount:result.records.length,
  storageModified:false,
  verification:{externalOriginAuthenticated:false,marketDataVerified:false,
   contentSignatureVerified:false,sourceUrlsCheckedLive:false}};
}
function parseJSON(text,{now}={}){
 if(!validClock(now))return bad('EXPLICIT_NOW_REQUIRED');
 if(typeof text!=='string'||!text.trim()||text.length>MAX_JSON_CHARS)return bad('INVALID_JSON_SIZE');
 let x;
 try{x=JSON.parse(text.replace(/^\uFEFF/,''))}catch{return bad('INVALID_JSON_SYNTAX')}
 if(!keysAllowed(x,'envelope')||x.type!==FORMAT||x.schemaVersion!==VERSION||
  !validClock(x.exportedAt)||x.exportedAt>now+300000)
  return bad('INVALID_BACKUP_ENVELOPE');
 const rows=validateList(x.records,{now});
 if(!rows.ok)return rows;
 return {ok:true,records:rows.records,exportedAt:x.exportedAt,storageModified:false,
  verification:{externalOriginAuthenticated:false,marketDataVerified:false,
   contentSignatureVerified:false,sourceUrlsCheckedLive:false}};
}
function mergeJSON(text,existing,{now,onConflict='keep-existing'}={}){
 if(!['keep-existing','replace-on-equal'].includes(onConflict))return bad('INVALID_CONFLICT_POLICY');
 const incoming=parseJSON(text,{now});if(!incoming.ok)return incoming;
 const old=validateList(existing,{now});if(!old.ok)return bad('INVALID_EXISTING_'+old.code);
 const map=new Map(old.records.map(r=>[r.date+'|'+r.origin,r]));
 const stats={added:0,updated:0,unchanged:0,olderIgnored:0,equalTimeConflicts:0};
 const conflicts=[];
 for(const next of incoming.records){
  const key=next.date+'|'+next.origin,prev=map.get(key);
  if(!prev){map.set(key,next);stats.added++;continue}
  if(JSON.stringify(prev)===JSON.stringify(next)){stats.unchanged++;continue}
  const a=prev.generatedAt??0,b=next.generatedAt??0;
  if(b>a){map.set(key,next);stats.updated++;continue}
  if(b<a){stats.olderIgnored++;continue}
  stats.equalTimeConflicts++;conflicts.push({date:next.date,origin:next.origin});
  if(onConflict==='replace-on-equal'){map.set(key,next);stats.updated++}
 }
 if(map.size>MAX_RECORDS)return bad('MERGED_ARCHIVE_LIMIT_EXCEEDED');
 const records=[...map.values()].sort((a,b)=>
  b.date.localeCompare(a.date)||(b.generatedAt??0)-(a.generatedAt??0)||
  a.origin.localeCompare(b.origin));
 return {ok:true,records,stats,conflicts,
  resolution:onConflict,storageModified:false,
  note:'Caller decides whether and where to persist; no network or localStorage used.',
  verification:incoming.verification};
}
function parseLegacyJSON(text,{now}={}){
 if(!validClock(now))return bad('EXPLICIT_NOW_REQUIRED');
 if(typeof text!=='string'||!text.trim()||text.length>MAX_JSON_CHARS)return bad('INVALID_JSON_SIZE');
 let rows;try{rows=JSON.parse(text.replace(/^\uFEFF/,''))}catch{return bad('INVALID_JSON_SYNTAX')}
 if(!Array.isArray(rows)||rows.length>30)return bad('INVALID_LEGACY_COLLECTION');
 const out=[];
 for(const row of rows){
  if(!keysAllowed(row,'legacy'))return bad('INVALID_LEGACY_ROW');
  const n=dependency().legacy(row,{now});
  if(!n.ok)return bad('INVALID_LEGACY_'+n.code);
  const inspected=inspectRecord(n.record,{now});
  if(!inspected.ok)return inspected;
  out.push(inspected.record);
 }
 return validateList(out,{now});
}
const api=Object.freeze({exportJSON,parseJSON,mergeJSON,parseLegacyJSON,
 format:FORMAT,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestBriefingTransferV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
