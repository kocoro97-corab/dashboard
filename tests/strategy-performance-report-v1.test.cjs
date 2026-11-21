const {test}=require('node:test');
const assert=require('node:assert/strict');
const report=require('../js/strategy-performance-report-v1.js');
const {simulate}=require('../js/strategy-evaluation-v1.js');
const {inspect}=require('../js/strategy-series-quality-v1.js');

const DAY=86400000,START=Date.UTC(2025,0,2,15),NOW=Date.UTC(2026,10,21,12);
function bars(){
 const a=Array.from({length:150},(_,i)=>({t:START+i*DAY,o:100,h:101,l:99,c:100,v:100}));
 a[20]={...a[20],o:100,h:106,l:100,c:105,v:250};
 a[21]={...a[21],o:107,h:110,l:100,c:100};
 a[22]={...a[22],o:108,h:140,l:106,c:120};
 return a;
}
function dataset(){
 const b=bars();
 return {market:'US',exchange:'NASDAQ',currency:'USD',symbol:'TSLA',
  interval:'1d',sourceProvider:'SyntheticTest',priceConvention:'split_adjusted',
  purpose:'historical',finalized:true,observedAt:b.at(-1).t+3600000,bars:b};
}
function one(id='baseline',config={},overrides={}){
 return {id,label:'고정 규칙 '+id,series:{...dataset(),...overrides},strategy:{...config}};
}
function generate(items){return report.generate({cases:items,now:NOW})}
const reasons=x=>x.cases.map(c=>c.reason);

