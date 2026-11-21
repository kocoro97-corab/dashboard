const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const SCRIPT='SYNTHETIC_STAGING_SCRIPT_ID_123456';const SHEET='SYNTHETIC_STAGING_SHEET_ID_123456';
function staging(){
  const properties=new Map([['APP_ENV','nh-staging'],['STAGING_SHEET_ID',SHEET],['NHPLUG_KEY_USAGE','staging-readonly'],['NHPLUG_APP_KEY','SYNTHETIC_ONLY_KEY'],['NHPLUG_APP_SECRET','SYNTHETIC_ONLY_SECRET']]);
  let opens=0,scriptId=SCRIPT,name='NH-STAGING synthetic';
  const ctx=vm.createContext({ScriptApp:{getScriptId:()=>scriptId},SpreadsheetApp:{openById:()=>{opens++;return {getId:()=>SHEET,getName:()=>name}}},PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,text)=>[...crypto.createHash('sha256').update(text).digest()]}});
  const code=fs.readFileSync(path.join(__dirname,'staging/StagingBridge.gs'),'utf8').replace('__SCRIPT_ID__',SCRIPT).replace('__REVISION__','a'.repeat(40)).replace('__SOURCE_DIGEST__','b'.repeat(64));
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/NhSnapshotV2.gs'),'utf8'),ctx);vm.runInContext(code,ctx);
  return {ctx,properties,opens:()=>opens,setScript:value=>scriptId=value,setName:value=>name=value};
}
test('production script ID is refused before any spreadsheet access',()=>{
  const s=staging();s.setScript('1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL');
  assert.throws(()=>s.ctx.stagingSheet_(),/PROJECT_MISMATCH/);assert.equal(s.opens(),0);
});
test('production sheet fingerprint is refused before opening it',()=>{
  const s=staging();s.ctx.Utilities.computeDigest=()=>[...Buffer.from('a151f7f6339a9f699aa24cc0d8b968e7c11777c374942250dda33bed11a52c95','hex')];
  assert.throws(()=>s.ctx.stagingSheet_(),/SHEET_MISMATCH/);assert.equal(s.opens(),0);
});
test('every authenticated request must bind the expected staging sheet; public registration is disabled',()=>{
  const s=staging();assert.throws(()=>s.ctx.securityEnvironmentGuard_({action:'login'}),/BINDING_REQUIRED/);
  const binding=s.ctx.stagingHash_(SHEET);assert.doesNotThrow(()=>s.ctx.securityEnvironmentGuard_({action:'login',stagingBinding:binding}));
  assert.throws(()=>s.ctx.securityEnvironmentGuard_({action:'register',stagingBinding:binding}),/REGISTRATION_DISABLED/);
  s.setName('Other spreadsheet');assert.throws(()=>s.ctx.stagingSheet_(),/SHEET_NAME/);
});
test('metadata contains only staging fingerprints and readiness flags, not credentials',()=>{
  const s=staging();s.ctx.securityEnvironmentGuard_({action:'appVersion'});const metadata=s.ctx.securityEnvironmentMetadata_();
  assert.equal(metadata.testEnvironment,'nh-staging');assert.equal(metadata.nhTestCredentialsDeclared,true);assert.equal(metadata.storeVersion,2);
  const text=JSON.stringify(metadata);assert.ok(!text.includes('SYNTHETIC_ONLY'));assert.ok(!text.includes(SHEET));
});

test('fresh setup refuses pre-bound project before creating or changing any Sheet',()=>{
  const s=staging();let creates=0;s.ctx.SpreadsheetApp.create=()=>{creates++;throw Error('must not create')};
  assert.throws(()=>s.ctx.setupNhFreshV2(),/FRESH_UNBOUND_PROJECT_REQUIRED/);assert.equal(creates,0);
});
test('fresh setup validates private settings before creating a new Sheet',()=>{
  const s=staging();s.properties.delete('APP_ENV');s.properties.delete('STAGING_SHEET_ID');let creates=0;
  s.ctx.SpreadsheetApp.create=()=>{creates++;throw Error('must not create')};
  assert.throws(()=>s.ctx.setupNhFreshV2(),/PRIVATE_TEST_SETTINGS_REQUIRED/);assert.equal(creates,0);
});
test('fresh setup binds only the newly created Sheet and then initializes its dedicated user',()=>{
  const s=staging();s.properties.delete('APP_ENV');s.properties.delete('STAGING_SHEET_ID');
  s.properties.set('STAGING_TEST_USER','synthetic');s.properties.set('STAGING_TEST_PASSWORD','SYNTHETIC_NEW_PASSWORD_123');
  s.ctx.PropertiesService.getScriptProperties=()=>({getProperty:k=>s.properties.get(k),setProperty:(k,v)=>s.properties.set(k,v)});
  let creates=0,initialized=false;s.ctx.SpreadsheetApp.create=()=>{creates++;return {getId:()=>SHEET}};
  s.ctx.setupNhStaging=()=>{initialized=true;assert.equal(s.properties.get('STAGING_SHEET_ID'),SHEET);assert.equal(s.properties.get('NH_V2_FRESH_TEST'),'true')};
  s.ctx.setupNhFreshV2();assert.equal(creates,1);assert.equal(initialized,true);
});
