'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const c=require('../js/invest-calendar-core-v2.js');
function memory(seed=[]){
 const m=new Map([[c.STORAGE_KEY,JSON.stringify(seed)]]);
 return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),
  removeItem:k=>m.delete(k),dump:()=>m.get(c.STORAGE_KEY)};
}
const event=(over={})=>({date:'2026-11-25',title:'FOMC 일정 확인',
 category:'macro',time:'',note:'',...over});
const sampleICS=(rows)=>['BEGIN:VCALENDAR','VERSION:2.0',...rows,'END:VCALENDAR',''].join('\r\n');
const icsEvent=(id,dt,title,extra=[])=>['BEGIN:VEVENT','UID:'+id,'DTSTART:'+dt,
 'SUMMARY:'+title,...extra,'END:VEVENT'];
const read=s=>c.read(s);
test('legacy browser manual event key and category are retained without migration loss',()=>{
 const s=memory([{id:'1763800000-abc123',date:'2026-11-25',
  title:'기존 일정',category:'macro'}]);
 assert.equal(c.STORAGE_KEY,'myinvest_events_manual_v1');
 assert.deepEqual(read(s).map(x=>[x.id,x.date,x.title,x.category]),
  [['1763800000-abc123','2026-11-25','기존 일정','macro']]);
 assert.equal(read(s)[0].time,'');
 assert.equal(read(s)[0].note,'');
});
test('write and read normal manual event with a proper KST date',()=>{
 const s=memory();
 const r=c.upsert(s,event(),()=>0.12);
 assert.equal(r.ok,true);
 assert.equal(read(s).length,1);
 assert.equal(read(s)[0].date,'2026-11-25');
 assert.equal(read(s)[0].title,'FOMC 일정 확인');
 assert.equal(read(s)[0].category,'macro');
 assert.match(read(s)[0].id,/^manual:/);
});
test('editing an existing event does not create a duplicate',()=>{
 const s=memory();
 const first=c.upsert(s,event()).event;
 const updated=c.upsert(s,event({id:first.id,date:'2026-11-27',
  title:'금리 발표 후 점검',time:'21:30',note:'VIX 확인'}));
 assert.equal(updated.ok,true);
 assert.equal(read(s).length,1);
 assert.equal(read(s)[0].id,first.id);
 assert.equal(read(s)[0].date,'2026-11-27');
 assert.equal(read(s)[0].time,'21:30');
 assert.equal(read(s)[0].note,'VIX 확인');
});
test('delete only the selected manual event',()=>{
 const s=memory();
 const a=c.upsert(s,event({title:'A'})).event;
 c.upsert(s,event({title:'B',date:'2026-11-26'}));
 assert.equal(c.remove(s,a.id).ok,true);
 assert.deepEqual(read(s).map(x=>x.title),['B']);
});
test('unknown deletion is not successful or destructive',()=>{
 const s=memory();
 c.upsert(s,event());
 const old=s.dump();
 assert.equal(c.remove(s,'not-existing').code,'EVENT_NOT_FOUND');
 assert.equal(s.dump(),old);
});
test('invalid calendar date is rejected rather than normalized to March',()=>{
 const s=memory();
 assert.equal(c.upsert(s,event({date:'2026-02-30'})).code,'INVALID_EVENT');
 assert.equal(c.validDate('2026-02-30'),false);
 assert.equal(c.validDate('2028-02-29'),true);
 assert.equal(c.validDate('2026-11-30'),true);
});
test('invalid title, category, time, and overlong notes are rejected',()=>{
 const s=memory();
 for(const row of [event({title:' '}),event({title:'x'.repeat(101)}),
  event({category:'internal'}),event({time:'24:00'}),
  event({time:'09:99'}),event({note:'x'.repeat(501)})]){
  assert.equal(c.upsert(s,row).code,'INVALID_EVENT');
 }
 assert.equal(read(s).length,0);
});
test('manual event allows 00:00 and 23:59 time without inventing timezone offsets',()=>{
 const s=memory();c.upsert(s,event({time:'00:00'}));
 c.upsert(s,event({time:'23:59',title:'마감'}));
 assert.deepEqual(read(s).map(x=>x.time),['00:00','23:59']);
});
test('manual entry bound max 100, but editing existing event remains allowed',()=>{
 const s=memory(Array.from({length:100},(_,i)=>({id:'existing-'+i,
  date:'2026-11-25',title:'일정 '+i,category:'other'})));
 assert.equal(read(s).length,100);
 assert.equal(c.upsert(s,event()).code,'EVENT_LIMIT_REACHED');
 assert.equal(c.upsert(s,event({id:'existing-0',title:'수정'})).ok,true);
 assert.equal(read(s).length,100);
});
test('deduplicate legacy event IDs and sort by day, time then title',()=>{
 const s=memory([
  {id:'a',date:'2026-11-27',title:'Z',category:'policy'},
  {id:'b',date:'2026-11-26',title:'Y',category:'macro',time:'14:00'},
  {id:'b',date:'2026-11-20',title:'duplicate',category:'other'},
  {id:'c',date:'2026-11-26',title:'A',category:'earnings',time:'09:00'}
 ]);
 assert.deepEqual(read(s).map(x=>x.id),['c','b','a']);
});
test('invalid raw localStorage entries are not displayed or copied',()=>{
 const s=memory([{id:'a',date:'2026-11-25',title:'valid',category:'macro'},
  {id:'javascript:alert(1)',date:'2026-11-25',title:'bad',category:'macro'},
  {id:'b',date:'2026-11-25',title:'',category:'other'},
  {id:'c',date:'2026-11-25',title:'not in list',category:'sensitive'}]);
 assert.deepEqual(read(s).map(x=>x.title),['valid']);
});
test('malformed JSON and unavailable browser storage are nonfatal',()=>{
 const broken={getItem:()=>'{',setItem:()=>{throw Error('storage failed')}};
 assert.deepEqual(read(broken),[]);
 assert.equal(c.upsert(broken,event()).code,'STORAGE_UNAVAILABLE');
 assert.deepEqual(read(null),[]);
});
test('storage write errors report failure with no false persistence claim',()=>{
 const s={getItem:()=>null,setItem:()=>{throw Error('QuotaExceeded')}};
 const r=c.upsert(s,event());
 assert.equal(r.ok,false);
 assert.equal(r.code,'STORAGE_UNAVAILABLE');
});
test('one-month calendar grid starts on the actual weekday and shows selected dates',()=>{
 const s=memory();
 c.upsert(s,event({date:'2026-11-01',title:'월 첫날'}));
 const days=c.month(2026,11,read(s));
 assert.equal(days[0].date,'2026-11-01');
 assert.equal(days[0].items.length,1);
 assert.equal(days.length,30);
});
test('February leap day grid and weekday lead cells use UTC to avoid offset drift',()=>{
 const cells=c.month(2028,2,[]);
 const active=cells.filter(Boolean);
 assert.equal(active.length,29);
 assert.equal(active.at(-1).date,'2028-02-29');
 assert.equal(c.month(2026,13,[]).length,0);
});
test('ICS export contains a well-formed calendar envelope and matching event text',()=>{
 const s=memory();
 c.upsert(s,event({title:'금리 발표, 확인; 점검',note:'첫 줄\n다음 줄'}));
 const ics=c.exportICS(s);
 assert.match(ics,/^BEGIN:VCALENDAR\r\nVERSION:2.0/m);
 assert.match(ics,/BEGIN:VEVENT/);
 assert.match(ics,/SUMMARY:금리 발표\\, 확인\\; 점검/);
 assert.match(ics,/DESCRIPTION:첫 줄\\n다음 줄/);
 assert.match(ics,/DTSTART;VALUE=DATE:20261125/);
 assert.match(ics,/DTEND;VALUE=DATE:20261126/);
 assert.match(ics,/END:VCALENDAR/);
});
test('timed ICS exports correct KST to UTC and a real one-hour duration',()=>{
 const s=memory();c.upsert(s,event({time:'09:30'}));
 const ics=c.exportICS(s);
 assert.match(ics,/DTSTART:20261125T003000Z/);
 assert.match(ics,/DTEND:20261125T013000Z/);
});
test('timed ICS crossing UTC date boundary remains a valid complete timestamp',()=>{
 const s=memory();c.upsert(s,event({time:'00:30'}));
 const ics=c.exportICS(s);
 assert.match(ics,/DTSTART:20261124T153000Z/);
 assert.match(ics,/DTEND:20261124T163000Z/);
});
test('Google-exported all-day ICS event imports into local calendar without an API call',()=>{
 const s=memory();
 const text=sampleICS(icsEvent('google-a@google.com','20261125','Google 일정'));
 const r=c.importICS(s,text);
 assert.equal(r.ok,true);
 assert.equal(r.added,1);
 assert.equal(read(s)[0].date,'2026-11-25');
 assert.equal(read(s)[0].title,'Google 일정');
 assert.match(read(s)[0].id,/^ics:/);
});
test('iCalendar CRLF and folded SUMMARY are normalized without raw markup',()=>{
 const s=memory();
 const text=sampleICS(icsEvent('a','20261125','장기 제'
  ).map(line=>line==='SUMMARY:장기 제'?'SUMMARY:장기 제\r\n 목':''+line));
 const r=c.importICS(s,text);
 assert.equal(r.added,1);
 assert.equal(read(s)[0].title,'장기 제목');
});
test('UTC imported events are converted into KST date and time',()=>{
 const s=memory();
 const text=sampleICS(icsEvent('b','20261124T160000Z','발표'));
 assert.equal(c.importICS(s,text).added,1);
 assert.equal(read(s)[0].date,'2026-11-25');
 assert.equal(read(s)[0].time,'01:00');
});
test('Asia/Seoul TZID local ICS time imports with the original local clock',()=>{
 const s=memory();
 const text=sampleICS(['BEGIN:VEVENT','UID:c',
  'DTSTART;TZID=Asia/Seoul:20261125T153000','SUMMARY:실적','END:VEVENT']);
 assert.equal(c.importICS(s,text).added,1);
 assert.equal(read(s)[0].time,'15:30');
});
test('unknown timezone is skipped rather than converted to an invented KST time',()=>{
 const s=memory();
 const text=sampleICS(['BEGIN:VEVENT','UID:unknown',
  'DTSTART;TZID=America/New_York:20261125T090000',
  'SUMMARY:미국 일정','END:VEVENT']);
 const result=c.importICS(s,text);
 assert.equal(result.added,0);
 assert.equal(result.skipped,1);
});
test('ICS recurring RRULE is skipped rather than only storing first occurrence',()=>{
 const s=memory();
 const raw=sampleICS(icsEvent('repeat','20261125','반복 모임',
  ['RRULE:FREQ=WEEKLY;COUNT=12']));
 const r=c.importICS(s,raw);
 assert.equal(r.ok,true);
 assert.equal(r.added,0);
 assert.equal(r.skipped,1);
});
test('invalid or huge ICS file content fails closed',()=>{
 const s=memory();
 assert.equal(c.importICS(s,'not-ics').code,'INVALID_ICS_INPUT');
 assert.equal(c.importICS(s,'BEGIN:VCALENDAR\nunfinished').code,'INVALID_ICS_FORMAT');
 assert.equal(c.importICS(s,'x'.repeat(2097153)).code,'INVALID_ICS_INPUT');
 assert.equal(read(s).length,0);
});
test('importing the same Google ICS twice is idempotent',()=>{
 const s=memory();
 const text=sampleICS(icsEvent('same-uid','20261125','중복 확인'));
 assert.equal(c.importICS(s,text).added,1);
 const again=c.importICS(s,text);
 assert.equal(again.added,0);
 assert.equal(again.duplicate,1);
 assert.equal(read(s).length,1);
});
test('duplicate VEVENTs within one source ICS are not imported twice',()=>{
 const s=memory();
 const e=icsEvent('same','20261125','중복');
 const r=c.importICS(s,sampleICS(e.concat(e)));
 assert.equal(r.added,1);
 assert.equal(read(s).length,1);
});
test('import respects existing manually created records, keeps category, and caps total at 100',()=>{
 const s=memory(Array.from({length:99},(_,i)=>({id:'old-'+i,
  date:'2026-11-25',title:'수동'+i,category:'macro'})));
 const text=sampleICS(icsEvent('a','20261125','수신 A')
  .concat(icsEvent('b','20261126','수신 B')));
 const r=c.importICS(s,text);
 assert.equal(r.added,1);
 assert.equal(r.skipped,1);
 assert.equal(read(s).length,100);
 assert.equal(read(s)[0].category,'macro');
});
test('export/import round trip preserves titles, dates and times',()=>{
 const original=memory();
 c.upsert(original,event({title:'한국 발표',date:'2026-11-25',time:'17:30'}));
 const dest=memory();
 const result=c.importICS(dest,c.exportICS(original));
 assert.equal(result.added,1);
 assert.equal(read(dest)[0].title,'한국 발표');
 assert.equal(read(dest)[0].time,'17:30');
 assert.equal(read(dest)[0].date,'2026-11-25');
});
test('Google all-day events are marked readOnly and do not mutate browser manual events',()=>{
 const s=memory();const old=s.dump();
 const google=c.normalizeGoogle([{id:'a',summary:'Google 휴가',
  start:{date:'2026-11-25'},status:'confirmed'}]);
 assert.equal(google.length,1);
 assert.equal(google[0].readOnly,true);
 assert.equal(google[0].date,'2026-11-25');
 assert.equal(s.dump(),old);
});
test('Google timed events convert foreign offset to Asia/Seoul correctly',()=>{
 const google=c.normalizeGoogle([{id:'b',summary:'미국 발표',
  start:{dateTime:'2026-11-24T18:30:00-05:00'}}]);
 assert.equal(google[0].date,'2026-11-25');
 assert.equal(google[0].time,'08:30');
});
test('Google events with missing identity, invalid date or malformed title are omitted',()=>{
 const r=c.normalizeGoogle([{id:'1',summary:'',start:{date:'2026-11-25'}},
  {id:'2',summary:'유효',start:{date:'2026-02-31'}},
  {id:'3',summary:'제목',start:{date:'2026-11-25'}},
  {id:3,summary:'문자열 ID 필요',start:{date:'2026-11-25'}}]);
 assert.deepEqual(r.map(x=>x.title),['제목']);
});
test('event lists returned by core are immutable and deterministic',()=>{
 const s=memory();c.upsert(s,event());
 const a=read(s),b=read(s);
 assert.deepEqual(a,b);
 assert.ok(Object.isFrozen(a));
 assert.ok(Object.isFrozen(a[0]));
});
test('Google data never enters ICS export of browser manual events',()=>{
 const s=memory();c.upsert(s,event());
 c.normalizeGoogle([{id:'google-private',summary:'비공개 구글 일정',
  start:{date:'2026-11-25'}}]);
 assert.ok(!c.exportICS(s).includes('비공개 구글 일정'));
});
test('source files contain no broker, network, user credential or remote write paths',()=>{
 const code=fs.readFileSync(path.join(__dirname,'../js/invest-calendar-core-v2.js'),'utf8');
 for(const forbidden of ['fetch(', 'XMLHttpRequest','NH_ACCOUNT','PropertiesService',
  'placeOrder(', 'executeOrder(', 'GAS_URL'])
  assert.equal(code.includes(forbidden),false,forbidden);
});
test('page-news calendar trigger retains native route and forwards opens to workspace',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/page-news.js'),'utf8');
 assert.match(source,/const calendarButton=btn\('▦ 투자 캘린더',openCalendar\)/);
 assert.match(source,/if\(root\.MYInvestCalendarWorkspaceV2\?\.open\)/);
 assert.match(source,/calendarEventsListener=\(\)=>\{if\(active\)events\(\)\}/);
 assert.match(source,/MYInvestCalendarWorkspaceV2\?\.logout\?\.\(\)/);
});


