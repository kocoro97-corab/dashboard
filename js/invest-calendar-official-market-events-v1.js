/* MY INVEST V2 — immutable, official-source market-calendar SNAPSHOT.
 * Checked 2026-11-22 against NYSE, Federal Reserve, BLS and BEA.
 * Snapshot dates are not live confirmations; never use as trading-session
 * truth, automated order authority or a replacement for exchange API.
 * U.S. "date" is local Eastern source date; only releases with explicitly
 * published times get converted to Asia/Seoul. All records link evidence.
 */
(function(root){
'use strict';
const S=Object.freeze({
 nyse:'https://www.nyse.com/trade/hours-calendars',
 fed26:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
 fed27:'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm',
 bls:'https://www.bls.gov/schedule/2026/12_sched_list.htm',
 bea:'https://www.bea.gov/news/schedule'
});
const VALID=new Set(['holiday','early-close','fomc','macro']);
const iso=x=>typeof x==='string'&&/^(2026|2027)-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
function row(date,type,title,sourceId,{time='',note='',tentative=false}={}){
 if(!iso(date)||!VALID.has(type)||typeof title!=='string'||title.length>120||
  !Object.hasOwn(S,sourceId))throw new Error('MARKET_SNAPSHOT_INVALID');
 const sourceUrl=S[sourceId];
 const id='official:'+date+':'+type+':'+sourceId+':'+title.toLowerCase().replace(/[^a-z0-9가-힣]/g,'').slice(0,30);
 // Published clock is eastern. For NYSE holiday, FOMC and official early
 // close, the market date remains source local, without false KST inference.
 let kstDate=null,kstTime=null;
 if(time){
  // U.S. Eastern source clock is converted with Intl DST rules.
  // Find correct UTC instant whose Eastern wall-clock matches the specified
  // local time; scan bounded ±12h in 30-min increments. Offsets vary by DST.
  const midday=Date.parse(date+'T12:00:00Z');
  let matched=null;
  for(let d=-12*60;d<=12*60;d+=30){
   const t=midday+d*60000;
   const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
    year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
    hourCycle:'h23'}).formatToParts(new Date(t));
   const get=k=>p.find(x=>x.type===k)?.value;
   if(get('year')+'-'+get('month')+'-'+get('day')===date&&
    get('hour')+':'+get('minute')===time){matched=t;break}
  }
  if(matched!==null){
   const z=new Date(matched+9*3600000);
   kstDate=z.toISOString().slice(0,10);
   kstTime=z.toISOString().slice(11,16);
  }
 }
 return Object.freeze({
  id,date,type,title,market:'US',sourceTimezone:'America/New_York',
  sourceUrl,sourceLabel:sourceId==='nyse'?'NYSE':sourceId.startsWith('fed')?'Federal Reserve':
   sourceId==='bls'?'BLS':'BEA',
  checkedAt:'2026-11-22',tentative,sourceTime:time,
  kstDate,kstTime,note,status:'OFFICIAL_SOURCE_SNAPSHOT',
  sourceStatus:'OFFICIAL_SOURCE_SNAPSHOT',readOnly:true,
  liveVerified:false,tradeSessionCertified:false
 });
}
const data=[];
const add=(date,type,title,src,opt)=>data.push(row(date,type,title,src,opt));
for(const [year,dates] of [
 [2026,[
  ['01-01','새해 첫날'],['01-19','마틴 루서 킹 데이'],
  ['02-16','워싱턴 탄생일'],['04-03','성금요일'],
  ['05-25','메모리얼 데이'],['06-19','준틴스'],
  ['07-03','독립기념일 대체'],['09-07','노동절'],
  ['11-26','추수감사절'],['12-25','크리스마스']
 ]],
 [2027,[
  ['01-01','새해 첫날'],['01-18','마틴 루서 킹 데이'],
  ['02-15','워싱턴 탄생일'],['03-26','성금요일'],
  ['05-31','메모리얼 데이'],['06-18','준틴스 대체'],
  ['07-05','독립기념일 대체'],['09-06','노동절'],
  ['11-25','추수감사절'],['12-24','크리스마스 대체']
 ]]
]){
 for(const [part,label] of dates)
  add(year+'-'+part,'holiday','NYSE 휴장 · '+label,'nyse',
   {note:'NYSE 공식 현물시장 휴장 · 미국 현지 날짜'});
}
for(const [date,title] of [
 ['2026-11-27','추수감사절 다음 날'],
 ['2026-12-24','크리스마스 전날'],
 ['2027-11-26','추수감사절 다음 날']
])add(date,'early-close','NYSE 조기폐장 · '+title,'nyse',{
 time:'13:00',note:'미국 동부시간 13:00 정규장 조기폐장. 시장별 상품에 따라 다름'});
