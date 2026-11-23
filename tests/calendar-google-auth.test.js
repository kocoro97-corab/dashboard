'use strict';
const assert=require('node:assert/strict');
const sync=require('../js/calendar-google-sync.js');
const auth=require('../js/calendar-google-auth.js');
const transport=require('../js/calendar-google-transport.js');
const SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const good='https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope='+encodeURIComponent(SCOPE)+'&state=secure-nonce&client_id=sample.apps.googleusercontent.com&redirect_uri='+encodeURIComponent('https://example.com/oauth/callback');
async function main(){
 assert.equal(auth.state().available,false);
 assert.equal(auth.allowedUrl(good)!==null,true);
 assert.equal(auth.allowedUrl('https://evil.example/steal?'+good.split('?')[1]),null);
 assert.equal(auth.allowedUrl(good.replace('calendar.readonly','calendar.events')),null);
 assert.equal(auth.allowedUrl(good.replace('state=secure-nonce','state=')),null);
 assert.equal(transport.configured(),false);
 assert.equal(transport.initialize(),false);
 await assert.rejects(()=>transport.adapter().getStatus(),/GOOGLE_CALENDAR_NOT_CONFIGURED/);
 let calls=0;
 auth.configure({
  getStatus:async()=>({connected:true,readOnly:true,scopes:[SCOPE]}),
  beginAuthorization:async()=>({authorizationUrl:good}),
  listCalendars:async()=>[{id:'primary',name:'내 캘린더'}],
  listEvents:async()=>[{id:'e1',calendarId:'primary',date:'2026-11-23',title:'회의'}],
  revoke:async()=>{calls++}
 });
 let result=await auth.verify();assert.equal(result.connected,true);
 assert.equal(sync.status().connected,true);
 assert.equal((await sync.events(2026,11)).length,1);
 assert.equal((await auth.begin()),good);
 await auth.revoke();assert.equal(calls,1);assert.equal(sync.status().connected,false);
 auth.disconnect();assert.equal(auth.state().available,false);
 auth.configure({
  getStatus:async()=>({connected:true,readOnly:false,scopes:[SCOPE]}),
  beginAuthorization:async()=>({authorizationUrl:good}),
  listCalendars:async()=>[],listEvents:async()=>[],revoke:async()=>{}
 });
 result=await auth.verify();assert.equal(result.connected,false);
 auth.disconnect();
 console.log('Google OAuth bridge contracts PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
