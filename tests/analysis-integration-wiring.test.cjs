'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const strategy=fs.readFileSync(path.join(root,'js/page-strategy.js'),'utf8');
const scripts=['js/market-regime-engine.js','js/analysis-integration-panel-v1.js','js/page-strategy.js'];
const offsets=scripts.map(s=>html.indexOf('src="'+s+'?'));
assert.equal(offsets.every((n,i)=>n>=0&&(i===0||n>offsets[i-1])),true,
 'Market engine and cached analysis panel must load before strategy page');
assert.equal(strategy.includes('integration.mount(view,currentPublic)'),true,'strategy panel must attach in view');
assert.equal(strategy.includes('readinessPanel?.update()'),true,'panel must follow cached workflow analysis');
assert.equal(strategy.includes('readinessPanel?.destroy?.()'),true,'panel must destroy on route change');
assert.equal(strategy.includes("received:typeof QT!=='undefined'?QT:null"),true,'use existing quote timestamp cache');
assert.equal(strategy.includes("analysis:latestData"),true,'use existing workflow data, never repeat fetch');
const start=strategy.indexOf('// Opt-in evidence panel reads existing quotes');
const end=strategy.indexOf(' legacy.mount(container,ctx)',start);
assert.ok(start>=0&&end>start,'safe integration block present');
const block=strategy.slice(start,end);
assert.equal(/fetch\s*\(|\.ensure\s*\(/.test(block),false,'evidence integration cannot create network requests');
assert.equal(/submitOrder|placeOrder|accountNumber|refreshMarket\s*\(/.test(block),false,
 'integration cannot trigger orders or expose private account data');
const panel=fs.readFileSync(path.join(root,'js/analysis-integration-panel-v1.js'),'utf8');
assert.equal(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(panel),false,
 'panel never reads storage or performs network requests');
console.log('Strategy evidence UI integration: load order, cache-only, unmount and order isolation PASS');
