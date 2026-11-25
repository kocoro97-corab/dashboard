'use strict';
// Private server only. Reuses the verified isolated GAS gateway, never public sessionInfo.
const crypto=require('node:crypto');
const AUDIENCE='myinvest-calendar-private-v1',ACTION='calendarPrivateIdentityV1';
const fail=()=>Object.assign(new Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const mac=(key,value)=>crypto.createHmac('sha256',key).update(value).digest('hex');
const responseText=r=>['MYINVEST_CALENDAR_IDENTITY_V1',r.audience,r.scriptHash,r.sheetHash,r.subject,r.challenge,r.issuedAt,r.expiresAt].join('\n');
function sessionAuthority({gateway,bridgeKey,scriptHash,sheetHash,now=()=>Date.now(),random=()=>crypto.randomBytes(32).toString('hex')}={}){
 if(!gateway||typeof gateway.verify!=='function'||typeof gateway.post!=='function'||!Buffer.isBuffer(bridgeKey)||bridgeKey.length!==32||![scriptHash,sheetHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('CALENDAR_AUTHORITY_CONFIG_REQUIRED');
 return async token=>{
  if(typeof token!=='string'||!token||token.length>2048||/[\u0000-\u0020\u007f]/.test(token))throw fail();
  try{
   const metadata=await gateway.verify();
   if(metadata?.freshTestEnvironment!==true||metadata.testEnvironment!=='nh-staging'||metadata.scriptHash!==scriptHash||metadata.sheetHash!==sheetHash)throw fail();
   const challenge=random(),issuedAt=Math.floor(now()/1000);
   if(!/^[a-f0-9]{64}$/.test(challenge))throw fail();
   const proof=mac(bridgeKey,['MYINVEST_CALENDAR_REQUEST_V1',AUDIENCE,scriptHash,sheetHash,challenge,issuedAt,hash(token)].join('\n'));
   const result=await gateway.post({action:ACTION,token,identityAudience:AUDIENCE,identityChallenge:challenge,identityIssuedAt:issuedAt,identityProof:proof});
   const r=result?.identity,fields=['schemaVersion','audience','scriptHash','sheetHash','subject','challenge','issuedAt','expiresAt','signature'];
   if(result?.success!==true||!r||Array.isArray(r)||Object.keys(r).length!==fields.length||Object.keys(r).some(k=>!fields.includes(k)))throw fail();
   const receivedAt=Math.floor(now()/1000);
   if(r.schemaVersion!==1||r.audience!==AUDIENCE||r.scriptHash!==scriptHash||r.sheetHash!==sheetHash||r.challenge!==challenge||!/^[a-f0-9]{64}$/.test(r.subject)||!/^[a-f0-9]{64}$/.test(r.signature)||!Number.isInteger(r.issuedAt)||!Number.isInteger(r.expiresAt)||r.issuedAt<issuedAt-30||r.issuedAt>receivedAt+30||r.expiresAt<=receivedAt||r.expiresAt-r.issuedAt!==60)throw fail();
   const expected=Buffer.from(mac(bridgeKey,responseText(r)),'hex'),actual=Buffer.from(r.signature,'hex');
   if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))throw fail();
   return r.subject;
  }catch{throw fail()}
 };
}
module.exports={sessionAuthority,AUDIENCE,ACTION};
