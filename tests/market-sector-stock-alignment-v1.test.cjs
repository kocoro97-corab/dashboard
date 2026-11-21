'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const alignment=require('../js/market-sector-stock-alignment-v1.js');

const NOW=Date.parse('2026-11-21T07:05:00+09:00');
const CLOSE_US=Date.parse('2026-11-20T16:00:00-05:00');
const CLOSE_KR=Date.parse('2026-11-20T15:30:00+09:00');
function fixture(market='US',mode='swing'){
 const day='2026-11-20',at=market==='US'?CLOSE_US:CLOSE_KR;
 const common={source:'Y',asOf:day,phase:'close',
  observedAt:at,receivedAt:NOW-60000};
 return {
  now:NOW,market,mode,
  marketSnapshot:{...common,symbol:market==='US'?'^GSPC':'^KS11',
   return5Pct:2.5,return20Pct:5,
   expectedCount:1000,observedCount:900,advancers:650},
  sectors:[
   {...common,id:'tech',relative5Pct:2,relative20Pct:4,volumeRatio:1.3,
    expectedCount:100,observedCount:80,advancers:60},
   {...common,id:'energy',relative5Pct:1,relative20Pct:0.5,volumeRatio:1.2,
    expectedCount:80,observedCount:70,advancers:50}
  ],
  candidates:[
   {...common,symbol:market==='US'?'SERV':'005930',sectorId:'tech',
    return5Pct:6,relative5Pct:4,relative20Pct:6,
    priceVsMa20Pct:5,volumeRatio:1.8,turnoverRatio:1.3},
   {...common,symbol:market==='US'?'JOBY':'000660',sectorId:'energy',
    return5Pct:3,relative5Pct:2,relative20Pct:2,
    priceVsMa20Pct:1,volumeRatio:1.25,turnoverRatio:1.2}
  ]
 };
}
const run=(x=fixture())=>alignment.examine(x);
const first=(x=fixture())=>run(x).candidates[0];

test('US market/sector/stock same local close produces labeled watch context, never trade approval',()=>{
 const x=run();
 assert.equal(x.status,'coherent-input');
 assert.equal(x.asOf,'2026-11-20');
 assert.equal(x.benchmark,'^GSPC');
 assert.equal(x.marketContext.posture,'supportive');
 assert.equal(x.sectorContexts[0].posture,'strong');
 assert.equal(x.candidates[0].posture,'aligned-watch');
 assert.equal(x.candidates[0].hypotheticalPolicyRiskCeilingPct,1.5);
 assert.equal(x.candidates[0].riskMultiplierIllustration,1);
 assert.equal(x.marketDataVerified,false);
 assert.equal(x.intradayDataVerified,false);
 assert.equal(x.sourceAuthenticityVerified,false);
 assert.equal(x.tradingRecommendation,false);
 assert.equal(x.automaticOrders,false);
 assert.equal(x.accountsAccessed,false);
 assert.equal(x.providerCalls,0);
 assert.equal(x.candidates[0].tradeSignal,null);
 assert.equal(x.methodology.rankingAllowed,false);
});

test('same symbols and date with KR close produce KRW-only structural context without prices',()=>{
 const x=run(fixture('KR'));
 assert.equal(x.status,'coherent-input');
 assert.equal(x.market,'KR');
 assert.equal(x.benchmark,'^KS11');
 assert.equal(x.candidates[0].symbol,'005930');
 assert.equal(x.candidates[0].posture,'aligned-watch');
 assert.equal(Object.hasOwn(x.candidates[0],'entryPrice'),false);
});

test('KST Saturday US Friday close stays on New York Friday, not mixed with Korean Saturday',()=>{
 assert.equal(alignment.localDay(CLOSE_US,'US'),'2026-11-20');
 assert.equal(alignment.localDay(CLOSE_US,'KR'),'2026-11-21');
 assert.equal(alignment.localDay(CLOSE_KR,'KR'),'2026-11-20');
 assert.equal(run().status,'coherent-input');
});

test('US DST local trading date resolves from America/New_York correctly',()=>{
 const est=Date.parse('2026-11-20T16:00:00-05:00');
 const edt=Date.parse('2026-07-17T16:00:00-04:00');
 assert.equal(alignment.localDay(est,'US'),'2026-11-20');
 assert.equal(alignment.localDay(edt,'US'),'2026-07-17');
 assert.equal(alignment.localDay(edt,'KR'),'2026-07-18');
});

