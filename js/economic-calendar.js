(function(root){'use strict';
/* Same-origin, public-only official economic-event snapshot reader.
 * No credential, user data, forecast or actual value is transported.
 * Explicitly fail closed when publisher snapshot is absent or stale.
 */
const MAX_AGE=48*3600*1000,MAX_EVENTS=600;
let state={events:[],status:'unavailable',retrievedAt:null,reason:'NOT_LOADED'},loading=null,cacheAt=0,epoch=0;
const dateOK=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s};
const allowedTypes=new Set(['CPI','NFP','PPI','JOLTS','ECI']);
function normalize(payload,now=Date.now()){
 if(!payload||!Array.isArray(payload.events)||payload.events.length>MAX_EVENTS)throw Error('ECON_PAYLOAD_INVALID');
 const timestamp=Date.parse(payload.retrievedAt||'');
 if(!Number.isFinite(timestamp)||timestamp>now+300000||now-timestamp>MAX_AGE)throw Error('ECON_STALE');
 const events=[],seen=new Set();
 for(const v of payload.events){
  if(!v||v.publisher!=='BLS'||!allowedTypes.has(v.type)||v.verified!==true||v.sourceUrl!==root.MYInvestBlsSchedule?.SOURCE||!dateOK(v.date)||typeof v.startsAt!=='string'||!Number.isFinite(Date.parse(v.startsAt))||typeof v.title!=='string'||v.title.length>100||typeof v.id!=='string'||v.id!=='bls-'+v.type+'-'+v.startsAt)continue;
  const kstParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v.startsAt));
  const dateParts={};for(const part of kstParts)if(part.type!=='literal')dateParts[part.type]=part.value;
  if(v.date!==dateParts.year+'-'+dateParts.month+'-'+dateParts.day)continue;
  const key=v.publisher+'|'+v.type+'|'+v.startsAt;
  if(seen.has(key))continue;seen.add(key);
  events.push(Object.freeze({id:v.id,date:v.date,title:v.title,category:'macro',priority:v.priority==='critical'?'critical':'high',publisher:'BLS',type:v.type,sourceUrl:v.sourceUrl,startsAt:v.startsAt,verified:true,source:'BLS',retrievedAt:payload.retrievedAt}));
 }
 return {events:events.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),status:'ready',retrievedAt:payload.retrievedAt,reason:null};
}
function current(){if(state.status==='ready'&&(!Number.isFinite(Date.parse(state.retrievedAt))||Date.now()-Date.parse(state.retrievedAt)>MAX_AGE))state={status:'unavailable',events:[],retrievedAt:state.retrievedAt,reason:'SNAPSHOT_EXPIRED'};return {...state,events:state.events.slice()}}
function reset(){epoch++;loading=null;cacheAt=0;state={events:[],status:'unavailable',retrievedAt:null,reason:'RESET'}}
async function refresh(force=false,fetcher=root.fetch){
 if(!force&&cacheAt&&Date.now()-cacheAt<15*60*1000)return current();
 if(loading)return loading;
 if(typeof fetcher!=='function')return current();
 const version=epoch;
 const job=(async()=>{
  try{
   const response=await fetcher('data/economic-events.json',{method:'GET',credentials:'omit',redirect:'error',cache:'no-store'});
   if(!response?.ok)throw Error('ECON_SNAPSHOT_MISSING');
   const raw=await response.text();if(raw.length>500000)throw Error('ECON_SNAPSHOT_TOO_LARGE');
   const next=normalize(JSON.parse(raw));
   if(version===epoch){state=next;cacheAt=Date.now()}
  }catch{if(version===epoch){state={events:[],status:'unavailable',retrievedAt:null,reason:'NO_VERIFIED_SNAPSHOT'};cacheAt=Date.now()}}
  return current();
 })();
 loading=job;try{return await job}finally{if(loading===job)loading=null}
}
function month(year,month){current();if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)return [];
 const p=String(year)+'-'+String(month).padStart(2,'0');return state.status==='ready'?state.events.filter(x=>x.date.slice(0,7)===p):[];
}
function horizon(days=14,now=Date.now()){current();
 if(!Number.isInteger(days)||days<1||days>60)return [];
 return state.status==='ready'?state.events.filter(x=>{const t=Date.parse(x.startsAt);return t>=now&&t<=now+days*86400000}):[];
}
const api=Object.freeze({refresh,current,reset,month,horizon,normalize});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestEconomicCalendar=api;
})(globalThis);
