/* MY INVEST V2 — standalone read-only market → sector → stock report model.
 * Reuses the existing explanation and dated-observation modules exclusively.
 * No market fetch, broker access, rank/signal generation, persistence, or orders.
 * The latest report is never replaced with a previous valid day's claims.
 */
(function(root){
'use strict';
const INPUT=['market','mode','now','records'];
const LABELS=Object.freeze({
 supportive:'우호적 관찰',mixed:'혼조 관찰',defensive:'방어적 관찰',
 strong:'상대강세 관찰',weak:'상대약세 관찰',
 'aligned-watch':'계층 일치 관찰',
 'mixed-watch':'혼조 관찰',
 'defensive-watch':'방어적 관찰',
 'unavailable':'근거 부족'
});
const CHANGE=Object.freeze({
 'context-strengthened':'관찰 조건 강화',
 'context-weakened':'관찰 조건 약화',
 'layer-changed':'세부 근거 변경',
 'context-unchanged':'관찰 조건 유지',
 'evidence-recovered':'분석 근거 복구',
 'evidence-lost':'분석 근거 소실',
 'unqualified-still':'분석 보류 지속',
 'sector-reclassified':'산업 분류 변경',
 'new-observation':'이번 관찰에서 등장',
 'not-observed':'이번 관찰에서 미관측'
});
const LIMIT=Object.freeze({
 EVIDENCE_UNQUALIFIED:'비교 기간에 검증 보류된 관측일이 포함됩니다.',
 OBSERVATION_GAP_OVER_SEVEN_DAYS:'두 관찰일 간 간격이 7일을 초과합니다.',
 SOURCE_CHANGED:'데이터 출처 표시가 달라 단순 비교를 보류합니다.',
 MARKET_SAMPLE_COVERAGE_SHIFT:'시장 관측 표본 비율이 크게 달라 비교를 보류합니다.'
});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const safeSector=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,27}$/.test(x);
const safeSymbol=(x,market)=>typeof x==='string'&&(market==='KR'?/^[0-9]{6}$/.test(x):/^[A-Z][A-Z0-9.-]{0,12}$/.test(x));
const cleanString=(x,len)=>typeof x==='string'&&x.length<=len;
const hold=code=>Object.freeze({
 status:'blocked',code,headline:'투자 분석 리포트 근거 확인 보류',
 market:null,asOf:null,mode:null,marketSummary:null,
 sectorRows:Object.freeze([]),candidateRows:Object.freeze([]),
 history:Object.freeze({status:'not-comparable',observedCount:0,days:Object.freeze([]),
  lastComparison:null,reason:'분석할 수 있는 자료가 없습니다.'}),
 sources:null,limitations:Object.freeze([]),
 warnings:Object.freeze(['실제 시장 시세·휴장일·원천 진위는 검증하지 않았습니다.']),
 sourceAuthenticated:false,exchangeCalendarVerified:false,
 historicalPricesVerified:false,livePriceVerified:false,
 investmentRecommendation:false,rankingAvailable:false,
 tradeSignal:null,canPlaceOrder:false,tradeApproved:false,
 accountAccessed:false,providerCalls:0
});
function modules(){
 if(typeof module==='object'&&module.exports)return {
  timeline:require('./investment-evidence-timeline-v1.js'),
  explanation:require('./investment-evidence-explanation-v1.js')
 };
 return {timeline:root.MYInvestInvestmentEvidenceTimelineV1,
  explanation:root.MYInvestInvestmentEvidenceExplanationV1};
}
function build(input,injected){
 if(!exact(input,INPUT)||!['KR','US'].includes(input.market)||
  input.mode!=='swing'||!Number.isSafeInteger(input.now)||input.now<=0||
  !Array.isArray(input.records)||input.records.length>90)
  return hold('INVALID_OR_PRIVATE_INPUT');
 const deps=injected||modules();
 if(!deps.timeline||typeof deps.timeline.compile!=='function'||
  !deps.explanation||typeof deps.explanation.explain!=='function')
  return hold('MISSING_ANALYSIS_MODULES');
 const timeline=deps.timeline.compile(input);
 if(!obj(timeline)||timeline.status==='invalid')
  return hold('INVALID_HISTORY_INPUT');
 if(timeline.market!==input.market||timeline.mode!==input.mode||
  timeline.archiveReady!==true||timeline.stored!==false||
  timeline.orderApproved!==false||timeline.automaticTrading!==false||
  timeline.accountAccessed!==false||timeline.providerCalls!==0||
  timeline.marketPriceVerified!==false||timeline.calendarVerified!==false||
  timeline.sourceAuthenticityVerified!==false||
  !Array.isArray(timeline.snapshots)||
  timeline.snapshots.length!==input.records.length||
  !Array.isArray(timeline.comparisons)||
  timeline.comparisons.length!==Math.max(0,input.records.length-1))
  return hold('INCONSISTENT_HISTORY_OUTPUT');
 if(timeline.snapshots.length===0)return Object.freeze({
  ...hold('NO_RESEARCH_OBSERVATIONS'),status:'empty'
 });
 const last=timeline.snapshots.at(-1);
 if(!obj(last)||last.asOf!==input.records.at(-1).asOf||
  last.status==='unqualified'){
  // Earlier observations may be valid, but they do not authorize a "current"
  // market or stock conclusion after the latest evidence has failed.
  return hold('LATEST_OBSERVATION_NOT_QUALIFIED');
 }
 const current=deps.explanation.explain(input.records.at(-1).adapterOutput);
 if(!obj(current)||!['review-context-only','partial-evidence'].includes(current.status)||
  current.market!==input.market||current.mode!=='swing'||
  current.asOf!==last.asOf||
  current.realMarketDataVerified!==false||
  current.sourceAuthenticityVerified!==false||
  current.tradeApproved!==false||current.canPlaceOrder!==false||
  current.tradeSignal!==null||current.rankable!==false||
  current.confidenceScore!==null||current.humanReviewRequired!==true||
  !obj(current.marketAssessment)||!obj(current.sources)||
  current.sources.authenticity!=='CALLER_DECLARED_ONLY'||
  current.sources.benchmark!==last.benchmarkSource||
  current.sources.breadth!==last.breadthSource||
  !Array.isArray(current.candidates)||
  !Array.isArray(current.limitations)||
  !obj(input.records.at(-1).adapterOutput?.context))
  return hold('INCONSISTENT_LATEST_EXPLANATION');
 const context=input.records.at(-1).adapterOutput.context;
 if(!Array.isArray(context.sectorContexts)||context.sectorContexts.length>25||
  !finite(current.marketAssessment.breadthPct)||
  !finite(current.marketAssessment.coveragePct)||
  current.marketAssessment.breadthPct!==last.marketBreadthPct||
  current.marketAssessment.coveragePct!==last.marketCoveragePct||
  !Object.hasOwn(LABELS,last.marketPosture)||
  current.marketAssessment.title!==LABELS[last.marketPosture]||
  last.candidates.length!==current.candidates.length)
  return hold('INCONSISTENT_CURRENT_CONTEXT');
 const sectorRows=[];
 const seenSector=new Set();
 for(const s of context.sectorContexts){
  if(!obj(s)||!safeSector(s.id)||seenSector.has(s.id)||
   !['coherent','blocked'].includes(s.status)||
   !Object.hasOwn(LABELS,s.posture)||
   !finite(s.coveragePct)||!finite(s.breadthPct)||
   s.coveragePct<0||s.coveragePct>100||
   s.breadthPct<0||s.breadthPct>100)
   return hold('INCONSISTENT_SECTOR_REPORT');
  seenSector.add(s.id);
  sectorRows.push(Object.freeze({
   id:s.id,classification:LABELS[s.posture],
   eligible:s.status==='coherent',
   relative5Pct:s.status==='coherent'?s.relative5Pct:null,
   relative20Pct:s.status==='coherent'?s.relative20Pct:null,
   coveragePct:s.coveragePct,breadthPct:s.breadthPct,
   volumeRatio:s.status==='coherent'?s.volumeRatio:null,
   // This remains an observed SAMPLE, not a whole-industry market rank.
   fullIndustryRanking:false
  }));
 }
 const currentIndex=new Map();
 const candidateRows=[];
 for(let i=0;i<current.candidates.length;i++){
  const candidate=current.candidates[i],dated=last.candidates[i];
  if(!obj(candidate)||!obj(dated)||
   !safeSymbol(candidate.symbol,input.market)||
   candidate.symbol!==dated.symbol||
   candidate.sectorId!==dated.sectorId||
   candidate.observation!==dated.posture||
   candidate.readiness!==dated.readiness||
   candidate.hypotheticalRiskCeilingPct!==dated.hypotheticalRiskCeilingPct||
   !Array.isArray(candidate.evidence)||
   !Array.isArray(candidate.alerts)||
   !cleanString(candidate.explanation,250)||
   currentIndex.has(candidate.symbol))
   return hold('INCONSISTENT_CANDIDATE_REPORT');
  currentIndex.set(candidate.symbol,true);
  const included=candidate.readiness==='manual-context-review';
  if(included&&candidate.evidence.length!==3)
   return hold('INCONSISTENT_CANDIDATE_EVIDENCE');
  const layers=included?candidate.evidence.map(x=>{
   if(!['market','sector','stock'].includes(x?.layer)||
    !cleanString(x.title,90)||!cleanString(x.text,250))return null;
   return Object.freeze({layer:x.layer,title:x.title,text:x.text});
  }):[];
  if(layers.some(x=>x===null))
   return hold('INCONSISTENT_CANDIDATE_EVIDENCE');
  const row=Object.freeze({
   symbol:candidate.symbol,sectorId:candidate.sectorId,
   status:included?'manual-review-only':'insufficient-evidence',
   observation:included?LABELS[candidate.observation]:'근거 부족',
   explanation:candidate.explanation,
   layers:Object.freeze(layers),
   alerts:Object.freeze(candidate.alerts.filter(x=>cleanString(x,170)).slice(0,20)),
   hypotheticalPolicyRiskCeilingPct:candidate.hypotheticalRiskCeilingPct,
   isRecommended:false,tradeSignal:null,orderApproved:false
  });
  candidateRows.push(row);
 }
 const days=timeline.snapshots.slice(-12).map(s=>Object.freeze({
  asOf:s.asOf,quality:s.status,
  marketClassification:s.marketPosture===null?'검증 보류':LABELS[s.marketPosture],
  candidateObservations:s.candidates.length
 }));
 const latestPair=timeline.comparisons.at(-1)||null;
 let historyStatus='no-prior',reason='비교할 이전 관측일이 없습니다.',changes=[];
 if(latestPair){
  if(latestPair.status==='not-comparable'){
   historyStatus='withheld';
   reason=latestPair.limitations.map(x=>LIMIT[x]||'관찰 근거가 일치하지 않습니다.').join(' ');
  }else if(latestPair.status==='adjacent-observations-only'){
   historyStatus='adjacent-observations-only';
   reason='저장된 두 관찰일의 분류만 비교했습니다. 연속 거래일·실제 수익률은 확인되지 않았습니다.';
   changes=latestPair.candidateChanges.map(x=>Object.freeze({
    symbol:x.symbol,
    event:Object.hasOwn(CHANGE,x.event)?x.event:'layer-changed',
    description:CHANGE[x.event]||'변화 관찰',
    previous:x.previous===null?'미관측':LABELS[x.previous],
    current:x.current===null?'미관측':LABELS[x.current],
    tradeSignal:null
   }));
  }else return hold('INCONSISTENT_HISTORY_PAIR');
 }
 if(historyStatus==='adjacent-observations-only'&&
  changes.some(x=>x.symbol!==null&&!safeSymbol(x.symbol,input.market)))
  return hold('INCONSISTENT_HISTORY_SYMBOL');
 const result={
  status:current.status==='review-context-only'?'manual-review':'partial-evidence',
  code:null,
  headline:'시장·산업·종목 근거 분석 리포트',
  market:input.market,mode:'swing',asOf:last.asOf,
  marketSummary:Object.freeze({
   benchmark:current.benchmark,
   classification:current.marketAssessment.title,
   explanation:current.marketAssessment.explanation,
   breadthPct:current.marketAssessment.breadthPct,
   coveragePct:current.marketAssessment.coveragePct
  }),
  sectorRows:Object.freeze(sectorRows),candidateRows:Object.freeze(candidateRows),
  history:Object.freeze({
   status:historyStatus,
   observedCount:timeline.snapshots.length,days:Object.freeze(days),
   lastComparison:latestPair?Object.freeze({
    from:latestPair.from,to:latestPair.to,
    calendarDaysApart:latestPair.calendarDaysApart,
    consecutiveMarketSessionsVerified:false,
    marketClassificationShift:latestPair.status==='not-comparable'?null:
     latestPair.marketClassificationShift,
    changes:Object.freeze(changes)
   }):null,
   reason
  }),
  sources:Object.freeze({
   benchmark:current.sources.benchmark,breadth:current.sources.breadth,
   providerAuthenticated:false
  }),
  limitations:Object.freeze(current.limitations.filter(x=>cleanString(x,250)).slice(0,10)),
  warnings:Object.freeze([
   '합성·외부 제공 데이터의 형식상 분석입니다. 실제 시세·원천 진위·휴장일을 확인하지 않았습니다.',
   '강세·약세는 관찰 분류이며 수익률·매매 신호·확정된 주도주 순위가 아닙니다.',
   '위험예산 상한은 가상 정책값입니다. 실제 계좌·주문·보유 종목과 연결하지 않았습니다.'
  ]),
  sourceAuthenticated:false,exchangeCalendarVerified:false,
  historicalPricesVerified:false,livePriceVerified:false,
  investmentRecommendation:false,rankingAvailable:false,
  tradeSignal:null,canPlaceOrder:false,tradeApproved:false,
  accountAccessed:false,providerCalls:0
 };
 return Object.freeze(result);
}
const api=Object.freeze({build});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestInvestmentResearchReportV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
