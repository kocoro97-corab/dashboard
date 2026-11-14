/* Development-only public market wiring. GAS remains the session authority. */
(function(){
  'use strict';
  let installed=false,activeToken=null,busy=false;
  function enable(){
    const c=window.MYINVEST_TRANSPORT_CONFIG,token=LS('invest_session_token');
    if(!c||c.publicMarket!==true||!token||$('appContainer').style.display!=='block')return;
    if(!installed){
      const read=getTxt;let tail=Promise.resolve(),pending=0;
      // Queue before the existing per-request timeout starts. Reserve the other
      // server slot for authentication; never replay a queued read to a new target.
      getTxt=function(url){
        const tk=LS('invest_session_token'),endpoint=c.endpoint;
        if(pending>=48)return Promise.resolve(null);
        pending++;
        const current=()=>c.publicMarket===true&&tk===LS('invest_session_token')&&endpoint===c.endpoint;
        const job=tail.then(async()=>{if(!current())return null;const value=await read(url);return current()?value:null});
        tail=job.catch(()=>null);
        return job.finally(()=>pending--);
      };
      // Public source adapters are reused. No NH request is attempted, including
      // the existing automatic futures call inside refreshMarket.
      fillNH=async()=>{NH_STATUS='미연결 · 개발 환경의 NH 요청 차단';return{ok:0,fail:0}};
      manualRefresh=refreshPublic;
      installed=true;
    }
    if(activeToken===token)return;
    activeToken=token;
    document.querySelectorAll('#appContainer button[onclick="manualRefresh()"], #mkBtn, button[onclick="refreshScenario()"], button[onclick="copyScenario()"], button[onclick="THM_AT=0;fetchTopThemes()"], #tabs button').forEach(el=>{el.disabled=false;el.removeAttribute('title')});
    renderCards();
    const banner=$('devBanner');if(banner)banner.textContent='공개 시장 데이터 · NH 계좌조회 및 저장 차단';
    $('qi').textContent='공개 차트 수신 대기';
    $('thS').textContent='공개 테마 미조회 · 테마 갱신 버튼으로 조회하세요.';
    $('nst_mk').textContent='공개 뉴스 수신 대기';$('nst_hd').textContent='공개 뉴스 수신 대기';
    refreshPublic();
  }
  async function refreshPublic(){
    if(busy)return;busy=true;
    const token=LS('invest_session_token');
    try{
      await refreshMarket();
      if(token!==LS('invest_session_token'))return;
      document.querySelectorAll('#cards .change').forEach(el=>{
        if(el.textContent.includes('불러오는 중'))el.textContent='시세 미확인 · 원본 수신 상태를 확인하세요.';
      });
      showQ('^KS11','코스피','',1);
      await loadNews();
      if(token!==LS('invest_session_token'))return;
      $('status').textContent='공개 시세·차트·뉴스 조회 · 출처와 수신 상태를 각 영역에서 확인하세요.';
    }finally{busy=false}
  }
  window.DevelopmentMarket=Object.freeze({enable});
})();