test('market defensive returns cut illustrative swing risk ceiling in half',()=>{
 const x=fixture();x.marketSnapshot.return20Pct=-5;
 const v=run(x);
 assert.equal(v.marketContext.posture,'defensive');
 assert.equal(v.candidates[0].posture,'defensive-watch');
 assert.equal(v.candidates[0].riskMultiplierIllustration,0.5);
 assert.equal(v.candidates[0].hypotheticalPolicyRiskCeilingPct,0.75);
});

test('weak market breadth independently creates defensive market posture',()=>{
 const x=fixture();x.marketSnapshot.advancers=300;
 assert.equal(run(x).marketContext.posture,'defensive');
 assert.equal(first(x).riskMultiplierIllustration,0.5);
});

test('weak sector reduces one candidate risk ceiling but preserves other sector analysis',()=>{
 const x=fixture();x.sectors[0].relative5Pct=-2;x.sectors[0].relative20Pct=-1;
 const r=run(x);
 assert.equal(r.sectorContexts[0].posture,'weak');
 assert.equal(r.candidates[0].posture,'defensive-watch');
 assert.equal(r.candidates[1].posture,'aligned-watch');
 assert.equal(r.candidates[0].hypotheticalPolicyRiskCeilingPct,0.75);
 assert.equal(r.candidates[1].hypotheticalPolicyRiskCeilingPct,1.5);
});

test('weak stock momentum is an observational defensive label, not an executable sell',()=>{
 const x=fixture();x.candidates[0].priceVsMa20Pct=-1;
 const r=first(x);
 assert.equal(r.posture,'defensive-watch');
 assert.equal(r.riskMultiplierIllustration,0.5);
 assert.equal(r.tradeSignal,null);
});

test('mixed market permits no higher than 0.75 illustrative multiplier',()=>{
 const x=fixture();x.marketSnapshot.return5Pct=-0.5;
 const r=first(x);
 assert.equal(r.marketPosture,'mixed');
 assert.equal(r.posture,'mixed-watch');
 assert.equal(r.riskMultiplierIllustration,0.75);
});

test('a mixed sector or stock likewise caps illustrative multiplier at 0.75',()=>{
 const x=fixture();x.sectors[0].volumeRatio=0.8;
 assert.equal(first(x).sectorPosture,'mixed');
 assert.equal(first(x).riskMultiplierIllustration,0.75);
 const y=fixture();y.candidates[0].turnoverRatio=0.8;
 assert.equal(first(y).stockPosture,'mixed');
 assert.equal(first(y).riskMultiplierIllustration,0.75);
});

test('day mode uses distinct 1pct policy ceiling and does not pretend intraday evidence',()=>{
 const x=run(fixture('US','day'));
 assert.equal(x.methodology.baseRiskPct,1);
 assert.equal(x.candidates[0].hypotheticalPolicyRiskCeilingPct,1);
 assert.equal(x.methodology.stockEntryTimingVerified,false);
 assert.equal(x.intradayDataVerified,false);
 assert.equal(x.tradingRecommendation,false);
});

test('missing market breadth coverage blocks all candidate conclusions',()=>{
 const x=fixture();
 x.marketSnapshot.observedCount=500;
 const y=run(x);
 assert.equal(y.status,'blocked');
 assert.equal(y.marketContext.status,'blocked');
 assert.ok(y.marketContext.issues.includes('MARKET_BREADTH_COVERAGE_INSUFFICIENT'));
 assert.equal(y.candidates[0].hypotheticalPolicyRiskCeilingPct,null);
 assert.ok(y.candidates[0].issues.includes('MARKET_EVIDENCE_BLOCKED'));
});

test('invalid count arithmetic is refused, not clipped into believable percentages',()=>{
 const x=fixture();x.marketSnapshot.advancers=901;
 const r=run(x);
 assert.equal(r.marketContext.status,'blocked');
 assert.equal(r.marketContext.breadthPct,null);
});

test('sector sample below 60pct coverage blocks only linked candidates',()=>{
 const x=fixture();x.sectors[0].observedCount=50;
 const r=run(x);
 assert.equal(r.status,'partial');
 assert.equal(r.candidates[0].status,'blocked');
 assert.equal(r.candidates[1].status,'coherent-input');
 assert.ok(r.candidates[0].issues.includes('SECTOR_EVIDENCE_BLOCKED'));
});

test('sector sample below minimum three observations cannot claim leadership',()=>{
 const x=fixture();x.sectors[0].expectedCount=2;x.sectors[0].observedCount=2;
 x.sectors[0].advancers=2;
 assert.equal(first(x).status,'blocked');
});

