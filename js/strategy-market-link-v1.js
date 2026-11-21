/* Public analysis -> comparison adapter. No provider/account/order/storage calls.
 * Reuses the existing workflow's conditional scenarios, not new signal math.
 */
(function(root){
'use strict';
const failed=code=>({status:'unavailable',code});
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const validTime=(n,now)=>Number.isSafeInteger(n)&&n>0&&n<=now;
function project(analysis,selection,{now=Date.now(),scenarios=[]}={}){
 if(!Number.isSafeInteger(now)||!selection||typeof selection.symbol!=='string')return failed('NO_SELECTION');
 const symbol=selection.symbol,kr=/^\d{6}$/.test(symbol),market=kr?'KR':'US',currency=kr?'KRW':'USD';
 if(!/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(symbol)||selection.market!==market)return failed('INVALID_SELECTION');
 if(!analysis||analysis.symbol!==symbol||analysis.currency!==currency)return failed('ANALYSIS_IDENTITY_MISMATCH');
 const exchange=analysis.exchange;
 const domestic=/^(KSC|KOSPI|KRX|SEOUL)$/.test(exchange)?'.KS':/^(KOE|KOSDAQ)$/.test(exchange)?'.KQ':null;
 if(kr?(!domestic||analysis.provider!==symbol+domestic):
    (!['NMS','NGM','NCM','NYQ','PCX','ASE','BTS'].includes(exchange)||analysis.provider!==symbol))return failed('PROVIDER_EXCHANGE_MISMATCH');
 if(typeof analysis.source!=='string'||!analysis.source.trim()||analysis.source.length>200)return failed('SOURCE_MISSING');
 if(!validTime(analysis.observedAt,now)||!validTime(analysis.receivedAt,now)||
    analysis.receivedAt<analysis.observedAt||now-analysis.observedAt>4*86400000||now-analysis.receivedAt>300000)return failed('STALE_OR_MISSING_TIME');
 const bars=analysis.bars;if(!Array.isArray(bars)||bars.length<60)return failed('INSUFFICIENT_BARS');
 let prior=0;
 for(const b of bars){
  if(!b||!validTime(b.t,now)||b.t<=prior||![b.o,b.h,b.l,b.c].every(positive)||
     b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h))return failed('INVALID_BARS');
  prior=b.t;
 }
 const last=bars.at(-1);
 if(last.t!==analysis.observedAt||analysis.metrics?.last!==last.c)return failed('BAR_REFERENCE_MISMATCH');
 const cases=Array.isArray(scenarios)?scenarios.filter(s=>s&&typeof s.name==='string'&&s.name.length<=80&&
  [s.entry,s.stop,s.target2].every(positive)&&s.stop<s.entry&&s.entry<s.target2).slice(0,2).map(s=>({name:s.name,entry:s.entry,stop:s.stop,target:s.target2})):[];
 return {status:'ready',symbol,name:typeof selection.name==='string'?selection.name.slice(0,120):symbol,
  market,currency,exchange,source:analysis.source,lastClose:last.c,
  barAt:last.t,receivedAt:analysis.receivedAt,cases,daySignalsAvailable:false,
  priceBasis:'DAILY_BAR_C_NOT_REALTIME_OR_FINALIZED',dailyFinalizedVerified:false,accountConnected:false};
}
const api=Object.freeze({project});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestStrategyMarketLinkV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
