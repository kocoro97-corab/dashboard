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
const DAY='YYYY-MM-DD';
const EXCHANGE={KR:/^(KSC|KOE|KOSPI|KOSDAQ|KRX|SEOUL)$/i,
 US:/^(NMS|NYQ|NCM|NGM|NASDAQ|NYSE|ASE|PCX|BTS|NYS|ARCX)$/i};
const validSymbol=s=>typeof s==='string'&&/^(?:[0-9]{6}(?:\.(?:KS|KQ))?|[A-Z^][A-Z0-9.^=-]{0,19})$/.test(s);
const cleanDate=(unixSeconds,market)=>{
 const ms=unixSeconds*1000;if(!Number.isFinite(ms)||ms<=0||ms>Date.now()+300000)return null;
 // The timestamp for a provider daily candle may be UTC midnight rather
 // than an exchange session close. Use local SESSION DATE when verified by
 // the provider; if no explicit date was supplied, do not guess US day.
 return null;
};
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
const api=Object.freeze({adapt,validSymbol});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestSectorSeriesAdapter=api;
})(globalThis);
