(function(root){'use strict';
/* Optional Google Calendar relay integration.
 * Requires a separately deployed relay implementing the actions below.
 * Strict feature flag: absent/false => NO requests.
 * Existing MY INVEST session token is authenticated by the trusted relay,
 * which binds Google authorization to its verified server-side user.
 * Never send Google access/refresh tokens to this client.
 */
const ACTIONS=Object.freeze({status:'googleCalendarStatus',begin:'googleCalendarBegin',calendars:'googleCalendarList',events:'googleCalendarEvents',revoke:'googleCalendarRevoke'});
const configured=()=>root.MYINVEST_TRANSPORT_CONFIG?.googleCalendarReadOnly===true&&root.MYINVEST_TRANSPORT_CONFIG?.mode==='relay';
let live=false;
const err=code=>Object.assign(new Error(code),{code});
async function call(action,extra){
 if(!configured())throw err('GOOGLE_CALENDAR_NOT_CONFIGURED');
 const token=typeof root.LS==='function'?root.LS('invest_session_token'):null;
 if(!token)throw err('AUTH_REQUIRED');
 const transport=root.DashboardTransport;
 if(typeof transport?.post!=='function')throw err('GOOGLE_CALENDAR_TRANSPORT_UNAVAILABLE');
 const response=await transport.post({action,token,...extra});
 let data;
 try{data=await response.json()}catch{throw err('GOOGLE_CALENDAR_INVALID_RESPONSE')}
 if(!response.ok||!data||data.success!==true)throw err('GOOGLE_CALENDAR_REQUEST_FAILED');
 return data;
}
function adapter(){
 return Object.freeze({
  launchAuthorization:tab=>{
   if(!configured())throw err('GOOGLE_CALENDAR_NOT_CONFIGURED');
   const token=typeof root.LS==='function'?root.LS('invest_session_token'):null;
   if(!token||!tab||tab.closed||!root.document?.body)throw err('AUTH_REQUIRED');
   // Top-level POST establishes a backend HttpOnly callback cookie, even when
   // the browser blocks third-party cookies. Session token never enters a URL.
   const name='myinvest-calendar-'+root.crypto.randomUUID();tab.name=name;
   const form=root.document.createElement('form'),input=root.document.createElement('input');
   form.method='POST';form.action='https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/start';form.target=name;form.hidden=true;
   input.type='hidden';input.name='token';input.value=token;form.append(input);root.document.body.append(form);
   try{form.submit()}finally{input.value='';form.remove()}
  },
  getStatus:async()=>{
   const d=await call(ACTIONS.status);
   return {connected:d.connected===true,readOnly:d.readOnly===true,scopes:Array.isArray(d.scopes)?d.scopes.filter(s=>typeof s==='string'):[]};
  },
  beginAuthorization:async()=>{
   const d=await call(ACTIONS.begin);
   return {authorizationUrl:typeof d.authorizationUrl==='string'?d.authorizationUrl:''};
  },
  listCalendars:async()=>{
   const d=await call(ACTIONS.calendars);
   if(!Array.isArray(d.calendars))throw err('GOOGLE_CALENDAR_INVALID_RESPONSE');
   return d.calendars;
  },
  listEvents:async(args)=>{
   const d=await call(ACTIONS.events,{year:args.year,month:args.month,calendarIds:args.calendarIds});
   if(!Array.isArray(d.events))throw err('GOOGLE_CALENDAR_INVALID_RESPONSE');
   return d.events;
  },
  revoke:async()=>{await call(ACTIONS.revoke)}
 });
}
function initialize(){
 if(!configured())return false;
 if(live)return true;
 if(typeof root.MYInvestGoogleCalendarAuth?.configure!=='function')return false;
 root.MYInvestGoogleCalendarAuth.configure(adapter());live=true;return true;
}
function clear(){live=false}
const api=Object.freeze({initialize,clear,configured,adapter,ACTIONS});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestGoogleCalendarTransport=api;
})(globalThis);
