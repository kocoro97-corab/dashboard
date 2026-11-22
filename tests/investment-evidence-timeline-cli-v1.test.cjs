'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const alignment=require('../js/market-sector-stock-alignment-v1.js');
const cli=require('../tools/inspect_investment_timeline_v1.cjs');
const executable=path.join(__dirname,'../tools/inspect_investment_timeline_v1.cjs');
const NOW=Date.parse('2026-11-23T09:00:00+09:00');
function record(day){
 const observedAt=Date.parse(day+'T16:00:00-05:00');
 const capturedAt=Date.parse(day+'T17:05:00-05:00');
 const metadata={source:'Y',asOf:day,phase:'close',
  observedAt,receivedAt:capturedAt-60000};
 const context=alignment.examine({
  now:capturedAt,market:'US',mode:'swing',
  marketSnapshot:{...metadata,symbol:'^GSPC',return5Pct:2,
   return20Pct:4,expectedCount:1000,observedCount:900,advancers:650},
  sectors:[{...metadata,id:'tech',relative5Pct:3,relative20Pct:4,
   volumeRatio:1.5,expectedCount:50,observedCount:45,advancers:35}],
  candidates:[{...metadata,symbol:'SERV',sectorId:'tech',
   return5Pct:6,relative5Pct:4,relative20Pct:6,priceVsMa20Pct:5,
   volumeRatio:1.8,turnoverRatio:1.5}]
 });
 assert.equal(context.status,'coherent-input');
 return {asOf:day,capturedAt,adapterOutput:{
  status:context.status,context,
  mapping:{market:'preverified',sectors:'preverified',stocks:'preverified',
   movingAverage:'preverified',blockedDayTrading:'unverified'},
  marketSources:{benchmark:'Y',breadth:'N'},
  observationsComparableNotAuthenticated:true,
  dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,
  providerCalls:0
 }};
}
function input(){return JSON.stringify({
 market:'US',mode:'swing',now:NOW,
 records:[record('2026-11-18'),record('2026-11-20')]
});}
const exec=(data,args=['--stdin','--ack-historical-observations','--summary'])=>
 spawnSync(process.execPath,[executable,...args],{
  input:data,encoding:'utf8',timeout:7000,maxBuffer:600000
 });
test('CLI summary compiles historical current adapter output without disclosing tickers',()=>{
 const r=exec(input());
 assert.equal(r.status,0,r.stderr);
 const v=JSON.parse(r.stdout);
 assert.equal(v.status,'compiled');
 assert.equal(v.market,'US');
 assert.equal(v.coverage.observedDays,2);
 assert.equal(v.coverage.comparablePairs,1);
 assert.equal(v.observations[0].marketPosture,'supportive');
 assert.equal(v.classificationChangeCounts['context-unchanged'],1);
 assert.equal(r.stdout.includes('SERV'),false);
 assert.equal(v.pricePerformanceComputed,false);
 assert.equal(v.stored,false);
 assert.equal(v.accountAccessed,false);
 assert.equal(v.orderApproved,false);
});
test('CLI full JSON has sanitized classes only, not original technical source metadata',()=>{
 const r=exec(input(),['--stdin','--ack-historical-observations','--json']);
 assert.equal(r.status,0,r.stderr);
 const v=JSON.parse(r.stdout);
 assert.equal(v.status,'compiled');
 assert.equal(v.snapshots[0].candidates[0].symbol,'SERV');
 assert.equal(v.snapshots[0].candidates[0].posture,'aligned-watch');
 assert.equal(v.marketPriceVerified,false);
 assert.equal(v.actualPricePerformanceComputed,false);
 assert.equal(v.snapshots[0].candidates[0].tradeSignal,undefined);
 assert.equal(r.stdout.includes('"marketSnapshot"'),false);
 assert.equal(r.stdout.includes('"adapterOutput"'),false);
});
test('CLI requires explicit stdin mode, historical acknowledgment and format',()=>{
 for(const args of [[],['--stdin'],['--stdin','--json'],
  ['--ack-historical-observations','--summary']]){
  const r=exec(input(),args);
  assert.equal(r.status,2,JSON.stringify(args));
  assert.equal(JSON.parse(r.stdout).code,'ACK_REQUIRED');
 }
});
test('CLI rejects invalid JSON without echoing private input or parser errors',()=>{
 const data='{"accountNumber":"PRIVATE-100100",broken';
 const r=exec(data);
 assert.equal(r.status,2);
 assert.equal(JSON.parse(r.stdout).code,'INVALID_JSON');
 assert.equal(r.stdout.includes('PRIVATE-100100'),false);
 assert.equal(r.stderr.includes('PRIVATE-100100'),false);
});
test('CLI rejects unexpectedly supplied account information from adapter payload',()=>{
 const data=JSON.parse(input());
 data.records[0].adapterOutput.accountNumber='PRIVATE-ACCOUNT-009';
 const r=exec(JSON.stringify(data));
 assert.equal(r.status,2);
 assert.equal(JSON.parse(r.stdout).code,'INVALID_ARCHIVED_EVIDENCE');
 assert.equal(r.stdout.includes('PRIVATE-ACCOUNT-009'),false);
});
test('CLI rejects large input bodies before parsing or disclosing them',()=>{
 const data='a'.repeat(4*1024*1024+1)+'PRIVATE_TOKEN';
 const r=exec(data);
 assert.equal(r.status,2);
 assert.equal(JSON.parse(r.stdout).code,'INPUT_TOO_LARGE');
 assert.equal(r.stdout.includes('PRIVATE_TOKEN'),false);
 assert.equal(r.stderr.includes('PRIVATE_TOKEN'),false);
});
test('direct summary API is deterministic and only returns aggregate counts',()=>{
 const x=cli.inspect(input(),'summary'),y=cli.inspect(input(),'summary');
 assert.equal(x.ok,true);
 assert.deepEqual(x,y);
 assert.equal(JSON.stringify(x.result).includes('SERV'),false);
 assert.equal(cli.inspect(input(),'csv').result.code,'INVALID_FORMAT');
});
test('CLI does not store generated history or contain broker/network APIs',()=>{
 const source=fs.readFileSync(executable,'utf8');
 for(const token of ['fetch(', 'XMLHttpRequest', 'localStorage.',
  'sessionStorage.', 'PropertiesService', 'NH_ACCOUNT',
  'placeOrder(', 'executeOrder(', 'writeFile(', 'setInterval(']){
  assert.equal(source.includes(token),false,token);
 }
});