const fomc=[
 ['2026-12-08','회의 첫날','fed26',false],
 ['2026-12-09','금리결정 예정 · 경제전망(SEP)','fed26',false],
 ['2027-01-26','회의 첫날','fed27',true],
 ['2027-01-27','금리결정 예정','fed27',true],
 ['2027-03-16','회의 첫날','fed27',true],
 ['2027-03-17','금리결정 예정','fed27',true],
 ['2027-04-27','회의 첫날','fed27',true],
 ['2027-04-28','금리결정 예정','fed27',true],
 ['2027-06-08','회의 첫날','fed27',true],
 ['2027-06-09','금리결정 예정','fed27',true],
 ['2027-07-27','회의 첫날','fed27',true],
 ['2027-07-28','금리결정 예정','fed27',true],
 ['2027-09-14','회의 첫날','fed27',true],
 ['2027-09-15','금리결정 예정','fed27',true],
 ['2027-10-26','통화정책 전략 전용 회의 첫날','fed27',true],
 ['2027-10-27','통화정책 전략 회의 · 금리표결 없음','fed27',true],
 ['2027-11-16','회의 첫날','fed27',true],
 ['2027-11-17','금리결정 예정','fed27',true]
];
for(const [date,what,sourceId,tentative] of fomc)
 add(date,'fomc','FOMC · '+what,sourceId,{
 tentative,note:sourceId==='fed27'?
  '2026-11-12 연준 수정 발표 기준 잠정 일정. 회의 직전 재확인 필요':
  '연준 2026 회의 일정. 의사결정 발표 시각은 여기서 확정하지 않음'
 });
for(const [date,title,src] of [
 ['2026-12-04','미국 고용보고서 · 11월','bls'],
 ['2026-12-10','미국 소비자물가지수(CPI) · 11월','bls'],
 ['2026-11-25','미국 개인소득·지출(PCE) · 10월','bea'],
 ['2026-12-23','미국 개인소득·지출(PCE) · 11월','bea']
])add(date,'macro',title,src,{
 time:'08:30',note:'미국 동부시간 공식 발표 예정 08:30. 한국 시각은 DST 적용 변환'});
data.sort((a,b)=>a.date.localeCompare(b.date)||a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
const immutable=Object.freeze(data);
function list(year,month,{types=['holiday','early-close','fomc','macro']}={}){
 if(!Number.isInteger(year)||year<2026||year>2027||
  !Number.isInteger(month)||month<1||month>12||
  !Array.isArray(types))return Object.freeze([]);
 const selected=new Set(types.filter(x=>VALID.has(x)));
 const prefix=year+'-'+String(month).padStart(2,'0')+'-';
 return Object.freeze(immutable.filter(x=>x.date.startsWith(prefix)&&selected.has(x.type)));
}
function escapeIcs(s){
 return String(s).replace(/\\/g,'\\\\').replace(/\r\n?|\n/g,'\\n')
  .replace(/,/g,'\\,').replace(/;/g,'\\;');
}
function utcString(ms){return new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g,'')}
function nextDay(day){
 const [y,m,d]=day.split('-').map(Number);
 return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10).replace(/-/g,'');
}
function toKstUtc(date,time){
 const [y,m,d]=date.split('-').map(Number),[hh,mm]=time.split(':').map(Number);
 return Date.UTC(y,m-1,d,hh-9,mm);
}
function exportMonthICS(year,month){
 const rows=list(year,month);
 const result=['BEGIN:VCALENDAR','VERSION:2.0',
  'PRODID:-//MY INVEST//Official Market Schedule Snapshot//KO',
  'CALSCALE:GREGORIAN','METHOD:PUBLISH',
  'X-WR-CALNAME:MY INVEST official market schedule snapshot'];
 for(const item of rows){
  const date=item.date.replace(/-/g,'');
  result.push('BEGIN:VEVENT',
   'UID:'+item.id.replace(/[^a-zA-Z0-9._:-]/g,'-')+'@myinvest-official',
   'DTSTAMP:20261122T000000Z');
  if(item.sourceTime&&item.kstDate&&item.kstTime){
   const utc=toKstUtc(item.kstDate,item.kstTime);
   result.push('DTSTART:'+utcString(utc),
    'DTEND:'+utcString(utc+60*60000));
  }else result.push('DTSTART;VALUE=DATE:'+date,
   'DTEND;VALUE=DATE:'+nextDay(item.date));
  result.push('SUMMARY:'+escapeIcs(item.title),
   'DESCRIPTION:'+escapeIcs(
    item.sourceLabel+' '+item.note+
    ' / 미국 동부 현지일 기준 / 2026-11-22 기준 일정표(실시간 미검증)'+
    ' / 공식 출처: '+item.sourceUrl),
   'URL:'+item.sourceUrl,
   'END:VEVENT');
 }
 result.push('END:VCALENDAR');
 return result.join('\r\n')+'\r\n';
}
const api=Object.freeze({list,exportMonthICS,all:()=>immutable,sourceUrls:S,
 checkedAt:'2026-11-22',isLive:false,timezone:'America/New_York'});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestOfficialMarketEventsV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
