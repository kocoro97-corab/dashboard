(function(root){'use strict';
// Google Calendar / other RFC5545 .ics export, local-session read-only import.
// No external request, no credentials, no persistence and no silent calendar sync.
// Recurrences without a concrete DTSTART occurrence are not expanded.
const MAX_FILE_BYTES=1024*1024,MAX_EVENTS=500;
let imported=[];
function dateFrom(value){
 const m=String(value||'').match(/^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/);
 if(!m)return null;
 const s=m[1]+'-'+m[2]+'-'+m[3],time=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===s?s:null;
}
function unfold(input){return String(input).replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'').split('\n')}
function unescapeText(s){return s.replace(/\\[nN]/g,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').trim()}
function parseIcs(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>MAX_FILE_BYTES)throw Error('ICS_FILE_TOO_LARGE');
 if(!/^BEGIN:VCALENDAR\s*$/m.test(raw))throw Error('ICS_INVALID');
 const lines=unfold(raw),events=[],invalid={count:0},seen=new Set();let entry=null;
 for(const line of lines){
  if(line==='BEGIN:VEVENT'){entry={};continue}
  if(line==='END:VEVENT'&&entry){
   const date=dateFrom(entry.dtstart),title=unescapeText(entry.summary||'').slice(0,100);
   // RRULE dates must not be fabricated: display concrete start only, with visible warning.
   if(!date||!title){invalid.count++;entry=null;continue}
   const key=(entry.uid||title)+'|'+date;
   if(!seen.has(key)&&events.length<MAX_EVENTS){
    seen.add(key);
    events.push({id:'ics-'+key,date,title,category:'anniversary',source:'ics-import',verified:false,recurrenceUnexpanded:!!entry.rrule});
   }
   entry=null;continue;
  }
  if(!entry)continue;
  const cut=line.indexOf(':');if(cut<0)continue;
  const name=line.slice(0,cut).split(';')[0].toUpperCase(),value=line.slice(cut+1);
  if(name==='DTSTART')entry.dtstart=value;
  if(name==='SUMMARY')entry.summary=value;
  if(name==='UID')entry.uid=value.slice(0,256);
  if(name==='RRULE')entry.rrule=value;
 }
 return {events,skipped:invalid.count,limited:events.length>=MAX_EVENTS,recurrences:events.filter(x=>x.recurrenceUnexpanded).length};
}
function importText(text){const parsed=parseIcs(text);imported=parsed.events;return {...parsed,events:list()}}
function list(){return imported.map(x=>({...x}))}
function clear(){imported=[]}
const api=Object.freeze({parseIcs,importText,list,clear,limits:Object.freeze({fileBytes:MAX_FILE_BYTES,events:MAX_EVENTS})});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestIcsCalendar=api;
})(globalThis);
