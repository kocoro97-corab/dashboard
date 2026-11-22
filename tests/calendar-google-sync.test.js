'use strict';
const assert=require('node:assert/strict');
const sync=require('../js/calendar-google-sync.js');
async function main(){
 assert.equal(sync.status().connected,false);
 let count=0;
 sync.connect({
  listCalendars:async()=>[{id:'primary',name:'Main',primary:true},{id:'work',name:'Work'}],
  listEvents:async({year,month,calendarIds})=>{count++;return [
   {id:'evt1',date:'2026-11-23',title:'Calendar event',calendarId:'primary'},
   {id:'evt1',date:'2026-11-23',title:'Calendar event duplicate',calendarId:'primary'},
   {id:'evt2',date:'2026-11-24',title:'Work event',calendarId:'work'},
   {id:'bad',date:'2026-12-01',title:'Wrong month',calendarId:'work'},
   {id:'leak',date:'2026-11-25',title:'Other calendar',calendarId:'other'}];}
 });
 assert.equal(sync.status().connected,true);
 const list=await sync.calendars();assert.equal(list.length,2);
 const first=await sync.events(2026,11);assert.equal(first.length,2);
 await sync.events(2026,11);assert.equal(count,1,'cache prevents repeated physical reads');
 sync.hide('work',true);assert.equal(sync.isHidden('work'),true);
 const filtered=await sync.events(2026,11);assert.equal(filtered.length,1);
 sync.disconnect();assert.equal(sync.status().connected,false);
 await assert.rejects(()=>sync.events(2026,11),/CALENDAR_NOT_CONNECTED/);
 assert.equal(sync.normalizeEvent({id:'x',calendarId:'primary',date:'2026-02-31',title:'bad'}),null);
 assert.equal(sync.normalizeEvent({id:'x',calendarId:'primary',date:'2026-11-02',title:'ok'}).date,'2026-11-02');
 console.log('Google calendar adapter tests PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1});
