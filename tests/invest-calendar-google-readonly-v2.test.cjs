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
  if(url.includes('/users/me/calendarList')){
   return {ok:true,status:200,json:async()=>options.calendarListResult||{
    items:[{id:'personal@example.com',summary:'일정',primary:true,accessRole:'owner'},
     {id:'ko.south_korea#holiday@group.v.calendar.google.com',
      summary:'대한민국의 휴일',primary:false,accessRole:'reader'},
     {id:'private-finance@example.com',summary:'회계',primary:false,accessRole:'owner'}
    ]}};
  }
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
 assert.equal(x.auth().scope,Google.AUTH_SCOPE);
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

test('Google calendar list requires only calendarlist readonly and events readonly scopes',()=>{
 assert.equal(Google.LIST_SCOPE,
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly');
 assert.equal(Google.AUTH_SCOPE,Google.SCOPE+' '+Google.LIST_SCOPE);
 assert.ok(!Google.AUTH_SCOPE.includes('calendar.events '));
});
test('subscribed Republic of Korea holiday calendar can be discovered without fetching events',async()=>{
 const x=setup();await x.api.connect();
 const result=await x.api.listCalendars();
 assert.equal(result.calendars.length,3);
 const holiday=result.calendars.find(c=>c.holiday);
 assert.ok(holiday);
 assert.equal(holiday.name,'대한민국의 휴일');
 assert.ok(holiday.id.includes('#holiday'));
 assert.equal(holiday.readOnly,true);
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,1);
 assert.ok(x.calls.find(c=>c.type==='fetch').url.includes('/users/me/calendarList?'));
});
test('holiday subscribed calendar must be discovered before its events can be queried',async()=>{
 const x=setup();await x.api.connect();
 await assert.rejects(
  x.api.events(2026,12,'ko.south_korea#holiday@group.v.calendar.google.com'),
  e=>e.code==='GOOGLE_CALENDAR_NOT_SELECTED'
 );
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,0);
});
test('selected Google holiday calendar reads only that calendar and classifies its provenance',async()=>{
 const x=setup({result:{items:[
  {id:'christmas',summary:'기독탄신일',start:{date:'2026-12-25'},status:'confirmed'}
 ]}});
 await x.api.connect();
 const list=await x.api.listCalendars();
 const id=list.calendars.find(c=>c.holiday).id;
 const result=await x.api.events(2026,12,id);
 assert.equal(result.calendar,id);
 assert.equal(result.records.length,1);
 assert.equal(result.records[0].sourceCalendar,id);
 assert.equal(result.records[0].sourceLabel,'대한민국의 휴일');
 assert.equal(result.records[0].holidayCalendar,true);
 assert.equal(result.records[0].readOnly,true);
 assert.equal(result.records[0].sourceStatus,'GOOGLE_USER_CALENDAR');
 const request=x.calls.filter(c=>c.type==='fetch')[1];
 assert.ok(request.url.includes(encodeURIComponent(id)+'/events?'));
 assert.equal(request.init.method,'GET');
 assert.equal(result.records[0].title,'기독탄신일');
});
test('private secondary calendars are never automatically fetched with holiday calendar',async()=>{
 const x=setup();await x.api.connect();
 await x.api.listCalendars();
 await x.api.events(2026,12,'ko.south_korea#holiday@group.v.calendar.google.com');
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,2);
 assert.ok(!x.calls.some(c=>c.url?.includes('private-finance')));
});
test('event results cached for five minutes avoid duplicate monthly Google reads',async()=>{
 const x=setup();await x.api.connect();
 await x.api.events(2026,11);
 const reused=await x.api.events(2026,11);
 assert.equal(reused.cached,true);
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,1);
});
test('calendar list cache respects partial results and avoids repeat network calls',async()=>{
 const x=setup({calendarListResult:{items:[],nextPageToken:'future-page'}});
 await x.api.connect();
 const a=await x.api.listCalendars();
 const b=await x.api.listCalendars();
 assert.equal(a.partial,true);assert.equal(b.partial,true);
 assert.equal(b.cached,true);
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,1);
});
test('disconnect resets selected calendar access and cached records',async()=>{
 const x=setup();await x.api.connect();
 const cal=(await x.api.listCalendars()).calendars.find(c=>c.holiday).id;
 await x.api.events(2026,11,cal);
 x.api.disconnect();
 await x.api.connect();
 await assert.rejects(x.api.events(2026,11,cal),e=>e.code==='GOOGLE_CALENDAR_NOT_SELECTED');
});
test('invalid Google calendar ID fails before network access',async()=>{
 const x=setup();await x.api.connect();await x.api.listCalendars();
 await assert.rejects(x.api.events(2026,12,'unknown-calendar@not-listed'),
  e=>e.code==='GOOGLE_CALENDAR_NOT_SELECTED');
 assert.equal(x.calls.filter(c=>c.type==='fetch').length,1);
});
test('holiday read-only scope never gives create, update, patch or delete methods',()=>{
 const x=setup();for(const k of ['createEvent','deleteEvent','updateEvent','insert'])
  assert.equal(Object.hasOwn(x.api,k),false);
});
