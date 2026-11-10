/* ===== init.js: 초기화 (반드시 마지막에 로드) =====
   자동 갱신 없음: 로그인 직후·페이지 최초 진입 시 1회 불러오고, 이후는 ↻ 버튼으로만 갱신 */
let IV_IDS=[];
function startTimers(){
  stopTimers();   // 재로그인 시 중복 등록 방지
  IV_IDS=[setInterval(clock,1000)];   // 시계 표시만 1초마다 (네트워크 호출 없음)
}
function stopTimers(){IV_IDS.forEach(clearInterval);IV_IDS=[]}

function initDashboard(){
  TS.w='wait';tickStatus();
  embed($('tickq'),'single-quote',{symbol:'USI:TICK',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'},ok=>{TS.w=ok?'ok':'fail';TS.wAt=new Date();tickStatus()});
  const ti=LS('invest_tick');if(ti){$('tin').value=ti;setTick()}
  showQ('^KS11','코스피','',1);fetchTopThemes();renderCards();clock();refresh().then(loadNHAccounts);loadExternalAssets();loadNews();
  startTimers();
}
