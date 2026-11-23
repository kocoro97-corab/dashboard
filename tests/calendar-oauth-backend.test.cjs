'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {service,SCOPE}=require('../server/google-calendar-oauth-service.cjs');
async function main(){
 let clock=Date.UTC(2026,10,23),exchanges=0,refreshes=0,revocations=0,calReads=0;
 const pending=new Map(),accounts=new Map(),store={
  async putPending(k,v){pending.set(k,v)},
  async takePending(k){const v=pending.get(k);pending.delete(k);return v},
  async getAccount(k){return accounts.get(k)},
  async putAccount(k,v){accounts.set(k,v)},
  async deleteAccount(k){accounts.delete(k)}
 };
 const serviceClient=service({
  verifySession:async token=>token==='good-session'?'user-alpha':null,
  store,secretKey:crypto.randomBytes(32),clientId:'my-client.apps.googleusercontent.com',
  redirectUri:'https://backend.example/oauth/google/callback',now:()=>clock,
  google:{
   exchange:async ({code,codeVerifier,redirectUri})=>{exchanges++;assert.equal(redirectUri,'https://backend.example/oauth/google/callback');assert.ok(codeVerifier.length>=43);return {scope:SCOPE,accessToken:'access-token',refreshToken:'refresh-token',expiresIn:3600}},
   refresh:async()=>{refreshes++;return {accessToken:'new-access-token',expiresIn:3600}},
   revoke:async()=>{revocations++},
   calendars:async()=>{calReads++;return [{id:'primary',name:'Primary',primary:true},{id:'shared',name:'Shared'}]},
   events:async(_,params)=>[{id:'e1',date:'2026-11-23',title:'Meeting',calendarId:params.calendarId},{id:'outside',date:'2026-12-23',title:'Wrong month',calendarId:params.calendarId}]
  }
 });
 await assert.rejects(()=>serviceClient.handle('googleCalendarStatus','bad-session'),/AUTH_REQUIRED/);
 const start=await serviceClient.handle('googleCalendarBegin','good-session');
 assert.equal(start.success,true);
 const url=new URL(start.authorizationUrl);
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('scope'),SCOPE);
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.ok(url.searchParams.get('state'));
 assert.equal(pending.size,1);
 await serviceClient.callback({state:url.searchParams.get('state'),code:'authorization-code'});
 assert.equal(exchanges,1);
 assert.equal(pending.size,0);
 await assert.rejects(()=>serviceClient.callback({state:url.searchParams.get('state'),code:'authorization-code'}),/OAUTH_STATE_REPLAY_OR_EXPIRED/);
 const accountBlob=[...accounts.values()][0];assert.equal(accountBlob.includes('access-token'),false,'encrypted token at rest');
 const status=await serviceClient.handle('googleCalendarStatus','good-session');
 assert.equal(status.connected,true);assert.deepEqual(status.scopes,[SCOPE]);
 assert.equal((await serviceClient.handle('googleCalendarList','good-session')).calendars.length,2);
 await assert.rejects(()=>serviceClient.handle('googleCalendarEvents','good-session',{year:2026,month:11,calendarIds:['unowned']}),/CALENDAR_ACCESS_DENIED/);
 const result=await serviceClient.handle('googleCalendarEvents','good-session',{year:2026,month:11,calendarIds:['primary']});
 assert.equal(result.events.length,1);
 assert.equal(result.events[0].title,'Meeting');
 clock+=3600000;await serviceClient.handle('googleCalendarList','good-session');
 assert.equal(refreshes,1);
 await serviceClient.handle('googleCalendarRevoke','good-session');
 assert.equal(revocations,1);assert.equal(accounts.size,0);
 await assert.rejects(()=>serviceClient.handle('googleCalendarList','good-session'),/GOOGLE_NOT_CONNECTED/);
 await assert.rejects(()=>serviceClient.handle('googleCalendarCreate','good-session'),/ACTION_UNSUPPORTED/);
 console.log('OAuth backend security tests PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
