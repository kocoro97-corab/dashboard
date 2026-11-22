(function(root){'use strict';
/* Google Calendar read-only backend adapter. No OAuth token in browser state.
 * Application backend must authenticate user independently, enforce ownership and
 * calendar.readonly scope, and expose read-only calendar list/events.
 * No adapter => disconnected. No fallback to publicFetch or GAS owner calendar.
 */
const TTL=5*60*1000,MAX_EVENTS=300,MAX_CALENDARS=30;
let provider=null,epoch=0,cache=new Map(),inflight=new Map(),hidden=new Set();
function dateOK(v){return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v}
function normalizeCalendar(row){if(!row||typeof row.id!=='string'||row.id.length>200||!/^[\w.@-]{1,200}$/.test(row.id))return null;return {id:row.id,name:typeof row.name==='string'?row.name.slice(0,70):'내 캘린더',primary:row.primary===true}}
function normalizeEvent(row){
 if(!row||!dateOK(row.date)||typeof row.title!=='string'||!row.title.trim()||typeof row.calendarId!=='string'||!/^[\w.@-]{1,200}$/.test(row.calendarId)||typeof row.id!=='string'||row.id.length>250)return null;
 return {id:'google:'+row.calendarId+':'+row.id,date:row.date,title:row.title.trim().slice(0,100),category:'googlePersonal',calendarId:row.calendarId,source:'google-calendar',verified:false};
}
function connect(adapter){
 if(!adapter||typeof adapter.listCalendars!=='function'||typeof adapter.listEvents!=='function')throw Error('CALENDAR_ADAPTER_INVALID');
 disconnect();provider=adapter;return true;
}
function disconnect(){++epoch;cache.clear();inflight.clear();hidden.clear();provider=null}
const status=()=>({connected:!!provider,ttlSeconds:TTL/1000});
function cached(key,work,force=false){
 if(!provider)return Promise.reject(Error('CALENDAR_NOT_CONNECTED'));
 const now=Date.now(),prior=cache.get(key);
 if(!force&&prior&&prior.expires>now)return Promise.resolve(prior.value);
 if(inflight.has(key))return inflight.get(key);
 const version=epoch;
 const job=Promise.resolve().then(work).then(result=>{if(version!==epoch)throw Error('CALENDAR_SESSION_CHANGED');cache.set(key,{value:result,expires:Date.now()+TTL});return result}).finally(()=>{if(inflight.get(key)===job)inflight.delete(key)});
 inflight.set(key,job);return job;
}
async function calendars(force=false){
 return cached('calendars',async()=>{const raw=await provider.listCalendars();if(!Array.isArray(raw))throw Error('CALENDAR_INVALID_RESPONSE');const seen=new Set();return raw.slice(0,MAX_CALENDARS).map(normalizeCalendar).filter(v=>{if(!v||seen.has(v.id))return false;seen.add(v.id);return true})},force);
}
function hide(id,yes){if(typeof id!=='string')return;yes?hidden.add(id):hidden.delete(id)}
function isHidden(id){return hidden.has(id)}
async function events(year,month,force=false){
 if(!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(month)||month<1||month>12)throw Error('CALENDAR_RANGE_INVALID');
 const list=await calendars(false),visible=list.filter(x=>!hidden.has(x.id));if(!visible.length)return [];
 const period=String(year)+'-'+String(month).padStart(2,'0');
 return cached('events:'+period+':'+visible.map(x=>x.id).join(','),async()=>{
  const raw=await provider.listEvents({year,month,calendarIds:visible.map(x=>x.id)});
  if(!Array.isArray(raw))throw Error('CALENDAR_INVALID_RESPONSE');
  const allowed=new Set(visible.map(x=>x.id)),seen=new Set(),output=[];
  for(const row of raw.slice(0,MAX_EVENTS)){const item=normalizeEvent(row);if(!item||!allowed.has(item.calendarId)||item.date.slice(0,7)!==period||seen.has(item.id))continue;seen.add(item.id);output.push(item)}
  return output.sort((a,b)=>a.date.localeCompare(b.date));
 },force);
}
const api=Object.freeze({connect,disconnect,status,calendars,events,hide,isHidden,normalizeEvent,normalizeCalendar});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestGoogleCalendarSync=api;
})(globalThis);
