'use strict';
/* Regression coverage for read-only KOSDAQ150 futures transport and V2 presentation.
 * No API keys, network requests, account actions, or orders are executed. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const data=fs.readFileSync(path.join(root,'js/data.js'),'utf8');
const market=fs.readFileSync(path.join(root,'js/market.js'),'utf8');
const page=fs.readFileSync(path.join(root,'js/page-market.js'),'utf8');
const a=market.indexOf('async function fillNH(');
const b=market.indexOf('async function fillFutures(skip)',a);
assert.ok(a>=0&&b>a,'fillNH must exist in market.js');
const extracted=market.slice(a,b);
function simulate(reply,stale=false){
 const run=new Function('reply','stale',`
  const LS=()=> 'test-only';
  const NHF={k3:'A01',k4:'A06'},NQ={},Q={},SRC={},QT={};
  let NH_STATUS='';
  const window={ReadStatus:{note(){}}},rootFutureStatus=()=>{};
  const hms=()=> '10:00:00';
  const nhFetch=async()=>reply;
  if(stale){NQ.k4={p:999};Q.k4={p:999};SRC.k4='H';QT.k4=10}
  ${extracted}
  return fillNH(['k4']).then(out=>({out,q:Q.k4,src:SRC.k4,at:QT.k4,nq:NQ.k4}));
 `);
 return run(reply,stale);
}
test('k4 default is automatic, including migrated saved configurations',()=>{
 assert.match(data,/id:'k4',name:'코스닥150 선물',vis:1/);
 assert.match(market,/else if\(x.id==='k4'\)\{delete x.y;delete x.m/);
});
test('verified NH A06 contract reaches shared V2 quote store',async()=>{
 const r=await simulate({ok:true,data:{k4:{p:1200,prev:1190,observedAt:Date.now()-30000,code:'A066C000',contractVerified:true,expiry:'20261210'}}});
 assert.equal(r.out.ok,1);assert.equal(r.q.p,1200);assert.equal(r.q.contractCode,'A066C000');assert.equal(r.src,'H');
});
test('a mismatched KOSPI contract must never render as KOSDAQ150',async()=>{
 const r=await simulate({ok:true,data:{k4:{p:1200,prev:1190,code:'A016C000',contractVerified:true}}});
 assert.equal(r.out.ok,0);assert.equal(r.q,undefined);
});
test('NH timeout clears stale quote and source metadata',async()=>{
 const r=await simulate({ok:false,msg:'timeout',code:'NH_TIMEOUT'},true);
 assert.equal(r.out.ok,0);assert.equal(r.q,undefined);assert.equal(r.src,undefined);assert.equal(r.at,undefined);
});
test('external chart is a labeled reference, not an injected quote',()=>{
 assert.match(page,/KRX:KQI1!/);
 assert.match(page,/연속선물/);
 assert.match(page,/대시보드 카드로 자동 전송되지 않습니다/);
});


const startFetch=market.indexOf('async function nhFetch(items){');
const endFetch=market.indexOf('function rootFutureStatus(',startFetch);
assert.ok(startFetch>=0&&endFetch>startFetch,'nhFetch should remain isolated');
const relaySource=market.slice(startFetch,endFetch);
async function fakeRelay({raw='',status=200,token='test-only',failure=null}={}){
 const program=[
  'let releases=0,postCalls=0;',
  'const LS=()=>token;',
  "const SafeDiagnostics={message:()=> 'upstream rejected'};",
  'const AbortController=class{constructor(){this.signal={}} abort(){}};',
  'const setTimeout=()=> 1,clearTimeout=()=>{releases++};',
  'const post=async()=>{postCalls++;if(failure)throw failure;return{status,text:async()=>raw}};',
  relaySource,
  "return nhFetch([{k:'k4',t:'fut',c:'A06'}]).then(result=>({result,releases,postCalls}));"
 ].join('\n');
 const run=new Function('raw','status','token','failure',program);
 return run(raw,status,token,failure);
}
test('NH relay HTML/502 produces typed error without exposing response body',async()=>{
 const r=await fakeRelay({raw:'<html>secret token here</html>',status:502});
 assert.equal(r.result.ok,false);
 assert.equal(r.result.code,'NH_RESPONSE_INVALID');
 assert.equal(r.result.http,502);
 assert.equal(r.releases,1);
 assert.ok(!JSON.stringify(r.result).includes('secret token'));
});
test('NH relay timeout and generic errors are distinguishable and timer cleared',async()=>{
 const timeout=await fakeRelay({failure:{name:'AbortError'}});
 assert.equal(timeout.result.code,'NH_TIMEOUT');
 assert.equal(timeout.releases,1);
 const network=await fakeRelay({failure:{name:'TypeError'}});
 assert.equal(network.result.code,'NH_NETWORK_ERROR');
 assert.equal(network.releases,1);
});
test('NH missing authentication never calls relay',async()=>{
 const r=await fakeRelay({token:''});
 assert.equal(r.result.code,'NH_AUTH_MISSING');
 assert.equal(r.postCalls,0);
});
