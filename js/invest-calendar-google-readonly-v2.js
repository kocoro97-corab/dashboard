/* MY INVEST V2 — Google Calendar opt-in, primary-calendar READ ONLY.
 * Uses Google Identity Services user consent, never developer secrets or
 * privileged GAS/NH credentials. Tokens remain only in this JS closure.
 * API is touched only following explicit Connect/Refresh button actions.
 */
(function(root){
'use strict';
const SCOPE='https://www.googleapis.com/auth/calendar.events.readonly';
const ID_RE=/^[0-9]{8,32}-[A-Za-z0-9_-]{12,80}\.apps\.googleusercontent\.com$/;
const now=()=>Date.now();
const error=code=>Object.assign(new Error(code),{code});
function create({clientId,google=root.google,fetcher=root.fetch,clock=now}={}){
 const eligible=typeof clientId==='string'&&ID_RE.test(clientId);
 let token=null,expires=0,request=null,connected=false;
 function status(){return Object.freeze({
  configured:eligible,connected:!!connected&&!!token&&clock()<expires,
  expiresAt:connected&&clock()<expires?expires:null,
  scope:'primary-calendar-events-read-only',mayWrite:false,
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
     client_id:clientId,scope:SCOPE,
     callback:response=>{
      if(!request)return;
      const active=request;request=null;
      if(response?.error||!response?.access_token||
       !/^[A-Za-z0-9_.~-]{10,4096}$/.test(response.access_token)){
       token=null;connected=false;expires=0;
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
  const revoke=token;token=null;expires=0;connected=false;
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
 async function events(year,month){
  if(!eligible)throw error('GOOGLE_CLIENT_NOT_CONFIGURED');
  if(!token||!connected||clock()>=expires){
   token=null;connected=false;throw error('GOOGLE_AUTH_REQUIRED');
  }
  if(typeof fetcher!=='function')throw error('GOOGLE_FETCH_UNAVAILABLE');
  const [begin,end]=span(year,month);
  const url='https://www.googleapis.com/calendar/v3/calendars/primary/events?'+
   new URLSearchParams({timeMin:begin,timeMax:end,singleEvents:'true',
    orderBy:'startTime',maxResults:'200',
    fields:'items(id,summary,start,status),nextPageToken'}).toString();
  let response;
  try{
   response=await fetcher(url,{method:'GET',headers:{
    Authorization:'Bearer '+token,Accept:'application/json'
   },credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  }catch{throw error('GOOGLE_NETWORK_FAILED')}
  if(response?.status===401||response?.status===403){
   token=null;connected=false;expires=0;throw error('GOOGLE_ACCESS_EXPIRED_OR_DENIED');
  }
  if(!response?.ok)throw error('GOOGLE_EVENTS_UNAVAILABLE');
  let payload;
  try{payload=await response.json()}catch{throw error('GOOGLE_INVALID_RESPONSE')}
  if(!payload||!Array.isArray(payload.items)||payload.items.length>200)
   throw error('GOOGLE_INVALID_RESPONSE');
  const clean=payload.items.filter(x=>x?.status!=='cancelled');
  const core=root.MYInvestCalendarCoreV2;
  if(!core||typeof core.normalizeGoogle!=='function')
   throw error('GOOGLE_CALENDAR_CORE_UNAVAILABLE');
  return Object.freeze({
   records:core.normalizeGoogle(clean),
   partial:!!payload.nextPageToken,
   retrievedAt:clock(),
   calendar:'primary',
   authenticated:true,readOnly:true
  });
 }
 return Object.freeze({connect,events,disconnect,status});
}
const api=Object.freeze({create,SCOPE});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestGoogleCalendarReadonlyV2=api;
})(typeof globalThis!=='undefined'?globalThis:this);
