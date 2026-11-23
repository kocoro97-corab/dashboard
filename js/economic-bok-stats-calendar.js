(function(root){'use strict';
/* BOK statistics: publicly readable same-origin snapshot, independent
 * from private accounts, authenticated Google Calendar and BLS/BEA.
 * Failed/stale snapshots display 'unavailable', never inferred dates.
 */
const MAX_AGE=72*3600000;
let value={status:'unavailable',events:[],retrievedAt:null},last=0,flight=null,version=0;
function kstDay(iso){
 const parts={};for(const v of new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)))if(v.type!=='literal')parts[v.type]=v.value;
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function normalize(payload,now=Date.now()){
 if(!payload||payload.source!=='BOK'||payload.sourceUrl!==root.MYInvestBokStatsParser?.SOURCE||!Array.isArray(payload.events)||payload.events.length>500)throw Error('BOK_SNAPSHOT_INVALID');
 const at=Date.parse(payload.retrievedAt||'');if(!Number.isFinite(at)||at>now+300000||now-at>MAX_AGE)throw Error('BOK_SNAPSHOT_STALE');
 const allowed=new Set((root.MYInvestBokStatsParser?.CATEGORIES||[]).map(x=>x.type)),seen=new Set(),result=[];
 for(const e of payload.events){
  if(!e||e.publisher!=='BOK'||e.sourceUrl!==payload.sourceUrl||e.verified!==true||!allowed.has(e.type)||
   typeof e.startsAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.startsAt)||
   !Number.isFinite(Date.parse(e.startsAt))||e.id!=='bokstat-'+e.type+'-'+e.startsAt||
   typeof e.title!=='string'||e.title.length>100||e.date!==kstDay(e.startsAt)||seen.has(e.id))continue;
  seen.add(e.id);result.push(Object.freeze({id:e.id,date:e.date,title:e.title,category:'macro',publisher:'BOK',type:e.type,
   priority:e.priority==='critical'?'critical':'high',source:'한국은행',sourceUrl:e.sourceUrl,verified:true,startsAt:e.startsAt,retrievedAt:payload.retrievedAt}));
 }
 if(result.length===0)throw Error('BOK_NO_VERIFIED_EVENTS');
 return {status:'ready',events:result.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),retrievedAt:payload.retrievedAt};
}
function current(){if(value.status==='ready'&&(!Number.isFinite(Date.parse(value.retrievedAt))||Date.now()-Date.parse(value.retrievedAt)>MAX_AGE))value={status:'unavailable',events:[],retrievedAt:value.retrievedAt,reason:'SNAPSHOT_EXPIRED'};return {...value,events:value.events.slice()}}
function reset(){version++;last=0;flight=null;value={status:'unavailable',events:[],retrievedAt:null}}
async function refresh(force=false,fetcher=root.fetch){
 if(!force&&last&&Date.now()-last<900000)return current();
 if(flight)return flight;if(typeof fetcher!=='function')return current();
 const token=version;
 const run=(async()=>{try{
  const response=await fetcher('data/bok-stats-events.json',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error'});
  if(!response?.ok)throw Error('BOK_SNAPSHOT_MISSING');
  const raw=await response.text();if(raw.length>500000)throw Error('BOK_SNAPSHOT_OVERSIZED');
  const next=normalize(JSON.parse(raw));if(token===version){value=next;last=Date.now()}
 }catch{if(token===version){value={status:'unavailable',events:[],retrievedAt:null};last=Date.now()}}
 return current()})();flight=run;try{return await run}finally{if(flight===run)flight=null}
}
function month(y,m){current();if(!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12)return [];const prefix=y+'-'+String(m).padStart(2,'0');return value.status==='ready'?value.events.filter(e=>e.date.startsWith(prefix)):[]}
function horizon(days=14,now=Date.now()){current();if(!Number.isInteger(days)||days<1||days>60)return [];return value.status==='ready'?value.events.filter(e=>Date.parse(e.startsAt)>=now&&Date.parse(e.startsAt)<=now+days*86400000):[]}
const api=Object.freeze({normalize,refresh,current,reset,month,horizon});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestBokStatsCalendar=api;
})(globalThis);
