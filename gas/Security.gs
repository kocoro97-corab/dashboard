// Security boundary for the existing GAS backend. No spreadsheet IDs or credentials here.
const SECURITY_PASSWORD_ROUNDS = 600000;
const SECURITY_IDLE_MS = 5 * 60 * 1000;
const SECURITY_MAX_SESSION_MS = 8 * 60 * 60 * 1000;

function securityBytes_(text) {
  return new Uint8Array(Utilities.newBlob(String(text)).getBytes().map(function(b){return b & 255}));
}
function securityEqual_(a,b) {
  a=String(a);b=String(b);let diff=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return diff===0;
}
function securityHex_(bytes) {
  return Array.from(bytes).map(function(b){return ('0'+b.toString(16)).slice(-2)}).join('');
}
function securityHash_(password,salt,rounds) {
  return securityHex_(SecurityKdf.pbkdf2(SecurityKdf.sha256,securityBytes_(password),securityBytes_(salt),{c:rounds,dkLen:32}));
}
function securityNewPassword_(password) {
  const salt=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'');
  return 'pbkdf2-sha256$'+SECURITY_PASSWORD_ROUNDS+'$'+salt+'$'+securityHash_(password,salt,SECURITY_PASSWORD_ROUNDS);
}
function securityVerifyPassword_(password,stored) {
  const fields=String(stored).split('$');
  if(fields[0]!=='pbkdf2-sha256')return securityEqual_(password,stored); // migrate legacy only after a successful login
  const rounds=Number(fields[1]);
  if(fields.length!==4||!Number.isInteger(rounds)||rounds<100000||rounds>1000000||!/^\w{32,128}$/.test(fields[2])||!/^[a-f0-9]{64}$/.test(fields[3]))return false;
  return securityEqual_(securityHash_(password,fields[2],rounds),fields[3]);
}
function securityFindUser_(user) {
  const sheet=getSheet('Users'),rows=sheet.getDataRange().getValues();
  for(let i=1;i<rows.length;i++)if(String(rows[i][0]).trim()===user)return {sheet:sheet,index:i+1,row:rows[i]};
  return null;
}
function securityWithLock_(fn) {
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{return fn()}finally{lock.releaseLock()}
}
function securityLimited_(key,limit,seconds,consume) {
  return securityWithLock_(function(){
    const cache=CacheService.getScriptCache(),value=Number(cache.get(key)||0);
    if(value>=limit)return true;
    if(consume)cache.put(key,String(value+1),seconds);
    return false;
  });
}
function securityRateKey_(user) {
  return 'login_'+securityHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(user)).map(function(b){return b&255}));
}
function securityBlockedBootstrap_(user,password) {
  // Fingerprint of the retired built-in bootstrap password; do not accept it even after migration.
  return user==='admin'&&securityHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,password).map(function(b){return b&255}))==='5c06eb3d5a05a19f49476d694ca81a36344660e9d5b98e3d6a6630f31c2422e7';
}
function securityLogin_(user,password) {
  user=typeof user==='string'?user.trim():'';
  if(!user||user.length>64||typeof password!=='string'||!password||password.length>256)return jsonResponse({success:false,message:'아이디와 비밀번호를 확인하세요.'});
  const rate=securityRateKey_(user);
  // Count attempts before password hashing so parallel requests cannot bypass the limit.
  if(securityLimited_(rate,8,900,true))return jsonResponse({success:false,message:'로그인 시도가 많습니다. 15분 후 다시 시도하세요.'});
  if(securityBlockedBootstrap_(user,password))return jsonResponse({success:false,message:'초기 관리자 비밀번호는 사용할 수 없습니다. 소유자가 Users 시트에서 12자 이상 새 비밀번호를 설정한 후 로그인하세요.'});
  const found=securityFindUser_(user);
  if(!found||!securityVerifyPassword_(password,found.row[1])||String(found.row[2])!=='approved')return jsonResponse({success:false,message:'로그인 정보 또는 계정 승인 상태를 확인하세요.'});
  if(!String(found.row[1]).startsWith('pbkdf2-sha256$')){
    const hashed=securityNewPassword_(password);
    securityWithLock_(function(){
      if(String(found.sheet.getRange(found.index,2).getValue())!==String(found.row[1]))throw new Error('계정 정보가 변경됐습니다. 다시 로그인하세요.');
      found.sheet.getRange(found.index,2).setValue(hashed);
    });
  }
  CacheService.getScriptCache().remove(rate);
  const reset=password.length<12,token=securityCreateSession_(user,reset);
  return jsonResponse({success:true,token:token,isAdmin:String(found.row[3])==='true',mustChangePassword:reset});
}
function securityRegister_(user,password) {
  user=typeof user==='string'?user.trim():'';
  if(!/^[가-힣A-Za-z0-9][가-힣A-Za-z0-9_.@-]{1,63}$/.test(user)||typeof password!=='string'||password.length<12||password.length>256)return jsonResponse({success:false,message:'아이디는 2~64자, 비밀번호는 12~256자로 입력하세요.'});
  if(securityLimited_('registration_limit',20,3600,true))return jsonResponse({success:false,message:'가입 요청이 많습니다. 잠시 후 다시 시도하세요.'});
  const hash=securityNewPassword_(password);
  return securityWithLock_(function(){
    if(securityFindUser_(user))return jsonResponse({success:false,message:'이미 존재하는 아이디입니다.'});
    getSheet('Users').appendRow([user,hash,'pending','false',new Date()]);
    return jsonResponse({success:true,message:'가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.'});
  });
}
function securityCreateSession_(user,mustChange) {
  const token=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'');
  PropertiesService.getScriptProperties().setProperty('S_'+token,JSON.stringify({u:user,t:Date.now(),c:Date.now(),v:2,p:!!mustChange}));
  purgeSessions_();return token;
}
function securitySession_(token) {
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/i.test(token))return null;
  const props=PropertiesService.getScriptProperties(),raw=props.getProperty('S_'+token);let s;
  try{s=JSON.parse(raw||'null')}catch(e){return null}
  if(!s)return null;
  if(s.v!==2||typeof s.u!=='string'||!Number.isFinite(s.t)||!Number.isFinite(s.c)||Date.now()-s.t>SECURITY_IDLE_MS||Date.now()-s.c>SECURITY_MAX_SESSION_MS||s.t>Date.now()+1000){props.deleteProperty('S_'+token);return null}
  const user=securityFindUser_(s.u);
  if(!user||String(user.row[2])!=='approved'){props.deleteProperty('S_'+token);return null}
  s.t=Date.now();props.setProperty('S_'+token,JSON.stringify(s));return s;
}
function securityChangePassword_(token,current,password) {
  const session=securitySession_(token);
  if(!session)return jsonResponse({success:false,message:'다시 로그인하세요.'});
  if(typeof current!=='string'||current.length>256||typeof password!=='string'||password.length<12||password.length>256||password===current)return jsonResponse({success:false,message:'기존 비밀번호와 다른 12~256자 비밀번호를 입력하세요.'});
  if(securityLimited_(securityRateKey_(session.u)+'_change',8,900,true))return jsonResponse({success:false,message:'비밀번호 변경 시도가 많습니다. 잠시 후 다시 시도하세요.'});
  const found=securityFindUser_(session.u);
  if(!found||!securityVerifyPassword_(current,found.row[1]))return jsonResponse({success:false,message:'현재 비밀번호를 확인하세요.'});
  const hash=securityNewPassword_(password);
  return securityWithLock_(function(){
    if(String(found.sheet.getRange(found.index,2).getValue())!==String(found.row[1]))throw new Error('계정 정보가 변경됐습니다. 다시 로그인하세요.');
    found.sheet.getRange(found.index,2).setValue(hash);
    const props=PropertiesService.getScriptProperties(),all=props.getProperties();
    Object.keys(all).filter(function(k){return k.startsWith('S_')}).forEach(function(k){try{if(JSON.parse(all[k]).u===session.u)props.deleteProperty(k)}catch(e){}});
    // Caller receives a fresh token; every old session is revoked.
    const next=(Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,'');
    props.setProperty('S_'+next,JSON.stringify({u:session.u,t:Date.now(),c:Date.now(),v:2,p:false}));
    return jsonResponse({success:true,token:next,isAdmin:String(found.row[3])==='true'});
  });
}
function securitySafeHolding_(x) {
  return x&&typeof x==='object'&&['ISA','PENSION','IRP'].includes(x.accountType)&&
    typeof x.code==='string'&&(!x.code||/^[A-Z0-9]{6}$/.test(x.code))&&
    typeof x.name==='string'&&x.name.trim().length>0&&x.name.length<=60&&!/^[\s]*[=+@\-\t\r\n]/.test(x.name)&&
    typeof x.quantity==='number'&&Number.isFinite(x.quantity)&&x.quantity>=0&&
    typeof x.avgPrice==='number'&&Number.isFinite(x.avgPrice)&&x.avgPrice>=0&&
    (!x.source||(typeof x.source==='string'&&x.source.length<=20&&!/^[\s]*[=+@\-\t\r\n]/.test(x.source)));
}
function doPost(e) {
  try{
    const text=(e&&e.postData&&e.postData.contents)||'{}';
    if(text.length>200000)return jsonResponse({success:false,message:'요청이 너무 큽니다.'});
    const body=JSON.parse(text);
    if(!body||Array.isArray(body)||typeof body!=='object')return jsonResponse({success:false,message:'잘못된 요청입니다.'});
    const action=body.action;
    if(action==='appVersion')return jsonResponse({success:true,version:'v10-security',securityVersion:1,features:['nhAccounts','externalHoldings','nhExternalQuotes','changePassword'],readOnly:true});
    if(action==='login')return securityLogin_(body.user,body.pass);
    if(action==='register')return securityRegister_(body.user,body.pass);
    if(action==='logout'){deleteSession_(body.token);return jsonResponse({success:true})}
    if(action==='changePassword')return securityChangePassword_(body.token,body.currentPass,body.newPass);
    const session=securitySession_(body.token);
    if(!session)return jsonResponse({success:false,message:'로그인이 필요합니다. 다시 로그인하세요.'});
    if(action==='sessionInfo')return jsonResponse({success:true,isAdmin:verifyAdmin(body.token),mustChangePassword:!!session.p});
    if(session.p)return jsonResponse({success:false,message:'12자 이상 비밀번호로 변경한 후 이용하세요.',mustChangePassword:true});
    if(action==='externalHoldings')return handleExternalHoldingsV2(body.token);
    if(action==='externalHistory')return handleExternalHistory(body.token);
    if(action==='restoreExternalHoldings')return handleRestoreExternalHoldings(body.token,body.snapshotId,body.expectedRevision,body.confirmReplace);
    if(action==='nhAccounts'&&!verifyAdmin(body.token))return jsonResponse({success:false,message:'소유자 NH 계좌 잔고는 관리자만 조회할 수 있습니다.'});
    if(action==='protectedHoldings'){
      if(!verifyAdmin(body.token))return jsonResponse({success:false,message:'소유자 보유목록은 관리자만 조회할 수 있습니다.'});
      return jsonResponse({success:true,holdings:typeof SECURITY_PROTECTED_HOLDINGS==='undefined'?[]:SECURITY_PROTECTED_HOLDINGS});
    }
    if(action==='saveExternalHoldings'){
      if(!Array.isArray(body.holdings)||body.holdings.length>150||!body.holdings.every(securitySafeHolding_)||/^[\s]*[=+@\-\t\r\n]/.test(session.u))return jsonResponse({success:false,message:'저장할 종목 형식이 올바르지 않습니다. 기존 자료는 유지됩니다.'});
      return handleSaveExternalHoldingsV2(body.token,body.holdings,body.expectedRevision,body.confirmReplace);
    }
    return securityLegacyDoPost_(e);
  }catch(error){return jsonResponse({success:false,message:'요청을 처리하지 못했습니다. 입력값과 연결 상태를 확인하세요.'})}
}
function doGet(e) {
  const url=String((e&&e.parameter&&e.parameter.url)||'');
  const match=/^https:\/\/([a-z0-9.-]+)(?::443)?(?:\/|\?|$)/i.exec(url);
  if(!match||/[\u0000-\u0020\\]/.test(url)||PROXY_ALLOWED_HOSTS.indexOf(match[1].toLowerCase())<0)return jsonResponse({error:'허용되지 않은 주소입니다.'});
  return securityLegacyDoGet_(e);
}
