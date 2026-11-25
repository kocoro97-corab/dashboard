'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('js/page-news.js','utf8');
function gate(){
 const marker='function create(){';
 assert.equal(source.split(marker).length,2);
 const exposed=source.replace(marker,'window.__testNewsDay=isNewsPostedToday;'+marker);
 const ctx=vm.createContext({window:{},Date,Intl,DashboardPages:{register(){}}});
 vm.runInContext(exposed,ctx,{filename:'js/page-news.js'});
 return ctx.window.__testNewsDay;
}
test('today news gate uses Asia/Seoul date, not device UTC date',()=>{
 const published=gate(),now=Date.parse('2026-11-25T15:05:00Z'); // 2026-11-26 00:05 KST
 assert.equal(published('2026-11-25T15:00:00Z',now),true,'KST midnight is new day');
 assert.equal(published('2026-11-25T14:59:00Z',now),false,'one minute before KST midnight belongs to yesterday');
 assert.equal(published('2026-11-25T15:05:00Z',now),true);
});
test('future-dated and unverified article timestamps cannot masquerade as today',()=>{
 const published=gate(),now=Date.parse('2026-11-25T15:05:00Z');
 assert.equal(published('',now),false);
 assert.equal(published('bad-date',now),false);
 assert.equal(published('2026-11-25T15:11:00Z',now),false,'more than 5 minutes ahead is invalid');
 assert.equal(published('2026-11-25T15:09:00Z',now),true,'small publisher clock skew is tolerated');
});
