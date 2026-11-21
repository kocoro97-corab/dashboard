'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const command=path.join(__dirname,'../tools/inspect_strategy_risk_v1.cjs');
function base(){
 return {mode:'day',market:'KR',currency:'KRW',
  now:Date.parse('2026-11-20T10:30:00+09:00'),
  capital:10000000,cashAvailable:3000000,usedExposure:0,usedOpenRisk:0,
  entry:50000,stop:47000,target:60000,
  riskPct:1,allocationPct:20,feeBps:10,slippageBps:20,
  stressGapPct:5,lotSize:1};
}
const exec=(data,flags=['--stdin','--ack-hypothetical'])=>spawnSync(
 process.execPath,[command,...flags],{input:data,encoding:'utf8',timeout:8000,maxBuffer:128000}
);
test('CLI reads a local synthetic hypothetical scenario and never approves an order',()=>{
 const res=exec(JSON.stringify(base()));
 assert.equal(res.status,0,res.stderr);
 const output=JSON.parse(res.stdout);
 assert.equal(output.status,'hypothetical');
 assert.equal(output.market,'KR');
 assert.equal(output.currency,'KRW');
 assert.ok(output.scenario.quantity>0);
 assert.equal(output.canPlaceOrder,false);
 assert.equal(output.executionAllowed,false);
 assert.equal(output.marketTruthVerified,false);
 assert.equal(output.providerCalls,0);
});
test('CLI requires explicit acknowledgement and stdin flag',()=>{
 for(const flags of [[],['--stdin'],['--ack-hypothetical']]){
  const res=exec(JSON.stringify(base()),flags);
  assert.equal(res.status,2,JSON.stringify(flags));
  assert.equal(JSON.parse(res.stdout).code,'EXPLICIT_HYPOTHETICAL_CONFIRMATION_REQUIRED');
 }
});
test('invalid JSON receives safe error code without echoing the original body',()=>{
 const value='{"accountNumber":"PRIVATE1234", invalid';
 const res=exec(value);
 assert.equal(res.status,2);
 assert.equal(JSON.parse(res.stdout).code,'INVALID_JSON');
 assert.equal(res.stdout.includes('PRIVATE1234'),false);
});
test('over 64KiB input is rejected without logging the raw contents',()=>{
 const content='p'.repeat(65537)+'SECRET_ACCOUNT';
 const res=exec(content);
 assert.equal(res.status,2);
 assert.equal(JSON.parse(res.stdout).code,'INPUT_TOO_LARGE');
 assert.equal(res.stdout.includes('SECRET_ACCOUNT'),false);
 assert.equal(res.stderr.includes('SECRET_ACCOUNT'),false);
});
test('unexpected private JSON fields are rejected without details leaked',()=>{
 const input={...base(),accountNumber:'SENSITIVE-001'};
 const res=exec(JSON.stringify(input));
 assert.equal(res.status,2);
 const output=JSON.parse(res.stdout);
 assert.equal(output.code,'INVALID_OR_PRIVATE_FIELDS');
 assert.equal(res.stdout.includes('SENSITIVE-001'),false);
});
test('both explicitly zero and nonzero fee assumptions are accepted as simulation inputs',()=>{
 for(const feeBps of [0,15]){
  const value={...base(),feeBps,slippageBps:0,stressGapPct:0};
  const res=exec(JSON.stringify(value));
  assert.equal(res.status,0);
  const out=JSON.parse(res.stdout);
  assert.equal(out.policy.feeBps,feeBps);
  assert.equal(out.canPlaceOrder,false);
 }
});
test('local console inspector never interprets a market snapshot as a broker login',()=>{
 const input={...base(),quotes:{},sources:{},receivedAt:{}};
 const res=exec(JSON.stringify(input));
 assert.equal(res.status,0);
 const output=JSON.parse(res.stdout);
 assert.equal(output.marketContext.gateStatus,'blocked');
 assert.equal(output.holdingsAccessed,false);
 assert.equal(output.providerCalls,0);
});
