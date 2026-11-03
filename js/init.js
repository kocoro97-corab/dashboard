/* ===== init.js: 초기화 (반드시 마지막에 로드) ===== */
let IV_SET=false;
function initDashboard(){
  embed($('tickq'),'single-quote',{symbol:'USI:TICK',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'});
  const ti=LS('invest_tick');if(ti){$('tin').value=ti;setTick()}
  showQ('^KS11','코스피','',1);fetchTopThemes();renderCards();renderHoldings();clock();refresh();loadNews();
  if(!IV_SET){   // 재로그인 시 타이머 중복 등록 방지
    IV_SET=true;
    setInterval(clock,1000);setInterval(loadNews,300000);setInterval(refresh,60000);
  }
}
