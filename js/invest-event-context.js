(function(root){'use strict';
/*
 * MY INVEST public event context v1.
 * Shared IN-MEMORY schedules only: BLS, BEA, BOK, Fed, reviewed
 * public earnings. No personal Google Calendar, sessions, holdings,
 * price/NH reads, investment orders or source URL fetches here.
 */
const SOURCES=Object.freeze([
 ['BLS','MYInvestEconomicCalendar'],
 ['BEA','MYInvestBeaCalendar'],
 ['BOK_STAT','MYInvestBokStatsCalendar'],
 ['EARNINGS','MYInvestEarningsCalendar'],
 ['POLICY','MYInvestOfficialPolicyCalendar']
]);
const toParts=(date,zone)=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{
 timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const day=(date,zone)=>{const p=toParts(date,zone);return p.year+'-'+p.month+'-'+p.day};
const offsetDay=(date,count)=>new Date(Date.parse(date+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);
const validateDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
let refreshJob=null;
let collectionRows=[],collectionAt=0;
async function refreshCollection(force=false){
 if(root.MYINVEST_TRANSPORT_CONFIG?.devSession!==true)return;
 if(!force&&collectionAt&&Date.now()-collectionAt<900000)return;
 try{const r=await root.fetch('calendar-data-status.json',{credentials:'omit',cache:'no-store',redirect:'error'});if(!r.ok)throw Error('STATUS_UNAVAILABLE');const text=await r.text();if(text.length>16384)throw Error('STATUS_OVERSIZED');const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.length>5)throw Error('STATUS_INVALID');collectionRows=rows.filter(x=>['economic-events.json','bea-events.json','bok-stats-events.json','earnings-events.json','policy-events.json'].includes(x?.file)&&['VERIFIED','FAILED','MISSING','UNAVAILABLE'].includes(x.status)).map(x=>Object.freeze({file:x.file,status:x.status,source:['BLS','BEA','BOK','VERIFIED_EARNINGS','OFFICIAL_POLICY'].includes(x.source)?x.source:null,retrievedAt:Number.isFinite(Date.parse(x.retrievedAt))?x.retrievedAt:null}));}catch{collectionRows=[]}collectionAt=Date.now();
}
function coverage(){
 return Object.freeze({
  BLS:root.MYInvestEconomicCalendar?.current()?.status==='ready',
  BEA:root.MYInvestBeaCalendar?.current()?.status==='ready',
  BOK_STAT:root.MYInvestBokStatsCalendar?.current()?.status==='ready',
  EARNINGS:root.MYInvestEarningsCalendar?.current()?.status==='ready',
  POLICY:root.MYInvestOfficialPolicyCalendar?.current()?.status==='ready',
  FED:root.MYInvestFomcSchedule?.current?root.MYInvestFomcSchedule.current().status==='ready':!!root.MYInvestFomcSchedule?.list,
  BOK_MPC:root.MYInvestBokPolicySchedule?.current?root.MYInvestBokPolicySchedule.current().status==='ready':!!root.MYInvestBokPolicySchedule?.list
 });
}
function collect({from=null,to=null,now=Date.now(),includeEarnings=true}={}){
 const current=Number.isFinite(now)?new Date(now):new Date();
 const start=from||day(current,'Asia/Seoul'),end=to||offsetDay(start,21);
 if(!validateDate(start)||!validateDate(end)||end<start)return {events:[],coverage:coverage(),incomplete:true};
 const available={...coverage()},out=new Map();
 const add=item=>{
  if(!item||!validateDate(item.date)||item.date<start||item.date>end||!item.verified||typeof item.sourceUrl!=='string'||!/^https:\/\//.test(item.sourceUrl))return;
  if(item.category==='googlePersonal'||item.source==='google-calendar')return;
  if(item.category==='earnings'&&(!includeEarnings||item.dateStatus!=='confirmed'))return;
  const key=String(item.publisher||'')+'|'+String(item.type||'')+'|'+String(item.symbol||'')+'|'+item.date+'|'+String(item.startsAt||'');
  if(!out.has(key))out.set(key,Object.freeze({
   id:String(item.id||'').slice(0,220),date:item.date,
   title:String(item.title||'').slice(0,120),source:String(item.source||item.publisher||''),
   sourceUrl:item.sourceUrl,category:item.category||'macro',
   priority:item.priority==='critical'?'critical':'high',
   publisher:String(item.publisher||''),type:String(item.type||''),symbol:item.symbol||null,
   startsAt:item.startsAt||null,dateStatus:item.dateStatus||'confirmed',
   dateBasis:item.dateBasis||item.localTimeBasis||(item.publisher==='FED'?'America/New_York':'Asia/Seoul')
  }));
 };
 for(const [name,key] of SOURCES){
  if(name==='EARNINGS'&&!includeEarnings)continue;
  if(!available[name])continue;
  const snapshot=root[key]?.current();
  for(const e of snapshot?.events||[])add(e);
 }
 const years=new Set([Number(start.slice(0,4)),Number(end.slice(0,4))]);
 for(const y of years){
  for(const event of root.MYInvestFomcSchedule?.list(y)||[])add(event);
  for(const event of root.MYInvestBokPolicySchedule?.list(y)||[])add(event);
 }
 const events=[...out.values()].sort((a,b)=>a.date.localeCompare(b.date)||String(a.startsAt||'').localeCompare(String(b.startsAt||'')));
 const needed=['BLS','BEA','BOK_STAT'];if(root.MYInvestOfficialPolicyCalendar){needed.push('POLICY','FED','BOK_MPC');available.FED=[...years].every(y=>(root.MYInvestFomcSchedule?.list(y)||[]).length>0);available.BOK_MPC=[...years].every(y=>(root.MYInvestBokPolicySchedule?.list(y)||[]).length>0);}
 return {events,coverage:available,incomplete:needed.some(n=>!available[n]),from:start,to:end};
}
function assessment({mode='swing',now=Date.now(),symbols=[]}={}){
 const zone='Asia/Seoul',start=day(new Date(now),zone),horizon=mode==='day'?2:21;
 const period=collect({from:start,to:offsetDay(start,horizon),now});
 const owned=new Set(Array.isArray(symbols)?symbols.filter(s=>typeof s==='string').map(s=>s.toUpperCase()):[]);
 const relevant=period.events.filter(e=>e.category!=='earnings'||owned.has(String(e.symbol).toUpperCase()));
 const critical=relevant.filter(e=>e.priority==='critical');
 return Object.freeze({
  mode,coverage:period.coverage,incomplete:period.incomplete,
  hasConfirmedCritical:critical.length>0,
  events:relevant.slice(0,30),
  label:period.incomplete?'일부 일정 미연결 · 공식 출처 재확인 필요':
   critical.length?'주요 발표일 근접 · 변동성·갭 위험 점검':'수집 범위 내 주요 발표 없음 · 다른 리스크 확인 필요',
  basis:'공식 일정만 반영 · 영향 방향과 실제 발표값 미확인 · 매매 신호 아님'
 });
}
async function refreshAll(force=false){
 if(refreshJob)return refreshJob;
 const job=Promise.allSettled(SOURCES.map(([_,key])=>typeof root[key]?.refresh==='function'?root[key].refresh(force):Promise.resolve(null)).concat([refreshCollection(force)])).then(()=>coverage());
 refreshJob=job;try{return await job}finally{if(refreshJob===job)refreshJob=null}
}
const api=Object.freeze({collect,assessment,coverage,refreshAll,collectionStatus:()=>collectionRows.slice()});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestEventContext=api;
})(globalThis);
