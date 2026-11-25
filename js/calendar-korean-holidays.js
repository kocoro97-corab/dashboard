(function(root){'use strict';
// 2026 Korean public holiday calendar and KRX equity market closures.
// Sources: KASA 2026 almanac, Korean public-holiday statute and KRX holiday schedule.
// Date-only KST values. Static verified snapshot, NOT a live calendar API.
// https://astro.kasi.re.kr/kor/life/post/almanac?search_year=2026
// https://www.law.go.kr/lsInfoP.do?ancYnChk=0&lsId=014112
// https://kind.krx.co.kr/ (exchange notices); verify ad-hoc closures separately.
const public2026=[
['01-01','신정'],['02-16','설 연휴'],['02-17','설날'],['02-18','설 연휴'],
['03-01','삼일절'],['03-02','삼일절 대체공휴일'],
['05-01','노동절'],['05-05','어린이날'],['05-24','부처님오신날'],['05-25','부처님오신날 대체공휴일'],
['06-03','전국동시지방선거'],['06-06','현충일'],['07-17','제헌절'],
['08-15','광복절'],['08-17','광복절 대체공휴일'],
['09-24','추석 연휴'],['09-25','추석'],['09-26','추석 연휴'],
['10-03','개천절'],['10-05','개천절 대체공휴일'],['10-09','한글날'],['12-25','성탄절']
];
// KRX 2026 weekday sessions closed; public holiday and exchange-only dates
// stay distinct. Weekend closures are displayed as weekend, not duplicated.
const krx2026=[
['01-01','신정'],['02-16','설 연휴'],['02-17','설날'],['02-18','설 연휴'],
['03-02','삼일절 대체공휴일'],['05-01','노동절'],['05-05','어린이날'],
['05-25','부처님오신날 대체공휴일'],['06-03','전국동시지방선거'],
['07-17','제헌절'],['08-17','광복절 대체공휴일'],
['09-24','추석 연휴'],['09-25','추석'],
['10-05','개천절 대체공휴일'],['10-09','한글날'],
['12-25','성탄절'],['12-31','연말 휴장']
];
function list(year){if(year!==2026)return [];
 const normal=public2026.map(([day,title])=>({id:'kr-public-2026-'+day,date:'2026-'+day,title:'공휴일 · '+title,category:'holidayKR',verified:true,source:'KASA·법령',sourceUrl:'https://astro.kasi.re.kr/kor/life/post/almanac?search_year=2026'}));
 const close=krx2026.map(([day,title])=>({id:'krx-close-2026-'+day,date:'2026-'+day,title:'KRX 휴장 · '+title,category:'closeKRX',verified:true,source:'KRX 일정표',sourceUrl:'https://kind.krx.co.kr/'}));
 return [...normal,...close].sort((a,b)=>a.date.localeCompare(b.date)||a.category.localeCompare(b.category));
}
const api=Object.freeze({list,coverage:Object.freeze([2026]),market:'XKRX',timezone:'Asia/Seoul'});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestKoreanHolidays=api;
})(globalThis);