test('sector not found blocks only its candidate',()=>{
 const x=fixture();x.candidates[0].sectorId='absent';
 const r=run(x);
 assert.equal(r.status,'partial');
 assert.ok(r.candidates[0].issues.includes('SECTOR_NOT_FOUND'));
 assert.equal(r.candidates[1].status,'coherent-input');
});

test('repeated sector identifiers cannot shadow a legitimate sector',()=>{
 const x=fixture();
 x.sectors.push({...x.sectors[0]});
 const r=run(x);
 assert.equal(r.status,'partial');
 assert.ok(r.candidates[0].issues.includes('SECTOR_EVIDENCE_BLOCKED'));
 assert.equal(r.candidates[1].status,'coherent-input');
});

test('repeated stock identifiers block repeated candidate only, never claim separate positions',()=>{
 const x=fixture();x.candidates.push({...x.candidates[0]});
 const r=run(x);
 assert.equal(r.status,'partial');
 assert.equal(r.candidates[0].status,'coherent-input');
 assert.equal(r.candidates[2].status,'blocked');
 assert.ok(r.candidates[2].issues.includes('DUPLICATE_STOCK_ID'));
});

test('unexpected top-level private metadata fails closed without echoing it',()=>{
 const x=fixture();x.accountNumber='PRIVATE-ACC-123';
 const r=run(x);
 assert.equal(r.status,'invalid');
 assert.equal(r.code,'INVALID_OR_PRIVATE_INPUT');
 assert.equal(JSON.stringify(r).includes('PRIVATE-ACC-123'),false);
});

test('unexpected private candidate metadata never appears in output',()=>{
 const x=fixture();
 x.candidates[0].requestUrl='https://broker.example/?token=PRIVATE';
 const r=run(x);
 assert.equal(r.candidates[0].status,'blocked');
 assert.ok(r.candidates[0].issues.includes('INVALID_OR_PRIVATE_RECORD_FIELDS'));
 assert.equal(JSON.stringify(r).includes('token=PRIVATE'),false);
 assert.equal(JSON.stringify(r).includes('broker.example'),false);
});

test('intraday or unknown phase blocks same date snapshot from becoming a close report',()=>{
 const x=fixture();x.marketSnapshot.phase='intraday';
 assert.ok(run(x).marketContext.issues.includes('CLOSE_PHASE_UNCONFIRMED'));
 const y=fixture();y.candidates[0].phase='unknown';
 assert.equal(first(y).status,'blocked');
});

test('missing raw source observation timestamp blocks the corresponding layer',()=>{
 const x=fixture();x.sectors[0].observedAt=null;
 assert.equal(first(x).status,'blocked');
 assert.ok(run(x).sectorContexts[0].issues.includes('OBSERVATION_TIME_MISSING'));
});

test('future source observation blocks even if receipt appears fresh',()=>{
 const x=fixture();x.candidates[0].observedAt=NOW+6*60000;
 assert.ok(first(x).issues.includes('FUTURE_OBSERVATION'));
 assert.equal(first(x).hypotheticalPolicyRiskCeilingPct,null);
});

test('older than 96h observations fail closed despite recently received data',()=>{
 const x=fixture();x.marketSnapshot.observedAt=NOW-97*3600000;
 assert.ok(run(x).marketContext.issues.includes('OBSERVATION_STALE'));
 assert.equal(run(x).status,'blocked');
});

test('last receipt beyond 30min is not evidence of a fresh close',()=>{
 const x=fixture();x.candidates[0].receivedAt=NOW-31*60000;
 assert.equal(first(x).status,'blocked');
 assert.ok(first(x).issues.includes('RECEIPT_STALE'));
});

test('source observation strictly after receipt plus grace is not accepted',()=>{
 const x=fixture();x.candidates[0].observedAt=NOW-10*60000;
 x.candidates[0].receivedAt=NOW-20*60000;
 assert.ok(first(x).issues.includes('OBSERVATION_AFTER_RECEIPT'));
});

test('KST date would mismatch US market local day when blindly reused',()=>{
 const x=fixture();
 x.candidates[0].asOf='2026-11-21';
 assert.ok(first(x).issues.includes('OBSERVATION_LOCAL_DAY_MISMATCH'));
 assert.ok(first(x).issues.includes('TRADE_DATE_MISMATCH'));
});

