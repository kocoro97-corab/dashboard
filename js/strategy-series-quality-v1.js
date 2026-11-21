/* MY INVEST V2 P4: offline OHLCV integrity/readiness gate.
 * This module inspects CALLER-SUPPLIED bars, not the identity or truth of an external
 * feed. It has no network, storage, credential, or order capabilities.
 */
(function(root){
'use strict';
const VERSION='p4-series-quality-v1',MIN_BARS=22,ROBUST_BARS=120,MAX_BARS=5000;
const MARKET=Object.freeze({KR:{currency:'KRW',zone:'Asia/Seoul',
 exchanges:new Set(['KRX','KOSPI','KOSDAQ','KONEX'])},
 US:{currency:'USD',zone:'America/New_York',
 exchanges:new Set(['NASDAQ','NYSE','AMEX','ARCA','BATS','NYSEARCA'])}});
const CONVENTION=new Set(['raw','split_adjusted','total_return_adjusted']);
const isNum=Number.isFinite,positive=x=>isNum(x)&&x>0;
const issue=(code,detail)=>({code,...(detail===undefined?{}:{detail})});
function dateKey(t,formatter){
 const parts=formatter.formatToParts(new Date(t));
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value||'').join('-');
}
function inspect(input={}){
 const errors=[],flags=[],facts={};
 if(!input||typeof input!=='object'||Array.isArray(input))
  return {status:'block',version:VERSION,errors:[issue('INVALID_INPUT')],flags:[],facts:{},
   eligibleForProvisionalBacktest:false,realSourceVerified:false};
 const bars=input.bars,market=Object.prototype.hasOwnProperty.call(MARKET,input.market)?MARKET[input.market]:null,now=input.now??Date.now();
 if(!market)errors.push(issue('UNSUPPORTED_MARKET'));
 if(!Array.isArray(bars)||bars.length>MAX_BARS||bars.length===0)errors.push(issue('INVALID_BAR_COLLECTION'));
 if(!Number.isSafeInteger(now)||now<=0||now>8640000000000000)errors.push(issue('INVALID_AS_OF'));
 if(typeof input.symbol!=='string'||!/^[A-Za-z0-9.^_-]{1,32}$/.test(input.symbol))
  errors.push(issue('SYMBOL_REQUIRED'));
 if(typeof input.exchange!=='string'||!market?.exchanges.has(input.exchange.toUpperCase()))
  errors.push(issue('EXCHANGE_IDENTITY_REQUIRED'));
 if(typeof input.currency!=='string'||input.currency!==market?.currency)
  errors.push(issue('MARKET_CURRENCY_MISMATCH'));
 if(input.interval!=='1d')errors.push(issue('DAILY_INTERVAL_REQUIRED'));
 if(input.finalized!==true)errors.push(issue('FINALIZED_DAILY_BARS_REQUIRED'));
 if(!CONVENTION.has(input.priceConvention))
  flags.push(issue('PRICE_ADJUSTMENT_CONVENTION_UNKNOWN'));
 if(input.priceConvention==='total_return_adjusted')
  flags.push(issue('TOTAL_RETURN_OHLCV_CONSISTENCY_NEEDS_REVIEW'));
 if(typeof input.sourceProvider!=='string'||!/^[-_A-Za-z0-9. ]{2,60}$/.test(input.sourceProvider))
  flags.push(issue('SOURCE_IDENTITY_UNDECLARED'));
 if(input.purpose!=='historical'&&input.purpose!=='current')
  flags.push(issue('ANALYSIS_PURPOSE_UNDECLARED'));
 if(errors.some(x=>['INVALID_BAR_COLLECTION','UNSUPPORTED_MARKET','INVALID_AS_OF'].includes(x.code)))
  return {status:'block',version:VERSION,errors,flags,facts,
   eligibleForProvisionalBacktest:false,realSourceVerified:false};
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:market.zone,year:'numeric',month:'2-digit',day:'2-digit'});
 const dateKeys=new Set(),suspicious=[],wideRanges=[],gaps=[];
 let missingVolumes=0,invalidVolumes=0,zeroVolumes=0,invalidOHLC=0,duplicatedDays=0,notIncreasing=0,
  maxAbsChangePct=0,longestGapDays=0;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],prev=bars[i-1];
  if(!b||!Number.isSafeInteger(b.t)||b.t<=0||b.t>8640000000000000||
   ![b.o,b.h,b.l,b.c].every(positive)||
   b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c)||b.h<b.l){
   invalidOHLC++;continue;
  }
  const key=dateKey(b.t,formatter);
  if(dateKeys.has(key))duplicatedDays++;
  dateKeys.add(key);
  if(prev){
   if(!Number.isSafeInteger(prev.t)||b.t<=prev.t||b.t-prev.t<18*3600000)notIncreasing++;
   else{
    const gap=(b.t-prev.t)/86400000;
    longestGapDays=Math.max(longestGapDays,gap);
    if(gap>10&&gaps.length<12)gaps.push({index:i,gapDays:Math.round(gap*10)/10});
    if(positive(prev.c)){
     const jump=(b.c/prev.c-1)*100;
     maxAbsChangePct=Math.max(maxAbsChangePct,Math.abs(jump));
     if(Math.abs(jump)>=40&&suspicious.length<12)
      suspicious.push({index:i,changePct:Math.round(jump*100)/100});
    }
   }
  }
  if(b.v==null)missingVolumes++;
  else if(!isNum(b.v)||b.v<0)invalidVolumes++;
  else if(b.v===0)zeroVolumes++;
  const range=(b.h/b.l-1)*100;
  if(range>=70&&wideRanges.length<12)
   wideRanges.push({index:i,rangePct:Math.round(range*100)/100});
  if(b.t>now+300000)errors.push(issue('FUTURE_BAR_TIMESTAMP',{index:i}));
 }
 if(invalidOHLC)errors.push(issue('INVALID_OHLC',{count:invalidOHLC}));
 if(invalidVolumes)errors.push(issue('INVALID_VOLUME',{count:invalidVolumes}));
 if(notIncreasing)errors.push(issue('NON_DAILY_OR_UNSORTED_TIMESTAMPS',{count:notIncreasing}));
 if(duplicatedDays)errors.push(issue('DUPLICATE_EXCHANGE_DATES',{count:duplicatedDays}));
 if(bars.length<MIN_BARS)errors.push(issue('TOO_FEW_BARS_FOR_P4',{count:bars.length}));
 if(bars.length<ROBUST_BARS)flags.push(issue('SHORT_HISTORY_FOR_RELIABILITY',{count:bars.length}));
 if(missingVolumes)flags.push(issue('MISSING_VOLUME',{count:missingVolumes}));
 if(zeroVolumes)flags.push(issue('ZERO_VOLUME_OBSERVATIONS',{count:zeroVolumes}));
 if(suspicious.length)flags.push(issue('LARGE_PRICE_JUMP_POSSIBLE_CORPORATE_ACTION',{count:suspicious.length}));
 if(wideRanges.length)flags.push(issue('UNUSUALLY_WIDE_CANDLE',{count:wideRanges.length}));
 if(gaps.length)flags.push(issue('LONG_CALENDAR_GAPS',{count:gaps.length}));
 if(input.observedAt==null||!Number.isSafeInteger(input.observedAt))
  flags.push(issue('SOURCE_OBSERVATION_TIME_UNDECLARED'));
 else if(bars.at(-1)&&Number.isSafeInteger(bars.at(-1).t)&&
  (input.observedAt<bars.at(-1).t||input.observedAt>now+300000))
  errors.push(issue('INCONSISTENT_SOURCE_OBSERVATION'));
 if(input.purpose==='current'&&bars.length){
  const last=bars.at(-1)?.t,age=Number.isSafeInteger(last)?(now-last)/86400000:null;
  if(age!==null&&age>7)flags.push(issue('CURRENT_SERIES_MAY_BE_STALE',{ageDays:Math.round(age*10)/10}));
 }
 facts.barCount=bars.length;facts.firstAt=bars[0]?.t??null;facts.lastAt=bars.at(-1)?.t??null;
 facts.exchangeTimeZone=market.zone;facts.missingVolumeBars=missingVolumes;
 facts.zeroVolumeBars=zeroVolumes;facts.invalidVolumeBars=invalidVolumes;facts.duplicatedExchangeDays=duplicatedDays;
 facts.longestCalendarGapDays=Math.round(longestGapDays*10)/10;
 facts.maxAbsCloseChangePct=Math.round(maxAbsChangePct*100)/100;
 facts.largePriceJumpExamples=suspicious;facts.wideRangeExamples=wideRanges;facts.longGapExamples=gaps;
 const status=errors.length?'block':flags.length?'review':'structurally_ready';
 return {status,version:VERSION,errors,flags,facts,
  eligibleForProvisionalBacktest:errors.length===0&&flags.length===0,
  realSourceVerified:false,
  verification:'OFFLINE_STRUCTURE_ONLY',
  warnings:['원천 가격의 진위·분할/배당 조정 여부는 이 함수로 검증할 수 없습니다.',
   '대형 가격 점프와 긴 거래 공백은 참고 경고이며 분할·거래정지·휴장이라고 확정하지 않습니다.',
   '구조 검사 통과는 전략 수익성 또는 원천 시세 검증을 의미하지 않습니다.']};
}
const api=Object.freeze({inspect,version:VERSION});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestSeriesQuality=api;
})(typeof globalThis!=='undefined'?globalThis:this);
