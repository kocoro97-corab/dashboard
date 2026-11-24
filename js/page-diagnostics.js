/* Development verification center. Reading the overview never calls any API. */
(function(root){
'use strict';
if(!root.DevelopmentDiagnostics||!AppRouter.routes.includes('diagnostics'))return;
const {node,button}=DashboardPages,hub=root.DevelopmentDiagnostics;
const labels={NOT_VISITED:'미점검',mounted:'화면 열기 중',ready:'화면 연결 확인',error:'화면 처리 오류',NOT_RUN:'실행 전',NOT_CONNECTED:'결과 수집 미연결',RUNNING:'실행 중',BLOCKED:'실행 불가',CANCELLED:'취소됨',PASS:'성공 · 브라우저 관측',PARTIAL:'일부 성공',FAIL:'실행 오류'};
function checkHint(row){switch(row.status){case 'NOT_CONNECTED':return '이 통합표의 검사 결과 수집이 아직 연결되지 않았습니다.';case 'NOT_RUN':return '아래 수동 연결 검사에서 조회 버튼을 눌러 실행하세요.';case 'RUNNING':return row.phase==='CAPABILITY'?'중계 연결 조건 확인 중':'자료 요청·수신 중';case 'BLOCKED':return '실행을 시도했으나 중계 연결 조건이 충족되지 않았습니다.';case 'CANCELLED':return '완료 전에 화면 이동·닫기 등으로 취소되었습니다. 다시 실행할 수 있습니다.';case 'FAIL':return '실행했으나 요청 또는 자료 검증에 실패했습니다. 오류 코드를 확인하세요.';case 'PASS':return '수신·검증 완료'+(row.bars?' · '+row.bars+'개 봉':'')+' · 실시간 여부 미검증';case 'PARTIAL':return '자료 일부를 확인했습니다. 수동 검사 패널의 누락·주의 내용을 확인하세요.';default:return '상태 확인 필요'}}
const sessionStates={VERIFIED:'인증 확인',VERIFYING:'인증 확인 중',RESTORING:'기존 세션 복원 중',RETRYING:'연결 재확인 중',ENDED:'종료',SIGNED_OUT:'로그아웃',PASSWORD_CHANGE_REQUIRED:'비밀번호 변경 필요'};
function sessionEvidence(){const s=root.DevelopmentSession?.getStatus()||{};return {mode:'BROWSER_OBSERVED_SESSION_METADATA',clientInactivityMs:s.inactivityMs===3600000?3600000:null,serverPolicyIdleMs:[300000,3600000].includes(s.serverPolicyIdleMs)?s.serverPolicyIdleMs:null,serverIdleMs:[300000,3600000].includes(s.serverIdleMs)?s.serverIdleMs:null,state:Object.hasOwn(sessionStates,s.state)?s.state:'UNKNOWN',code:['SESSION_REJECTED','SESSION_VERIFY_UNAVAILABLE','SESSION_IDLE_EXPIRED','SESSION_TRANSPORT_UNAVAILABLE','SESSION_RESPONSE_UNCONFIRMED','SESSION_RESTORE_UNAVAILABLE'].includes(s.code)?s.code:null,http:Number.isInteger(s.http)&&s.http>=100&&s.http<=599?s.http:null,independentTransportVerification:false}}
const layer={browser:'브라우저',relay:'중계',gas:'GAS',nh:'NH',storage:'저장',unknown:'구간 미확인'};
const time=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'미확인';
const table=headers=>{const t=node('table'),head=node('tr');for(const h of headers)head.append(node('th',h));t.append(head);return t};
DashboardPages.register('diagnostics',()=>{
 let view,summary,issues,coverage,checks,copyText,copyStatus,sessionStatus,performanceHost,performanceDetails,probe=null,active=false,filter='all',pageFilter='all';
 function draw(){if(!active)return;const data=hub.snapshot(),fail=data.issues.filter(r=>r.active).length,unvisited=data.pages.filter(r=>r.status==='NOT_VISITED').length;
  const session=sessionEvidence();if(sessionStatus)sessionStatus.textContent='세션: 화면 활동 기준 60분 · 서버 정책 '+(session?.serverPolicyIdleMs?session.serverPolicyIdleMs/60000+'분':'미확인')+' · 현재 인증 세션 '+(session?.serverIdleMs?session.serverIdleMs/60000+'분':'미확인')+' · 서버 응답 '+(sessionStates[session.state]||'미확인')+(session?.code?' · '+session.code:'');
  summary.replaceChildren();for(const [title,value] of [['수집 오류',fail],['해결 기록',data.issues.length-fail],['미점검 메뉴',unvisited],['실행 전 검사',data.checks.filter(r=>r.status==='NOT_RUN').length],['실행 중 검사',data.checks.filter(r=>r.status==='RUNNING').length],['검사 오류',data.checks.filter(r=>r.status==='FAIL').length]]){const card=node('div');card.append(node('small',title),node('strong',String(value)));summary.append(card)}
  const rows=data.issues.filter(r=>(filter==='all'||(filter==='active'?r.active:!r.active))&&(pageFilter==='all'||r.page===pageFilter));issues.replaceChildren();
  if(!rows.length)issues.append(node('p','해당 범위에 수집된 오류가 없습니다. 미점검 항목은 정상 판정을 하지 않습니다.','dv-muted'));
  else{const t=table(['메뉴·상태','오류 코드','발생 구간·HTTP','최근 관측']);for(const row of rows.slice().reverse()){const tr=node('tr');tr.dataset.diagnosticCode=row.code;tr.append(node('td',(DevelopmentDiagnosticLabels[row.page]||'공통')+' · '+(row.active?'발생 기록':'후속 요청으로 해결')),node('td',row.code+(row.context?' · '+row.context:'')+(row.count>1?' · '+row.count+'건':'')),node('td',(row.source==='read'?(row.scope==='account'?'계좌 읽기 · ':'공개 읽기 · '):'')+layer[row.layer]+(row.http?' · '+row.http:'')),node('td',time(row.at)));t.append(tr)}issues.append(t)}
  coverage.replaceChildren();const pages=table(['메뉴','화면 연결','수집 오류','이동']);for(const row of data.pages){const tr=node('tr'),go=node('td'),link=node('a',row.label+' 열기');link.href='#/'+row.page;go.append(link);tr.append(node('td',row.label),node('td',labels[row.status]),node('td',String(data.issues.filter(r=>r.page===row.page&&r.active).length)),go);pages.append(tr)}coverage.append(pages);
  checks.replaceChildren();const t=table(['검사','현재 세션 결과','최근 상태 시각']);for(const row of data.checks){const tr=node('tr'),state=node('td');tr.dataset.checkId=row.id;tr.dataset.checkState=row.status;state.append(node('strong',labels[row.status]||'상태 미확인'),node('p',checkHint(row),'dv-muted'));if(row.code)state.append(node('small',row.code+(row.http?' · HTTP '+row.http:'')));tr.append(node('td',row.label),state,node('td',time(row.at)));t.append(tr)}checks.append(t,node('p','실행 전은 버튼을 누르기 전이며 자동 실행 대기가 아닙니다. 결과 수집 미연결은 이 표의 수집 기능을 뜻하며 기존 기능의 성공·실패 판정이 아닙니다. 현재 로그인에서 관측한 결과만 표시하며 페이지 새로고침·재로그인 시 초기화됩니다.','dv-muted'));
 }
 const DevelopmentDiagnosticLabels={home:'홈',market:'글로벌 시장',sectors:'산업·테마',stocks:'종목 분석',strategy:'투자 전략',news:'뉴스·이벤트',accounts:'내 계좌관리',settings:'설정',diagnostics:'검증·진단',shared:'공통'};
 async function copy(){const meter=root.MYInvestWebPerformance;const text=JSON.stringify({...hub.snapshot(),session:sessionEvidence(),performance:{browser:meter?.browserSnapshot?.(),routes:meter?.snapshot?.()}});try{await navigator.clipboard.writeText(text);if(active)copyStatus.textContent='인증정보·계좌자료를 제외한 검증 결과를 복사했습니다.'}catch{if(active){copyText.value=text;copyText.hidden=false;copyText.select();copyStatus.textContent='아래 결과를 선택해 복사하세요.'}}}
 function renderPerformance(){
  if(!performanceHost)return;
  const meter=root.MYInvestWebPerformance,local=meter?.browserSnapshot?.(),routes=meter?.snapshot?.();
  performanceHost.replaceChildren();
  if(!local){performanceHost.append(node('p','이 브라우저에서 성능 측정을 사용할 수 없습니다.','dv-muted'));return}
  const fmt=v=>Number.isFinite(v)?v+' ms':'미측정';
  const info=table(['측정 항목','현재 브라우저']);
  for(const [name,value] of [
   ['문서 DOM 준비',fmt(local.navigation.domContentLoadedMs)],
   ['문서 load 이벤트',fmt(local.navigation.loadEventMs)],
   ['첫 콘텐츠 표시',fmt(local.navigation.firstContentfulPaintMs)],
   ['관측된 전체 리소스',String(local.resourceCounts.total)+'건'],
   ['JavaScript 요청',String(local.resourceCounts.firstPartyScripts)+'건'],
   ['OCR 라이브러리 요청',String(local.resourceCounts.ocrScripts)+'건'],
   ['미국 종목 디렉터리 요청',String(local.resourceCounts.usInstrumentCatalog)+'건']]){
    const tr=node('tr');tr.append(node('td',name),node('td',value));info.append(tr)
  }
  performanceHost.append(node('p','이 기기의 현재 문서에서 브라우저가 관측한 시간과 요청 수입니다. 요청 URL·계좌·인증정보는 수집하거나 표시하지 않습니다. 새로고침·캐시·통신 환경에 따라 값이 달라집니다.','dv-muted'),info);
  const summary=routes?.summary||{},order=['home','market','sectors','stocks','strategy','news','accounts','settings','diagnostics'];
  const selected=order.filter(name=>summary[name]?.count);
  const routeTable=table(['메뉴','측정 횟수','중앙값','최대']);
  for(const name of selected){const row=summary[name],tr=node('tr');tr.append(node('td',DevelopmentDiagnosticLabels[name]||name),node('td',String(row.count)),node('td',fmt(row.medianMs)),node('td',fmt(row.maxMs)));routeTable.append(tr)}
  performanceHost.append(node('h3','메뉴 전환·새로고침 처리시간'),selected.length?routeTable:node('p','아직 측정된 메뉴가 없습니다. 다른 메뉴로 이동한 후 다시 열어보세요.','dv-muted'),node('p','실측값은 완료된 화면 처리에 한정됩니다. 전체 네트워크 지연이나 실제 투자 데이터의 최신성을 보증하지 않습니다.','dv-muted'))
 }
 function mount(container){active=true;view=node('section',null,'dv-center');const style=node('style');style.textContent='.dv-center{min-width:0;color:inherit}.dv-center p{font-size:12px;color:#b6c5d9}.dv-center h2{font-size:18px;margin:12px 0}.dv-center h3{font-size:15px;margin:12px 0 8px}.dv-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,140px),1fr));gap:8px}.dv-summary>div{padding:10px;background:#172238;border:1px solid #344158;border-radius:8px}.dv-summary strong{display:block;font-size:22px}.dv-center table{width:100%;min-width:0;table-layout:fixed;border-collapse:collapse;font-size:12px}.dv-center td,.dv-center th{padding:7px;border-bottom:1px solid #344158;text-align:left;white-space:normal;overflow-wrap:anywhere}.dv-center button,.dv-center select{min-height:40px;padding:7px 10px;border:1px solid #52637c;border-radius:7px;background:#172238;color:#fff}.dv-actions{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.dv-center a{color:#9bc8ff}.dv-center textarea{width:100%;box-sizing:border-box;min-height:100px}.dv-center details{margin:12px 0}.dv-center summary{cursor:pointer;min-height:35px;font-weight:700}';
  view.append(style,node('h2','개발 검증·진단'),node('p','현재 로그인에서 수집한 오류와 연결 검사를 통합합니다. 전체 API를 자동 실행하지 않으며 최근 100개 진단 항목을 유지합니다.'));
  summary=node('div',null,'dv-summary');issues=node('div',null,'dv-issues');coverage=node('div');checks=node('div');copyText=node('textarea');copyText.readOnly=true;copyText.hidden=true;copyText.setAttribute('aria-label','통합 검증 결과');copyStatus=node('p');copyStatus.setAttribute('role','status');
  const actions=node('div',null,'dv-actions'),select=node('select');select.setAttribute('aria-label','오류 상태 필터');for(const [value,text] of [['all','전체 기록'],['active','발생 오류'],['resolved','해결 기록']]){const option=node('option',text);option.value=value;select.append(option)}select.value=filter;select.addEventListener('change',()=>{filter=select.value;draw()});
  const pageSelect=node('select');pageSelect.setAttribute('aria-label','오류 메뉴 필터');for(const [value,text] of [['all','전체 메뉴'],...Object.entries(DevelopmentDiagnosticLabels)]){const option=node('option',text);option.value=value;pageSelect.append(option)}pageSelect.value=pageFilter;pageSelect.addEventListener('change',()=>{pageFilter=pageSelect.value;draw()});
  actions.append(select,pageSelect,button('상태 새로고침',draw),button('전체 결과 복사',copy));view.append(summary,actions,copyStatus,copyText,issues);
  performanceDetails=node('details');performanceDetails.id='devBrowserPerformance';performanceDetails.append(node('summary','현재 PC·휴대폰 브라우저 속도 측정'));
  performanceHost=node('div');performanceHost.id='devBrowserPerformanceResults';
  const reloadPerformance=button('현재 브라우저 측정값 새로고침',renderPerformance);
  performanceDetails.append(reloadPerformance,performanceHost);
  performanceDetails.addEventListener('toggle',()=>{if(performanceDetails.open)renderPerformance()});
  view.append(performanceDetails);
  const overview=node('details'),overviewTitle=node('summary','메뉴별 화면 연결·미점검 현황');overview.append(overviewTitle,coverage);view.append(overview,node('h3','기능별 실제 연결 검사'),checks);
  sessionStatus=node('p');sessionStatus.dataset.sessionPolicyStatus='true';view.append(sessionStatus);
  const config=root.MYINVEST_TRANSPORT_CONFIG||{},session=root.DevelopmentSession?.getStatus();view.append(node('p','설정 범위: 공개 시세 '+(config.publicMarket?'허용':'미활성')+' · 계좌 조회 '+(config.accountReads?'허용':'미활성')+' · 저장 '+(config.externalStore?'허용':'미활성')+' · 개발 세션 '+(session?.inactivityMs===3600000?'1시간 설정':'설정 확인 필요')+' (실제 조회·저장 성공 판정 아님)'));
  const probeHost=node('div');view.append(node('h3','수동 연결 검사'),probeHost);probe=root.MYInvestFiveMinuteReferencePanelV1?.mount(probeHost)||null;
  const references=node('details');references.append(node('summary','자동 테스트·오프라인 검증 기록'));for(const [label,url] of [['GitHub 자동 테스트','https://github.com/kocoro97-corab/dashboard/actions'],['국내 분봉 연결 전 검증','https://github.com/kocoro97-corab/dashboard/blob/integration/news-strategy-20261121/docs/KOREAN_INTRADAY_QUALIFICATION.md']]){const p=node('p'),link=node('a',label);link.href=url;link.target='_blank';link.rel='noopener noreferrer';p.append(link);references.append(p)}references.append(node('p','정적·합성·오프라인 검증 기록은 현재 로그인에서의 실제 수신 결과와 구분합니다.'));view.append(references);
  container.replaceChildren(view);root.addEventListener('myinvest:development-diagnostics',draw);root.addEventListener('myinvest:development-session',draw);draw();
 }
 return {mount,refresh(){draw()},unmount(){active=false;root.removeEventListener('myinvest:development-diagnostics',draw);root.removeEventListener('myinvest:development-session',draw);probe?.destroy();probe=null;view?.remove();copyText=null;performanceHost=null;performanceDetails=null},getStatus:()=>({status:active?'ready':'unmounted'})};
});
})(window);
