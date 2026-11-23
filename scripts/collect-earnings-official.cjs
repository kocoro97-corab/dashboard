'use strict';
// Fixed issuer newsroom sources, not filing receipt dates or a portfolio query.
// These documents report released results (historical); never project next quarter.
const fs=require('node:fs'),path=require('node:path');
const {build}=require('./build-earnings-snapshot.cjs');
const SOURCES=Object.freeze([
 {market:'US',symbol:'NVDA',name:'NVIDIA',period:'FY2027 Q3',url:'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-third-quarter-fiscal-2027',title:/NVIDIA Announces Financial Results for Third Quarter Fiscal 2027/,body:/NVIDIA\s*\(NASDAQ:\s*NVDA\)\s*today reported/i},
 {market:'KR',symbol:'005930',name:'삼성전자',period:'2026 Q3',url:'https://news.samsung.com/global/samsung-electronics-announces-third-quarter-2026-results',title:/Samsung Electronics Announces Third Quarter 2026 Results/i,body:/Samsung Electronics today reported financial results/i}
]);
function reviewed(html,source,now=new Date()){
 if(typeof html!=='string'||html.length>2000000||!source.title.test(html))throw Error('ISSUER_TITLE_INVALID');
 const plain=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
 if(!source.body.test(plain))throw Error('ISSUER_RELEASE_EVIDENCE_MISSING');
 let date;
 if(source.symbol==='NVDA'){
  const text=/<div class="article-date">\s*([A-Za-z]+ \d{1,2}, \d{4})\s*<\/div>/.exec(html)?.[1];
  const parsed=Date.parse(text+' 00:00:00 GMT');if(!Number.isFinite(parsed))throw Error('ISSUER_DATE_MISSING');date=new Date(parsed).toISOString().slice(0,10);
 }else date=/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})T/.exec(html)?.[1];
 if(!date||date>now.toISOString().slice(0,10))throw Error('RELEASE_DOCUMENT_NOT_YET_PUBLISHED');
 return {eventId:source.symbol+'-'+source.period.replaceAll(' ','-'),market:source.market,symbol:source.symbol,name:source.name,period:source.period,eventType:'earnings',date,dateStatus:'confirmed',evidence:'issuer_announcement',sourceUrl:source.url,verifiedAt:now.toISOString()};
}
async function collect({fetchImpl=globalThis.fetch,now=new Date()}={}){
 const events=[];
 for(const source of SOURCES){
  const r=await fetchImpl(source.url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});
  if(!r.ok)throw Error('ISSUER_HTTP_FAILED');events.push(reviewed(await r.text(),source,now));
 }
 return build({events},{now});
}
if(require.main===module)collect().then(data=>{const dest=path.join(__dirname,'../data/earnings-events.json');fs.writeFileSync(dest+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(dest+'.tmp',dest);console.log(JSON.stringify({source:data.source,events:data.events.length,retrievedAt:data.retrievedAt,coverage:'VERIFIED_HISTORICAL_RELEASES_NOT_UPCOMING_FORECASTS'}))}).catch(()=>{console.error('ISSUER_COLLECTION_FAILED_PREVIOUS_SNAPSHOT_PRESERVED');process.exitCode=1});
module.exports={collect,reviewed,SOURCES};
