/* Opt-in server capabilities. No NH credentials, direct GAS fallback or new API. */
(function(){
  'use strict';
  function enable(){
    const config=window.MYINVEST_TRANSPORT_CONFIG;
    if(config?.devSession!==true||config.accountReads!==true||!LS('invest_session_token'))return;
    for(const id of ['nhAccountBtn','nhAssetFilter']){const el=$(id);if(el){el.disabled=false;el.title='승인된 기존 조회 전용 경로'}}
    for(const action of ['refreshExternalPrices()','showExternalHistory()','applyExternalMatchedCodes()']){const el=document.querySelector('button[onclick="'+action+'"]');if(el){el.disabled=false;el.title='기존 인증·종목 검증 및 저장소 격리 유지'}}
    const banner=$('devBanner');if(banner)banner.textContent='격리 계좌 조회 전용 · '+(config.externalTestStore?'합성 테스트자료만 저장·복구 허용':'저장·복구 차단')+' · 주문 차단';
  }
  window.DevelopmentAccounts=Object.freeze({enable});
})();
