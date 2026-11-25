'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/transport.js','utf8');
const TOKEN='a'.repeat(64);
function fixture(responses){
  const endpoint='https://synthetic-relay.synthetic.workers.dev/api';
  let clock=0,requestCount=0;
  const calls=[];
  const context=vm.createContext({
    URL,Response,AbortController,performance:{now:()=>clock},
    location:new URL('https://kocoro97-corab.github.io/dashboard-v2-dev/'),
    MYINVEST_PERSISTENT_RELAY:{endpoint},
    MYINVEST_TRANSPORT_CONFIG:{mode:'relay',endpoint,persistentRelay:true,devSession:true},
    AppRouter:{validHash:()=>true},
    LS:()=>TOKEN,
    setTimeout:()=>1,clearTimeout:()=>{},
    fetch:async(url,options)=>{
      assert.equal(url,endpoint);
      assert.equal(options.redirect,'error');
      assert.equal(options.credentials,'omit');
      const body=JSON.parse(options.body);
      calls.push({action:body.action,authorization:options.headers.Authorization||null});
      const reply=responses[Math.min(requestCount++,responses.length-1)];
      return new Response(JSON.stringify(reply.data),{
        status:reply.status,headers:{'Content-Type':'application/json',...(reply.retryAfter?{'Retry-After':reply.retryAfter}:{})}
      });
    }
  });
  vm.runInContext(source,context,{filename:'transport.js'});
  return {api:context.DashboardTransport,calls,advance:ms=>{clock+=ms},TOKEN};
}
test('verified RELAY_BUSY 503 pauses queued reads, reduces concurrency, and recovers',async()=>{
  const f=fixture([
    {status:503,data:{success:false,code:'RELAY_BUSY',layer:'relay'},retryAfter:'5'},
    {status:200,data:{success:true,accounts:[]}}
  ]);
  const first=await f.api.post({action:'nhAccounts',token:TOKEN});
  assert.equal(first.status,503);
  assert.equal(f.api.readState().limit,1);
  assert.ok(f.api.readState().backpressureMs>=30000);
  const second=f.api.post({action:'nhAccounts',token:TOKEN});
  assert.equal(f.calls.length,1,'new requests must not stampede the congested Worker');
  assert.equal(f.api.readState().queued,1);
  f.advance(30001);
  f.api.deferReads(0);
  assert.equal((await second).status,200);
  assert.equal(f.calls.length,2);
  assert.equal(f.api.readState().limit,2,'normal budget restored automatically');
  assert.equal(f.api.readState().backpressureMs,0);
});
test('arbitrary 503 and benign 200 do not trigger client congestion mode',async()=>{
  const f=fixture([
    {status:503,data:{success:false,code:'GAS_REJECTED',layer:'gas'}},
    {status:200,data:{success:true,accounts:[]}}
  ]);
  assert.equal((await f.api.post({action:'nhAccounts',token:TOKEN})).status,503);
  assert.equal(f.api.readState().limit,2);
  assert.equal(f.api.readState().backpressureMs,0);
  assert.equal((await f.api.post({action:'nhAccounts',token:TOKEN})).status,200);
  assert.equal(f.calls.length,2);
});
test('login/write never get replayed or queued after read congestion',async()=>{
  const f=fixture([
    {status:503,data:{success:false,code:'RELAY_BUSY',layer:'relay'},retryAfter:'5'},
    {status:200,data:{success:true,session:'synthetic'}},
    {status:403,data:{success:false,code:'STORE_CONFLICT',layer:'storage'}}
  ]);
  await f.api.post({action:'nhAccounts',token:TOKEN});
  const auth=await f.api.post({action:'login',user:'synthetic',pass:'SYNTHETIC_TEST_ONLY'});
  assert.equal(auth.status,200);
  const write=await f.api.post({action:'saveExternalAccounts',token:TOKEN});
  assert.equal(write.status,403);
  assert.deepEqual(f.calls.map(x=>x.action),['nhAccounts','login','saveExternalAccounts']);
  assert.equal(f.calls[1].authorization,null);
  assert.equal(f.calls[2].authorization,'Bearer '+TOKEN);
});
test('platform 503 without a verified busy code does not extend throttle',async()=>{
  const f=fixture([{status:503,data:{success:false,code:'RELAY_BAD_RESPONSE'}}]);
  await f.api.post({action:'nhAccounts',token:TOKEN});
  assert.equal(f.api.readState().limit,2);
});
