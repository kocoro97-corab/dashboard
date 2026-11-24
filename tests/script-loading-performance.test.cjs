'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const external=fs.readFileSync('js/external_accounts.js','utf8');
const presentation=fs.readFileSync('js/dashboard-presentation.js','utf8');
test('all first-party classic scripts are deferred and retain dependency order',()=>{
 const tags=[...html.matchAll(/<script\b[^>]*\bsrc="(js\/[^"]+)"[^>]*><\/script>/g)];
 assert.ok(tags.length>=60,'expected all dashboard modules');
 for(const tag of tags){
  assert.match(tag[0],/\bdefer\b/,'first-party execution must be deferred: '+tag[1]);
  assert.doesNotMatch(tag[0],/\basync\b/,'first-party execution order must remain: '+tag[1]);
 }
 const required=['js/transport.js','js/auth.js','js/data.js','js/invest-workflow.js',
 'js/exchange-session-proof.js','js/sector-cache-rotation-bridge.js','js/page-sectors.js',
 'js/cached-strategy-bridge.js','js/analysis-integration-panel-v1.js',
 'js/page-strategy.js','js/app-shell.js','js/init.js'];
 const positions=required.map(s=>html.indexOf('src="'+s+'?'));
 assert.ok(positions.every((v,i)=>v>=0&&(i===0||v>positions[i-1])),
  'ordered dependencies must remain unchanged');
});
test('OCR engine is lazy and only requested from user-gated OCR function',()=>{
 assert.doesNotMatch(html,/<script\b[^>]*src="https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js/);
 assert.match(external,/async function ocrImage\(file\)/);
 const start=external.indexOf('async function ocrImage(file)');
 const end=external.indexOf('const localOptions=',start);
 assert.ok(start>=0&&end>start);
 const loader=external.slice(start,end);
 assert.match(loader,/if\(!window\.Tesseract\)/);
 assert.match(loader,/window\.__myInvestOcrLoader/);
 assert.match(loader,/document\.createElement\('script'\)/);
 assert.match(loader,/script\.src='https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@5\.1\.1\/dist\/tesseract\.min\.js'/);
 assert.match(loader,/script\.onerror=/);
 assert.match(loader,/setTimeout\(\(\)=>finish\(new Error\('OCR_LOAD_TIMEOUT'\)\),15000\)/);
 assert.match(external,/async function processExternalUploads\(\)/);
 assert.doesNotMatch(external,/\bsubmitOrder\b|\bplaceOrder\b/);
});
test('initial script markup stays valid and instrument catalog is deferred',()=>{
 const tags=[...html.matchAll(/<script\b[^>]*>/g)].map(m=>m[0]);
 assert.ok(tags.length>=60);
 assert.equal(tags.filter(t=>t.includes('js/init.js')).length,1);
 assert.equal(tags.filter(t=>t.includes('tesseract.min.js')).length,0);
 assert.equal(tags.filter(t=>t.startsWith('<script defer ')).length,tags.length);
 assert.match(presentation,/requestIdleCallback\(loadNames,\{timeout:4000\}\)/);
 assert.match(presentation,/setTimeout\(loadNames,1200\)/);
});
