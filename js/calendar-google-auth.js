(function(root){'use strict';
/*
 * Bridge for a separately deployed, trusted OAuth backend.
 * Never accept/access refresh tokens, identity assertions, secrets, or raw Google
 * payloads. Backend supplies a Google consent URL and performs code exchange.
 * No backend registered => no authorization requests and no calendar API traffic.
 */
let backend=null,bound=false,revision=0,busy=false;
const REQUIRED_SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const allowedUrl=raw=>{
 try{
  const u=new URL(raw);
  return u.protocol==='https:'&&u.origin==='https://accounts.google.com'&&u.pathname==='/o/oauth2/v2/auth'&&
    u.searchParams.get('response_type')==='code'&&
    (u.searchParams.get('scope')||'').trim()===REQUIRED_SCOPE&&
    !!u.searchParams.get('state')&&!!u.searchParams.get('client_id')&&!!u.searchParams.get('redirect_uri')?u.href:null;
 }catch{return null}
};
function configure(adapter){
 if(!adapter||['getStatus','beginAuthorization','listCalendars','listEvents','revoke'].some(key=>typeof adapter[key]!=='function'))throw Error('GOOGLE_AUTH_BACKEND_INVALID');
 disconnect();backend=adapter;return true;
}
function disconnect(){revision++;bound=false;busy=false;backend=null;root.MYInvestGoogleCalendarSync?.disconnect()}
const state=()=>Object.freeze({available:!!backend,connected:bound,busy});
async function verify(){
 if(!backend)return {available:false,connected:false,code:'BACKEND_NOT_CONFIGURED'};
 const version=revision,client=backend;
 try{
  const value=await client.getStatus();
  if(version!==revision||backend!==client)throw Error('AUTH_SESSION_CHANGED');
  const connected=value?.connected===true&&value?.readOnly===true&&Array.isArray(value.scopes)&&value.scopes.length===1&&value.scopes[0]===REQUIRED_SCOPE;
  bound=connected;
  if(connected){
   root.MYInvestGoogleCalendarSync?.connect({listCalendars:()=>client.listCalendars(),listEvents:args=>client.listEvents(args)});
  }else root.MYInvestGoogleCalendarSync?.disconnect();
  return {available:true,connected,code:connected?'READ_ONLY_CONNECTED':'NOT_CONNECTED'};
 }catch{
  if(version===revision){bound=false;root.MYInvestGoogleCalendarSync?.disconnect()}
  return {available:true,connected:false,code:'BACKEND_STATUS_FAILED'};
 }
}
async function begin(){
 if(!backend)throw Error('BACKEND_NOT_CONFIGURED');
 if(busy)throw Error('AUTH_IN_PROGRESS');
 busy=true;const version=revision,client=backend;
 try{
  const answer=await client.beginAuthorization();
  if(version!==revision||backend!==client)throw Error('AUTH_SESSION_CHANGED');
  const url=allowedUrl(answer?.authorizationUrl);
  if(!url)throw Error('AUTH_URL_REJECTED');
  return url;
 }finally{if(version===revision)busy=false}
}
async function revoke(){
 if(!backend)throw Error('BACKEND_NOT_CONFIGURED');
 const version=revision,client=backend;
 await client.revoke();
 if(version!==revision||backend!==client)return;
 bound=false;root.MYInvestGoogleCalendarSync?.disconnect();
}
const api=Object.freeze({configure,disconnect,state,verify,begin,revoke,allowedUrl,scope:REQUIRED_SCOPE});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestGoogleCalendarAuth=api;
})(globalThis);
