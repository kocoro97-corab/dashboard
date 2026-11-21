'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const inspector=require('../tools/inspect_market_session_context_v1.cjs');
const tool=path.join(__dirname,'../tools/inspect_market_session_context_v1.cjs');
const run=at=>spawnSync(process.execPath,[tool,'--at',at],{encoding:'utf8',timeout:5000});

test('offline inspector returns US premarket at 21:00 KST, without claiming real-time open',()=>{
 const r=inspector.inspect('2026-11-20T21:00:00+09:00');
 assert.equal(r.ok,true);
 assert.equal(r.homeFocus,'US');
 assert.deepEqual(r.homeDisplayOrder,['US','KR']);
 assert.equal(r.marketWindows.US.window,'before-regular-window');
 assert.equal(r.marketWindows.US.summerWinterOpenKst,'23:30');
 assert.equal(r.marketOpenVerified,false);
 assert.equal(r.marketWindows.US.exchangeOpenVerified,false);
});
test('offline inspector distinguishes KR regular vs selected equities afterhours',()=>{
 const before=inspector.inspect('2026-11-20T10:00:00+09:00');
 const after=inspector.inspect('2026-11-20T17:00:00+09:00');
 assert.equal(before.marketWindows.KR.window,'regular-clock-window');
 assert.equal(after.marketWindows.KR.window,'eligible-equities-afterhours-window');
 assert.equal(after.homeFocus,'KR');
});
test('CLI with explicit KST offset emits valid, credential-free JSON',()=>{
 const child=run('2026-03-09T22:30:00+09:00');
 assert.equal(child.status,0,child.stderr);
 const parsed=JSON.parse(child.stdout);
 assert.equal(parsed.marketWindows.US.window,'regular-clock-window');
 assert.equal(parsed.marketWindows.US.summerWinterOpenKst,'22:30');
 assert.equal(parsed.marketOpenVerified,false);
 assert.equal(child.stdout.includes('NH_ACCOUNT'),false);
});
test('CLI rejects ambiguous timestamps without offset or unstructured dates',()=>{
 for(const raw of ['2026-11-20T22:00:00','2026-11-20','not-a-date']){
  const child=run(raw);
  assert.equal(child.status,2,raw);
  const r=JSON.parse(child.stdout);
  assert.equal(r.ok,false);
  assert.equal(r.code,'ABSOLUTE_ISO_TIME_REQUIRED');
 }
});
test('CLI rejects missing arguments instead of silently using Date.now',()=>{
 const child=spawnSync(process.execPath,[tool],{encoding:'utf8',timeout:5000});
 assert.equal(child.status,2);
 assert.equal(JSON.parse(child.stdout).code,'USE_NODE_SCRIPT_WITH_EXPLICIT_AT');
});