test('P4 reporting: reproducible risk/return and marked-to-market loss appear without recommending a trade',()=>{
 const out=generate([one()]);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.version,'p4-performance-report-v1');
 const c=out.cases[0];
 assert.equal(c.status,'descriptive_only');
 assert.equal(c.quality.status,'structurally_ready');
 assert.equal(c.metrics.outcomes.trades,1);
 assert.ok(c.metrics.outcomes.totalNetPnl>0);
 assert.ok(c.metrics.outcomes.winRateWilson95.lowPct<30);
 assert.ok(c.metrics.risk.dailyCloseLiquidationMaxDrawdownPct>0);
 assert.equal(c.metrics.risk.riskBudgetOverrunTrades,0);
 assert.ok(c.metrics.costs.feeCost>0);
 assert.ok(c.metrics.costs.fillDistanceSlippageEstimate>0);
 assert.ok(c.metrics.outcomes.meanNetR>0);
 assert.equal(c.metrics.outcomes.meanNetR,c.metrics.outcomes.medianNetR);
 assert.equal(c.evidence.priceSourceVerified,false);
 assert.equal(out.verification.recommendation,false);
 assert.equal(out.verification.noOrderAuthority,true);
 assert.equal(out.comparison.eligible,false);
 assert.equal(out.comparison.reason,'NEED_TWO_SCENARIOS');
});
test('P4 reporting: explicit same-input alternative parameters compare descriptively, never rank a winner',()=>{
 const out=generate([one('low',{riskPct:1}),one('high',{riskPct:2})]);
 assert.equal(out.status,'descriptive_only');
 assert.equal(out.comparison.eligible,true);
 assert.equal(out.comparison.exposureVaries,true);
 assert.equal(out.comparison.observations.length,2);
 assert.deepEqual(out.comparison.observations.map(x=>x.id),['low','high']);
 assert.ok(!('winner' in out.comparison));
 assert.ok(out.comparison.note.includes('시나리오 순위'));
 assert.ok(out.comparison.observations.every(x=>x.sourceVerified===false));
});
test('P4 reporting: different symbol, price bar, currency, capital, fee or holdout blocks comparison',()=>{
 const base=one('base');
 const altered=[
  one('different-symbol',{}, {symbol:'MSFT'}),
  (()=>{const v=one('different-candle');v.series.bars[100].c=100.01;return v})(),
  one('different-currency',{}, {currency:'KRW'}),
  one('different-capital',{initialCapital:20000000}),
  one('different-fees',{feeBps:25}),
  one('different-period',{testStartAt:START+100*DAY})
 ];
 for(const variant of altered){
  const out=generate([base,variant]);
  assert.equal(out.comparison.eligible,false);
  assert.equal(out.comparison.observations.length,0);
 }
});
test('P4 reporting: quality review blocks strategy metrics and whole-table comparison',()=>{
 const s=dataset();s.bars[55].v=null;
 const out=generate([one('good'),{id:'warn',label:'거래량 누락',series:s,strategy:{}}]);
 assert.equal(out.status,'partial_review');
 assert.equal(out.cases[1].status,'review_required');
 assert.equal(out.cases[1].reason,'DATA_QUALITY_REVIEW_REQUIRED');
 assert.equal(out.cases[1].metrics,null);
 assert.equal(out.comparison.reason,'UNREVIEWED_OR_BLOCKED_INPUT');
});
test('P4 reporting: invalid OHLC identity blocks metrics even when second series is valid',()=>{
 const invalid=one('bad');invalid.series.bars[60].l=110;
 const out=generate([one('good'),invalid]);
 assert.equal(out.cases[1].status,'blocked');
 assert.equal(out.cases[1].reason,'DATA_STRUCTURE_BLOCKED');
 assert.equal(out.status,'partial_review');
 assert.equal(out.comparison.eligible,false);
});
test('P4 reporting: zero trade baseline handles null win rate, null profit factor and no divide-by-zero',()=>{
 const v=one();v.series.bars=Array.from({length:150},(_,i)=>({t:START+i*DAY,o:100,h:101,l:99,c:100,v:100}));
 v.series.observedAt=v.series.bars.at(-1).t+3600000;
 const out=generate([v]);
 assert.equal(out.status,'descriptive_only');
 const x=out.cases[0].metrics;
 assert.equal(x.outcomes.trades,0);
 assert.equal(x.outcomes.winRatePct,null);
 assert.equal(x.outcomes.winRateWilson95,null);
 assert.equal(x.outcomes.profitFactor,null);
 assert.equal(x.outcomes.meanNetR,null);
 assert.equal(x.outcomes.medianNetR,null);
 assert.equal(x.outcomes.worstNetR,null);
 assert.equal(x.costs.feeAndFillDistanceSum,0);
});
test('P4 reporting: protects validated bars from a strategy config that tries to override the input',()=>{
 const normal=one('base'),tampered=one('other',{bars:[{t:1,o:1,h:1,l:1,c:1,v:1}],interval:'1m'});
 const a=generate([normal]),b=generate([tampered]);
 assert.equal(b.cases[0].status,'descriptive_only');
 assert.equal(b.cases[0].metrics.outcomes.trades,a.cases[0].metrics.outcomes.trades);
 assert.equal(b.cases[0].metrics.outcomes.totalNetPnl,a.cases[0].metrics.outcomes.totalNetPnl);
});
test('P4 reporting: explicit time, ids, count and suspicious names fail closed',()=>{
 for(const input of [{cases:[],now:NOW},{cases:[one()],now:null},
  {cases:[one(),one()],now:NOW},{cases:[one()],now:1.5},
  {cases:Array.from({length:7},(_,i)=>one(String(i))),now:NOW}]){
  assert.equal(report.generate(input).status,'invalid');
 }
 const bad=generate([{...one('one'),label:'<script>alert(1)</script>'}]);
 assert.equal(bad.cases[0].status,'blocked');
 assert.equal(bad.cases[0].metrics,null);
});
test('P4 reporting: cross-venue/period cost comparison is never a numeric ranking',()=>{
 const alt=one('KR',{},{
  market:'KR',exchange:'KRX',currency:'KRW',symbol:'005930'});
 const x=generate([one('US'),alt]);
 assert.equal(x.comparison.eligible,false);
 assert.equal(x.comparison.reason,'DIFFERENT_INSTRUMENT_HISTORY_PERIOD_OR_COSTS');
});
test('P4 reporting: output is deterministic and inputs remain untouched',()=>{
 const values=[one('low',{targetR:1.5}),one('high',{targetR:2.5})];
 const before=JSON.stringify(values),a=generate(values),b=generate(values);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(values),before);
 assert.equal(report.version,'p4-performance-report-v1');
 assert.ok(a.cases.every(x=>x.evidence.independentHoldoutProven===false));
});
test('P4 reporting: review enforces replay before accepting metrics, no fabricated outcomes',()=>{
 const v=one(),sim=simulate({interval:'1d',bars:v.series.bars});
 const q=inspect({...v.series,now:NOW});
 assert.equal(q.status,'structurally_ready');
 assert.equal(sim.status,'ok');
 const a=generate([v]);
 assert.equal(a.cases[0].metrics.outcomes.totalNetReturnPct,sim.statistics.netReturnPct);
 assert.equal(a.cases[0].metrics.outcomes.totalNetPnl,sim.statistics.netPnl);
});
