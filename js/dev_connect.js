/* Explicit, temporary HTTPS test connection. No secret in URL or public config. */
(function(){
  'use strict';
  const KEY='myinvest_v2_dev:connection';
  // Only local messages/codes are displayed. Never echo an upstream message,
  // HTML body, exception, entered code, or URL from a failed request.
  const errors=Object.freeze({
    DEV_ACCESS_REQUIRED:'개발 접속코드가 일치하지 않습니다.',
    DEV_PAGE_REQUIRED:'브라우저에서 개발 페이지 출처를 확인할 수 없습니다.',
    DEV_ACCESS_CLOSED:'개발 중계의 사용 시간이 종료되었습니다.',
    DEV_RATE_LIMIT:'요청 제한입니다. 1분 뒤 다시 확인하세요.',
    DEV_LOGIN_RATE_LIMIT:'로그인 요청 제한입니다. 1분 뒤 다시 확인하세요.',
    DEV_BUSY:'개발 중계가 처리 중입니다. 잠시 뒤 확인하세요.',
    DEV_HTTPS_REQUIRED:'HTTPS 중계 경로를 확인하세요.',
    RELAY_ORIGIN_DENIED:'허용된 개발 페이지에서 접속하세요.',
    RELAY_TARGET_MISMATCH:'격리 GAS 식별 확인에 실패했습니다.',
    RELAY_CONFIG_INVALID:'개발 중계 주소 설정을 확인하세요.',
    RELAY_UPSTREAM_NETWORK:'중계에서 GAS에 연결하지 못했습니다.',
    DEV_REJECTED:'개발 중계가 연결을 거부했습니다.',
    DEV_NETWORK:'브라우저에서 중계 응답을 읽지 못했습니다. 중계 실행 상태와 브라우저 통신을 확인하세요.',
    DEV_RESPONSE_NOT_JSON:'중계가 JSON 응답을 반환하지 않았습니다.',
    DEV_RESPONSE_INVALID:'중계 응답 형식을 확인할 수 없습니다.',
    DEV_METADATA_MISMATCH:'승인된 격리 테스트 환경을 확인할 수 없습니다.',
    DEV_STORAGE:'브라우저의 탭 저장소를 사용할 수 없습니다.',
    DEV_UI_ERROR:'개발 연결 화면 처리에 실패했습니다.'
  });
  const known=code=>typeof code==='string'&&Object.prototype.hasOwnProperty.call(errors,code);
  function reject(code){throw Object.assign(new Error(),{devCode:code})}
  function valid(value){
    try{const u=new URL(value);return u.protocol==='https:'&&/^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/api'}catch(e){return false}
  }
  let saved;try{saved=JSON.parse(sessionStorage.getItem(KEY)||'null')}catch(e){}
  const config={mode:'relay',endpoint:'',devSession:true};
  if(saved&&valid(saved.endpoint)&&/^[A-Za-z0-9_-]{16,128}$/.test(saved.code))Object.assign(config,{endpoint:saved.endpoint,devAccessCode:saved.code});
  window.MYINVEST_TRANSPORT_CONFIG=config;
  const panel=document.createElement('div');panel.id='devConnect';
  panel.style.cssText='position:fixed;inset:0;z-index:20000;background:#0f172a;color:#eee;display:grid;place-items:center;padding:16px';
  panel.innerHTML='<form style="width:100%;max-width:430px"><h2>V2 개발용 연결</h2><p>V2 화면·로그인 점검입니다. 실제 NH 조회와 저장은 차단됩니다.</p><label>개발 중계 HTTPS 주소<input id="devEndpoint" type="url" required autocomplete="off" autocapitalize="none" spellcheck="false" style="display:block;width:100%"></label><label>별도 개발 접속코드<input id="devCode" type="password" required autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" style="display:block;width:100%"></label><button id="devConnectSubmit" type="submit">연결 확인</button><p id="devConnectStatus" role="status"></p></form>';
  document.body.appendChild(panel);
  const status=panel.querySelector('#devConnectStatus');
  async function connect(event){
    if(event)event.preventDefault();
    const endpoint=panel.querySelector('#devEndpoint').value.trim(),code=panel.querySelector('#devCode').value;
    if(location.protocol!=='https:'||location.hostname!=='kocoro97-corab.github.io'||!/^\/dashboard-v2-dev\/(?:index.html)?$/.test(location.pathname)||location.search||location.hash||!valid(endpoint)||!/^[A-Za-z0-9_-]{16,128}$/.test(code)){
      status.textContent='개발 페이지 주소·HTTPS 중계 주소·접속코드를 확인하세요.';return;
    }
    if(config.endpoint&&endpoint!==config.endpoint){
      // No old session is ever replayed to a newly selected tunnel.
      for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i);if(k&&k.startsWith('myinvest_v2_dev:'))sessionStorage.removeItem(k)}
    }
    config.endpoint=endpoint;config.devAccessCode=code;
    panel.querySelector('button').disabled=true;status.textContent='격리 환경 확인 중…';
    let stage='network',http=null;
    try{
      const response=await DashboardTransport.post({action:'appVersion'});
      if(Number.isInteger(response.status)&&response.status>=100&&response.status<=599)http=response.status;
      stage='response';let data;
      try{data=await response.json()}catch(e){reject('DEV_RESPONSE_NOT_JSON')}
      if(!data||typeof data!=='object'||Array.isArray(data))reject('DEV_RESPONSE_INVALID');
      if(!response.ok||data.success!==true)reject(known(data.code)?data.code:'DEV_REJECTED');
      if(data.freshTestEnvironment!==true||data.testEnvironment!=='nh-staging'||data.gatewayVersion!==2||data.storeEngine!=='account-store-v2')reject('DEV_METADATA_MISMATCH');
      stage='storage';
      sessionStorage.setItem(KEY,JSON.stringify({endpoint,code}));
      stage='render';
      panel.querySelector('#devCode').value='';panel.remove();
      const banner=document.createElement('div');banner.id='devBanner';banner.setAttribute('role','status');banner.textContent='V2 개발 화면 점검 · 실제 NH 조회 및 저장 차단';
      banner.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#153047;color:#fff;text-align:center;padding:6px;font-size:12px';document.body.appendChild(banner);
    }catch(e){
      const fallback={network:'DEV_NETWORK',response:'DEV_RESPONSE_INVALID',storage:'DEV_STORAGE',render:'DEV_UI_ERROR'}[stage];
      const reason=known(e&&e.devCode)?e.devCode:known(e&&e.code)?e.code:fallback;
      status.textContent=errors[reason]+' ('+reason+(http?' · HTTP '+http:'')+')';
    }
    finally{panel.querySelector('button').disabled=false}
  }
  panel.querySelector('form').addEventListener('submit',connect);
  panel.querySelector('#devEndpoint').value=config.endpoint;
  panel.querySelector('#devCode').value=config.devAccessCode||'';
  // Initialize existing local screens only. Auth/transport and the server-side
  // auth-only allowlist remain unchanged; no automatic account/market requests.
  window.addEventListener('DOMContentLoaded',()=>{
    const register=document.getElementById('authToggleTxt');if(register)register.hidden=true;
    window.initDashboard=()=>window.DevelopmentInspection.init();
  },{once:true});
  // Defer until transport.js exists, and preserve session reload in this tab.
  if(config.endpoint)window.addEventListener('DOMContentLoaded',()=>connect(),{once:true});
})();
