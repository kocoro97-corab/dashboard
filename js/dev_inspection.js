/* Development artifact only: render existing V2 screens without live data calls. */
(function(){
  'use strict';
  const pending='미검증 · 실제 조회는 별도 승인 후 진행합니다.';
  let manualBound=false;
  const manualFields=['externalManualCode','externalManualName','externalManualQty','externalManualAvg'];
  function text(id,value){const el=document.getElementById(id);if(el)el.textContent=value}
  function row(id,columns,value){
    const el=document.getElementById(id);if(!el)return;
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=columns;td.textContent=value;tr.appendChild(td);el.replaceChildren(tr);
  }
  function disableControls(selector,reason){
    document.querySelectorAll(selector).forEach(el=>{el.disabled=true;el.title=reason});
  }
  function manualPreview(){
    if(!manualBound){
      const showSave=showExternalSaveButton,render=renderExternalAssets,clear=clearAccountState;
      showExternalSaveButton=function(){
        showSave();const button=document.getElementById('externalSaveBtn');
        if(button){button.disabled=true;button.textContent='미리보기 전용 · 저장 차단';button.title='기존 저장 자료는 읽거나 변경하지 않습니다.'}
      };
      renderExternalAssets=function(){
        render();document.getElementById('externalSummaryCards').replaceChildren();
        if(!EXT_ASSETS.length)row('externalAssetRows',9,'임시 목록이 비어 있습니다. 기존 저장 자료는 미조회 상태입니다.');
        text('externalStatus','임시 목록 '+EXT_ASSETS.length+'종목 · 저장·NH 시세 조회 미실행 · 기존 저장 자료 미조회');
      };
      clearAccountState=function(){
        clear();manualFields.forEach(id=>{const el=document.getElementById(id);if(el)el.value=''});
        const images=document.getElementById('externalImageFiles');if(images)images.value='';
        text('externalOcrProgress','');window.EXT_OCR_WARNINGS=[];
        const list=document.getElementById('externalMasterNames');if(list)list.replaceChildren();
      };
      manualBound=true;
    }
    manualFields.concat('externalAccountType').forEach(id=>{
      const el=document.getElementById(id);if(el){el.disabled=false;el.autocomplete='off';el.value=id==='externalAccountType'?'ISA':''}
    });
    const add=document.querySelector('button[onclick="addExternalManual()"]');if(add){add.disabled=false;add.title='현재 탭의 임시 목록에만 추가합니다.'}
    text('externalStatus','수동 등록 미리보기 · 입력은 임시 목록에만 반영됩니다. 저장·NH 시세 조회는 차단됩니다.');
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
    manualPreview();
    if(window.DevelopmentOCR)DevelopmentOCR.enable();
    DevelopmentMarket.enable();
  }
  window.DevelopmentInspection=Object.freeze({init});
})();
