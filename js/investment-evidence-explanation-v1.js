/* MY INVEST V2 — Korean evidence explanations for existing research only.
 * No API, price fetch, account access, execution, optimization, ranking,
 * prediction, or model-generated probability. Callers must use the verified
 * adapter output; this module never certifies provider authenticity.
 */
(function(root){
'use strict';
const ADAPTER=['status','context','mapping','marketSources','observationsComparableNotAuthenticated',
 'dataVerified','realTimeVerified','tradeApproved','canPlaceOrder','accountAccessed','providerCalls'];
const BLOCK=['status','code','details','comparison','dataVerified','realTimeVerified',
 'tradeApproved','canPlaceOrder','accountAccessed','providerCalls'];
const CONTEXT=['status','market','mode','asOf','benchmark','marketContext','sectorContexts',
 'candidates','coverage','methodology','sourceAuthenticityVerified','exchangeHolidayVerified',
 'phaseExternallyVerified','marketDataVerified','intradayDataVerified','tradingRecommendation',
 'automaticOrders','accountsAccessed','providerCalls'];
const MARKET=['status','issues','asOf','phase','posture','coveragePct','breadthPct'];
const SECTOR=['id','status','issues','posture','breadthPct','coveragePct',
 'relative5Pct','relative20Pct','volumeRatio'];
const CANDIDATE=['symbol','sectorId','status','posture','issues','marketPosture','sectorPosture',
 'stockPosture','hypotheticalPolicyRiskCeilingPct','riskMultiplierIllustration',
 'hypotheticalOnly','tradeSignal','verifiedMarketPrice'];
const METHOD=['baseRiskPct','observationsMustShareLocalTradingDay','minimumCoveragePct',
 'receiptAgeLimitMinutes','observationAgeLimitHours','riskCapMeaning',
 'rankingAllowed','stockEntryTimingVerified'];
const COVER=['sectorsSupplied','stocksSupplied','stockObservationsCoherent'];
const MAPPING=['market','sectors','stocks','movingAverage','blockedDayTrading'];
const STATE=Object.freeze({
 market:Object.freeze({
  supportive:['우호적 관찰','시장 수익률과 상승종목 폭이 설정된 우호 조건을 충족합니다.'],
  mixed:['혼조 관찰','시장 추세와 상승종목 폭이 일치하지 않습니다.'],
  defensive:['방어적 관찰','중기 수익률 또는 상승종목 폭이 방어적 조건에 해당합니다.']
 }),
 sector:Object.freeze({
  strong:['상대강세 관찰','기준지수 대비 5·20거래일 상대강도와 구성종목 폭·거래량 조건이 우호적입니다.'],
  mixed:['혼조 관찰','산업 상대강도·구성종목 폭·거래량 조건이 동시에 우호적이지 않습니다.'],
  weak:['상대약세 관찰','산업 상대강도나 구성종목 상승폭이 취약합니다.']
 }),
 stock:Object.freeze({
  strong:['모멘텀 관찰','5·20일 상대강도와 종가·거래량·거래대금 조건이 우호적입니다.'],
  mixed:['혼조 관찰','종목 상대강도 또는 거래활동 조건이 일부 미충족입니다.'],
  weak:['약세 관찰','종목 모멘텀 또는 20일 이동평균 대비 위치가 취약합니다.']
 })
});
const FAILURE=Object.freeze({
 INVALID_OR_PRIVATE_INPUT:'허용되지 않는 입력 또는 비공개 정보가 포함될 수 있습니다.',
 DAY_INTRADAY_EVIDENCE_NOT_CONNECTED:'단타용 확정 분봉 자료가 연결되지 않았습니다.',
 MISSING_EXISTING_ANALYSIS_DEPENDENCY:'기존 시장·산업·종목 분석 의존성이 준비되지 않았습니다.',
 BENCHMARK_EVIDENCE_INVALID:'기준지수의 식별자 또는 종가 관측 근거를 확인해야 합니다.',
 BENCHMARK_DAILY_SERIES_INVALID:'기준지수 일봉의 날짜·가격·거래량 구성이 일치하지 않습니다.',
 BENCHMARK_METRICS_UNAVAILABLE:'기준지수의 5·20일 분석 근거가 부족합니다.',
 MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY:'시장 전체 상승종목 표본의 범위와 관측일을 확인해야 합니다.',
 SECTOR_SOURCE_OR_ID_INVALID:'산업 식별자·관측일 또는 시계열 확인이 필요합니다.',
 SECTOR_MEMBER_EVIDENCE_INVALID:'산업 구성종목의 출처·관측시각·거래일이 일치하지 않습니다.',
 SECTOR_SAMPLE_INSUFFICIENT:'산업 구성종목 표본이 최소 커버리지에 미달합니다.',
 SECTOR_METRICS_UNAVAILABLE:'기존 산업 상대강도 분석에 필요한 자료가 부족합니다.',
 STOCK_SOURCE_OR_ID_INVALID:'종목 식별자·산업 연결 또는 일봉 정합성이 부족합니다.',
 STOCK_TECHNICAL_SNAPSHOT_MISMATCH:'종목 기술분석과 종가·모멘텀·거래량 근거가 불일치합니다.',
 STOCK_TREND_NOT_UP:'스윙 기술분석의 상승 추세 조건이 충족되지 않았습니다.',
 STOCK_MA20_INVALID:'종목의 20일 이동평균 계산에 필요한 종가가 부족합니다.',
 ALIGNMENT_EVIDENCE_REJECTED:'시장·산업·종목 증거의 교차 검증을 통과하지 못했습니다.'
});
const ISSUE=Object.freeze({
 MARKET_EVIDENCE_BLOCKED:'시장 관측 근거가 검증되지 않았습니다.',
 SECTOR_EVIDENCE_BLOCKED:'연결된 산업 관측 근거가 검증되지 않았습니다.',
 SECTOR_NOT_FOUND:'종목의 산업 연결 정보가 없습니다.',
 DUPLICATE_SECTOR_ID:'산업 식별자가 중복됩니다.',
 DUPLICATE_STOCK_ID:'종목 식별자가 중복됩니다.',
 OBSERVATION_TIME_MISSING:'원천 관측시각이 없습니다.',
 RECEIPT_TIME_MISSING:'자료 수신시각이 없습니다.',
 TRADE_DATE_MISMATCH:'현지 거래일이 일치하지 않습니다.',
 SOURCE_UNIDENTIFIED:'출처 표기가 불명확합니다.',
 INVALID_OR_PRIVATE_RECORD_FIELDS:'레코드 입력을 확인해야 합니다.'
});
const LIMITATIONS=Object.freeze([
 '자료 제공처 표기는 호출자 선언이며 거래소·원천 진위 인증이 아닙니다.',
 '거래소 휴장일·조기폐장 및 확정 종가 여부를 공식적으로 검증하지 않았습니다.',
 '조정주가·배당·분할·유동성·세금·실제 체결 가능성은 미검증입니다.',
 '일봉 분석은 단타 분봉 타이밍 또는 호가의 실시간성을 입증하지 않습니다.',
 '가상 위험예산 상한은 개발 정책값이며 매수 비중이나 주문 지시가 아닙니다.'
]);
const obj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const exact=(o,keys)=>obj(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const num=o=>typeof o==='number'&&Number.isFinite(o);
const between=(v,a,b)=>num(v)&&v>=a&&v<=b;
const symbol=(s,m)=>typeof s==='string'&&(m==='KR'?/^[0-9]{6}$/.test(s):/^[A-Z][A-Z0-9.-]{0,12}$/.test(s));
const sector=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,27}$/.test(s);
const source=s=>typeof s==='string'&&/^[A-Z][A-Z0-9_-]{0,15}$/.test(s);
const date=s=>{
 if(typeof s!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(s))return false;
 const y=Number(s.slice(0,4)),m=Number(s.slice(5,7)),d=Number(s.slice(8));
 const v=new Date(Date.UTC(y,m-1,d));
 return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d;
};
function safeIssues(v){
 if(!Array.isArray(v)||v.length>20||
  v.some(x=>typeof x!=='string'||!/^[A-Z0-9_]{1,70}$/.test(x)))return null;
 return [...new Set(v)].map(x=>ISSUE[x]||'추가 검증 항목을 확인해야 합니다.');
}
function markdown(result){
 const header='# 시장·산업·종목 판단 근거 — 가상 분석·원천 미인증\n\n';
 if(result.status==='blocked')
  return header+'**분석 보류:** 입력 또는 관측 근거를 다시 확인해야 합니다.\n\n'+
   '실제 매수·매도·주문을 승인한 사실은 없습니다.\n';
 let s=header+'- 시장: '+(result.market==='KR'?'한국':'미국')+
  ' / 현지 거래일(제공 자료): '+result.asOf+'\n'+
  '- 시장 관찰: '+result.marketAssessment.title+'\n'+
  '- 원천 ID: 지수 '+result.sources.benchmark+' · 시장 폭 '+result.sources.breadth+
  ' (진위 미인증)\n'+
  '- **수동 검토 전용, 종목 추천·순위·매매 승인 아님**\n\n';
 if(result.candidates.length){
  s+='| 종목 | 산업 | 시장 / 산업 / 종목 관찰 | 정책 위험예산 상한 예시 |\n';
  s+='| --- | --- | --- | ---: |\n';
  for(const x of result.candidates){
   const posture=x.readiness==='blocked'?'검증 보류':
    x.evidence.map(e=>e.title).join(' / ');
   s+='| '+(x.symbol||'식별 불가')+' | '+(x.sectorId||'미연결')+
    ' | '+posture+' | '+
    (x.hypotheticalRiskCeilingPct===null?'—':
     x.hypotheticalRiskCeilingPct.toFixed(2)+'%')+' |\n';
  }
 }else s+='분석 가능한 개별 종목 관측 자료가 없습니다.\n';
 s+='\n**추가 확인해야 할 제약**\n';
 for(const msg of LIMITATIONS)s+='- '+msg+'\n';
 return s;
}
function blocked(code,headline){
 const r={
  status:'blocked',code,headline:headline||'투자 판단 근거 확인 보류',
  market:null,mode:null,asOf:null,benchmark:null,
  marketAssessment:null,sources:null,candidates:Object.freeze([]),
  limitations:LIMITATIONS,readiness:'not-assessed',humanReviewRequired:true,
  realMarketDataVerified:false,sourceAuthenticityVerified:false,
  confidenceScore:null,rankable:false,tradeSignal:null,
  tradeApproved:false,canPlaceOrder:false
 };
 r.markdown=markdown(r);return Object.freeze(r);
}
const negativeFlags=v=>[
 'sourceAuthenticityVerified','exchangeHolidayVerified','phaseExternallyVerified',
 'marketDataVerified','intradayDataVerified','tradingRecommendation',
 'automaticOrders','accountsAccessed'].every(k=>v[k]===false)&&v.providerCalls===0;
const multipliers=Object.freeze({supportive:1,strong:1,mixed:0.75,defensive:0.5,weak:0.5});
function explain(analysis){
 if(!obj(analysis))return blocked('INVALID_EXPLANATION_INPUT');
 if(analysis.status==='blocked'){
  if(!exact(analysis,BLOCK)||!Array.isArray(analysis.details)||
   analysis.details.length>20||analysis.comparison!==null||
   !['dataVerified','realTimeVerified','tradeApproved','canPlaceOrder','accountAccessed']
    .every(k=>analysis[k]===false)||analysis.providerCalls!==0)
   return blocked('INVALID_EXPLANATION_INPUT');
  const code=Object.hasOwn(FAILURE,analysis.code)?
   analysis.code:'INPUT_QUALITY_UNCERTAIN';
  return blocked(code,FAILURE[code]||'입력 자료의 정합성을 다시 확인해야 합니다.');
 }
 if(!exact(analysis,ADAPTER)||
  !['coherent-input','partial','insufficient'].includes(analysis.status)||
  analysis.observationsComparableNotAuthenticated!==true||
  !['dataVerified','realTimeVerified','tradeApproved','canPlaceOrder','accountAccessed']
   .every(k=>analysis[k]===false)||analysis.providerCalls!==0||
  !exact(analysis.mapping,MAPPING)||
  !MAPPING.every(k=>typeof analysis.mapping[k]==='string'&&
   analysis.mapping[k].length<180)||
  !exact(analysis.marketSources,['benchmark','breadth'])||
  !source(analysis.marketSources.benchmark)||!source(analysis.marketSources.breadth))
  return blocked('INVALID_EXPLANATION_INPUT');
 const c=analysis.context;
 if(!exact(c,CONTEXT)||c.status!==analysis.status||
  !['KR','US'].includes(c.market)||c.mode!=='swing'||
  !date(c.asOf)||c.benchmark!==(c.market==='KR'?'^KS11':'^GSPC')||
  !negativeFlags(c)||!exact(c.marketContext,MARKET)||
  c.marketContext.status!=='coherent'||c.marketContext.asOf!==c.asOf||
  c.marketContext.phase!=='caller-declared-close'||
  !Object.hasOwn(STATE.market,c.marketContext.posture)||
  !between(c.marketContext.breadthPct,0,100)||
  !between(c.marketContext.coveragePct,60,100)||
  safeIssues(c.marketContext.issues)===null||
  c.marketContext.issues.length!==0||
  !Array.isArray(c.sectorContexts)||c.sectorContexts.length>25||
  !Array.isArray(c.candidates)||c.candidates.length>60||
  !exact(c.coverage,COVER)||!exact(c.methodology,METHOD)||
  c.methodology.baseRiskPct!==1.5||
  c.methodology.observationsMustShareLocalTradingDay!==true||
  c.methodology.minimumCoveragePct!==60||
  c.methodology.rankingAllowed!==false||
  c.methodology.stockEntryTimingVerified!==false||
  c.methodology.riskCapMeaning!=='ILLUSTRATIVE_POLICY_CEILING_NOT_A_RECOMMENDATION'||
  c.coverage.sectorsSupplied!==c.sectorContexts.length||
  c.coverage.stocksSupplied!==c.candidates.length)
  return blocked('INCONSISTENT_ANALYSIS_CONTEXT');
 const sectors=new Map();
 for(const x of c.sectorContexts){
  const isGood=x?.status==='coherent';
  if(!exact(x,isGood?SECTOR:SECTOR.slice(0,6))||
   !sector(x.id)||sectors.has(x.id)||
   safeIssues(x.issues)===null||
   !between(x.coveragePct,0,100)||!between(x.breadthPct,0,100)||
   !['coherent','blocked'].includes(x.status)||
   (isGood&&(!Object.hasOwn(STATE.sector,x.posture)||
    x.issues.length!==0||!between(x.coveragePct,60,100)||
    !between(x.relative5Pct,-200,200)||
    !between(x.relative20Pct,-200,200)||
    !between(x.volumeRatio,0,100)))||
   (!isGood&&(x.posture!=='unavailable'||x.issues.length===0)))
   return blocked('INCONSISTENT_SECTOR_CONTEXT');
  sectors.set(x.id,x);
 }
 const entries=[],seen=new Set();let valid=0;
 for(const x of c.candidates){
  if(!exact(x,CANDIDATE)||
   !['coherent-input','blocked'].includes(x.status)||
   !(x.symbol===null||symbol(x.symbol,c.market))||
   !(x.sectorId===null||sector(x.sectorId))||
   safeIssues(x.issues)===null||
   x.hypotheticalOnly!==true||x.tradeSignal!==null||
   x.verifiedMarketPrice!==false||
   x.marketPosture!==c.marketContext.posture||
   !['strong','mixed','weak','unavailable'].includes(x.sectorPosture)||
   !['strong','mixed','weak','unavailable'].includes(x.stockPosture))
   return blocked('INCONSISTENT_CANDIDATE_CONTEXT');
  const isBlocked=x.status==='blocked',sec=x.sectorId?sectors.get(x.sectorId):null;
  if(x.symbol!==null){
   if(seen.has(x.symbol)&&!isBlocked)return blocked('INCONSISTENT_CANDIDATE_CONTEXT');
   seen.add(x.symbol);
  }
  let evidence=[],risk=null,explanation='검증 불가 항목이 있으므로 종목 판단을 보류합니다.';
  if(isBlocked){
   if(x.posture!=='unavailable'||x.issues.length===0||
    x.riskMultiplierIllustration!==null||
    x.hypotheticalPolicyRiskCeilingPct!==null)
    return blocked('INCONSISTENT_CANDIDATE_CONTEXT');
  }else{
   if(!sec||sec.status!=='coherent'||x.issues.length!==0||
    x.sectorPosture!==sec.posture||
    !Object.hasOwn(STATE.stock,x.stockPosture))
    return blocked('INCONSISTENT_CANDIDATE_CONTEXT');
   const m=c.marketContext.posture,s=sec.posture,t=x.stockPosture;
   const expected=m==='defensive'||s==='weak'||t==='weak'?'defensive-watch':
    m==='supportive'&&s==='strong'&&t==='strong'?'aligned-watch':'mixed-watch';
   risk=Math.min(multipliers[m],multipliers[s],multipliers[t])*1.5;
   if(x.posture!==expected||
    !between(x.riskMultiplierIllustration,0.5,1)||
    Math.abs(x.riskMultiplierIllustration-risk/1.5)>0.00001||
    !between(x.hypotheticalPolicyRiskCeilingPct,0,1.5)||
    Math.abs(x.hypotheticalPolicyRiskCeilingPct-risk)>0.0001)
    return blocked('INCONSISTENT_CANDIDATE_CONTEXT');
   risk=Number(risk.toFixed(4));
   evidence=[
    {layer:'market',title:STATE.market[m][0],text:STATE.market[m][1]},
    {layer:'sector',title:STATE.sector[s][0],text:STATE.sector[s][1]},
    {layer:'stock',title:STATE.stock[t][0],text:STATE.stock[t][1]}
   ].map(Object.freeze);
   explanation=expected==='aligned-watch'?
    '세 계층의 가상 관찰 조건이 일치하지만, 실제 원천 인증과 투자 판단은 별개입니다.':
    expected==='defensive-watch'?
    '한 계층 이상이 방어적이며 정책 위험예산의 가상 축소만 표시합니다.':
    '계층별 자료가 혼재해 확정적 투자 판단을 유보합니다.';
   valid++;
  }
  entries.push(Object.freeze({
   symbol:x.symbol,sectorId:x.sectorId,
   readiness:isBlocked?'blocked':'manual-context-review',
   observation:isBlocked?'unavailable':x.posture,
   evidence:Object.freeze(evidence),
   alerts:Object.freeze(safeIssues(x.issues)),
   explanation,hypotheticalRiskCeilingPct:risk,
   tradeSignal:null,ranking:null,probability:null
  }));
 }
 if(c.coverage.stockObservationsCoherent!==valid||
  (c.status==='coherent-input'&&(valid!==entries.length||entries.length===0))||
  (c.status==='partial'&&(valid===0||valid===entries.length))||
  (c.status==='insufficient'&&entries.length>0&&sectors.size>0))
  return blocked('INCONSISTENT_COVERAGE');
 const result={
  status:c.status==='coherent-input'?'review-context-only':'partial-evidence',
  code:null,headline:c.status==='coherent-input'?
   '시장·산업·종목의 관찰 근거가 형식상 일치합니다.':
   '자료 부족으로 종목별 설명 근거가 제한적입니다.',
  market:c.market,mode:'swing',asOf:c.asOf,benchmark:c.benchmark,
  marketAssessment:Object.freeze({
   title:STATE.market[c.marketContext.posture][0],
   explanation:STATE.market[c.marketContext.posture][1],
   breadthPct:c.marketContext.breadthPct,
   coveragePct:c.marketContext.coveragePct
  }),
  sources:Object.freeze({
   benchmark:analysis.marketSources.benchmark,
   breadth:analysis.marketSources.breadth,
   authenticity:'CALLER_DECLARED_ONLY'
  }),
  candidates:Object.freeze(entries),limitations:LIMITATIONS,
  readiness:'manual-review-only',humanReviewRequired:true,
  realMarketDataVerified:false,sourceAuthenticityVerified:false,
  confidenceScore:null,rankable:false,tradeSignal:null,
  tradeApproved:false,canPlaceOrder:false
 };
 result.markdown=markdown(result);
 return Object.freeze(result);
}
const api=Object.freeze({explain});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestInvestmentEvidenceExplanationV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
