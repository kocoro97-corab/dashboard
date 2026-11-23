'use strict';
/**
 * MY INVEST / Google Calendar backend reference service.
 * Node 20+; never ship this module to GitHub Pages.
 *
 * Dependencies are injected to avoid inventing infrastructure:
 *  verifySession(token) -> stable authenticated user id (never trust token syntax)
 *  store.putPending(hash, encryptedRecord, ttlSeconds)
 *  store.takePending(hash) -> encryptedRecord|null, ATOMIC one-time consume
 *  store.getAccount(userHash), putAccount(userHash, encryptedRecord), deleteAccount(userHash)
 *  google.exchange({code,codeVerifier,redirectUri}), google.refresh(refreshToken)
 *  google.revoke(accessToken), google.calendars(accessToken), google.events(accessToken, params)
 *
 * Persistent store MUST be private and enforce TTL, encryption key must reside
 * in secret manager, and store.takePending MUST be atomic across replicas.
 */
const crypto=require('node:crypto');
const SCOPE='https://www.googleapis.com/auth/calendar.readonly';
const MAX_EVENTS=300,MAX_CALENDARS=30,STATE_TTL=600;
const fail=(code)=>{const error=new Error(code);error.code=code;return error};
const hexHash=s=>crypto.createHash('sha256').update(s).digest('hex');
const safeDate=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s};
const identityHash=s=>hexHash('MYINVEST_GCAL_IDENTITY|'+s);
const allowedId=s=>typeof s==='string'&&s.length>0&&s.length<=200&&/^[\w.@-]+$/.test(s);
function service({verifySession,store,google,clientId,redirectUri,secretKey,now=()=>Date.now()}){
 if(typeof verifySession!=='function'||!store||!google||typeof clientId!=='string'||!clientId.trim())throw fail('CONFIG_INVALID');
 if(!/^https:\/\//.test(redirectUri||''))throw fail('REDIRECT_INVALID');
 if(!Buffer.isBuffer(secretKey)||secretKey.length!==32)throw fail('ENCRYPTION_KEY_INVALID');
 for(const m of ['putPending','takePending','getAccount','putAccount','deleteAccount'])if(typeof store[m]!=='function')throw fail('STORE_CONTRACT_INVALID');
 for(const m of ['exchange','refresh','revoke','calendars','events'])if(typeof google[m]!=='function')throw fail('GOOGLE_CONTRACT_INVALID');
 const encrypt=(obj)=>{
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',secretKey,iv);
  const raw=Buffer.from(JSON.stringify(obj),'utf8'),body=Buffer.concat([cipher.update(raw),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');
 };
 const decrypt=(value)=>{
  if(typeof value!=='string')throw fail('STORE_INVALID');
  const raw=Buffer.from(value,'base64');if(raw.length<29)throw fail('STORE_INVALID');
  const decipher=crypto.createDecipheriv('aes-256-gcm',secretKey,raw.subarray(0,12));
  decipher.setAuthTag(raw.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));
 };
 const principal=async(token)=>{
  if(typeof token!=='string'||!token)throw fail('AUTH_REQUIRED');
  const id=await verifySession(token);
  if(typeof id!=='string'||!id||id.length>200)throw fail('AUTH_REQUIRED');
  return identityHash(id);
 };
 const checkedToken=async(user)=>{
  const stored=await store.getAccount(user);if(!stored)throw fail('GOOGLE_NOT_CONNECTED');
  const record=decrypt(stored);
  if(record.scope!==SCOPE||typeof record.accessToken!=='string'||typeof record.refreshToken!=='string')throw fail('GOOGLE_SCOPE_INVALID');
  if(record.expiresAt>now()+60000)return record.accessToken;
  const updated=await google.refresh(record.refreshToken);
  if(!updated||typeof updated.accessToken!=='string'||!Number.isFinite(updated.expiresIn)||updated.expiresIn<=60)throw fail('GOOGLE_REFRESH_FAILED');
  if(updated.scope&&updated.scope!==SCOPE)throw fail('GOOGLE_SCOPE_INVALID');
  const newRecord={...record,accessToken:updated.accessToken,refreshToken:updated.refreshToken||record.refreshToken,expiresAt:now()+updated.expiresIn*1000};
  await store.putAccount(user,encrypt(newRecord));
  return newRecord.accessToken;
 };
 async function begin(token){
  const user=await principal(token),state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  await store.putPending(hexHash(state),encrypt({user,verifier,expiresAt:now()+STATE_TTL*1000}),STATE_TTL);
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id',clientId);u.searchParams.set('redirect_uri',redirectUri);
  u.searchParams.set('response_type','code');u.searchParams.set('scope',SCOPE);
  u.searchParams.set('state',state);u.searchParams.set('code_challenge',challenge);
  u.searchParams.set('code_challenge_method','S256');u.searchParams.set('access_type','offline');
  u.searchParams.set('prompt','consent');
  return {success:true,authorizationUrl:u.href};
 }
 async function callback({state,code}){
  if(typeof state!=='string'||state.length>256||typeof code!=='string'||!code||code.length>2048)throw fail('OAUTH_CALLBACK_INVALID');
  const saved=await store.takePending(hexHash(state));
  if(!saved)throw fail('OAUTH_STATE_REPLAY_OR_EXPIRED');
  const pending=decrypt(saved);
  if(pending.expiresAt<now()||typeof pending.user!=='string'||typeof pending.verifier!=='string')throw fail('OAUTH_STATE_EXPIRED');
  const data=await google.exchange({code,codeVerifier:pending.verifier,redirectUri});
  if(!data||data.scope!==SCOPE||typeof data.accessToken!=='string'||typeof data.refreshToken!=='string'||!Number.isFinite(data.expiresIn)||data.expiresIn<=60)throw fail('OAUTH_SCOPE_OR_TOKEN_INVALID');
  await store.putAccount(pending.user,encrypt({scope:SCOPE,accessToken:data.accessToken,refreshToken:data.refreshToken,expiresAt:now()+data.expiresIn*1000}));
  return {success:true}; // callback UI MUST NOT expose credentials
 }
 async function status(token){
  const user=await principal(token),stored=await store.getAccount(user);
  if(!stored)return {success:true,connected:false,readOnly:true,scopes:[]};
  const record=decrypt(stored);
  const ok=record.scope===SCOPE;
  return {success:true,connected:ok,readOnly:ok,scopes:ok?[SCOPE]:[]};
 }
 async function calendars(token){
  const user=await principal(token),accessToken=await checkedToken(user);
  const raw=await google.calendars(accessToken);
  if(!Array.isArray(raw))throw fail('GOOGLE_RESPONSE_INVALID');
  const seen=new Set(),result=[];
  for(const r of raw){if(result.length>=MAX_CALENDARS)break;if(!r||!allowedId(r.id)||seen.has(r.id))continue;seen.add(r.id);result.push({id:r.id,name:typeof r.name==='string'?r.name.slice(0,70):'내 캘린더',primary:r.primary===true})}
  return {success:true,calendars:result};
 }
 async function events(token,{year,month,calendarIds}={}){
  if(!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(month)||month<1||month>12||!Array.isArray(calendarIds)||calendarIds.length>MAX_CALENDARS||calendarIds.some(id=>!allowedId(id)))throw fail('CALENDAR_RANGE_INVALID');
  const user=await principal(token),accessToken=await checkedToken(user);
  const available=await google.calendars(accessToken);
  if(!Array.isArray(available))throw fail('GOOGLE_RESPONSE_INVALID');
  const allowed=new Set(available.filter(c=>allowedId(c?.id)).map(c=>c.id));
  if(calendarIds.some(id=>!allowed.has(id)))throw fail('CALENDAR_ACCESS_DENIED');
  const months=String(year)+'-'+String(month).padStart(2,'0'),unique=new Map();
  for(const calendarId of new Set(calendarIds)){
   const data=await google.events(accessToken,{calendarId,year,month,maxResults:MAX_EVENTS});
   if(!Array.isArray(data))throw fail('GOOGLE_RESPONSE_INVALID');
   for(const e of data.slice(0,MAX_EVENTS)){
    if(!e||!allowedId(e.id)||!safeDate(e.date)||e.date.slice(0,7)!==months||typeof e.title!=='string'||!e.title.trim())continue;
    const key=calendarId+'|'+e.id;if(!unique.has(key))unique.set(key,{id:e.id,date:e.date,title:e.title.trim().slice(0,100),calendarId});
    if(unique.size>=MAX_EVENTS)break;
   }
   if(unique.size>=MAX_EVENTS)break;
  }
  return {success:true,events:[...unique.values()].sort((a,b)=>a.date.localeCompare(b.date))};
 }
 async function revoke(token){
  const user=await principal(token),stored=await store.getAccount(user);
  // Delete local linkage even if Google revocation endpoint is unreachable.
  await store.deleteAccount(user);
  if(stored){try{const record=decrypt(stored);await google.revoke(record.accessToken)}catch{}}
  return {success:true};
 }
 async function handle(action,token,payload={}){
  switch(action){
   case 'googleCalendarStatus':return status(token);
   case 'googleCalendarBegin':return begin(token);
   case 'googleCalendarList':return calendars(token);
   case 'googleCalendarEvents':return events(token,payload);
   case 'googleCalendarRevoke':return revoke(token);
   default:throw fail('ACTION_UNSUPPORTED');
  }
 }
 return Object.freeze({handle,callback});
}
module.exports={service,SCOPE};
