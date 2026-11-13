/* Explicit, temporary HTTPS test connection. No secret in URL or public config. */
(function(){
  'use strict';
  const KEY='myinvest_v2_dev:connection';
  function valid(value){
    try{const u=new URL(value);return u.protocol==='https:'&&/^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname)&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/api'}catch(e){return false}
  }
  let saved;try{saved=JSON.parse(sessionStorage.getItem(KEY)||'null')}catch(e){}
  const config={mode:'relay',endpoint:'',devSession:true};
  if(saved&&valid(saved.endpoint)&&/^[A-Za-z0-9_-]{16,128}$/.test(saved.code))Object.assign(config,{endpoint:saved.endpoint,devAccessCode:saved.code});
  window.MYINVEST_TRANSPORT_CONFIG=config;
  const panel=document.createElement('div');panel.id='devConnect';
  panel.style.cssText='position:fixed;inset:0;z-index:20000;background:#0f172a;color:#eee;display:grid;place-items:center;padding:16px';
  panel.innerHTML='<form style="width:100%;max-width:430px"><h2>V2 개발용 연결</h2><p>로그인·통신 전용 테스트입니다. 계좌조회와 저장은 차단됩니다.</p><label>개발 중계 HTTPS 주소<input id="devEndpoint" type="url" required autocomplete="off" style="display:block;width:100%"></label><label>별도 개발 접속코드<input id="devCode" type="password" required autocomplete="off" style="display:block;width:100%"></label><button id="devConnectSubmit" type="submit">연결 확인</button><p id="devConnectStatus" role="status"></p></form>';
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
    try{
      const response=await DashboardTransport.post({action:'appVersion'}),data=await response.json();
      if(!response.ok||data.success!==true||data.freshTestEnvironment!==true||data.testEnvironment!=='nh-staging'||data.gatewayVersion!==2||data.storeEngine!=='account-store-v2')throw Error();
      sessionStorage.setItem(KEY,JSON.stringify({endpoint,code}));
      panel.querySelector('#devCode').value='';panel.remove();
      const banner=document.createElement('div');banner.id='devBanner';banner.setAttribute('role','status');banner.textContent='개발 로그인·통신 검증 · NH 조회 및 저장 차단';
      banner.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#153047;color:#fff;text-align:center;padding:6px;font-size:12px';document.body.appendChild(banner);
    }catch(e){status.textContent='개발 연결 실패 · 중계 실행 상태와 접속코드를 확인하세요.'}
    finally{panel.querySelector('button').disabled=false}
  }
  panel.querySelector('form').addEventListener('submit',connect);
  panel.querySelector('#devEndpoint').value=config.endpoint;
  panel.querySelector('#devCode').value=config.devAccessCode||'';
  // This exported page validates authentication only. Do not start the normal
  // account/news/market requests (the server also independently blocks them).
  window.addEventListener('DOMContentLoaded',()=>{
    window.initDashboard=()=>{if(typeof clock==='function')clock();if(typeof startTimers==='function')startTimers()};
  },{once:true});
  // Defer until transport.js exists, and preserve session reload in this tab.
  if(config.endpoint)window.addEventListener('DOMContentLoaded',()=>connect(),{once:true});
})();
