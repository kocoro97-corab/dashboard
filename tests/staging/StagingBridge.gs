// ONLY for an isolated, newly created NH staging project. Never deploy to production.
const NH_STAGING_SCRIPT_ID='__SCRIPT_ID__';
const NH_STAGING_REVISION='__REVISION__';
const NH_STAGING_SOURCE_DIGEST='__SOURCE_DIGEST__';
const NH_PRODUCTION_SCRIPT_ID='1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL';
const NH_PRODUCTION_SHEET_HASH='a151f7f6339a9f699aa24cc0d8b968e7c11777c374942250dda33bed11a52c95';
const PROXY_ALLOWED_HOSTS=[];
function stagingHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(x=>('0'+(x&255).toString(16)).slice(-2)).join('')}
function stagingProjectGuard_(){
  const id=ScriptApp.getScriptId();
  if(id===NH_PRODUCTION_SCRIPT_ID||id!==NH_STAGING_SCRIPT_ID)throw new Error('STAGING_PROJECT_MISMATCH');
}
function stagingSheet_(){
  stagingProjectGuard_();const props=PropertiesService.getScriptProperties(),id=props.getProperty('STAGING_SHEET_ID');
  if(props.getProperty('APP_ENV')!=='nh-staging'||!id||stagingHash_(id)===NH_PRODUCTION_SHEET_HASH)throw new Error('STAGING_SHEET_MISMATCH');
  const sheet=SpreadsheetApp.openById(id);if(!sheet.getName().startsWith('NH-STAGING '))throw new Error('STAGING_SHEET_NAME');return sheet;
}
function securityEnvironmentGuard_(body){
  const sheet=stagingSheet_();
  if(body.action==='register')throw new Error('STAGING_REGISTRATION_DISABLED');
  if(body.action!=='appVersion'&&body.stagingBinding!==stagingHash_(sheet.getId()))throw new Error('STAGING_BINDING_REQUIRED');
}
function securityEnvironmentMetadata_(){
  const props=PropertiesService.getScriptProperties();const sheet=stagingSheet_();
  return {gatewayVersion:2,storeEngine:'account-store-v2',testEnvironment:'nh-staging',scriptHash:stagingHash_(ScriptApp.getScriptId()),sheetHash:stagingHash_(sheet.getId()),sourceDigest:NH_STAGING_SOURCE_DIGEST,revision:NH_STAGING_REVISION,storeVersion:2,nhTestCredentialsDeclared:props.getProperty('NHPLUG_KEY_USAGE')==='staging-readonly'&&!!props.getProperty('NHPLUG_APP_KEY')&&!!props.getProperty('NHPLUG_APP_SECRET')};
}
function getSheet(name){const ss=stagingSheet_();let sheet=ss.getSheetByName(name);if(!sheet){sheet=ss.insertSheet(name);if(name==='Users')sheet.appendRow(['userId','password','status','isAdmin','createdAt'])}return sheet}
function jsonResponse(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON)}
function getSession_(token){return securitySession_(token)}
function sessionUser_(token){const session=securitySession_(token);return session?session.u:null}
function deleteSession_(token){if(typeof token==='string')PropertiesService.getScriptProperties().deleteProperty('S_'+token)}
function purgeSessions_(){const props=PropertiesService.getScriptProperties(),all=props.getProperties();Object.keys(all).filter(k=>k.startsWith('S_')).forEach(k=>{try{if(Date.now()-JSON.parse(all[k]).t>300000)props.deleteProperty(k)}catch(error){props.deleteProperty(k)}})}
function verifyAdmin(token){const user=sessionUser_(token);const found=user&&securityFindUser_(user);return !!found&&String(found.row[3])==='true'}
function securityLegacyDoPost_(e){
  const body=JSON.parse(e.postData.contents);securityEnvironmentGuard_(body);
  if(body.action==='nhAccounts')return handleNhAccounts(body.token);
  if(body.action==='nhExternalQuotes')return handleNhExternalQuotes(body.token,body.codes);
  if(body.action==='nhQuotes')return handleNhQuotes(body.token,body.items);
  return jsonResponse({success:false,code:'STAGING_UNSUPPORTED',message:'지원하지 않는 테스트 요청입니다.'});
}
function securityLegacyDoGet_(){return jsonResponse({success:false,code:'STAGING_POST_ONLY'})}
// Run once in the staging editor as the owner, after configuring the properties below.
function setupNhStaging(){
  stagingProjectGuard_();const props=PropertiesService.getScriptProperties();
  if(props.getProperty('APP_ENV')&&props.getProperty('APP_ENV')!=='nh-staging')throw new Error('STAGING_ENV_MISMATCH');
  const user=props.getProperty('STAGING_TEST_USER'),password=props.getProperty('STAGING_TEST_PASSWORD');
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/.test(user||'')||!password||password.length<16||password.length>256)throw new Error('SET_STAGING_USER_AND_16_CHARACTER_PASSWORD');
  if(props.getProperty('NHPLUG_KEY_USAGE')!=='staging-readonly'||!props.getProperty('NHPLUG_APP_KEY')||!props.getProperty('NHPLUG_APP_SECRET'))throw new Error('SET_SEPARATE_NH_TEST_CREDENTIALS');
  props.setProperty('APP_ENV','nh-staging');
  if(!props.getProperty('STAGING_SHEET_ID')){const sheet=SpreadsheetApp.create('NH-STAGING PR2 '+NH_STAGING_REVISION.slice(0,12));props.setProperty('STAGING_SHEET_ID',sheet.getId())}
  const sheet=stagingSheet_(),users=getSheet('Users'),found=securityFindUser_(user);
  if(found){if(!securityVerifyPassword_(password,found.row[1])||String(found.row[2])!=='approved'||String(found.row[3])!=='true')throw new Error('EXISTING_STAGING_USER_MISMATCH')}
  else{if(users.getLastRow()>1)throw new Error('STAGING_USERS_NOT_EMPTY');users.appendRow([user,securityNewPassword_(password),'approved','true',new Date()])}
  props.deleteProperty('STAGING_TEST_PASSWORD');
  Logger.log(JSON.stringify({environment:'nh-staging',scriptId:ScriptApp.getScriptId(),spreadsheetId:sheet.getId(),revision:NH_STAGING_REVISION}));
}
