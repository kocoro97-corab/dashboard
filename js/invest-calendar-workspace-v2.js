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
let gCalendars=[],gListPartial=false,selectedCal=new Set(['primary']);
const included=new Set(['personal','google','holidays','market']);
const official=root.MYInvestUnifiedMarketCalendarV1;
const groupFor=x=>{
 if(x.sourceStatus==='OFFICIAL_SOURCE_SNAPSHOT')
  return ['holiday','early-close'].includes(x.type)?'holidays':'market';
 if(x.sourceStatus==='GOOGLE_USER_CALENDAR')
  return x.holidayCalendar?'holidays':'google';
 return 'personal';
};
const labelFor=x=>{
 if(x.sourceStatus==='OFFICIAL_SOURCE_SNAPSHOT')return x.sourceLabel+' 공식 일정표';
 if(x.sourceStatus==='GOOGLE_USER_CALENDAR')return x.sourceLabel||'Google 캘린더';
 return '직접 입력';
};
const note=(msg,kind='notice')=>{notification=msg;notificationType=kind;render()};
const clearGoogle=()=>{gItems=[];gMonth=''};
const clearGoogleCalendars=()=>{clearGoogle();gCalendars=[];gListPartial=false;selectedCal=new Set(['primary'])};
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
 const next=monthOf(day);
 if(next.y!==ym.y||next.m!==ym.m)clearGoogle();
 date=day;ym=next;editing=null;notification='';render();
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
  note('Google Cloud 웹 OAuth 클라이언트 설정이 필요합니다. .ics 가져오기 기능은 사용 가능합니다.');return;
 }
 const seq=++generation;
 try{
  await google.connect();
  if(!dialog||generation!==seq)return;
  const listing=await google.listCalendars();
  if(!dialog||generation!==seq)return;
  gCalendars=listing.calendars;gListPartial=listing.partial;
  selectedCal=new Set(['primary']);
  for(const item of gCalendars)if(item.holiday)selectedCal.add(item.id);
  note('Google 동의 완료 · 기본 달력과 휴일 달력을 선택했습니다. 이 달 일정 조회를 누르면 불러옵니다.','success');
 }catch(e){if(dialog&&seq===generation)note('Google 연결·목록 확인 실패: '+(e?.code||'UNKNOWN'))}
}
async function googleRefresh(){
 if(!google?.status().connected){note('Google 읽기 전용 연결이 필요합니다.');return}
 const ids=[...selectedCal].filter(id=>id==='primary'||
  gCalendars.some(item=>item.id===id));
 if(!ids.length){note('가져올 Google 캘린더를 선택하세요.');return}
 if(ids.length>10){note('한 번에 최대 10개 캘린더를 조회할 수 있습니다.');return}
 const seq=++generation;
 try{
  const results=await Promise.allSettled(ids.map(id=>google.events(ym.y,ym.m,id)));
  if(!dialog||seq!==generation)return;
  const accepted=results.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const unique=new Map();
  for(const result of accepted)for(const row of result.records)
   if(!unique.has(row.id))unique.set(row.id,row);
  gItems=[...unique.values()];gMonth=ym.y+'-'+ym.m;
  const failed=results.length-accepted.length;
  const partial=accepted.some(x=>x.partial);
  note('Google '+accepted.length+'/'+ids.length+'개 캘린더에서 일정 '+gItems.length+
    '건 조회'+(failed?' · '+failed+'개 실패':'')+
    (partial?' · 일부 일정 페이지는 미조회':'')+
    ' · 브라우저 메모리에만 표시',failed?'notice':'success');
 }catch(e){if(dialog&&generation===seq){clearGoogle();note('Google 일정 조회 실패: '+(e?.code||'UNKNOWN'))}}
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
 const filters=create('div',undefined,'mcv2-inline');
 filters.setAttribute('data-calendar-filters','');
 for(const [key,text] of [['personal','내 일정·기념일'],['google','Google 일반 일정'],
  ['holidays','공휴일·휴장일'],['market','시장 주요 일정']]){
  const button=create('button',text);
  button.type='button';button.setAttribute('aria-pressed',String(included.has(key)));
  button.setAttribute('data-calendar-filter',key);
  button.addEventListener('click',()=>{
   if(included.has(key))included.delete(key);else included.add(key);
   render();
  });
  filters.append(button);
 }
 panel.append(filters);
 const marketStatus=official?.sourceStatus?.(ym.y,ym.m);
 if(marketStatus){
  const statusText='KRX 자료: '+
   (marketStatus.krxCoverage==='UNVERIFIED_YEAR'?
     '해당 연도 공식 거래일표 미확인':
     '2026년 공식자료 중 일부 날짜 확인')+
   ' · 마지막 원천 확인 '+marketStatus.lastCheckedAt+
   (marketStatus.reviewDue?' · 공식 출처 재확인 권장':'')+
   ' · 시장 개장 여부 실시간 인증 아님';
  const evidence=create('p',statusText,'mcv2-muted');
  evidence.setAttribute('data-calendar-source-status',marketStatus.status);
  panel.append(evidence);
 }
 const layout=create('div',undefined,'mcv2-layout');
 const cal=create('section',undefined,'mcv2-sheet');
 const week=create('div',undefined,'mcv2-week');
 for(const w of ['일','월','화','수','목','금','토'])week.append(create('b',w));
 const manual=core.read(root.localStorage);
 const googleData=gMonth===ym.y+'-'+ym.m?gItems:[];
 const officialRows=official?.list?.(ym.y,ym.m)||[];
 const combined=manual.concat(googleData,officialRows)
  .filter(x=>included.has(groupFor(x)));
 const monthly=core.month(ym.y,ym.m,combined);
 for(const day of monthly){
  if(!day){week.append(create('div',undefined,'mcv2-blank'));continue}
  const b=create('button',undefined,'mcv2-day');
  b.type='button';b.setAttribute('data-calendar-day',day.date);
  b.setAttribute('data-selected',String(day.date===date));
  b.setAttribute('aria-label',day.date+' 일정 '+day.items.length+'건');
  b.append(create('span',String(day.day)));
  for(const event of day.items.slice(0,2))b.append(create('small',(event.readOnly?(event.sourceStatus==='OFFICIAL_SOURCE_SNAPSHOT'?'공식 · ':'G · '):'')+event.title));
  if(day.items.length>2)b.append(create('small','외 '+(day.items.length-2)+'건'));
  b.addEventListener('click',()=>choose(day.date));week.append(b);
 }
 cal.append(week);
 const detail=create('section',undefined,'mcv2-section');
 detail.append(create('h3',date+' 일정'));
 const items=create('div',undefined,'mcv2-items');
 const daily=monthly.find(x=>x?.date===date)?.items||[];
 if(!daily.length)items.append(create('p','이 날짜에 등록된 일정이 없습니다.','mcv2-muted'));
 for(const entry of daily){
  const box=create('div',undefined,'mcv2-event');
  box.append(create('b',(entry.sourceStatus==='OFFICIAL_SOURCE_SNAPSHOT'?'공식 · ':
   entry.readOnly?'Google · ':'')+entry.title),
   create('small',(entry.kstTime&&entry.kstDate===date?entry.kstTime+' KST':
    entry.sourceTime?entry.sourceTime+' ET':entry.time||'종일')+
   ' · '+labelFor(entry)+(entry.repeat==='yearly'?' · 매년 반복':'')+
   (entry.tentative?' · 잠정 일정':'')+
   (entry.readOnly?' · 읽기 전용':'')));
  if(entry.sourceStatus==='OFFICIAL_SOURCE_SNAPSHOT'){
   const caution=create('p',entry.note+' · '+(entry.market==='KR'?'한국 현지 날짜 기준':'미국 동부 현지 날짜 기준')+' · 마지막 확인 '+entry.checkedAt,'mcv2-muted');
   box.append(caution);
   const sourceLink=create('a','공식 발표 원문 보기');sourceLink.href=entry.sourceUrl;
   sourceLink.target='_blank';sourceLink.rel='noopener noreferrer';
   box.append(sourceLink);
  }
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
 const repeatBox=create('label','반복');
 const repeat=create('select');repeat.setAttribute('aria-label','일정 반복');
 for(const [value,label] of [['none','반복 안 함'],['yearly','매년 같은 날짜']]){
  const option=create('option',label);option.value=value;repeat.append(option);
 }
 repeat.value=existing?.repeat||'none';repeatBox.append(repeat);
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
 form.append(dt.label,titleField.label,grid,repeatBox,memoLabel,buttons);
 form.addEventListener('submit',e=>{
  e.preventDefault();
  const saved=core.upsert(root.localStorage,{
   ...(existing?{id:existing.id}:{}),date:dt.input.value,
   title:titleField.input.value,time:tm.input.value,
   category:category.value,note:memo.value,repeat:repeat.value
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
 const marketExport=create('button','이 달 공식 시장 일정 .ics 내보내기');
 marketExport.type='button';marketExport.setAttribute('data-market-ics-export','');
 marketExport.disabled=!official?.list?.(ym.y,ym.m)?.length;
 marketExport.addEventListener('click',()=>{
  if(!official?.exportMonthICS)return;
  const contents=official.exportMonthICS(ym.y,ym.m);
  const data=new Blob([contents],{type:'text/calendar;charset=utf-8'});
  const url=root.URL.createObjectURL(data);
  try{
   const a=create('a');a.href=url;
   a.download='myinvest-official-market-'+ym.y+'-'+String(ym.m).padStart(2,'0')+'.ics';
   root.document.body.append(a);a.click();a.remove();
  }finally{root.setTimeout(()=>root.URL.revokeObjectURL(url),0)}
 });
 fileSection.append(exportButton,marketExport,
  create('p','국내 KRX·미국 NYSE/FOMC 공식 시장 일정 .ics를 Google에 수동 가져오기 할 수 있습니다. 자동 등록·실시간 휴장 인증은 하지 않습니다.','mcv2-muted'),
  create('p','ICS 파일 선택 후 일정 병합','mcv2-muted'),file);
 aside.append(fileSection);
 const gg=create('section',undefined,'mcv2-sheet mcv2-section mcv2-google');
 gg.append(create('h3','Google 캘린더 읽기 전용'));
 const st=google?.status()||{configured:false,connected:false};
 const buttonsGoogle=create('div',undefined,'mcv2-inline');
 if(st.connected){
  const refresh=create('button','이 달 Google 일정 조회');refresh.type='button';
  refresh.addEventListener('click',()=>void googleRefresh());
  const reloadList=create('button','구독 캘린더 목록 다시 확인');
  reloadList.type='button';reloadList.addEventListener('click',async()=>{
   try{
    const r=await google.listCalendars();
    if(!dialog)return;
    gCalendars=r.calendars;gListPartial=r.partial;render();
   }catch(e){if(dialog)note('Google 목록 조회 실패: '+(e?.code||'UNKNOWN'))}
  });
  const disconnect=create('button','Google 연결 해제');disconnect.type='button';
  disconnect.addEventListener('click',()=>{
   generation++;google.disconnect();clearGoogleCalendars();
   note('Google 연결을 해제했습니다.','success');
  });
  buttonsGoogle.append(refresh,reloadList,disconnect);
 }else{
  const connect=create('button','Google 읽기 전용 연결');connect.type='button';
  connect.disabled=!st.configured;connect.addEventListener('click',()=>void googleConnect());
  buttonsGoogle.append(connect);
 }
 gg.append(buttonsGoogle);
 if(st.connected){
  gg.append(create('p','보이는 Google 구독 캘린더를 선택하세요. 휴일 구독은 기본 선택되며, 다른 개인·업무 달력은 명시적으로 선택할 때만 조회됩니다.','mcv2-muted'));
  const choices=create('div',undefined,'mcv2-google-calendars');
  choices.setAttribute('data-google-calendar-list','');
  for(const calendar of gCalendars.slice(0,30)){
   const label=create('label',undefined,'mcv2-calendar-choice');
   const box=create('input');box.type='checkbox';
   box.checked=selectedCal.has(calendar.id);
   box.setAttribute('aria-label',calendar.name+' 일정 포함');
   box.addEventListener('change',()=>{
    if(box.checked)selectedCal.add(calendar.id);else selectedCal.delete(calendar.id);
    clearGoogle();render();
   });
   label.append(box,create('span',calendar.name+(calendar.holiday?' · 휴일·기념일 구독':'')));
   choices.append(label);
  }
  gg.append(choices);
  if(gListPartial)gg.append(create('p','캘린더 목록 100개 중 일부만 제공됐습니다.','mcv2-muted'));
 }
 gg.append(create('p',st.connected?
  'Google은 이 달 선택한 캘린더만 클릭 시 조회합니다. Google 휴일은 KRX 휴장 확정자료가 아닙니다.':
  '웹 OAuth 클라이언트 ID와 Google 계정 승인이 필요합니다. 구독 중인 휴일·기념일 달력도 연결 전에는 표시할 수 없습니다.','mcv2-muted'));
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
function logout(){close();google?.disconnect?.();clearGoogleCalendars()}
const api=Object.freeze({open,close,logout,googleStatus:()=>google?.status()||{configured:false}});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestCalendarWorkspaceV2=api;
})(typeof globalThis!=='undefined'?globalThis:this);
