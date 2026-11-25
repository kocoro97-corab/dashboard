'use strict';
// Encrypted, short-lived MY INVEST session cookie, not a Google token.
// Set during top-level POST so mobile third-party-cookie blocking is irrelevant.
const crypto=require('node:crypto');
const NAME='__Host-myInvestCalendarCallback',AAD=Buffer.from('MYINVEST_CALENDAR_CALLBACK_V1');
function callbackSessions({key,now=()=>Date.now()}={}){
 if(!Buffer.isBuffer(key)||key.length!==32)throw Error('CALENDAR_CALLBACK_KEY_REQUIRED');
 const clear=()=>NAME+'=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0';
 function issue(token){
  if(typeof token!=='string'||!token||token.length>2048||/[\u0000-\u0020\u007f]/.test(token))throw Error('AUTH_REQUIRED');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(AAD);
  const body=Buffer.concat([cipher.update(JSON.stringify({token,expiresAt:now()+600000}),'utf8'),cipher.final()]);
  const value=Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
  return NAME+'='+value+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=600';
 }
 function resolve(request){
  try{
   const cookies=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(NAME+'='));
   if(cookies.length!==1)throw Error();const value=cookies[0].slice(NAME.length+1);
   if(!/^[A-Za-z0-9_-]{40,3500}$/.test(value))throw Error();
   const raw=Buffer.from(value,'base64url'),decipher=crypto.createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));decipher.setAAD(AAD);decipher.setAuthTag(raw.subarray(12,28));
   const r=JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));
   if(typeof r.token!=='string'||!r.token||!Number.isFinite(r.expiresAt)||r.expiresAt<=now()||r.expiresAt>now()+600000)throw Error();
   return r.token;
  }catch{throw Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'})}
 }
 return {issue,resolve,clear};
}
module.exports={callbackSessions,NAME};
