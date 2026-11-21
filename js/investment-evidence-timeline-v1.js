/* MY INVEST V2 — offline evidence-history compiler V1.
 * Caller supplies archived outputs of the EXISTING validated adapter.
 * Re-evaluates their explanations; retains only safe derived classifications.
 * No clock fallback, market API, network, storage, trading or portfolio access.
 * Observations are discrete snapshots, NOT continuous market performance.
 */
(function(root){
'use strict';
const LIMITS=Object.freeze({records:90,candidates:60,recordBytes:196608,
 gapDays:7,maxCoverageShiftPoints:15,graceMs:300000});
const ROOT_KEYS=Object.freeze(['market','mode','now','records']);
const RECORD_KEYS=Object.freeze(['asOf','capturedAt','adapterOutput']);
const POSTURE=Object.freeze({'defensive-watch':0,'mixed-watch':1,'aligned-watch':2});
const MARKET_POSTURE=Object.freeze({defensive:0,mixed:1,supportive:2});
const STATUS_LABELS=Object.freeze({
 'context-strengthened':'관찰 조건 강화',
 'context-weakened':'관찰 조건 약화',
 'layer-changed':'계층별 판단 변화',
 'context-unchanged':'관찰 조건 유지',
 'evidence-recovered':'자료 검증 가능 상태로 전환',
 'evidence-lost':'자료 검증 근거 소실',
 'unqualified-still':'검증 불가 상태 지속',
 'sector-reclassified':'산업 분류 변경',
 'new-observation':'이번 관측에서 처음 등장',
 'not-observed':'이번 관측에서 미관측'
});
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const safeTime=t=>Number.isSafeInteger(t)&&t>0&&t<8640000000000000;
const numeric=x=>typeof x==='number'&&Number.isFinite(x);
const localDate=x=>{
 if(typeof x!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(x))return false;
 const year=Number(x.slice(0,4)),month=Number(x.slice(5,7)),day=Number(x.slice(8));
 const d=new Date(Date.UTC(year,month-1,day));
 return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day;
};
const days=(a,b)=>(Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000;
const fail=code=>Object.freeze({
 status:'invalid',code,market:null,mode:null,firstDate:null,lastDate:null,
 snapshots:Object.freeze([]),comparisons:Object.freeze([]),
 archiveReady:false,automaticTrading:false,orderApproved:false,
 marketPriceVerified:false,accountAccessed:false,providerCalls:0
});
const freezeList=x=>Object.freeze(x.map(Object.freeze));
function dependencies(){
 if(typeof module==='object'&&module.exports)return {
  explanation:require('./investment-evidence-explanation-v1.js'),
  alignment:require('./market-sector-stock-alignment-v1.js')
 };
 return {
  explanation:root.MYInvestInvestmentEvidenceExplanationV1,
  alignment:root.MYInvestMarketSectorStockAlignmentV1
 };
}
function cleanSize(raw){
 try{const json=JSON.stringify(raw);return json===undefined?null:json.length}
 catch{return null}
}
function normalize(record,market,mode,now,previousDay,previousCaptured,deps){
 if(!exact(record,RECORD_KEYS)||!localDate(record.asOf)||
  !safeTime(record.capturedAt)||record.capturedAt>now+LIMITS.graceMs||
  (previousDay!==null&&record.asOf<=previousDay)||
  (previousCaptured!==null&&record.capturedAt<=previousCaptured)||
  cleanSize(record.adapterOutput)===null||
  cleanSize(record.adapterOutput)>LIMITS.recordBytes)
  return {error:'INVALID_OR_UNSORTED_RECORD'};
 const dateAtCapture=deps.alignment.localDay(record.capturedAt,market);
 if(!dateAtCapture||dateAtCapture<record.asOf)
  return {error:'CAPTURE_BEFORE_LOCAL_OBSERVATION_DATE'};
 const explanation=deps.explanation.explain(record.adapterOutput);
 if(!explanation||typeof explanation.status!=='string')
  return {error:'EXPLANATION_UNAVAILABLE'};
 if(explanation.status==='blocked'){
  const incoming=record.adapterOutput;
  if(!obj(incoming)||incoming.status!=='blocked'||
   !Array.isArray(incoming.details)||incoming.details.length>20||
   incoming.details.some(x=>!exact(x,['index'])||
    !Number.isSafeInteger(x.index)||x.index<0||x.index>60)||
   ['INVALID_EXPLANATION_INPUT','INPUT_QUALITY_UNCERTAIN'].includes(explanation.code))
   return {error:'INVALID_ARCHIVED_EVIDENCE'};
  return {snapshot:Object.freeze({
   asOf:record.asOf,capturedAt:record.capturedAt,status:'unqualified',
   marketPosture:null,marketBreadthPct:null,marketCoveragePct:null,
   benchmarkSource:null,breadthSource:null,
   issues:Object.freeze([explanation.code]),candidates:Object.freeze([])
  })};
 }
 if(!['review-context-only','partial-evidence'].includes(explanation.status)||
  explanation.market!==market||explanation.mode!==mode||
  explanation.asOf!==record.asOf||
  explanation.realMarketDataVerified!==false||
  explanation.sourceAuthenticityVerified!==false||
  explanation.confidenceScore!==null||explanation.rankable!==false||
  explanation.tradeApproved!==false||explanation.canPlaceOrder!==false||
  !obj(explanation.sources)||!obj(explanation.marketAssessment)||
  !Array.isArray(explanation.candidates)||
  explanation.candidates.length>LIMITS.candidates)
  return {error:'INCONSISTENT_ARCHIVED_REPORT'};
 const candidates=[];
 for(const x of explanation.candidates){
  if(!obj(x)||!['blocked','manual-context-review'].includes(x.readiness)||
   x.tradeSignal!==null||x.ranking!==null||x.probability!==null||
   !(x.symbol===null||(typeof x.symbol==='string'&&
    (market==='KR'?/^[0-9]{6}$/:/^[A-Z][A-Z0-9.-]{0,12}$/).test(x.symbol)))||
   !(x.sectorId===null||(typeof x.sectorId==='string'&&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,27}$/.test(x.sectorId)))||
   !Array.isArray(x.evidence)||x.evidence.length>3||
   !Array.isArray(x.alerts)||x.alerts.length>20)
   return {error:'INVALID_ARCHIVED_CANDIDATE'};
  const blockers=x.readiness==='blocked';
  if((blockers&&x.hypotheticalRiskCeilingPct!==null)||
   (!blockers&&(!Object.hasOwn(POSTURE,x.observation)||
    !numeric(x.hypotheticalRiskCeilingPct)||
    x.hypotheticalRiskCeilingPct<0||x.hypotheticalRiskCeilingPct>1.5||
    x.evidence.length!==3)))
   return {error:'INVALID_ARCHIVED_CANDIDATE'};
  candidates.push(Object.freeze({
   symbol:x.symbol,sectorId:x.sectorId,readiness:x.readiness,
   posture:blockers?null:x.observation,
   marketLabel:blockers?null:x.evidence[0].title,
   sectorLabel:blockers?null:x.evidence[1].title,
   stockLabel:blockers?null:x.evidence[2].title,
   hypotheticalRiskCeilingPct:blockers?null:x.hypotheticalRiskCeilingPct,
   issueCount:x.alerts.length
  }));
 }
 const m=explanation.marketAssessment;
 if(!numeric(m.breadthPct)||!numeric(m.coveragePct)||
  m.breadthPct<0||m.breadthPct>100||m.coveragePct<60||m.coveragePct>100||
  !['우호적 관찰','혼조 관찰','방어적 관찰'].includes(m.title)||
  typeof explanation.sources.benchmark!=='string'||
  typeof explanation.sources.breadth!=='string'||
  !/^[A-Z][A-Z0-9_-]{0,15}$/.test(explanation.sources.benchmark)||
  !/^[A-Z][A-Z0-9_-]{0,15}$/.test(explanation.sources.breadth))
  return {error:'INVALID_ARCHIVED_MARKET_CONTEXT'};
 const posture=m.title==='우호적 관찰'?'supportive':
  m.title==='방어적 관찰'?'defensive':'mixed';
 return {snapshot:Object.freeze({
  asOf:record.asOf,capturedAt:record.capturedAt,
  status:explanation.status==='review-context-only'?
   'structurally-comparable':'partially-comparable',
  marketPosture:posture,marketBreadthPct:m.breadthPct,
  marketCoveragePct:m.coveragePct,
  benchmarkSource:explanation.sources.benchmark,
  breadthSource:explanation.sources.breadth,
  issues:Object.freeze([]),candidates:Object.freeze(candidates)
 })};
}
function change(before,after){
 if(!before)return Object.freeze({
  symbol:after.symbol,sectorIdBefore:null,sectorIdAfter:after.sectorId,
  previous:null,current:after.posture,
  event:'new-observation',label:STATUS_LABELS['new-observation'],
  confidenceScore:null,tradeSignal:null
 });
 if(!after)return Object.freeze({
  symbol:before.symbol,sectorIdBefore:before.sectorId,sectorIdAfter:null,
  previous:before.posture,current:null,
  event:'not-observed',label:STATUS_LABELS['not-observed'],
  confidenceScore:null,tradeSignal:null
 });
 let event;
 if(before.readiness==='blocked'&&after.readiness==='blocked')
  event='unqualified-still';
 else if(before.readiness==='blocked')event='evidence-recovered';
 else if(after.readiness==='blocked')event='evidence-lost';
 else if(before.sectorId!==after.sectorId)event='sector-reclassified';
 else if(POSTURE[after.posture]>POSTURE[before.posture])event='context-strengthened';
 else if(POSTURE[after.posture]<POSTURE[before.posture])event='context-weakened';
 else if(before.marketLabel!==after.marketLabel||
  before.sectorLabel!==after.sectorLabel||
  before.stockLabel!==after.stockLabel)event='layer-changed';
 else event='context-unchanged';
 return Object.freeze({
  symbol:after.symbol,sectorIdBefore:before.sectorId,
  sectorIdAfter:after.sectorId,previous:before.posture,current:after.posture,
  event,label:STATUS_LABELS[event],confidenceScore:null,tradeSignal:null
 });
}
function compare(a,b){
 const gap=days(a.asOf,b.asOf);
 const issues=[];
 if(a.status==='unqualified'||b.status==='unqualified')issues.push('EVIDENCE_UNQUALIFIED');
 if(gap>LIMITS.gapDays)issues.push('OBSERVATION_GAP_OVER_SEVEN_DAYS');
 if(a.benchmarkSource!==b.benchmarkSource||a.breadthSource!==b.breadthSource)
  issues.push('SOURCE_CHANGED');
 if(a.marketCoveragePct!==null&&b.marketCoveragePct!==null&&
  Math.abs(a.marketCoveragePct-b.marketCoveragePct)>LIMITS.maxCoverageShiftPoints)
  issues.push('MARKET_SAMPLE_COVERAGE_SHIFT');
 const comparable=issues.length===0;
 const prior=new Map(a.candidates.filter(x=>x.symbol!==null).map(x=>[x.symbol,x]));
 const current=new Map(b.candidates.filter(x=>x.symbol!==null).map(x=>[x.symbol,x]));
 const symbols=[...new Set([...prior.keys(),...current.keys()])].sort();
 const changes=comparable?symbols.map(symbol=>change(prior.get(symbol),current.get(symbol))):[];
 const marketShift=comparable?
  (MARKET_POSTURE[b.marketPosture]>MARKET_POSTURE[a.marketPosture]?'classified-strengthened':
   MARKET_POSTURE[b.marketPosture]<MARKET_POSTURE[a.marketPosture]?'classified-weakened':
   'classification-unchanged'):null;
 return Object.freeze({
  from:a.asOf,to:b.asOf,calendarDaysApart:gap,consecutiveMarketSessionsVerified:false,
  status:comparable?'adjacent-observations-only':'not-comparable',
  limitations:Object.freeze(issues),
  previousMarketPosture:a.marketPosture,
  currentMarketPosture:b.marketPosture,marketClassificationShift:marketShift,
  candidateChanges:Object.freeze(changes),
  inferredPriceReturn:null,rankingsAvailable:false,tradeSignal:null
 });
}
function compile(input){
 if(!exact(input,ROOT_KEYS)||
  !['KR','US'].includes(input.market)||input.mode!=='swing'||
  !safeTime(input.now)||!Array.isArray(input.records)||
  input.records.length>LIMITS.records)
  return fail('INVALID_OR_PRIVATE_INPUT');
 const d=dependencies();
 if(!d.explanation||typeof d.explanation.explain!=='function'||
  !d.alignment||typeof d.alignment.localDay!=='function')
  return fail('MISSING_EXISTING_EVIDENCE_DEPENDENCY');
 const snapshots=[];let prevDate=null,prevCaptured=null;
 for(const r of input.records){
  const data=normalize(r,input.market,input.mode,input.now,prevDate,prevCaptured,d);
  if(data.error)return fail(data.error);
  snapshots.push(data.snapshot);
  prevDate=r.asOf;prevCaptured=r.capturedAt;
 }
 const pairs=[];
 for(let i=1;i<snapshots.length;i++)pairs.push(compare(snapshots[i-1],snapshots[i]));
 const observationsWithEvidence=snapshots.filter(s=>s.status!=='unqualified').length;
 const result={
  status:snapshots.length===0?'empty':
   observationsWithEvidence===0?'all-unqualified':
   observationsWithEvidence===snapshots.length?'compiled':'partial',
  market:input.market,mode:'swing',
  firstDate:snapshots[0]?.asOf||null,lastDate:snapshots.at(-1)?.asOf||null,
  snapshots:Object.freeze(snapshots),comparisons:Object.freeze(pairs),
  coverage:Object.freeze({
   observedDays:snapshots.length,
   structurallyUsableDays:observationsWithEvidence,
   unqualifiedDays:snapshots.length-observationsWithEvidence,
   comparablePairs:pairs.filter(p=>p.status==='adjacent-observations-only').length,
   withheldPairs:pairs.filter(p=>p.status==='not-comparable').length
  }),
  archiveReady:true,stored:false,
  sourceAuthenticityVerified:false,calendarVerified:false,
  actualPricePerformanceComputed:false,
  trendIsOnlyChangeInClassification:true,
  automaticTrading:false,orderApproved:false,marketPriceVerified:false,
  accountAccessed:false,providerCalls:0
 };
 return Object.freeze(result);
}
const api=Object.freeze({compile,LIMITS});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestInvestmentEvidenceTimelineV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
