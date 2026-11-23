'use strict';
// Assembly only: no settings writes, binding creation or automatic activation.
const {sessionAuthority}=require('./google-calendar-session-authority.cjs');
const {service}=require('./google-calendar-oauth-service.cjs');
const {googleApi}=require('./google-calendar-google-api.cjs');
const {durableStore}=require('./google-calendar-durable-store.cjs');
const {calendarHttp}=require('./google-calendar-http.cjs');
const {callbackSessions}=require('./google-calendar-callback-session.cjs');
function calendarRuntime({gateway,storage,bridgeKey,encryptionKey,scriptHash,sheetHash,clientId,clientSecret,fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
 const cookies=callbackSessions({key:encryptionKey,now});
 const verifySession=sessionAuthority({gateway,bridgeKey,scriptHash,sheetHash,now});
 const backend=service({verifySession,store:durableStore(storage,{now}),google:googleApi({clientId,clientSecret,fetchImpl}),clientId,redirectUri:'https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/callback',secretKey:encryptionKey,now});
 const origin='https://kocoro97-corab.github.io',handler=calendarHttp({backend,origin,callbackSession:cookies.resolve});
 return async request=>{
  const url=new URL(request.url),headers={'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  if(url.origin!=='https://myinvest-v2-dev-relay.kocoro97.workers.dev')return new Response(JSON.stringify({success:false,code:'ROUTE_DENIED'}),{status:403,headers});
  if(url.pathname==='/oauth/google/start'){
   if(request.method!=='POST'||request.headers.get('Origin')!==origin||url.search||!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('Content-Type')||''))return new Response(JSON.stringify({success:false,code:'OAUTH_START_REJECTED'}),{status:403,headers});
   try{
    const text=await request.text();if(text.length>4096)throw Error();const form=new URLSearchParams(text);
    if([...form.keys()].length!==1||!form.has('token'))throw Error();
    const token=form.get('token'),result=await backend.handle('googleCalendarBegin',token);
    return new Response(null,{status:303,headers:{...headers,Location:result.authorizationUrl,'Set-Cookie':cookies.issue(token)}});
   }catch{return new Response(JSON.stringify({success:false,code:'OAUTH_START_REJECTED'}),{status:403,headers})}
  }
  if(url.pathname==='/oauth/google/callback'&&request.method==='GET'){
   const result=await handler(request),copy=new Headers(result.headers);copy.set('Set-Cookie',cookies.clear());
   if(result.status===200){copy.set('Location','https://kocoro97-corab.github.io/dashboard-v2-dev/index.html#/news');return new Response(null,{status:303,headers:copy})}
   return new Response(result.body,{status:result.status,headers:copy});
  }
  return handler(request);
 };
}
module.exports={calendarRuntime};
