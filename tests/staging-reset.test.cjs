const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function helper({guardFails=false,approved=true,password='SYNTHETIC_NEW_PASSWORD_123'}={}) {
  const values=new Map([['STAGING_TEST_USER','synthetic'],['STAGING_TEST_PASSWORD',password],['S_old',JSON.stringify({u:'synthetic'})],['S_other',JSON.stringify({u:'someone-else'})],['NHPLUG_APP_KEY','SYNTHETIC_NH_KEY']]);
  const writes=[],logs=[],removed=[];
  const ctx=vm.createContext({
    stagingProjectGuard_:()=>{if(guardFails)throw Error('PROJECT_MISMATCH')},stagingSheet_:()=>{},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>values.get(key),getProperties:()=>Object.fromEntries(values),deleteProperty:key=>values.delete(key)})},
    securityNewPassword_:input=>{assert.equal(input,password);return 'pbkdf2-sha256$SYNTHETIC_HASH'},
    securityWithLock_:fn=>fn(),securityFindUser_:user=>({row:[user,'old-hash',approved?'approved':'pending','true'],index:2,sheet:{getRange:(row,col)=>({setValue:value=>writes.push({row,col,value})})}}),
    securityRateKey_:user=>'limit-'+user,CacheService:{getScriptCache:()=>({remove:key=>removed.push(key)})},Logger:{log:value=>logs.push(value)}
  });
  vm.runInContext(fs.readFileSync('tests/staging/ResetStagingPassword.gs','utf8'),ctx);
  return {ctx,values,writes,logs,removed};
}
test('owner reset hashes only the staging password and revokes only that users sessions',()=>{
  const s=helper();s.ctx.resetNhStagingPassword();
  assert.deepEqual(s.writes,[{row:2,col:2,value:'pbkdf2-sha256$SYNTHETIC_HASH'}]);
  assert.ok(!s.values.has('STAGING_TEST_PASSWORD'));assert.ok(!s.values.has('S_old'));assert.ok(s.values.has('S_other'));
  assert.equal(s.values.get('NHPLUG_APP_KEY'),'SYNTHETIC_NH_KEY');assert.deepEqual(s.logs,['STAGING_PASSWORD_RESET_OK']);assert.deepEqual(s.removed,['limit-synthetic']);
});
test('wrong project stops reset before hashing or data writes',()=>{
  const s=helper({guardFails:true});s.ctx.securityNewPassword_=()=>assert.fail('must not hash');
  assert.throws(()=>s.ctx.resetNhStagingPassword(),/PROJECT_MISMATCH/);assert.equal(s.writes.length,0);
});
test('weak password and unapproved account cannot reset or revoke sessions',()=>{
  for(const config of [{password:'short'},{approved:false}]){const s=helper(config);assert.throws(()=>s.ctx.resetNhStagingPassword());assert.equal(s.writes.length,0);assert.ok(s.values.has('S_old'));assert.ok(s.values.has('STAGING_TEST_PASSWORD'));}
});
