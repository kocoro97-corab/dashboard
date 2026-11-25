'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/transport.js','utf8');
const endpoint='https://myinvest-v2-dev-relay.synthetic.workers.dev/api';
const token='a'.repeat(64);
function setup({code='RELAY_BUSY',status=503,persistent=true}={}){
 let now=1000,requests=0;const ctx=vm.createContext({
  URL,Event,AbortController,Date,JSON,setTimeout,clearTimeout,
  performance:{now:()=>now},location:{hash:'#/sectors'},
  MYINVEST_PERSISTENT_RELAY:{endpoint},MYINVEST_TRANSPORT_CONFIG:{mode:'relay',endpoint,persistentRelay:persistent},
  LS:()=>token,
  fetch:async(_,options)=>{
    requests++;return new Response(JSON.stringify({success:false,code}),{status,headers:{'Content-Type':'application/json','Retry-After':'3'}});
  },Response
 });
 vm.runInContext(source,ctx,{filename:'transport.js'});
 return {api:ctx.DashboardTransport,forward:ms=>{now+=ms},requests:()=>requests};
}
const url='https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=1y';
test('verified persistent RELAY_BUSY reduces read capacity without credential/network side effects',async()=>{
 const x=setup();const response=await x.api.post({action:'publicFetch',url,token});
 assert.equal(response.status,503);
 assert.equal(x.requests(),1,'must not retry the original request');
 assert.equal(x.api.readState().limit,1);
 assert.ok(x.api.readState().backpressureMs>=3000);
 assert.equal(x.api.readState().queued,0);
 x.forward(31000);
 assert.equal(x.api.readState().limit,2,'restore normal capacity after congestion window');
 assert.equal(x.api.readState().backpressureMs,0);
});
test('unverified 503 response must not throttle any reads',async()=>{
 const x=setup({code:'OTHER',status:503});
 await x.api.post({action:'publicFetch',url,token});
 assert.equal(x.api.readState().limit,2);
 assert.equal(x.api.readState().backpressureMs,0);
});
test('rate-limit response activates shared congestion control only with explicit safe code',async()=>{
 const x=setup({code:'RELAY_RATE_LIMIT',status:429});
 await x.api.post({action:'publicFetch',url,token});
 assert.equal(x.api.readState().limit,1);
 x.forward(30001);
 assert.equal(x.api.readState().limit,2);
});
test('authentication response is never throttled or retried',async()=>{
 const x=setup();
 await x.api.post({action:'login',user:'synthetic',pass:'SYNTHETIC'});
 assert.equal(x.requests(),1);
 assert.equal(x.api.readState().limit,2);
});
test('congestion state exposes only safe integer counters, no account, auth or URL',async()=>{
 const x=setup();await x.api.post({action:'publicFetch',url,token});
 const status=JSON.stringify(x.api.readState());
 assert.doesNotMatch(status,/synthetic\.workers|a{20}|SPY|Bearer|endpoint|password/i);
 assert.ok(JSON.parse(status).backpressureMs>0);
});
