/* MY INVEST V2 — browser-only personal investment calendar core.
 * Native manual events stay under existing page-news localStorage key.
 * Explicit .ics import/export is a file transfer, NOT Google live sync.
 * No API calls, remote storage, market data, accounts or orders.
 */
(function(root){
'use strict';
const STORAGE_KEY='myinvest_events_manual_v1';
const CAP=100,ICS_CAP=2*1024*1024;
const CATEGORIES=Object.freeze(['macro','earnings','policy','other']);
const LABELS=Object.freeze({macro:'경제지표',earnings:'기업실적',policy:'금리·정책',other:'기타'});
const validDate=s=>{
 if(typeof s!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(s))return false;
 const t=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s;
};
const validTime=s=>s===''||(typeof s==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s));
const clean=x=>typeof x==='string'?x.trim():'';
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function normalize(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const date=clean(row.date),title=clean(row.title),category=clean(row.category);
 const time=row.time===undefined?'':clean(row.time),note=row.note===undefined?'':clean(row.note);
 if(!validDate(date)||title.length<1||title.length>100||
  !CATEGORIES.includes(category)||!validTime(time)||note.length>500||
  typeof row.id!=='string'||row.id.length<1||row.id.length>90||
  !/^[A-Za-z0-9._:-]+$/.test(row.id))return null;
 return Object.freeze({id:row.id,date,time,title,category,note});
}
function read(storage){
 try{
  const text=storage?.getItem?.(STORAGE_KEY)||'[]';
  if(typeof text!=='string'||text.length>200000)return Object.freeze([]);
  const value=JSON.parse(text);
  if(!Array.isArray(value))return Object.freeze([]);
  const result=[],seen=new Set();
  for(const raw of value.slice(0,CAP)){
   const x=normalize(raw);
   if(x&&!seen.has(x.id)){seen.add(x.id);result.push(x)}
  }
  return Object.freeze(result.sort((a,b)=>a.date.localeCompare(b.date)||
   a.time.localeCompare(b.time)||a.title.localeCompare(b.title)));
 }catch{return Object.freeze([])}
}
function makeId(random){
 const x=typeof random==='function'?random():Math.random();
 const val=typeof x==='number'&&x>=0&&x<1?x:Math.random();
 return 'manual:'+Date.now().toString(36)+':'+Math.floor(val*0x100000000).toString(36);
}
function persist(storage,items){
 try{
  if(!storage||typeof storage.setItem!=='function')return {ok:false,code:'STORAGE_UNAVAILABLE'};
  storage.setItem(STORAGE_KEY,JSON.stringify(items));
  return {ok:true,count:items.length};
 }catch{return {ok:false,code:'STORAGE_UNAVAILABLE'}}
}
function upsert(storage,input,random){
 const old=read(storage);
 const existing=typeof input?.id==='string'&&old.find(x=>x.id===input.id);
 const identity=existing?.id||makeId(random);
 let row=normalize({...input,id:identity});
 if(!row)return {ok:false,code:'INVALID_EVENT'};
 if(!existing&&old.length>=CAP)return {ok:false,code:'EVENT_LIMIT_REACHED'};
 if(!existing&&old.some(x=>x.id===row.id))return {ok:false,code:'EVENT_ID_COLLISION'};
 const items=old.filter(x=>x.id!==row.id).concat([row]);
 const result=persist(storage,items);
 return result.ok?{ok:true,event:row,count:items.length}:result;
}
function remove(storage,id){
 if(typeof id!=='string')return {ok:false,code:'INVALID_EVENT_ID'};
 const old=read(storage);
 if(!old.some(x=>x.id===id))return {ok:false,code:'EVENT_NOT_FOUND'};
 return persist(storage,old.filter(x=>x.id!==id));
}
function daysInMonth(y,m){return new Date(Date.UTC(y,m,0)).getUTCDate()}
function month(y,m,events){
 if(!Number.isInteger(y)||y<2000||y>2099||!Number.isInteger(m)||m<1||m>12||
  !Array.isArray(events))return [];
 const first=new Date(Date.UTC(y,m-1,1)).getUTCDay();
 const cells=[];
 for(let i=0;i<first;i++)cells.push(null);
 for(let d=1;d<=daysInMonth(y,m);d++){
  const date=y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  cells.push(Object.freeze({date,day:d,
   items:Object.freeze(events.filter(x=>x.date===date))}));
 }
 return cells;
}
function escapeICS(s){
 return String(s).replace(/\\/g,'\\\\').replace(/\r\n?|\n/g,'\\n')
  .replace(/,/g,'\\,').replace(/;/g,'\\;');
}
function unescapeICS(s){
 return String(s).replace(/\\([nN,;\\])/g,(_,x)=>
  x==='n'||x==='N'?'\n':x);
}
function foldICS(line){
 const chunks=[];
 while(line.length>72){chunks.push(line.slice(0,72));line=' '+line.slice(72)}
 chunks.push(line);return chunks.join('\r\n');
}
function ymdDate(date){return date.replace(/-/g,'')}
function utcKST(date,time){
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);
 return new Date(Date.UTC(y,m-1,d,h-9,min)).toISOString().replace(/[-:]|\.\d{3}/g,'');
}
function plusDay(date){
 const [y,m,d]=date.split('-').map(Number);
 return new Date(Date.UTC(y,m-1,d+1)).toISOString().slice(0,10);
}
function exportICS(storage){
 const rows=read(storage);
 const lines=['BEGIN:VCALENDAR','VERSION:2.0',
  'PRODID:-//MY INVEST V2//Personal Investment Calendar//KO',
  'CALSCALE:GREGORIAN','METHOD:PUBLISH'];
 for(const x of rows){
  lines.push('BEGIN:VEVENT',foldICS('UID:'+x.id.replace(/:/g,'-')+'@myinvest-local'),
   'DTSTAMP:20261122T000000Z',
   x.time?'DTSTART:'+utcKST(x.date,x.time):'DTSTART;VALUE=DATE:'+ymdDate(x.date),
   ...(x.time?['DTEND:'+utcKST(x.date,x.time)]:['DTEND;VALUE=DATE:'+ymdDate(plusDay(x.date))]),
   foldICS('SUMMARY:'+escapeICS(x.title)),
   foldICS('CATEGORIES:'+escapeICS(LABELS[x.category]||'기타')));
  if(x.note)lines.push(foldICS('DESCRIPTION:'+escapeICS(x.note)));
  lines.push('END:VEVENT');
 }
 lines.push('END:VCALENDAR');
 return lines.join('\r\n')+'\r\n';
}
function digest(s){
 let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);
 return (h>>>0).toString(16);
}
function parseICS(data){
 if(typeof data!=='string'||data.length>ICS_CAP||data.length<25)
  return {ok:false,code:'INVALID_ICS_INPUT',events:[],skipped:0};
 const text=data.replace(/\r\n?/g,'\n');
 if(!text.includes('BEGIN:VCALENDAR')||!text.includes('END:VCALENDAR'))
  return {ok:false,code:'INVALID_ICS_FORMAT',events:[],skipped:0};
 const physical=text.split('\n');const lines=[];
 for(const line of physical){
  if(/^[ \t]/.test(line)&&lines.length)lines[lines.length-1]+=line.slice(1);
  else lines.push(line);
 }
 const events=[];let active=null,skipped=0;
 for(const line of lines){
  if(line==='BEGIN:VEVENT'){active={};continue}
  if(line==='END:VEVENT'){
   if(!active)continue;
   const uid=active.UID||'no-uid',raw=active.DTSTART||'',summary=active.SUMMARY||'';
   const recurring=active.RRULE||active['RECURRENCE-ID'];
   let date=null,time='';
   const all=/^(\d{4})(\d{2})(\d{2})$/.exec(raw);
   const utc=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?Z$/.exec(raw);
   const zoned=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?$/.exec(raw);
   if(all){date=all[1]+'-'+all[2]+'-'+all[3]}
   else if(utc){
    const utcMs=Date.UTC(+utc[1],+utc[2]-1,+utc[3],+utc[4],+utc[5]);
    const local=new Date(utcMs+9*3600000);
    date=local.toISOString().slice(0,10);time=local.toISOString().slice(11,16);
   }else if(zoned&&(!active.START_TZ||active.START_TZ==='Asia/Seoul')){
    date=zoned[1]+'-'+zoned[2]+'-'+zoned[3];time=zoned[4]+':'+zoned[5];
   }
   const title=unescapeICS(summary);
   if(!recurring&&date&&validDate(date)&&title&&title.length<=100){
    const id='ics:'+digest(uid+'|'+raw+'|'+title);
    const item=normalize({id,date,time,title,category:'other',
     note:unescapeICS(active.DESCRIPTION||'').slice(0,500)});
    if(item)events.push(item);else skipped++;
   }else skipped++;
   active=null;continue;
  }
  if(!active)continue;
  const split=line.indexOf(':');
  if(split<1)continue;
  const head=line.slice(0,split),value=line.slice(split+1),prop=head.split(';')[0];
  if(!/^[A-Z][A-Z0-9-]{0,30}$/.test(prop))continue;
  if(prop==='DTSTART'){
   const match=/(?:^|;)TZID=([^;]+)/.exec(head);
   active.START_TZ=match?.[1]||'';
  }
  if(['UID','DTSTART','SUMMARY','DESCRIPTION','RRULE','RECURRENCE-ID'].includes(prop))
   active[prop]=value.slice(0,3000);
 }
 return {ok:true,events,skipped};
}
function importICS(storage,data){
 const parsed=parseICS(data);
 if(!parsed.ok)return parsed;
 const before=read(storage);const ids=new Set(before.map(x=>x.id));
 const space=CAP-before.length;
 const adds=parsed.events.filter(x=>!ids.has(x.id));
 const taken=adds.slice(0,Math.max(0,space));
 const result=persist(storage,before.concat(taken));
 return result.ok?{ok:true,added:taken.length,
  duplicate:parsed.events.length-adds.length,
  skipped:parsed.skipped+adds.length-taken.length,
  count:result.count}:result;
}
function normalizeGoogle(list){
 if(!Array.isArray(list))return Object.freeze([]);
 const rows=[];
 for(const x of list.slice(0,250)){
  if(!x||typeof x!=='object'||typeof x.summary!=='string'||
   !x.summary.trim()||x.summary.length>100||typeof x.id!=='string')continue;
  const raw=x.start?.date||x.start?.dateTime;
  if(typeof raw!=='string')continue;
  const date=raw.slice(0,10);
  if(!validDate(date))continue;
  const time=x.start?.dateTime?
   (/^(\d{4}-\d{2}-\d{2})T(\d\d:\d\d)/.exec(raw)?.[2]||''):'';
  if(!validTime(time))continue;
  rows.push(Object.freeze({id:'google:'+digest(x.id+'|'+raw),date,time,
   title:x.summary.trim(),category:'other',note:'',readOnly:true}));
 }
 return Object.freeze(rows.sort((a,b)=>a.date.localeCompare(b.date)||
  a.time.localeCompare(b.time)||a.title.localeCompare(b.title)));
}
const api=Object.freeze({STORAGE_KEY,CAP,LABELS,read,upsert,remove,month,parseICS,
 importICS,exportICS,normalizeGoogle,validDate});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestCalendarCoreV2=api;
})(typeof globalThis!=='undefined'?globalThis:this);
