/* ===== auth.js: 로그인 / 회원가입 / 세션 ===== */
const $=id=>document.getElementById(id);
const LS=(k,v)=>{try{if(v===undefined){const r=localStorage.getItem(k);return r?JSON.parse(r):null}localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};

// ★ 여기에 정상 동작이 확인된 Apps Script 웹 앱 주소(/exec)를 넣으세요
const DEFAULT_GAS_URL="https://script.google.com/macros/s/AKfycbxySfUKUai418Ar7C8RI6gwBJpjSZXH4y8EX2JhJZG9nGz7RVB0WCZGl3H1wHxOWGVd/exec";
const LEGACY_GAS_URL="https://script.google.com/macros/s/AKfycbyXiFgORGm3hHKulInKXUGkAgmhvM0H9WbDp9eClLpTdAFRMkuYH14D2ERQpgMVVHBc/exec";
// 이전 기본 주소만 전환하고 사용자가 지정한 다른 주소는 유지한다.
const MYP=()=>{const saved=String(LS('invest_myproxy')||'').trim();return saved!==LEGACY_GAS_URL&&/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(saved)?saved:DEFAULT_GAS_URL};
// 로그인·가입·관리자 요청은 POST 본문으로 전송 (비밀번호·토큰이 주소·브라우저 기록·콘솔 오류에 남지 않게). text/plain이라 CORS 사전 요청 없음
const post=payload=>fetch(MYP(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});

let isRegisterMode=false;
let AUTH_LOGIN_RUN=0;

function bindAuth(){
  const b=$('authSubmitBtn'),t=$('authToggleTxt'),pw=$('authPw');
  if(b&&!b.dataset.bound){b.dataset.bound='1';b.addEventListener('click',handleAuthSubmit)}
  if(t&&!t.dataset.bound){t.dataset.bound='1';t.addEventListener('click',toggleAuthMode)}
  if(pw&&!pw.dataset.bound){pw.dataset.bound='1';pw.addEventListener('keydown',e=>{if(e.key==='Enter')handleAuthSubmit()})}
  checkAuthentication();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindAuth);else bindAuth();

function toggleAuthMode(){
  isRegisterMode=!isRegisterMode;
  $('authTitle').textContent=isRegisterMode?"📝 회원가입":"🔒 대시보드 로그인";
  $('authSubmitBtn').textContent=isRegisterMode?"가입신청":"로그인";
  $('authToggleTxt').textContent=isRegisterMode?"이미 계정이 있으신가요? 로그인하기":"계정이 없으신가요? 회원가입하기";
  $('authMsg').textContent="";
}

function handleAuthSubmit(){return doAuth(false)}

async function doAuth(retried){
  const run=++AUTH_LOGIN_RUN;
  const user=$('authId').value.trim(),pass=$('authPw').value;
  if(!user||!pass){$('authMsg').textContent="아이디와 비밀번호를 모두 입력하세요.";return}
  const action=isRegisterMode?'register':'login',base=MYP();
  $('authMsg').textContent="서버 통신 중...";
  let step='연결';
  try{
    const res=await post({action,user,pass});
    step='응답(HTTP '+res.status+')';
    const txt=await res.text();
    let data;
    try{data=JSON.parse(txt)}catch(e){throw Object.assign(new Error(''),{code:'GAS_NON_JSON'})}
    if(run!==AUTH_LOGIN_RUN)return;
    if(data.success){
      if(isRegisterMode){alert(SafeDiagnostics.message(data));toggleAuthMode()}
      else{
        LS('invest_session_token',data.token);
        LS('invest_is_admin',data.isAdmin?'true':'false');
        $('authPw').value='';
        LS('invest_password_change',!!data.mustChangePassword);
        if(data.mustChangePassword){showPasswordChange();return}
        startSessionTimer(true);
        enterDashboard(data.isAdmin);
      }
    }else{$('authMsg').textContent=SafeDiagnostics.message(data)}
  }catch(e){
    if(!retried&&LS('invest_myproxy')&&base!==DEFAULT_GAS_URL){
      localStorage.removeItem('invest_myproxy');
      return doAuth(true);
    }
    $('authMsg').textContent='서버 통신 오류 · '+SafeDiagnostics.message(e,'FRONTEND_NETWORK');
  }
}

async function openAdminModal(){
  $('adminMo').classList.add('on');
  $('adminUserList').innerHTML='불러오는 중...';
  const token=LS('invest_session_token');
  try{
    const res=await post({action:'getPendingUsers',token});
    const data=await res.json();
    if(token!==LS('invest_session_token'))return;
    if(data.success){
      const list=$('adminUserList');list.replaceChildren();
      (data.users||[]).forEach(u=>{
        const row=document.createElement('div');row.className='si';
        const label=document.createElement('div');label.textContent=String(u.id)+' ('+String(u.status)+')';
        const control=document.createElement('button');control.textContent=u.status==='approved'?'승인됨':'승인하기';
        control.disabled=u.status==='approved';control.addEventListener('click',()=>approveUser(String(u.id)));
        row.append(label,control);list.appendChild(row);
      });
      if(!data.users||!data.users.length)list.textContent='가입된 회원이 없습니다.';
    }else{$('adminUserList').innerHTML='<div style="color:var(--red)">목록을 불러오지 못했습니다.</div>'}
  }catch(e){$('adminUserList').innerHTML='<div style="color:var(--red)">통신 오류</div>'}
}
function closeAdminModal(){$('adminMo').classList.remove('on')}

async function approveUser(targetId){
  const token=LS('invest_session_token');
  try{
    const res=await post({action:'approveUser',token,target:targetId});
    const data=await res.json();
    alert(SafeDiagnostics.message(data));
    if(data.success)openAdminModal();
  }catch(e){alert('승인 처리 중 오류 발생')}
}

const SESSION_MS=300000;   // 5분. 절대 시각 기준이라 화면 꺼짐·백그라운드에서도 정확히 만료
let sessionInterval=null,sessionBound=false,lastWrite=0;
const lastActive=()=>Number(localStorage.getItem('invest_last_active'))||0;
function touchActive(force){
  const n=Date.now();
  if(force||n-lastWrite>1000){lastWrite=n;try{localStorage.setItem('invest_last_active',String(n))}catch(e){}}
}
function sessionLeftMs(){return SESSION_MS-(Date.now()-lastActive())}

function renderSession(){
  if(!LS('invest_session_token')){logout();return}   // 다른 탭에서 로그아웃된 경우
  const left=sessionLeftMs();
  if(left<=0){logout();return}
  const sec=Math.ceil(left/1000);
  const m=String(Math.floor(sec/60)).padStart(2,'0'),s=String(sec%60).padStart(2,'0');
  $('sessionTimeTxt').textContent=`${m}:${s}`;
  $('sessionFill').style.width=(left/SESSION_MS*100)+'%';
}

function startSessionTimer(fresh){
  if(fresh)touchActive(true);
  $('sessionTimerBox').style.display='flex';
  if(sessionInterval)clearInterval(sessionInterval);
  renderSession();
  sessionInterval=setInterval(renderSession,1000);
  if(!sessionBound){
    sessionBound=true;
    // 사용자가 직접 한 동작만 인정: 스크롤(휠·터치 이동), 클릭·터치, 키 입력, 입력창 입력. 마우스를 올려두기만 하거나 자동 갱신은 제외
    ['wheel','touchstart','touchmove','pointerdown','click','keydown','input'].forEach(ev=>window.addEventListener(ev,resetSessionTime,{passive:true,capture:true}));
    // 탭 복귀·화면 켜짐 시 즉시 만료 확인 (타이머는 백그라운드에서 멈출 수 있음)
    ['visibilitychange','pageshow','focus'].forEach(ev=>window.addEventListener(ev,()=>{if($('appContainer').style.display==='block')renderSession()}));
  }
}
function resetSessionTime(){
  if($('appContainer').style.display!=='block')return;
  if(sessionLeftMs()<=0){logout();return}   // 이미 만료됐으면 터치로 되살리지 않음
  touchActive();
}

function logout(){
  AUTH_LOGIN_RUN++;
  if(sessionInterval)clearInterval(sessionInterval);
  const tk=LS('invest_session_token');
  if(tk){try{post({action:'logout',token:tk}).catch(()=>{})}catch(e){}}   // 서버 세션도 즉시 폐기
  if(typeof clearAccountState==='function')clearAccountState();
  if(typeof stopTimers==='function')stopTimers();   // 자동 갱신 종료
  localStorage.removeItem('invest_session_token');
  localStorage.removeItem('invest_is_admin');
  localStorage.removeItem('invest_last_active');
  localStorage.removeItem('invest_password_change');
  const change=$('passwordChangeGuard');if(change)change.remove();
  if($('adminBtn'))$('adminBtn').style.display='none';
  if($('adminMo'))$('adminMo').classList.remove('on');
  if($('adminUserList'))$('adminUserList').replaceChildren();
  $('sessionTimerBox').style.display='none';
  $('appContainer').style.display='none';
  $('authGuard').style.display='flex';
  $('authPw').value='';
  $('authMsg').textContent="세션이 만료되었거나 로그아웃되었습니다.";
}

async function checkAuthentication(){
  const token=LS('invest_session_token');if(!token)return;
  if(sessionLeftMs()<=0){logout();return}
  try{
    const response=await post({action:'sessionInfo',token});const data=await response.json();
    if(token!==LS('invest_session_token'))return;
    if(!data.success){logout();return}
    LS('invest_is_admin',data.isAdmin?'true':'false');LS('invest_password_change',!!data.mustChangePassword);
    if(data.mustChangePassword){showPasswordChange();return}
    startSessionTimer(false);enterDashboard(data.isAdmin);
  }catch(error){if(token===LS('invest_session_token'))logout()}
}

function enterDashboard(isAdmin){
  $('authGuard').style.display='none';
  $('appContainer').style.display='block';
  $('adminBtn').style.display=isAdmin?'inline-block':'none';
  if(typeof initDashboard==='function')initDashboard();
}


// Always discard private state and invalidate outstanding account requests at logout.
function clearAccountState(){
  if(typeof NH_ACCOUNT_RUN!=='undefined')NH_ACCOUNT_RUN++;
  if(typeof NH_ACCOUNTS!=='undefined'){NH_ACCOUNTS=[];NH_ACCOUNT_UPDATED='';NH_ACCOUNT_FETCHED_AT=0;NH_ACCOUNT_SESSION='';NH_ACCOUNT_BUSY=false}
  if(typeof EXT_RUN_ID!=='undefined')EXT_RUN_ID++;
  if(typeof EXT_ASSETS!=='undefined'){EXT_ASSETS=[];EXT_PRICES={};EXT_PRICE_BUSY=false;EXT_PRICE_PENDING=false}
  if(typeof EXT_AUTO_TIMER!=='undefined'&&EXT_AUTO_TIMER){clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null}
  ['nhAccountCards','nhAccountRows','externalSummaryCards','externalAssetRows','externalOcrReview'].forEach(id=>{const el=$(id);if(el)el.replaceChildren()});
  if(typeof H!=='undefined')H.splice(0,H.length);
  ['hd','ps'].forEach(id=>{const el=$(id);if(el)el.replaceChildren()});
  localStorage.removeItem('invest_external_drive_folder');
  if(typeof EXT_UNDO!=='undefined'){EXT_DRAFT_VERSION++;EXT_LOAD_RUN++;EXT_UNDO=[];EXT_SAVED_ROWS=[];EXT_SAVED_REV=null;EXT_HISTORY=[]}
  ['externalHistory','externalQuoteDiagnostics'].forEach(id=>{const el=$(id);if(el)el.replaceChildren()});
  window.EXT_LAST_QUOTE_DIAGNOSTICS={};
  window.EXT_LAST_QUOTE_ERRORS={};
}
function showPasswordChange(){
  if($('passwordChangeGuard'))return;
  const panel=document.createElement('div');panel.id='passwordChangeGuard';
  panel.style.cssText='position:fixed;inset:0;z-index:10000;background:#0f172a;display:flex;align-items:center;justify-content:center;padding:20px';
  panel.innerHTML='<form style="width:100%;max-width:380px"><h2>비밀번호 보안 강화</h2><p>12자 이상 새 비밀번호를 설정해주세요.</p><label>현재 비밀번호<input id="changeCurrent" type="password" autocomplete="current-password" required style="display:block;width:100%"></label><label>새 비밀번호<input id="changeNew" type="password" autocomplete="new-password" minlength="12" maxlength="256" required style="display:block;width:100%"></label><label>새 비밀번호 확인<input id="changeConfirm" type="password" autocomplete="new-password" required style="display:block;width:100%"></label><p id="changeMessage" role="status"></p><button type="submit">변경 후 계속</button><button type="button" id="changeCancel">로그아웃</button></form>';
  document.body.appendChild(panel);$('changeCancel').addEventListener('click',logout);
  panel.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();const message=$('changeMessage'),button=panel.querySelector('[type="submit"]');
    const currentPass=$('changeCurrent').value,newPass=$('changeNew').value;
    if(newPass.length<12||newPass!==$('changeConfirm').value){message.textContent='새 비밀번호를 12자 이상으로 동일하게 입력하세요.';return}
    const token=LS('invest_session_token');button.disabled=true;message.textContent='비밀번호를 안전하게 변경하는 중...';
    try{
      const response=await post({action:'changePassword',token,currentPass,newPass});const result=await response.json();
      if(LS('invest_session_token')!==token)return;
      if(!result.success){message.textContent=SafeDiagnostics.message(result);return}
      LS('invest_session_token',result.token);LS('invest_is_admin',result.isAdmin?'true':'false');LS('invest_password_change',false);
      panel.remove();startSessionTimer(true);enterDashboard(result.isAdmin);
    }catch(error){message.textContent=SafeDiagnostics.message(error,'FRONTEND_NETWORK')}finally{button.disabled=false}
  });
}
