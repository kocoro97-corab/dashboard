/* ===== auth.js: 로그인 / 회원가입 / 세션 ===== */
const $=id=>document.getElementById(id);
const LS=(k,v)=>{try{if(v===undefined){const r=localStorage.getItem(k);return r?JSON.parse(r):null}localStorage.setItem(k,JSON.stringify(v))}catch(e){return null}};

// ★ 여기에 정상 동작이 확인된 Apps Script 웹 앱 주소(/exec)를 넣으세요
const DEFAULT_GAS_URL="https://script.google.com/macros/s/AKfycbxLEueueH1R4oNxaAE2iuzAKO5lS5Ah7ETzYNM03xfsmefCk_0o6PqlX-c-rYwz3paz/exec"
const MYP=()=>String(LS('invest_myproxy')||DEFAULT_GAS_URL).trim();

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
  const url=base+(base.includes('?')?'&':'?')+`action=${action}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`;
  $('authMsg').textContent="서버 통신 중...";
  let step='연결';
  try{
    const res=await fetch(url);
    step='응답(HTTP '+res.status+')';
    const txt=await res.text();
    let data;
    try{data=JSON.parse(txt)}catch(e){throw new Error('JSON 아님: '+txt.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,80))}
    if(data.success){
      if(isRegisterMode){alert(data.message);toggleAuthMode()}
      else{
        LS('invest_session_token',data.token);
        LS('invest_is_admin',data.isAdmin?'true':'false');
        startSessionTimer();
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
  const url=MYP()+(MYP().includes('?')?'&':'?')+`action=getPendingUsers&token=${token}`;
  try{
    const res=await fetch(url);
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
  const url=MYP()+(MYP().includes('?')?'&':'?')+`action=approveUser&token=${token}&target=${encodeURIComponent(targetId)}`;
  try{
    const res=await fetch(url);
    const data=await res.json();
    alert(data.message);
    if(data.success)openAdminModal();
  }catch(e){alert('승인 처리 중 오류 발생')}
}

let sessionSeconds=300,sessionInterval=null,sessionBound=false;

function startSessionTimer(){
  sessionSeconds=300;
  $('sessionTimerBox').style.display='flex';
  if(sessionInterval)clearInterval(sessionInterval);
  sessionInterval=setInterval(()=>{
    sessionSeconds--;
    const m=String(Math.floor(sessionSeconds/60)).padStart(2,'0'),s=String(sessionSeconds%60).padStart(2,'0');
    $('sessionTimeTxt').textContent=`${m}:${s}`;
    $('sessionFill').style.width=(sessionSeconds/300*100)+'%';
    if(sessionSeconds<=0)logout();
  },1000);
  if(!sessionBound){
    sessionBound=true;
    ['mousemove','keydown','touchstart','click'].forEach(ev=>window.addEventListener(ev,resetSessionTime,{passive:true}));
  }
}
function resetSessionTime(){if($('appContainer').style.display==='block')sessionSeconds=300}

function logout(){
  if(sessionInterval)clearInterval(sessionInterval);
  localStorage.removeItem('invest_session_token');
  localStorage.removeItem('invest_is_admin');
  $('sessionTimerBox').style.display='none';
  $('appContainer').style.display='none';
  $('authGuard').style.display='flex';
  $('authPw').value='';
  $('authMsg').textContent="세션이 만료되었거나 로그아웃되었습니다.";
}

function checkAuthentication(){
  const token=LS('invest_session_token');
  if(token){
    startSessionTimer();
    enterDashboard(LS('invest_is_admin')==='true');
  }
}

function enterDashboard(isAdmin){
  $('authGuard').style.display='none';
  $('appContainer').style.display='block';
  if(isAdmin)$('adminBtn').style.display='inline-block';
  if(typeof initDashboard==='function')initDashboard();
}
