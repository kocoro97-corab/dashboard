(function(root){'use strict';
/**
 * Exchange-local daily candle session classification.
 * Consumes an existing Yahoo chart result; no I/O, account, persistence.
 * Historical sessions before the current exchange-local date are complete.
 * The current date needs explicit confirmed close metadata, otherwise
 * today's candle is excluded from strict end-of-session strategies.
 */
const ZONE={KR:'Asia/Seoul',US:'America/New_York'};
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=s=>typeof s==='string'&&DAY.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function localDay(ms,zone){
 if(!Number.isFinite(ms)||ms<=0||ms>8.64e15||!Object.values(ZONE).includes(zone))return null;
 try{
 const parts={};
 for(const p of new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)))
  if(p.type!=='literal')parts[p.type]=p.value;
 const d=parts.year+'-'+parts.month+'-'+parts.day;
 return validDay(d)?d:null;
 }catch{return null}
}
function infer({market,meta,timestamps,now=Date.now()}={}){
 if(!ZONE[market]||!meta||!Array.isArray(timestamps)||!timestamps.length||
  !Number.isFinite(now)||now<=0||now>8.64e15)
  return {status:'unavailable',reason:'시세 세션 입력 자료 미확인'};
 const expected=ZONE[market],sourceZone=meta.exchangeTimezoneName;
 if(sourceZone!==expected)return {status:'unavailable',reason:'공급자 거래소 시간대 불일치'};
 const today=localDay(now,sourceZone),dates=[],closedDates=[],openDates=[];
 if(!today)return {status:'unavailable',reason:'거래소 현지 날짜 확인 실패'};
 let previous=0,previousDay='';
 const regular=meta.currentTradingPeriod?.regular;
 const sessionEndSec=Number.isFinite(regular?.end)?regular.end:null;
 const sessionDay=Number.isFinite(regular?.start)?localDay(regular.start*1000,sourceZone):null;
 const regularMarketTime=Number.isFinite(meta.regularMarketTime)?meta.regularMarketTime:null;
 for(const seconds of timestamps){
  if(!Number.isSafeInteger(seconds)||seconds<=previous||seconds*1000>now+300000)
   return {status:'unavailable',reason:'일봉 순서·미래시각 오류'};
  const d=localDay(seconds*1000,sourceZone);
  if(!d||d<=previousDay||d>today)
   return {status:'unavailable',reason:'동일 세션 날짜 중복 또는 미래 거래일'};
  previous=seconds;previousDay=d;dates.push(d);
  // Before today's session, a historical session is already over.
  // Today's candle only passes if Yahoo supplies a matching explicit
  // session end + observed regular-session price at the close.
  const currentConfirmed=d===today&&sessionDay===today&&sessionEndSec!==null&&
    now>=sessionEndSec*1000+5*60000&&regularMarketTime!==null&&
    regularMarketTime>=sessionEndSec-900&&regularMarketTime<=sessionEndSec+300&&
    seconds<=regularMarketTime;
  if(d<today||currentConfirmed)closedDates.push(d);
  else openDates.push(d);
 }
 return {status:'ready',market,zone:sourceZone,asOf:dates.at(-1),dates,closedDates,openDates,
  currentSessionVerified:closedDates.includes(today),verification:'Yahoo 거래소 현지 시간대 + 현재 정규장 종료·원천 관측시각 확인',
  note:'최종 거래일 장중봉/메타데이터 미확인 시 자동 제외 · 실시간 거래소 확정 공시가 아님'};
}
const api=Object.freeze({infer,localDay});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestExchangeSessionProof=api;
})(globalThis);
