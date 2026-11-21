'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const report=require('../js/investment-evidence-explanation-v1.js');
const adapter=require('../js/market-sector-stock-adapter-v1.js');
const alignment=require('../js/market-sector-stock-alignment-v1.js');
const strategy=require('../js/work-trading-strategy.js');
const env={window:{}};
vm.runInNewContext(fs.readFileSync(
 path.join(__dirname,'../js/sector-insights.js'),'utf8'),env,{timeout:2500});
const libs={insights:env.window.SectorInsights,alignment};
const NOW=Date.parse('2026-11-21T07:05:00+09:00');
function days(){
 const list=[];let t=Date.parse('2026-11-20T12:00:00Z');
 while(list.length<40){
  const d=new Date(t);
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)list.push(d.toISOString().slice(0,10));
  t-=86400000;
 }
 return list.reverse();
}
const DATES=days();
function observation(market,source='Y'){
 return {source,asOf:'2026-11-20',phase:'close',
  observedAt:Date.parse('2026-11-20'+(market==='US'?'T16:00:00-05:00':'T15:30:00+09:00')),
  receivedAt:NOW-60000};
}
function series(market,rate,volume=200){
 const suffix=market==='US'?'T12:00:00-05:00':'T12:00:00+09:00';
 return {times:DATES.map(date=>Math.floor(Date.parse(date+suffix)/1000)),
  bars:DATES.map((date,index)=>100+index*rate),
  volume:DATES.map((date,index)=>index===39?volume:100)};
}
function technical(s){
 return strategy.analyze({mode:'swing',interval:'1d',capital:10000000,
  riskPct:1,maxAllocationPct:25,lotSize:1,
  bars:s.times.map((t,i)=>({
   t:t*1000,o:s.bars[i]-0.5,h:s.bars[i]+0.6,l:s.bars[i]-1.2,
   c:s.bars[i],volume:s.volume[i],turnover:s.volume[i]*200
  }))
 });
}
function fixture(market='US'){
 const b=series(market,0.15,150),s=series(market,0.45,180),st=series(market,1.2);
 const date=observation(market),members=[1,2,3,4].map(i=>({
  symbol:market==='US'?'STK'+i:String(100000+i),
  change:i===4?-1:i,relative:i===4?-2:i*0.8,
  asOf:date.asOf,observedAt:date.observedAt,source:'N'
 }));
 return {now:NOW,market,mode:'swing',
  benchmark:{symbol:market==='US'?'^GSPC':'^KS11',evidence:{...date},series:b},
  marketBreadth:{universe:market==='US'?'US_LISTED':'KR_LISTED',
   expectedCount:1000,observedCount:800,advancers:600,evidence:observation(market,'N')},
  sectors:[{id:'technology',evidence:{...date},series:s,
   expectedMembers:5,members}],
  stocks:[{symbol:market==='US'?'SERV':'005930',sectorId:'technology',
   evidence:{...date},series:st,technical:technical(st)}]
 };
}
const calculated=x=>adapter.prepare(x,libs);
const explain=x=>report.explain(calculated(x));
const clone=x=>JSON.parse(JSON.stringify(x));

