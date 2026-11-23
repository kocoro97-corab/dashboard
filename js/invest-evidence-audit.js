(function(root){'use strict';
/**
 * MY INVEST V2 — source freshness / evidence coverage audit.
 *
 * Pure functions, no network, no account access, no persistence, no order.
 * A received-at timestamp is NOT a quote observed-at timestamp. Daily
 * bars use verified EXCHANGE session dates and never imply live quotes.
 */
const DAY=86400000,MIN=60000;
const VALID_DATE=/^\d{4}-\d{2}-\d{2}$/;
const VALID_ASSET=/^(?:\d{6}|[A-Z^][A-Z0-9.^=-]{0,24})$/;
const SOURCE_KEYS=Object.freeze(['market','sector','stock','event']);
const REQUIREMENTS=Object.freeze({
 day:Object.freeze({market:true,sector:true,stock:true,event:true,quoteMaxMinutes:30,barMaxCalendarDays:10}),
 swing:Object.freeze({market:true,sector:true,stock:true,event:true,quoteMaxMinutes:30,barMaxCalendarDays:10})
});
const isNum=v=>typeof v==='number'&&Number.isFinite(v);
function date(s){if(typeof s!=='string'||!VALID_DATE.test(s))return null;const t=Date.parse(s+'T00:00:00Z');return isNum(t)&&new Date(t).toISOString().slice(0,10)===s?s:null}
function timestamp(v){
 if(v==null||v==='')return null;
 const t=typeof v==='number'?v:typeof v==='string'?Date.parse(v):NaN;
 return isNum(t)&&t>=0&&t<=8.64e15?t:null;
}
function dayAge(nowDay,asOf){return (Date.parse(nowDay+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/DAY}
function clean(s,length=120){return typeof s==='string'?s.replace(/[\x00-\x1f]/g,' ').trim().slice(0,length):''}
function sourceEvidence(raw,now){
 if(!raw||typeof raw!=='object'||!clean(raw.source))return {state:'missing',reason:'출처·공급자 식별 미확인'};
 const observed=timestamp(raw.observedAt??raw.asOf),received=timestamp(raw.receivedAt);
 if(observed===null||received===null)return {state:'missing',reason:'관측시각 또는 수신시각 미확인'};
 if(observed>now+5*MIN||received>now+5*MIN||observed>received+5*MIN)return {state:'invalid',reason:'시각 순서·미래 관측 오류'};
 if(raw.failed===true)return {state:'failed',reason:'원천 데이터 최근 요청 실패'};
 return {state:'known',source:clean(raw.source,100),observedAt:new Date(observed).toISOString(),
  receivedAt:new Date(received).toISOString(),observedAgeMinutes:(now-observed)/MIN,
  receivedAgeMinutes:(now-received)/MIN};
}
function component(input,{name,nowDay,now,market,mode}){
 if(!input||typeof input!=='object')return {component:name,status:'missing',reasons:['분석 모듈 미연결'],basis:[]};
 if(input.market&&market&&input.market!==market||input.region&&market&&input.region!==market)
  return {component:name,status:'invalid',reasons:['시장/국가 구분 불일치'],basis:[]};
 const reasons=[],basis=[];
 let status='usable';
 const basisDay=typeof input.asOf==='string'?input.asOf:typeof input.referenceDay==='string'?input.referenceDay:null;
 if(['sector','stock'].includes(name)){
  if(!date(basisDay))return {component:name,status:'invalid',reasons:['거래소 기준일 미확인'],basis:[]};
  const elapsed=dayAge(nowDay,basisDay);
  if(elapsed<0)return {component:name,status:'invalid',reasons:['현재 이후 미래 거래일'],basis:[]};
  if(elapsed>REQUIREMENTS[mode].barMaxCalendarDays){status='stale';reasons.push('거래소 확정봉 오래됨')}
  basis.push({kind:'session',asOf:basisDay});
 }
 if(name==='market'){
  if(input.status!=='descriptive')return {component:name,status:'missing',reasons:['핵심 지수 부족·국면 판단 보류'],basis:[]};
  if(!Array.isArray(input.evidence)||input.evidence.length<2)
   return {component:name,status:'missing',reasons:['핵심 지수 근거 부족'],basis:[]};
  const dates=new Set();
  for(const ev of input.evidence){
   if(!date(ev?.referenceDay)||!clean(ev.source)){status='invalid';reasons.push('시장 지수 출처·기준 거래일 오류');break}
   dates.add(ev.referenceDay);
   // The regime engine already validates full provenance. Still reject
   // untrusted timestamps when the context is reused in a new screen.
   const s=sourceEvidence(ev,now);
   if(s.state!=='known'){status=s.state==='failed'?'failed':'missing';reasons.push(s.reason);break}
   if(s.receivedAgeMinutes>REQUIREMENTS[mode].quoteMaxMinutes){status='stale';reasons.push('시장 지수 수신시각 오래됨')}
   basis.push({kind:'market-quote',symbol:clean(ev.symbol,32),source:s.source,observedAt:s.observedAt,
    receivedAt:s.receivedAt,referenceDay:ev.referenceDay});
  }
  if(dates.size>1){status='invalid';reasons.push('시장 핵심 지수 거래일 불일치')}
  if(dates.size===1&&dayAge(nowDay,[...dates][0])>REQUIREMENTS[mode].barMaxCalendarDays){status='stale';reasons.push('시장 관측 거래일 오래됨')}
 }else if(name==='sector'){
  if(input.status!=='descriptive'||input.rotation?.status!=='descriptive')
   return {component:name,status:'missing',reasons:['산업 상대강도 근거 부족'],basis};
  if(!clean(input.source))return {component:name,status:'missing',reasons:['산업 자료 출처 미확인'],basis};
  basis.push({kind:'sector',source:clean(input.source,100),asOf:basisDay,
   dataScope:input.isProxy?'ETF proxy':'검증된 산업 표본'});
 }else if(name==='stock'){
  if(input.status!=='descriptive'||!clean(input.evidence?.source)||input.evidence?.asOf!==basisDay)
   return {component:name,status:'missing',reasons:['종목 일봉·출처 근거 부족'],basis};
  basis.push({kind:'stock',source:clean(input.evidence.source,100),asOf:basisDay,
   symbol:clean(input.symbol,25)});
 }else if(name==='event'){
  // A known event can still be important when other providers are missing.
  if(!['ready','partial'].includes(input.status)||!Array.isArray(input.events))
   return {component:name,status:'missing',reasons:['공식 이벤트 캐시 미연결'],basis};
  if(input.coverageVerified!==true||input.status!=='ready'){status='partial';reasons.push('일부 공식 일정 미연결')}
  const confirmed=input.events.filter(x=>x&&x.verified===true&&date(x.date)&&['economic','earnings'].includes(x.kind));
  basis.push({kind:'public-events',confirmed:confirmed.length,coverageVerified:input.coverageVerified===true});
 }else{
  return {component:name,status:'invalid',reasons:['알 수 없는 입력 원천'],basis:[]};
 }
 return {component:name,status,reasons:[...new Set(reasons)],basis};
}
function audit({mode='swing',market,nowDay,now=Date.now(),marketData=null,sectorData=null,stockData=null,eventData=null,
 opportunity=null}={}){
 if(!REQUIREMENTS[mode]||!['US','KR'].includes(market)||!date(nowDay)||!isNum(now)||now<0||now>8.64e15)throw Error('EVIDENCE_INPUT_INVALID');
 const parts={
  market:component(marketData,{name:'market',nowDay,now,market,mode}),
  sector:component(sectorData,{name:'sector',nowDay,now,market,mode}),
  stock:component(stockData,{name:'stock',nowDay,now,market,mode}),
  event:component(eventData,{name:'event',nowDay,now,market,mode})
 };
 const hasInvalid=SOURCE_KEYS.some(k=>['invalid','failed'].includes(parts[k].status));
 const incomplete=SOURCE_KEYS.some(k=>parts[k].status!=='usable');
 const refreshPlan=[],display=[];
 for(const key of SOURCE_KEYS){
  const p=parts[key];
  display.push({component:key,status:p.status,reasons:p.reasons,basis:p.basis});
  if(p.status==='usable')continue;
  const suggestion=p.status==='stale'?'기존 데이터 공급자의 갱신 정책 확인 후 필요 시 재조회':
   p.status==='failed'?'원천 오류 확인 및 기존 캐시 보존':'데이터 원천·연동 여부 확인';
  refreshPlan.push({component:key,reason:p.reasons.join(' · ')||'근거 불완전',
   next:suggestion,allowAutoFetch:false});
 }
 // Unlike investment rankings, priority is an evidence remediation order.
 const priority={invalid:0,failed:0,stale:1,missing:2,partial:3,usable:4};
 refreshPlan.sort((a,b)=>priority[parts[a.component].status]-priority[parts[b.component].status]||
  SOURCE_KEYS.indexOf(a.component)-SOURCE_KEYS.indexOf(b.component));
 const symbol=typeof stockData?.symbol==='string'&&VALID_ASSET.test(stockData.symbol)?stockData.symbol:null;
 let queueStatus=null;
 if(opportunity&&typeof opportunity==='object'){
  const matches=opportunity.symbol===symbol&&opportunity.market===market&&opportunity.asOf===stockData?.asOf;
  queueStatus=matches?{
   lane:['risk-review','needs-evidence','technical-watch','monitor'].includes(opportunity.reviewLane)?opportunity.reviewLane:'unknown',
   reviewBlocked:opportunity.blocked===true,requiresEvidence:opportunity.requiresEvidence===true
  }:null;
 }
 return {schemaVersion:1,mode,market,nowDay,symbol,status:hasInvalid?'invalid':incomplete?'incomplete':'ready',
  canPresentAsVerified:!incomplete,evidence:display,refreshPlan,queueStatus,
  coverage:{total:SOURCE_KEYS.length,usable:SOURCE_KEYS.filter(k=>parts[k].status==='usable').length,
   missing:SOURCE_KEYS.filter(k=>parts[k].status!=='usable')},
  note:'근거 품질·조회 필요성 진단만 수행 · 예측 신뢰점수/매매 신호/자동 데이터 조회 없음'};
}
const api=Object.freeze({audit,component,sourceEvidence,date});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestEvidenceAudit=api;
})(globalThis);
