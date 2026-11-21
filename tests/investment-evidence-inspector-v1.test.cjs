'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const evidence=require('../js/market-sector-stock-alignment-v1.js');
const cli=require('../tools/inspect_investment_evidence_v1.cjs');
const binary=path.join(__dirname,'../tools/inspect_investment_evidence_v1.cjs');
const now=Date.parse('2026-11-21T07:05:00+09:00');
function qualified(){
 const at=Date.parse('2026-11-20T16:00:00-05:00');
 const common={source:'Y',asOf:'2026-11-20',phase:'close',
  observedAt:at,receivedAt:now-60000};
 const context=evidence.examine({
  now,market:'US',mode:'swing',
  marketSnapshot:{...common,symbol:'^GSPC',return5Pct:2,
   return20Pct:4,expectedCount:1000,observedCount:850,advancers:610},
  sectors:[{...common,id:'technology',relative5Pct:2,relative20Pct:4,
   volumeRatio:1.4,expectedCount:10,observedCount:8,advancers:6}],
  candidates:[{...common,symbol:'SERV',sectorId:'technology',
   return5Pct:5,relative5Pct:3,relative20Pct:4,priceVsMa20Pct:3,
   volumeRatio:1.7,turnoverRatio:1.4}]
 });
 assert.equal(context.status,'coherent-input');
 return {status:context.status,context,mapping:{
  market:'existing market metrics',sectors:'existing SectorInsights metrics',
  stocks:'existing trading analysis',movingAverage:'existing daily close',
  blockedDayTrading:'intraday unverified'},
  marketSources:{benchmark:'Y',breadth:'N'},
  observationsComparableNotAuthenticated:true,dataVerified:false,
  realTimeVerified:false,tradeApproved:false,canPlaceOrder:false,
  accountAccessed:false,providerCalls:0};
}
function run(data,args=['--stdin','--ack-manual-review','--json']){
 return spawnSync(process.execPath,[binary,...args],{
  input:data,encoding:'utf8',timeout:7000,maxBuffer:500000
 });
}
test('CLI JSON is a complete safe explanation of existing qualified input, not a trading signal',()=>{
 const result=run(JSON.stringify(qualified()));
 assert.equal(result.status,0,result.stderr);
 const doc=JSON.parse(result.stdout);
 assert.equal(doc.status,'review-context-only');
 assert.equal(doc.candidates[0].symbol,'SERV');
 assert.equal(doc.candidates[0].hypotheticalRiskCeilingPct,1.5);
 assert.equal(doc.confidenceScore,null);
 assert.equal(doc.tradeApproved,false);
 assert.equal(doc.canPlaceOrder,false);
 assert.equal(doc.sources.authenticity,'CALLER_DECLARED_ONLY');
});
test('CLI Markdown is textual and labels source uncertainty and manual use',()=>{
 const result=run(JSON.stringify(qualified()),['--stdin','--ack-manual-review','--markdown']);
 assert.equal(result.status,0,result.stderr);
 assert.match(result.stdout,/시장·산업·종목 판단 근거/);
 assert.match(result.stdout,/원천 미인증/);
 assert.match(result.stdout,/수동 검토 전용/);
 assert.equal(result.stdout.includes('token='),false);
});
test('CLI must have explicit manual review acknowledgment',()=>{
 for(const args of [[],['--stdin'],['--stdin','--json'],
  ['--ack-manual-review','--json']]){
  const output=run(JSON.stringify(qualified()),args);
  assert.equal(output.status,2);
  assert.equal(JSON.parse(output.stdout).code,'MANUAL_REVIEW_ACK_REQUIRED');
 }
});
test('CLI rejects invalid JSON without copying credentials or raw parser errors',()=>{
 const raw='{"accountId":"PRIVATE_ACCOUNT_4444",broken';
 const output=run(raw);
 assert.equal(output.status,2);
 assert.equal(JSON.parse(output.stdout).code,'INVALID_JSON');
 assert.equal(output.stdout.includes('PRIVATE_ACCOUNT_4444'),false);
 assert.equal(output.stderr.includes('PRIVATE_ACCOUNT_4444'),false);
});
test('CLI never echoes a secret supplied in an unexpected adapter field',()=>{
 const invalid={...qualified(),bearerToken:'PRIVATE_223344'};
 const output=run(JSON.stringify(invalid));
 assert.equal(output.status,2);
 const doc=JSON.parse(output.stdout);
 assert.equal(doc.code,'INVALID_EXPLANATION_INPUT');
 assert.equal(output.stdout.includes('PRIVATE_223344'),false);
});
test('CLI limits stdin to 128KiB without printing truncated source content',()=>{
 const raw='Q'.repeat(131073)+'PRIVATE-ACCOUNT-SECRET';
 const output=run(raw);
 assert.equal(output.status,2);
 assert.equal(JSON.parse(output.stdout).code,'INPUT_TOO_LARGE');
 assert.equal(output.stdout.includes('PRIVATE-ACCOUNT-SECRET'),false);
 assert.equal(output.stderr.includes('PRIVATE-ACCOUNT-SECRET'),false);
});
test('CLI does not convert blocked adapter into a valid report',()=>{
 const block={status:'blocked',code:'DAY_INTRADAY_EVIDENCE_NOT_CONNECTED',
  details:[],comparison:null,dataVerified:false,realTimeVerified:false,
  tradeApproved:false,canPlaceOrder:false,accountAccessed:false,providerCalls:0};
 const out=run(JSON.stringify(block));
 assert.equal(out.status,2);
 const r=JSON.parse(out.stdout);
 assert.equal(r.status,'blocked');
 assert.equal(r.code,'DAY_INTRADAY_EVIDENCE_NOT_CONNECTED');
 assert.equal(r.tradeApproved,false);
});
test('direct inspect format, malformed data and explicit error handling are deterministic',()=>{
 const data=JSON.stringify(qualified());
 const x=cli.inspect(data,'json'),y=cli.inspect(data,'json');
 assert.equal(x.ok,true);
 assert.deepEqual(x,y);
 assert.equal(cli.inspect(data,'csv').result.code,'INVALID_FORMAT');
 assert.equal(cli.inspect(null,'json').result.code,'INPUT_TOO_LARGE');
});
test('inspector has no network, storage, account read, order or file write API',()=>{
 const source=fs.readFileSync(binary,'utf8');
 for(const token of ['fetch(', 'XMLHttpRequest', 'localStorage.', 'sessionStorage.',
  'PropertiesService','NH_ACCOUNT','placeOrder(', 'executeOrder(', 'writeFile(']){
  assert.equal(source.includes(token),false,token);
 }
});
