/* MY INVEST V2 — read-only public morning briefing archive format.
 * Pure normalization / selection, no transport, storage, timers, AI calls or orders.
 * Integrators must render text with textContent, never innerHTML.
 */
(function(root){
'use strict';
const VERSION=1,MAX_RECORDS=90,MAX_SECTIONS=12,MAX_SOURCES=30;
const ORIGINS=new Set(['manual','chatgpt-task','dashboard-pipeline','openai-api']);
const KINDS=new Set(['overview','us-market','kr-market','futures','rates-fx','news',
 'sectors','daytrade','swing','risk','events','other']);
const clockValid=t=>Number.isSafeInteger(t)&&t>0&&t<8640000000000000;
const str=(s,max=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)?s.trim():null;
const hasPossibleSecret=s=>/\bBearer\s+[A-Za-z0-9_.-]{8,}|\bsk-[A-Za-z0-9_-]{16,}|\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S{6,}/i.test(s);
const blocked=(code)=>({ok:false,code});
const isoDay=(date)=>{if(typeof date!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(date))return false;
 const t=Date.parse(date+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===date;};
function kstDate(now){
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',
  month:'2-digit',day:'2-digit'}).format(new Date(now));
}
function safeUrl(s){
 if(typeof s!=='string'||s.length>2000||/[\s\\]/.test(s))return null;
 try{
  const u=new URL(s);
  if(u.protocol!=='https:'||u.username||u.password||!u.hostname||
    u.hostname==='localhost'||u.hostname.startsWith('[')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(u.hostname))return null;
  for(const key of u.searchParams.keys())if(/^(?:key|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|secret|password|authorization|auth|account(?:[_-]?(?:number|balance|id))?)$/i.test(key))return null;
  u.hash='';return u.href;
 }catch{return null}
}
function stamp(value,now){
 if(value===null||value===undefined)return null;
 return clockValid(value)&&value<=now+300000?value:false;
}
function normalize(input,{now}={}){
 if(!clockValid(now))return blocked('EXPLICIT_NOW_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input)||
    input.schemaVersion!==VERSION)return blocked('SCHEMA_VERSION_REQUIRED');
 if(input.visibility!=='public-market-only')return blocked('PUBLIC_MARKET_VISIBILITY_REQUIRED');
 const date=input.date,origin=input.origin;
 if(!isoDay(date)||date>kstDate(now))return blocked('INVALID_OR_FUTURE_REPORT_DATE');
 if(!ORIGINS.has(origin))return blocked('INVALID_ORIGIN');
 if(input.timeZone!=='Asia/Seoul'||input.scheduleLocal!=='07:00')
  return blocked('KST_SCHEDULE_REQUIRED');
 const title=str(input.title,120);
 if(!title)return blocked('INVALID_TITLE');
 const generatedAt=stamp(input.generatedAt,now),
  observedAt=stamp(input.observedAt,now),retrievedAt=stamp(input.retrievedAt,now);
 if(generatedAt===false||observedAt===false||retrievedAt===false)
  return blocked('INVALID_TIMESTAMP');
 if(origin!=='manual'&&generatedAt===null)return blocked('AUTOMATIC_GENERATED_TIME_REQUIRED');
 if(generatedAt!==null&&kstDate(generatedAt)<date)return blocked('GENERATED_BEFORE_REPORT_DATE');
 if(observedAt!==null&&retrievedAt!==null&&observedAt>retrievedAt)
  return blocked('OBSERVED_AFTER_RETRIEVED');
 if(generatedAt!==null&&retrievedAt!==null&&retrievedAt>generatedAt+300000)
  return blocked('RETRIEVED_AFTER_GENERATED');
 if(!Array.isArray(input.sources)||input.sources.length>MAX_SOURCES)
  return blocked('INVALID_SOURCES');
 const sources=[],ids=new Set();
 for(const x of input.sources){
  if(!x||typeof x!=='object'||Array.isArray(x))return blocked('INVALID_SOURCE');
  const id=str(x.id,40),name=str(x.title,180),url=safeUrl(x.url),publishedAt=stamp(x.publishedAt,now);
  if(!id||!/^[A-Za-z0-9_-]{1,40}$/.test(id)||ids.has(id)||!name||!url||publishedAt===false)
   return blocked('INVALID_SOURCE');
  sources.push({id,title:name,url,publishedAt});ids.add(id);
 }
 const rawText=input.rawText===null||input.rawText===undefined?null:str(input.rawText,20000);
 if(input.rawText!=null&&!rawText)return blocked('INVALID_RAW_TEXT');
 if(!Array.isArray(input.sections)||input.sections.length>MAX_SECTIONS)
  return blocked('INVALID_SECTIONS');
 const sections=[];
 for(const section of input.sections){
  if(!section||!KINDS.has(section.kind))return blocked('INVALID_SECTION');
  const heading=str(section.heading,120),body=str(section.body,4000);
  if(!heading||!body||!Array.isArray(section.sourceIds)||
      section.sourceIds.length>10||section.sourceIds.some(id=>!ids.has(id)))
   return blocked('INVALID_SECTION');
  sections.push({kind:section.kind,heading,body,sourceIds:[...new Set(section.sourceIds)]});
 }
 if(!rawText&&!sections.length)return blocked('EMPTY_BRIEFING');
 const flat=[title,rawText||'',...sections.flatMap(x=>[x.heading,x.body])].join('\n');
 if(hasPossibleSecret(flat))return blocked('POSSIBLE_SECRET_IN_PUBLIC_REPORT');
 if(flat.length>25000)return blocked('REPORT_TOO_LARGE');
 const review=[];
 // Declaration of an origin never proves authenticity of an external source.
 review.push('SOURCE_ORIGIN_UNVERIFIED');
 if(!generatedAt)review.push('GENERATED_TIME_UNKNOWN');
 if(!observedAt)review.push('MARKET_OBSERVATION_UNKNOWN');
 if(!retrievedAt)review.push('RETRIEVAL_TIME_UNKNOWN');
 if(!sources.length)review.push('NO_CITABLE_SOURCES');
 if(sections.some(s=>s.sourceIds.length===0))review.push('SECTION_WITHOUT_CITATION');
 const record={schemaVersion:VERSION,date,origin,title,timeZone:'Asia/Seoul',
  scheduleLocal:'07:00',visibility:'public-market-only',generatedAt,observedAt,
  retrievedAt,rawText,sections,sources};
 return {ok:true,record,review,verification:{originAuthenticated:false,
  marketDataVerified:false,sourceUrlsCheckedLive:false,scheduledDeliveryConfirmed:false}};
}
function legacy(row,{now}={}){
 if(!row||typeof row!=='object'||Array.isArray(row))return blocked('INVALID_LEGACY_ROW');
 if(!clockValid(row.at)||row.at>now+300000)return blocked('INVALID_LEGACY_RECEIPT');
 // A manually saved timestamp is NOT the true generation/market observation time.
 return normalize({schemaVersion:VERSION,date:row.date,origin:'manual',timeZone:'Asia/Seoul',
  scheduleLocal:'07:00',visibility:'public-market-only',title:'사용자 등록 투자 브리핑',
  generatedAt:row.generatedAt??null,observedAt:row.observedAt??null,
  retrievedAt:row.retrievedAt??null,rawText:row.text,sections:[],sources:[]},{now});
}
function archive(existing,incoming,{now}={}){
 if(!clockValid(now))return blocked('EXPLICIT_NOW_REQUIRED');
 if(!Array.isArray(existing)||existing.length>MAX_RECORDS*2)return blocked('INVALID_EXISTING_ARCHIVE');
 const report=normalize(incoming,{now});if(!report.ok)return report;
 const map=new Map();
 for(const x of existing){
  const validated=normalize(x,{now});if(!validated.ok)continue;
  const r=validated.record,key=r.date+'|'+r.origin;
  if(!map.has(key)||(r.generatedAt??0)>(map.get(key).generatedAt??0))map.set(key,r);
 }
 const r=report.record,key=r.date+'|'+r.origin,prior=map.get(key);
 if(!prior||(r.generatedAt??0)>=(prior.generatedAt??0))map.set(key,r);
 const records=[...map.values()].sort((a,b)=>
  b.date.localeCompare(a.date)||(b.generatedAt??0)-(a.generatedAt??0)||
  a.origin.localeCompare(b.origin)).slice(0,MAX_RECORDS);
 return {ok:true,records,review:report.review,
  storage:'CALLER_OWNED_NO_PERSISTENCE',verification:report.verification};
}
function selection(records,{now,date}={}){
 if(!clockValid(now)||!Array.isArray(records)||records.length>MAX_RECORDS*2)
  return blocked('INVALID_ARCHIVE_VIEW');
 const today=kstDate(now),valid=[];
 for(const row of records){const r=normalize(row,{now});if(r.ok)valid.push(r);}
 const distinct=valid.filter(x=>x.record.date<=today)
  .sort((a,b)=>b.record.date.localeCompare(a.record.date)||
   (b.record.generatedAt??0)-(a.record.generatedAt??0)||
   (a.record.origin==='manual'?1:0)-(b.record.origin==='manual'?1:0));
 if(date!==undefined&&(!isoDay(date)||date>today))return blocked('INVALID_SELECTED_DATE');
 const chosen=distinct.find(x=>date===undefined||x.record.date===date)||null;
 if(!chosen)return {ok:true,empty:true,today,selected:null,dates:[...new Set(distinct.map(x=>x.record.date))],
  label:'등록된 브리핑 없음',freshness:'NO_REPORT'};
 const r=chosen.record,observationHours=r.observedAt==null?null:
  Math.round(Math.max(0,(now-r.observedAt)/3600000)*10)/10;
 return {ok:true,empty:false,today,isToday:r.date===today,
  marketObservationAgeHours:observationHours,
  marketObservationStatus:observationHours===null?'UNKNOWN':
   observationHours>36?'DECLARED_OLDER_THAN_36H':'DECLARED_UNVERIFIED',
  dates:[...new Set(distinct.map(x=>x.record.date))],
  selected:r,review:chosen.review,
  label:r.origin==='manual'?'사용자 수동 등록':r.origin==='chatgpt-task'?
   'ChatGPT 작업 결과로 선언됨 · 자동 수신 검증 전':'대시보드 생성으로 선언됨 · 원천 검증 전',
  freshness:r.date===today?'TODAY_UNVERIFIED':'ARCHIVED_NOT_TODAY',
  warning:'출처·시세·생성 경로가 독립 검증되지 않았습니다. 화면에서 실제 최신 자료로 단정하지 마세요.'};
}
function parseFeed(payload,{now}={}){
 if(!clockValid(now))return blocked('EXPLICIT_NOW_REQUIRED');
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||
  payload.type!=='public-briefing-feed-v1'||payload.schemaVersion!==VERSION||
  !Array.isArray(payload.records)||payload.records.length>MAX_RECORDS||
  payload.records.length===0)return blocked('INVALID_PUBLIC_FEED');
 let result={ok:true,records:[]};
 for(const r of payload.records){
  result=archive(result.records,r,{now});
  if(!result.ok)return blocked('PUBLIC_FEED_RECORD_INVALID_'+result.code);
 }
 return {ok:true,records:result.records,
  provenance:'TRANSPORT_UNAUTHENTICATED_NOT_VERIFIED',
  accountDataIncluded:false,liveMarketDataVerified:false};
}
const api=Object.freeze({normalize,legacy,archive,selection,parseFeed,kstDate,safeUrl,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestBriefingArchiveV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
