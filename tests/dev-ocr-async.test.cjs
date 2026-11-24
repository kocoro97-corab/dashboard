'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/dev_ocr.js','utf8');
function create(){
 let listener,enabled=0;
 const files=Object.fromEntries(['externalImageFiles','externalUploadBtn'].map(x=>[x,{disabled:true,title:''}]));
 const progress={textContent:''};
 const script={addEventListener:(event,fn)=>{assert.equal(event,'load');listener=fn}};
 const root={document:{
  baseURI:'https://example.test/dashboard-v2-dev/',
  querySelector:()=>script,getElementById:id=>id==='externalOcrProgress'?progress:files[id]
 },window:{}};
 vm.runInNewContext(source,root);
 return {root,files,progress,fire:()=>listener()};
}
let x=create();
x.root.window.DevelopmentOCR.enable();
assert.equal(x.files.externalImageFiles.disabled,true,'must wait for actual OCR script load');
assert.equal(x.files.externalUploadBtn.disabled,true);
x.root.window.Tesseract={recognize:()=>{}};
x.fire();
assert.equal(x.files.externalImageFiles.disabled,false);
assert.equal(x.files.externalUploadBtn.disabled,false);
assert.match(x.progress.textContent,/기기 안에서 처리/);
x=create();
x.root.window.Tesseract={recognize:()=>{}};
x.fire();
assert.equal(x.files.externalUploadBtn.disabled,true,'library load before consent does not enable buttons');
x.root.window.DevelopmentOCR.enable();
assert.equal(x.files.externalUploadBtn.disabled,false);
console.log('Async local OCR readiness and user-gated enablement PASS');
