const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const safe=require('../js/diagnostics.js');
// Invented canaries only. No real credentials, accounts, or portfolio fixtures.
const secret='SYNTHETIC_SECRET_CANARY',account='SYNTHETIC_ACCOUNT_8642';
const raw=secret+' '+account+' SYNTHETIC_TOKEN_CANARY SYNTHETIC_HOLDING_CANARY 98123';
function privateFree(value){const text=JSON.stringify(value);for(const canary of [secret,account,'8642','SYNTHETIC_TOKEN_CANARY','SYNTHETIC_HOLDING_CANARY','98123'])assert.ok(!text.includes(canary),'synthetic canary escaped');}
function backend(){
  const logs=[],props={NHPLUG_APP_KEY:secret,NHPLUG_APP_SECRET:secret};
  const ctx=vm.createContext({Logger:{log:x=>logs.push(x)},sessionUser_:()=> 'synthetic-user',jsonResponse:x=>x,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>props[k]=v})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{sleep(){},formatDate:()=> 'synthetic timestamp'},UrlFetchApp:{fetch:()=>{throw Error(raw)}}});
  vm.runInContext(read('gas/NhGatewayV2.gs'),ctx);vm.runInContext(read('gas/NhAccountsV2.gs'),ctx);vm.runInContext(read('gas/Nhplug.gs'),ctx);return {ctx,logs};
}
function response(http,text){return {getResponseCode:()=>http,getContentText:()=>text,getHeaders:()=>({})};}

