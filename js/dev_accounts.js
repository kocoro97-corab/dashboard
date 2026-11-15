/* Opt-in server capabilities. No NH credentials, direct GAS fallback or new API. */
(function(){
  'use strict';
  function enable(){
    const config=window.MYINVEST_TRANSPORT_CONFIG;
    if(config?.devSession!==true||config.accountReads!==true||!LS('invest_session_token'))return;
    for(const id of ['nhAccountBtn','nhAssetFilter']){const el=$(id);if(el){el.disabled=false;el.title='승인된 기존 조회 전용 경로'}}
    for(const action of ['refreshExternalPrices()','showExternalHistory()','applyExternalMatchedCodes()']){const el=document.querySelector('button[onclick="'+action+'"]');if(el){el.disabled=false;el.title='기존 인증·종목 검증 및 저장소 격리 유지'}}
    if(config.externalStore===true){
      document.querySelectorAll('#externalAssetSection input, #externalAssetSection select, #externalAssetSection button').forEach(el=>{if(el.id!=='externalDriveFolder'&&el.getAttribute('onclick')!=='importExternalDriveImages()'){el.disabled=false;el.removeAttribute('title')}});
      const save=$('externalSaveBtn');if(save)showExternalSaveButton();
      if($('externalOcrProgress'))$('externalOcrProgress').textContent='이미지는 기기 안에서 인식합니다. 인식 결과를 검토한 뒤 저장하세요.';
      // Undo remains unavailable only when there is no change to undo.
      extStoreControls();
    }
    const banner=$('devBanner');if(banner)banner.textContent='격리 계좌관리 · '+(config.externalStore?'조회·검토 후 저장·복구 사용':config.externalTestStore?'합성 테스트자료만 저장·복구 허용':'조회 사용 · 현재 연결은 저장 미허용')+' · 주문 없음';
  }
  window.DevelopmentAccounts=Object.freeze({enable});
})();
