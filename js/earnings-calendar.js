(function(root){'use strict';
/* PUBLIC earnings announcements, NEVER holdings, account data or API credentials.
 * A trusted reviewed publisher verifies primary-source evidence. UI checks
 * provenance/invalid dates; 'confirmed' is NOT inferred from SEC filing history.
 * All source-derived records are immutable in application memory.
 */
const TTL=48*3600000,FETCH_TTL=15*60000,MAX_EVENTS=500;
const SOURCE='/data/earnings-events.json';
const VALID=/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
let store={status:'unavailable',events:[],retrievedAt:null,reason:'NOT_LOADED'},lastFetch=0,inflight=null,epoch=0;
function dateOK(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v}
function sourceOK(u,market){
 try{
  if(typeof u!=='string'||u.length>600||/[%\s]/.test(u))return false;
  const url=new URL(u);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)return false;
  const host=url.hostname.toLowerCase();
  if(market==='KR')return host==='dart.fss.or.kr'||host==='opendart.fss.or.kr'||host==='kind.krx.co.kr';
  if(market==='US')return host==='www.sec.gov'||host==='sec.gov';
  return false;
 }catch{return false}
}
function kstDay(iso){
 const o={};for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso)))if(p.type!=='literal')o[p.type]=p.value;
 return o.year+'-'+o.month+'-'+o.day;
}
function normalize(payload,now=Date.now()){
 if(!payload||payload.schemaVersion!==1||payload.source!=='VERIFIED_EARNINGS'||
    !Array.isArray(payload.events)||payload.events.length>MAX_EVENTS)throw Error('EARNINGS_SCHEMA_INVALID');
 const retrieved=Date.parse(payload.retrievedAt||'');
 if(!Number.isFinite(retrieved)||retrieved>now+300000||now-retrieved>TTL)throw Error('EARNINGS_SNAPSHOT_STALE');
 const output=[],seen=new Map();
 for(const raw of payload.events){
  if(!raw||!['KR','US'].includes(raw.market)||typeof raw.symbol!=='string'||!VALID.test(raw.symbol)||
     (raw.market==='KR'&&!/^\d{6}$/.test(raw.symbol))||(raw.market==='US'&&/^\d{6}$/.test(raw.symbol))||
     !dateOK(raw.date)||!['confirmed','estimated'].includes(raw.dateStatus)||
     typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>100||
     typeof raw.sourceUrl!=='string'||!sourceOK(raw.sourceUrl,raw.market)||
     typeof raw.period!=='string'||!/^[A-Za-z0-9 -]{1,32}$/.test(raw.period)||
     typeof raw.eventId!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(raw.eventId)||
     !['earnings','earnings_call','ir'].includes(raw.eventType))continue;
  // Market data calendars / filing occurrence MUST NOT be promoted to a
  // future issuer-confirmed earnings announcement.
  if(raw.dateStatus==='confirmed'&&raw.evidence!=='issuer_announcement')continue;
  if(raw.dateStatus==='estimated'&&raw.evidence!=='vendor_estimate')continue;
  const time=raw.startsAt;
  if(time!=null&&(typeof time!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.000Z$/.test(time)||
     !Number.isFinite(Date.parse(time))||kstDay(time)!==raw.date))continue;
  // US date-only issuer schedules can use the original US-local day, and
  // must not pretend that a US meeting date is a KST timestamp.
  const key=raw.market+'|'+raw.symbol+'|'+raw.period+'|'+raw.eventType;
  const candidate=Object.freeze({id:'earnings:'+raw.eventId,date:raw.date,title:raw.name+' · '+(raw.eventType==='earnings'?'실적 발표':raw.eventType==='earnings_call'?'실적 설명회':'기업설명회'),
   category:'earnings',market:raw.market,symbol:raw.symbol,name:raw.name,period:raw.period,eventType:raw.eventType,
   dateStatus:raw.dateStatus,evidence:raw.evidence,sourceUrl:raw.sourceUrl,source:raw.dateStatus==='confirmed'?'공시·IR 확인':'외부 예상일(미확정)',verified:raw.dateStatus==='confirmed',
   localTimeBasis:time?'Asia/Seoul':raw.market==='US'?'America/New_York':'Asia/Seoul',startsAt:time||null,priority:'high'});
  const prior=seen.get(key);
  if(!prior||prior.dateStatus==='estimated'&&candidate.dateStatus==='confirmed'||
    prior.dateStatus===candidate.dateStatus&&candidate.date>=prior.date)seen.set(key,candidate);
 }
 output.push(...seen.values());
 return {status:'ready',retrievedAt:payload.retrievedAt,reason:null,events:output.sort((a,b)=>a.date.localeCompare(b.date)||a.symbol.localeCompare(b.symbol))};
}
function current(){return {...store,events:store.events.slice()}}
function reset(){epoch++;lastFetch=0;inflight=null;store={status:'unavailable',retrievedAt:null,reason:'RESET',events:[]}}
async function refresh(force=false,fetcher=root.fetch){
 if(!force&&lastFetch&&Date.now()-lastFetch<FETCH_TTL)return current();
 if(inflight)return inflight;
 if(typeof fetcher!=='function')return current();
 const stamp=epoch;const job=(async()=>{
  try{
   const r=await fetcher('data/earnings-events.json',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error'});
   if(!r?.ok)throw Error('EARNINGS_SNAPSHOT_NOT_FOUND');
   const text=await r.text();if(text.length>600000)throw Error('EARNINGS_SNAPSHOT_TOO_LARGE');
   const next=normalize(JSON.parse(text));
   if(stamp===epoch){store=next;lastFetch=Date.now()}
  }catch{
   if(stamp===epoch){store={status:'unavailable',retrievedAt:null,reason:'NO_VERIFIED_SNAPSHOT',events:[]};lastFetch=Date.now()}
  }
  return current();
 })();inflight=job;
 try{return await job}finally{if(inflight===job)inflight=null}
}
function month(y,m){if(!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12)return [];const prefix=y+'-'+String(m).padStart(2,'0');return store.status==='ready'?store.events.filter(e=>e.date.startsWith(prefix)):[]}
function matches({holdings=[],watch=[],selected=[]}={}){
 const holdingsSet=new Set(holdings.filter(x=>typeof x==='string'&&VALID.test(x)).map(x=>x.toUpperCase()));
 const watchSet=new Set(watch.filter(x=>typeof x==='string'&&VALID.test(x)).map(x=>x.toUpperCase()));
 const selectedSet=new Set(selected.filter(x=>typeof x==='string'&&VALID.test(x)).map(x=>x.toUpperCase()));
 if(store.status!=='ready')return [];
 return store.events.filter(e=>holdingsSet.has(e.symbol)||watchSet.has(e.symbol)||selectedSet.has(e.symbol))
  .map(e=>({...e,relation:holdingsSet.has(e.symbol)?'holding':watchSet.has(e.symbol)?'watch':'selected'}));
}
function horizon(days=21,now=Date.now(),symbols=null){
 if(!Number.isInteger(days)||days<1||days>90||store.status!=='ready')return [];
 const today=kstDay(new Date(now).toISOString());
 const end=kstDay(new Date(now+days*86400000).toISOString());
 const whitelist=Array.isArray(symbols)?new Set(symbols.filter(s=>typeof s==='string').map(s=>s.toUpperCase())):null;
 return store.events.filter(e=>e.date>=today&&e.date<=end&&(!whitelist||whitelist.has(e.symbol)));
}
const api=Object.freeze({normalize,current,reset,refresh,month,matches,horizon,sourceOK,dateOK,SOURCE});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestEarningsCalendar=api;
})(globalThis);
