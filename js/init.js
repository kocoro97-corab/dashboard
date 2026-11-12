/* ===== init.js: 초기화 (반드시 마지막에 로드) =====
   자동 갱신 없음: 로그인 직후·페이지 최초 진입 시 1회 불러오고, 이후는 ↻ 버튼으로만 갱신 */
let IV_IDS=[];
function startTimers(){
  stopTimers();   // 재로그인 시 중복 등록 방지
  IV_IDS=[setInterval(clock,1000)];   // 시계 표시만 1초마다 (네트워크 호출 없음)
}
function stopTimers(){IV_IDS.forEach(clearInterval);IV_IDS=[]}

async function initDashboard(){
  const session=LS('invest_session_token');
  await loadProtectedHoldings();
  if(session!==LS('invest_session_token'))return;
  TS.w='wait';tickStatus();
  embed($('tickq'),'single-quote',{symbol:'USI:TICK',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'},ok=>{TS.w=ok?'ok':'fail';TS.wAt=new Date();tickStatus()});
  const ti=LS('invest_tick');if(ti){$('tin').value=ti;setTick()}
  showQ('^KS11','코스피','',1);fetchTopThemes();renderCards();clock();loadNHAccounts();refresh();loadExternalAssets();loadNews();
  startTimers();
}


async function loadProtectedHoldings(){
  const token=LS('invest_session_token');H.splice(0,H.length);
  if(!token)return;
  try{
    const response=await post({action:'protectedHoldings',token});const data=await response.json();
    if(token!==LS('invest_session_token'))return;
    if(!data.success){if($('hd'))$('hd').textContent=SafeDiagnostics.message(data);return}
    const rows=(Array.isArray(data.holdings)?data.holdings:[]).filter(row=>Array.isArray(row)&&row.length===9&&row.slice(0,2).every(v=>typeof v==='string')&&row.slice(2,7).every(v=>typeof v==='number'&&Number.isFinite(v)));
    H.push(...rows);renderHoldings();
  }catch(error){if(token===LS('invest_session_token')&&$('hd'))$('hd').textContent='보유목록을 불러오지 못했습니다.'}
}
