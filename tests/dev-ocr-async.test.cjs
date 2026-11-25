'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/dev_ocr.js','utf8');
function create(){
  const scripts=[];
  const files=Object.fromEntries(['externalImageFiles','externalUploadBtn'].map(x=>[x,{disabled:true,title:''}]));
  const progress={textContent:''};
  const document={
    baseURI:'https://example.test/dashboard-v2-dev/',
    head:{appendChild:script=>scripts.push(script)},
    createElement:tag=>{assert.equal(tag,'script');return {async:false,src:'',onload:null,onerror:null}},
    getElementById:id=>id==='externalOcrProgress'?progress:files[id]
  };
  const window={};
  vm.runInNewContext(source,{document,window,URL});
  return {window,scripts,files,progress};
}
test('user consent injects one same-origin OCR script and waits for load',async()=>{
  const x=create();
  assert.equal(x.scripts.length,0,'no network request on signed-out startup');
  assert.equal(await x.window.DevelopmentOCR.ready(),false,'no local OCR without consent');
  assert.equal(x.scripts.length,0);
  x.window.DevelopmentOCR.enable();
  x.window.DevelopmentOCR.enable();
  const ready=x.window.DevelopmentOCR.ready();
  assert.equal(x.scripts.length,1,'concurrent requests must deduplicate');
  assert.equal(x.scripts[0].src,'https://example.test/dashboard-v2-dev/vendor/ocr/tesseract.min.js');
  assert.equal(x.files.externalImageFiles.disabled,true);
  x.window.Tesseract={recognize:()=>{}};
  x.scripts[0].onload();
  assert.equal(await ready,true);
  await new Promise(setImmediate);
  assert.equal(x.files.externalImageFiles.disabled,false);
  assert.equal(x.files.externalUploadBtn.disabled,false);
  assert.match(x.progress.textContent,/기기 안에서 처리/);
});
test('pre-existing engine remains disabled until explicit consent',()=>{
  const x=create();
  x.window.Tesseract={recognize:()=>{}};
  assert.equal(x.files.externalUploadBtn.disabled,true);
  x.window.DevelopmentOCR.enable();
  assert.equal(x.files.externalUploadBtn.disabled,false);
  assert.equal(x.scripts.length,0);
});
test('a failed local OCR import remains disabled and can retry',async()=>{
  const x=create();
  x.window.DevelopmentOCR.enable();
  x.scripts[0].onerror();
  await new Promise(setImmediate);
  assert.equal(x.files.externalUploadBtn.disabled,true);
  assert.match(x.progress.textContent,/불러오지 못했습니다/);
  x.window.DevelopmentOCR.enable();
  assert.equal(x.scripts.length,2);
});
