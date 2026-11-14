/* Development-only local OCR assets. Images never leave the browser. */
(function(){
  'use strict';
  const base=new URL('vendor/ocr/',document.baseURI).href;
  const options=Object.freeze({workerPath:base+'worker.min.js',corePath:base,
    langPath:base,workerBlobURL:false,cacheMethod:'none'});
  window.DevelopmentOCR=Object.freeze({
    options,
    enable(){
      if(!window.Tesseract)return;
      ['externalImageFiles','externalUploadBtn'].forEach(id=>{
        const el=document.getElementById(id);if(el){el.disabled=false;el.title='브라우저 안에서만 인식합니다. 저장·Drive 전송은 차단됩니다.'}
      });
      document.getElementById('externalOcrProgress').textContent='이미지 인식 연결 · 기기 안에서 처리 · 검토용 임시 목록만 사용 · 저장·Drive는 차단';
    }
  });
})();
