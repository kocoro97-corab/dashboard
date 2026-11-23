'use strict';
/**
 * Google OAuth + Calendar API HTTPS adapter for private trusted server only.
 * Node 20+ global fetch or injected fetch. No Google token is ever returned
 * to the browser. Calendar events are normalized to Asia/Seoul date-only.
 */
const ENDPOINT='https://oauth2.googleapis.com/token';
const CALENDAR='https://www.googleapis.com/calendar/v3';
const READ_SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const failure=(code)=>Object.assign(new Error(code),{code});
function googleApi({clientId,clientSecret,fetchImpl=globalThis.fetch,timeoutMs=10000}){
 if(typeof clientId!=='string'||!clientId||typeof clientSecret!=='string'||!clientSecret||typeof fetchImpl!=='function')throw failure('GOOGLE_CONFIG_INVALID');
 const read=async(url,options={})=>{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
   const response=await fetchImpl(url,{...options,signal:ctrl.signal,redirect:'error',cache:'no-store'});
   if(!response.ok)throw failure('GOOGLE_HTTP_'+(response.status>=400&&response.status<=599?response.status:'ERROR'));
   const text=await response.text();
   if(text.length>2000000)throw failure('GOOGLE_RESPONSE_TOO_LARGE');
   let data;try{data=JSON.parse(text)}catch{throw failure('GOOGLE_JSON_INVALID')}
   if(!data||typeof data!=='object'||Array.isArray(data))throw failure('GOOGLE_RESPONSE_INVALID');
   return data;
  }catch(error){if(error?.name==='AbortError')throw failure('GOOGLE_TIMEOUT');throw error}
  finally{clearTimeout(timer)}
 };
 const token=body=>read(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body).toString()});
 const headers=accessToken=>({Authorization:'Bearer '+accessToken,Accept:'application/json'});
 const kstDate=datetime=>{
  if(typeof datetime!=='string'||!Number.isFinite(Date.parse(datetime)))return null;
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(datetime));
 };
 return Object.freeze({
  exchange:async({code,codeVerifier,redirectUri})=>{
   const d=await token({code,code_verifier:codeVerifier,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'});
   return {accessToken:d.access_token,refreshToken:d.refresh_token,expiresIn:d.expires_in,scope:d.scope};
  },
  refresh:async(refreshToken)=>{
   const d=await token({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'});
   return {accessToken:d.access_token,refreshToken:d.refresh_token||null,expiresIn:d.expires_in,scope:d.scope||null};
  },
  revoke:async(accessToken)=>{
   if(typeof accessToken!=='string'||!accessToken)return;
   const response=await fetchImpl('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:accessToken}).toString(),redirect:'error'});
   if(!response.ok)throw failure('GOOGLE_REVOKE_FAILED');
  },
  calendars:async(accessToken)=>{
   const results=[],seen=new Set(),tokens=new Set();let pageToken='';
   for(let page=0;page<4;page++){
    const u=new URL(CALENDAR+'/users/me/calendarList');u.searchParams.set('maxResults','100');
    if(pageToken)u.searchParams.set('pageToken',pageToken);
    const d=await read(u.href,{headers:headers(accessToken)});
    if(!Array.isArray(d.items))throw failure('GOOGLE_RESPONSE_INVALID');
    for(const it of d.items){if(typeof it?.id!=='string'||seen.has(it.id))continue;if(results.length>=30)throw failure('GOOGLE_CALENDAR_LIMIT');seen.add(it.id);results.push({id:it.id,name:typeof it.summary==='string'?it.summary:'내 캘린더',primary:it.primary===true})}
    if(d.nextPageToken!=null&&typeof d.nextPageToken!=='string')throw failure('GOOGLE_RESPONSE_INVALID');
    if(!d.nextPageToken)return results;
    if(tokens.has(d.nextPageToken)||page===3)throw failure('GOOGLE_PAGINATION_INCOMPLETE');
    tokens.add(d.nextPageToken);
    pageToken=d.nextPageToken;
   }
  },
  events:async(accessToken,{calendarId,year,month,maxResults=300})=>{
   if(typeof calendarId!=='string'||!calendarId||!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)throw failure('GOOGLE_RANGE_INVALID');
   const pad=n=>String(n).padStart(2,'0'),ym=year+'-'+pad(month),next=new Date(Date.UTC(year,month,1));
   const beginning=ym+'-01T00:00:00+09:00',end=next.toISOString().slice(0,7)+'-01T00:00:00+09:00';
   const u=new URL(CALENDAR+'/calendars/'+encodeURIComponent(calendarId)+'/events');
   u.searchParams.set('timeMin',beginning);u.searchParams.set('timeMax',end);
   u.searchParams.set('timeZone','Asia/Seoul');u.searchParams.set('singleEvents','true');
   u.searchParams.set('orderBy','startTime');u.searchParams.set('maxResults',String(Math.min(300,Math.max(1,maxResults))));
   const results=[],seen=new Set(),tokens=new Set(),limit=Math.min(300,Math.max(1,maxResults));
   for(let page=0;page<4;page++){
    const d=await read(u.href,{headers:headers(accessToken)});
    if(!Array.isArray(d.items))throw failure('GOOGLE_RESPONSE_INVALID');
    for(const item of d.items){
     if(item?.status==='cancelled')continue;
     const start=item?.start?.date||kstDate(item?.start?.dateTime);
     if(typeof item?.id!=='string'||typeof start!=='string'||start.slice(0,7)!==ym||seen.has(item.id))continue;
     if(results.length>=limit)throw failure('GOOGLE_EVENT_LIMIT');
     seen.add(item.id);results.push({id:item.id,date:start,title:item.summary||'일정',calendarId});
    }
    if(d.nextPageToken!=null&&typeof d.nextPageToken!=='string')throw failure('GOOGLE_RESPONSE_INVALID');
    if(!d.nextPageToken)return results;
    if(tokens.has(d.nextPageToken)||page===3)throw failure('GOOGLE_PAGINATION_INCOMPLETE');
    tokens.add(d.nextPageToken);u.searchParams.set('pageToken',d.nextPageToken);
   }
  }
 });
}
module.exports={googleApi,READ_SCOPE};
