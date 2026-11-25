(function(root){'use strict';
/**
 * Pure bridge from page-sectors SERIES_CACHE to the verified US sector ETF
 * rotation engine. No fetch or writes; no breadth/flow invented from ETFs.
 */
function evaluate({market='US',benchmark,rows=[],nowDay}={}){
 if(market!=='US'||!Array.isArray(rows)||!Array.isArray(benchmark?.bars))
  return {status:'unavailable',reason:'검증된 미국 섹터 ETF 캐시 미연결'};
 const adapter=root.MYInvestSectorSeriesAdapter,engine=root.MYInvestSectorRotation;
 if(!adapter?.adaptCached||!engine?.assess)
  return {status:'unavailable',reason:'엄격한 산업 로테이션 모듈 미연결'};
 const base=adapter.adaptCached(benchmark,{symbol:'SPY',market:'US'});
 if(base.status!=='ready')return {status:'unavailable',reason:'SPY 검증 거래일 또는 종가 미확인'};
 const candidates=[];
 for(const r of rows){
  if(!r?.v||typeof r.symbol!=='string')continue;
  const value=adapter.adaptCached(r.v,{symbol:r.symbol,market:'US'});
  if(value.status!=='ready')continue;
  candidates.push({id:r.symbol,name:typeof r.name==='string'?r.name.slice(0,100):r.symbol,
    market:'US',currency:'USD',type:'sector_etf_proxy',verified:true,
    source:value.source,bars:value.bars});
 }
 if(!candidates.length)return {status:'unavailable',reason:'동일 거래일 확정봉을 가진 섹터 ETF 없음'};
 const result=engine.assess({
  market:'US',benchmark:{market:'US',symbol:'SPY',verified:true,source:base.source,bars:base.bars},
  candidates,nowDay
 });
 return {...result,scope:'제공된 ETF 중 검증된 확정 일봉 표본 · 미국 전체 산업·자금유입 아님'};
}
const api=Object.freeze({evaluate});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestSectorCacheRotationBridge=api;
})(globalThis);
