(function(root){'use strict';
/**
 * Convert already fetched and identity-verified sector page daily series
 * to rotation-engine input. Pure adapter: never fetches or stores data.
 *
 * input is existing js/page-sectors.js series() DTO:
 * {bars:number[],times:unixSeconds[],volume:number[],currency,
 *  exchange,instrumentType,last,...}.
 * The page still owns the verified symbols and the actual cache.
 */
const EXCHANGE={KR:/^(KSC|KOE|KOSPI|KOSDAQ|KRX|SEOUL)$/i,
 US:/^(NMS|NYQ|NCM|NGM|NASDAQ|NYSE|ASE|PCX|BTS|NYS|ARCX)$/i};
const validSymbol=s=>typeof s==='string'&&/^(?:[0-9]{6}(?:\.(?:KS|KQ))?|[A-Z^][A-Z0-9.^=-]{0,19})$/.test(s);
function adapt(input,{symbol,market,source='Yahoo chart',instrumentType=null,dates=null}={}){
 if(!input||!['US','KR'].includes(market)||!validSymbol(symbol))return {status:'unavailable',reason:'심볼/시장 식별 미확인'};
 const currency=market==='KR'?'KRW':'USD';
 if(input.currency!==currency||typeof input.exchange!=='string'||!EXCHANGE[market].test(input.exchange))
  return {status:'unavailable',reason:'통화·거래소 식별 불일치'};
 if(instrumentType&&input.instrumentType!==instrumentType)return {status:'unavailable',reason:'상품유형 불일치'};
 const n=input.bars?.length;
 if(!Number.isInteger(n)||n<2||n>370||!Array.isArray(input.times)||input.times.length!==n)
  return {status:'unavailable',reason:'일봉/기준시각 누락'};
 // Verified exchange-session calendar days must be supplied by the page's
 // source validator: naive toISOString().slice(0,10) of chart timestamps
 // would put some US sessions on the previous UTC day.
 if(!Array.isArray(dates)||dates.length!==n)return {status:'unavailable',reason:'거래소 기준일 미검증'};
 const bars=[],seen=new Set();
 for(let i=0;i<n;i++){
  const date=dates[i],ts=input.times[i],close=input.bars[i];
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||
     new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||
     !Number.isSafeInteger(ts)||ts<=0||ts*1000>Date.now()+300000||
     !Number.isFinite(close)||close<=0||seen.has(date)||bars.length&&bars.at(-1).date>=date)
   return {status:'unavailable',reason:'일봉 기준일·종가 검증 실패'};
  seen.add(date);
  const volume=input.volume?.[i];if(volume!=null&&(!Number.isFinite(volume)||volume<0))return {status:'unavailable',reason:'거래량 오류'};
  bars.push({date,close,volume:volume??null});
 }
 return {status:'ready',symbol,market,currency,bars,source,exchange:input.exchange,instrumentType:input.instrumentType,verified:true,
  asOf:bars.at(-1).date,remark:'원천 거래소 기준 날짜가 검증된 경우에만 변환'};
}
function adaptCached(input,{symbol,market}={}){
 const proof=input?.sessionProof,expectedZone=market==='KR'?'Asia/Seoul':market==='US'?'America/New_York':null;
 if(!validSymbol(symbol)||!expectedZone||input?.symbol!==symbol||
  proof?.status!=='ready'||proof.zone!==expectedZone||!Array.isArray(input.sessionDates)||
  !Array.isArray(proof.closedDates)||input.sessionDates.length!==input.bars?.length||
  input.sessionDates.some((day,i)=>day!==proof.closedDates[i]))
  return {status:'unavailable',reason:'종목 ID·현지 거래일·마감봉 원천 검증 실패'};
 return adapt(input,{symbol,market,source:'Yahoo 일봉 (기존 산업 캐시)',
  instrumentType:input.instrumentType,dates:input.sessionDates});
}
const api=Object.freeze({adapt,adaptCached,validSymbol});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestSectorSeriesAdapter=api;
})(globalThis);
