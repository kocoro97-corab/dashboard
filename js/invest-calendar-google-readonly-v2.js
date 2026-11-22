/* MY INVEST V2 — Google Calendar opt-in, primary-calendar READ ONLY.
 * Uses Google Identity Services user consent, never developer secrets or
 * privileged GAS/NH credentials. Tokens remain only in this JS closure.
 * API is touched only following explicit Connect/Refresh button actions.
 */
(function(root){
'use strict';
const SCOPE='https://www.googleapis.com/auth/calendar.events.readonly';
const LIST_SCOPE='https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const AUTH_SCOPE=SCOPE+' '+LIST_SCOPE;
const CACHE_MS=5*60*1000;
const ID_RE=/^[0-9]{8,32}-[A-Za-z0-9_-]{12,80}\.apps\.googleusercontent\.com$/;
const now=()=>Date.now();
const error=code=>Object.assign(new Error(code),{code});
function create({clientId,google=root.google,fetcher=root.fetch,clock=now}={}){
 const eligible=typeof clientId==='string'&&ID_RE.test(clientId);
 let token=null,expires=0,request=null,connected=false;
 let available=null,availableAt=0,listPartial=false;
 const eventsCache=new Map();
 function resetView(){available=null;availableAt=0;listPartial=false;eventsCache.clear()}
 function status(){return Object.freeze({
  configured:eligible,connected:!!connected&&!!token&&clock()<expires,
  expiresAt:connected&&clock()<expires?expires:null,
  scope:'selected-calendars-events-and-list-read-only',mayWrite:false,
  storage:'memory-only'
 })}
 function connect(){
  if(!eligible)return Promise.reject(error('GOOGLE_CLIENT_NOT_CONFIGURED'));
  if(!google?.accounts?.oauth2?.initTokenClient)
   return Promise.reject(error('GOOGLE_IDENTITY_SDK_UNAVAILABLE'));
  if(request)return Promise.reject(error('GOOGLE_AUTH_IN_PROGRESS'));
  return new Promise((resolve,reject)=>{
   let client;
   try{
    client=google.accounts.oauth2.initTokenClient({
     client_id:clientId,scope:AUTH_SCOPE,
     callback:response=>{
      if(!request)return;
      const active=request;request=null;
      if(response?.error||!response?.access_token||
       !/^[A-Za-z0-9_.~-]{10,4096}$/.test(response.access_token)){
       token=null;connected=false;expires=0;resetView();
       active.reject(error('GOOGLE_AUTH_DECLINED'));return;
      }
      const secs=Number(response.expires_in);
      token=response.access_token;connected=true;
      expires=clock()+(Number.isFinite(secs)&&secs>0?Math.min(secs,3600):1800)*1000-60000;
      active.resolve(status());
     },
     error_callback:()=>{
      if(!request)return;
      const active=request;request=null;active.reject(error('GOOGLE_AUTH_POPUP_FAILED'));
     }
    });
    request={resolve,reject};
    client.requestAccessToken({prompt:'consent'});
   }catch{
    request=null;reject(error('GOOGLE_AUTH_START_FAILED'));
   }
  });
 }
 function disconnect(){
  const revoke=token;token=null;expires=0;connected=false;resetView();
  if(request){const active=request;request=null;active.reject(error('GOOGLE_AUTH_CANCELLED'))}
  if(revoke&&typeof google?.accounts?.oauth2?.revoke==='function')
   try{google.accounts.oauth2.revoke(revoke,()=>{})}catch{}
  return status();
 }
 function span(year,month){
  if(!Number.isInteger(year)||year<2000||year>2099||
   !Number.isInteger(month)||month<1||month>12)throw error('INVALID_CALENDAR_MONTH');
  const day=y=>String(y).padStart(2,'0');
  const start=year+'-'+day(month)+'-01T00:00:00+09:00';
  const y=month===12?year+1:year,m=month===12?1:month+1;
  const end=y+'-'+day(m)+'-01T00:00:00+09:00';
  return [start,end];
 }
 async function googleGet(url){
  if(!eligible)throw error('GOOGLE_CLIENT_NOT_CONFIGURED');
  if(!token||!connected||clock()>=expires){
   token=null;connected=false;resetView();throw error('GOOGLE_AUTH_REQUIRED');
  }
  if(typeof fetcher!=='function')throw error('GOOGLE_FETCH_UNAVAILABLE');
  let response;
  try{
   response=await fetcher(url,{method:'GET',headers:{
    Authorization:'Bearer '+token,Accept:'application/json'
   },credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  }catch{throw error('GOOGLE_NETWORK_FAILED')}
  if(response?.status===401||response?.status===403){
   token=null;connected=false;expires=0;resetView();
   throw error('GOOGLE_ACCESS_EXPIRED_OR_DENIED');
  }
  if(!response?.ok)throw error('GOOGLE_EVENTS_UNAVAILABLE');
  try{return await response.json()}
  catch{throw error('GOOGLE_INVALID_RESPONSE')}
 }
 async function listCalendars(){
  if(available&&clock()-availableAt<CACHE_MS&&clock()<expires)
   return Object.freeze({calendars:available,partial:listPartial,cached:true});
  const url='https://www.googleapis.com/calendar/v3/users/me/calendarList?'+
    new URLSearchParams({maxResults:'100',
     fields:'items(id,summary,primary,accessRole),nextPageToken'}).toString();
  const payload=await googleGet(url);
  if(!payload||!Array.isArray(payload.items)||payload.items.length>100)
   throw error('GOOGLE_INVALID_CALENDAR_LIST');
  const data=[],ids=new Set();
  for(const row of payload.items){
   if(typeof row?.id!=='string'||!row.id||row.id.length>300||
    /[\x00-\x1f]/.test(row.id)||ids.has(row.id))continue;
   if(!['reader','owner','writer','writerWithoutPrivateAccess'].includes(row.accessRole))continue;
   ids.add(row.id);
   const name=typeof row.summary==='string'&&row.summary.trim()?
    row.summary.trim().slice(0,100):'이름 없는 캘린더';
   data.push(Object.freeze({
    id:row.primary?'primary':row.id,name,
    primary:row.primary===true,
    holiday:/holiday|휴일|공휴일/i.test(name),
    readOnly:true
   }));
  }
  // Legacy default primary access remains valid even if list API omits it.
  available=Object.freeze(data);
  availableAt=clock();listPartial=!!payload.nextPageToken;
  return Object.freeze({
   calendars:available,partial:listPartial,
   cached:false
  });
 }
 async function events(year,month,calendarId='primary'){
  const [begin,end]=span(year,month);
  if(typeof calendarId!=='string'||calendarId.length<1||calendarId.length>300)
   throw error('GOOGLE_CALENDAR_NOT_SELECTED');
  if(calendarId!=='primary'&&
   !(available?.some(x=>x.id===calendarId)))
   throw error('GOOGLE_CALENDAR_NOT_SELECTED');
  const key=calendarId+'|'+year+'-'+month;
  const cached=eventsCache.get(key);
  if(cached&&clock()-cached.at<CACHE_MS&&clock()<expires)
   return Object.freeze({...cached.result,cached:true});
  const url='https://www.googleapis.com/calendar/v3/calendars/'+
   encodeURIComponent(calendarId)+'/events?'+
   new URLSearchParams({timeMin:begin,timeMax:end,singleEvents:'true',
    orderBy:'startTime',maxResults:'200',
    fields:'items(id,summary,start,status),nextPageToken'}).toString();
  const payload=await googleGet(url);
  if(!payload||!Array.isArray(payload.items)||payload.items.length>200)
   throw error('GOOGLE_INVALID_RESPONSE');
  const clean=payload.items.filter(x=>x?.status!=='cancelled');
  const core=root.MYInvestCalendarCoreV2;
  if(!core||typeof core.normalizeGoogle!=='function')
   throw error('GOOGLE_CALENDAR_CORE_UNAVAILABLE');
  const records=core.normalizeGoogle(clean).map(x=>Object.freeze({
   ...x,id:'google:'+calendarId+':'+x.id,sourceCalendar:calendarId,
   sourceLabel:available?.find(c=>c.id===calendarId)?.name||'기본 캘린더',
   holidayCalendar:!!available?.find(c=>c.id===calendarId)?.holiday,
   sourceStatus:'GOOGLE_USER_CALENDAR',readOnly:true
  }));
  const result=Object.freeze({records:Object.freeze(records),
   partial:!!payload.nextPageToken,retrievedAt:clock(),
   calendar:calendarId,authenticated:true,readOnly:true,cached:false});
  eventsCache.set(key,{at:clock(),result});
  return result;
 }
 return Object.freeze({connect,events,listCalendars,disconnect,status});
}
const api=Object.freeze({create,SCOPE,LIST_SCOPE,AUTH_SCOPE});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestGoogleCalendarReadonlyV2=api;
})(typeof globalThis!=='undefined'?globalThis:this);
