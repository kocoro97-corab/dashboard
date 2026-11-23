(function(root){'use strict';
/* MY INVEST V2 — source-verified OHLCV adapter.
 * Reuse InvestWorkflow.ensure() result from js/page-stocks.js.
 * Never makes a fetch, mutates a stock account, submits orders or guesses
 * the exchange session date from an arbitrary Yahoo timestamp.
 */
const CODES=/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function adapt(analysis,{symbol,market,dates,closedDates=null,verifiedSource=false}={}){
 if(!analysis||!CODES.test(symbol||'')||!['KR','US'].includes(market)||
   !verifiedSource||analysis.symbol!==symbol||analysis.currency!==(market==='KR'?'KRW':'USD'))
  return {status:'unavailable',reason:'OHLCV 종목·통화·원천 식별 실패'};
 if(market==='KR'&&!/^\d{6}$/.test(symbol)||market==='US'&&/^\d{6}$/.test(symbol))
  return {status:'unavailable',reason:'시장·종목코드 형식 불일치'};
 if(typeof analysis.exchange!=='string'||!analysis.exchange.trim())
  return {status:'unavailable',reason:'거래소 출처 미확인'};
 if(market==='KR'&&!/^(KSC|KOE|KOSPI|KOSDAQ|KRX|SEOUL)$/i.test(analysis.exchange))
  return {status:'unavailable',reason:'국내 거래소 식별 불일치'};
 if(market==='US'&&!/^(NMS|NYQ|NCM|NGM|NASDAQ|NYSE|ASE|PCX|BTS|NYS|ARCX)$/i.test(analysis.exchange))
  return {status:'unavailable',reason:'미국 거래소 식별 불일치'};
 const raw=analysis.bars;
 if(!Array.isArray(raw)||raw.length<2||raw.length>370||!Array.isArray(dates)||dates.length!==raw.length)
  return {status:'unavailable',reason:'거래소 기준 일자·일봉 개수 미확인'};
 // The last bar is frequently an intraday forming candle; closedDates
 // contains only independently verified completed session dates.
 if(!Array.isArray(closedDates)||closedDates.length<1)
  return {status:'unavailable',reason:'일봉 마감상태 미검증'};
 const closed=new Set(closedDates),bars=[];
 let prior=0;
 for(let i=0;i<raw.length;i++){
  const b=raw[i],day=dates[i];
  if(!b||!validDate(day)||!Number.isSafeInteger(b.t)||b.t<=prior||b.t>Date.now()+300000||
   ![b.o,b.h,b.l,b.c].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0)||
   b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h)||
   b.v!=null&&(!Number.isFinite(b.v)||b.v<0)||bars.length&&day<=bars.at(-1).date)
   return {status:'unavailable',reason:'OHLCV 거래일·가격·시간 오류'};
  prior=b.t;
  if(!closed.has(day))continue;
  bars.push({date:day,o:b.o,h:b.h,l:b.l,c:b.c,v:b.v??null,closed:true});
 }
 if(bars.length<2)return {status:'unavailable',reason:'확정된 거래일 봉 부족'};
 for(const day of closed)if(!dates.includes(day))return {status:'unavailable',reason:'완료 거래일이 원천 시계열에 없음'};
 return {status:'ready',symbol,market,currency:analysis.currency,bars,source:analysis.source,
  exchange:analysis.exchange,observedAt:analysis.observedAt,receivedAt:analysis.receivedAt,
  verified:true,asOf:bars.at(-1).date,excludedOpenBars:raw.length-bars.length};
}
const api=Object.freeze({adapt});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestStockSetupAdapter=api;
})(globalThis);
