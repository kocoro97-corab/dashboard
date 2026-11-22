/* MY INVEST — unified, read-only market event evidence. Reuses the EXISTING
 * U.S. official snapshot + sparse verified KRX documents; no fetch.
 * Neither Google subscription nor this registry certifies market opening.
 */
(function(root){
'use strict';
function dependencies(){
 const us=root.MYInvestOfficialMarketEventsV1;
 const kr=root.MYInvestKrxOfficialCalendarV1;
 if(!us||typeof us.list!=='function'||!kr||typeof kr.list!=='function')
  return null;
 return {us,kr};
}
function list(year,month){
 const src=dependencies();
 if(!src)return Object.freeze([]);
 const seen=new Set(),result=[];
 for(const x of src.us.list(year,month).concat(src.kr.list(year,month))){
  if(!x||typeof x.id!=='string'||seen.has(x.id))continue;
  seen.add(x.id);result.push(x);
 }
 return Object.freeze(result.sort((a,b)=>a.date.localeCompare(b.date)||
  (a.market==='KR'?-1:1)-(b.market==='KR'?-1:1)||
  a.title.localeCompare(b.title)));
}
function sourceStatus(year,month,{now}={}){
 const src=dependencies();
 if(!src)return Object.freeze({status:'MISSING_SOURCES',lastCheckedAt:null,
  ageDays:null,reviewDue:true,liveVerified:false,krxCoverage:'UNAVAILABLE'});
 const checkedAt='2026-11-22';
 const today=typeof now==='string'?now:
  new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',
   month:'2-digit',day:'2-digit'}).format(new Date());
 const date=/^20\d{2}-\d{2}-\d{2}$/.test(today)&&
  Number.isFinite(Date.parse(today))?Date.parse(today+'T00:00:00Z'):NaN;
 const ageDays=Number.isFinite(date)?
  Math.max(0,Math.floor((date-Date.parse(checkedAt+'T00:00:00Z'))/86400000)):null;
 const krxCoverage=src.kr.coverage(year,month);
 const reviewDue=ageDays===null||ageDays>21||krxCoverage.status==='UNVERIFIED_YEAR';
 return Object.freeze({
  status:reviewDue?'SOURCE_RECHECK_REQUIRED':'SOURCE_SNAPSHOT_ONLY',
  lastCheckedAt:checkedAt,ageDays,reviewDue,
  krxCoverage:krxCoverage.status,
  krxMessage:krxCoverage.message||'',
  liveVerified:false,tradeSessionCertified:false,
  autoRefreshAvailable:false,
  note:'공식 원문 스냅샷이며 온라인 자동 재확인 기능은 아직 연결되지 않음',
  sources:Object.freeze([
   src.kr.primarySource,src.us.sourceUrls.nyse,
   src.us.sourceUrls.fed26,src.us.sourceUrls.fed27,
   src.us.sourceUrls.bls,src.us.sourceUrls.bea
  ])
 });
}
const enc=new TextEncoder();
function fold(line){
 let bytes=0,out='';
 for(const c of Array.from(line)){
  const needed=enc.encode(c).length;
  if(bytes+needed>73){
   out+='\r\n ';
   bytes=1;
  }
  out+=c;bytes+=needed;
 }
 return out;
}
function escapeIcs(s){
 return String(s).replace(/\\/g,'\\\\').replace(/\r\n?|\n/g,'\\n')
  .replace(/,/g,'\\,').replace(/;/g,'\\;');
}
function compact(ms){
 return new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g,'');
}
function oneDay(date){
 const [y,m,d]=date.split('-').map(Number);
 return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10).replace(/-/g,'');
}
function exportMonthICS(year,month){
 const items=list(year,month);
 const lines=[
  'BEGIN:VCALENDAR','VERSION:2.0',
  'PRODID:-//MY INVEST//Official KR and US Market Snapshots//KO',
  'CALSCALE:GREGORIAN','METHOD:PUBLISH',
  'X-WR-CALNAME:MY INVEST KR-US market calendar snapshot'
 ];
 for(const item of items){
  lines.push('BEGIN:VEVENT',
   fold('UID:'+item.id.replace(/[^A-Za-z0-9._:-]/g,'-')+'@myinvest-evidence'),
   'DTSTAMP:20261122T000000Z');
  if(item.sourceTime&&item.kstDate&&item.kstTime){
   const [y,m,d]=item.kstDate.split('-').map(Number);
   const [h,min]=item.kstTime.split(':').map(Number);
   const utc=Date.UTC(y,m-1,d,h-9,min);
   lines.push('DTSTART:'+compact(utc),
    'DTEND:'+compact(utc+60*60000));
  }else{
   lines.push('DTSTART;VALUE=DATE:'+item.date.replace(/-/g,''),
    'DTEND;VALUE=DATE:'+oneDay(item.date));
  }
  const detail=item.sourceLabel+' | 기준일: '+item.checkedAt+
   ' | '+(item.market==='US'?'미국 현지 날짜 기준':'한국 날짜 기준')+
   ' | 실시간 휴장/시장 개장 검증 아님 | '+(item.note||'')+
   ' | 공식 출처: '+item.sourceUrl;
  lines.push(fold('SUMMARY:'+escapeIcs(item.title)),
   fold('DESCRIPTION:'+escapeIcs(detail)),
   fold('URL:'+item.sourceUrl),
   'END:VEVENT');
 }
 lines.push('END:VCALENDAR');
 return lines.join('\r\n')+'\r\n';
}
/* Optional evidence interface for global-market and strategy screens.
 * The caller decides whether to show it. This NEVER makes a fresh request.
 * One query spans at most 62 calendar days, preventing unbounded processing.
 */
