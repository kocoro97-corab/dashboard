(function(root){'use strict';
/**
 * MY INVEST V2 — integration of already computed market, sector and stock
 * facts. PURE, READ-ONLY, NO NETWORK, NO ORDERS, NO ACCOUNTS PERSISTED.
 *
 * Every observation is evidence-gated. A risk veto takes precedence over
 * positive setup observations. "Candidate" never means a buy order.
 */
const SYMBOL=/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const safeNumber=v=>typeof v==='number'&&Number.isFinite(v);
const positive=v=>safeNumber(v)&&v>0;
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const dayDiff=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
const round=n=>safeNumber(n)?Math.round(n*10000)/10000:null;
function region(symbol){return /^\d{6}$/.test(symbol)?'KR':'US'}
function validateStock(stock,mode){
 if(!stock||typeof stock!=='object'||stock.status!=='descriptive'||!SYMBOL.test(stock.symbol||'')||!['KR','US'].includes(stock.market)||
  stock.market!==region(stock.symbol)||stock.mode!==mode||!validDay(stock.asOf)||stock.evidence?.symbol!==stock.symbol||
  stock.evidence?.market!==stock.market||stock.evidence?.asOf!==stock.asOf||
  typeof stock.evidence?.source!=='string'||!stock.evidence.source.trim()||
  !stock.setup||stock.setup.status!=='descriptive'||!Array.isArray(stock.setup.candidates))
  return {ok:false,reason:'종목 관측 자료·출처·거래일 검증 실패'};
 return {ok:true};
}
function matchRegime(regime,stock,mode){
 if(!regime||regime.status!=='descriptive'||regime.region!==stock.market||!Array.isArray(regime.evidence)||regime.evidence.length<2||
  !['up','down','mixed'].includes(regime.direction?.state)||regime.execution?.[mode]==null)
  return {status:'unknown',reason:'시장 국면 근거 미연결'};
 // A 1-day direction is not a 20-day trend. Accept historical closes only
 // if both core indicators share a VERIFIED exchange reference day.
 const days=new Set(regime.evidence.map(x=>x.referenceDay));
 if(days.size!==1||!validDay(regime.evidence[0].referenceDay))
  return {status:'unknown',reason:'핵심 지수 기준일 불일치'};
 const benchmarkDay=regime.evidence[0].referenceDay;
 // KR or US stock sessions need to align; do not use today's stock
 // against last week's market if calendar/quote basis differs.
 if(benchmarkDay!==stock.asOf)return {status:'unknown',reason:'시장 국면·종목 거래일 불일치'};
 return {status:'verified',direction:regime.direction.state,
  riskLevel:['high','elevated','reference-low'].includes(regime.risk?.level)?regime.risk.level:'unknown',
  momentum:regime.momentum?.state||'unknown',execution:regime.execution[mode],
  referenceDay:benchmarkDay,sources:regime.evidence.slice(0,5).map(x=>({symbol:x.symbol,source:x.source,asOf:x.asOf}))};
}
function matchSector(sector,stock){
 if(!sector||sector.status!=='descriptive'||sector.market!==stock.market||sector.asOf!==stock.asOf||
  sector.rotation?.status!=='descriptive'||!['industry','theme','sector_etf_proxy'].includes(sector.type)||
  typeof sector.source!=='string'||!sector.source.trim()||!safeNumber(sector.rotation.relative5dPp)||!safeNumber(sector.rotation.relative20dPp))
  return {status:'unknown',reason:'동일 거래일 산업·테마 상대강도 근거 미확인'};
 return {status:'verified',sectorId:sector.id||null,sectorName:sector.name||'산업명 미확인',
  relative5dPp:round(sector.rotation.relative5dPp),relative20dPp:round(sector.rotation.relative20dPp),
  isProxy:sector.type==='sector_etf_proxy',source:sector.source,asOf:sector.asOf};
}
function checkEvent(event,stock,mode){
 if(!event||event.status!=='ready')return {status:'unknown',reason:'실적·거시 일정 위험 미확인'};
 // Ingest only PUBLIC aggregate event status for the selected symbol; never
 // accept private Google Calendar events as investment evidence.
 const rows=Array.isArray(event.events)?event.events:[];
 const limit=mode==='day'?2:14,found=[];
 for(const e of rows){
  if(!e||!validDay(e.date)||!['economic','earnings'].includes(e.kind)||e.verified!==true||e.dateStatus==='estimated')continue;
  if(e.kind==='earnings'&&(e.symbol!==stock.symbol||e.market!==stock.market))continue;
  const distance=dayDiff(e.date,stock.asOf);
  if(distance>=0&&distance<=limit)found.push({kind:e.kind,date:e.date,type:typeof e.type==='string'?e.type.slice(0,50):'미상',symbol:e.kind==='earnings'?stock.symbol:null});
 }
 return {status:'verified',nearby:found.length>0,count:found.length,
  warnings:found.slice(0,10),scope:'확인된 공개 일정만 반영 · 미수집 일정은 위험 없음으로 해석 금지'};
}
function holdingEvidence(holding,stock){
 if(!holding||typeof holding!=='object')return {status:'unavailable',reason:'검증된 보유계좌 자료 없음'};
 if(holding.verified!==true||holding.symbol!==stock.symbol||holding.market!==stock.market||
  holding.currency!==(stock.market==='KR'?'KRW':'USD')||
  !positive(holding.quantity)||!positive(holding.avgPrice))
  return {status:'unverified',reason:'보유 수량·매입단가·통화 검증 실패'};
 // Never return quantity, average price, account ID, full valuation, broker or
 // other private user data. A coarse relative-to-cost status is sufficient.
 const last=stock.references?.lastClose;
 const pnl=positive(last)?round((last/holding.avgPrice-1)*100):null;
 const state=pnl===null?'unknown':pnl>0?'above-cost':pnl<0?'below-cost':'near-cost';
 return {status:'verified',costRelation:state,costReturnPct:pnl,
  scope:'단일 검증된 보유 기록 기준 · 계좌별 원금과 수량은 별도 비공개 화면 유지'};
}
function assess({mode='swing',intent='candidate',stock,regime=null,sector=null,event=null,holding=null,
 nowDay=null}={}){
 if(!['day','swing'].includes(mode)||!['candidate','holding'].includes(intent))throw Error('STRATEGY_INPUT_INVALID');
 const verified=validateStock(stock,mode);
 const base={schemaVersion:1,intent,mode,symbol:SYMBOL.test(stock?.symbol||'')?stock.symbol:null,
  market:['KR','US'].includes(stock?.market)?stock.market:null,asOf:validDay(stock?.asOf)?stock.asOf:null};
 if(!verified.ok)return {...base,status:'insufficient',label:'근거 부족 · 판단 보류',reasons:[verified.reason],evidence:[],conditions:[],blocking:['stock-unverified'],action:'no-action'};
 if(nowDay!==null&&(!validDay(nowDay)||nowDay<stock.asOf||dayDiff(nowDay,stock.asOf)>10))
  return {...base,status:'insufficient',label:'일봉 기준일 오래됨 · 판단 보류',reasons:['기준일 검증 실패'],evidence:[],conditions:[],blocking:['stale-stock'],action:'no-action'};
 const context=matchRegime(regime,stock,mode),group=matchSector(sector,stock),calendar=checkEvent(event,stock,mode);
 const owned=intent==='holding'?holdingEvidence(holding,stock):{status:'not-applicable'};
 const reasons=[],blocking=[],conditions=[],evidence=[{kind:'stock',symbol:stock.symbol,asOf:stock.asOf,source:stock.evidence.source}];
 if(context.status!=='verified'){blocking.push('market-unverified');reasons.push(context.reason)}
 else{
  evidence.push(...context.sources.map(x=>({kind:'market',...x})));
  if(context.riskLevel==='high'||context.execution==='caution'){blocking.push('market-high-risk');reasons.push('시장 변동성 위험 높음')}
  if(context.riskLevel==='unknown'){blocking.push('market-risk-unknown');reasons.push('VIX 등 시장 위험 근거 미확인')}
  if(context.direction==='down')reasons.push('주요 지수 일일 하락 우위');
  if(mode==='swing'&&context.momentum==='unknown'){blocking.push('market-trend-unknown');reasons.push('중기 시장 추세 미확인')}
 }
 if(group.status!=='verified'){blocking.push('sector-unverified');reasons.push(group.reason)}
 else{
  evidence.push({kind:'sector',id:group.sectorId,source:group.source,asOf:group.asOf});
  if(group.relative5dPp>0&&group.relative20dPp>0)conditions.push('시장 대비 산업 강세 관측');
  else reasons.push('산업 상대강도 지속 우위 미확인');
 }
 if(calendar.status==='unknown'){blocking.push('events-unverified');reasons.push(calendar.reason)}
 if(calendar.nearby){blocking.push('event-near');reasons.push('주요 경제·기업 발표 일정 임박')}
 const trend=stock.setup.trend;
 if(trend==='down')reasons.push('종목의 확정 일봉 하락 추세');
 if(trend==='insufficient'){blocking.push('stock-trend-unknown');reasons.push('종목 60봉 추세 판단 근거 부족')}
 const validSetup=stock.setup.candidates.filter(x=>x&&typeof x.type==='string'&&typeof x.label==='string').map(x=>x.type);
 const dayCandidate=validSetup.includes('breakout_volume');
 const swingCandidate=validSetup.includes('breakout_swing')||validSetup.includes('pullback_ma20');
 if(mode==='day'&&dayCandidate)conditions.push('확정봉 돌파·거래량 확대 관측');
 else if(mode==='swing'&&swingCandidate)conditions.push('확정 일봉 스윙 관찰조건 충족');
 else reasons.push('선택 기간의 기술 관찰조건 미충족');
 if(stock.relative?.status!=='ready'||stock.relative.period5?.status!=='ready'||
   mode==='swing'&&stock.relative.period20?.status!=='ready'){
  blocking.push('relative-unverified');reasons.push('개별 종목 시장 대비 상대강도 미확인');
 }else{
  if(stock.relative.period5.relativePp>0)conditions.push('종목 5일 상대강도 우위');
  else reasons.push('종목 5일 상대강도 우위 없음');
 }
 if(intent==='holding'&&owned.status!=='verified'){blocking.push('holding-unverified');reasons.push(owned.reason)}
 const reference=stock.references||{};
 const support=reference.supportStatus==='reference-only'&&positive(reference.observedSupport)?{
  status:'observed',support:reference.observedSupport,
  referenceLossPct:positive(reference.riskToObservedSupportPct)?reference.riskToObservedSupportPct:null,
  atrPct:positive(reference.atrPct)?reference.atrPct:null
 }:{status:'unavailable',support:null,referenceLossPct:null,atrPct:null};
 if(support.status==='unavailable')blocking.push('risk-reference-unverified');
 const uniqueBlocking=[...new Set(blocking)];
 const veto=uniqueBlocking.includes('market-high-risk')||uniqueBlocking.includes('event-near');
 // No numeric confidence or fabricated opportunity score.
 const status=uniqueBlocking.length?'review-required':'observed';
 let label;
 if(intent==='candidate'){
  label=veto?'신규 진입 경계 · 이벤트/시장 위험':
   uniqueBlocking.length?'신규 후보 · 추가 근거 확인 필요':
   (mode==='day'?dayCandidate:swingCandidate)?'신규 후보 · 관찰조건 충족(매수 신호 아님)':'신규 후보 · 추격 진입 근거 부족';
 }else{
  label=veto?'보유종목 · 변동성 및 위험관리 조건 점검':
   uniqueBlocking.length?'보유종목 · 데이터 확인 및 손실관리 점검':
   trend==='down'?'보유종목 · 추세 훼손 여부 점검':'보유종목 · 추세·참조 지지선 점검';
 }
 return {...base,status,label,reasons,conditions,evidence,blocking:uniqueBlocking,
  marketContext:context.status==='verified'?{status:context.status,direction:context.direction,riskLevel:context.riskLevel,momentum:context.momentum}:context,
  sectorContext:group,events:calendar,holding:owned,reference:support,
  action:'review-only',
  disclaimers:['단타/스윙 관측 조건과 위험 점검 · 추천/주문/비중 변경 지시가 아님',
   '실시간 호가·체결·갭·수수료·실적 실제치는 별도 검증 필요',
   '계좌번호·보유수량·평단가 등 개인 정보는 분석 결과에 포함하지 않음']};
}
const api=Object.freeze({assess,validateStock,matchRegime,matchSector,checkEvent,holdingEvidence});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestIntegratedStrategy=api;
})(globalThis);
