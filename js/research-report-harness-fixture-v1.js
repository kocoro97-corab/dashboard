/* Demo-only, synthetic illustration. Not part of live dashboard, accounts or feeds. */
(function(root){
'use strict';
const DATE=['2026-11-18','2026-11-19','2026-11-20'];
const NOW=Date.parse('2026-11-23T12:00:00+09:00');
const MAP={
 market:'synthetic sample',sectors:'synthetic sample',
 stocks:'synthetic sample',movingAverage:'synthetic sample',
 blockedDayTrading:'intraday not provided'
};
function record(day,market,i){
 const us=market==='US';
 const observedAt=Date.parse(day+(us?'T16:00:00-05:00':'T15:30:00+09:00'));
 const capturedAt=Date.parse(day+(us?'T17:05:00-05:00':'T16:05:00+09:00'));
 const base={source:'DEMO',asOf:day,phase:'close',observedAt,receivedAt:capturedAt-60000};
 const morning=i===0?{return5Pct:-1,return20Pct:-5,advancers:300}:
  i===1?{return5Pct:0.5,return20Pct:0,advancers:490}:
  {return5Pct:2,return20Pct:5,advancers:650};
 const result=root.MYInvestMarketSectorStockAlignmentV1.examine({
  now:capturedAt,market,mode:'swing',
  marketSnapshot:{...base,symbol:us?'^GSPC':'^KS11',
   return5Pct:morning.return5Pct,return20Pct:morning.return20Pct,
   expectedCount:1000,observedCount:900,advancers:morning.advancers},
  sectors:[
   {...base,id:'technology',relative5Pct:2,relative20Pct:3,
    volumeRatio:1.5,expectedCount:10,observedCount:9,advancers:7},
   {...base,id:'energy',relative5Pct:-1,relative20Pct:-2,
    volumeRatio:0.9,expectedCount:8,observedCount:7,advancers:3}
  ],
  candidates:[
   {...base,symbol:us?'SERV':'005930',sectorId:'technology',
    return5Pct:6,relative5Pct:4,relative20Pct:6,
    priceVsMa20Pct:5,volumeRatio:1.7,turnoverRatio:1.4},
   {...base,symbol:us?'JOBY':'000660',sectorId:'energy',
    return5Pct:2,relative5Pct:1,relative20Pct:1,
    priceVsMa20Pct:2,volumeRatio:1.2,turnoverRatio:1.2}
  ]
 });
 if(result.status!=='coherent-input')throw Error('SYNTHETIC_FIXTURE_NOT_QUALIFIED');
 return {
  asOf:day,capturedAt,
  adapterOutput:{
   status:result.status,context:result,mapping:{...MAP},
   marketSources:{benchmark:'DEMO',breadth:'DEMO'},
   observationsComparableNotAuthenticated:true,
   dataVerified:false,realTimeVerified:false,tradeApproved:false,
   canPlaceOrder:false,accountAccessed:false,providerCalls:0
  }
 };
}
function fixture(market){
 const region=market==='BLOCKED'?'US':market;
 const records=DATE.map((d,i)=>record(d,region,i));
 if(market==='BLOCKED'){
  records[2].adapterOutput={
   status:'blocked',code:'SECTOR_SAMPLE_INSUFFICIENT',
   details:[{index:0}],comparison:null,dataVerified:false,
   realTimeVerified:false,tradeApproved:false,canPlaceOrder:false,
   accountAccessed:false,providerCalls:0
  };
 }
 return {now:NOW,market:region,mode:'swing',records};
}
root.MYInvestResearchHarnessFixtureV1=Object.freeze({fixture});
})(typeof window!=='undefined'?window:globalThis);
