'use strict';
const assert=require('node:assert/strict');
const {googleApi}=require('../server/google-calendar-google-api.cjs');
async function main(){
 const requests=[],fetchImpl=async(url,opts={})=>{
  requests.push({url:String(url),opts});
  const ok=obj=>({ok:true,status:200,text:async()=>JSON.stringify(obj)});
  if(String(url).includes('/token'))return ok({access_token:'AT',refresh_token:'RT',expires_in:3600,scope:'https://www.googleapis.com/auth/calendar.readonly'});
  if(String(url).includes('/users/me/calendarList'))return ok({items:[{id:'primary',summary:'개인',primary:true}]});
  if(String(url).includes('/calendars/primary/events'))return ok({items:[{id:'e1',start:{date:'2026-11-23'},summary:'일정'},{id:'e2',start:{dateTime:'2026-11-23T15:30:00Z'},summary:'시간 일정'},{id:'e3',status:'cancelled',start:{date:'2026-11-24'},summary:'취소'}]});
  if(String(url).includes('/revoke'))return {ok:true,status:200};
  throw Error('Unexpected URL: '+url);
 };
 const api=googleApi({clientId:'client',clientSecret:'server-secret',fetchImpl});
 const exchanged=await api.exchange({code:'sample-code',codeVerifier:'verifier',redirectUri:'https://backend.example/callback'});
 assert.equal(exchanged.accessToken,'AT');
 assert.equal(exchanged.refreshToken,'RT');
 const refreshed=await api.refresh('RT');
 assert.equal(refreshed.accessToken,'AT');
 const calendars=await api.calendars('AT');
 assert.equal(calendars.length,1);
 const events=await api.events('AT',{calendarId:'primary',year:2026,month:11,maxResults:300});
 assert.equal(events.length,2);
 assert.equal(events[0].date,'2026-11-23');
 assert.equal(events[1].date,'2026-11-24','KST midnight rollover');
 const listUrl=requests.find(x=>x.url.includes('/calendarList')).url;
 assert.equal(new URL(listUrl).origin,'https://www.googleapis.com');
 const eventUrl=requests.find(x=>x.url.includes('/calendars/primary/events')).url;
 assert.equal(new URL(eventUrl).searchParams.get('singleEvents'),'true');
 assert.equal(new URL(eventUrl).searchParams.get('timeZone'),'Asia/Seoul');
 assert.ok(requests.every(x=>!x.url.includes('server-secret')));
 assert.ok(requests.filter(x=>x.url.includes('/calendars/')).every(x=>x.opts.headers.Authorization==='Bearer AT'));
 await api.revoke('AT');
 const revocation=requests.find(x=>x.url.includes('/revoke'));
 assert.ok(revocation.opts.signal,'revocation must have a bounded timeout');
 assert.equal(revocation.opts.cache,'no-store');
 console.log('Google HTTPS OAuth/Calendar adapter tests PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