test('token transport failure never escapes credentials in URL, stack, or manual log',()=>{
  const b=backend();assert.throws(()=>b.ctx.nhToken_(false),error=>{privateFree({message:error.message,stack:error.stack});return error.safeCode==='NH_TOKEN'});
  b.ctx.nhTestToken();privateFree(b.logs);assert.match(b.logs[0],/NH_TOKEN/);
});
test('token HTTP rejection and malformed JSON suppress upstream text',()=>{
  for(const [http,text] of [[401,JSON.stringify({rsp_msg:raw})],[200,'<html>'+raw+'</html>'],[200,'null']]){
    const b=backend();b.ctx.UrlFetchApp.fetch=()=>response(http,text);assert.throws(()=>b.ctx.nhToken_(false),error=>{privateFree(error.message);return error.safeCode==='NH_TOKEN'});
  }
});
test('NH response parser never retains malformed upstream body',()=>{
  const b=backend();b.ctx.nhToken_=()=> 'SYNTHETIC_TOKEN_CANARY';b.ctx.UrlFetchApp.fetch=()=>response(200,'<html>'+raw+'</html>');
  const r=b.ctx.nhCall_('/n2/acctinfo',{});privateFree(r);assert.equal(r.body.rsp_cd,'PARSE');
});
test('NH transport and denied paths cannot echo exception or requested URL',()=>{
  const b=backend();b.ctx.nhToken_=()=> 'SYNTHETIC_TOKEN_CANARY';
  for(const p of ['/n2/acctinfo','/order/'+raw])assert.throws(()=>b.ctx.nhCall_(p,{}),error=>{privateFree(error.message);return /^NH_/.test(error.safeCode)});
});
test('all account-list failure variants produce safe response and diagnostic logs',()=>{
  for(const r of [{http:401,body:{rsp_msg:raw}},{http:200,body:{rsp_cd:'PARSE',rsp_msg:raw}},{http:200,body:{rsp_cd:secret,rsp_msg:raw}}]){
    const b=backend();b.ctx.nhCall_=()=>r;const result=b.ctx.handleNhAccounts('synthetic-session');
    assert.equal(result.success,false);privateFree(result);b.ctx.nhTestAccounts();b.ctx.nhTestAccountBalances();privateFree(b.logs);
  }
});
test('domestic and overseas failures do not leak and preserve the successful side',()=>{
  for(const failing of ['krstock','gbstock']){
    const b=backend();b.ctx.nhCall_=p=>{if(p.includes('/'+failing+'/'))throw Error(raw);return {http:200,body:{rsp_cd:'00000',Output_0:{},Output_1:[{iem_cd:'000001',iem_nm:'Synthetic',itg_bnc_qty:2,cns_bse_bnc_qty:2,cur_cd:'USD'}]}}};
    const r=b.ctx.nhAccountBalance_(account,'01');privateFree(r.errors);assert.ok(r[failing==='krstock'?'overseas':'domestic']);assert.equal(r[failing==='krstock'?'domestic':'overseas'],null);
  }
});
test('successful editor diagnostics log neither account suffix nor holdings or amounts',()=>{
  const b=backend();b.ctx.nhCall_=()=>({http:200,body:{rsp_cd:'00000',rsp_msg:raw,Output_0:[{acct_no:account,acct_type:'01',iem_nm:raw,now_pr:98123}]}});
  b.ctx.nhAccountBalance_=()=>({domestic:{holdings:[{name:raw}],summary:{evalAmount:98123,profit:98123}},overseas:{holdings:[],summary:{evalAmount:98123,profit:98123}},errors:[raw]});
  b.ctx.nhTestAccounts();b.ctx.nhTestAccountBalances();b.ctx.nhProbeFutQuote();b.ctx.nhFutQuote_=()=>({code:raw,name:raw,p:98123});b.ctx.nhTestFutures();
  b.ctx.nhFetchSpec_=()=>({paths:{[raw]:{post:{summary:raw}}}});b.ctx.nhDumpSpec();privateFree(b.logs);assert.ok(b.logs.length>5);
});
test('external quote diagnostics discard injected response code, field names, and text',()=>{
  const b=backend();b.ctx.nhCall_=()=>({http:503,body:{rsp_cd:secret,rsp_msg:raw,Output_0:{[secret]:raw,now_pr:98123}}});
  const r=b.ctx.handleNhExternalQuotes('synthetic-session',['000001']);privateFree(r);assert.equal(r.diagnostics['000001'].rspCode,'UNRECOGNIZED');assert.equal(r.diagnostics['000001'].http,503);
});
test('invalid quote input is identified by position rather than echoed in diagnostic keys',()=>{
  const b=backend();const r=b.ctx.handleNhExternalQuotes('synthetic-session',[raw]);privateFree(r);assert.equal(r.diagnostics.invalid_1.code,'INVALID_SYMBOL');
});
test('storage errors cannot escape through a STORE_ prefixed exception',()=>{
  const ctx=vm.createContext({jsonResponse:x=>x});vm.runInContext(read('gas/ExternalHoldings.gs'),ctx);
  const r=ctx.externalStoreError_(Error('STORE_'+raw));privateFree(r);assert.equal(r.code,'STORE_WRITE_FAILED');
});
test('legacy JSON/error/HTML failures are blocked without changing successful output',()=>{
  const ctx=vm.createContext({jsonResponse:x=>x});vm.runInContext(read('gas/Security.gs'),ctx);
  for(const output of [{success:false,message:raw},{error:raw},{getContent:()=>JSON.stringify({success:false,message:raw})},{getContent:()=>'<html>'+raw+'</html>'}])privateFree(ctx.securityDiagnosticResponse_(output,false));
  const success={success:true,syntheticValue:10};assert.equal(ctx.securityDiagnosticResponse_(success,false),success);
});
test('public proxy transport exception cannot escape its entry point',()=>{
  const ctx=vm.createContext({jsonResponse:x=>x,PROXY_ALLOWED_HOSTS:['example.test'],securityLegacyDoGet_:()=>{throw Error(raw)}});vm.runInContext(read('gas/Security.gs'),ctx);
  privateFree(ctx.doGet({parameter:{url:'https://example.test/'}}));
});
test('frontend diagnostic fields are allowlisted rather than truncated',()=>{
  for(const data of [{code:secret,layer:raw,http:raw,rspCode:secret,fields:[raw]}, {code:'NH_HTTP',layer:'nh',http:503,rspCode:secret,message:raw}]){
    privateFree(safe.diagnostic(data));privateFree(safe.message(data));privateFree(safe.text(data));
  }
  assert.match(safe.text({code:'NH_HTTP',layer:'nh',http:503}),/HTTP 503/);
  assert.equal(safe.message('현재 비밀번호를 확인하세요.'),'현재 비밀번호를 확인하세요.');
  assert.equal(safe.message('NH_HTTP / HTTP 503'),safe.message(safe.message('NH_HTTP / HTTP 503')));
});

