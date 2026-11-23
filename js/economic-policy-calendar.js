(function(root){'use strict';
// Verified official date-only policy schedules. Missing clocks stay missing.
const FED='https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',REVISION='https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm',BOK='https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?menuNo=200755&mtgSe=A&syear=2026';
const TTL=72*3600000;let data={status:'unavailable',events:[],retrievedAt:null},flight=null,last=0,epoch=0;
function normalize(raw,now=Date.now()){
 if(raw?.schemaVersion!==1||raw.source!=='OFFICIAL_POLICY'||!Array.isArray(raw.events)||raw.events.length>100)throw Error('POLICY_SCHEMA_INVALID');
 const at=Date.parse(raw.retrievedAt);if(!Number.isFinite(at)||at>now+300000||now-at>TTL)throw Error('POLICY_STALE');
 const seen=new Set(),events=[];
 for(const e of raw.events){
  if(!e||!/^\d{4}-\d{2}-\d{2}$/.test(e.date||'')||new Date(e.date+'T00:00:00Z').toISOString().slice(0,10)!==e.date||e.startsAt!=null||e.verified!==true||e.timeStatus!=='unconfirmed')throw Error('POLICY_DATE_OR_CLOCK_INVALID');
  const fed=e.publisher==='FED'&&['FOMC_DECISION','FOMC_STRATEGY'].includes(e.type)&&[FED,REVISION].includes(e.sourceUrl)&&e.dateBasis==='America/New_York';
  const bok=e.publisher==='BOK'&&e.type==='BOK_MPC'&&e.sourceUrl===BOK&&e.dateBasis==='Asia/Seoul';
  if((!fed&&!bok)||typeof e.title!=='string'||e.title.length>120||typeof e.id!=='string'||seen.has(e.id))throw Error('POLICY_PROVENANCE_INVALID');
  seen.add(e.id);events.push(Object.freeze({...e,retrievedAt:raw.retrievedAt}));
 }
 if(!events.length)throw Error('POLICY_EMPTY');return {status:'ready',retrievedAt:raw.retrievedAt,events};
}
function current(){if(data.status==='ready'&&Date.now()-Date.parse(data.retrievedAt)>TTL)data={status:'unavailable',events:[],retrievedAt:data.retrievedAt};return {...data,events:data.events.slice()}}
function reset(){epoch++;last=0;flight=null;data={status:'unavailable',events:[],retrievedAt:null}}
async function refresh(force=false,fetcher=root.fetch){if(!force&&last&&Date.now()-last<900000)return current();if(flight)return flight;const run=epoch;const job=(async()=>{try{const r=await fetcher('data/policy-events.json',{credentials:'omit',redirect:'error',cache:'no-store'});if(!r.ok)throw Error('POLICY_UNAVAILABLE');const text=await r.text();if(text.length>100000)throw Error('POLICY_TOO_LARGE');const next=normalize(JSON.parse(text));if(run===epoch)data=next}catch{if(run===epoch)data={status:'unavailable',events:[],retrievedAt:null}}if(run===epoch)last=Date.now();return current()})();flight=job;try{return await job}finally{if(flight===job)flight=null}}
function list(year,publisher){return current().events.filter(e=>e.date.startsWith(String(year)+'-')&&e.publisher===publisher)}
const api=Object.freeze({FED,REVISION,BOK,normalize,current,reset,refresh,list});
if(typeof module==='object'&&module.exports)module.exports=api;else{
 root.MYInvestOfficialPolicyCalendar=api;
 // Reuse the existing consumers while replacing static dates with verified snapshots.
 if(root.MYInvestFomcSchedule)root.MYInvestFomcSchedule=Object.freeze({...root.MYInvestFomcSchedule,list:y=>list(y,'FED'),current});
 if(root.MYInvestBokPolicySchedule)root.MYInvestBokPolicySchedule=Object.freeze({...root.MYInvestBokPolicySchedule,list:y=>list(y,'BOK'),current});
}
})(globalThis);
