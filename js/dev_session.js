/* Development Pages only. Reuse sessionInfo; never recreate expired sessions.
 * Browser inactivity remains one hour; server revocation / absolute TTL wins.
 */
(function(root){
'use strict';
const HOUR=3600000,PERIOD=120000;
const page=()=>root.location?.origin==='https://kocoro97-corab.github.io'&&['/dashboard-v2-dev/','/dashboard-v2-dev/index.html'].includes(root.location.pathname)&&!root.location.search;
const configured=()=>page()&&root.MYINVEST_TRANSPORT_CONFIG?.mode==='relay'&&root.MYINVEST_TRANSPORT_CONFIG.devSession===true&&root.MYINVEST_PERSISTENT_RELAY?.profile==='isolated'&&root.MYINVEST_TRANSPORT_CONFIG.endpoint===root.MYINVEST_PERSISTENT_RELAY.endpoint;
if(!configured()||typeof SESSION_MS==='undefined'||SESSION_MS!==HOUR||typeof root.startSessionTimer!=='function'||typeof root.logout!=='function')return;
const originalStart=root.startSessionTimer,originalLogout=root.logout;
let timer=null,controller=null,epoch=0,busy=false;
const token=()=>typeof LS==='function'?LS('invest_session_token'):null;
function stop(){epoch++;if(timer!==null)root.clearTimeout(timer);timer=null;controller?.abort();controller=null;busy=false}
function arm(){stop();if(configured()&&token())timer=root.setTimeout(pulse,PERIOD)}
async function pulse(){
 timer=null;
 if(!configured()||!token()||document.getElementById('appContainer')?.style.display!=='block'){stop();return}
 if(sessionLeftMs()<=0){root.logout();return}
 const run=epoch,session=token(),config=root.MYINVEST_TRANSPORT_CONFIG;
 const current=()=>run===epoch&&session===token()&&config===root.MYINVEST_TRANSPORT_CONFIG&&configured();
 busy=true;const requestController=new AbortController();controller=requestController;
 const timeout=root.setTimeout(()=>requestController.abort(),15000);
 try{
  const response=await root.DashboardTransport.post({action:'sessionInfo',token:session},{signal:requestController.signal});
  const data=await response.json();
  if(!current())return;
  if(sessionLeftMs()<=0||!response.ok||data?.success!==true){root.logout();return}
  if(data.mustChangePassword===true){LS('invest_password_change',true);stop();root.showPasswordChange();return}
  // Do not touch last-active time or reinitialize the dashboard / form values.
 }catch{if(current())root.logout()}
 finally{
  root.clearTimeout(timeout);
  if(run===epoch){busy=false;controller=null;if(current())timer=root.setTimeout(pulse,PERIOD)}
 }
}
root.startSessionTimer=function(fresh){const result=originalStart.call(this,fresh);arm();return result};
root.logout=function(){stop();return originalLogout.apply(this,arguments)};
root.DevelopmentSession=Object.freeze({getStatus:()=>({inactivityMs:HOUR,checkIntervalMs:PERIOD,scheduled:timer!==null,checking:busy})});
})(window);
