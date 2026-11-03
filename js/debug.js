/* ===== 진단용: 스크립트 오류를 화면 아래에 표시 ===== */
(function(){
  function show(m){
    var el=document.getElementById('authMsg');if(el)el.textContent=m;
    var b=document.getElementById('errBar');
    if(!b){b=document.createElement('div');b.id='errBar';
      b.style.cssText='position:fixed;left:0;right:0;bottom:0;background:#7f1d1d;color:#fff;font:11px/1.4 system-ui;padding:8px;z-index:9999;white-space:pre-wrap';
      document.body.appendChild(b)}
    b.textContent=m;
  }
  window.addEventListener('error',function(e){show('⚠ 스크립트 오류: '+e.message+(e.lineno?' (줄 '+e.lineno+')':''))});
  window.addEventListener('unhandledrejection',function(e){show('⚠ 비동기 오류: '+(e.reason&&e.reason.message||e.reason))});
  window.addEventListener('load',function(){
    if(typeof handleAuthSubmit!=='function')show('⚠ 로그인 스크립트(auth.js)가 실행되지 않았습니다.');
    else if(typeof fetchTopThemes!=='function')show('⚠ themes.js 등 나머지 스크립트가 없거나 오류가 있습니다.');
  });
})();
