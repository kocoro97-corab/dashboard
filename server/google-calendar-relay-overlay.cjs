'use strict';
// Wrap the owner's verified CURRENT Worker module; never replace it with an old checkout.
const crypto=require('node:crypto');
const {ACTIONS}=require('./google-calendar-http.cjs');
const {calendarSettings}=require('./google-calendar-settings.cjs');
const {calendarRuntimeFromSettings}=require('./google-calendar-runtime.cjs');
const ORIGIN='https://kocoro97-corab.github.io',HOST='https://myinvest-v2-dev-relay.kocoro97.workers.dev';
const PRIVATE_OBJECT='isolated-calendar-private-v1',QUOTA_OBJECT='isolated-relay-gate-v1';
const oauthPaths=new Set(['/oauth/google/start','/oauth/google/callback']);
async function bodyText(request,max){
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('BODY_LIMIT');chunks.push(Buffer.from(value))}return Buffer.concat(chunks).toString('utf8')}
 catch(e){reader.cancel().catch(()=>{});throw e}
}
function createCalendarRelayOverlay({legacy,runtimeFactory=calendarRuntimeFromSettings}={}){
 if(typeof legacy?.default?.fetch!=='function'||typeof legacy.RelayGate!=='function'||typeof legacy.configuration!=='function'||typeof legacy.createGateway!=='function')throw Error('CURRENT_WORKER_EXPORTS_REQUIRED');
 class RelayGate extends legacy.RelayGate{
  constructor(state,env){super(state,env);this.calendarStorage=state.storage;this.calendarEnv=env;this.calendarProof={}}
  async fetch(request){
   if(new URL(request.url).origin!==HOST)return super.fetch(request);
   if(this.calendarEnv.GOOGLE_CALENDAR_ENABLED!=='true')return new Response(null,{status:503});
   try{
    const config=legacy.configuration(this.calendarEnv),gateway=legacy.createGateway(config,fetch,this.calendarProof,AbortSignal.timeout(10000));
    const handler=runtimeFactory({env:this.calendarEnv,gateway,storage:this.calendarStorage});
    if(!handler)throw Error();return await handler(request);
   }catch{return new Response(JSON.stringify({success:false,code:'CALENDAR_RUNTIME_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}})}
  }
 }
 const worker={async fetch(request,env,ctx){
  if(env.GOOGLE_CALENDAR_ENABLED!=='true')return legacy.default.fetch(request,env,ctx);
  const url=new URL(request.url);let body=null;
  if(url.pathname==='/api'&&request.method==='POST'){
   try{body=JSON.parse(await bodyText(request.clone(),16384))}catch{}
  }
  const privateRequest=oauthPaths.has(url.pathname)||body&&ACTIONS.has(body.action);
  if(!privateRequest){
   const response=await legacy.default.fetch(request,env,ctx);
   // Capability is advertised only by this installed overlay with valid settings.
   if(url.origin===HOST&&body?.action==='appVersion'&&response.ok){
    try{const data=await response.clone().json();if(data.success===true&&calendarSettings(env)){const headers=new Headers(response.headers);headers.delete('Content-Length');headers.delete('ETag');return new Response(JSON.stringify({...data,developmentGoogleCalendarReadOnly:true}),{status:response.status,headers})}}catch{}
   }
   return response;
  }
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Referrer-Policy':'no-referrer'};
  if(request.headers.get('Origin')===ORIGIN)headers['Access-Control-Allow-Origin']=ORIGIN;
  const reply=(code,status)=>new Response(JSON.stringify({success:false,code}),{status,headers});
  let gate,lease;
  try{
   if(url.origin!==HOST) return reply('RELAY_PATH_DENIED',403);
   const config=legacy.configuration(env);if(config.host!==new URL(HOST).hostname)throw Error();calendarSettings(env);
   let forwarded=request;
   if(url.pathname==='/api'){
    if(url.search||request.headers.get('Origin')!==ORIGIN||request.headers.get('X-MyInvest-Dev-Client')!=='dashboard-v2-dev')return reply('DEV_PAGE_REQUIRED',403);
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply('JSON_REQUIRED',400);
    if(!body||Array.isArray(body)||typeof body!=='object'||'token' in body)return reply('RELAY_BAD_REQUEST',400);
    const bearer=request.headers.get('Authorization');if(!/^Bearer [a-fA-F0-9]{64}$/.test(bearer||''))return reply('AUTH_REQUIRED',401);
    const copy=new Headers(request.headers);copy.delete('Content-Length');copy.delete('Authorization');
    forwarded=new Request(request.url,{method:'POST',headers:copy,body:JSON.stringify({...body,token:bearer.slice(7)})});
   }else if(url.pathname==='/oauth/google/start'){
    if(request.method!=='POST'||url.search||request.headers.get('Origin')!==ORIGIN)return reply('OAUTH_START_REJECTED',403);
    if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('Content-Type')||''))return reply('OAUTH_START_REJECTED',403);
    try{await bodyText(request.clone(),4096)}catch{return reply('RELAY_REQUEST_SIZE',413)}
   }else if(request.method!=='GET')return reply('OAUTH_CALLBACK_REJECTED',403);
   const ip=request.headers.get('CF-Connecting-IP');if(!ip)throw Error();
   const ipHash=crypto.createHash('sha256').update(config.expected.scriptHash+'|'+ip).digest('hex');
   gate=env.GATE.get(env.GATE.idFromName(QUOTA_OBJECT));
   const quota=await gate.fetch('https://gate/acquire',{method:'POST',body:JSON.stringify({ipHash,login:false})});
   if(!quota.ok)return reply(quota.status===429?'RELAY_RATE_LIMIT':'RELAY_BUSY',quota.status===429?429:503);
   lease=(await quota.json()).lease;if(typeof lease!=='string'||!lease)throw Error();
   const target=env.GATE.get(env.GATE.idFromName(PRIVATE_OBJECT));
   return await target.fetch(forwarded);
  }catch{return reply('CALENDAR_RUNTIME_UNAVAILABLE',503)}
  finally{if(gate&&lease)await gate.fetch('https://gate/release',{method:'POST',body:JSON.stringify({lease})}).catch(()=>{})}
 }};
 return {worker,RelayGate};
}
module.exports={createCalendarRelayOverlay,PRIVATE_OBJECT,QUOTA_OBJECT};
