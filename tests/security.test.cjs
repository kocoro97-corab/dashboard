const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function backend(){
  const rows=[['userId','password','status','isAdmin'],['owner','old-pass','approved','true'],['member','legacy-member','approved','false']];
  const props=new Map(),cache=new Map();let lockDepth=0,legacyCalls=0;
  const sheet={getDataRange:()=>({getValues:()=>rows.map(row=>[...row])}),appendRow:row=>rows.push(row),getRange:(r,c)=>({getValue:()=>rows[r-1][c-1],setValue:v=>{rows[r-1][c-1]=v}})};
  const ctx=vm.createContext({console,Date,
    jsonResponse:x=>x,getSheet:()=>sheet,purgeSessions_(){},
    deleteSession_:token=>props.delete('S_'+token),
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
    LockService:{getScriptLock:()=>({waitLock:()=>{assert.equal(lockDepth,0,'nested locks');lockDepth++},releaseLock:()=>lockDepth--})},
    Utilities:{getUuid:()=>crypto.randomUUID(),newBlob:s=>({getBytes:()=>[...Buffer.from(s)]}),DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,s)=>[...crypto.createHash('sha256').update(s).digest()]},
    securityLegacyDoPost_:()=>{legacyCalls++;return {success:true}},securityLegacyDoGet_:()=>({allowed:true}),
    PROXY_ALLOWED_HOSTS:['finance.daum.net'],
    handleSaveExternalHoldingsV2:()=>{legacyCalls++;return {success:true}}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'gas/SecurityKdf.gs'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(root,'gas/Security.gs'),'utf8'),ctx);
  ctx.verifyAdmin=token=>{const s=ctx.securitySession_(token);return !!s&&rows.some(r=>r[0]===s.u&&r[3]==='true')};
  const post=body=>ctx.doPost({postData:{contents:JSON.stringify(body)}});
  return {ctx,rows,props,cache,post,legacyCalls:()=>legacyCalls};
}
test('GAS PBKDF2 works without Node crypto or TextEncoder and matches standard SHA256 vectors',()=>{
  const b=backend();
  const actual=b.ctx.securityHash_('한글 password','01234567890123456789012345678901',600000);
  const expected=crypto.pbkdf2Sync('한글 password','01234567890123456789012345678901',600000,32,'sha256').toString('hex');
  assert.equal(actual,expected);
});
function fastBackend(){
  const b=backend();
  // Native implementation of the same KDF keeps integration tests fast; the bundle is verified above.
  b.ctx.SecurityKdf={sha256:{},pbkdf2:(_,password,salt,opt)=>crypto.pbkdf2Sync(Buffer.from(password),Buffer.from(salt),opt.c,opt.dkLen,'sha256')};
  return b;
}
test('legacy passwords migrate to salted hashes and weak passwords require a change',()=>{
  const b=fastBackend();const login=b.post({action:'login',user:'owner',pass:'old-pass'});
  assert.equal(login.success,true);assert.equal(login.mustChangePassword,true);
  assert.match(b.rows[1][1],/^pbkdf2-sha256\$600000\$/);
  assert.equal(b.ctx.securityVerifyPassword_('old-pass',b.rows[1][1]),true);
  assert.equal(b.ctx.securityVerifyPassword_('wrong',b.rows[1][1]),false);
  assert.equal(b.post({action:'nhAccounts',token:login.token}).mustChangePassword,true);
});
test('password change revokes every existing session and preserves the account',()=>{
  const b=fastBackend();const login=b.post({action:'login',user:'owner',pass:'old-pass'});
  const other=b.ctx.securityCreateSession_('owner',false);
  const result=b.post({action:'changePassword',token:login.token,currentPass:'old-pass',newPass:'A much stronger password 2026'});
  assert.equal(result.success,true);assert.equal(b.ctx.securitySession_(login.token),null);
  assert.equal(b.ctx.securitySession_(other),null);assert.ok(b.ctx.securitySession_(result.token));
  assert.equal(b.ctx.securityVerifyPassword_('A much stronger password 2026',b.rows[1][1]),true);
});
test('signup never stores plaintext and rejects formula or markup usernames',()=>{
  const b=fastBackend();
  for(const user of ['=IMPORTXML(x)','<img src=x>','+formula'])assert.equal(b.post({action:'register',user,pass:'a sufficiently long password'}).success,false);
  assert.equal(b.post({action:'register',user:'new-user',pass:'a sufficiently long password'}).success,true);
  assert.match(b.rows[3][1],/^pbkdf2-sha256\$/);assert.equal(b.rows[3][3],'false');
});
test('owner balances require an approved administrator, and revoked accounts lose sessions',()=>{
  const b=fastBackend();
  assert.equal(b.post({action:'nhAccounts'}).success,false);
  const member=b.ctx.securityCreateSession_('member',false);
  assert.equal(b.post({action:'nhAccounts',token:member}).success,false);
  assert.equal(b.post({action:'protectedHoldings',token:member}).success,false);
  assert.equal(b.legacyCalls(),0);
  const owner=b.ctx.securityCreateSession_('owner',false);
  assert.equal(b.post({action:'nhAccounts',token:owner}).success,true);
  b.rows[1][2]='pending';assert.equal(b.ctx.securitySession_(owner),null);
});
test('expired, legacy, and malformed sessions are rejected',()=>{
  const b=fastBackend();const token=b.ctx.securityCreateSession_('owner',false);
  const session=JSON.parse(b.props.get('S_'+token));session.t=Date.now()-300001;b.props.set('S_'+token,JSON.stringify(session));
  assert.equal(b.ctx.securitySession_(token),null);
  assert.equal(b.ctx.securitySession_('not-a-session'),null);
  b.props.set('S_'+token,JSON.stringify({u:'owner',t:Date.now()}));assert.equal(b.ctx.securitySession_(token),null);
});
test('login attempts are throttled before authentication work',()=>{
  const b=fastBackend();
  for(let i=0;i<8;i++)b.post({action:'login',user:'owner',pass:'wrong'});
  assert.match(b.post({action:'login',user:'owner',pass:'old-pass'}).message,/15분/);
});
test('retired default-admin credential is blocked before authenticating',()=>{
  const b=fastBackend();
  const fingerprint='5c06eb3d5a05a19f49476d694ca81a36344660e9d5b98e3d6a6630f31c2422e7';
  b.ctx.Utilities.computeDigest=()=>[...Buffer.from(fingerprint,'hex')];
  const result=b.post({action:'login',user:'admin',pass:'fixture-default'});
  assert.equal(result.success,false);assert.match(result.message,/초기 관리자/);
});
test('invalid holdings cannot trigger replacement saves or spreadsheet formulas',()=>{
  const b=fastBackend(),token=b.ctx.securityCreateSession_('owner',false);
  const row={accountType:'ISA',code:'035720',name:'카카오',quantity:1,avgPrice:100,source:'manual'};
  for(const changes of [{name:'=IMPORTXML(x)'},{code:'A035720'},{quantity:-1},{avgPrice:'100'},{source:'+formula'}]){
    assert.equal(b.post({action:'saveExternalHoldings',token,holdings:[{...row,...changes}]}).success,false);
  }
  assert.equal(b.legacyCalls(),0);
  assert.equal(b.post({action:'saveExternalHoldings',token,holdings:[row]}).success,true);
});
test('proxy rejects untrusted hosts, userinfo, ports, backslashes, and control characters',()=>{
  const b=fastBackend();
  for(const url of ['http://finance.daum.net/x','https://finance.daum.net.evil.test/x','https://finance.daum.net@evil.test/x','https://finance.daum.net:8443/x','https://finance.daum.net/\\evil','https://finance.daum.net/\nx'])assert.ok(b.ctx.doGet({parameter:{url}}).error);
  assert.equal(b.ctx.doGet({parameter:{url:'https://finance.daum.net/quotes'}}).allowed,true);
});
