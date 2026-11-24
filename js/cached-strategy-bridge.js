(function(root){'use strict';
/*
 * Cached investment decision-support bridge. PURE, NO API, NO STORAGE.
 * Receives already proven stock setup, market regime and PUBLIC event cache.
 * Industry association is withheld unless independently verified.
 * Private holding rows are used only as transient inputs to strategy engine.
 */
const CODE=/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
function evaluate({selection,stockSetup,marketRegime=null,publicEvents=null,
 sector=null,sectorLink=null,holdingRows=[],nowDay}={}){
 const symbol=selection?.symbol,market=selection?.market,mode=selection?.mode==='day'?'day':'swing';
 if(!CODE.test(symbol||'')||!['KR','US'].includes(market)||
  (market==='KR')!==/^\d{6}$/.test(symbol)||!/^\d{4}-\d{2}-\d{2}$/.test(nowDay||''))
  return {status:'unavailable',reason:'종목·시장·기준일 검증 실패',candidate:null,holdings:[],queue:null};
 const engine=root.MYInvestIntegratedStrategy,eventsAdapter=root.MYInvestIntegratedEventAdapter;
 const queueEngine=root.MYInvestOpportunityQueue;
 if(!engine?.assess||!eventsAdapter?.eventsFromPublicContext||!queueEngine?.collect)
  return {status:'unavailable',reason:'통합 투자전략 모듈 미연결',candidate:null,holdings:[],queue:null};
 if(stockSetup?.status!=='descriptive'||stockSetup.symbol!==symbol||
  stockSetup.market!==market||stockSetup.mode!==mode)
  return {status:'insufficient',reason:'검증된 확정 일봉 기술 분석 부족',candidate:null,holdings:[],queue:null};
 const event=eventsAdapter.eventsFromPublicContext(publicEvents,{symbol,market,asOf:nowDay,mode});
 const hasSectorEvidence=sector?.status==='descriptive'&&sectorLink?.verified===true&&
  sectorLink.symbol===symbol&&sectorLink.market===market&&sectorLink.sectorId===sector.id&&
  sectorLink.asOf===stockSetup.asOf;
 // A sector ETF rank is never by itself a security-to-sector membership proof.
 const scopedSector=hasSectorEvidence?sector:null,scopedLink=hasSectorEvidence?sectorLink:null;
 let candidate;
 try{candidate=engine.assess({intent:'candidate',mode,stock:stockSetup,regime:marketRegime,
  sector:scopedSector,sectorLink:scopedLink,event,nowDay})}
 catch{return {status:'unavailable',reason:'통합 전략 평가 실패',candidate:null,holdings:[],queue:null}}
 // All records must first pass InvestWorkflow.holdings(ctx,selection,analysis).
 // Fail closed on unsupported currency/issuer identity or missing positive cost.
 const validated=Array.isArray(holdingRows)?holdingRows.filter(x=>x?.symbol===symbol&&
  x.market===market&&x.currency===(market==='KR'?'KRW':'USD')&&
  x.verified===true&&Number.isFinite(x.quantity)&&x.quantity>0&&
  Number.isFinite(x.avgPrice)&&x.avgPrice>0).slice(0,100):[];
 const holdings=[];
 for(const record of validated){
  try{
   const result=engine.assess({intent:'holding',mode,stock:stockSetup,regime:marketRegime,
    sector:scopedSector,sectorLink:scopedLink,event,holding:record,nowDay});
   // Do not send even the relative-to-cost percent into the output UI DTO.
   holdings.push({status:result.status,label:result.label,blocking:result.blocking.slice(0,15),
    reasons:result.reasons.slice(0,15),asOf:result.asOf});
  }catch{}
 }
 let queue=null;
 try{
  // A review queue is keyed on one symbol per intent. If there are multiple
  // accounts for the same issuer, omit the holding queue, never pick one.
  const queueHolding=validated.length===1?
   [engine.assess({intent:'holding',mode,stock:stockSetup,regime:marketRegime,
    sector:scopedSector,sectorLink:scopedLink,event,holding:validated[0],nowDay})]:[];
  queue=queueEngine.collect({mode,nowDay,candidates:[candidate],holdings:queueHolding,maxResults:10});
 }catch{queue=null}
 return {status:candidate.status==='insufficient'?'insufficient':'review-required',
  symbol,market,mode,asOf:stockSetup.asOf,
  candidate:{status:candidate.status,label:candidate.label,
   blocking:candidate.blocking.slice(0,18),reasons:candidate.reasons.slice(0,18),
   conditions:candidate.conditions.slice(0,18),
   action:candidate.action,verifiedEvents:event.events?.length||0,
   eventCoverage:event.coverageVerified===true?'complete':'partial'},
  holdings,holdingCount:holdings.length,
  holdingQueueAvailable:holdings.length===1,queue:queue?{
   candidateQueue:queue.candidateQueue.items.map(x=>({reviewLane:x.reviewLane,blocked:x.blocked,
    requiresEvidence:x.requiresEvidence,label:x.label})),
   holdingQueue:queue.holdingQueue.items.map(x=>({reviewLane:x.reviewLane,blocked:x.blocked,
    requiresEvidence:x.requiresEvidence,label:x.label}))
  }:null,
  disclaimer:'기존 캐시 기반 재평가 · 신규 후보와 보유종목은 별개 · 데이터 부족이면 판단 보류 · 실제 주문/발송 없음'};
}
const api=Object.freeze({evaluate});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestCachedStrategyBridge=api;
})(globalThis);
