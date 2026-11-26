/* MY INVEST V2 — authenticated, read-only VERBATIM ChatGPT task archive.
 * Never falls back to public Pages, never transmits account/holding data,
 * never writes original text into localStorage/IndexedDB/URL/console.
 * Fails closed until isolated development Worker + TEST GAS are both enabled.
 */
(function(root){
'use strict';
const ACTION='privateMorningBriefing',MAX_CHARS=280000,MAX_DATES=90;
const validDay=s=>typeof s==='string'&&/^20[2-9][0-9]-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(s)&&
 !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function validate(obj){
 if(!obj||obj.success!==true||obj.schemaVersion!==1||obj.private!==true||obj.cacheable!==false||
    !Array.isArray(obj.dates)||obj.dates.length>MAX_DATES||!obj.dates.every(validDay)||
    obj.dates.some((s,i)=>i>0&&obj.dates[i-1]<=s))return null;
 if(!obj.report)return {dates:obj.dates,report:null};
 const r=obj.report;
 if(!validDay(r.date)||!obj.dates.includes(r.date)||typeof r.content!=='string'||
    r.content.length<1||r.content.length>MAX_CHARS||
    typeof r.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(r.contentSha256)||
    r.origin!=='scheduled-task-archive-unverified'||r.format!=='verbatim-text'||
    !Number.isSafeInteger(r.savedAt)||r.savedAt<=0||r.savedAt>Date.now()+300000)return null;
 return {dates:obj.dates,report:{date:r.date,content:r.content,sha256:r.contentSha256,savedAt:r.savedAt}};
}
async function verifyText(text,expected){
 if(typeof text!=='string'||typeof expected!=='string'||!root.crypto?.subtle||!root.TextEncoder)return false;
 try{const hash=await root.crypto.subtle.digest('SHA-256',new root.TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')===expected}
 catch{return false}
}
function available(){
 const cfg=root.MYINVEST_TRANSPORT_CONFIG;
 return cfg?.mode==='relay'&&cfg?.devSession===true&&cfg?.privateBriefings===true&&
    root.DashboardTransport?.isRelay?.()===true;
}
function mount(host){
 if(!host||typeof host.replaceChildren!=='function')return {refresh:async()=>null,destroy(){}};
 const d=host.ownerDocument||root.document;
 const node=(tag,text,className)=>{const n=d.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n};
 let closed=false,sequence=0,records=[],current=null,selected='',failureCode='';
 const wrap=node('section',undefined,'mipr1');
 const css=node('style');
 css.textContent='.mipr1{border:1px solid #49657a;border-radius:10px;padding:12px;margin:10px 0;background:#111b2c;color:#eaf3fc;min-width:0}.mipr1 h3{margin:0 0 8px}.mipr1 .mipr1-status{margin:6px 0;color:#c8d7e8}.mipr1 .mipr1-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0}.mipr1 button,.mipr1 select{min-height:38px;background:#233c55;border:1px solid #476680;color:#eaf3fc;border-radius:7px;padding:7px;cursor:pointer}.mipr1 pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:64vh;overflow-y:auto;padding:12px;border:1px solid #37536b;background:#0b1321;font:inherit;line-height:1.6;border-radius:7px;margin:8px 0}.mipr1 .mipr1-meta{font-size:12px;color:#bdd1e3}.mipr1 button:disabled{opacity:.5}';
 wrap.append(css,node('h3','오늘의 AI 뉴스·투자전략 · ChatGPT 원문'));
 const status=node('p','비공개 원문 연결 확인 중…','mipr1-status');status.setAttribute('role','status');
 const controls=node('div',undefined,'mipr1-controls'),refreshBtn=node('button','오늘 원문 새로고침'),choose=node('select');
 refreshBtn.type='button';choose.setAttribute('aria-label','ChatGPT 원문 보관 날짜');
 refreshBtn.addEventListener('click',()=>{void refresh()});
 choose.addEventListener('change',()=>{selected=choose.value;void refresh(selected)});
 controls.append(refreshBtn,choose);wrap.append(status,controls);
 const metadata=node('p',undefined,'mipr1-meta'),content=node('pre');
 content.setAttribute('aria-label','ChatGPT 예약 브리핑 저장 원문');wrap.append(metadata,content);host.replaceChildren(wrap);
 function show(){
   if(closed)return;
   controls.hidden=!available()||!records.length;
   choose.replaceChildren();
   for(const day of records){const opt=node('option',day);opt.value=day;choose.append(opt)}
   choose.value=selected;
   if(current){
     status.textContent='비공개 Drive 저장 원문 · 읽기 전용 · 앱 화면에서 재작성하지 않음';
     metadata.textContent=current.date+' · 저장시각 '+new Date(current.savedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+
       ' KST · 원문 SHA-256 대조 완료 · 작성 주체의 진위는 별도 검증 전';
     content.textContent=current.content;
   }else{
     content.textContent='';metadata.textContent='';
     status.textContent=!available()?'비공개 원문 자동 조회 연결 미활성화 · 테스트 GAS 및 중계 설정이 필요합니다. 별도 AI 재생성이나 직접 입력은 필요하지 않습니다.':
       failureCode==='PRIVATE_BRIEFING_NOT_FOUND'?'아직 비공개 Drive 보관본이 없습니다. 다음 예약 작업의 저장 결과를 확인하세요.':
       failureCode==='PRIVATE_BRIEFING_FORBIDDEN'||failureCode==='AUTH_REQUIRED'?'관리자 인증이 필요합니다. 다시 로그인하거나 계정 권한을 확인하세요.':
       failureCode==='PRIVATE_BRIEFING_INTEGRITY_FAILED'?'원문 무결성 검사 실패 · 표시하지 않습니다.':
       '비공개 원문을 불러오지 못했습니다. 연결 또는 읽기 권한을 확인하세요.';
   }
 }
 async function refresh(date){
   if(closed)return;
   ++sequence;const activeId=sequence;current=null;failureCode='';content.textContent='';metadata.textContent='';
   if(!available()){show();return {ok:false,code:'DISABLED'}}
   const token=typeof LS==='function'?LS('invest_session_token'):null;
   if(typeof token!=='string'||!/^[a-f0-9]{64}$/i.test(token)){failureCode='AUTH_REQUIRED';show();return {ok:false,code:failureCode}}
   const mode=date?'date':'latest',input={action:ACTION,token,mode};if(date){if(!validDay(date))return {ok:false,code:'INVALID_DATE'};input.date=date}
   const beforeToken=token;
   try{
     const response=await root.DashboardTransport.post(input);
     const obj=await response.json();
     if(closed||activeId!==sequence||beforeToken!==(typeof LS==='function'?LS('invest_session_token'):null))return null;
     if(!response.ok||obj?.success!==true){failureCode=obj?.code||'PRIVATE_BRIEFING_UNAVAILABLE';show();return {ok:false,code:failureCode}}
     const checked=validate(obj);
     if(!checked){failureCode='PRIVATE_BRIEFING_INVALID_RESPONSE';show();return {ok:false,code:failureCode}}
     records=checked.dates;
     if(checked.report&&!await verifyText(checked.report.content,checked.report.sha256)){
       failureCode='PRIVATE_BRIEFING_INTEGRITY_FAILED';show();return {ok:false,code:failureCode}
     }
     if(closed||activeId!==sequence||beforeToken!==(typeof LS==='function'?LS('invest_session_token'):null))return null;
     current=checked.report;selected=date||checked.report?.date||records[0]||'';
     if(!current)failureCode='PRIVATE_BRIEFING_NOT_FOUND';
     show();return {ok:!!current,code:failureCode||'OK'};
   }catch{
     if(closed||activeId!==sequence)return null;
     failureCode='PRIVATE_BRIEFING_UNAVAILABLE';show();return {ok:false,code:failureCode};
   }
 }
 function destroy(){closed=true;sequence++;records=[];current=null;selected='';failureCode='';content.textContent='';metadata.textContent='';host.replaceChildren()}
 show();
 return Object.freeze({refresh,destroy,status:()=>({ready:!!current,connected:available(),private:true})});
}
const api=Object.freeze({mount,validate,verifyText,available,validDay});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestPrivateOriginalBriefing=api;
})(typeof globalThis!=='undefined'?globalThis:this);
