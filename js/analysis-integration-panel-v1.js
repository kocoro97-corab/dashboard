(function(root){'use strict';
/**
 * Read-only strategy integration preview. Reuses public market quote objects
 * and the already-cached InvestWorkflow OHLCV. Never performs requests.
 * Does NOT fabricate verified exchange-session daily bar dates.
 */
const symbolPattern=/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const validSymbol=s=>typeof s==='string'&&symbolPattern.test(s);
function evaluate({selection=null,analysis=null,quotes=null,quoteSources=null,received=null,now=Date.now()}={}){
 if(!Number.isFinite(now)||now<=0||now>8.64e15)throw Error('ANALYSIS_BRIDGE_DATE_INVALID');
 const market=selection?.market==='KR'?'KR':selection?.market==='US'?'US':null;
 const symbol=validSymbol(selection?.symbol)?selection.symbol:null;
 const mode=selection?.mode==='day'?'day':'swing';
 if(!market||!symbol||market==='KR'!==/^\d{6}$/.test(symbol))
  return {status:'unavailable',symbol:null,mode,market:null,reason:'검증된 종목 선택 없음',marketRegime:null,
   checks:[],canUseStrictStockSetup:false};
 const indexCore=market==='KR'?['^KS11','^KQ11']:['^GSPC','^IXIC'];
 const quoteSnapshot={};
 for(const id of [...indexCore,'^VIX','KRW=X','^SOX']){
  const q=quotes?.[id];if(!q||typeof q!=='object')continue;
  quoteSnapshot[id]={p:q.p,prev:q.prev,observedAt:q.observedAt,
   refreshFailed:q.refreshFailed===true,source:typeof quoteSources?.[id]==='string'?quoteSources[id]:'출처 미확인'};
 }
 let marketRegime=null;
 try{
  const engine=root.MYInvestMarketRegime;
  if(engine?.assess&&engine?.adaptQuotes){
   const normal=engine.adaptQuotes(quoteSnapshot,quoteSources||{},received||{},now);
   marketRegime=engine.assess({region:market,observations:normal,now});
  }
 }catch{marketRegime=null}
 const identity=analysis?.symbol===symbol&&analysis?.currency===(market==='KR'?'KRW':'USD')&&
  typeof analysis.source==='string'&&analysis.source.trim()&&typeof analysis.exchange==='string'&&analysis.exchange.trim();
 const bars=Array.isArray(analysis?.bars)?analysis.bars:[];
 const sourceTimes=identity&&Number.isFinite(analysis.observedAt)&&Number.isFinite(analysis.receivedAt)&&
  analysis.observedAt>0&&analysis.receivedAt>0&&analysis.observedAt<=analysis.receivedAt+300000&&
  analysis.observedAt<=now+300000&&analysis.receivedAt<=now+300000&&
  now-analysis.receivedAt<=30*60000&&now-analysis.observedAt<=4*86400000;
 const priceBars=identity&&bars.length>=21&&bars.every(b=>b&&
  [b.o,b.h,b.l,b.c].every(v=>Number.isFinite(v)&&v>0)&&
  b.h>=Math.max(b.o,b.l,b.c)&&b.l<=Math.min(b.o,b.h,b.c));
 const session=analysis?.sessionProof;
 let stockSetup=null;
 if(identity&&session?.status==='ready'&&sourceTimes&&
  root.MYInvestStockSetupAdapter?.adaptCached&&root.MYInvestStockSetup?.assess){
  try{
   const adapted=root.MYInvestStockSetupAdapter.adaptCached(analysis,{symbol,market});
   if(adapted.status==='ready'){
    const zone=session.zone;
    const nowDay=root.MYInvestExchangeSessionProof?.localDay(now,zone);
    if(nowDay)stockSetup=root.MYInvestStockSetup.assess({
     symbol,market,currency:analysis.currency,bars:adapted.bars,
     mode,verified:true,source:adapted.source,nowDay
    });
   }
  }catch{stockSetup=null}
 }
 const checks=[
  {key:'market',label:'시장 지수 기준일·관측시각',state:marketRegime?.status==='descriptive'?'usable':'missing',
   detail:marketRegime?.status==='descriptive'?marketRegime.direction.label:'필요한 핵심 지수 자료가 없거나 시점이 불일치'},
  {key:'ohlcv',label:'기존 종목 일봉·원천',state:priceBars&&sourceTimes?'received':'missing',
   detail:priceBars&&sourceTimes?bars.length+'개 공개 일봉 · '+analysis.source:
    '종목 식별·확정 가격·원천 관측시각(4일 이내)·수신시각(30분 이내) 중 미확인'},
  {key:'session',label:'거래소 기준 거래일·봉 마감 검증',
   state:session?.status==='ready'&&stockSetup?.status==='descriptive'?'usable':'missing',
   detail:stockSetup?.status==='descriptive'?
    '거래소 현지 날짜 검증 · 마지막 확정봉 '+stockSetup.asOf+
    ' · 검증된 '+session.closedDates.length+'봉 · 장중/미확정 '+session.openDates.length+'봉 제외':
    session?.status==='ready'?'거래일 '+session.dates.length+'개 확인 · 확정봉 부족 또는 분석 모듈 미연결':
    '거래소 현지 날짜·완료봉 미검증 · 추가 데이터 요구'},
  {key:'marketRisk',label:'시장 위험 참고지표',state:marketRegime?.risk?.level&&marketRegime.risk.level!=='unknown'?'usable':'missing',
   detail:marketRegime?.risk?.level&&marketRegime.risk.level!=='unknown'?
    'VIX/환율 관측 위험 구간 '+marketRegime.risk.label+' · 투자 안전 판정 아님':
    'VIX 기준 자료 없음 · 위험 낮음으로 해석 금지'},
  {key:'industry',label:'동일 거래일 산업 강도·종목 소속',state:'missing',
   detail:'현재 캐시만으로 신뢰 가능한 산업 소속·상대강도 연결을 확정할 수 없음'},
  {key:'events',label:'공식 발표·실적의 전체 수집 범위',state:'missing',
   detail:'공식 일정 일부 미수집 상태가 있을 수 있어 안전 판정 불가'}
 ];
 return {status:checks.every(c=>c.state==='usable')?'ready':'partial',
  symbol,market,mode,marketRegime,stockSetup,checks,
  canUseStrictStockSetup:stockSetup?.status==='descriptive',
  source:identity?analysis.source:null,receivedAt:sourceTimes?new Date(analysis.receivedAt).toISOString():null,
  warnings:['기존 캐시만 이용 · 추가 API 호출 없음','확인되지 않은 거래일·마감봉을 임의 보정하지 않음',
   '분석 준비 상태이며 매수·매도·주문 판단이 아님']};
}
function mount(container,provider){
 if(!container||typeof container.append!=='function'||typeof provider!=='function')
  return {ok:false};
 const details=document.createElement('details');details.className='str4-compare-disclosure';
 details.setAttribute('data-module','analysis-integration-readiness-v1');
 const header=document.createElement('summary');header.textContent='통합 투자 분석 · 실데이터 근거 확인 (조회 없음)';
 const body=document.createElement('div');body.className='str4-compare-host';
 details.append(header,body);container.append(details);
 let active=true;
 const row=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el};
 function draw(){
  if(!active||!details.open)return;
  body.replaceChildren();
  let info;try{info=evaluate(provider())}catch{body.append(row('p','분석 준비 상태를 확인할 수 없습니다. 기존 전략 기능은 계속 사용할 수 있습니다.'));return}
  if(!info.symbol){body.append(row('p',info.reason));return}
  body.append(row('p',info.symbol+' · '+(info.market==='KR'?'한국':'미국')+' · '+(info.mode==='day'?'단타':'스윙')));
  for(const c of info.checks)body.append(row('p',(c.state==='usable'?'● 확인':c.state==='received'?'◇ 수신':'△ 확인 필요')+' · '+c.label+' — '+c.detail));
  const evidence=info.marketRegime?.evidence||[];
  if(evidence.length){
   const title=row('p','시장 방향 산출 근거 · 종목 지지선/목표가와 무관');body.append(title);
   for(const item of evidence){
    const d=Number.isFinite(item.delta)?(item.delta>=0?'+':'')+item.delta.toFixed(2)+'%':'등락 미확인';
    body.append(row('p',item.symbol+' '+d+' · '+(item.source||'출처 미확인')+
      ' · 거래일 '+(item.referenceDay||'미확인')+
      ' · 관측 '+(item.asOf||'미확인')+' · 수신 '+(item.receivedAt||'미확인')));
   }
  }
  body.append(row('p','원천: '+(info.source||'미확인')+' · 수신시각: '+(info.receivedAt||'미확인')));
  if(info.stockSetup?.status==='descriptive'){
   body.append(row('p','확정 일봉 기술적 관측 (실시간 매매 신호 아님) · '+info.stockSetup.asOf));
   body.append(row('p','추세 '+info.stockSetup.setup.trend+
    ' · 20봉 고점 돌파 '+(info.stockSetup.setup.closeBreak20===true?'확인':info.stockSetup.setup.closeBreak20===false?'미충족':'미확인')+
    ' · 거래량 상태 '+info.stockSetup.setup.volumeStatus));
   body.append(row('p','관찰조건: '+(info.stockSetup.setup.candidates.map(c=>c.label).join(' · ')||'확인된 조건 없음')));
   body.append(row('p','시장 상대강도·산업 소속·이벤트 전체 범위 미연결: 진입·보유 전략 확정 불가'));
  }else body.append(row('p','확정 일봉의 거래소 날짜·OHLCV 검증이 완료되지 않아 엄격한 종목 분석을 보류합니다.'));
 }
 details.addEventListener('toggle',draw);
 return {ok:true,update:draw,destroy(){active=false;details.removeEventListener('toggle',draw);details.remove()}};
}
const api=Object.freeze({evaluate,mount});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestAnalysisIntegrationPanelV1=api;
})(globalThis);
