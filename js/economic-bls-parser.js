(function(root){'use strict';
/* Official BLS ICS schedule parser for MY INVEST V2.
   Source: https://www.bls.gov/schedule/news_release/bls.ics
   No date prediction, no estimated/actual values, no login credentials.
   Unknown or ambiguous time zones are rejected rather than guessed. */
const SOURCE='https://www.bls.gov/schedule/news_release/bls.ics';
const MAX_BYTES=1500000,MAX_EVENTS=600;
const CLASSIFIERS=Object.freeze([
 {re:/^(consumer price index|cpi)(\b|\s|\()/i,type:'CPI',priority:'critical',label:'미국 CPI'},
 {re:/^(employment situation|the employment situation)(\b|\s|\()/i,type:'NFP',priority:'critical',label:'미국 고용보고서'},
 {re:/^(producer price index|ppi)(\b|\s|\()/i,type:'PPI',priority:'high',label:'미국 PPI'},
 {re:/^(job openings and labor turnover|jolts)(\b|\s|\()/i,type:'JOLTS',priority:'high',label:'미국 JOLTS'},
 {re:/^(employment cost index)(\b|\s|\()/i,type:'ECI',priority:'high',label:'미국 고용비용지수'}
]);
const dateOK=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s};
const clean=s=>String(s||'').replace(/\\[nN]/g,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
function classify(summary){const title=clean(summary);for(const entry of CLASSIFIERS)if(entry.re.test(title))return {...entry};return null}
const localParts=(date,zone)=>{
 const f=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const obj={};for(const item of f.formatToParts(date))if(item.type!=='literal')obj[item.type]=item.value;
 return obj;
};
function fromNewYork(s){
 const m=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(s||'');
 if(!m)return null;
 const [y,mo,d,h,mi,se]=m.slice(1).map(Number);
 const day=[y,String(mo).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
 if(!dateOK(day)||h>23||mi>59||se>59)return null;
 const base=Date.UTC(y,mo-1,d,h,mi,se),matches=[];
 for(const offset of [4,5]){
  const time=base+offset*3600000,parts=localParts(new Date(time),'America/New_York');
  if(Number(parts.year)===y&&Number(parts.month)===mo&&Number(parts.day)===d&&Number(parts.hour)===h&&Number(parts.minute)===mi&&Number(parts.second)===se)matches.push(time);
 }
 if(matches.length!==1)return null; // nonexistent or repeated DST hour
 return new Date(matches[0]).toISOString();
}
function parse(ics,{retrievedAt=new Date().toISOString()}={}){
 if(typeof ics!=='string'||ics.length>MAX_BYTES||!ics.includes('BEGIN:VCALENDAR'))throw Error('BLS_ICS_INVALID');
 if(!Number.isFinite(Date.parse(retrievedAt)))throw Error('BLS_TIMESTAMP_INVALID');
 const lines=ics.replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'').split('\n');
 const result=new Map();let row=null,ignored=0;
 for(const line of lines){
  if(line==='BEGIN:VEVENT'){row={};continue}
  if(line==='END:VEVENT'&&row){
   const entry=classify(row.summary),time=fromNewYork(row.start);
   if(!entry||!time||row.cancelled){ignored++;row=null;continue}
   const kst=localParts(new Date(time),'Asia/Seoul'),date=kst.year+'-'+kst.month+'-'+kst.day;
   if(!dateOK(date)){ignored++;row=null;continue}
   const uid=clean(row.uid).slice(0,180),id='bls-'+entry.type+'-'+time;
   const event={id,date,title:entry.label+' 발표',category:'macro',publisher:'BLS',type:entry.type,priority:entry.priority,
    observedAt:retrievedAt,sourceUrl:SOURCE,source:'BLS',verified:true,
    startsAt:time,localDate:date,localTime:kst.hour+':'+kst.minute,sourceTimeZone:'America/New_York',
    sourceTitle:clean(row.summary).slice(0,120),uid,releaseStatus:'scheduled'};
   result.set(id,event);row=null;continue;
  }
  if(!row)continue;
  const colon=line.indexOf(':');if(colon<0)continue;
  const head=line.slice(0,colon).toUpperCase(),value=line.slice(colon+1);
  if(head==='SUMMARY')row.summary=value;
  else if(head==='UID')row.uid=value;
  else if(head==='STATUS'&&value.toUpperCase()==='CANCELLED')row.cancelled=true;
  else if(head==='DTSTART;TZID=AMERICA/NEW_YORK'||head==='DTSTART;TZID=US/EASTERN'||head==='DTSTART')row.start=value; // BLS official schedule uses US Eastern wall clock for floating times.
  // Unknown TZ or all-day date intentionally unsupported; no fabricated hour.
 }
 const events=[...result.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)).slice(0,MAX_EVENTS);
 return {events,ignored,sourceUrl:SOURCE,retrievedAt};
}
const api=Object.freeze({SOURCE,parse,classify,fromNewYork,MAX_BYTES,MAX_EVENTS});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestBlsSchedule=api;
})(globalThis);
