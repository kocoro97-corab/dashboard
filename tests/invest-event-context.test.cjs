'use strict';
const assert=require('node:assert/strict');
const c=require('../js/invest-event-context.js');
const fake=globalThis;
const when='2026-11-23T00:00:00.000Z';
const mk=(date,title,type,source,publisher,extras={})=>({
 id:type+date,date,title,type,category:'macro',publisher,source,sourceUrl:'https://www.bls.gov/schedule/news_release/bls.ics',
 verified:true,priority:'critical',...extras
});
fake.MYInvestEconomicCalendar={current:()=>({status:'ready',events:[mk('2026-11-24','CPI','CPI','BLS','BLS')] }),refresh:async()=>null};
fake.MYInvestBeaCalendar={current:()=>({status:'ready',events:[mk('2026-11-25','PCE','PCE','BEA','BEA',{sourceUrl:'https://www.bea.gov/news/schedule/icalendar'})] }),refresh:async()=>null};
fake.MYInvestBokStatsCalendar={current:()=>({status:'ready',events:[mk('2026-11-25','BOK CSI','KR_CSI','BOK','BOK',{sourceUrl:'https://www.bok.or.kr/portal/stats/statsPublictSchdul/listCldr.do'})] }),refresh:async()=>null};
fake.MYInvestFomcSchedule={list:()=>[{...mk('2026-12-09','FOMC','FOMC_DECISION','Federal Reserve','FED',{sourceUrl:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'}),dateBasis:'America/New_York'}]};
fake.MYInvestBokPolicySchedule={list:()=>[{...mk('2026-11-26','BOK MPC','BOK_MPC','BOK','BOK',{sourceUrl:'https://www.bok.or.kr/'})}]};
fake.MYInvestEarningsCalendar={current:()=>({status:'ready',events:[mk('2026-11-25','SERV earnings','earnings','SEC','EARNINGS',{
 sourceUrl:'https://www.sec.gov/Archives/edgar/data/123/report.htm',category:'earnings',symbol:'SERV',dateStatus:'confirmed'}),
 mk('2026-11-25','Estimated earnings','earnings','VENDOR','EARNINGS',{
 sourceUrl:'https://api.earningscalendar.net/',category:'earnings',symbol:'SPCH',dateStatus:'estimated',verified:false})]}),refresh:async()=>null};
async function main(){
 const range=c.collect({from:'2026-11-23',to:'2026-11-30',now:Date.parse(when)});
 assert.equal(range.events.length,5);
 assert.ok(!range.events.some(x=>x.symbol==='SPCH'));
 assert.equal(range.coverage.BLS,true);
 const day=c.assessment({mode:'day',now:Date.parse(when),symbols:['SERV']});
 assert.equal(day.events.some(x=>x.symbol==='SERV'),true);
 assert.equal(day.events.some(x=>x.symbol==='SPCH'),false);
 const anonymous=c.assessment({mode:'swing',now:Date.parse(when),symbols:[]});
 assert.equal(anonymous.events.some(x=>x.category==='earnings'),false);
 await c.refreshAll();
 assert.equal(c.assessment({mode:'swing',now:Date.parse(when)}).incomplete,false);
 fake.MYInvestBokStatsCalendar.current=()=>({status:'unavailable',events:[]});
 const gap=c.assessment({mode:'swing',now:Date.parse(when)});
 assert.equal(gap.incomplete,true);
 assert.match(gap.label,/미연결/);
 console.log('Investment public event context tests PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
