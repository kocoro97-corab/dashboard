(function(root){'use strict';
/* Verified date-only FOMC meeting endpoints from official Fed calendar.
 * Dates are U.S. Eastern calendar dates, NOT fabricated release timestamps.
 * October 2027 meeting is STRATEGY ONLY, with no routine rate decision.
 * Sources refreshed as needed by editorial validation prior to production.
 */
const SOURCE='https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
const REVISION='https://www.federalreserve.gov/newsevents/pressreleases/monetary20261112a.htm';
const END_DATES_2026=['01-28','03-18','04-29','06-17','07-29','09-16','10-28','12-09'];
const END_DATES_2027=['01-27','03-17','04-28','06-09','07-28','09-15','10-27','11-17'];
function list(year){
 const months=year===2026?END_DATES_2026:year===2027?END_DATES_2027:[];const rows=[];
 for(const datepart of months){
  const strategic=year===2027&&datepart==='10-27';
  rows.push({id:'fed-FOMC-'+year+'-'+datepart,date:year+'-'+datepart,
   title:strategic?'FOMC 통화정책 전략회의 (정례 금리결정 없음)':'FOMC 회의 종료 · 금리결정 예정',
   category:'policy',publisher:'FED',type:strategic?'FOMC_STRATEGY':'FOMC_DECISION',
   priority:strategic?'high':'critical',verified:true,source:'Federal Reserve',
   sourceUrl:year===2027?REVISION:SOURCE,
   dateBasis:'America/New_York',timeStatus:'unconfirmed',releaseStatus:'scheduled',
   note:'미국 현지 회의 종료일 · 결정 발표시각 미확인'});
 }
 return rows;
}
const api=Object.freeze({list,SOURCE,REVISION,coverage:Object.freeze([2026,2027])});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestFomcSchedule=api;
})(globalThis);
