'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {evidence}=require('../js/five-minute-reference-panel-v1.js');
const now=1795334400000;
function result(){return {ok:true,data:{kind:'public-five-minute-reference-v1',instrument:{symbol:'AAPL',currency:'USD'},candles:[{t:now-600000,c:10,privateToken:'PRIVATE_VALUE'},{t:now-300000,c:11}],receivedAt:now,providerWindowFullyObserved:true}}}
test('successful evidence is limited to browser observations, scoped counts and non-price metadata',()=>{
 const r=evidence({phase:'VALIDATION',status:'PASS',code:'REFERENCE_VALIDATED',http:200,result:result(),capability:true,build:'a'.repeat(12),now});
 assert.equal(r.status,'PASS');assert.equal(r.bars,2);assert.equal(r.sourceRevision,'a'.repeat(12));assert.equal(r.realTimeVerified,false);assert.equal(r.independentTransportVerification,false);assert.equal(r.scope,'THIS_REFERENCE_CHECK_ONLY');assert.equal(r.credentialsIncluded,false);assert.equal(r.lastBarStartAt,now-300000);assert.equal(r.candles,undefined);assert.equal(JSON.stringify(r).includes('PRIVATE_VALUE'),false);
});
test('arbitrary server errors, identity fields, tokens, URLs and holdings are never copied',()=>{
 const r=evidence({phase:'PRIVATE_VALUE',status:'PRIVATE_VALUE',code:'PRIVATE_VALUE',http:'PRIVATE_VALUE',build:'PRIVATE_VALUE',now:'PRIVATE_VALUE',token:'PRIVATE_VALUE',url:'https://host/?token=PRIVATE_VALUE',holdings:[{account:'PRIVATE_VALUE'}],result:{raw:'PRIVATE_VALUE'}});
 assert.equal(JSON.stringify(r).includes('PRIVATE_VALUE'),false);assert.equal(r.code,'LOCAL_EVIDENCE_INVALID');assert.equal(r.status,'NOT_RUN');assert.equal(r.phase,'CAPABILITY');assert.equal(r.checkedAt,undefined);
});
test('missing server capability is NOT_RUN and cannot claim bars or success',()=>{
 const r=evidence({phase:'CAPABILITY',status:'NOT_RUN',code:'RELAY_CAPABILITY_REQUIRED',http:200,now});assert.equal(r.status,'NOT_RUN');assert.equal(r.serverCapabilityObserved,false);assert.equal(r.bars,undefined);
 for(const status of ['PASS','PARTIAL'])assert.equal(evidence({phase:'VALIDATION',status,code:'REFERENCE_VALIDATED',result:result(),now}).status,'FAIL');
});
test('invalid or missing parsed data cannot become successful evidence',()=>{
 for(const mutate of [r=>delete r.data.candles,r=>r.data.instrument.currency='KRW',r=>r.data.receivedAt=now+1,r=>r.data.candles[1].t=NaN]){
  const data=result();mutate(data);assert.equal(evidence({phase:'VALIDATION',status:'PASS',code:'REFERENCE_VALIDATED',result:data,capability:true,now}).status,'FAIL');
 }
});
test('only a numeric HTTP status and validated revision shape are accepted',()=>{
 for(const http of [-1,600,NaN,'403'])assert.equal(evidence({http,now}).http,undefined);
 assert.equal(evidence({http:403,phase:'PUBLIC_READ',status:'FAIL',code:'INTRADAY_READ_FAILED',build:'f'.repeat(64),now}).sourceRevision,undefined);
});
test('partial source coverage remains PARTIAL and original payload is not mutated',()=>{
 const data=result(),before=JSON.stringify(data);data.data.providerWindowFullyObserved=false;const snapshot=JSON.stringify(data);
 const r=evidence({phase:'VALIDATION',status:'PARTIAL',code:'REFERENCE_VALIDATED',result:data,capability:true,now});assert.equal(r.status,'PARTIAL');assert.equal(r.providerWindowFullyObserved,false);assert.equal(JSON.stringify(data),snapshot);assert.notEqual(before,snapshot);
});
