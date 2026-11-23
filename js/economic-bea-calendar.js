(function(root){'use strict';
/* Public BEA snapshot, independent of BLS. Never conflate personal calendars.
 * Same-origin data only; stale or unsigned-by-provenance calendar is unavailable.
 */
const MAX_AGE=72*3600000;
let snapshot={events:[],status:'unavailable',retrievedAt:null},lastFetch=0,inflight=null,epoch=0;
function normalize(input,now=Date.now()){
 if(!input||input.source!=='BEA'||input.sourceUrl!==root.MYInvestBeaSchedule?.SOURCE||!Array.isArray(input.events)||input.events.length>600)throw Error('BEA_INVALID_SNAPSHOT');
 const at=Date.parse(input.retrievedAt||'');
 if(!Number.isFinite(at)||at>now+300000||now-at>MAX_AGE)throw Error('BEA_STALE');
 const items=[],seen=new Set(),allowed=new Set(Object.values(root.MYInvestBeaSchedule?.TYPES||{}).map(t=>t.type));
 for(const e of input.events){
  if(!e||e.publisher!=='BEA'||e.verified!==true||e.sourceUrl!==input.sourceUrl||!allowed.has(e.type)||typeof e.startsAt!=='string'||!Number.isFinite(Date.parse(e.startsAt))||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(e.startsAt)||typeof e.title!=='string'||e.title.length>100||e.id!=='bea-'+e.type+'-'+e.startsAt)continue;
  const parts={};for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(e.startsAt)))if(p.type!=='literal')parts[p.type]=p.value;
  if(e.date!==parts.year+'-'+parts.month+'-'+parts.day||seen.has(e.id))continue;
  seen.add(e.id);items.push(Object.freeze({id:e.id,date:e.date,title:e.title,category:'macro',priority:e.priority==='critical'?'critical':'high',publisher:'BEA',type:e.type,verified:true,source:'BEA',sourceUrl:e.sourceUrl,startsAt:e.startsAt,retrievedAt:input.retrievedAt}));
 }
 if(!items.length)throw Error('BEA_NO_VALID_EVENTS');
 return {events:items.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),status:'ready',retrievedAt:input.retrievedAt};
}
function current(){return {...snapshot,events:snapshot.events.slice()}}
function reset(){++epoch;lastFetch=0;inflight=null;snapshot={events:[],status:'unavailable',retrievedAt:null}}
async function refresh(force=false,fetcher=root.fetch){
 if(!force&&lastFetch&&Date.now()-lastFetch<15*60000)return current();
 if(inflight)return inflight;
 if(typeof fetcher!=='function')return current();
 const version=epoch;const task=(async()=>{
  try{
   const response=await fetcher('data/bea-events.json',{method:'GET',cache:'no-store',credentials:'omit',redirect:'error'});
   if(!response?.ok)throw Error('BEA_SNAPSHOT_MISSING');
   const text=await response.text();if(text.length>500000)throw Error('BEA_SNAPSHOT_TOO_LARGE');
   const next=normalize(JSON.parse(text));
   if(version===epoch){snapshot=next;lastFetch=Date.now()}
  }catch{if(version===epoch){snapshot={events:[],status:'unavailable',retrievedAt:null};lastFetch=Date.now()}}
  return current();
 })();inflight=task;
 try{return await task}finally{if(inflight===task)inflight=null}
}
function month(year,month){if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)return [];const p=year+'-'+String(month).padStart(2,'0');return snapshot.status==='ready'?snapshot.events.filter(e=>e.date.startsWith(p)):[]}
function horizon(days=14,now=Date.now()){if(!Number.isInteger(days)||days<1||days>60)return [];return snapshot.status==='ready'?snapshot.events.filter(e=>{const at=Date.parse(e.startsAt);return at>=now&&at<=now+days*86400000}):[]}
const api=Object.freeze({normalize,current,reset,refresh,month,horizon});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestBeaCalendar=api;
})(globalThis);
