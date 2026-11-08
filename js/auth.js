/* ===== auth.js: 로그인 / 회원가입 / 세션 ===== */
const $=id=>document.getElementById(id);
const LS=(k,v)=>{try{if(v===undefined){const r=localStorage.getItem(k);return r?JSON.parse(r):null}localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};

// ★ 여기에 정상 동작이 확인된 Apps Script 웹 앱 주소(/exec)를 넣으세요
const DEFAULT_GAS_URL="https://script.google.com/macros/s/AKfycbxV90UdxDfhHC9vdWHFtXPfHcacMlwBfbBNENM0WXPABZYcIiEYs_ynxrtCST0c9tbf/exec"
const MYP=()=>String(LS('invest_myproxy')||DEFAULT_GAS_URL).trim();
// 로그인·가입·관리자 요청은 POST 본문으로 전송 (비밀번호·토큰이 주소·브라우저 기록·콘솔 오류에 남지 않게). text/plain이라 CORS 사전 요청 없음
const post=payload=>fetch(MYP(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});

let isRegisterMode=false;

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
  const user=$('authId').value.trim(),pass=$('authPw').value.trim();
  if(!user||!pass){$('authMsg').textContent="아이디와 비밀번호를 모두 입력하세요.";return}
  const action=isRegisterMode?'register':'login',base=MYP();
  $('authMsg').textContent="서버 통신 중...";
  let step='연결';
  try{
    const res=await post({action,user,pass});
    step='응답(HTTP '+res.status+')';
    const txt=await res.text();
    let data;
    try{data=JSON.parse(txt)}catch(e){throw new Error('JSON 아님: '+txt.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,80))}
    if(data.success){
      if(isRegisterMode){alert(data.message);toggleAuthMode()}
      else{
        LS('invest_session_token',data.token);
        LS('invest_is_admin',data.isAdmin?'true':'false');
        startSessionTimer(true);
        enterDashboard(data.isAdmin);
      }
    }else{$('authMsg').textContent=data.message||"처리에 실패했습니다."}
  }catch(e){
    if(!retried&&LS('invest_myproxy')&&base!==DEFAULT_GAS_URL){
      localStorage.removeItem('invest_myproxy');
      return doAuth(true);
    }
    $('authMsg').textContent='서버 통신 오류 ['+step+'] '+(e.message||'')+' · 주소 …'+base.slice(-8);
  }
}

async function openAdminModal(){
  $('adminMo').classList.add('on');
  $('adminUserList').innerHTML='불러오는 중...';
  const token=LS('invest_session_token');
  try{
    const res=await post({action:'getPendingUsers',token});
    const data=await res.json();
    if(data.success){
      $('adminUserList').innerHTML=data.users.length?data.users.map(u=>`
        <div class="si">
          <div><b>${u.id}</b> <span class="mini">(${u.status})</span></div>
          <div>${u.status==='approved'?'<span style="color:var(--blue);font-size:10px">승인됨</span>':`<button style="background:var(--blue);color:#000;font-weight:700" onclick="approveUser('${u.id}')">승인하기</button>`}</div>
        </div>`).join(''):'<div class="mini">가입된 회원이 없습니다.</div>';
    }else{$('adminUserList').innerHTML='<div style="color:var(--red)">목록을 불러오지 못했습니다.</div>'}
  }catch(e){$('adminUserList').innerHTML='<div style="color:var(--red)">통신 오류</div>'}
}
function closeAdminModal(){$('adminMo').classList.remove('on')}

async function approveUser(targetId){
  const token=LS('invest_session_token');
  try{
    const res=await post({action:'approveUser',token,target:targetId});
    const data=await res.json();
    alert(data.message);
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
  if(sessionInterval)clearInterval(sessionInterval);
  const tk=LS('invest_session_token');
  if(tk){try{post({action:'logout',token:tk}).catch(()=>{})}catch(e){}}   // 서버 세션도 즉시 폐기
  if(typeof stopTimers==='function')stopTimers();   // 자동 갱신 종료
  localStorage.removeItem('invest_session_token');
  localStorage.removeItem('invest_is_admin');
  localStorage.removeItem('invest_last_active');
  $('sessionTimerBox').style.display='none';
  $('appContainer').style.display='none';
  $('authGuard').style.display='flex';
  $('authPw').value='';
  $('authMsg').textContent="세션이 만료되었거나 로그아웃되었습니다.";
}

function checkAuthentication(){
  const token=LS('invest_session_token');
  if(!token)return;
  if(sessionLeftMs()<=0){logout();return}   // 마지막 사용 후 5분 경과 → 다시 로그인
  startSessionTimer(false);
  enterDashboard(LS('invest_is_admin')==='true');
}

function enterDashboard(isAdmin){
  $('authGuard').style.display='none';
  $('appContainer').style.display='block';
  if(isAdmin)$('adminBtn').style.display='inline-block';
  if(typeof initDashboard==='function')initDashboard();
}
