/* MY INVEST V2 — user-driven, ephemeral Google Web OAuth client configuration.
 * The Web Client ID is PUBLIC, not an access token or client secret.
 * NEVER send it to GAS/NH, log it, or store it in browser persistence.
 * The Google SDK is fetched ONLY after explicit "prepare" user action.
 * Calling prepare only installs the SDK; it never prompts for consent.
 */
(function(root){
'use strict';
const SCRIPT='https://accounts.google.com/gsi/client';
const ID=/^[0-9]{8,32}-[A-Za-z0-9_-]{12,80}\.apps\.googleusercontent\.com$/;
function err(code){return Object.assign(new Error(code),{code})}
function create({host=root,doc=host.document}={}){
 let clientId=null,ready=false,active=null;
 const sdkReady=()=>typeof host.google?.accounts?.oauth2?.initTokenClient==='function';
 const status=()=>Object.freeze({
  configured:ready&&!!clientId,
  sdkReady:ready&&sdkReady(),
  storage:'memory-only',googleConnected:false,consentGranted:false,
  sdkSource:SCRIPT,hasClientId:!!clientId
 });
 function reset(){clientId=null;ready=false}
 function prepare(value){
  if(typeof value!=='string'||!ID.test(value))return Promise.reject(err('GOOGLE_PUBLIC_WEB_CLIENT_ID_INVALID'));
  if(active)return Promise.reject(err('GOOGLE_SDK_PREPARE_IN_PROGRESS'));
  if(sdkReady()){
   clientId=value;ready=true;
   return Promise.resolve(Object.freeze({clientId,ready:true,consentGranted:false}));
  }
  if(!doc?.head?.appendChild||!doc.createElement)
   return Promise.reject(err('GOOGLE_SDK_DOCUMENT_UNAVAILABLE'));
  const existing=doc.getElementById?.('myinvest-gsi-oauth-v1');
  // Don't attach a second handler to an unknown/possibly untrusted script.
  if(existing)return Promise.reject(err('GOOGLE_SDK_LOAD_PENDING'));
  const tag=doc.createElement('script');
  tag.id='myinvest-gsi-oauth-v1';tag.async=true;tag.src=SCRIPT;
  tag.referrerPolicy='no-referrer';
  return new Promise((resolve,reject)=>{
   active={resolve,reject};
   let completed=false;
   const finish=(ok)=>{
    if(completed)return;
    completed=true;tag.onload=null;tag.onerror=null;
    const pending=active;active=null;
    if(ok&&sdkReady()){
     clientId=value;ready=true;
     pending?.resolve(Object.freeze({clientId,ready:true,consentGranted:false}));
    }else{
     clientId=null;ready=false;
     try{tag.remove()}catch{}
     pending?.reject(err('GOOGLE_SDK_LOAD_FAILED'));
    }
   };
   tag.onload=()=>finish(true);
   tag.onerror=()=>finish(false);
   try{doc.head.appendChild(tag)}catch{finish(false)}
  });
 }
 return Object.freeze({prepare,status,reset,validateClientId:v=>
  typeof v==='string'&&ID.test(v)});
}
const api=Object.freeze({create,SCRIPT,validateClientId:v=>
 typeof v==='string'&&ID.test(v)});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestGoogleOAuthSetupV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
