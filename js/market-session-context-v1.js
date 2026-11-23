/* MY INVEST V2 — read-only stock-market session clock context.
 * Time-of-day windows do NOT prove that an exchange is open, a quote is live,
 * an index is updated, or an instrument is eligible for extended trading.
 * No network, calendar API, localStorage, account data, or trading operations.
 */
(function(root){
'use strict';
const ZONES=Object.freeze({KR:'Asia/Seoul',US:'America/New_York'});
const HOURS=Object.freeze({
 KR:Object.freeze({open:9*60,close:15*60+30}),
 US:Object.freeze({open:9*60+30,close:16*60})
});
const KRX_EXTENDED_START='2026-09-14';
const validTime=n=>Number.isSafeInteger(n)&&n>0&&n<8640000000000000;
const isObject=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function partsAt(now,zone){
 const formatter=new Intl.DateTimeFormat('en-US',{
  timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
  weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 });
 const f=Object.fromEntries(formatter.formatToParts(new Date(now))
  .map(p=>[p.type,p.value]));
 return {date:f.year+'-'+f.month+'-'+f.day,weekday:f.weekday,
  minute:Number(f.hour)*60+Number(f.minute),hour:Number(f.hour)};
}
function offsetMinutes(now,zone){
 const formatter=new Intl.DateTimeFormat('en-US',{
  timeZone:zone,timeZoneName:'shortOffset',hour:'2-digit'
 });
 const text=formatter.formatToParts(new Date(now)).find(p=>p.type==='timeZoneName')?.value;
 if(text==='GMT'||text==='UTC')return 0;
 const found=/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(text||'');
 if(!found)return null;
 const value=Number(found[2])*60+Number(found[3]||0);
 return found[1]==='-'?-value:value;
}
function localizedWindowReference({market,now,localDate,minuteOfDay}){
 const offset=offsetMinutes(now,ZONES[market]);
 if(offset===null)return null;
 const [y,m,d]=localDate.split('-').map(Number);
 const UTC=Date.UTC(y,m-1,d,0,0)-offset*60000+minuteOfDay*60000;
 if(!Number.isFinite(UTC))return null;
 const localKST=partsAt(UTC,'Asia/Seoul');
 const time=String(Math.floor(localKST.minute/60)).padStart(2,'0')+':'+
  String(localKST.minute%60).padStart(2,'0');
 return {kstDate:localKST.date,kstTime:time,utcMs:UTC};
}
function overrideAt(calendar,market,date){
 if(!isObject(calendar)||!isObject(calendar[market]))return null;
 const raw=calendar[market][date];
 if(raw==='closed')return {status:'closed'};
 if(!isObject(raw)||!['closed','early-close'].includes(raw.status))return null;
 if(raw.status==='closed')return {status:'closed'};
 if(!Number.isInteger(raw.closeMinute)||raw.closeMinute<=HOURS[market].open||
  raw.closeMinute>=HOURS[market].close)return null;
 return {status:'early-close',closeMinute:raw.closeMinute};
}
function marketAt(now,market,calendar){
 const local=partsAt(now,ZONES[market]);
 const weekend=local.weekday==='Sat'||local.weekday==='Sun';
 const candidate=overrideAt(calendar,market,local.date);
 const supplied=weekend?null:candidate;
 const close=supplied?.status==='early-close'?
  supplied.closeMinute:HOURS[market].close;
 let window;
 if(weekend)window='weekend';
 else if(supplied?.status==='closed')window='calendar-supplied-closed';
 else if(local.minute<HOURS[market].open)window='before-regular-window';
 else if(local.minute<close)window='regular-clock-window';
 else if(market==='KR'&&local.date>=KRX_EXTENDED_START&&
  local.minute>=16*60&&local.minute<20*60)window='eligible-equities-afterhours-window';
 else if(local.minute>=close)window='after-regular-window';
 else window='unknown';
 const basis=weekend?'weekend-by-local-calendar':
  supplied?'owner-supplied-calendar-unverified':'weekdays-only-holiday-unverified';
 // On weekend/explicitly supplied closure, there is no session to reference.
 // In particular, DST switch Sundays can change their UTC offset midday;
 // never display a fabricated weekend open/close instant.
 const noSession=weekend||supplied?.status==='closed';
 const regularOpening=noSession?null:localizedWindowReference({
  market,now,localDate:local.date,minuteOfDay:HOURS[market].open
 });
 const regularClosing=noSession?null:localizedWindowReference({
  market,now,localDate:local.date,minuteOfDay:close
 });
 return Object.freeze({
  market,localDate:local.date,localWeekday:local.weekday,
  localClock:String(Math.floor(local.minute/60)).padStart(2,'0')+':'+
   String(local.minute%60).padStart(2,'0'),
  zone:ZONES[market],window,calendarBasis:basis,
  suppliedCalendarStatus:supplied?.status||null,
  regularSessionDeclared:{openMinute:HOURS[market].open,
   closeMinute:HOURS[market].close,reference:'equity-index-core-hours'},
  referenceKst:{opening:regularOpening,closing:regularClosing},
  regularClockWindow:window==='regular-clock-window',
  afterhoursSelectedEquitiesOnly:window==='eligible-equities-afterhours-window',
  tradingOpenConfirmed:false,holidayVerified:false,exchangeStatusVerified:false,
  quoteFreshnessVerified:false,eligibleInstrumentVerified:false
 });
}
function context({now,calendar}={}){
 if(!validTime(now))return Object.freeze({status:'invalid',code:'INVALID_CLOCK'});
 const kst=partsAt(now,'Asia/Seoul');
 const focus=kst.hour>=7&&kst.hour<21?'KR':'US';
 const regions=Object.freeze({KR:marketAt(now,'KR',calendar),
  US:marketAt(now,'US',calendar)});
 const active=regions[focus];
 const explain=focus==='KR'?'한국장 중심 홈 정렬 (07:00~20:59 KST)':
  '미국장 중심 홈 정렬 (21:00~06:59 KST)';
 const note=active.window==='regular-clock-window'?
  '정규장 시간대에 해당합니다. 거래소 휴장 여부 및 실시간 호가는 검증되지 않았습니다.':
  active.window==='eligible-equities-afterhours-window'?
  'KRX 일부 주식의 연장 거래시간 참고 구간입니다. KOSPI/KOSDAQ 지수 종가나 ETF 실시간 거래를 의미하지 않습니다.':
  '홈 표시 우선순위와 실제 거래시간은 다릅니다. 시간대만으로 개장·휴장을 확정하지 않습니다.';
 return Object.freeze({
  status:'ok',now,kstDate:kst.date,kstHour:kst.hour,
  focus,displayOrder:focus==='KR'?Object.freeze(['KR','US']):Object.freeze(['US','KR']),
  focusReason:explain,regions,note,
  scheduleIndependentlyVerified:false,
  stockExchangeCalendarVerified:false,
  marketOpenVerified:false,
  brokerAfterHoursAvailabilityVerified:false,
  orderExecutionAuthorized:false
 });
}
const api=Object.freeze({context,marketAt,offsetMinutes,localizedWindowReference});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestMarketSessionContextV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
