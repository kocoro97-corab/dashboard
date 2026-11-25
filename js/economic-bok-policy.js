(function(root){'use strict';
/* Bank of Korea scheduled MPC base-rate decision meeting DATES, 2026 only.
 * Official BOK monetary policy decision meeting page. Exact announcement
 * hour is unconfirmed: never add an invented startsAt.
 */
const SOURCE='https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?menuNo=200755&mtgSe=A&syear=2026';
const DAYS=Object.freeze(['01-15','02-26','04-10','05-28','07-16','08-27','10-22','11-26']);
function list(year){
 if(year!==2026)return [];
 return DAYS.map(day=>Object.freeze({
  id:'bok-MPC-'+year+'-'+day,date:year+'-'+day,
  title:'한국은행 금통위 · 통화정책방향 결정회의',category:'policy',
  publisher:'BOK',type:'BOK_MPC',priority:'critical',source:'한국은행',
  sourceUrl:SOURCE,verified:true,dateBasis:'Asia/Seoul',timeStatus:'unconfirmed',
  releaseStatus:'scheduled',note:'공식 회의일 · 금리결정 발표시각 별도 확인'
 }));
}
const api=Object.freeze({SOURCE,list,coverage:Object.freeze([2026])});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestBokPolicySchedule=api;
})(globalThis);
