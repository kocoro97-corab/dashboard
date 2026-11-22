/* MY INVEST V2 — actionable personal calendar; legacy storage preserved.
 * Google primary calendar is always read-only, never merged into local events.
 */
(function(root){
'use strict';
const core=root.MYInvestCalendarCoreV2;
const google=root.MYInvestGoogleCalendarReadonlyV2?.create?.({
 clientId:root.MYINVEST_GOOGLE_CALENDAR_CLIENT_ID||''
});
const create=(tag,value,cls)=>{
 const e=root.document.createElement(tag);
 if(value!==undefined)e.textContent=value;
 if(cls)e.className=cls;
 return e;
};
const nowKST=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const monthOf=date=>({y:Number(date.slice(0,4)),m:Number(date.slice(5,7))});
let date=nowKST(),ym=monthOf(date),dialog=null,panel=null,priorFocus=null,keyboard=null;
let editing=null,notification='',notificationType='notice',gItems=[],gMonth='',generation=0;
const note=(msg,kind='notice')=>{notification=msg;notificationType=kind;render()};
const clearGoogle=()=>{gItems=[];gMonth=''};
function close(){
 generation++;
 if(keyboard)root.document.removeEventListener('keydown',keyboard);
 keyboard=null;
 dialog?.remove();dialog=null;panel=null;editing=null;clearGoogle();
 const previous=priorFocus;priorFocus=null;
 if(previous?.isConnected)try{previous.focus()}catch{}
 return true;
}
function shift(delta){
 const d=new Date(Date.UTC(ym.y,ym.m-1+delta,1));
 ym={y:d.getUTCFullYear(),m:d.getUTCMonth()+1};
 date=ym.y+'-'+String(ym.m).padStart(2,'0')+'-01';
 editing=null;notification='';clearGoogle();render();
}
function choose(day){
 date=day;ym=monthOf(day);editing=null;notification='';clearGoogle();render();
}
function saveDownload(contents){
 const data=new Blob([contents],{type:'text/calendar;charset=utf-8'});
 const url=root.URL.createObjectURL(data);
 const a=create('a');a.href=url;a.download='myinvest-investment-events.ics';
 root.document.body.append(a);a.click();a.remove();
 root.setTimeout(()=>root.URL.revokeObjectURL(url),0);
}
async function importFile(file){
 if(!file||!/^.+\.ics$/i.test(file.name)||file.size>2097152){
  note('2MB 이하 .ics 파일을 선택하세요.');return;
 }
 let txt;try{txt=await file.text()}catch{note('ICS 파일을 읽지 못했습니다.');return}
 const result=core.importICS(root.localStorage,txt);
 if(!result.ok){note('ICS 가져오기 실패: '+result.code);return}
 editing=null;
 note('ICS 일정 '+result.added+'건 추가 · 중복 '+result.duplicate+
  '건 · 미지원/초과 '+result.skipped+'건','success');
}
async function googleConnect(){
 if(!google?.status().configured){
  note('실시간 Google 연결은 OAuth 웹 클라이언트 설정 후 활성화됩니다. 현재는 .ics 가져오기를 이용할 수 있습니다.');return;
 }
 const g=++generation;
 try{
  await google.connect();
  if(dialog&&g===generation)note('Google 연결 승인됨 · 이 달 Google 일정 조회 버튼을 눌러주세요.','success');
 }catch(e){if(dialog&&g===generation)note('Google 인증 실패: '+(e?.code||'UNKNOWN'))}
}
async function googleRefresh(){
 if(!google?.status().connected){note('Google 연결이 필요합니다.');return}
 const g=++generation;
 try{
  const result=await google.events(ym.y,ym.m);
  if(!dialog||generation!==g)return;
  gItems=result.records;
  gMonth=ym.y+'-'+ym.m;
  note('Google 기본 캘린더 '+gItems.length+'건 조회 ·'+
   (result.partial?' 일부 결과만 표시 ·':'')+' 브라우저 메모리에만 유지','success');
 }catch(e){if(dialog&&generation===g){clearGoogle();note('Google 조회 실패: '+(e?.code||'UNKNOWN'))}}
}
function render(){
 if(!panel)return;
 panel.replaceChildren();
 const header=create('header',undefined,'mcv2-header');
 const title=create('div');
 title.append(create('h2','투자 일정 캘린더'),create('p','개인 일정 · 브라우저 저장 / Google · 읽기 전용','mcv2-subtitle'));
 const closeButton=create('button','닫기');closeButton.type='button';
 closeButton.setAttribute('data-calendar-close','');
 closeButton.addEventListener('click',close);header.append(title,closeButton);
 panel.append(header);
 if(notification)panel.append(create('p',notification,notificationType==='success'?'mcv2-success':'mcv2-notice'));
 const toolbar=create('nav',undefined,'mcv2-toolbar');
 toolbar.append(create('strong',ym.y+'년 '+ym.m+'월','mcv2-period'));
 const nav=create('div',undefined,'mcv2-actions');
 for(const [name,cb] of [['◀ 이전 달',()=>shift(-1)],['오늘',()=>choose(nowKST())],
  ['다음 달 ▶',()=>shift(1)]]){
  const b=create('button',name);b.type='button';b.addEventListener('click',cb);nav.append(b);
 }
 toolbar.append(nav);panel.append(toolbar);
 const layout=create('div',undefined,'mcv2-layout');
 const cal=create('section',undefined,'mcv2-sheet');
 const week=create('div',undefined,'mcv2-week');
 for(const w of ['일','월','화','수','목','금','토'])week.append(create('b',w));
 const manual=core.read(root.localStorage);
 const googleData=gMonth===ym.y+'-'+ym.m?gItems:[];
 const combined=manual.concat(googleData);
 for(const day of core.month(ym.y,ym.m,combined)){
  if(!day){week.append(create('div',undefined,'mcv2-blank'));continue}
  const b=create('button',undefined,'mcv2-day');
  b.type='button';b.setAttribute('data-calendar-day',day.date);
  b.setAttribute('data-selected',String(day.date===date));
  b.setAttribute('aria-label',day.date+' 일정 '+day.items.length+'건');
  b.append(create('span',String(day.day)));
  for(const event of day.items.slice(0,2))b.append(create('small',(event.readOnly?'G · ':'')+event.title));
  if(day.items.length>2)b.append(create('small','외 '+(day.items.length-2)+'건'));
  b.addEventListener('click',()=>choose(day.date));week.append(b);
 }
 cal.append(week);
 const detail=create('section',undefined,'mcv2-section');
 detail.append(create('h3',date+' 일정'));
 const items=create('div',undefined,'mcv2-items');
 const daily=combined.filter(e=>e.date===date);
 if(!daily.length)items.append(create('p','이 날짜에 등록된 일정이 없습니다.','mcv2-muted'));
 for(const entry of daily){
  const box=create('div',undefined,'mcv2-event');
  box.append(create('b',(entry.readOnly?'Google · ':'')+entry.title),
   create('small',(entry.time||'종일')+' · '+(core.LABELS[entry.category]||'기타')+
    (entry.readOnly?' · 읽기 전용':'')));
  if(entry.note)box.append(create('p',entry.note,'mcv2-muted'));
  if(!entry.readOnly){
   const actions=create('div',undefined,'mcv2-inline');
   const edit=create('button','수정');edit.type='button';
   edit.addEventListener('click',()=>{editing=entry.id;notification='';render()});
   const del=create('button','삭제','danger');del.type='button';
   del.addEventListener('click',()=>{
    if(!root.confirm('이 일정을 삭제할까요?'))return;
    const result=core.remove(root.localStorage,entry.id);
    if(result.ok){editing=null;note('일정이 삭제됐습니다.','success')}
    else note('삭제 실패: '+result.code);
   });
   actions.append(edit,del);box.append(actions);
  }
  items.append(box);
 }
 detail.append(items);cal.append(detail);
 const aside=create('aside',undefined,'mcv2-side');
 const editor=create('section',undefined,'mcv2-sheet mcv2-section');
 const existing=manual.find(x=>x.id===editing)||null;
 editor.append(create('h3',existing?'일정 수정':'새 일정 등록'));
 const form=create('form',undefined,'mcv2-form');
 form.setAttribute('data-calendar-form','');
 const field=(labelText,type,name,value)=>{
  const label=create('label',labelText),input=create('input');
  input.type=type;input.setAttribute('aria-label',name);
  input.value=value||'';label.append(input);return {label,input};
 };
 const dt=field('날짜','date','일정 날짜',existing?.date||date);
 dt.input.required=true;
 const titleField=field('제목','text','일정 제목',existing?.title||'');
 titleField.input.required=true;titleField.input.maxLength=100;
 titleField.input.placeholder='예: FOMC 발표 확인';
 const grid=create('div',undefined,'mcv2-form-grid');
 const tm=field('시간 (선택)','time','일정 시간',existing?.time||'');
 const categoryLabel=create('label','일정 분류'),category=create('select');
 category.setAttribute('aria-label','일정 분류');
 for(const [code,label] of Object.entries(core.LABELS)){
  const opt=create('option',label);opt.value=code;category.append(opt);
 }
 category.value=existing?.category||'macro';categoryLabel.append(category);
 grid.append(tm.label,categoryLabel);
 const memoLabel=create('label','메모 (선택)'),memo=create('textarea');
 memo.setAttribute('aria-label','일정 메모');memo.maxLength=500;memo.value=existing?.note||'';
 memoLabel.append(memo);
 const buttons=create('div',undefined,'mcv2-inline');
 const save=create('button',existing?'수정 저장':'일정 저장');save.type='submit';buttons.append(save);
 if(existing){
  const cancel=create('button','수정 취소');cancel.type='button';
  cancel.addEventListener('click',()=>{editing=null;notification='';render()});
  buttons.append(cancel);
 }
 form.append(dt.label,titleField.label,grid,memoLabel,buttons);
 form.addEventListener('submit',e=>{
  e.preventDefault();
  const saved=core.upsert(root.localStorage,{
   ...(existing?{id:existing.id}:{}),date:dt.input.value,
   title:titleField.input.value,time:tm.input.value,
   category:category.value,note:memo.value
  });
  if(!saved.ok){note('저장 실패: '+saved.code);return}
  date=saved.event.date;ym=monthOf(date);editing=null;
  note('일정을 이 브라우저에 저장했습니다.','success');
 });
 editor.append(form);aside.append(editor);
 const fileSection=create('section',undefined,'mcv2-sheet mcv2-section');
 fileSection.append(create('h3','Google·iCalendar 파일'),
  create('p','Google에서 내려받은 .ics 파일을 가져올 수 있습니다. 파일 가져오기는 자동 동기화가 아니며 반복 일정 일부는 지원하지 않습니다.','mcv2-muted'));
 const exportButton=create('button','내 일정 .ics 내보내기');
 exportButton.type='button';exportButton.addEventListener('click',()=>saveDownload(core.exportICS(root.localStorage)));
 const file=create('input');file.type='file';file.accept='.ics,text/calendar';
 file.className='mcv2-file';file.setAttribute('aria-label','ICS 일정 파일 선택');
 file.addEventListener('change',()=>{if(file.files?.[0])void importFile(file.files[0])});
 fileSection.append(exportButton,create('p','ICS 파일 선택 후 일정 병합','mcv2-muted'),file);
 aside.append(fileSection);
 const gg=create('section',undefined,'mcv2-sheet mcv2-section mcv2-google');
 gg.append(create('h3','Google 캘린더 연결'));
 const st=google?.status()||{configured:false,connected:false};
 const buttonsGoogle=create('div',undefined,'mcv2-inline');
 if(st.connected){
  const refresh=create('button','이 달 Google 일정 조회');refresh.type='button';
  refresh.addEventListener('click',()=>void googleRefresh());
  const disconnect=create('button','Google 연결 해제');disconnect.type='button';
  disconnect.addEventListener('click',()=>{
   generation++;google.disconnect();clearGoogle();note('Google 연결을 해제했습니다.','success');
  });
  buttonsGoogle.append(refresh,disconnect);
 }else{
  const connect=create('button','Google 읽기 전용 연결');connect.type='button';
  connect.disabled=!st.configured;connect.addEventListener('click',()=>void googleConnect());
  buttonsGoogle.append(connect);
 }
 gg.append(buttonsGoogle,create('p',st.connected?
  '읽기 전용 인증됨 · 조회는 수동이며 이 화면의 메모리에만 표시됩니다.':
  '웹 OAuth 클라이언트 ID와 Google 계정 승인이 필요합니다. 현재 실시간 일정은 연결되지 않았습니다.','mcv2-muted'));
 const link=create('a','Google 캘린더 사이트 열기');
 link.href='https://calendar.google.com/calendar/u/0/r/month';
 link.target='_blank';link.rel='noopener noreferrer';gg.append(link);
 aside.append(gg);layout.append(cal,aside);panel.append(layout);
 panel.append(create('p','수동 일정은 이 브라우저에만 저장되어 다른 기기와 자동 동기화되지 않습니다. Google 일정은 명시적으로 승인하고 불러올 때만 표시됩니다.','mcv2-footer'));
}
function open(){
 if(!core||!root.document?.body)return false;
 if(dialog){panel?.querySelector('[data-calendar-close]')?.focus();return true}
 priorFocus=root.document.activeElement;
 date=nowKST();ym=monthOf(date);editing=null;notification='';
 if(!root.document.getElementById('myinvest-calendar-v2-styles')){
  const style=create('style');style.id='myinvest-calendar-v2-styles';
  style.textContent=root.MYInvestCalendarStyleV2||'';
  root.document.head.append(style);
 }
 dialog=create('div',undefined,'mcv2-shade');
 panel=create('div',undefined,'mcv2-modal');
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
 panel.setAttribute('aria-label','MY INVEST 일정 캘린더');
 dialog.append(panel);
 dialog.addEventListener('click',e=>{if(e.target===dialog)close()});
 root.document.body.append(dialog);
 keyboard=e=>{
  if(e.key==='Escape'){e.preventDefault();close();return}
  if(e.key!=='Tab')return;
  const elements=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea,a[href]')]
   .filter(x=>x.getClientRects().length);
  const first=elements[0],last=elements.at(-1);
  if(!first)return;
  if(e.shiftKey&&root.document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&root.document.activeElement===last){e.preventDefault();first.focus()}
 };
 root.document.addEventListener('keydown',keyboard);
 render();panel.querySelector('[data-calendar-close]')?.focus();
 return true;
}
function logout(){close();google?.disconnect?.()}
const api=Object.freeze({open,close,logout,googleStatus:()=>google?.status()||{configured:false}});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestCalendarWorkspaceV2=api;
})(typeof globalThis!=='undefined'?globalThis:this);
