/* MY INVEST V2 — independent, read-only cross-index evidence gate (v1).
 * No fetch, storage, authentication, order, account, or UI side effects.
 * A qualified comparison only verifies input coherence, NOT market truth.
 */
(function(root){
'use strict';
const REQUIRED=Object.freeze({
 KR:Object.freeze(['^KS11','^KQ11']),
 US:Object.freeze(['^GSPC','^IXIC','^DJI','^SOX'])
});
const ZONES=Object.freeze({KR:'Asia/Seoul',US:'America/New_York'});
const VALID_PHASES=new Set(['close','realtime','indicative']);
const RECEIPT_LIMIT=30*60*1000;
const OBSERVATION_LIMIT=120*60*60*1000;
const OBSERVATION_SPREAD=12*60*60*1000;
const FUTURE_GRACE=5*60*1000;
const codeSet=arr=>Object.freeze([...new Set(arr)]);
const goodClock=n=>Number.isSafeInteger(n)&&n>0&&n<8640000000000000;
const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const isObject=o=>o&&typeof o==='object'&&!Array.isArray(o);
function dayAt(ms,market){
 if(!goodClock(ms)||!Object.hasOwn(ZONES,market))return null;
 const parts=new Intl.DateTimeFormat('en-US',{
  timeZone:ZONES[market],year:'numeric',month:'2-digit',day:'2-digit'
 }).formatToParts(new Date(ms));
 const data=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return data.year+'-'+data.month+'-'+data.day;
}
function observed(symbol,market,quotes,sources,received,now){
 const q=isObject(quotes)&&isObject(quotes[symbol])?quotes[symbol]:null;
 const issues=[];
 if(!q)return {symbol,valid:false,issues:['QUOTE_MISSING'],
  marketDate:null,changePct:null,observedAt:null,receivedAt:null,source:null,phase:null};
 const p=q.p,prev=q.prev;
 if(!positive(p))issues.push('PRICE_MISSING_OR_INVALID');
 if(!positive(prev))issues.push('PREVIOUS_MISSING_OR_INVALID');
 const changePct=positive(p)&&positive(prev)?(p/prev-1)*100:null;
 if(changePct!==null&&(!Number.isFinite(changePct)||Math.abs(changePct)>50))
  issues.push('CHANGE_OUTLIER');
 const at=q.observedAt,rx=isObject(received)?received[symbol]:null;
 if(!goodClock(at))issues.push('OBSERVED_AT_UNKNOWN');
 else if(at>now+FUTURE_GRACE)issues.push('FUTURE_OBSERVATION');
 else if(now-at>OBSERVATION_LIMIT)issues.push('OBSERVATION_TOO_OLD');
 if(!goodClock(rx))issues.push('RECEIVED_AT_UNKNOWN');
 else if(rx>now+FUTURE_GRACE)issues.push('FUTURE_RECEIPT');
 else if(now-rx>RECEIPT_LIMIT)issues.push('RECEIPT_STALE');
 if(goodClock(at)&&goodClock(rx)&&at>rx+FUTURE_GRACE)issues.push('OBSERVATION_AFTER_RECEIPT');
 if(q.refreshFailed===true)issues.push('LAST_REFRESH_FAILED');
 const source=isObject(sources)?sources[symbol]:null;
 if(typeof source!=='string'||!/^[A-Za-z][A-Za-z0-9._-]{0,23}$/.test(source))
  issues.push('SOURCE_UNIDENTIFIED');
 const phase=VALID_PHASES.has(q.phase)?q.phase:null;
 if(!phase)issues.push('PHASE_UNVERIFIED');
 const strictIssues=issues.filter(x=>x!=='PHASE_UNVERIFIED');
 return {symbol,marketDate:goodClock(at)&&at<=now+FUTURE_GRACE?dayAt(at,market):null,
  changePct:Number.isFinite(changePct)?changePct:null,
  observedAt:goodClock(at)?at:null,receivedAt:goodClock(rx)?rx:null,
  source:typeof source==='string'&&/^[A-Za-z][A-Za-z0-9._-]{0,23}$/.test(source)?source:null,
  phase,valid:strictIssues.length===0,issues:codeSet(issues)};
}
function assess({market,now,quotes={},sources={},receivedAt={}}={}){
 if(!Object.hasOwn(REQUIRED,market))return Object.freeze({
  status:'invalid',code:'INVALID_MARKET',market:null,items:[],issues:['INVALID_MARKET']
 });
 if(!goodClock(now))return Object.freeze({
  status:'invalid',code:'INVALID_NOW',market,items:[],issues:['INVALID_NOW']
 });
 const symbols=REQUIRED[market];
 const items=symbols.map(id=>observed(id,market,quotes,sources,receivedAt,now));
 const issues=items.flatMap(row=>row.issues.map(code=>row.symbol+':'+code));
 const valid=items.every(row=>row.valid);
 let sameDate=false,coherentTime=false;
 if(valid){
  sameDate=items.every(row=>row.marketDate===items[0].marketDate);
  if(!sameDate)issues.push('MARKET_DATE_MISMATCH');
  const times=items.map(row=>row.observedAt);
  coherentTime=Math.max(...times)-Math.min(...times)<=OBSERVATION_SPREAD;
  if(!coherentTime)issues.push('OBSERVATION_WINDOW_MISMATCH');
 }
 const blocked=!valid||!sameDate||!coherentTime;
 const phasesVerified=items.every(row=>row.phase==='close');
 const status=blocked?'blocked':phasesVerified?'qualified-close':'indicative-only';
 const ups=blocked?0:items.filter(row=>row.changePct>0).length;
 const downs=blocked?0:items.filter(row=>row.changePct<0).length;
 const flats=blocked?0:items.filter(row=>row.changePct===0).length;
 const direction=blocked?'unavailable':ups===symbols.length?'up':
  downs===symbols.length?'down':flats===symbols.length?'flat':'mixed';
 const title=blocked?'시장국면 판단 보류':
  status==='indicative-only'?'참고 방향 ('+direction+'·종가 확인 불가)':
  direction==='up'?'확인 자료 기준 주요 지수 동반 상승':
  direction==='down'?'확인 자료 기준 주요 지수 동반 하락':
  direction==='flat'?'확인 자료 기준 주요 지수 보합':'확인 자료 기준 주요 지수 혼조';
 const note=status==='qualified-close'?
  '입력된 정규장 종가·출처·시각의 형식적 일관성만 검사했습니다. 실제 시장 가격과 거래소 휴장 여부는 독립 검증되지 않았습니다.':
  status==='indicative-only'?
  '일부 원천의 종가 여부를 확인하지 못했습니다. 실시간·마감 지수로 단정하지 마세요.':
  '필수 지수의 수치·수신·출처·원천 날짜가 일치하지 않아 방향을 만들지 않았습니다.';
 return Object.freeze({
  market,required:symbols.slice(),status,title,direction,
  marketDate:blocked?null:items[0].marketDate,issues:codeSet(issues),
  observedCount:items.filter(row=>row.valid).length,requiredCount:symbols.length,
  phaseVerified:!blocked&&phasesVerified,
  comparedOnSameMarketDate:!blocked,receivedAtVerified:!blocked,
  quoteTruthVerified:false,exchangeCalendarVerified:false,realTimeVerified:false,
  tradingRecommendation:false,items,note
 });
}
const api=Object.freeze({assess,dayAt,REQUIRED});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestMarketEvidenceGateV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
