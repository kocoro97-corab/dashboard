(function(root){'use strict';
/**
 * MY INVEST V2 — verified, read-only market-regime decision support.
 * No network access, account access, storage, orders or external dependencies.
 * This module consumes ALREADY received data and never substitutes guesses
 * for missing quotes, historical closes, or unverified NYSE TICK.
 *
 * Outputs are descriptive conditions, NOT predictions or trade signals.
 */
const DAY=86400000,MINUTE=60000;
const MARKET=Object.freeze({
 KR:Object.freeze({core:Object.freeze(['^KS11','^KQ11']),zone:'Asia/Seoul',label:'한국'}),
 US:Object.freeze({core:Object.freeze(['^GSPC','^IXIC']),zone:'America/New_York',label:'미국'})
});
const OPTIONAL=Object.freeze(['^SOX','^VIX','KRW=X','^TNX','NQ=F','ES=F','YM=F','TICK']);
const ALLOWED=new Set([...MARKET.KR.core,...MARKET.US.core,...OPTIONAL]);
const isNumber=v=>typeof v==='number'&&Number.isFinite(v);
const finitePositive=v=>isNumber(v)&&v>0;
const pct=(current,prior)=>finitePositive(current)&&finitePositive(prior)?(current/prior-1)*100:null;
const iso=ms=>isNumber(ms)?new Date(ms).toISOString():null;
function numberTime(value){
 if(value==null||value==='')return null;
 const t=typeof value==='number'?(value>0&&value<1e11?value*1000:value):Date.parse(value);
 return isNumber(t)&&t>0?t:null;
}
function dayOf(ms,zone){
 const parts={};for(const p of new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)))if(p.type!=='literal')parts[p.type]=p.value;
 return parts.year+'-'+parts.month+'-'+parts.day;
}
function cleanSource(s){return typeof s==='string'&&s.length<100?s:'출처 미확인'}
function adaptQuotes(quotes={},sources={},received={},now=Date.now()){
 const out={};for(const symbol of ALLOWED){
  const q=quotes?.[symbol];if(!q||typeof q!=='object')continue;
  const price=isNumber(q.p)?q.p:null,previous=isNumber(q.prev)?q.prev:null;
  const observedAt=numberTime(q.at??q.observedAt??q.time);
  const receivedAt=numberTime(received?.[symbol]??q.receivedAt);
  out[symbol]={symbol,value:price,previous,observedAt,receivedAt,
   source:cleanSource(sources?.[symbol]??q.source),
   failed:q.refreshFailed===true,marketStatus:typeof q.marketStatus==='string'?q.marketStatus:null,
   contractVerified:q.contractVerified===true};
 }
 return out;
}
function validateQuote(raw,symbol,now,zone){
 if(!raw||typeof raw!=='object')return {symbol,usable:false,reason:'자료 없음'};
 const value=raw.value,previous=raw.previous;
 if(!finitePositive(value))return {symbol,usable:false,reason:'지수값 미확인'};
 if(!finitePositive(previous))return {symbol,usable:false,reason:'전일 종가 미확인'};
 const delta=pct(value,previous);
 const receivedAt=numberTime(raw.receivedAt),observedAt=numberTime(raw.observedAt);
 if(raw.failed===true)return {symbol,usable:false,reason:'최근 조회 실패'};
 if(receivedAt===null)return {symbol,usable:false,reason:'수신시각 미확인'};
 if(observedAt===null)return {symbol,usable:false,reason:'원천 관측시각 미확인'};
 if(receivedAt>now+5*MINUTE||observedAt>now+5*MINUTE)return {symbol,usable:false,reason:'미래 시각 오류'};
 if(now-receivedAt>30*MINUTE)return {symbol,usable:false,reason:'수신시각 오래됨'};
 const age=now-observedAt;
 if(age>4*DAY)return {symbol,usable:false,reason:'원천시각 오래됨'};
 if(observedAt>receivedAt+5*MINUTE)return {symbol,usable:false,reason:'원천·수신시각 불일치'};
 return {symbol,usable:true,delta,value,previous,observedAt,receivedAt,
  asOf:iso(observedAt),received:iso(receivedAt),source:cleanSource(raw.source),
  referenceDay:dayOf(observedAt,zone),delayed:age>30*MINUTE};
}
function validHistory(raw,now,zone){
 if(!Array.isArray(raw)||raw.length===0)return {ok:false,reason:'검증된 일봉 없음'};
 if(raw.length>500)raw=raw.slice(-500);
 const bars=[],dates=new Set();
 for(const item of raw){
  if(!item||!finitePositive(item.close))return {ok:false,reason:'일봉 종가 오류'};
  const timestamp=numberTime(item.at??item.date);
  if(timestamp===null||timestamp>now+5*MINUTE)return {ok:false,reason:'일봉 날짜 오류'};
  const date=dayOf(timestamp,zone);
  if(dates.has(date))return {ok:false,reason:'일봉 기준일 중복'};
  if(bars.length&&timestamp<=bars[bars.length-1].at)return {ok:false,reason:'일봉 순서 불일치'};
  dates.add(date);bars.push({at:timestamp,date,close:item.close});
 }
 if(now-bars[bars.length-1].at>5*DAY)return {ok:false,reason:'최근 일봉 미수신'};
 return {ok:true,bars};
}
function historyMetrics(history,now,zone){
 const checked=validHistory(history,now,zone);
 if(!checked.ok)return {status:'unavailable',reason:checked.reason,ret5:null,ret20:null,aboveMA20:null};
 const b=checked.bars,close=b.at(-1).close;
 const ret5=b.length>=6?pct(close,b.at(-6).close):null;
 const ret20=b.length>=21?pct(close,b.at(-21).close):null;
 const ma20=b.length>=20?b.slice(-20).reduce((sum,x)=>sum+x.close,0)/20:null;
 return {status:ret5===null||ret20===null?'partial':'ready',
  basis:b.at(-1).date,ret5,ret20,aboveMA20:ma20!==null?close>ma20:null,
  count:b.length,source:'검증된 일봉 종가'};
}
function marketDecision(core){
 if(core.some(x=>!x.usable))return {state:'insufficient',label:'시장 국면 판단 보류',score:null};
 if(core[0].referenceDay!==core[1].referenceDay)return {state:'insufficient',label:'시장 국면 판단 보류',score:null,reason:'핵심 지수 관측 기준일 불일치'};
 const deltas=core.map(x=>x.delta);
 const positive=deltas.every(x=>x>=0.2),negative=deltas.every(x=>x<=-0.2);
 const state=positive?'up':negative?'down':'mixed';
 return {state,label:positive?'당일 상승 우위':negative?'당일 하락 우위':'당일 혼조·보합',
  score:Number(((deltas[0]+deltas[1])/2).toFixed(4))};
}
function momentumClass(metrics){
 if(metrics.some(m=>m.status!=='ready'))return {state:'unknown',label:'5·20일 추세 판단 보류'};
 const up=metrics.every(m=>m.ret5>0&&m.ret20>0&&m.aboveMA20===true);
 const down=metrics.every(m=>m.ret5<0&&m.ret20<0&&m.aboveMA20===false);
 return {state:up?'strengthening':down?'weakening':'divergent',
  label:up?'단·중기 모멘텀 강화':down?'단·중기 모멘텀 약화':'단·중기 추세 혼조'};
}
function riskAssessment({region,observations,now,eventRisk,core}){
 const reasons=[],evidence=[];
 let band='unknown';
 const validCore=core.every(x=>x.usable)&&core[0].referenceDay===core[1].referenceDay;
 const vix=validateQuote(observations['^VIX'],'^VIX',now,'America/New_York');
 // Absolute VIX thresholds are editorial descriptive buckets, not calibrated forecasts.
 if(vix.usable){
  band=vix.value>=30?'high':vix.value>=20?'elevated':'reference-low';
  reasons.push('VIX '+vix.value.toFixed(2)+' · '+(vix.delayed?'최근 확인 시점':'수신 자료')+' 기준');
  evidence.push(vix);
 }else{
  reasons.push('VIX 근거 없음 · 위험 수준 확정 불가');
 }
 const fx=validateQuote(observations['KRW=X'],'KRW=X',now,'Asia/Seoul');
 if(fx.usable&&Math.abs(fx.delta)>=1){
  reasons.push('달러/원 전일 대비 '+fx.delta.toFixed(2)+'% · 환율 변동 경계');
  evidence.push(fx);
  if(band==='reference-low')band='elevated';
 }
 if(validCore&&core.every(x=>x.delta<=-1.5)){
  reasons.push('핵심 지수 동반 큰 폭 하락 · 시장 충격 점검');
  if(band==='reference-low')band='elevated';
 }
 if(eventRisk?.incomplete===true)reasons.push('경제 일정 일부 미연결 · 발표 위험 확인 필요');
 if(eventRisk?.hasConfirmedCritical===true)reasons.push('확정된 고중요도 경제 이벤트 임박 · 갭 위험 확인');
 return {level:band,label:band==='high'?'높음':band==='elevated'?'경계':band==='reference-low'?'VIX 기준 낮음(종합 위험 미확정)':'판단 보류',
  reasons,evidence:evidence.map(x=>({symbol:x.symbol,value:x.value,delta:x.delta,asOf:x.asOf,source:x.source})),
  coverage:{vix:vix.usable,fx:fx.usable,events:eventRisk?.incomplete===false}};
}
function assess({region,observations={},histories={},now=Date.now(),eventRisk=null}={}){
 if(!MARKET[region]||!isNumber(now)||now<0)throw Error('REGIME_INPUT_INVALID');
 const config=MARKET[region],core=config.core.map(s=>validateQuote(observations[s],s,now,config.zone));
 const decision=marketDecision(core),history=config.core.map(s=>historyMetrics(histories[s],now,config.zone));
 const momentum=momentumClass(history);
 const risk=riskAssessment({region,observations,now,eventRisk,core});
 const coreValid=decision.state!=='insufficient',historical=core.filter(x=>x.usable).some(x=>x.delayed);
 const evidence=core.filter(x=>x.usable).map(x=>({symbol:x.symbol,delta:x.delta,asOf:x.asOf,receivedAt:x.received,source:x.source,referenceDay:x.referenceDay}));
 const missing=core.filter(x=>!x.usable).map(x=>({symbol:x.symbol,reason:x.reason}));
 if(coreValid&&decision.reason)missing.push({symbol:'CORE',reason:decision.reason});
 const sox=validateQuote(observations['^SOX'],'^SOX',now,'America/New_York');
 const extras=[];
 if(sox.usable)extras.push({symbol:sox.symbol,delta:sox.delta,asOf:sox.asOf,source:sox.source});
 const liquidity={status:'unavailable',reason:'시장 폭·거래대금 자료 미연결'}; // never guess
 const tick={status:'unavailable',reason:'NYSE $TICK 원천값·시점·지표 계약 확인 전'};
 const mode={day:!coreValid?'undetermined':risk.level==='high'?'caution':'context-only',
  swing:!coreValid||momentum.state==='unknown'?'undetermined':risk.level==='high'?'caution':'context-only'};
 return Object.freeze({schemaVersion:1,region,market:config.label,evaluatedAt:iso(now),
  status:coreValid?'descriptive':'insufficient',direction:decision,momentum,risk,
  execution:mode,delayed:historical,
  evidence,extras,missing,history:config.core.map((symbol,i)=>({symbol,...history[i]})),
  liquidity,tick,
  warnings:['종가·수신시각 확인은 거래소 실시간 권한을 의미하지 않습니다.','지수 일일 등락은 단·중기 추세의 대체 자료가 아닙니다.','결과는 매매 신호·목표가·주문이 아닙니다.']});
}
const api=Object.freeze({assess,adaptQuotes,validateQuote,validHistory,historyMetrics,MARKET,OPTIONAL});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestMarketRegime=api;
})(globalThis);
