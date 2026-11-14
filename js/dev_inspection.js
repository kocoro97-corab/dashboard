/* Development artifact only: render existing V2 screens without live data calls. */
(function(){
  'use strict';
  const pending='미검증 · 실제 조회는 별도 승인 후 진행합니다.';
  function text(id,value){const el=document.getElementById(id);if(el)el.textContent=value}
  function row(id,columns,value){
    const el=document.getElementById(id);if(!el)return;
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=columns;td.textContent=value;tr.appendChild(td);el.replaceChildren(tr);
  }
  function disableControls(selector,reason){
    document.querySelectorAll(selector).forEach(el=>{el.disabled=true;el.title=reason});
  }
  function init(){
    if(!window.MYINVEST_TRANSPORT_CONFIG||window.MYINVEST_TRANSPORT_CONFIG.devSession!==true||!LS('invest_session_token'))return;
    // Reuse renderers with empty, unqueried state. Never inject sample holdings,
    // zero balances, prices or success flags in place of live results.
    renderCards();renderHoldings();renderNHAccounts();renderExternalAssets();
    clock();startTimers();
    text('status','V2 개발 화면 · 계좌·보유종목·시세 미조회');
    text('mkSt',pending);text('qi',pending);text('qp','—');
    text('nhAccountStatus',pending);
    text('externalStatus','미검증 · 저장 자료를 읽거나 변경하지 않았습니다.');
    text('tickSt',pending);text('gptTime','미검증');text('gv','실시간 자료 미조회 · 분석을 실행하지 않았습니다.');
    text('thS',pending);text('nst_mk',pending);text('nst_hd',pending);
    row('nhAccountRows',10,'미조회 · 계좌나 보유종목이 없다는 뜻이 아닙니다.');
    row('externalAssetRows',9,'미조회 · 기존 저장 자료는 유지됩니다.');
    document.querySelectorAll('#cards .change').forEach(el=>{
      if(el.textContent.includes('불러오는 중'))el.textContent='미검증 · 시세 미조회';
    });
    document.querySelectorAll('#cards [onclick]').forEach(el=>{
      el.removeAttribute('onclick');el.style.cursor='default';el.title=pending;
    });
    disableControls('#appContainer button:not([onclick="openDg()"]):not([onclick="openModal()"]):not(#qm1):not(#qm2), #externalAssetSection input, #externalAssetSection select, #nhAssetFilter, #sessionTimerBox button[onclick="showPasswordChange()"]',pending);
    disableControls('#mo button:not([onclick="closeModal()"]):not(#tKR):not(#tUS)','미검증 · 설정 저장 후 자동 시세 조회를 막기 위해 이 개발 페이지에서 중지했습니다.');
    // Approved test users already exist; registration/administration are outside
    // this relay's unchanged server-side allowlist.
    const admin=document.getElementById('adminBtn');if(admin){admin.hidden=true;admin.style.display='none'}
    loadExternalMaster(); // Public same-origin listing file only; no GAS/NH API.
    DevelopmentMarket.enable();
  }
  window.DevelopmentInspection=Object.freeze({init});
})();
