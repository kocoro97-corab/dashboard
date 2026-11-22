(function(root){'use strict';
// Versioned official NYSE calendar snapshot (2026-2028).
// Source: https://www.nyse.com/trade/hours-calendars
// All dates are US/Eastern trading dates; display them as date-only values.
// No inference about Korean public holidays or KRX trading status.
const holidays={
2026:[['01-01','신정'],['01-19','마틴 루터 킹 데이'],['02-16','워싱턴 탄생일'],['04-03','성금요일'],['05-25','메모리얼 데이'],['06-19','준틴스'],['07-03','독립기념일 대체'],['09-07','노동절'],['11-26','추수감사절'],['12-25','크리스마스']],
2027:[['01-01','신정'],['01-18','마틴 루터 킹 데이'],['02-15','워싱턴 탄생일'],['03-26','성금요일'],['05-31','메모리얼 데이'],['06-18','준틴스 대체'],['07-05','독립기념일 대체'],['09-06','노동절'],['11-25','추수감사절'],['12-24','크리스마스 대체']],
2028:[['01-17','마틴 루터 킹 데이'],['02-21','워싱턴 탄생일'],['04-14','성금요일'],['05-29','메모리얼 데이'],['06-19','준틴스'],['07-04','독립기념일'],['09-04','노동절'],['11-23','추수감사절'],['12-25','크리스마스']]
};
const early={2026:[['11-27','추수감사절 다음 날'],['12-24','크리스마스 이브']],2027:[['11-26','추수감사절 다음 날']],2028:[['07-03','독립기념일 전날'],['11-24','추수감사절 다음 날']]};
function list(year){if(!Number.isInteger(year)||year<2026||year>2028)return [];const normal=holidays[year].map(([day,title])=>({id:'nyse-holiday-'+year+'-'+day,date:year+'-'+day,title:'NYSE 휴장 · '+title,category:'holidayUS',verified:true,source:'NYSE',sourceUrl:'https://www.nyse.com/trade/hours-calendars'}));const short=(early[year]||[]).map(([day,title])=>({id:'nyse-early-'+year+'-'+day,date:year+'-'+day,title:'NYSE 조기폐장(미 동부 13시) · '+title,category:'earlyUS',verified:true,source:'NYSE',sourceUrl:'https://www.nyse.com/trade/hours-calendars'}));return [...normal,...short].sort((a,b)=>a.date.localeCompare(b.date))}
const api=Object.freeze({list,coverage:Object.freeze([2026,2027,2028]),sourceUrl:'https://www.nyse.com/trade/hours-calendars'});if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestMarketHolidays=api;
})(globalThis);