function evidenceForRange({market,startDate,endDate,types=null,now}={}){
 const invalid=Object.freeze({status:'INVALID_QUERY',
  records:Object.freeze([]),sourceSnapshot:true,
  tradingSessionCertified:false,liveVerified:false,providerCalls:0});
 if(!['KR','US','ALL'].includes(market)||
  typeof startDate!=='string'||typeof endDate!=='string'||
  !/^20\d{2}-\d{2}-\d{2}$/.test(startDate)||
  !/^20\d{2}-\d{2}-\d{2}$/.test(endDate)||
  (types!==null&&!Array.isArray(types)))return invalid;
 const from=Date.parse(startDate+'T00:00:00Z');
 const to=Date.parse(endDate+'T00:00:00Z');
 if(!Number.isFinite(from)||!Number.isFinite(to)||to<from||
  to-from>62*86400000||
  new Date(from).toISOString().slice(0,10)!==startDate||
  new Date(to).toISOString().slice(0,10)!==endDate)return invalid;
 const permitted=types===null?null:
  new Set(types.filter(x=>['holiday','early-close','fomc','macro','market'].includes(x)));
 const rows=[],states=[];
 const first=new Date(Date.UTC(Number(startDate.slice(0,4)),
  Number(startDate.slice(5,7))-1,1));
 for(let monthDate=first;monthDate.getTime()<=to;){
  const year=monthDate.getUTCFullYear(),month=monthDate.getUTCMonth()+1;
  const monthEvents=list(year,month);
  for(const item of monthEvents){
   if(item.date>=startDate&&item.date<=endDate&&
    (market==='ALL'||item.market===market)&&
    (permitted===null||permitted.has(item.type)))
    rows.push(item);
  }
  states.push(sourceStatus(year,month,{now}));
  monthDate=new Date(Date.UTC(year,month,1));
 }
 const reviewDue=states.some(x=>x.ageDays===null||x.ageDays>21||
  (market!=='US'&&x.krxCoverage==='UNVERIFIED_YEAR'));
 return Object.freeze({
  status:reviewDue?'SOURCE_RECHECK_REQUIRED':'EVIDENCE_SNAPSHOT_ONLY',
  market,startDate,endDate,records:Object.freeze(rows),
  sourceSnapshot:true,reviewDue,liveVerified:false,
  tradingSessionCertified:false,providerCalls:0,
  calendarFetches:0,accountAccessed:false,ordersPlaced:0,
  shownByDefault:false,canBeShownAsEvidence:true,
  checkedAt:'2026-11-22'
 });
}
const api=Object.freeze({
 list,sourceStatus,exportMonthICS,evidenceForRange,
 checkedAt:'2026-11-22',isLive:false
});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestUnifiedMarketCalendarV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
