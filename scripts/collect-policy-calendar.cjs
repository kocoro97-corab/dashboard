'use strict';
const {FED,REVISION,BOK,normalize}=require('../js/economic-policy-calendar.js');
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function parse(fed,bok,revision,{now=new Date()}={}){
 const plain=revision.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').replace(/[–—]/g,'-');
 if(!/except the October 26-27 meeting.{0,200}strategy/i.test(plain))throw Error('FOMC_STRATEGY_CLASSIFICATION_UNVERIFIED');
 const events=[];
 for(const year of [2026,2027]){
  const start=fed.indexOf(year+' FOMC Meetings');if(start<0)throw Error('FOMC_YEAR_MISSING');const tail=fed.slice(start),end=tail.indexOf('<div class="panel-heading">');const section=end<0?tail:tail.slice(0,end);
  const rows=[...section.matchAll(/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>\s*([^<]+)</g)];
  if(rows.length!==8)throw Error('FOMC_COVERAGE_INVALID');
  for(const r of rows){const month=MONTHS.indexOf(r[1].trim().split('/').pop())+1,day=Number(r[2].trim().replace(/\*/g,'').split('-').pop());if(!month||!day)throw Error('FOMC_DATE_INVALID');const date=year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),special=date==='2027-10-27';events.push({id:'fed-FOMC-'+date,date,title:special?'FOMC 통화정책 전략회의 (정례 금리결정 없음)':'FOMC 회의 종료 · 금리결정 예정',category:'policy',publisher:'FED',type:special?'FOMC_STRATEGY':'FOMC_DECISION',priority:special?'high':'critical',verified:true,source:'Federal Reserve',sourceUrl:year===2027?REVISION:FED,dateBasis:'America/New_York',timeStatus:'unconfirmed',releaseStatus:'scheduled'})}
 }
 if(!bok.includes('syear=2026')||!bok.includes('통화정책방향'))throw Error('BOK_POLICY_YEAR_UNVERIFIED');
 const days=new Set([...bok.matchAll(/<th[^>]*>\s*(\d{1,2})월\s*(\d{1,2})일/g)].map(m=>'2026-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')));
 if(days.size!==8)throw Error('BOK_POLICY_COVERAGE_INVALID');
 for(const date of days)events.push({id:'bok-MPC-'+date,date,title:'한국은행 금통위 · 통화정책방향 결정회의',category:'policy',publisher:'BOK',type:'BOK_MPC',priority:'critical',verified:true,source:'한국은행',sourceUrl:BOK,dateBasis:'Asia/Seoul',timeStatus:'unconfirmed',releaseStatus:'scheduled'});
 const data={schemaVersion:1,source:'OFFICIAL_POLICY',retrievedAt:now.toISOString(),events:events.sort((a,b)=>a.date.localeCompare(b.date))};normalize(data,now.getTime());return data;
}
async function collect({fetchImpl=globalThis.fetch,now=new Date()}={}){
 const texts=await Promise.all([FED,BOK,REVISION].map(async url=>{const r=await fetchImpl(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});if(!r.ok)throw Error('POLICY_HTTP_FAILED');const t=await r.text();if(t.length>3000000)throw Error('POLICY_RESPONSE_OVERSIZED');return t}));return parse(...texts,{now});
}
if(require.main===module)collect().then(data=>{const fs=require('fs'),p=require('path').join(__dirname,'../data/policy-events.json');fs.writeFileSync(p+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(p+'.tmp',p);console.log(JSON.stringify({source:data.source,events:data.events.length,retrievedAt:data.retrievedAt}))}).catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={parse,collect};