test('different sector local session dates do not form a valid leader comparison',()=>{
 const x=fixture();x.sectors[0].asOf='2026-11-19';
 x.sectors[0].observedAt=Date.parse('2026-11-19T16:00:00-05:00');
 const r=run(x);
 assert.equal(r.status,'partial');
 assert.ok(r.sectorContexts[0].issues.includes('TRADE_DATE_MISMATCH'));
 assert.ok(r.candidates[0].issues.includes('SECTOR_EVIDENCE_BLOCKED'));
});

test('source identity must be a safe known-format declared identifier (not URL/token)',()=>{
 const x=fixture();x.marketSnapshot.source='https://broker/?token=private';
 assert.ok(run(x).marketContext.issues.includes('SOURCE_UNIDENTIFIED'));
 assert.equal(JSON.stringify(run(x)).includes('private'),false);
});

test('impossible Gregorian date cannot become a fake session date',()=>{
 const x=fixture();x.marketSnapshot.asOf='2026-02-30';
 assert.ok(run(x).marketContext.issues.includes('INVALID_SESSION_DATE'));
});

test('large or invalid collections cannot monopolize browser work',()=>{
 const x=fixture();
 x.candidates=Array.from({length:61},(_,i)=>({...x.candidates[0],
  symbol:'A'+String(i).padStart(2,'0')}));
 assert.equal(run(x).status,'invalid');
 const y=fixture();y.sectors=Array.from({length:26},(_,i)=>({...y.sectors[0],id:'sec'+i}));
 assert.equal(run(y).status,'invalid');
 const z=fixture();z.candidates='not an array';
 assert.equal(run(z).status,'invalid');
});

test('nonfinite percentages and activity ratios block and cannot become zero-filled evidence',()=>{
 const x=fixture();x.candidates[0].relative5Pct=NaN;
 assert.ok(first(x).issues.includes('STOCK_MOMENTUM_INPUT_INVALID'));
 const y=fixture();y.candidates[0].volumeRatio=Infinity;
 assert.ok(first(y).issues.includes('STOCK_ACTIVITY_INVALID'));
 const z=fixture();z.sectors[0].relative20Pct=null;
 assert.ok(run(z).sectorContexts[0].issues.includes('SECTOR_RELATIVE_INVALID'));
});

test('zero volume is allowed but not promoted into strong momentum',()=>{
 const x=fixture();x.candidates[0].volumeRatio=0;
 const r=first(x);
 assert.equal(r.status,'coherent-input');
 assert.equal(r.posture,'mixed-watch');
 assert.equal(r.riskMultiplierIllustration,0.75);
});

test('US ticker and KR six-digit ticker cannot be swapped without identity validation',()=>{
 const us=fixture();us.candidates[0].symbol='005930';
 assert.ok(first(us).issues.includes('STOCK_ID_INVALID'));
 const kr=fixture('KR');kr.candidates[0].symbol='SERV';
 assert.ok(first(kr).issues.includes('STOCK_ID_INVALID'));
});

test('benchmark must be correct for domestic or US market',()=>{
 const x=fixture();x.marketSnapshot.symbol='^KS11';
 assert.ok(run(x).marketContext.issues.includes('BENCHMARK_IDENTITY_MISMATCH'));
});

test('no sector or candidates is insufficient rather than creating fictitious leaders',()=>{
 const x=fixture();x.candidates=[];x.sectors=[];
 const r=run(x);
 assert.equal(r.status,'insufficient');
 assert.equal(r.coverage.stocksSupplied,0);
 assert.equal(r.coverage.stockObservationsCoherent,0);
});

test('all decisions use input only and never mutate original snapshot',()=>{
 const x=fixture();const before=JSON.stringify(x);
 const first=run(x),second=run(x);
 assert.equal(JSON.stringify(x),before);
 assert.deepEqual(first,second);
});

test('outputs contain neither raw prices nor entry/stop/target/trade execution',()=>{
 const x=run();
 const text=JSON.stringify(x);
 for(const forbidden of ['entryPrice','stopPrice','targetPrice','accountNumber','orderId','placeOrder']){
  assert.equal(text.includes(forbidden),false,forbidden);
 }
 assert.equal(x.candidates[0].tradeSignal,null);
});

test('module does not access external providers, app storage, keys or orders',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/market-sector-stock-alignment-v1.js'),'utf8');
 for(const text of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService', 'NH_ACCOUNT', 'placeOrder(', 'executeOrder(', 'setInterval(', 'https://']){
  assert.equal(source.includes(text),false,text);
 }
});
