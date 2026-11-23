'use strict';
const assert=require('node:assert/strict');
const A=require('../js/sector-rotation-adapter.js');
const E=require('../js/sector-rotation-engine.js');
const t0=Math.floor(Date.UTC(2026,6,1,16)/1000);
const dates=Array.from({length:70},(_,i)=>new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10));
const times=dates.map((_,i)=>t0+i*86400);
const us={currency:'USD',exchange:'NMS',instrumentType:'ETF',
 bars:dates.map((_,i)=>100+i),times,volume:dates.map(()=>1000)};
const ok=A.adapt(us,{symbol:'XLK',market:'US',instrumentType:'ETF',dates});
assert.equal(ok.status,'ready');
assert.equal(ok.bars.length,70);
assert.equal(ok.bars[0].date,'2026-07-01');
assert.equal(ok.currency,'USD');
assert.equal(A.adapt(us,{symbol:'XLK',market:'US'}).status,'unavailable','exchange session dates must be supplied');
assert.equal(A.adapt({...us,currency:'KRW'},{symbol:'XLK',market:'US',dates}).status,'unavailable');
assert.equal(A.adapt({...us,exchange:'KSC'},{symbol:'XLK',market:'US',dates}).status,'unavailable');
assert.equal(A.adapt({...us,instrumentType:'EQUITY'},{symbol:'XLK',market:'US',instrumentType:'ETF',dates}).status,'unavailable');
const badDates=[...dates];badDates[20]=badDates[19];
assert.equal(A.adapt(us,{symbol:'XLK',market:'US',dates:badDates}).status,'unavailable');
const invalid=[...dates];invalid[12]='2026-02-30';
assert.equal(A.adapt(us,{symbol:'XLK',market:'US',dates:invalid}).status,'unavailable');
const domestic={...us,currency:'KRW',exchange:'KSC',instrumentType:'INDEX'};
const kr=A.adapt(domestic,{symbol:'^KS11',market:'KR',instrumentType:'INDEX',dates});
assert.equal(kr.status,'ready');
const benchmark={...kr,symbol:'^KS11'};
const krCand={...kr,id:'KR_TECH',name:'한국 기술산업',type:'industry',members:[
 {symbol:'005930',changePct:1.5,turnover:8000000,sourceVerified:true,source:'KR verified'},
 {symbol:'000660',changePct:2.0,turnover:6000000,sourceVerified:true,source:'KR verified'},
 {symbol:'035420',changePct:-1,turnover:2000000,sourceVerified:true,source:'KR verified'}
 ],universeCount:3,turnoverCurrency:'KRW'};
const result=E.assess({market:'KR',benchmark,candidates:[krCand]});
assert.equal(result.status,'descriptive');
assert.equal(result.candidates[0].periods['60d'].relativePp,0);
assert.equal(result.candidates[0].turnover.value,16000000);
assert.equal(result.candidates[0].memberRank.status,'sample-only');
const wrongUnit=E.assess({market:'KR',benchmark,candidates:[{...krCand,turnoverCurrency:'USD'}]});
assert.equal(wrongUnit.candidates[0].memberRank.status,'unavailable');
console.log('Sector verified history adapter and KR-market compatibility PASS');
