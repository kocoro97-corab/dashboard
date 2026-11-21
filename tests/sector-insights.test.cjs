const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const ctx=vm.createContext({window:{},Date});vm.runInContext(fs.readFileSync('js/sector-insights.js','utf8'),ctx);const api=ctx.window.SectorInsights;
function data(count=85,multiplier=1){const times=Array.from({length:count},(_,i)=>1700000000+i*86400),bars=times.map((_,i)=>100+multiplier*i);return {times,bars,volume:times.map((_,i)=>i===count-1?2000:1000)}}
test('1/5/20/60 returns and relative strength use actual matched dates',()=>{const a=data(),b=data(85,2),r=api.metrics(a,b);for(const n of [1,5,20,60])assert.ok(Math.abs(r.windows[n].change-(184/(184-n)-1)*100)<1e-10);assert.equal(r.volumeChange,100);assert.equal(api.aligned(a,{...b,times:b.times.map(t=>t+86400)},5),null)});
test('fixed constituent sample return averages each member return, never a fabricated industry price',()=>{const a=data(),b=data(85,2),benchmark=data(85,3),m=api.summarize([a,b],benchmark);for(const n of [1,5,20,60]){const expected=(api.metrics(a,benchmark).windows[n].change+api.metrics(b,benchmark).windows[n].change)/2;assert.ok(Math.abs(m.windows[n].change-expected)<1e-10)}assert.equal(api.summarize([a,data(4)],benchmark).windows[60],null)});
test('correlations use paired daily returns and require sufficient nonconstant observations',()=>{const a=data(),same={...a,bars:a.bars.map(v=>v*3)};assert.ok(Math.abs(api.correlation(a,same).value-1)<1e-10);assert.equal(api.correlation(data(5),data(5)),null);assert.equal(api.correlation({...a,bars:a.bars.map(()=>1)},a),null);const shifted={...a,times:a.times.map(t=>t+12*3600)};assert.ok(api.correlation(a,shifted));const empty={...a,times:a.times.map(t=>t+200*86400)};assert.equal(api.correlation(a,empty),null)});

test('theme sample breadth requires enough verified independent constituents before ranking',()=>{
 const rows=[
  {symbol:'AAA',change:3,relative:2},{symbol:'BBB',change:1,relative:-1},
  {symbol:'CCC',change:-1,relative:0.4},{symbol:'DDD',change:0,relative:0},
  {symbol:'AAA',change:20,relative:20},{symbol:'EEE',change:NaN,relative:3}
 ];
 const insufficient=api.sampleBreadth(rows,10);
 assert.equal(insufficient.observed,4);assert.equal(insufficient.expected,10);
 assert.equal(insufficient.coverage,0.4);assert.equal(insufficient.rankable,false);
 const enough=api.sampleBreadth(rows,5);
 assert.equal(enough.observed,4);assert.equal(enough.up,2);assert.equal(enough.down,1);
 assert.equal(enough.flat,1);assert.equal(enough.outperform,2);
 assert.equal(enough.positiveLeaders,1);assert.equal(enough.breadth,50);
 assert.equal(enough.rankable,true);assert.equal(enough.coverage,0.8);
});
test('relative leaders and laggards are not inferred from turnover or arbitrary rank',()=>{
 assert.equal(api.leaderClass({change:2,relative:1}),'기간 상대강세 후보');
 assert.equal(api.leaderClass({change:2,relative:-1}),'상승 · 기준지수 후행');
 assert.equal(api.leaderClass({change:-1,relative:1}),'하락·보합 · 상대방어');
 assert.equal(api.leaderClass({change:-1,relative:-1}),'기간 상대약세 관찰');
 assert.equal(api.leaderClass({change:null,relative:null}),'비교 자료 부족');
 const partial=api.sampleBreadth([{symbol:'AAA',change:3,relative:2}],10);
 assert.equal(partial.rankable,false);
});
