/* MY INVEST V2 — synthetic-only sidecar for integration-review artifact.
 * Added by review build to the *existing* strategy page without changing
 * AppRouter, DashboardShell, DashboardPages, or application data contracts.
 * No account/selection context passed into synthetic report. Never deploy.
 */
(function(root){
'use strict';
if(root.MYINVEST_RESEARCH_REVIEW!=='synthetic-only')return;
const doc=root.document;
let viewport=null,observer=null,disclosure=null,host=null,panel=null,active=false;
let pending=false;
function destroyPanel(){
 try{panel?.destroy?.()}catch{}
 panel=null;
 if(host)host.replaceChildren();
}
function clear(){
 destroyPanel();
 if(disclosure)disclosure.removeEventListener('toggle',onToggle);
 disclosure?.remove();
 disclosure=null;host=null;
}
function syntheticChoice(choice){
 const fixture=root.MYInvestResearchHarnessFixtureV1;
 if(!fixture||typeof fixture.fixture!=='function')return null;
 if(!['US','KR','BLOCKED'].includes(choice))return null;
 try{return fixture.fixture(choice)}catch{return null}
}
function onToggle(){
 if(!active||!disclosure?.isConnected)return;
 destroyPanel();
 if(!disclosure.open)return;
 const sample=syntheticChoice('US');
 const engine=root.MYInvestInvestmentResearchReportPanelV1;
 if(!sample||typeof engine?.mount!=='function'){
  host.textContent='합성 리포트 모듈 검증에 실패했습니다.';
  return;
 }
 const mounted=engine.mount(host,sample);
 if(mounted?.ok)panel=mounted;
 else host.textContent='합성 리포트 화면을 준비하지 못했습니다.';
}
function make(){
 const container=doc.createElement('details');
 container.className='str4-research-harness';
 container.setAttribute('data-research-harness','synthetic-only');
 const summary=doc.createElement('summary');
 summary.textContent='투자 분석 리포트 검증 (합성 데이터 · 개발 전용)';
 const paragraph=doc.createElement('p');
 paragraph.textContent='실제 계좌·종목선택·시세를 읽지 않습니다. 이 화면의 모든 값은 별도 합성 자료입니다.';
 const chooser=doc.createElement('div');chooser.className='research-harness-chooser';
 for(const [value,label] of [['US','미국 합성'],['KR','한국 합성'],['BLOCKED','검증 보류']]){
  const button=doc.createElement('button');button.type='button';
  button.textContent=label;button.setAttribute('data-research-sample',value);
  button.addEventListener('click',()=>{
   if(!active||!container.open||!panel)return;
   const sample=syntheticChoice(value);
   if(!sample)return;
   panel.update(sample);
   for(const b of chooser.querySelectorAll('button'))
    b.setAttribute('aria-pressed',String(b===button));
  });
  button.setAttribute('aria-pressed',String(value==='US'));
  chooser.append(button);
 }
 host=doc.createElement('div');host.className='research-harness-content';
 host.setAttribute('data-research-content','');
 container.append(summary,paragraph,chooser,host);
 container.addEventListener('toggle',onToggle);
 return container;
}
function sync(){
 if(!active)return;
 const target=doc.querySelector('#pageViewport .str4');
 const correctRoute=root.location.hash==='#/strategy';
 if(!correctRoute||!target){
  if(disclosure)clear();
  return;
 }
 if(disclosure&&disclosure.parentElement===target)return;
 if(disclosure)clear();
 disclosure=make();target.append(disclosure);
}
function schedule(){
 if(pending||!active)return;
 pending=true;
 // Observe only the app shell's direct viewport changes, not our own
 // nested report cards. Prevents repeated observer/mount cycles.
 root.queueMicrotask(()=>{
  pending=false;
  if(active)sync();
 });
}
function boot(){
 if(active)return;
 viewport=doc.getElementById('pageViewport');
 if(!viewport)return;
 active=true;
 observer=new MutationObserver(schedule);
 observer.observe(viewport,{childList:true,subtree:false});
 root.addEventListener('hashchange',schedule);
 schedule();
}
function stop(){
 active=false;root.removeEventListener('hashchange',schedule);
 observer?.disconnect();observer=null;
 clear();viewport=null;
}
root.MYInvestResearchReportHarnessV1=Object.freeze({
 getStatus:()=>Object.freeze({
  active,attached:!!disclosure?.isConnected,open:!!disclosure?.open,
  panelMounted:!!panel,kind:'SYNTHETIC_REVIEW_ONLY',
  realAccountDataRead:false,marketCalls:0,orderCalls:0,
  published:false
 }),
 stop
});
if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})(window);
