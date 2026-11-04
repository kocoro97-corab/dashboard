/* ===== init.js: 초기화 + 자동 갱신 타이머 (반드시 마지막에 로드) ===== */
let IV_IDS=[];
function startTimers(){
  stopTimers();   // 재로그인 시 중복 등록 방지
  IV_IDS=[setInterval(clock,1000),setInterval(refresh,REFRESH_MS),setInterval(loadNews,REFRESH_MS)];
}
function stopTimers(){IV_IDS.forEach(clearInterval);IV_IDS=[]}

function initDashboard(){
  TS.w='wait';tickStatus();
  embed($('tickq'),'single-quote',{symbol:'USI:TICK',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'},ok=>{TS.w=ok?'ok':'fail';TS.wAt=new Date();tickStatus()});
  const ti=LS('invest_tick');if(ti){$('tin').value=ti;setTick()}
  showQ('^KS11','코스피','',1);fetchTopThemes();renderCards();renderHoldings();clock();refresh();loadNews();
  startTimers();
}
