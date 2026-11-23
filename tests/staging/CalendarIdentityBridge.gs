// Optional private calendar identity extension for the EXISTING isolated GAS only.
// Owner-reviewed legacy dispatcher calls handleCalendarIdentityV1_(body).
// Does not alter login, session expiry, credentials, Users, holdings or calendars.
function handleCalendarIdentityV1_(body){
  function denied(){return jsonResponse({success:false,code:'AUTH_REQUIRED'})}
  try{
    stagingProjectGuard_();securityEnvironmentGuard_(body);
    if(body.action!=='calendarPrivateIdentityV1')return denied();
    const props=PropertiesService.getScriptProperties();
    const bridge=props.getProperty('CALENDAR_IDENTITY_BRIDGE_KEY'),userKey=props.getProperty('CALENDAR_IDENTITY_USER_KEY');
    if(props.getProperty('APP_ENV')!=='nh-staging'||props.getProperty('CALENDAR_IDENTITY_ENABLED')!=='true'||!/^[a-f0-9]{64}$/.test(bridge||'')||!/^[a-f0-9]{64}$/.test(userKey||''))return denied();
    const scriptHash=stagingHash_(ScriptApp.getScriptId()),sheetHash=stagingHash_(stagingSheet_().getId()),now=Math.floor(Date.now()/1000);
    if(body.identityAudience!=='myinvest-calendar-private-v1'||!/^[a-f0-9]{64}$/.test(body.identityChallenge||'')||!Number.isInteger(body.identityIssuedAt)||Math.abs(now-body.identityIssuedAt)>30||!/^[a-f0-9]{64}$/.test(body.identityProof||'')||typeof body.token!=='string')return denied();
    const hex=bytes=>bytes.map(x=>('0'+(x&255).toString(16)).slice(-2)).join('');
    const mac=(key,text)=>hex(Utilities.computeHmacSha256Signature(Utilities.newBlob(text).getBytes(),key.match(/../g).map(x=>{const n=parseInt(x,16);return n>127?n-256:n})));
    const request=['MYINVEST_CALENDAR_REQUEST_V1',body.identityAudience,scriptHash,sheetHash,body.identityChallenge,body.identityIssuedAt,stagingHash_(body.token)].join('\n');
    if(!securityEqual_(body.identityProof,mac(bridge,request)))return denied();
    const session=securitySession_(body.token),found=session&&securityFindUser_(session.u);
    if(!session||session.p||typeof session.u!=='string'||!session.u||!found||String(found.row[2])!=='approved')return denied();
    // Existing Users.createdAt distinguishes a recreated login from its old owner.
    // Missing/ambiguous legacy creation markers require owner review, not a guess.
    const created=found.row[4],createdAt=created&&typeof created.getTime==='function'?created.getTime():NaN;
    if(!Number.isSafeInteger(createdAt)||createdAt<0||createdAt>Date.now()+30000)return denied();
    const subject=mac(userKey,['MYINVEST_CALENDAR_SUBJECT_V1',scriptHash,sheetHash,session.u,createdAt].join('\n'));
    const identity={schemaVersion:1,audience:body.identityAudience,scriptHash,sheetHash,subject,challenge:body.identityChallenge,issuedAt:now,expiresAt:now+60};
    identity.signature=mac(bridge,['MYINVEST_CALENDAR_IDENTITY_V1',identity.audience,scriptHash,sheetHash,subject,identity.challenge,identity.issuedAt,identity.expiresAt].join('\n'));
    return jsonResponse({success:true,identity});
  }catch(error){return denied()}
}