test('anniversary category and annual recurrence survive local storage and monthly projection',()=>{
 const s=memory();
 const r=c.upsert(s,event({date:'2025-06-03',title:'기념일',category:'anniversary',repeat:'yearly'}));
 assert.equal(r.ok,true);
 assert.equal(read(s)[0].repeat,'yearly');
 assert.equal(read(s)[0].category,'anniversary');
 assert.equal(c.LABELS.anniversary,'기념일');
 const june=c.month(2027,6,read(s));
 const day=june.find(x=>x?.date==='2027-06-03');
 assert.equal(day.items.length,1);
 assert.equal(day.items[0].date,'2027-06-03');
 assert.equal(day.items[0].originalDate,'2025-06-03');
 assert.equal(day.items[0].occurrence,true);
 assert.equal(read(s)[0].date,'2025-06-03');
});
test('yearly anniversary does not appear in years before the original date',()=>{
 const s=memory();
 c.upsert(s,event({date:'2027-09-18',title:'기념일',category:'anniversary',repeat:'yearly'}));
 const cell=c.month(2026,9,read(s)).find(x=>x?.date==='2026-09-18');
 assert.equal(cell.items.length,0);
});
test('February 29 anniversary is never silently reinterpreted as February 28',()=>{
 const s=memory();
 c.upsert(s,event({date:'2028-02-29',title:'윤년 기념일',
  category:'anniversary',repeat:'yearly'}));
 const jan=c.month(2029,2,read(s));
 assert.equal(jan.flatMap(x=>x?.items||[]).length,0);
 const future=c.month(2032,2,read(s));
 assert.equal(future.find(x=>x?.date==='2032-02-29').items.length,1);
});
test('anniversary can be edited and deleted by original id without creating yearly copies',()=>{
 const s=memory();
 const e=c.upsert(s,event({date:'2026-03-12',title:'주년',
  category:'anniversary',repeat:'yearly'})).event;
 const projected=c.month(2027,3,read(s)).find(x=>x?.date==='2027-03-12').items[0];
 assert.equal(projected.id,e.id);
 const edit=c.upsert(s,{...projected,id:e.id,date:'2026-03-12',
  title:'수정 기념일',repeat:'yearly'});
 assert.equal(edit.ok,true);
 assert.equal(read(s).length,1);
 assert.equal(c.remove(s,e.id).ok,true);
 assert.equal(read(s).length,0);
});
test('anniversary iCalendar export includes RFC5545 yearly rule and roundtrips',()=>{
 const s=memory();
 c.upsert(s,event({date:'2026-08-15',title:'연례행사',
  category:'anniversary',repeat:'yearly'}));
 const raw=c.exportICS(s);
 assert.match(raw,/RRULE:FREQ=YEARLY/);
 const other=memory();
 const r=c.importICS(other,raw);
 assert.equal(r.added,1);
 assert.equal(read(other)[0].repeat,'yearly');
});
test('ICS complex recurring rules remain safely omitted rather than inventing occurrences',()=>{
 const s=memory();
 const x=sampleICS(icsEvent('more','20261125','매주',
  ['RRULE:FREQ=WEEKLY;BYDAY=MO']));
 const r=c.importICS(s,x);
 assert.equal(r.added,0);
 assert.equal(r.skipped,1);
});
