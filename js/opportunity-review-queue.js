(function(root){'use strict';
/**
 * MY INVEST V2 — opportunity review queue. Pure, read-only, no fetch,
 * account persistence, scoring model, orders, or automatic recommendations.
 * Consumes ONLY MYInvestIntegratedStrategy.assess() output.
 */
const VALID_SYMBOL=/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const VALID_DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=s=>typeof s==='string'&&VALID_DAY.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const DAY_MS=86400000;
const validMode=s=>s==='day'||s==='swing';
const validIntent=s=>s==='candidate'||s==='holding';
function dateAge(now,day){return Math.round((Date.parse(now+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/DAY_MS)}
function cleanText(t,len=120){return typeof t==='string'?t.replace(/[\x00-\x1f]/g,' ').trim().slice(0,len):''}
function cleanList(value,limit=20){if(!Array.isArray(value))return [];return [...new Set(value.filter(v=>typeof v==='string').map(x=>cleanText(x,120)).filter(Boolean))].slice(0,limit)}
function canonical(entry,mode,intent,nowDay){
 if(!entry||typeof entry!=='object'||entry.schemaVersion!==1||entry.intent!==intent||entry.mode!==mode||
  !VALID_SYMBOL.test(entry.symbol||'')||!['KR','US'].includes(entry.market)||
  (entry.market==='KR')!==/^\d{6}$/.test(entry.symbol)||!validDay(entry.asOf)||
  !['observed','review-required','insufficient'].includes(entry.status)||
  !['review-only','no-action'].includes(entry.action)||!Array.isArray(entry.blocking)||!Array.isArray(entry.conditions)||
  !Array.isArray(entry.reasons)||!Array.isArray(entry.evidence))
  return {valid:false,reason:'전략 결과 스키마·종목 식별 불명확'};
 if(entry.status==='insufficient'&&entry.action!=='no-action')return {valid:false,reason:'불충분 자료의 행동 상태 오류'};
 if(entry.status!=='insufficient'&&entry.action!=='review-only')return {valid:false,reason:'비거래 검토 전용 상태 오류'};
 if(entry.evidence.some(e=>!e||e.kind!=='stock'&&!['market','sector'].includes(e.kind)||
  e.kind==='stock'&&(e.symbol!==entry.symbol||e.asOf!==entry.asOf||!cleanText(e.source))))
  return {valid:false,reason:'전략 근거 오염·거래일 불일치'};
 if(entry.status!=='insufficient'&&!entry.evidence.some(e=>e.kind==='stock'))return {valid:false,reason:'종목 관측 근거 없음'};
 if(entry.marketContext?.status==='verified'&&entry.marketContext?.direction&&!['up','down','mixed'].includes(entry.marketContext.direction))
  return {valid:false,reason:'시장 국면 값 오류'};
 if(entry.sectorContext?.status==='verified'&&(entry.sectorContext.asOf!==entry.asOf||typeof entry.sectorContext.source!=='string'))
  return {valid:false,reason:'산업 자료 기준일 불일치'};
 const age=dateAge(nowDay,entry.asOf);
 if(age<0||age>10)return {valid:false,reason:'거래일 최신성 검증 실패'};
 return {valid:true,age};
}
const STRONG_VETO=['market-high-risk','event-near'];
const NEEDS_EVIDENCE=new Set(['market-unverified','sector-unverified','events-unverified','relative-unverified',
 'holding-unverified','market-risk-unknown','market-trend-unknown','risk-reference-unverified',
 'stock-trend-unknown','stock-unverified','stale-stock']);
function summarize(entry,nowDay){
 const result=canonical(entry,entry?.mode,entry?.intent,nowDay);
 if(!result.valid)return {status:'invalid',reason:result.reason};
 const blocker=cleanList(entry.blocking,30),reasons=cleanList(entry.reasons,25),conditions=cleanList(entry.conditions,25);
 const veto=blocker.some(x=>STRONG_VETO.includes(x));
 const unknown=blocker.some(x=>NEEDS_EVIDENCE.has(x))||entry.status==='insufficient';
 const technical=conditions.some(x=>x.includes('확정봉 돌파')||x.includes('확정 일봉 스윙'));
 const direction=entry.marketContext?.status==='verified'?entry.marketContext.direction:'unknown';
 const downTrend=entry.intent==='holding'&&reasons.some(x=>x.includes('하락 추세')||x.includes('추세 훼손'));
 // Priority is a REVIEW WORKFLOW lane, not an expected-return score.
 let lane,label,phase;
 if(entry.intent==='candidate'){
  if(veto){lane='risk-review';label='신규 진입 경계 · 위험 이벤트 우선 확인';phase=0}
  else if(unknown||!technical){lane='needs-evidence';label='신규 후보 · 근거 확인 후 재평가';phase=1}
  else{lane='technical-watch';label='신규 후보 · 기술 조건 관찰';phase=2}
 }else{
  if(veto||downTrend||direction==='down'){lane='risk-review';label='보유종목 · 위험 조건 우선 점검';phase=0}
  else if(unknown){lane='needs-evidence';label='보유종목 · 데이터 재확인';phase=1}
  else{lane='monitor';label='보유종목 · 추세 및 참조 지지선 확인';phase=2}
 }
 // Explicit allowlist: private holding values, brokerage identifiers,
 // average price, positions and original nested evidence are never emitted.
 const evidence=entry.evidence.slice(0,12).map(e=>({
  kind:e.kind,asOf:validDay(e.asOf?.slice?.(0,10))?e.asOf.slice(0,10):entry.asOf,
  id:cleanText(e.kind==='stock'?e.symbol:e.kind==='market'?e.symbol:e.id,40),
  source:cleanText(e.source,100)
 }));
 const risk=entry.reference?.status==='observed'?{
  status:'observed',atrPct:Number.isFinite(entry.reference.atrPct)?entry.reference.atrPct:null,
  observedSupport:Number.isFinite(entry.reference.support)?entry.reference.support:null,
  supportRiskPct:Number.isFinite(entry.reference.referenceLossPct)?entry.reference.referenceLossPct:null
 }:{status:'unavailable',atrPct:null,observedSupport:null,supportRiskPct:null};
 return {status:'ready',symbol:entry.symbol,market:entry.market,intent:entry.intent,mode:entry.mode,
  asOf:entry.asOf,reviewLane:lane,reviewOrder:phase,label,
  blocked:veto,requiresEvidence:unknown,observedTechnicalCondition:technical,
  reasons,conditions,blocking:blocker,risk,evidence,
  scope:'검토 작업의 순서이며 수익률 순위·추천 점수·매매 지시가 아님'};
}
function collect({mode='swing',candidates=[],holdings=[],nowDay=null,maxResults=100}={}){
 if(!validMode(mode)||!Array.isArray(candidates)||!Array.isArray(holdings)||
  candidates.length>300||holdings.length>300||!Number.isSafeInteger(maxResults)||maxResults<1||maxResults>300||
  !validDay(nowDay))throw Error('OPPORTUNITY_INPUT_INVALID');
 const build=(input,intent)=>{
  const items=[],errors=[],seen=new Set();
  for(let i=0;i<input.length;i++){
   const raw=input[i],key=typeof raw?.symbol==='string'?raw.symbol.toUpperCase():null;
   if(!key||!VALID_SYMBOL.test(key)||seen.has(key)){
    errors.push({index:i,reason:key&&seen.has(key)?'종목 중복':'종목코드 미확인'});continue;
   }
   seen.add(key);
   const record=summarize(raw,nowDay);
   if(record.status==='invalid'){
    errors.push({index:i,symbol:key,reason:record.reason});continue;
   }
   if(record.intent!==intent||record.mode!==mode){
    errors.push({index:i,symbol:key,reason:'분석 대상/투자 기간 불일치'});continue;
   }
   items.push(record);
  }
  // Stable alphabetic tie-breaker, not an invented strength ranking.
  items.sort((a,b)=>a.reviewOrder-b.reviewOrder||a.asOf.localeCompare(b.asOf)||a.symbol.localeCompare(b.symbol));
  return {items:items.slice(0,maxResults),errors,total:input.length,reviewed:items.length,
   truncated:items.length>maxResults};
 };
 const fresh=build(candidates,'candidate'),held=build(holdings,'holding');
 return {schemaVersion:1,mode,evaluatedOn:nowDay,status:(fresh.reviewed||held.reviewed)?'ready':'insufficient',
  candidateQueue:fresh,holdingQueue:held,
  coverage:{candidates:{total:fresh.total,verified:fresh.reviewed,invalid:fresh.errors.length},
   holdings:{total:held.total,verified:held.reviewed,invalid:held.errors.length}},
  warnings:['새 후보와 보유 종목은 서로 순위 비교하지 않음',
   '근거 누락은 위험 없음·투자기회 없음이 아님',
   'reviewOrder는 검토 작업 순서이며 확률·등급·수익률·투자 비중이 아님',
   '보유 수량·계좌번호·평균단가·투자금은 출력/저장하지 않음']};
}
const api=Object.freeze({collect,summarize});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestOpportunityQueue=api;
})(globalThis);
