'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const strategy=fs.readFileSync(path.join(root,'js/page-strategy.js'),'utf8');
const scripts=['js/exchange-session-proof.js','js/sector-rotation-adapter.js','js/sector-rotation-engine.js',
 'js/sector-cache-rotation-bridge.js','js/page-sectors.js','js/page-stocks.js',
 'js/market-regime-engine.js','js/stock-setup-adapter.js','js/stock-setup-engine.js',
 'js/integrated-strategy-engine.js','js/integrated-event-adapter.js',
 'js/opportunity-review-queue.js','js/cached-strategy-bridge.js',
 'js/analysis-integration-panel-v1.js','js/page-strategy.js'];
const offsets=scripts.map(s=>html.indexOf('src="'+s+'?'));
assert.equal(offsets.every((n,i)=>n>=0&&(i===0||n>offsets[i-1])),true,
 'Market engine and cached analysis panel must load before strategy page');
assert.equal(strategy.includes('integration.mount(view,currentPublic)'),true,'strategy panel must attach in view');
assert.equal(strategy.includes('readinessPanel?.update()'),true,'panel must follow cached workflow analysis');
assert.equal(strategy.includes('readinessPanel?.destroy?.()'),true,'panel must destroy on route change');
assert.equal(strategy.includes("received:typeof QT!=='undefined'?QT:null"),true,'use existing quote timestamp cache');
assert.equal(strategy.includes("analysis:latestData"),true,'use existing workflow data, never repeat fetch');
assert.equal(strategy.includes('MYInvestEventContext.collect'),true,'reuse only cached public official event context');
assert.equal(strategy.includes('InvestWorkflow.holdings(ctx,s,latestData)'),true,'reuse already validated private holdings transiently');
assert.equal(strategy.slice(strategy.indexOf('const currentPublic=()=>'),strategy.indexOf(' legacy.mount(container,ctx)')).includes('MYInvestEventContext?.refreshAll'),false,'the new evidence bridge must not add calendar refreshes; existing earnings UI refresh remains independent');
const bridge=fs.readFileSync(path.join(root,'js/cached-strategy-bridge.js'),'utf8');
assert.equal(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(bridge),false,
 'integrated bridge cannot fetch or store personal data');
assert.equal(bridge.includes('sectorLink?.verified===true'),true,'sector membership requires independent proof');
const start=strategy.indexOf('// Opt-in evidence panel reads existing quotes');
const end=strategy.indexOf(' legacy.mount(container,ctx)',start);
assert.ok(start>=0&&end>start,'safe integration block present');
const block=strategy.slice(start,end);
assert.equal(/fetch\s*\(|\.ensure\s*\(/.test(block),false,'evidence integration cannot create network requests');
assert.equal(/submitOrder|placeOrder|accountNumber|refreshMarket\s*\(/.test(block),false,
 'integration cannot trigger orders or expose private account data');
const stockPage=fs.readFileSync(path.join(root,'js/page-stocks.js'),'utf8');
const sectors=fs.readFileSync(path.join(root,'js/page-sectors.js'),'utf8');
assert.equal(stockPage.includes('sessionProof=session?.status'),true,'stock reader must keep exchange-session evidence');
assert.equal(sectors.includes('sessionDates:proven?'),true,'sector cache must expose verified exchange trading days');
assert.equal(sectors.includes('strictRotation:')||sectors.includes('asof:benchmark.last,strictRotation'),true,'verified sector rotation must be retained in existing page cache');
assert.equal(sectors.includes('확정 일봉 기반 산업 1·5·20·60일 상대강도 근거'),true,'verified sector evidence disclosure must be visible');
const panel=fs.readFileSync(path.join(root,'js/analysis-integration-panel-v1.js'),'utf8');
assert.equal(/fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/.test(panel),false,
 'panel never reads storage or performs network requests');
console.log('Strategy evidence UI integration: load order, cache-only, unmount and order isolation PASS');
