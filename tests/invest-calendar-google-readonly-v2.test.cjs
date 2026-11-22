'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Google=require('../js/invest-calendar-google-readonly-v2.js');
global.MYInvestCalendarCoreV2=require('../js/invest-calendar-core-v2.js');
const ID='123456789012-abcdefghijklm123456789.apps.googleusercontent.com';
const TOKEN='ya29.longTESTTOKEN_1234567890';
function setup(options={}){
 let calls=[],config=null,revoke=[],current=options.current??Date.parse('2026-11-22T12:00:00Z');
 const result=options.result||{
  items:[{id:'alpha',summary:'FOMC',
   start:{dateTime:'2026-11-25T16:00:00+09:00'},status:'confirmed'},
   {id:'beta',summary:'결산일',start:{date:'2026-11-27'},status:'confirmed'}]
 };
 const google={accounts:{oauth2:{
  initTokenClient(v){config=v;return {requestAccessToken:(props)=>{
   calls.push({type:'authorize',props});
   if(!options.manualCallback)config.callback(options.authResponse||{
    access_token:TOKEN,expires_in:1800
   });
  }}},
  revoke(token,cb){revoke.push(token);cb()}
 }}};
 const fetcher=async(url,init)=>{
  calls.push({type:'fetch',url,init});
  if(options.networkFail)throw Error('PRIVATE_NETWORK_FAILURE');
  if(options.httpError)return {ok:false,status:options.httpError};
  return {ok:true,status:200,json:async()=>result};
 };
 const api=Google.create({clientId:options.clientId===undefined?ID:options.clientId,
  google,fetcher,clock:()=>current});
 return {api,calls,revoke,google,auth:()=>config,
  advance:delta=>{current+=delta}};
}
test('Google scope is event read-only and never grants edits, calendars sharing or orders',()=>{
 assert.equal(Google.SCOPE,'https://www.googleapis.com/auth/calendar.events.readonly');
});
test('unconfigured Google client cannot trigger authorization or remote events',async()=>{
 const x=setup({clientId:''});
 assert.equal(x.api.status().configured,false);
 assert.equal(x.api.status().connected,false);
 await assert.rejects(x.api.connect(),e=>e.code==='GOOGLE_CLIENT_NOT_CONFIGURED');
 await assert.rejects(x.api.events(2026,11),e=>e.code==='GOOGLE_CLIENT_NOT_CONFIGURED');
 assert.equal(x.calls.length,0);
});
test('Google OAuth connection is consent driven by an explicit call',async()=>{
 const x=setup();
 assert.equal(x.api.status().connected,false);
 assert.equal(x.calls.length,0);
 const r=await x.api.connect();
 assert.equal(r.connected,true);
 assert.equal(r.storage,'memory-only');
 assert.equal(x.auth().scope,Google.SCOPE);
 assert.equal(x.auth().client_id,ID);
 assert.deepEqual(x.calls[0].props,{prompt:'consent'});
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,0);
});
test('token is not returned in status or exposed as a public property',async()=>{
 const x=setup();
 await x.api.connect();
 assert.equal(JSON.stringify(x.api.status()).includes(TOKEN),false);
 assert.equal(JSON.stringify(Object.keys(x.api)).includes('token'),false);
 assert.equal(x.api.status().mayWrite,false);
});
test('Google events request uses primary calendar only, explicit date bounds and GET',async()=>{
 const x=setup();await x.api.connect();
 const r=await x.api.events(2026,11);
 const sent=x.calls.find(c=>c.type==='fetch');
 assert.ok(sent.url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?'));
 const q=new URL(sent.url).searchParams;
 assert.equal(q.get('timeMin'),'2026-11-01T00:00:00+09:00');
 assert.equal(q.get('timeMax'),'2026-12-01T00:00:00+09:00');
 assert.equal(q.get('singleEvents'),'true');
 assert.equal(q.get('orderBy'),'startTime');
 assert.equal(q.get('maxResults'),'200');
 assert.equal(sent.init.method,'GET');
 assert.equal(sent.init.credentials,'omit');
 assert.equal(sent.init.cache,'no-store');
 assert.equal(sent.init.redirect,'error');
 assert.equal(sent.init.headers.Authorization,'Bearer '+TOKEN);
 assert.equal(r.records.length,2);
 assert.equal(r.records[0].readOnly,true);
 assert.equal(r.calendar,'primary');
 assert.equal(r.authenticated,true);
 assert.equal(r.readOnly,true);
});
test('December month request rolls to following year without invalid month 13',async()=>{
 const x=setup();await x.api.connect();
 await x.api.events(2026,12);
 const url=x.calls.find(c=>c.type==='fetch').url;
 assert.equal(new URL(url).searchParams.get('timeMax'),'2027-01-01T00:00:00+09:00');
});
test('Google event mapping excludes cancelled events',async()=>{
 const x=setup({result:{items:[
  {id:'gone',summary:'취소 일정',start:{date:'2026-11-25'},status:'cancelled'},
  {id:'good',summary:'유효 일정',start:{date:'2026-11-25'},status:'confirmed'}
 ]}});
 await x.api.connect();const r=await x.api.events(2026,11);
 assert.deepEqual(r.records.map(y=>y.title),['유효 일정']);
});
test('next page token marks partial rather than silently claiming all events fetched',async()=>{
 const x=setup({result:{items:[],nextPageToken:'opaque-remaining-page'}});
 await x.api.connect();const r=await x.api.events(2026,11);
 assert.equal(r.partial,true);
});
test('expiry prevents further background requests without renewed user consent',async()=>{
 const x=setup({authResponse:{access_token:TOKEN,expires_in:120}});
 await x.api.connect();x.advance(61000);
 assert.equal(x.api.status().connected,false);
 await assert.rejects(x.api.events(2026,11),e=>e.code==='GOOGLE_AUTH_REQUIRED');
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,0);
});
test('invalid month and year rejected before any Google fetch',async()=>{
 const x=setup();await x.api.connect();
 await assert.rejects(x.api.events(2026,13),e=>e.code==='INVALID_CALENDAR_MONTH');
 await assert.rejects(x.api.events(1999,12),e=>e.code==='INVALID_CALENDAR_MONTH');
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,0);
});
test('401 and 403 responses clear client-side token without leaking user identity',async()=>{
 for(const status of [401,403]){
  const x=setup({httpError:status});await x.api.connect();
  await assert.rejects(x.api.events(2026,11),e=>e.code==='GOOGLE_ACCESS_EXPIRED_OR_DENIED');
  assert.equal(x.api.status().connected,false);
 }
});
test('network failures produce stable error codes without leaking token or exception text',async()=>{
 const x=setup({networkFail:true});await x.api.connect();
 const error=await x.api.events(2026,11).catch(e=>e);
 assert.equal(error.code,'GOOGLE_NETWORK_FAILED');
 assert.equal(String(error).includes(TOKEN),false);
 assert.equal(String(error).includes('PRIVATE_NETWORK_FAILURE'),false);
});
test('malformed or excessive Google response fails closed',async()=>{
 for(const bad of [{items:null},{items:Array(201).fill({})},{unexpected:true}]){
  const x=setup({result:bad});await x.api.connect();
  await assert.rejects(x.api.events(2026,11),e=>e.code==='GOOGLE_INVALID_RESPONSE');
 }
});
test('disconnect revokes consent and clears all in-memory authorization',async()=>{
 const x=setup();await x.api.connect();
 const result=x.api.disconnect();
 assert.equal(result.connected,false);
 assert.deepEqual(x.revoke,[TOKEN]);
 await assert.rejects(x.api.events(2026,11),e=>e.code==='GOOGLE_AUTH_REQUIRED');
});
test('rejected OAuth response fails closed without API requests',async()=>{
 const x=setup({authResponse:{error:'access_denied'}});
 await assert.rejects(x.api.connect(),e=>e.code==='GOOGLE_AUTH_DECLINED');
 assert.equal(x.api.status().connected,false);
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,0);
});
test('second authorization attempt while consent is pending is rejected',async()=>{
 const x=setup({manualCallback:true});
 const first=x.api.connect();
 await assert.rejects(x.api.connect(),e=>e.code==='GOOGLE_AUTH_IN_PROGRESS');
 x.auth().callback({access_token:TOKEN,expires_in:120});
 assert.equal((await first).connected,true);
});
test('Google API exposes no write, calendar-insert or add-event method',()=>{
 const x=setup();
 for(const forbidden of ['insert','delete','patch','update','write','createEvent'])
  assert.equal(Object.hasOwn(x.api,forbidden),false);
});
test('Google module source contains no browser storage, GAS, broker or API key',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/invest-calendar-google-readonly-v2.js'),'utf8');
 for(const forbidden of ['localStorage.', 'sessionStorage.', 'PropertiesService',
  'NH_ACCOUNT', 'placeOrder(', 'executeOrder(', 'calendar/v3/calendars/primary/events/insert'])
  assert.equal(source.includes(forbidden),false,forbidden);
});
