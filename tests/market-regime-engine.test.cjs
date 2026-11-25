'use strict';
const assert=require('node:assert/strict');
const engine=require('../js/market-regime-engine.js');
const now=Date.parse('2026-11-23T09:00:00+09:00');
function q(value,previous,at='2026-11-23T08:55:00+09:00',rec='2026-11-23T08:57:00+09:00'){
 return {value,previous,observedAt:at,receivedAt:rec,source:'verified-test-feed'};
}
function bars(offset=0,step=0.65){
 const array=[];
 for(let i=0;i<25;i++){
  const d=new Date(Date.UTC(2026,9,30+i,0,0)).toISOString();
  array.push({date:d,close:100+offset+i*step});
 }
 return array;
}
function setup(region='KR'){
 const symbols=engine.MARKET[region].core;
 const obs={};const hist={};
 for(let i=0;i<2;i++){obs[symbols[i]]=q(100+i,98+i);hist[symbols[i]]=bars(i)}
 return {region,observations:obs,histories:hist,now};
}
{
 const a=setup(),r=engine.assess(a);
 assert.equal(r.status,'descriptive');
 assert.equal(r.direction.state,'up');
 assert.equal(r.momentum.state,'strengthening');
 assert.equal(r.execution.day,'context-only');
 assert.equal(r.execution.swing,'context-only');
 assert.equal(r.risk.level,'unknown','VIX missing must not imply low risk');
 assert.equal(r.liquidity.status,'unavailable');
 assert.equal(r.tick.status,'unavailable');
 assert.equal(r.evidence.length,2);
 assert.equal(r.delayed,false);
 assert.equal(r.warnings.some(x=>x.includes('매매 신호')),true);
}
{
 const a=setup();a.observations['^KQ11']=q(98,100);
 const r=engine.assess(a);assert.equal(r.direction.state,'mixed');
}
{
 const a=setup();a.observations['^KS11']=q(95,100);a.observations['^KQ11']=q(94,100);
 const r=engine.assess(a);assert.equal(r.direction.state,'down');
}
{
 const a=setup();delete a.observations['^KQ11'];
 const r=engine.assess(a);
 assert.equal(r.status,'insufficient');
 assert.equal(r.execution.swing,'undetermined');
 assert.equal(r.missing[0].symbol,'^KQ11');
}
{
 const a=setup();
 a.observations['^KS11']=q(100,99,'2026-11-20T15:20:00+09:00');
 const r=engine.assess(a);
 assert.equal(r.status,'insufficient','Friday close + Monday quote is a mismatched reference day');
}
{
 const a=setup();
 a.observations['^KS11']=q(100,99,'2026-11-20T15:20:00+09:00');
 a.observations['^KQ11']=q(100,99,'2026-11-20T15:20:00+09:00');
 const r=engine.assess(a);
 assert.equal(r.status,'descriptive','recent last close of two consistent indexes is usable');
 assert.equal(r.delayed,true);
}
{
 const a=setup();a.observations['^VIX']=q(33,31);
 const r=engine.assess(a);
 assert.equal(r.risk.level,'high');
 assert.equal(r.execution.day,'caution');
 assert.equal(r.execution.swing,'caution');
 assert.equal(r.risk.coverage.vix,true);
}
{
 const a=setup();a.observations['^VIX']=q(13,12);
 a.observations['KRW=X']=q(1430,1400);
 const r=engine.assess(a);assert.equal(r.risk.level,'elevated','FX shock overrides low VIX bucket');
}
{
 const a=setup();a.observations['^VIX']=q(14,15);
 const r=engine.assess({...a,eventRisk:{incomplete:true,hasConfirmedCritical:true}});
 assert.equal(r.risk.reasons.some(x=>x.includes('미연결')),true);
 assert.equal(r.risk.reasons.some(x=>x.includes('고중요도')),true);
 assert.equal(r.risk.level,'reference-low','event schedule does not become an empirical VIX forecast');
}
{
 const a=setup('US');const r=engine.assess(a);
 assert.equal(r.status,'descriptive');assert.equal(r.region,'US');assert.deepEqual(r.evidence.map(x=>x.symbol),['^GSPC','^IXIC']);
}
{
 const a=setup();a.histories['^KS11']=[{date:'2026-11-23',close:100}];
 const r=engine.assess(a);
 assert.equal(r.momentum.state,'unknown');
 assert.equal(r.execution.swing,'undetermined','one-day returns cannot substitute 20-day trend');
}
{
 const a=setup();a.observations['^KS11']=q(100,99,'2026-11-23T08:55:00+09:00','2026-11-23T08:00:00+09:00');
 assert.equal(engine.assess(a).status,'insufficient');
}
{
 const a=setup();a.observations['^KS11']=q(100,99,null);
 assert.equal(engine.assess(a).status,'insufficient');
}
{
 const a=setup();a.observations['^KS11']=q(100,99,'2026-11-25T08:55:00+09:00');
 assert.equal(engine.assess(a).status,'insufficient');
}
{
 const adapted=engine.adaptQuotes({
  '^KS11':{p:2675,prev:2640,at:Date.parse('2026-11-23T08:55:00+09:00'),refreshFailed:false},
  '^KQ11':{p:880,prev:875,at:Date.parse('2026-11-23T08:55:00+09:00')}},
  {'^KS11':'N','^KQ11':'N'},
  {'^KS11':Date.parse('2026-11-23T08:56:00+09:00'),'^KQ11':Date.parse('2026-11-23T08:56:00+09:00')},now);
 assert.equal(engine.assess({region:'KR',observations:adapted,now}).direction.state,'up');
 assert.equal(engine.assess({region:'KR',observations:adapted,now}).momentum.state,'unknown');
}
{
 assert.throws(()=>engine.assess({region:'UNKNOWN'}),/REGIME_INPUT_INVALID/);
 const bad=bars();bad[3]={...bad[3],date:bad[2].date};
 assert.equal(engine.validHistory(bad,now,'Asia/Seoul').ok,false);
}
{
 const a=setup();
 a.observations['^KS11']=q(100,99,'2026-11-20T15:20:00+09:00');
 a.observations['^KQ11']=q(100,99,'2026-11-20T15:20:00+09:00');
 const r=engine.assess(a);
 assert.match(r.direction.label,/최근 확인 종가 기준/);
 assert.equal(r.momentum.state,'unknown','future daily history cannot be paired with prior-day quotes');
}
{
 const dates=bars().map(row=>({...row,date:row.date.slice(0,10)}));
 const result=engine.validHistory(dates,now,'America/New_York');
 assert.equal(result.ok,true);
 assert.equal(result.bars.at(-1).date,'2026-11-23','US date-only session must not shift to prior day');
 const bad=dates.map(x=>({...x}));bad[0].date='2026-99-99';
 assert.equal(engine.validHistory(bad,now,'America/New_York').ok,false);
}
{
 const a=setup();a.observations['^VIX']=q(31,null);
 const r=engine.assess(a);
 assert.equal(r.risk.level,'high','VIX absolute level needs no prior close if observed time is verified');
 assert.equal(r.risk.evidence[0].delta,null);
}
{
 assert.throws(()=>engine.assess({region:'KR',now:1e300}),/REGIME_INPUT_INVALID/);
}
console.log('Market regime engine: 20 scenario groups PASS');
