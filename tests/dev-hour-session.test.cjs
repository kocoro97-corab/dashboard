const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

const T0=1732200000000,MIN=60000;
function clock(){
 let now=T0;
 class Clock extends Date{static now(){return now}}
 return {Date:Clock,move:ms=>{now=T0+ms},now:()=>now};
}
function frontend(development){
 const time=clock(),operating=new Map([['invest_last_active','99'],['invest_session_token','"OPERATING_SESSION"']]),tab=new Map();
 const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{style:{display:id==='appContainer'?'block':'none'},textContent:'',classList:{remove(){}},remove(){},replaceChildren(){}});return elements.get(id)};
 const ctx=vm.createContext({Date:time.Date,window:{MYINVEST_TRANSPORT_CONFIG:development?{mode:'relay',devSession:true}:undefined,addEventListener(){}},
  document:{readyState:'loading',addEventListener(){},getElementById:element},
  localStorage:storage(operating),sessionStorage:storage(tab),
  clearInterval(){},setInterval(){return 1},fetch(){return Promise.resolve({})}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/auth.js'),'utf8'),ctx);
 return {ctx,time,tab,operating,element};
}
function backend(staging){
 const time=clock(),props=new Map(),user=[['userId','password','status','isAdmin'],['owner','test-pass','approved','true']];
 const ctx=vm.createContext({Date:time.Date,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,String(v)),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},
  getSheet:()=>({getDataRange:()=>({getValues:()=>user.map(x=>[...x])})}),
  Utilities:{getUuid:()=> 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'},
  purgeSessions_(){},jsonResponse:x=>x});
 if(staging!==undefined){
  ctx.securityEnvironmentGuard_=()=>true;
  ctx.securityEnvironmentMetadata_=()=>{
   if(staging==='throws')throw Error('staging metadata inaccessible');
   return {freshTestEnvironment:staging===true,testEnvironment:'nh-staging',
     gatewayVersion:2,storeEngine:'account-store-v2',
     scriptHash:'a'.repeat(64),sheetHash:'b'.repeat(64),sourceDigest:'c'.repeat(64)};
  };
 }
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../gas/Security.gs'),'utf8'),ctx);
 const token=ctx.securityCreateSession_('owner',false);
 return {ctx,time,props,token};
}

test('development UI has a 60-minute idle countdown and isolated browser state',()=>{
 const f=frontend(true),g=frontend(false);
 assert.equal(vm.runInContext('SESSION_MS',f.ctx),60*MIN);
 assert.equal(vm.runInContext('SESSION_MS',g.ctx),5*MIN);
 vm.runInContext("LS('invest_session_token','SYNTHETIC_ONLY');touchActive(true)",f.ctx);
 f.time.move(59*MIN);
 assert.equal(vm.runInContext('sessionLeftMs()',f.ctx),MIN);
 f.time.move(60*MIN);
 assert.equal(vm.runInContext('sessionLeftMs()',f.ctx),0);
 assert.equal(f.operating.get('invest_session_token'),'"OPERATING_SESSION"');
 assert.equal(f.operating.get('invest_last_active'),'99');
});
test('production UI still expires after 5 minutes of no activity',()=>{
 const f=frontend(false);
 vm.runInContext('touchActive(true)',f.ctx);
 f.time.move(5*MIN+1);
 assert.ok(vm.runInContext('sessionLeftMs()',f.ctx)<0);
});
test('fingerprinted isolated staging GAS accepts 59 minutes idle but expires after 60',()=>{
 const f=backend(true);
 assert.equal(f.ctx.securityIdleMs_(),60*MIN);
 f.time.move(59*MIN);
 assert.ok(f.ctx.securitySession_(f.token));
 f.time.move(120*MIN);
 assert.equal(f.ctx.securitySession_(f.token),null); // latest access at 59m; idle >60m
 assert.equal(f.props.has('S_'+f.token),false);
});
test('plain production GAS never inherits the staging idle extension',()=>{
 const f=backend();
 assert.equal(f.ctx.securityIdleMs_(),5*MIN);
 f.time.move(5*MIN+1);
 assert.equal(f.ctx.securitySession_(f.token),null);
});
test('unverified staging markers and metadata exceptions fail closed at 5 minutes',()=>{
 for(const mode of [false,'throws']){
  const f=backend(mode);
  assert.equal(f.ctx.securityIdleMs_(),5*MIN);
  f.time.move(6*MIN);
  assert.equal(f.ctx.securitySession_(f.token),null);
 }
});
test('even isolated staging has an absolute 8-hour session cap',()=>{
 const f=backend(true);
 f.time.move(8*60*MIN+1);
 const session=JSON.parse(f.props.get('S_'+f.token));
 session.t=f.time.now()-1000;
 f.props.set('S_'+f.token,JSON.stringify(session));
 assert.equal(f.ctx.securitySession_(f.token),null);
});
