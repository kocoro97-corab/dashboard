'use strict';
const assert=require('node:assert/strict');
const P=require('../js/web-performance-metrics.js');
let a=P.begin('home','navigation');
assert.equal(typeof a,'number');
assert.equal(P.finish(a,'ready'),true);
let v=P.snapshot();
assert.equal(v.samples.length,1);
assert.equal(v.samples[0].page,'home');
assert.equal(v.samples[0].phase,'navigation');
assert.equal(v.samples[0].result,'ready');
assert.equal(v.memoryOnly,true);
assert.equal(v.networkCalls,0);
assert.equal(v.containsPrivateFields,false);
assert.equal(P.begin('SECRET-ACCOUNT','navigation'),null);
assert.equal(P.begin('accounts','PRIVATE-PAYLOAD'),null);
assert.equal(P.finish(999999,'ready'),false);
for(let i=0;i<80;i++){const t=P.begin('stocks',i%2===0?'navigation':'refresh');assert.equal(P.finish(t,'ready'),true)}
assert.equal(P.snapshot().samples.length,50);
assert.equal(P.snapshot().summary.stocks.count,50);
P.clear();
assert.equal(P.snapshot().samples.length,0);
assert.equal(P.snapshot().summary.stocks,undefined);
const oldSessionToken=P.begin('accounts','navigation');
P.clear();
const newSessionToken=P.begin('home','navigation');
assert.equal(P.finish(oldSessionToken,'ready'),false,
 'old-session response must not complete a new session measurement');
assert.equal(P.finish(newSessionToken,'ready'),true);
assert.equal(P.snapshot().samples[0].page,'home');
P.clear();
assert.equal(typeof P.send,'undefined');
assert.equal(typeof P.fetch,'undefined');
console.log('Memory-only web performance metrics, 50-sample cap, logout purge and privacy PASS');

const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../js/web-performance-metrics.js'),'utf8');
const sandbox={
 module:{exports:{}},
 performance:{
  now:()=>5000,
  getEntriesByType:type=>type==='navigation'?[{domContentLoadedEventEnd:135.2,loadEventEnd:182.7}]:
   type==='paint'?[{name:'first-contentful-paint',startTime:152.4}]:
   type==='resource'?[
    {name:'https://example.test/dashboard-v2-dev/js/app-shell.js?token=SYNTHETIC_SECRET_CANARY'},
    {name:'https://example.test/dashboard-v2-dev/data/us-instruments.json'},
    {name:'https://example.test/dashboard-v2-dev/vendor/ocr/tesseract.min.js'},
    {name:'https://example.test/private?account=SYNTHETIC_ACCOUNT_1234'}
   ]:[]
 }
};
vm.runInNewContext(source,sandbox,{filename:'web-performance-metrics.js'});
const current=sandbox.module.exports.browserSnapshot();
assert.equal(current.navigation.domContentLoadedMs,135);
assert.equal(current.navigation.loadEventMs,183);
assert.equal(current.navigation.firstContentfulPaintMs,152);
assert.equal(current.resourceCounts.total,4);
assert.equal(current.resourceCounts.firstPartyScripts,1);
assert.equal(current.resourceCounts.ocrScripts,1);
assert.equal(current.resourceCounts.usInstrumentCatalog,1);
assert.equal(current.networkCalls,0);
assert.equal(current.memoryOnly,true);
assert.equal(current.containsPrivateFields,false);
assert.doesNotMatch(JSON.stringify(current),/SYNTHETIC_SECRET_CANARY|SYNTHETIC_ACCOUNT_1234|example\.test|token=/);
assert.equal(typeof current.urls,'undefined');
assert.equal(typeof current.resources,'undefined');
// Interruption-heavy mobile sessions must not appear fast just because
// cancelled navigation is omitted from the normal-completion median.
let tick=5000;
sandbox.performance.now=()=>tick;
const slow=sandbox.module.exports.begin('sectors','navigation');
tick+=111827;
assert.equal(sandbox.module.exports.finish(slow,'cancelled'),true);
const bad=sandbox.module.exports.begin('news','navigation');
tick+=1400;
assert.equal(sandbox.module.exports.finish(bad,'failed'),true);
const interrupted=sandbox.module.exports.snapshot();
assert.equal(interrupted.summary.sectors.count,0);
assert.equal(interrupted.summary.sectors.medianMs,null);
assert.equal(interrupted.summary.sectors.cancelledCount,1);
assert.equal(interrupted.summary.sectors.cancelledMaxMs,111827);
assert.equal(interrupted.summary.news.failedCount,1);
assert.equal(interrupted.summary.news.maxMs,null);
assert.equal(interrupted.containsPrivateFields,false);
sandbox.module.exports.clear();
assert.equal(sandbox.module.exports.snapshot().summary.sectors,undefined);
const noPerformance={module:{exports:{}}};
vm.runInNewContext(source,noPerformance);
const empty=noPerformance.module.exports.browserSnapshot();
assert.equal(empty.navigation.domContentLoadedMs,null);
assert.equal(empty.resourceTimingAvailable,false);
console.log('Anonymous resource-count and browser-load diagnostics PASS');
