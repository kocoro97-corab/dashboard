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
  analysis.observedAt<=analysis.receivedAt+300000&&analysis.observedAt<=now+300000&&
  analysis.receivedAt<=now+300000&&now-analysis.receivedAt<=30*60000;
 const priceBars=identity&&bars.length>=21&&bars.every(b=>b&&[b.o,b.h,b.l,b.c].every(v=>Number.isFinite(v)&&v>0));
 const checks=[
  {key:'market',label:'시장 지수 기준일·관측시각',state:marketRegime?.status==='descriptive'?'usable':'missing',
   detail:marketRegime?.status==='descriptive'?marketRegime.direction.label:'필요한 핵심 지수 자료가 없거나 시점이 불일치'},
  {key:'ohlcv',label:'기존 종목 일봉·원천',state:priceBars&&sourceTimes?'received':'missing',
   detail:priceBars&&sourceTimes?bars.length+'개 공개 일봉 · '+analysis.source:'검증된 원천·OHLCV·수신시각 미확인'},
  {key:'session',label:'거래소 기준 거래일·봉 마감 검증',state:'missing',
   detail:'원천 거래일과 완료봉을 별도 검증하기 전에는 신규 단타·스윙 엔진 판단 보류'},
  {key:'industry',label:'동일 거래일 산업 강도·종목 소속',state:'missing',
   detail:'현재 캐시만으로 신뢰 가능한 산업 소속·상대강도 연결을 확정할 수 없음'},
  {key:'events',label:'공식 발표·실적의 전체 수집 범위',state:'missing',
   detail:'공식 일정 일부 미수집 상태가 있을 수 있어 안전 판정 불가'}
 ];
 return {status:checks.every(c=>c.state==='usable')?'ready':'partial',
  symbol,market,mode,marketRegime,checks,canUseStrictStockSetup:false,
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
  body.append(row('p','원천: '+(info.source||'미확인')+' · 수신시각: '+(info.receivedAt||'미확인')));
  body.append(row('p','엄격한 단타·스윙 판정은 거래소 날짜·완료봉·산업 소속 증거 확보 후에만 활성화됩니다.'));
 }
 details.addEventListener('toggle',draw);
 return {ok:true,update:draw,destroy(){active=false;details.removeEventListener('toggle',draw);details.remove()}};
}
const api=Object.freeze({evaluate,mount});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestAnalysisIntegrationPanelV1=api;
})(globalThis);