function frontend(){
  const elements=new Map(),storage=new Map(),events={};
  const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',value:'',style:{},dataset:{},classList:{add(){},remove(){}},addEventListener(){},replaceChildren(){},appendChild(){}});return elements.get(id)};
  const ctx=vm.createContext({Date,AbortController,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},alert(){},console,
    SafeDiagnostics:safe,window:{addEventListener:(k,fn)=>events[k]=fn},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{readyState:'loading',addEventListener(){},getElementById:element,createElement:()=>element('created'),body:{appendChild(){}}}});
  vm.runInContext(read('js/auth.js'),ctx);storage.set('invest_session_token',JSON.stringify('synthetic-session'));element('authId').value='synthetic-user';element('authPw').value='synthetic-password';
  return {ctx,element,events};
}
test('login non-JSON and rejection never display upstream HTML, token, or exception',async()=>{
  for(const text of ['<html>'+raw+'</html>',JSON.stringify({success:false,message:raw,code:secret})]){
    const f=frontend();f.ctx.fetch=async()=>({status:200,text:async()=>text});await f.ctx.doAuth(false);privateFree(f.element('authMsg').textContent);
  }
});
test('general account frontend failures preserve prior holdings without echoing errors',async()=>{
  const f=frontend(),source=read('js/market.js');
  vm.runInContext(source.slice(source.indexOf('let NH_ACCOUNTS')),f.ctx);
  vm.runInContext("NH_ACCOUNTS=[{domestic:{holdings:[{code:'000001',quantity:2}]}}]",f.ctx);
  for(const text of ['<html>'+raw+'</html>',JSON.stringify({success:false,message:raw,code:secret})]){
    f.ctx.fetch=async()=>({text:async()=>text});await f.ctx.loadNHAccounts();privateFree(f.element('nhAccountStatus').textContent);assert.equal(vm.runInContext('NH_ACCOUNTS[0].domestic.holdings[0].quantity',f.ctx),2);
  }
});
test('external account application and quote diagnostics never echo poisoned payloads',async()=>{
  const f=frontend();f.ctx.ExternalCore=require('../js/external_core.js');vm.runInContext(read('js/external_accounts.js'),f.ctx);
  f.ctx.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({success:false,code:secret,layer:raw,message:raw})});
  await assert.rejects(f.ctx.extPost('externalHoldings'),e=>{privateFree({message:e.message,diagnostic:e.diagnostic});return true});
  vm.runInContext("EXT_MASTER=ExternalCore.master({schema:1,source:{},instruments:[{code:'000001',name:'Synthetic',type:'STOCK'}]});EXT_ASSETS=[{accountType:'ISA',code:'000001',name:'Synthetic',quantity:2,avgPrice:10}]",f.ctx);
  f.ctx.fetch=async()=>({text:async()=>JSON.stringify({success:true,prices:{},errors:{'000001':raw},diagnostics:{'000001':{code:secret,layer:raw,rspCode:raw,http:raw}}})});
  await f.ctx.refreshExternalPrices(true);privateFree(f.element('externalStatus').textContent);privateFree(f.ctx.window.EXT_LAST_QUOTE_DIAGNOSTICS);privateFree(f.ctx.window.EXT_LAST_QUOTE_ERRORS);
});
test('global script/rejection diagnostics suppress default raw console reporting',()=>{
  const f=frontend();vm.runInContext(read('js/debug.js'),f.ctx);
  for(const type of ['error','unhandledrejection']){let prevented=false;f.events[type]({message:raw,reason:Error(raw),preventDefault(){prevented=true}});assert.ok(prevented);privateFree(f.element('errBar').textContent);privateFree(f.element('authMsg').textContent)}
});
