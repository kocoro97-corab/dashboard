'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','js','market.js'),'utf8');
const diagnostics=fs.readFileSync(path.join(__dirname,'..','js','read-status.js'),'utf8');
function helper(){
 const start=src.indexOf('const FUTURE_SAFE_CODES='),end=src.indexOf('async function fillNH(',start);
 assert.ok(start>0&&end>start,'Safe NH diagnostics helper must exist');
 const observed=[];
 const ReadStatus={note:(error,meta)=>observed.push({error,meta}),clear:key=>observed.push({clear:key})};
 const window={ReadStatus};
 const fn=new Function('window','ReadStatus',src.slice(start,end)+';return {futureErrorCode,rootFutureStatus}');
 return {...fn(window,ReadStatus),observed};
}
test('a relay canonical NH error survives as its actual diagnostic code',()=>{
 const h=helper();h.rootFutureStatus('k4','nh / NH_CONTRACT_EXPIRY');
 assert.deepEqual(h.observed.at(-1),{error:{code:'NH_CONTRACT_EXPIRY'},meta:{scope:'public',key:'future:k4'}});
});
test('plain no-price code survives and names KOSDAQ150 contract as target',()=>{
 const h=helper();h.rootFutureStatus('k4','NH_NO_PRICE');
 assert.equal(h.observed.at(-1).error.code,'NH_NO_PRICE');
 assert.match(diagnostics,/'future:k4':'KOSDAQ 150 선물'/);
});
test('an observation error is never converted to generic no-price',()=>{
 const h=helper();h.rootFutureStatus('k3',{code:'NH_OBSERVATION'});
 assert.equal(h.observed.at(-1).error.code,'NH_OBSERVATION');
 assert.equal(h.observed.at(-1).meta.key,'future:k3');
});
test('unknown external text cannot be used as a diagnostic code',()=>{
 const h=helper();
 for(const raw of ['NH_NO_PRICE extra raw secret','foo / NH_CONTRACT','nh / OTHER_PRIVATE_CODE',''])assert.equal(h.futureErrorCode(raw),'NH_NO_PRICE');
});
test('clean success clears only the corresponding futures error',()=>{
 const h=helper();h.rootFutureStatus('k4',null);
 assert.deepEqual(h.observed,[{clear:'future:k4'}]);
});
test('missing response does not become a false expired-contract or observation error',()=>{
 assert.match(src,/!d\?'NH_NO_PRICE'/);
 assert.match(src,/!validObservation\?'NH_OBSERVATION'/);
 assert.match(src,/!validContract\(d\)\?'NH_CONTRACT'/);
});
test('no account secret or upstream text in error banner',()=>{
 assert.ok(!diagnostics.includes('JSON.stringify(error)'));
 assert.match(diagnostics,/safeTarget\(key\)/);
 assert.match(diagnostics,/timeKST\(item.at\)/);
});
