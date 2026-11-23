/* Development Pages only. Never recreate a revoked or expired server session. */
(function(root){
'use strict';
const HOUR=3600000,PERIOD=120000,RETRY_DELAY=15000,VERIFY_WINDOW=240000,MAX_FAILURES=4;
const page=()=>root.location?.origin==='https://kocoro97-corab.github.io'&&['/dashboard-v2-dev/','/dashboard-v2-dev/index.html'].includes(root.location.pathname)&&!root.location.search;
const configured=()=>page()&&root.MYINVEST_TRANSPORT_CONFIG?.mode==='relay'&&root.MYINVEST_TRANSPORT_CONFIG.devSession===true&&root.MYINVEST_PERSISTENT_RELAY?.profile==='isolated'&&root.MYINVEST_TRANSPORT_CONFIG.endpoint===root.MYINVEST_PERSISTENT_RELAY.endpoint;
if(!configured()||typeof SESSION_MS==='undefined'||SESSION_MS!==HOUR||typeof root.startSessionTimer!=='function'||typeof root.logout!=='function')return;
const originalStart=root.startSessionTimer,originalLogout=root.logout;
let timer=null,controller=null,epoch=0,busy=false,lastVerified=0,lastAttempt=0,failures=0;
let state='SIGNED_OUT',lastCode=null,lastHttp=null,checkedAt=null;
const token=()=>typeof LS==='function'?LS('invest_session_token'):null;
const active=()=>configured()&&!!token()&&document.getElementById('appContainer')?.style.display==='block';
function record(next,code=null,http=null){
 state=next;lastCode=code;lastHttp=Number.isInteger(http)&&http>=100&&http<=599?http:null;checkedAt=Date.now();
 let notice=document.getElementById('developmentSessionNotice');
 const box=document.getElementById('sessionTimerBox');
 if(!notice&&box&&document.createElement){notice=document.createElement('span');notice.id='developmentSessionNotice';notice.setAttribute('role','status');box.append(notice)}
 if(notice){notice.hidden=next!=='RETRYING';notice.textContent=next==='RETRYING'?'서버 연결 재확인 중':''}
}
function stop(){epoch++;if(timer!==null)root.clearTimeout(timer);timer=null;controller?.abort();controller=null;busy=false}
function schedule(delay){if(timer!==null)root.clearTimeout(timer);timer=root.setTimeout(pulse,delay)}
function end(code,http){
 root.logout();record('ENDED',code,http);
 const message=document.getElementById('authMsg');
 if(message)message.textContent=({SESSION_REJECTED:'서버가 세션을 거부했습니다. 다시 로그인하세요.',SESSION_VERIFY_UNAVAILABLE:'서버 연결을 확인하지 못해 세션을 종료했습니다. 다시 로그인하세요.',SESSION_IDLE_EXPIRED:'1시간 동안 활동이 없어 로그아웃되었습니다.'}[code]||'세션이 종료되었습니다.')+' ['+code+']'+(lastHttp?' · HTTP '+lastHttp:'');
}
async function pulse(){
 timer=null;
 if(!active()){stop();return}
 if(busy)return;
 if(sessionLeftMs()<=0){end('SESSION_IDLE_EXPIRED');return}
 const run=epoch,session=token(),config=root.MYINVEST_TRANSPORT_CONFIG;
 const current=()=>run===epoch&&session===token()&&config===root.MYINVEST_TRANSPORT_CONFIG&&configured();
 busy=true;lastAttempt=Date.now();record('VERIFYING');
 const requestController=new AbortController();controller=requestController;
 const timeout=root.setTimeout(()=>requestController.abort(),15000);
 let retry=false;
 function unavailable(code,http){
  failures++;record('RETRYING',code,http);
  if(failures>=MAX_FAILURES||Date.now()-lastVerified>=VERIFY_WINDOW){end('SESSION_VERIFY_UNAVAILABLE',http);return}
  retry=true;
 }
 try{
  const response=await root.DashboardTransport.post({action:'sessionInfo',token:session},{signal:requestController.signal});
  if(!current())return;
  if(sessionLeftMs()<=0){end('SESSION_IDLE_EXPIRED');return}
  if([429,502,503,504].includes(response.status)){unavailable('SESSION_TRANSPORT_UNAVAILABLE',response.status);return}
  if(!response.ok){end('SESSION_REJECTED',response.status);return}
  let data;try{data=await response.json()}catch{if(current())unavailable('SESSION_RESPONSE_UNCONFIRMED',response.status);return}
  if(!current())return;
  if(sessionLeftMs()<=0){end('SESSION_IDLE_EXPIRED');return}
  if(data?.success!==true){end('SESSION_REJECTED',response.status);return}
  if(data.mustChangePassword===true){LS('invest_password_change',true);stop();record('PASSWORD_CHANGE_REQUIRED');root.showPasswordChange();return}
  lastVerified=Date.now();failures=0;record('VERIFIED',null,response.status);
  // This confirms only the server session. Never touch user activity or forms.
 }catch{if(current())unavailable('SESSION_TRANSPORT_UNAVAILABLE')}
 finally{
  root.clearTimeout(timeout);
  if(run===epoch){busy=false;controller=null;if(current())schedule(retry?RETRY_DELAY:PERIOD)}
 }
}
function wake(){
 if(!active()||busy||Date.now()-lastAttempt<PERIOD)return;
 if(timer!==null)root.clearTimeout(timer);timer=null;void pulse();
}
root.startSessionTimer=function(fresh){
 const result=originalStart.call(this,fresh);stop();
 if(configured()&&token()){lastVerified=lastAttempt=Date.now();failures=0;record('VERIFIED');schedule(PERIOD)}
 return result;
};
root.logout=function(){stop();record('SIGNED_OUT');return originalLogout.apply(this,arguments)};
for(const event of ['pointerdown','keydown','wheel','touchstart','touchmove','input','focus','pageshow'])root.addEventListener?.(event,wake,{passive:true});
root.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')wake()});
root.DevelopmentSession=Object.freeze({getStatus:()=>({inactivityMs:HOUR,checkIntervalMs:PERIOD,scheduled:timer!==null,checking:busy,state,code:lastCode,http:lastHttp,checkedAt,consecutiveFailures:failures})});
})(window);
