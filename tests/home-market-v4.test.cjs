'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const policySource=read('js/home-market-policy.js');
const homeSource=read('js/page-home.js');
const diagSource=read('js/read-status.js');
const shellCss=read('css/dashboard-shell.css');
function policy(){const window={};new Function('window',policySource)(window);return window.HomeMarketPolicy}
const now=Date.parse('2026-11-20T08:00:00Z');
const samples=(a,b,received=now)=>({
 quotes:{'^KS11':{p:a,prev:100},'^KQ11':{p:b,prev:100},'^GSPC':{p:111,prev:100},'^IXIC':{p:114,prev:100},'^VIX':{p:28.52,prev:25},'^SOX':{p:102,prev:100}},
 sources:{'^KS11':'N','^KQ11':'N','^GSPC':'Y','^IXIC':'Y','^VIX':'N','^SOX':'N'},
 timestamps:Object.fromEntries(['^KS11','^KQ11','^GSPC','^IXIC','^VIX','^SOX'].map(x=>[x,received]))
});
test('KST automatic session boundaries are exact at 07:00 and 21:00',()=>{
 const p=policy();
 assert.equal(p.regionAt(new Date('2026-11-19T21:59:00Z')),'US'); // 06:59 KST
 assert.equal(p.regionAt(new Date('2026-11-19T22:00:00Z')),'KR'); // 07:00 KST
 assert.equal(p.regionAt(new Date('2026-11-20T11:59:00Z')),'KR'); // 20:59 KST
 assert.equal(p.regionAt(new Date('2026-11-20T12:00:00Z')),'US'); // 21:00 KST
});
test('Korean and US home lead with their own major indices',()=>{
 const p=policy();
 assert.deepEqual(p.MAIN.KR.slice(0,3).map(x=>x[0]),['^KS11','^KQ11','k3']);
 assert.equal(p.MAIN.KR[3][0],'k4');
 assert.ok(!p.SECONDARY.KR.some(x=>x[0]==='k4'));
 assert.equal(p.MAIN.KR.filter(x=>x[0]==='k4').length,1);
 assert.deepEqual(p.MAIN.US.slice(0,3).map(x=>x[0]),['^GSPC','^IXIC','^DJI']);
 assert.ok(!p.MAIN.KR.some(x=>x[0]==='TICK'));
});
test('Korean market regime uses two independent index returns',()=>{
 const p=policy();let s=samples(102,101);
 let x=p.marketRegime('KR',s.quotes,s.sources,s.timestamps,now);
 assert.equal(x.status,'observed');
 assert.equal(x.title,'주요 지수 동반 상승');
 assert.match(x.basis,/KOSPI \+2.00%/);
 assert.match(x.basis,/KOSDAQ \+1.00%/);
 assert.ok(x.notes.some(t=>t.includes('VIX 28.52')));
 s=samples(98,99);x=p.marketRegime('KR',s.quotes,s.sources,s.timestamps,now);
 assert.equal(x.title,'주요 지수 동반 하락');
 s=samples(102,99);x=p.marketRegime('KR',s.quotes,s.sources,s.timestamps,now);
 assert.equal(x.title,'주요 지수 혼조·보합');
});
test('US market regime reads S&P and Nasdaq instead of Korean index direction',()=>{
 const p=policy(),s=samples(98,99);
 assert.equal(p.marketRegime('US',s.quotes,s.sources,s.timestamps,now).title,'주요 지수 동반 상승');
});
test('stale or single received index never generates confident market state',()=>{
 const p=policy(),s=samples(102,101,now-3600000);
 assert.equal(p.marketRegime('KR',s.quotes,s.sources,s.timestamps,now).status,'insufficient');
 const t=samples(102,101);delete t.quotes['^KQ11'];
 assert.equal(p.marketRegime('KR',t.quotes,t.sources,t.timestamps,now).status,'insufficient');
 const old=samples(102,101);
 old.quotes['^KS11'].observedAt=now-6*86400000;
 assert.equal(p.marketRegime('KR',old.quotes,old.sources,old.timestamps,now).status,'insufficient');
});
test('unverified or missing quote stays missing, not zero or fabricated',()=>{
 const p=policy();
 assert.equal(p.quote('k4',{}, {}, {},now).valid,false);
 assert.equal(p.quote('^KS11',{'^KS11':{p:100,prev:null}}, {}, {},now).delta,null);
});
test('home removes duplicate six-page menu, exposes region control and segregates assets',()=>{
 assert.ok(homeSource.includes("['AUTO','자동']"));
 assert.ok(homeSource.includes('marketRegime(region,Q,SRC,QT)'));
 assert.match(homeSource,/homev4-assets/);
 assert.match(homeSource,/homev4-main/);
 assert.ok(!homeSource.includes('주도 산업 TOP 3·경제 이벤트'));
 assert.ok(homeSource.includes('if(changed)void legacy.refresh'));
});
test('error banner displays the safe code and whitelisted target without expansion',()=>{
 assert.ok(diagSource.includes('safeTarget(latest[0])'));
 assert.ok(diagSource.includes("' · '+value.code"));
 assert.match(diagSource,/future:k4/);
 assert.ok(diagSource.includes('timeKST(item.at)'));
 assert.match(shellCss,/read-status-compact/);
 assert.ok(!diagSource.includes('JSON.stringify(error)'));
});
