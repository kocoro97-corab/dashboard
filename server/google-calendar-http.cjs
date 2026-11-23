'use strict';
// Private runtime adapter; deployment and real OAuth configuration remain disabled.
const ACTIONS=new Set(['googleCalendarStatus','googleCalendarBegin','googleCalendarList','googleCalendarEvents','googleCalendarRevoke']);
const CODES=new Set(['AUTH_REQUIRED','CALENDAR_ACCESS_DENIED','CALENDAR_RANGE_INVALID','GOOGLE_NOT_CONNECTED','GOOGLE_CONNECTION_CHANGED','GOOGLE_CALENDAR_LIMIT','GOOGLE_EVENT_LIMIT','GOOGLE_PAGINATION_INCOMPLETE','OAUTH_ACCOUNT_MISMATCH','OAUTH_STATE_REPLAY_OR_EXPIRED','OAUTH_STATE_EXPIRED']);
function calendarHttp({backend,origin,callbackPath='/oauth/google/callback',callbackSession}={}){
 if(!backend?.handle||!backend?.callback||new URL(origin).protocol!=='https:')throw Error('CALENDAR_HTTP_CONFIGURATION_REQUIRED');
 const headers={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
 const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 return async request=>{
  const u=new URL(request.url);
  if(u.protocol!=='https:')return reply({success:false,code:'HTTPS_REQUIRED'},400);
  if(request.method==='GET'&&u.pathname===callbackPath){
   // The host must resolve its own HttpOnly authenticated session; query tokens forbidden.
   if(typeof callbackSession!=='function')return reply({success:false,code:'CALLBACK_AUTH_CONFIGURATION_REQUIRED'},503);
   try{const token=await callbackSession(request);await backend.callback({state:u.searchParams.get('state'),code:u.searchParams.get('code')},token);return reply({success:true,connected:true})}catch{return reply({success:false,code:'OAUTH_CALLBACK_REJECTED'},403)}
  }
  if(request.headers.get('Origin')!==origin||u.search)return reply({success:false,code:'ORIGIN_OR_ROUTE_DENIED'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  if(request.method!=='POST'||!['/api',callbackPath].includes(u.pathname))return reply({success:false,code:'ROUTE_DENIED'},405);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply({success:false,code:'JSON_REQUIRED'},400);
  try{
   const text=await request.text();if(text.length>16384)throw Error('BODY_INVALID');
   const p=JSON.parse(text);if(!p||typeof p!=='object'||Array.isArray(p))throw Error('BODY_INVALID');
   if(u.pathname===callbackPath){if(Object.keys(p).some(k=>!['token','state','code'].includes(k)))throw Error('BODY_INVALID');return reply(await backend.callback({state:p.state,code:p.code},p.token))}
   if(!ACTIONS.has(p.action)||Object.keys(p).some(k=>!['action','token','year','month','calendarIds'].includes(k)))throw Error('ACTION_UNSUPPORTED');
   return reply(await backend.handle(p.action,p.token,{year:p.year,month:p.month,calendarIds:p.calendarIds}));
  }catch(e){const code=CODES.has(e?.code)?e.code:'CALENDAR_REQUEST_REJECTED';return reply({success:false,code},code==='AUTH_REQUIRED'?401:400)}
 };
}
module.exports={calendarHttp,ACTIONS};
