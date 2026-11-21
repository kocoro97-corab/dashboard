/* MY INVEST V2 — offline, public-market quality triage.
 * Pure diagnostic projection of verified-format index evidence and safe error codes.
 * Never fetches, writes, logs raw errors, reads accounts, or submits orders.
 */
(function(root){
'use strict';
const SYMBOL_LABELS=Object.freeze({
 '^KS11':'KOSPI','^KQ11':'KOSDAQ',
 '^GSPC':'S&P 500','^IXIC':'NASDAQ','^DJI':'Dow','^SOX':'SOX'
});
const TARGET_LABELS=Object.freeze({
 'future:k3':'KOSPI 200 선물','future:k4':'KOSDAQ 150 선물',
 'index:^KS11':'KOSPI','index:^KQ11':'KOSDAQ',
 'index:^GSPC':'S&P 500','index:^IXIC':'NASDAQ',
 'index:^DJI':'Dow','index:^SOX':'SOX',
 'public:market':'공개 시장 조회'
});
const ISSUE_RULES=Object.freeze({
 QUOTE_MISSING:['필수 지수 미수신','동일 시장 기준으로 재조회하고 미수신 상태를 유지합니다.'],
 PRICE_MISSING_OR_INVALID:['가격 미수신 또는 비정상','원천 응답에서 가격과 지수 식별자를 검증합니다.'],
 PREVIOUS_MISSING_OR_INVALID:['비교 종가 미확인','전일 비교 종가가 검증되기 전까지 등락률 판단을 보류합니다.'],
 CHANGE_OUTLIER:['지수 변동률 이상값','원천 수치와 이전 종가, 단위를 확인합니다.'],
 OBSERVED_AT_UNKNOWN:['원천 관측시각 없음','거래소 기준 관측시각이 제공되는지 확인합니다.'],
 OBSERVATION_TOO_OLD:['오래된 원천 시세','거래일·휴장 여부를 확인하고 최신 관측 자료로 재조회합니다.'],
 FUTURE_OBSERVATION:['미래 원천 관측시각','수집기 시계와 원천 시간대 변환을 확인합니다.'],
 RECEIVED_AT_UNKNOWN:['수신시각 미확인','실제 응답 수신시각을 기록하고 다시 조회합니다.'],
 RECEIPT_STALE:['최근 수신 실패·오래된 응답','갱신 실패 원인을 확인하며 종전 값은 최신값으로 표시하지 않습니다.'],
 FUTURE_RECEIPT:['미래 수신시각','장치 시계 및 저장 시각 형식을 확인합니다.'],
 OBSERVATION_AFTER_RECEIPT:['원천·수신시각 순서 불일치','시계 동기화 및 수신 기록을 점검합니다.'],
 LAST_REFRESH_FAILED:['마지막 갱신 실패','캐시의 오래된 시세를 최신 시장국면의 근거로 사용하지 않습니다.'],
 SOURCE_UNIDENTIFIED:['가격 원천 식별 불가','원천 공급자 식별값을 확인합니다.'],
 PHASE_UNVERIFIED:['종가·장중 구분 미확인','마감 종가로 확정하지 말고 참고값으로만 표시합니다.'],
 MARKET_DATE_MISMATCH:['필수 지수 관측 거래일 불일치','한국은 서울, 미국은 뉴욕 현지 거래일로 비교합니다.'],
 OBSERVATION_WINDOW_MISMATCH:['필수 지수 관측 시간차 과다','같은 장 마감 또는 비교 가능한 시간대인지 확인합니다.']
});
const ERROR_RULES=Object.freeze({
 NH_NO_PRICE:['선물 시세 미수신','선물 종목코드·만기·원천 가격 응답을 확인합니다.','warning'],
 NH_CONTRACT:['선물 계약 검증 실패','종목·만기를 확인합니다.','warning'],
 NH_CONTRACT_EXPIRY:['선물 만기 확인 필요','계약 만기·연속선물 대체 여부를 확인합니다.','warning'],
 NH_CONTRACT_CODE:['선물 계약코드 검증 실패','계약코드 기준자료를 확인합니다.','warning'],
 NH_SYMBOL_MISMATCH:['선물 종목 식별 불일치','응답의 식별자와 요청한 계약의 일치를 확인합니다.','warning'],
 NH_IDENTITY_UNVERIFIED:['선물 계약 식별 미확인','원천·계약 식별이 검증될 때까지 가격을 표시하지 않습니다.','warning'],
 NH_REFERENCE_INVALID:['선물 기준자료 오류','기준자료의 기준일과 계약값을 확인합니다.','warning'],
 NH_OBSERVATION:['시세 관측시각 확인 불가','실제 관측시각 확보 전 최신 시세로 표시하지 않습니다.','warning'],
 NH_STALE:['오래된 NH 시세','장 운영시간과 관측시각 확인 후 재조회합니다.','warning'],
 NH_NETWORK_ERROR:['NH 원천 연결 오류','오류코드와 현재 연결 경로를 확인합니다.','warning'],
 RELAY_BUSY:['시장데이터 중계 사용량 초과','짧은 간격의 재시도·중복 요청을 피합니다.','warning'],
 RELAY_RATE_LIMIT:['공개 시장 요청 제한','원천·중계의 호출 간격을 확인합니다.','warning'],
 RELAY_PUBLIC_FAILED:['공개 시장 조회 실패','확인된 원천·중계 오류코드를 조회합니다.','warning'],
 RELAY_UPSTREAM_NETWORK:['시장데이터 원천 연결 실패','원천 서비스 상태를 확인합니다.','warning'],
 READ_TIMEOUT:['공개 시장 조회 시간 초과','요청 중복을 피하고 시간 경과 후 다시 시도합니다.','warning'],
 READ_NETWORK:['공개 시장 네트워크 오류','네트워크·원천 연결 상태를 확인합니다.','warning'],
 READ_FORMAT:['공개 시세 응답 형식 오류','원천의 응답 구조와 숫자·시각 형식을 확인합니다.','warning'],
 READ_QUEUE_FULL:['시장 조회 대기열 초과','일정 시간 후 단일 새로고침으로 재시도합니다.','warning'],
 AUTH_REQUIRED:['시장데이터 연결 권한 확인 필요','인증 상태를 확인하되 토큰·계좌정보는 노출하지 않습니다.','stop'],
 RELAY_TARGET_MISMATCH:['중계 대상 설정 불일치','중계 대상·허용 원천 설정을 점검합니다.','stop'],
 RELAY_PUBLIC_URL_DENIED:['허용되지 않은 공개 조회 경로','새 공급자나 임의 URL을 무단 허용하지 않습니다.','stop'],
 RELAY_REDIRECT_DENIED:['원천 리다이렉트 차단','허용 목록과 원천 고정 URL을 검토합니다.','stop'],
 GAS_NON_JSON:['응답이 JSON 형식이 아님','GAS·중계 응답의 안전한 오류코드만 확인합니다.','warning'],
 SESSION_CHANGED:['조회 도중 세션 변경','이전 결과를 폐기하고 새 세션에서 다시 조회합니다.','warning'],
 READ_CANCELLED:['조회가 취소됨','페이지 이동·로그아웃 중인 취소는 정상 처리합니다.','info']
});
const PRIORITY=Object.freeze({stop:0,warning:1,info:2});
const clampRecords=50;
const allowedLayer=new Set(['browser','relay','gas','nh','storage','unknown']);
const goodClock=n=>Number.isSafeInteger(n)&&n>0&&n<8640000000000000;
const known=(s,obj)=>typeof s==='string'&&Object.hasOwn(obj,s)?s:null;
function errorTime(value){
 if(goodClock(value))return value;
 if(typeof value!=='string'||value.length>40||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
 const n=Date.parse(value);return goodClock(n)?n:null;
}
function safeEvents(events,now){
 if(!Array.isArray(events)||events.length>clampRecords)return null;
 const byKey=new Map();
 for(const item of events){
  if(!item||typeof item!=='object'||Array.isArray(item))continue;
  if(item.scope!=='public')continue; // Never project private/account diagnostics.
  const at=errorTime(item.at);
  if(at===null||at>now+5*60000||now-at>7*86400000)continue;
  const code=known(item.code,ERROR_RULES)||'UNKNOWN_PUBLIC_READ_FAILURE';
  const target=known(item.target,TARGET_LABELS)||'UNKNOWN_TARGET';
  const layer=allowedLayer.has(item.layer)?item.layer:'unknown';
  const normalized={code,target,layer,at,
   http:Number.isInteger(item.http)&&item.http>=100&&item.http<=599?item.http:null};
  const key=code+'|'+target;
  const prior=byKey.get(key);
  if(prior){
   prior.count++;
   if(at>prior.lastSeenAt)prior.lastSeenAt=at;
   if(at<prior.firstSeenAt)prior.firstSeenAt=at;
   // Do not copy request IDs, URLs, message strings, bodies, or arbitrary properties.
  }else byKey.set(key,{...normalized,count:1,firstSeenAt:at,lastSeenAt:at});
 }
 return [...byKey.values()].sort((a,b)=>b.lastSeenAt-a.lastSeenAt).slice(0,20).map(row=>{
  const rule=ERROR_RULES[row.code]||['공개 시장 오류 원인 미확인','안전한 코드만 기록하고 원문 요청·응답은 노출하지 않습니다.','warning'];
  return Object.freeze({
   code:row.code,target:row.target,label:TARGET_LABELS[row.target]||'조회 대상 미확인',
   layer:row.layer,http:row.http,count:row.count,
   firstSeenAt:row.firstSeenAt,lastSeenAt:row.lastSeenAt,
   title:rule[0],action:rule[1],severity:rule[2],
   repeated:row.count>=3
  });
 });
}
function projectEvidence(evidence){
 if(!evidence||!Array.isArray(evidence.items))return [];
 const rows=[];
 for(const item of evidence.items){
  if(!known(item.symbol,SYMBOL_LABELS)||!Array.isArray(item.issues))continue;
  for(const code of item.issues){
   const rule=ISSUE_RULES[code];
   if(!rule)continue;
   rows.push(Object.freeze({
    symbol:item.symbol,label:SYMBOL_LABELS[item.symbol],code,
    title:rule[0],action:rule[1],
    severity:code==='PHASE_UNVERIFIED'?'info':'warning'
   }));
  }
 }
 for(const code of evidence.issues||[]){
  if(code==='MARKET_DATE_MISMATCH'||code==='OBSERVATION_WINDOW_MISMATCH'){
   const rule=ISSUE_RULES[code];
   rows.push(Object.freeze({
    symbol:null,label:'시장 공통',code,title:rule[0],action:rule[1],severity:'warning'
   }));
  }
 }
 return rows.slice(0,40);
}
function diagnose({market,now,quotes,sources,receivedAt,events=[]}={}){
 if(!goodClock(now))return Object.freeze({status:'invalid',code:'INVALID_CLOCK',verified:false});
 if(!Array.isArray(events)||events.length>clampRecords)
  return Object.freeze({status:'invalid',code:'INVALID_EVENT_COLLECTION',verified:false});
 const gate=typeof module==='object'&&module.exports?
  require('./market-evidence-gate-v1.js'):root.MYInvestMarketEvidenceGateV1;
 if(!gate||typeof gate.assess!=='function')
  return Object.freeze({status:'invalid',code:'MISSING_EVIDENCE_GATE',verified:false});
 const evidence=gate.assess({market,now,quotes,sources,receivedAt});
 if(evidence.status==='invalid')
  return Object.freeze({status:'invalid',code:evidence.code,verified:false});
 const observedIssues=projectEvidence(evidence);
 const publicErrors=safeEvents(events,now);
 if(publicErrors===null)
  return Object.freeze({status:'invalid',code:'INVALID_EVENT_COLLECTION',verified:false});
 const stopped=publicErrors.some(e=>e.severity==='stop');
 const isBlocked=evidence.status==='blocked';
 const status=isBlocked?'hold':stopped?'review-required':
  evidence.status==='indicative-only'||publicErrors.some(e=>e.severity==='warning')?
  'caution':'evidence-coherent';
 const summary=isBlocked?
  '필수 지수 관측 증거 부족으로 시장 방향 판단 보류':
  stopped?'공개 시장 연결·권한 문제로 최신 상태 재검증 필요':
  status==='caution'?'시장 자료 확인 필요 · 일부 불확실성 또는 오류 존재':
  '지수 입력 간 형식적 일관성 확인 · 시장 가격 진위는 미검증';
 const cards=Object.freeze([
  {label:'필수 지수 확인',value:evidence.observedCount+'/'+evidence.requiredCount},
  {label:'동일 현지 거래일',value:evidence.comparedOnSameMarketDate?'입력 일치':'확인 보류'},
  {label:'종가 입력 선언',value:evidence.phaseVerified?'확인':'미확인'},
  {label:'공개 조회 오류',value:publicErrors.reduce((n,e)=>n+e.count,0)+'건'}
 ].map(x=>Object.freeze(x)));
 return Object.freeze({
  status,market:evidence.market,summary,direction:status==='evidence-coherent'?
    evidence.direction:'unavailable',
  comparedDirection:evidence.direction,
  marketDate:evidence.marketDate,
  gateStatus:evidence.status,gateTitle:evidence.title,
  cards,issues:Object.freeze(observedIssues),
  events:Object.freeze(publicErrors),
  safeHints:Object.freeze([isBlocked?'핵심 지수의 원천 관측시각·가격·수신 상태를 재점검합니다.':
   '지수 종가·관측시각을 원천과 교차 확인합니다.',
   '공개 데이터 진위 및 거래소 휴장 여부는 별도 검증해야 합니다.',
   '계좌번호·토큰·원시 오류메시지는 진단 화면에 표시하지 않습니다.']),
  marketDataVerified:false,calendarVerified:false,tradeAuthorized:false,
  accountDataAccessed:false,requestsIssued:0
 });
}
const api=Object.freeze({diagnose,errorTime});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestMarketQualityDiagnosticsV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
