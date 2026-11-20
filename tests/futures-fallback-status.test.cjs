'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','js','market.js'),'utf8');
const begin=source.indexOf('async function fillFutures(skip){');
const end=source.indexOf('\nconst isKR=',begin);
assert.ok(begin>=0&&end>begin,'future fallback function exists');
const functionCode=source.slice(begin,end);
function harness(fetcher){
 const seen={errors:new Map([['future:k3','NH_NO_PRICE']]),calls:[]};
 const Q={},SRC={},QT={},FQ={},FST={};
 const rootFutureStatus=(id,error)=>{seen.calls.push({id,error});if(error===null)seen.errors.delete('future:'+id);else seen.errors.set('future:'+id,error)};
 const nnum=v=>v==null||v===''?null:Number.isFinite(Number(v))?Number(v):null;
 const fn=new Function('getJSON','FUT','nnum','hms','FQ','FST','Q','SRC','QT','rootFutureStatus',functionCode+';return fillFutures')(
  fetcher,{k3:'KR4A016C0004'},nnum,()=>'18:05:00',FQ,FST,Q,SRC,QT,rootFutureStatus);
 return{fn,seen,Q,SRC,QT,FQ,FST};
}
test('successful Daum fallback clears prior NH_NO_PRICE without claiming NH source',async()=>{
 const h=harness(async()=>({tradePrice:786.15,prevClosingPrice:770.22,kospi200:{tradePrice:786.1}}));
 const result=await h.fn(new Set());
 assert.equal(result.ok,1);assert.equal(result.fail,0);
 assert.equal(h.Q.k3.p,786.15);assert.equal(h.SRC.k3,'D');
 assert.ok(!h.seen.errors.has('future:k3'));
 assert.deepEqual(h.seen.calls,[{id:'k3',error:null}]);
 assert.equal(h.Q.k3.contractVerified,undefined);
 assert.ok(Number.isFinite(h.QT.k3));
});
test('failed Daum fallback does not clear unresolved NH failure',async()=>{
 const h=harness(async()=>({tradePrice:null,prevClosingPrice:null}));
 const result=await h.fn(new Set());
 assert.equal(result.ok,0);assert.equal(result.fail,1);
 assert.equal(h.seen.errors.get('future:k3'),'NH_NO_PRICE');
 assert.equal(h.SRC.k3,undefined);
 assert.equal(h.seen.calls.length,0);
});
test('skipped Daum fallback does not accidentally clear existing diagnostics',async()=>{
 const h=harness(async()=>{throw Error('must not call')});
 const result=await h.fn(new Set(['k3']));
 assert.equal(result.ok,0);
 assert.equal(h.seen.errors.get('future:k3'),'NH_NO_PRICE');
});
