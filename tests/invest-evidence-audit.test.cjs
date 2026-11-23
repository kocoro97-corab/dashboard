'use strict';
const assert=require('node:assert/strict');
const A=require('../js/invest-evidence-audit.js');
const now=Date.parse('2026-11-23T11:00:00Z'),nowDay='2026-11-23';
const market={
 schemaVersion:1,status:'descriptive',region:'US',direction:{state:'up'},
 evidence:[
  {symbol:'^GSPC',referenceDay:nowDay,asOf:'2026-11-23T10:53:00.000Z',receivedAt:'2026-11-23T10:56:00.000Z',source:'source1'},
  {symbol:'^IXIC',referenceDay:nowDay,asOf:'2026-11-23T10:53:00.000Z',receivedAt:'2026-11-23T10:56:00.000Z',source:'source2'}
 ]};
const sector={status:'descriptive',market:'US',id:'TECH',asOf:nowDay,source:'verified industry',
 rotation:{status:'descriptive',relative5dPp:2,relative20dPp:3},isProxy:true};
const stock={status:'descriptive',market:'US',symbol:'SERV',asOf:nowDay,
 evidence:{symbol:'SERV',asOf:nowDay,source:'verified issuer bars'}};
const event={status:'ready',coverageVerified:true,events:[{kind:'economic',date:'2026-11-24',type:'CPI',verified:true}]};
const base={market:'US',mode:'swing',nowDay,now,marketData:market,sectorData:sector,stockData:stock,eventData:event};
{
 const r=A.audit(base);
 assert.equal(r.status,'ready');
 assert.equal(r.canPresentAsVerified,true);
 assert.equal(r.coverage.usable,4);
 assert.equal(r.evidence.length,4);
 assert.equal(r.refreshPlan.length,0);
 assert.equal(r.symbol,'SERV');
 assert.equal(r.evidence[0].basis.length,2);
 assert.equal(JSON.stringify(r).includes('accountNumber'),false);
}
{
 const r=A.audit({...base,marketData:{...market,evidence:market.evidence.map(x=>({...x,asOf:'2026-11-23T08:57:00.000Z',receivedAt:'2026-11-23T09:00:00.000Z'}))}});
 assert.equal(r.status,'incomplete');
 assert.equal(r.evidence[0].status,'stale');
 assert.equal(r.refreshPlan[0].component,'market');
 assert.equal(r.refreshPlan[0].allowAutoFetch,false);
}
{
 const r=A.audit({...base,marketData:{...market,evidence:market.evidence.map((x,i)=>({...x,referenceDay:i?'2026-11-20':nowDay}))}});
 assert.equal(r.status,'invalid');
 assert.equal(r.evidence[0].status,'invalid');
 assert.equal(r.refreshPlan[0].component,'market');
}
{
 const r=A.audit({...base,eventData:{status:'partial',coverageVerified:false,events:[event.events[0]]}});
 assert.equal(r.status,'incomplete');
 assert.equal(r.evidence[3].status,'partial');
 assert.equal(r.evidence[3].basis[0].confirmed,1);
 assert.equal(r.refreshPlan[0].component,'event');
}
{
 const r=A.audit({...base,sectorData:null,stockData:null,eventData:null});
 assert.equal(r.status,'incomplete');
 assert.equal(r.coverage.usable,1);
 assert.equal(r.coverage.missing.length,3);
 assert.equal(r.symbol,null);
}
{
 const r=A.audit({...base,stockData:{...stock,asOf:'2026-11-01',evidence:{...stock.evidence,asOf:'2026-11-01'}}});
 assert.equal(r.evidence[2].status,'stale');
 assert.equal(r.canPresentAsVerified,false);
}
{
 const r=A.audit({...base,market:'KR'});
 assert.equal(r.status,'invalid');
 assert.equal(r.coverage.usable,1);
}
{
 const r=A.audit({...base,marketData:{...market,evidence:market.evidence.map(x=>({...x,asOf:null}))}});
 assert.equal(r.status,'incomplete');
 assert.equal(r.evidence[0].status,'missing');
}
{
 const r=A.audit({...base,marketData:{...market,evidence:market.evidence.map(x=>({...x,source:' '}))}});
 assert.equal(r.evidence[0].status,'missing');
}
{
 const r=A.audit({...base,marketData:{...market,evidence:market.evidence.map(x=>({...x,asOf:'2026-11-24T10:53:00Z'}))}});
 assert.equal(r.evidence[0].status,'invalid');
}
{
 const r=A.audit({...base,marketData:{...market,evidence:market.evidence.map(x=>({...x,failed:true}))}});
 assert.equal(r.evidence[0].status,'failed');
}
{
 const r=A.audit({...base,opportunity:{symbol:'SERV',market:'US',asOf:nowDay,reviewLane:'risk-review',blocked:true,requiresEvidence:false,quantity:172,accountNumber:'SECRET_ACCOUNT'}});
 assert.equal(r.queueStatus.lane,'risk-review');
 assert.equal(r.queueStatus.reviewBlocked,true);
 assert.equal(JSON.stringify(r).includes('SECRET_ACCOUNT'),false);
 assert.equal(JSON.stringify(r).includes('"quantity"'),false);
}
{
 const r=A.audit({...base,opportunity:{symbol:'SPCH',market:'US',asOf:nowDay,reviewLane:'risk-review'}});
 assert.equal(r.queueStatus,null);
}
assert.equal(A.date('2026-02-30'),null);
assert.equal(A.date('2026-11-23'),nowDay);
assert.throws(()=>A.audit({...base,nowDay:'2026-02-30'}),/EVIDENCE_INPUT_INVALID/);
assert.throws(()=>A.audit({...base,mode:'not-set'}),/EVIDENCE_INPUT_INVALID/);
assert.throws(()=>A.audit({...base,now:Infinity}),/EVIDENCE_INPUT_INVALID/);
assert.equal(typeof A.refresh,'undefined');
assert.equal(typeof A.placeOrder,'undefined');
console.log('Evidence audit: freshness, source timing, coverage, privacy and refresh planning PASS');