test('reuses current adapter result and existing sector/strategy calculations, never creates recommendation',()=>{
 const input=calculated(fixture()),r=report.explain(input);
 assert.equal(input.status,'coherent-input');
 assert.equal(r.status,'review-context-only');
 assert.equal(r.market,'US');
 assert.equal(r.mode,'swing');
 assert.equal(r.asOf,'2026-11-20');
 assert.equal(r.benchmark,'^GSPC');
 assert.equal(r.sources.benchmark,'Y');
 assert.equal(r.sources.breadth,'N');
 assert.equal(r.sources.authenticity,'CALLER_DECLARED_ONLY');
 assert.equal(r.candidates.length,1);
 assert.equal(r.candidates[0].symbol,'SERV');
 assert.equal(r.candidates[0].sectorId,'technology');
 assert.equal(r.candidates[0].readiness,'manual-context-review');
 assert.equal(r.candidates[0].hypotheticalRiskCeilingPct,1.5);
 assert.equal(r.candidates[0].observation,'aligned-watch');
 assert.deepEqual(r.candidates[0].evidence.map(e=>e.layer),
  ['market','sector','stock']);
 assert.equal(r.rankable,false);
 assert.equal(r.confidenceScore,null);
 assert.equal(r.tradeSignal,null);
 assert.equal(r.tradeApproved,false);
 assert.equal(r.canPlaceOrder,false);
 assert.equal(r.realMarketDataVerified,false);
});
test('Korean six-digit stock and KRX local date are preserved from existing adapter',()=>{
 const r=explain(fixture('KR'));
 assert.equal(r.status,'review-context-only');
 assert.equal(r.market,'KR');
 assert.equal(r.benchmark,'^KS11');
 assert.equal(r.candidates[0].symbol,'005930');
 assert.equal(r.sources.authenticity,'CALLER_DECLARED_ONLY');
 assert.match(r.markdown,/한국/);
});
test('report explains three dimensions in Korean and does not invent entry/stop/target',()=>{
 const r=explain(fixture());
 assert.match(r.markdown,/시장·산업·종목/);
 assert.match(r.markdown,/모멘텀 관찰/);
 assert.match(r.markdown,/정책 위험예산 상한 예시/);
 assert.match(r.markdown,/원천 미인증/);
 assert.equal(/매수 추천|매수하라|매도하라|강력 매수/.test(r.markdown),false);
 for(const word of ['entryPrice','stopPrice','targetPrice','NH_ACCOUNT','token='])
  assert.equal(r.markdown.includes(word),false,word);
});
test('defensive market condition reduces only illustrative risk cap',()=>{
 const x=fixture();x.benchmark.series=series('US',-0.45,150);
 const r=explain(x);
 assert.equal(r.status,'review-context-only');
 assert.equal(r.marketAssessment.title,'방어적 관찰');
 assert.equal(r.candidates[0].observation,'defensive-watch');
 assert.equal(r.candidates[0].hypotheticalRiskCeilingPct,0.75);
 assert.equal(r.canPlaceOrder,false);
});
test('weak industry is described without changing original market headline',()=>{
 const x=fixture();x.sectors[0].series=series('US',-0.4,180);
 const r=explain(x);
 assert.equal(r.status,'review-context-only');
 assert.equal(r.candidates[0].hypotheticalRiskCeilingPct,0.75);
 assert.equal(r.candidates[0].evidence[1].title,'상대약세 관찰');
 assert.equal(r.marketAssessment.title,'우호적 관찰');
});
test('moderate volume stock is explained as mixed even if price rises',()=>{
 const x=fixture();const st=series('US',1.2,108);
 x.stocks[0].series=st;x.stocks[0].technical=technical(st);
 const r=explain(x);
 assert.equal(r.status,'review-context-only');
 assert.equal(r.candidates[0].evidence[2].title,'혼조 관찰');
 assert.equal(r.candidates[0].hypotheticalRiskCeilingPct,1.125);
});
test('missing market-wide breadth returns safe and intelligible explanation, not made-up score',()=>{
 const x=fixture();x.marketBreadth=null;
 const result=explain(x);
 assert.equal(result.status,'blocked');
 assert.equal(result.code,'MARKET_BREADTH_NOT_VERIFIED_STRUCTURALLY');
 assert.match(result.headline,/시장 전체 상승종목/);
 assert.deepEqual(result.candidates,[]);
 assert.equal(result.confidenceScore,null);
});
test('day-trading is explicitly blocked because only close/daily data is connected',()=>{
 const x=fixture();x.mode='day';
 const r=explain(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'DAY_INTRADAY_EVIDENCE_NOT_CONNECTED');
 assert.match(r.headline,/단타용 확정 분봉/);
 assert.equal(r.markdown.includes('1.50%'),false);
});
test('adapter member provenance failure is explained without revealing source raw data',()=>{
 const x=fixture();x.sectors[0].members[0].observedAt=null;
 const r=explain(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'SECTOR_MEMBER_EVIDENCE_INVALID');
 assert.match(r.headline,/구성종목의 출처/);
});
test('broken technical alignment is a blocking cause, not stock-specific advice',()=>{
 const x=fixture();x.stocks[0].technical.volumeRatio+=5;
 const r=explain(x);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'STOCK_TECHNICAL_SNAPSHOT_MISMATCH');
 assert.equal(r.tradeApproved,false);
});
test('blocked adapter reason that is not on allow-list is never echoed',()=>{
 const output=clone(calculated({...fixture(),mode:'day'}));
 output.code='SECRET_REQUEST:https://internal.example/?token=123';
 const result=report.explain(output);
 assert.equal(result.code,'INPUT_QUALITY_UNCERTAIN');
 assert.equal(JSON.stringify(result).includes('SECRET_REQUEST'),false);
 assert.equal(JSON.stringify(result).includes('internal.example'),false);
});
test('private field on blocked adapter result is not echoed',()=>{
 const output=clone(calculated({...fixture(),mode:'day'}));
 output.accountNumber='PRIVATE998877';
 const r=report.explain(output);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'INVALID_EXPLANATION_INPUT');
 assert.equal(JSON.stringify(r).includes('PRIVATE998877'),false);
});
test('private field at successful adapter root is rejected instead of copied into markdown',()=>{
 const input=clone(calculated(fixture()));
 input.accessToken='PRIVATE_TOKEN777';
 const r=report.explain(input);
 assert.equal(r.code,'INVALID_EXPLANATION_INPUT');
 assert.equal(JSON.stringify(r).includes('PRIVATE_TOKEN777'),false);
});
test('extra secret field on sector record is rejected',()=>{
 const x=clone(calculated(fixture()));
 x.context.sectorContexts[0].accountId='MY_ACCOUNT';
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_SECTOR_CONTEXT');
 assert.equal(JSON.stringify(r).includes('MY_ACCOUNT'),false);
});
test('extra secret field on candidate is rejected',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].brokerToken='PRIVATE';
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
 assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
});
test('candidate reward probability field injected by caller is rejected, never displayed',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].winProbability=0.999;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
 assert.equal(r.confidenceScore,null);
});
test('unrecognizable source identity is blocked and never printed in report',()=>{
 const x=clone(calculated(fixture()));
 x.marketSources.benchmark='https://broker/private?token=ABC';
 const r=report.explain(x);
 assert.equal(r.code,'INVALID_EXPLANATION_INPUT');
 assert.equal(JSON.stringify(r).includes('broker/private'),false);
});
test('misreported externally verified market truth must not be trusted',()=>{
 const x=clone(calculated(fixture()));
 x.context.marketDataVerified=true;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_ANALYSIS_CONTEXT');
});
test('misreported order approval is refused even if market data looks positive',()=>{
 const x=clone(calculated(fixture()));
 x.tradeApproved=true;
 const r=report.explain(x);
 assert.equal(r.code,'INVALID_EXPLANATION_INPUT');
 assert.equal(r.canPlaceOrder,false);
});
test('invalid candidate policy risk cap (higher than allowed) is rejected',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].hypotheticalPolicyRiskCeilingPct=12.5;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
 assert.equal(r.candidates.length,0);
});
test('candidate self-contradictory market posture is rejected',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].marketPosture='defensive';
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
});
test('candidate wrong sector posture is rejected',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].sectorPosture='weak';
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
});
test('candidate observation class cannot be arbitrarily upgraded to aligned-watch',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].posture='defensive-watch';
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
});
test('candidate risk multiplier must match all three constituent postures',()=>{
 const x=clone(calculated(fixture()));
 x.context.candidates[0].riskMultiplierIllustration=0.5;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
});
test('faked benchmark identity cannot be used for an economic decision',()=>{
 const x=clone(calculated(fixture()));
 x.context.benchmark='^KS11';
 assert.equal(report.explain(x).code,'INCONSISTENT_ANALYSIS_CONTEXT');
});
test('invalid trading calendar date is not accepted as a local session date',()=>{
 const x=clone(calculated(fixture()));
 x.context.asOf='2026-02-30';
 assert.equal(report.explain(x).code,'INCONSISTENT_ANALYSIS_CONTEXT');
});
test('fabricated market-breadth percent larger than 100 is refused',()=>{
 const x=clone(calculated(fixture()));
 x.context.marketContext.breadthPct=150;
 assert.equal(report.explain(x).code,'INCONSISTENT_ANALYSIS_CONTEXT');
});
test('sector duplicates from a compromised upstream caller are blocked',()=>{
 const x=clone(calculated(fixture()));
 x.context.sectorContexts.push({...x.context.sectorContexts[0]});
 x.context.coverage.sectorsSupplied=2;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_SECTOR_CONTEXT');
});
test('candidate count mismatch with summary coverage blocks the report',()=>{
 const x=clone(calculated(fixture()));
 x.context.coverage.stockObservationsCoherent=2;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_COVERAGE');
});
test('candidate unexpected raw issue URL is not echoed or interpreted as a reason',()=>{
 const x=clone(calculated(fixture()));
 x.status=x.context.status='partial';
 x.context.candidates[0].status='blocked';
 x.context.candidates[0].posture='unavailable';
 x.context.candidates[0].hypotheticalPolicyRiskCeilingPct=null;
 x.context.candidates[0].riskMultiplierIllustration=null;
 x.context.candidates[0].issues=['http://private.example/token'];
 x.context.coverage.stockObservationsCoherent=0;
 const r=report.explain(x);
 assert.equal(r.code,'INCONSISTENT_CANDIDATE_CONTEXT');
 assert.equal(JSON.stringify(r).includes('private.example'),false);
});
test('candidate partial report does not conflate blocked candidate with valid candidate',()=>{
 const f=fixture(),st=series('US',0.9,200);
 f.stocks.push({symbol:'JOBY',sectorId:'technology',evidence:observation('US'),
  series:st,technical:technical(st)});
 const x=clone(calculated(f));
 assert.equal(x.status,'coherent-input');
 x.status=x.context.status='partial';
 const second=x.context.candidates[1];
 second.status='blocked';second.posture='unavailable';second.issues=['STOCK_MOMENTUM_INPUT_INVALID'];
 second.riskMultiplierIllustration=null;
 second.hypotheticalPolicyRiskCeilingPct=null;
 x.context.coverage.stockObservationsCoherent=1;
 const r=report.explain(x);
 assert.equal(r.status,'partial-evidence');
 assert.equal(r.candidates.length,2);
 assert.equal(r.candidates[0].readiness,'manual-context-review');
 assert.equal(r.candidates[1].readiness,'blocked');
 assert.equal(r.candidates[1].hypotheticalRiskCeilingPct,null);
 assert.match(r.markdown,/검증 보류/);
 assert.equal(r.canPlaceOrder,false);
});
test('empty valid context is partial evidence, never a list of inferred leaders',()=>{
 const f=fixture();f.stocks=[];
 const a=calculated(f),r=report.explain(a);
 assert.equal(a.status,'insufficient');
 assert.equal(r.status,'partial-evidence');
 assert.equal(r.candidates.length,0);
 assert.match(r.markdown,/분석 가능한 개별 종목/);
});
test('unapproved source-clock or rankability gate is never promoted to verified',()=>{
 const x=clone(calculated(fixture()));
 x.context.methodology.rankingAllowed=true;
 assert.equal(report.explain(x).code,'INCONSISTENT_ANALYSIS_CONTEXT');
 const y=clone(calculated(fixture()));
 y.context.sourceAuthenticityVerified=true;
 assert.equal(report.explain(y).code,'INCONSISTENT_ANALYSIS_CONTEXT');
});
test('same input is deterministic and never mutated',()=>{
 const a=calculated(fixture()),input=clone(a),prior=JSON.stringify(input);
 const once=report.explain(input),twice=report.explain(input);
 assert.deepEqual(once,twice);
 assert.equal(JSON.stringify(input),prior);
 assert.ok(Object.isFrozen(once));
 assert.ok(Object.isFrozen(once.candidates));
});
test('source contains no HTTP, account, storage, broker, or order methods',()=>{
 const text=fs.readFileSync(path.join(__dirname,'../js/investment-evidence-explanation-v1.js'),'utf8');
 for(const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService', 'NH_ACCOUNT', 'placeOrder(', 'executeOrder(', 'setInterval(']){
  assert.equal(text.includes(forbidden),false,forbidden);
 }
});
