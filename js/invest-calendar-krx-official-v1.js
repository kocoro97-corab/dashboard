/* MY INVEST — KRX 2026 schedule EVIDENCE SNAPSHOT, not a live trading
 * session API. Only dates traceable to KRX primary publications are encoded.
 * The Korea holiday Google subscription must NOT be treated as KRX evidence.
 * 2027 trading calendar is deliberately left unverified/empty until KRX
 * publishes an attributable source. Do not synthesize closure dates.
 */
(function(root){
'use strict';
const PDF='https://kind.krx.co.kr/external/dst/reference/11625/2026%20%EC%BD%94%EC%8A%A4%EB%8B%A5%EC%8B%9C%EC%9E%A5%20%EA%B3%B5%EC%8B%9C%EC%9D%BC%EC%A0%95%20%EC%BA%98%EB%A6%B0%EB%8D%94_vF.pdf';
const RULE='https://www.krx.co.kr/contents/RGL/04/04030203/RGL04030203.jsp';
const HOLIDAYS='https://open.krx.co.kr/contents/MKD/01/0110/01100305/MKD01100305.jsp';
const checkedAt='2026-11-22';
const records=[
 ['2026-05-01','holiday','KRX 휴장 · 근로자의 날',
  '2026년 코스닥시장 공식 공시일정 5월',PDF],
 ['2026-12-25','holiday','KRX 휴장 · 성탄절',
  '2026년 코스닥시장 공식 공시일정 12월',PDF],
 ['2026-12-30','market','KRX 2026년 마지막 매매거래일(폐장)',
  '2026년 코스닥시장 공식 공시일정 12월. 폐장일은 휴장일이 아님',PDF],
 ['2026-12-31','holiday','KRX 연말 휴장',
  '2026년 코스닥시장 공식 공시일정 12월 및 거래소 연말 휴장 규정',PDF]
].map(([date,type,title,note,sourceUrl])=>Object.freeze({
 id:'krx-2026:'+date+':'+type,date,type,title,market:'KR',
 sourceTimezone:'Asia/Seoul',sourceTime:'',sourceUrl,
 sourceLabel:'KRX',sourceStatus:'OFFICIAL_SOURCE_SNAPSHOT',
 checkedAt,sourceEdition:'KRX 2026 official publication',
 note,tentative:false,readOnly:true,liveVerified:false,
 tradeSessionCertified:false,
 kstDate:null,kstTime:null
}));
const all=Object.freeze(records.sort((a,b)=>
 a.date.localeCompare(b.date)||a.id.localeCompare(b.id)));
function list(year,month,{types=['holiday','market']}={}){
 if(!Number.isInteger(year)||year!==2026||
  !Number.isInteger(month)||month<1||month>12||
  !Array.isArray(types))return Object.freeze([]);
 const permitted=new Set(types.filter(x=>x==='holiday'||x==='market'));
 const prefix=year+'-'+String(month).padStart(2,'0')+'-';
 return Object.freeze(all.filter(x=>x.date.startsWith(prefix)&&permitted.has(x.type)));
}
function coverage(year,month){
 const valid=Number.isInteger(year)&&Number.isInteger(month)&&month>=1&&month<=12;
 if(!valid)return Object.freeze({status:'INVALID_PERIOD',verified:false});
 if(year!==2026)return Object.freeze({
  status:'UNVERIFIED_YEAR',verified:false,
  message:'KRX 공식 거래일표 미확인 — 휴장 없음으로 해석하지 마세요',
  sourceUrl:HOLIDAYS,checkedAt
 });
 return Object.freeze({
  status:'PARTIAL_OFFICIAL_SOURCE',verified:false,
  message:'2026년 공식자료에서 일부 날짜만 추출; 전체 거래일표나 개장 검증에 사용 불가',
  sourceUrl:PDF,checkedAt
 });
}
const api=Object.freeze({
 list,all:()=>all,coverage,checkedAt,isLive:false,
 primarySource:PDF,regulationSource:RULE,holidayPage:HOLIDAYS,
 supportedYears:Object.freeze([2026]),timezone:'Asia/Seoul'
});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestKrxOfficialCalendarV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
