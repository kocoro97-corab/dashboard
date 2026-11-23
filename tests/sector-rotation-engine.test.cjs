'use strict';
const assert=require('node:assert/strict');
const E=require('../js/sector-rotation-engine.js');
const start=Date.UTC(2026,6,1);
function bars(count=85,{initial=100,step=1,missing=-1,vol=1000,turnover=50000}={}){
 const rows=[];
 for(let i=0;i<count;i++){
  if(i===missing)continue;
  const date=new Date(start+i*86400000).toISOString().slice(0,10);
  rows.push({date,close:initial+i*step,volume:vol,turnover});
 }
 return rows;
}
function sector(id,step=1,extra={}){
 return {id,name:id,market:'US',type:'sector_etf_proxy',currency:'USD',verified:true,source:'Yahoo verified daily',bars:bars(85,{step}),...extra};
}
const benchmark={market:'US',symbol:'SPY',verified:true,source:'Yahoo verified daily',bars:bars(85,{step:0.4})};
const members=[{symbol:'MSFT',name:'MSFT',changePct:2,turnover:1000,sourceVerified:true,source:'verified'},
 {symbol:'NVDA',name:'NVDA',changePct:3,turnover:2000,sourceVerified:true,source:'verified'},
 {symbol:'AAPL',name:'AAPL',changePct:-1,turnover:3000,sourceVerified:true,source:'verified'}];
const sample=sector('XLK',1.2,{members,universeCount:3,turnoverCurrency:'USD'});
const first=E.assess({market:'US',benchmark,candidates:[sample,sector('XLF',0.1)]});
assert.equal(first.status,'descriptive');
assert.equal(first.coverage.analysed,2);
assert.equal(first.rotation[0].id,'XLK');
assert.equal(first.candidates[0].periods['1d'].status,'ready');
assert.equal(first.candidates[0].periods['5d'].status,'ready');
assert.equal(first.candidates[0].periods['20d'].status,'ready');
assert.equal(first.candidates[0].periods['60d'].status,'ready');
assert.ok(first.candidates[0].periods['5d'].relativePp>0);
assert.equal(first.candidates[0].rotation.label,'시장 대비 지속 우위');
assert.equal(first.candidates[0].isProxy,true);
assert.equal(first.candidates[0].breadth.up,2);
assert.equal(first.candidates[0].breadth.down,1);
assert.equal(first.candidates[0].breadth.fullUniverseVerified,true);
assert.equal(first.candidates[0].turnover.value,6000);
assert.equal(first.candidates[0].turnover.currency,'USD');
assert.equal(first.candidates[0].memberRank.status,'sample-only');
assert.equal(first.candidates[0].memberRank.leaders[0].symbol,'NVDA');
const gap=E.assess({market:'US',benchmark,candidates:[sector('GAP',1.0,{bars:bars(85,{step:1,missing:81})})]});
assert.equal(gap.candidates[0].periods['5d'].status,'insufficient');
assert.equal(gap.candidates[0].periods['20d'].status,'insufficient');
assert.equal(gap.candidates[0].rotation.status,'insufficient');
const short=E.assess({market:'US',benchmark,candidates:[sector('SHORT',1,{bars:bars(10,{step:1})})]});
assert.equal(short.candidates[0].periods['5d'].status,'insufficient','recent index dates do not align to old series');
const failed=E.assess({market:'US',benchmark:{...benchmark,verified:false},candidates:[sample]});
assert.equal(failed.status,'insufficient');assert.equal(failed.coverage.benchmark,false);
const tampered=E.assess({market:'US',benchmark,candidates:[{...sample,currency:'KRW'}]});
assert.equal(tampered.candidates[0].status,'unavailable');
const duplicate=E.assess({market:'US',benchmark,candidates:[sample,sample]});
assert.equal(duplicate.candidates[1].status,'unavailable');
const uncertain=E.assess({market:'US',benchmark,candidates:[{...sample,members:[...members,{symbol:'AMZN'}],universeCount:6,turnoverCurrency:'USD'}]});
assert.equal(uncertain.candidates[0].breadth.fullUniverseVerified,false);
assert.equal(uncertain.candidates[0].breadth.coveragePct,75);
assert.equal(uncertain.candidates[0].turnover.status,'partial');
assert.equal(uncertain.candidates[0].turnover.value,6000);
const unknownUnit=E.assess({market:'US',benchmark,candidates:[{...sample,turnoverCurrency:'KRW'}]});
assert.equal(unknownUnit.candidates[0].turnover.status,'unavailable');
assert.equal(E.memberRank([{...members[0]},{...members[1]}]).status,'insufficient');
const badSeries=E.series([{date:'2026-01-01',close:100},{date:'2026-01-01',close:101}]);
assert.equal(badSeries.status,'unavailable');
assert.equal(E.series([{date:'2026-02-30',close:100}]).status,'unavailable');
assert.equal(E.series([{date:'2026-01-01',close:-1}]).status,'unavailable');
assert.equal(E.turnover(members,'USD','USD').value,6000);
assert.throws(()=>E.assess({market:'OTHER',benchmark,candidates:[]}),/SECTOR_INPUT_INVALID/);
const latest=benchmark.bars.at(-1).date;
const staleNow=new Date(Date.parse(latest+'T00:00:00Z')+15*86400000).toISOString().slice(0,10);
const stale=E.assess({market:'US',benchmark,candidates:[sample],nowDay:staleNow});
assert.equal(stale.status,'insufficient','a 15-day-old benchmark is not a current industry trend');
const shortlyAfter=new Date(Date.parse(latest+'T00:00:00Z')+2*86400000).toISOString().slice(0,10);
assert.equal(E.assess({market:'US',benchmark,candidates:[sample],nowDay:shortlyAfter}).status,'descriptive');
assert.equal(E.assess({market:'US',benchmark,candidates:[sample],nowDay:'not-a-date'}).status,'insufficient');
console.log('Sector rotation engine: verified US sample, 1/5/20/60d, failure modes PASS');
