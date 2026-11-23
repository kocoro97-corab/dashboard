(function(root){'use strict';
/* BEA's officially published machine-readable release dates.
 * https://apps.bea.gov/API/signup/release_dates.json
 * Source timestamps use explicit UTC offsets; no US-market clock assumptions.
 * Data are a schedule, never forecasts or released statistics.
 */
const SOURCE='https://apps.bea.gov/API/signup/release_dates.json';
const TYPES=Object.freeze({
 'Gross Domestic Product':{type:'GDP',title:'미국 GDP 발표',priority:'critical'},
 'Personal Income and Outlays':{type:'PCE',title:'미국 개인소득·소비지출(PCE) 발표',priority:'critical'},
 'U.S. International Trade in Goods and Services':{type:'TRADE',title:'미국 무역수지 발표',priority:'high'},
 'Corporate Profits':{type:'PROFITS',title:'미국 기업이익 발표',priority:'high'}
});
const dateKST=instant=>{const o={};for(const p of new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)))if(p.type!=='literal')o[p.type]=p.value;return o.year+'-'+o.month+'-'+o.day};
function parse(payload,{retrievedAt=new Date().toISOString()}={}){
 if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Number.isFinite(Date.parse(retrievedAt)))throw Error('BEA_INVALID');
 const rows=[],seen=new Set();
 for(const [key,meta] of Object.entries(TYPES)){
  const dates=payload[key]?.release_dates;
  if(dates==null)continue;
  if(!Array.isArray(dates)||dates.length>160)throw Error('BEA_SCHEMA_INVALID');
  for(const value of dates){
   if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(value))continue;
   const instant=Date.parse(value);if(!Number.isFinite(instant))continue;
   const startsAt=new Date(instant).toISOString(),date=dateKST(instant),id='bea-'+meta.type+'-'+startsAt;
   if(seen.has(id))continue;seen.add(id);
   rows.push({id,date,title:meta.title,category:'macro',priority:meta.priority,publisher:'BEA',type:meta.type,
    verified:true,source:'BEA',sourceUrl:SOURCE,startsAt,observedAt:retrievedAt,releaseStatus:'scheduled'});
  }
 }
 if(rows.length===0)throw Error('BEA_NO_VERIFIED_EVENTS');
 return {events:rows.sort((a,b)=>a.startsAt.localeCompare(b.startsAt)),sourceUrl:SOURCE,retrievedAt};
}
const api=Object.freeze({SOURCE,parse,TYPES});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestBeaSchedule=api;
})(globalThis);
