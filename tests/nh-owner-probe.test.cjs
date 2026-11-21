const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const probe=fs.readFileSync(path.join(__dirname,'staging/OwnerOverseasProbe.gs'),'utf8');
function backend(o,{array=false,context=true,approved=true,http=200}={}){
  const logs=[],calls=[],reads=[],props={APP_ENV:'nh-staging',NH_V2_FRESH_TEST:'true',STAGING_SHEET_ID:'SYNTHETIC_NEW_SHEET',STAGING_TEST_USER:'synthetic-owner'};
  const rows=[{overseas:{holdings:[{code:'SYNTH',currency:'USD',quantity:642}]}}];
  const store={read:user=>{reads.push(user);return {revision:'synthetic-revision',holdings:rows}}};
  const users={getLastRow:()=>2,getRange:(r,c,n,w)=>{assert.ok(c!==2,'must not read password hash');return {getValues:()=>c===1?[['synthetic-owner']]:[[approved?'approved':'pending',true]]}}};
  const c=vm.createContext({Logger:{log:s=>logs.push(s)},stagingProjectGuard_:()=>{if(!context)throw Error('SYNTHETIC_PRIVATE_CANARY')},
    stagingSheet_:()=>({getSheetByName:name=>name==='Users'?users:{getRange:()=>({getValues:()=>[['synthetic-header']]}),getDataRange:()=>({getValues:()=>[['synthetic-header']]})}}),
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},ScriptApp:{getScriptId:()=> 'SYNTHETIC_NEW_SCRIPT'},NH_SNAPSHOT_OLD_SCRIPT:'SYNTHETIC_OLD_SCRIPT',NH_SNAPSHOT_OLD_SHEET:'SYNTHETIC_OLD_SHEET',
    createAccountStoreV2_:io=>{const sheet=io.sheet('AccountStoreV2',['synthetic-header']);assert.equal(sheet.setValues,undefined);return store},
    nhSnapshotValidateV2_:x=>x,securityWithLock_:fn=>fn(),
    nhCall_:(p,input)=>{calls.push({p,input});return {http,body:{rsp_cd:'00000',Output_0:array?[o]:o}}}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'gas/NhAccountsV2.gs'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(root,'gas/Nhplug.gs'),'utf8'),c);
  c.nhCall_=(p,input)=>{calls.push({p,input});return {http,body:{rsp_cd:'00000',Output_0:array?[o]:o}}};
  vm.runInContext(probe,c);
  return {c,logs,calls,reads,run:()=>{c.ownerProbeOverseasQuote();return JSON.parse(logs.at(-1))}};
}
test('owner probe distinguishes symbol padding without correcting/guessing it',()=>{
  const b=backend({iem_cd:'SYNTH ',trdprc:20,currency_unit:'USD'});const r=b.run();assert.equal(r.status,'PASS');assert.equal(r.symbolMatches,false);assert.equal(r.symbolMatchesAfterTrim,true);assert.equal(r.quoteAcceptedByCurrentRules,false);assert.equal(b.calls.length,1);assert.equal(b.calls[0].p,'/gbstock/quote/v1/current');assert.equal(r.storedSnapshotUnchanged,true);
});
test('owner probe classifies absent, nonnumeric and nonpositive current price',()=>{
  for(const [o,present,numeric,positive] of [[{},false,false,false],[{trdprc:'invalid'},true,false,false],[{trdprc:0},true,true,false],[{trdprc:2},true,true,true]]){
    const r=backend({iem_cd:'SYNTH',currency_unit:'USD',...o}).run();assert.equal(r.priceFieldPresent,present);assert.equal(r.priceNumeric,numeric);assert.equal(r.pricePositive,positive);
  }
});
test('owner probe distinguishes currency padding and case from missing currency',()=>{
  for(const currency of [undefined,'USD ','usd','USD']){
    const r=backend({iem_cd:'SYNTH',trdprc:20,...(currency===undefined?{}:{currency_unit:currency})}).run();
    assert.equal(r.currencyValid,currency==='USD');assert.equal(r.currencyValidAfterTrimUppercase,currency!==undefined);assert.equal(r.quoteAcceptedByCurrentRules,currency==='USD');
  }
});
test('owner probe detects array-code mismatch separately from missing output',()=>{
  const r=backend({iem_cd:'OTHER',trdprc:20,currency_unit:'USD'},{array:true}).run();assert.equal(r.outputBlockIsArray,true);assert.equal(r.exactSelectedBlockPresent,false);assert.equal(r.symbolMatchesAfterTrim,false);
  assert.equal(backend(null).run().outputBlockPresent,false);
});
test('context/admin failures stop before NH and leak no raw exception text',()=>{
  for(const options of [{context:false},{approved:false}]){
    const b=backend({},options);const r=b.run();assert.equal(r.status,'FAIL');assert.equal(b.calls.length,0);assert.ok(!b.logs.join('').includes('SYNTHETIC_PRIVATE_CANARY'));
  }
});
test('all diagnostic output excludes source financial fields and identifiers',()=>{
  const b=backend({iem_cd:'SYNTH',trdprc:12345.67,currency_unit:'USD',iem_nm:'SYNTHETIC_PRIVATE_HOLDING',rsp_msg:'SYNTHETIC_PRIVATE_CANARY'});b.run();const text=b.logs.join('');
  for(const value of ['12345.67','642','SYNTH','USD','synthetic-owner','synthetic-revision','SYNTHETIC_PRIVATE_CANARY'])assert.ok(!text.includes(value));
});
test('HTTP errors never read/log vendor text as diagnostics',()=>{
  const b=backend({iem_nm:'SYNTHETIC_PRIVATE_CANARY'},{http:503});const r=b.run();assert.equal(r.status,'FAIL');assert.equal(r.code,'NH_HTTP');assert.equal(r.http,503);assert.equal(r.storedSnapshotUnchanged,true);
});
