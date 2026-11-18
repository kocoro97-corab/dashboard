'use strict';
/* Regression coverage for read-only KOSDAQ150 futures transport and V2 presentation.
 * No API keys, network requests, account actions, or orders are executed. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const data=fs.readFileSync(path.join(root,'js/data.js'),'utf8');
const market=fs.readFileSync(path.join(root,'js/market.js'),'utf8');
const page=fs.readFileSync(path.join(root,'js/page-market.js'),'utf8');
const a=market.indexOf('async function fillNH(');
const b=market.indexOf('async function fillFutures(skip)',a);
assert.ok(a>=0&&b>a,'fillNH must exist in market.js');
const extracted=market.slice(a,b);
function simulate(reply,stale=false){
 const run=new Function('reply','stale',`
  const NHF={k3:'A01',k4:'A06'},NQ={},Q={},SRC={},QT={};
  let NH_STATUS='';
  const window={ReadStatus:{note(){}}},rootFutureStatus=()=>{};
  const hms=()=> '10:00:00';
  const nhFetch=async()=>reply;
  if(stale){NQ.k4={p:999};Q.k4={p:999};SRC.k4='H';QT.k4=10}
  ${extracted}
  return fillNH(['k4']).then(out=>({out,q:Q.k4,src:SRC.k4,at:QT.k4,nq:NQ.k4}));
 `);
 return run(reply,stale);
}
test('k4 default is automatic, including migrated saved configurations',()=>{
 assert.match(data,/id:'k4',name:'코스닥150 선물',vis:1/);
 assert.match(market,/else if\(x.id==='k4'\)\{delete x.y;delete x.m/);
});
test('verified NH A06 contract reaches shared V2 quote store',async()=>{
 const r=await simulate({ok:true,data:{k4:{p:1200,prev:1190,code:'A066C000',contractVerified:true,expiry:'2026-12-10'}}});
 assert.equal(r.out.ok,1);assert.equal(r.q.p,1200);assert.equal(r.q.contractCode,'A066C000');assert.equal(r.src,'H');
});
test('a mismatched KOSPI contract must never render as KOSDAQ150',async()=>{
 const r=await simulate({ok:true,data:{k4:{p:1200,prev:1190,code:'A016C000',contractVerified:true}}});
 assert.equal(r.out.ok,0);assert.equal(r.q,undefined);
});
test('NH timeout clears stale quote and source metadata',async()=>{
 const r=await simulate({ok:false,msg:'timeout',code:'NH_TIMEOUT'},true);
 assert.equal(r.out.ok,0);assert.equal(r.q,undefined);assert.equal(r.src,undefined);assert.equal(r.at,undefined);
});
test('external chart is a labeled reference, not an injected quote',()=>{
 assert.match(page,/KRX:KQI1!/);
 assert.match(page,/연속선물/);
 assert.match(page,/대시보드 카드로 자동 전송되지 않습니다/);
});
