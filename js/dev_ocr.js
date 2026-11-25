/* Development-only, user-gated same-origin OCR. Images never leave this browser. */
(function(){
  'use strict';
  const base=new URL('vendor/ocr/',document.baseURI).href;
  const options=Object.freeze({workerPath:base+'worker.min.js',corePath:base,
    langPath:base,workerBlobURL:false,cacheMethod:'none'});
  let requested=false,loading=null;
  function enableControls(){
    if(!requested||!window.Tesseract)return false;
    ['externalImageFiles','externalUploadBtn'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){el.disabled=false;el.title='브라우저 안에서만 인식합니다. 저장·Drive 전송은 차단됩니다.'}
    });
    const progress=document.getElementById('externalOcrProgress');
    if(progress)progress.textContent='이미지 인식 연결 · 기기 안에서 처리 · 검토용 임시 목록만 사용 · 저장·Drive는 차단';
    return true;
  }
  function loadOnce(){
    if(enableControls())return Promise.resolve(true);
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.async=true;
      script.src=base+'tesseract.min.js';
      script.onload=()=>window.Tesseract?resolve(true):reject(Error('OCR_ENGINE_UNAVAILABLE'));
      script.onerror=()=>reject(Error('OCR_LIBRARY_LOAD_FAILED'));
      document.head.appendChild(script);
    }).then(()=>{
      enableControls();return true;
    }).catch(()=>{
      loading=null;
      const progress=document.getElementById('externalOcrProgress');
      if(progress)progress.textContent='기기 내 OCR 라이브러리를 불러오지 못했습니다. 다시 연결을 시도하세요.';
      return false;
    });
    return loading;
  }
  window.DevelopmentOCR=Object.freeze({
    options,
    enable(){requested=true;void loadOnce()},
    // An upload may be started before the local script finishes loading.
    // Never authorize the import before the explicit development consent.
    ready(){return requested?loadOnce():Promise.resolve(false)}
  });
})();
