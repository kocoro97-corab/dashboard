(function(root){'use strict';
/**
 * MY INVEST V2 — verified stock day/swing SETUP analysis v1.
 * Independent read-only engine. No prices/orders/accounts/API calls.
 * A setup is an OBSERVED technical condition, NOT an entry signal.
 */
const SYMBOL=/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const nonneg=x=>finite(x)&&x>=0;
const pct=(a,b)=>positive(a)&&positive(b)?(a/b-1)*100:null;
const dateValid=s=>typeof s==='string'&&DATE.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const round=x=>finite(x)?Math.round(x*10000)/10000:null;
function normalizeBars(raw){
 if(!Array.isArray(raw)||!raw.length||raw.length>370)return {status:'invalid',reason:'검증된 일봉 없음/최대 개수 초과'};
 let last='',bars=[];
 for(const b of raw){
  if(!b||!dateValid(b.date)||b.date<=last||![b.o,b.h,b.l,b.c].every(positive)||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h)||
     b.v!=null&&!nonneg(b.v)||b.turnover!=null&&!nonneg(b.turnover)||b.closed!==true)
   return {status:'invalid',reason:'일봉 거래일·OHLC·종가 확정·거래량 오류'};
  last=b.date;bars.push({date:b.date,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v??null,turnover:b.turnover??null});
 }
 return {status:'ready',bars,asOf:last};
}
const sma=(bars,n,key='c')=>bars.length>=n?bars.slice(-n).reduce((s,x)=>s+x[key],0)/n:null;
function returnAt(bars,n){
 return bars.length>n?pct(bars.at(-1).c,bars.at(-1-n).c):null;
}
function alignedRelative(bars,benchmark,n){
 if(!Array.isArray(benchmark)||benchmark.length<n+1)return {status:'insufficient',reason:'기준지수 일봉 부족'};
 const dates=benchmark.slice(-n-1).map(x=>x.date),byDate=new Map(bars.map(b=>[b.date,b.c]));
 const values=dates.map(x=>byDate.get(x));
 if(values.some(v=>!positive(v)))return {status:'insufficient',reason:'동일 거래일 종목 가격 누락'};
 const stock=pct(values.at(-1),values[0]),base=pct(benchmark.at(-1).c,benchmark.at(-1-n).c);
 return {status:'ready',stockReturnPct:round(stock),benchmarkReturnPct:round(base),relativePp:round(stock-base),startDate:dates[0],endDate:dates.at(-1)};
}
function riskLevels(bars,{market,mode}={}){
 const last=bars.at(-1),ma20=sma(bars,20),atr=(()=>{if(bars.length<15)return null;
  const last15=bars.slice(-15);let sum=0;
  for(let i=1;i<last15.length;i++){
   const b=last15[i],prior=last15[i-1].c;
   sum+=Math.max(b.h-b.l,Math.abs(b.h-prior),Math.abs(b.l-prior));
  }return sum/14;})();
 const low5=bars.length>=5?Math.min(...bars.slice(-5).map(b=>b.l)):null;
 const previous20=bars.length>=21?Math.max(...bars.slice(-21,-1).map(b=>b.h)):null;
 const swingStop=low5!==null&&ma20!==null?Math.min(low5,ma20):null;
 const dayStop=low5!==null?last.l:null;
 const stop=mode==='day'?dayStop:swingStop;
 const riskPct=stop!==null&&stop<last.c?round((last.c-stop)/last.c*100):null;
 return {atr14:round(atr),atrPct:atr===null?null:round(atr/last.c*100),
  lastClose:last.c,referenceLow5:low5,priorHigh20:previous20,ma20,
  observedSupport:stop,riskToObservedSupportPct:riskPct,
  supportStatus:stop!==null&&stop<last.c?'reference-only':'unavailable',
  note:'기술적 참조 지지선 · 실제 손절 주문가/목표가가 아님; 갭·슬리피지 미반영'};
}
function classify(bars,mode){
 const last=bars.at(-1),ma5=sma(bars,5),ma20=sma(bars,20),ma60=sma(bars,60);
 const prior=bars.slice(-21,-1),prior20=prior.length===20?Math.max(...prior.map(x=>x.h)):null;
 const priorLow=prior.length===20?Math.min(...prior.map(x=>x.l)):null;
 const vPrior=prior.length===20&&prior.every(x=>nonneg(x.v))?prior.reduce((s,x)=>s+x.v,0)/20:null;
 const volumeRatio=vPrior!==null&&vPrior>0&&nonneg(last.v)?last.v/vPrior:null;
 const break20=prior20!==null?last.c>prior20:null;
 const nearMA20=ma20!==null?Math.abs(last.c-ma20)/ma20<=0.035:null;
 const strongTrend=ma20!==null&&ma60!==null&&ma20>ma60&&last.c>ma20;
 const pullback=strongTrend&&nearMA20===true&&last.c>last.o&&last.l<=ma20*1.035;
 const trend=ma5!==null&&ma20!==null&&ma60!==null?
  (ma5>ma20&&ma20>ma60?'up':ma5<ma20&&ma20<ma60?'down':'mixed'):'insufficient';
 const volumeLabel=volumeRatio===null?'unknown':volumeRatio>=1.5?'expanded':volumeRatio<0.7?'contracted':'normal';
 const candidates=[];
 if(mode==='day'){
  if(break20===true&&volumeRatio!==null&&volumeRatio>=1.5)candidates.push({type:'breakout_volume',label:'20봉 고점 종가 돌파·거래량 확대 관측'});
  else if(break20===true)candidates.push({type:'breakout_unconfirmed_volume',label:'20봉 고점 돌파 관측·거래량 확인 필요'});
 }else{
  if(break20===true&&volumeRatio!==null&&volumeRatio>=1.2)candidates.push({type:'breakout_swing',label:'20봉 고점 종가 돌파·거래량 확인'});
  if(pullback)candidates.push({type:'pullback_ma20',label:'상승 추세 중 20일선 근접·양봉 관측'});
 }
 return {status:bars.length<21?'insufficient':'descriptive',trend,
  change1dPct:round(bars.length>=2?pct(last.c,bars.at(-2).c):null),
  return5dPct:round(returnAt(bars,5)),return20dPct:round(returnAt(bars,20)),
  ma5:round(ma5),ma20:round(ma20),ma60:round(ma60),
  priorHigh20:prior20,priorLow20:priorLow,
  volumeRatio20:round(volumeRatio),volumeStatus:volumeLabel,
  closeBreak20:break20,pullbackNearMA20:nearMA20,
  candidates,method:'전일 이전 20봉 고점 비교 · 확정 일봉만 활용 · 추격 매수 판단 아님'};
}
function regimeSummary(regime,market){
 if(!regime||regime.region!==market||!['descriptive','insufficient'].includes(regime.status))return {status:'unknown',reason:'검증된 시장 국면 미연결'};
 if(regime.status!=='descriptive')return {status:'insufficient',reason:'시장 국면 판단 보류'};
 return {status:'observed',direction:regime.direction?.state||'unknown',
  riskLevel:regime.risk?.level||'unknown',momentum:regime.momentum?.state||'unknown'};
}
function sectorSummary(sector,market){
 if(!sector||sector.market!==market||sector.status!=='descriptive'||!sector.rotation||sector.rotation.status!=='descriptive')
  return {status:'unknown',reason:'검증된 산업 상대강도 미연결'};
 return {status:'observed',relative5dPp:round(sector.rotation.relative5dPp),
  relative20dPp:round(sector.rotation.relative20dPp),scope:sector.type==='sector_etf_proxy'?'ETF 대용지표':'검증된 제공 후보'};
}
function assess({symbol,market,currency,bars,benchmark=null,mode='swing',source,verified=false,regime=null,sector=null,nowDay=null}={}){
 if(!['KR','US'].includes(market)||!SYMBOL.test(symbol||'')||!['day','swing'].includes(mode)||currency!==(market==='KR'?'KRW':'USD')||
 !verified||typeof source!=='string'||!source.trim())return {status:'unavailable',reason:'시장·종목·통화·출처 신원 검증 실패'};
 if(market==='KR'&&!/^\d{6}$/.test(symbol)||market==='US'&&/^\d{6}$/.test(symbol))
  return {status:'unavailable',reason:'시장·종목 코드 불일치'};
 const checked=normalizeBars(bars);
 if(checked.status!=='ready')return {status:'unavailable',reason:checked.reason};
 const values=checked.bars;
 if(nowDay!==null){
  if(!dateValid(nowDay)||nowDay<checked.asOf)return {status:'unavailable',reason:'분석 기준일·일봉 날짜 불일치'};
  const age=(Date.parse(nowDay+'T00:00:00Z')-Date.parse(checked.asOf+'T00:00:00Z'))/86400000;
  if(age>10)return {status:'unavailable',reason:'오래된 일봉 · 현재 종목 분석 불가'};
 }
 const setup=classify(values,mode),references=riskLevels(values,{market,mode});
 let relative={status:'unavailable',reason:'시장 기준지수 미연결'};
 if(benchmark?.market===market&&benchmark.currency===currency&&benchmark.verified===true&&typeof benchmark.source==='string'&&benchmark.source.trim()&&typeof benchmark.symbol==='string'&&
  (market==='KR'?/^(?:\^KS11|\^KQ11)$/:/^(?:SPY|\^GSPC|\^IXIC)$/).test(benchmark.symbol)){
  const b=normalizeBars(benchmark.bars);
  if(b.status==='ready'&&b.asOf===checked.asOf){
   relative={status:'ready',period5:alignedRelative(values,b.bars,5),
    period20:alignedRelative(values,b.bars,20),benchmarkSymbol:benchmark.symbol,asOf:b.asOf};
  }else relative={status:'insufficient',reason:'종목·기준지수 확정 거래일 불일치'};
 }
 const marketContext=regimeSummary(regime,market),sectorContext=sectorSummary(sector,market);
 const evidence={symbol,source,market,currency,asOf:checked.asOf,observations:values.length,
  benchmark:relative.status==='ready'?relative.benchmarkSymbol:null};
 const warnings=['확정된 일봉의 기술적 관측이며 미래 가격 예측/매매 신호가 아님',
  '장중 돌파·호가·체결 강도·기관/외국인 수급은 별도 검증 데이터 없으면 미확인',
  '기술적 지지선은 주문 손절가가 아니며 갭·슬리피지·수수료를 포함하지 않음'];
 if(marketContext.status!=='observed')warnings.push('시장 국면 정보 미연결');
 if(sectorContext.status!=='observed')warnings.push('산업 상대강도 정보 미연결');
 return {status:setup.status==='descriptive'?'descriptive':'insufficient',
  symbol,market,mode,asOf:checked.asOf,setup,references,relative,
  marketContext,sectorContext,evidence,warnings,
  role:'관심 후보 조건 점검 · 신규 후보/보유종목 실제 진입과 주문은 별도 사용자 판단'};
}
const api=Object.freeze({assess,normalizeBars,classify,alignedRelative,regimeSummary,sectorSummary});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestStockSetup=api;
})(globalThis);
