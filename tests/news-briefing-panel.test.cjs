'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','js','page-news.js'),'utf8');

test('AI morning briefing panel is scrollable on desktop and mobile',()=>{
 assert.match(src,/nev5-brief-scroll\{height:clamp\(250px,39vh,440px\)/);
 assert.match(src,/@media\(max-width:550px\)\{\.nev5-brief-scroll\{height:clamp\(220px,34vh,320px\)/);
});
test('briefing is labeled user-provided and does not falsely claim automation',()=>{
 assert.match(src,/오전 7시 ChatGPT 브리핑 · 자동 전달 미연결/);
 assert.match(src,/직접 등록/);
});
test('pasted briefing content is rendered as text, not HTML',()=>{
 assert.match(src,/viewer\.textContent=selected\.text/);
 assert.ok(!src.includes('viewer.innerHTML=selected.text'));
});
test('briefing supports date selector and explicit user action to store',()=>{
 assert.match(src,/date\.type='date'/);
 assert.match(src,/picker|select\.addEventListener\('change'/);
 assert.match(src,/localStorage\.setItem\(BRIEF_KEY/);
});
test('invalid and oversized persisted reports are excluded',()=>{
 const start=src.indexOf('function readBriefs(){'),end=src.indexOf('function renderBrief()',start);
 assert.ok(start>=0&&end>start,'readBriefs() should be present');
 const run=new Function('records',"const BRIEF_KEY='test';const localStorage={getItem:()=>JSON.stringify(records)};"+src.slice(start,end)+"return readBriefs()");
 const list=run([{date:'2026-11-18',text:'valid',at:1},{date:'bad',text:'bad',at:2},{date:'2026-11-17',text:'x'.repeat(20001),at:3}]);
 assert.equal(list.length,1);assert.equal(list[0].date,'2026-11-18');
});
