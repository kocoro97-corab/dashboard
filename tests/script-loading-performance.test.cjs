'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('index.html','utf8');
const external=fs.readFileSync('js/external_accounts.js','utf8');
test('all first party classic scripts are deferred and keep original ordering',()=>{
 const tags=[...html.matchAll(/<script\b[^>]*\bsrc="(js\/[^"]+)"[^>]*><\/script>/g)];
 assert.ok(tags.length>=60,'expected all dashboard modules');
 for(const [,src] of tags){
  const tag=tags.find(x=>x[1]===src)[0];
  assert.match(tag,/\bdefer\b/,'not deferred '+src);
  assert.doesNotMatch(tag,/\basync\b/,'first-party execution must remain ordered '+src);
 }
 const required=['js/transport.js','js/auth.js','js/data.js','js/invest-workflow.js',
 'js/exchange-session-proof.js','js/sector-cache-rotation-bridge.js','js/page-sectors.js',
 'js/cached-strategy-bridge.js','js/analysis-integration-panel-v1.js',
 'js/page-strategy.js','js/app-shell.js','js/init.js'];
 const positions=required.map(s=>html.indexOf('src="'+s+'?'));
 assert.ok(positions.every((v,i)=>v>=0&&(i===0||v>positions[i-1])),
  'ordered dependencies must be unchanged');
});
test('optional OCR CDN is asynchronous and gated on user upload',()=>{
 assert.match(html,/<script async src="https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@5\.1\.1\/dist\/tesseract\.min\.js"><\/script>/);
 assert.match(external,/async function ocrImage\(file\)/);
 assert.match(external,/if\(!window\.Tesseract\)/);
 assert.match(external,/script\.addEventListener\('load',done/);
 assert.match(external,/script\.addEventListener\('error',done/);
 assert.match(external,/setTimeout\(done,8000\)/);
 assert.match(external,/async function processExternalUploads\(\)/);
 assert.doesNotMatch(external,/\bsubmitOrder\b|\bplaceOrder\b/);
});
test('no premature initialization or malformed script markup',()=>{
 const scripts=[...html.matchAll(/<script\b[^>]*>/g)].map(m=>m[0]);
 assert.ok(scripts.length>=70);
 assert.equal(scripts.filter(s=>s.includes('js/init.js')).length,1);
 assert.equal(scripts.filter(s=>s.includes('tesseract.min.js')).length,1);
 assert.equal(scripts.filter(s=>s.startsWith('<script defer ')).length,scripts.length-1);
});
