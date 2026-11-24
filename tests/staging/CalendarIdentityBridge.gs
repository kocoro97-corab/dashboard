// Optional private calendar identity extension for the EXISTING isolated GAS only.
// Owner-reviewed legacy dispatcher calls handleCalendarIdentityV1_(body).
// Does not alter login, session expiry, Users, holdings or calendars.
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

// Owner-only initialization; never added to the public Worker action allowlist.
function configureCalendarIdentityV1_(body){
  const denied=()=>jsonResponse({success:false,code:'CALENDAR_CONFIGURATION_REJECTED'});
  try{
    stagingProjectGuard_();securityEnvironmentGuard_(body);
    const props=PropertiesService.getScriptProperties();
    if(body.action!=='calendarOwnerConfigureIdentityV1'||body.confirm!=='INITIALIZE_PRIVATE_CALENDAR_IDENTITY_ONLY'||props.getProperty('APP_ENV')!=='nh-staging'||props.getProperty('NH_V2_FRESH_TEST')!=='true')return denied();
    if(typeof body.bridgeKey!=='string'||!/^[a-f0-9]{64}$/.test(body.bridgeKey)||typeof body.userKey!=='string'||!/^[a-f0-9]{64}$/.test(body.userKey)||body.bridgeKey===body.userKey)return denied();
    return securityWithLock_(function(){
      const session=securitySession_(body.token),found=session&&securityFindUser_(session.u);
      const created=found&&found.row[4],createdAt=created&&typeof created.getTime==='function'?created.getTime():NaN;
      if(!session||session.p||session.u!==props.getProperty('STAGING_TEST_USER')||!verifyAdmin(body.token)||!found||String(found.row[2])!=='approved'||!Number.isSafeInteger(createdAt)||createdAt<0||createdAt>Date.now()+30000)return denied();
      const bridge=props.getProperty('CALENDAR_IDENTITY_BRIDGE_KEY'),user=props.getProperty('CALENDAR_IDENTITY_USER_KEY');
      if((bridge||user)&&(bridge!==body.bridgeKey||user!==body.userKey))return denied();
      const changed=bridge!==body.bridgeKey||user!==body.userKey||props.getProperty('CALENDAR_IDENTITY_ENABLED')!=='true';
      if(changed)props.setProperties({CALENDAR_IDENTITY_BRIDGE_KEY:body.bridgeKey,CALENDAR_IDENTITY_USER_KEY:body.userKey,CALENDAR_IDENTITY_ENABLED:'true'},false);
      return jsonResponse({success:true,configured:true,propertiesChanged:changed,bridgeKeyHash:stagingHash_(body.bridgeKey),userKeyHash:stagingHash_(body.userKey)});
    });
  }catch(error){return denied()}
}

function calendarIdentityMetadata_(){
  const p=PropertiesService.getScriptProperties();
  return {calendarIdentityVersion:1,calendarIdentityConfigured:p.getProperty('CALENDAR_IDENTITY_ENABLED')==='true'&&/^[a-f0-9]{64}$/.test(p.getProperty('CALENDAR_IDENTITY_BRIDGE_KEY')||'')&&/^[a-f0-9]{64}$/.test(p.getProperty('CALENDAR_IDENTITY_USER_KEY')||'')};
}
