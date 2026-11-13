/* ===== 외부계좌 통합: ISA / 연금저축 / IRP =====
 * 이미지 OCR은 브라우저 Tesseract.js에서 수행. OCR 값은 사용자가 확인·수정한 뒤 GAS 시트에 저장.
 * NH PLUG는 국내주식/ETF 현재가 조회만 사용. 주문 경로/기능 없음.
 */
let EXT_ASSETS=[];
let EXT_PRICES={};
let EXT_AUTO_TIMER=null;
let EXT_PRICE_BUSY=false;
let EXT_PRICE_PENDING=false;
let EXT_RUN_ID=0;
let EXT_MASTER=null,EXT_MASTER_ERROR='';
let EXT_SAVED_REV=null,EXT_SAVED_ROWS=[],EXT_UNDO=[],EXT_HISTORY=[];
let EXT_DRAFT_VERSION=0,EXT_LOAD_RUN=0;
function extRows(rows){return rows.map(x=>({accountType:x.accountType,code:String(x.code||''),name:String(x.name||''),quantity:ExternalCore.number(x.quantity),avgPrice:ExternalCore.number(x.avgPrice),source:x.source||'manual'}))}
function extCheckpoint(){EXT_DRAFT_VERSION++;EXT_UNDO.push(extRows(EXT_ASSETS));if(EXT_UNDO.length>10)EXT_UNDO.shift();extStoreControls()}
function undoExternalChange(){if(!EXT_UNDO.length)return;EXT_DRAFT_VERSION++;EXT_ASSETS=EXT_UNDO.pop();renderExternalAssets();showExternalSaveButton()}
async function loadExternalMaster(){
  try{
    const response=await fetch('data/krx-instruments.json',{cache:'no-cache'});if(!response.ok)throw Error('마스터 HTTP '+response.status);
    const document=await response.json();const date=Date.parse(document.source&&document.source.fetchedAt);
    if(!Number.isFinite(date)||Date.now()-date>30*86400000||date>Date.now()+86400000)throw Error('종목 마스터 갱신 필요');
    EXT_MASTER=ExternalCore.master(document);EXT_MASTER_ERROR='';
    const el=$('externalMasterStatus');if(el)el.textContent=document.source.provider+' · 기준 '+new Date(date).toLocaleDateString('ko-KR')+' · '+document.instruments.length+'종목';
  }catch(error){EXT_MASTER=null;EXT_MASTER_ERROR=SafeDiagnostics.message(error);const el=$('externalMasterStatus');if(el)el.textContent='마스터 확인 실패 · '+SafeDiagnostics.message(error)+' · 코드 추측 안 함'}
}
function extStoreControls(){const undo=$('externalUndoBtn');if(undo)undo.disabled=!EXT_UNDO.length}
function extImport(rows){
  const plan=ExternalCore.merge(extRows(EXT_ASSETS),extRows(rows));
  if(!plan.changes.length){$('externalOcrProgress').textContent='동일 종목·수량은 중복 추가하지 않았습니다.';return false}
  const changes=plan.conflicts.map(x=>x.before.name+': '+x.before.quantity+' / '+x.before.avgPrice+' → '+x.after.quantity+' / '+x.after.avgPrice).join('\n');
  if(!window.confirm('임시 목록 반영: 추가 '+plan.changes.filter(x=>x.kind==='add').length+'개, 기존 값 변경 '+plan.conflicts.length+'개, 동일 중복 제외 '+plan.duplicates.length+'개\n'+changes+'\n기존 값 변경을 확인했습니까? 실제 저장은 별도 확인합니다.'))return false;
  extCheckpoint();EXT_ASSETS=plan.rows;return true;
}
function applyExternalMatchedCodes(){
  extResolveCodes();const changes=EXT_ASSETS.filter(x=>x.match&&['proposal','conflict'].includes(x.match.status));
  if(!changes.length)return;
  if(!window.confirm(changes.map(x=>x.name+': '+(x.code||'빈 코드')+' → '+x.match.proposedCode).join('\n')+'\n검증된 마스터 값을 임시 목록에 적용할까요?'))return;
  extCheckpoint();changes.forEach(x=>{x.code=x.match.proposedCode;x.name=x.match.canonicalName});renderExternalAssets();showExternalSaveButton();
}
const EXT_NH_QUOTE_TTL_MS=5*60*1000;
function extPositivePrice(v){
  const text=String(v==null?'':v).replace(/[,\s]/g,'');
  if(!/^\+?\d+(?:\.\d+)?$/.test(text))return null;
  const n=Number(text);return Number.isFinite(n)&&n>0?n:null;
}
function extNHPrices(){
  const prices={};
  if(typeof NH_ACCOUNT_SESSION==='undefined'||NH_ACCOUNT_SESSION!==LS('invest_session_token'))return prices;
  if(typeof NH_ACCOUNT_FETCHED_AT==='undefined'||!NH_ACCOUNT_FETCHED_AT||Date.now()-NH_ACCOUNT_FETCHED_AT>EXT_NH_QUOTE_TTL_MS)return prices;
  if(typeof NH_ACCOUNTS==='undefined'||!Array.isArray(NH_ACCOUNTS))return prices;
  NH_ACCOUNTS.forEach(a=>((a.domestic&&!a.domestic.stale&&!a.domestic.partial&&a.domestic.holdings)||[]).forEach(h=>{
    const code=String(h.code||'').trim(),price=extPositivePrice(h.currentPrice);
    if(/^[A-Z0-9]{6}$/.test(code)&&price!=null)prices[code]={price,name:h.name,source:'NH 일반계좌',updatedAt:NH_ACCOUNT_UPDATED};
  }));
  return prices;
}
const EXT_TYPES={ISA:'ISA',PENSION:'연금저축',IRP:'IRP'};
const extNum=v=>{if(v==null)return 0;const n=Number(String(v).replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
const extFmt=v=>Number(v||0).toLocaleString('ko-KR',{maximumFractionDigits:2});
const extEsc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function extPost(action,extra={}){
  const token=LS('invest_session_token');if(!token)throw new Error('로그인이 필요합니다.');
  function failure(message,diagnostic){const error=new Error(message);error.diagnostic=diagnostic;return error}
  let response;
  try{response=await (typeof post==='function'?post({action,token,...extra}):fetch(MYP(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token,...extra})}))}
  catch(error){if(error.code==='RELAY_WRITE_OUTCOME_UNKNOWN')throw error;throw failure('프런트엔드 연결 실패',{layer:'frontend',code:'FRONTEND_NETWORK'})}
  if(response.ok===false){
    // A lost mutation response does not prove the write failed. Do not retry it.
    let rejected;try{rejected=JSON.parse(await response.text())}catch(error){}
    if(rejected&&rejected.layer==='relay'){
      const diagnostic=SafeDiagnostics.diagnostic({...rejected,http:response.status});
      throw failure(SafeDiagnostics.message({diagnostic}),diagnostic);
    }
    throw failure('GAS HTTP '+response.status,{layer:'gas',code:'GAS_HTTP',http:response.status});
  }
  let data;try{data=JSON.parse(await response.text())}catch(error){throw failure('GAS JSON 응답 아님 — 배포 주소·접근권한 확인',{layer:'gas',code:'GAS_NON_JSON',http:response.status})}
  if(token!==LS('invest_session_token')){const error=new Error('세션이 변경됐습니다.');error.name='StaleSession';throw error}
  if(!data||data.success!==true){const diagnostic=SafeDiagnostics.diagnostic({...data,http:response.status});throw failure(SafeDiagnostics.message(data),diagnostic)}return data;
}
async function loadExternalAssets(){
  const st=$('externalStatus'),loadRun=++EXT_LOAD_RUN,draftVersion=EXT_DRAFT_VERSION;try{
    await loadExternalMaster();
    const data=await extPost('externalHoldings');if(loadRun!==EXT_LOAD_RUN)return;
    EXT_SAVED_ROWS=extRows(Array.isArray(data.holdings)?data.holdings:[]);EXT_SAVED_REV=data.storeVersion===2?data.revision:null;EXT_HISTORY=[];
    if(draftVersion===EXT_DRAFT_VERSION){EXT_ASSETS=extRows(EXT_SAVED_ROWS);EXT_UNDO=[]}
    renderExternalAssets();extStoreControls();
    const cfg=LS('invest_external_settings')||{auto:false,minutes:10};$('externalDriveFolder').value=LS('invest_external_drive_folder')||'';$('externalAutoRefresh').checked=!!cfg.auto;$('externalAutoMinutes').value=String(cfg.minutes||10);applyExternalAutoRefresh();
    if(EXT_ASSETS.length)await refreshExternalPrices(true);else if(st)st.textContent='외부계좌 종목 없음 · 이미지 업로드 또는 Drive 가져오기로 등록하세요.';
    if(draftVersion!==EXT_DRAFT_VERSION&&st)st.textContent+=' · 불러오기 중 편집한 임시 목록을 보존했습니다. 저장 전 전체 비교가 필요합니다.';
    if(!EXT_SAVED_REV&&st)st.textContent+=' · 저장/복구용 GAS v2 승인 배포가 필요합니다.';
  }catch(error){if(error.name==='StaleSession')return;if(st)st.textContent='외부계좌 자료 조회 실패 · '+SafeDiagnostics.message(error)}
}

function saveExternalSettings(){LS('invest_external_drive_folder',$('externalDriveFolder').value.trim());const cfg={auto:$('externalAutoRefresh').checked,minutes:Number($('externalAutoMinutes').value)||10};LS('invest_external_settings',cfg);applyExternalAutoRefresh();$('externalStatus').textContent=cfg.auto?'자동갱신 사용 · '+cfg.minutes+'분 간격':'자동갱신 꺼짐 · 접속 및 수동 새로고침';}
function applyExternalAutoRefresh(){if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null;const cfg=LS('invest_external_settings')||{};if(cfg.auto)EXT_AUTO_TIMER=setInterval(()=>refreshExternalPrices(true),Math.max(5,Number(cfg.minutes)||10)*60000)}
async function ocrImage(file){
  if(!window.Tesseract)throw new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
  const result=await Tesseract.recognize(file,'kor+eng',{logger:m=>{if(m.status==='recognizing text')$('externalOcrProgress').textContent='이미지 인식 중 '+Math.round((m.progress||0)*100)+'%'}});
  let data=result.data||{text:''};
  const regions=ExternalCore.parse(data,$('externalAccountType').value,EXT_MASTER).regions||[];
  if(!regions.length||!EXT_MASTER||typeof Tesseract.createWorker!=='function')return data;
  const bitmap=await createImageBitmap(file);
  try{
    const crops=regions.slice(0,12).map(region=>{
      const canvas=document.createElement('canvas'),scale=2;
      const width=Math.min(bitmap.width,region.x1)-region.x0,height=Math.min(bitmap.height,region.y1)-region.y0;
      canvas.width=Math.ceil(width*scale);canvas.height=Math.ceil(height*scale);
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(bitmap,region.x0,region.y0,width,height,0,0,canvas.width,canvas.height);
      return canvas;
    });
    const readings={};
    for(const language of ['kor','eng']){
      const worker=await Tesseract.createWorker(language);
      try{await worker.setParameters({tessedit_pageseg_mode:'7'});readings[language]=[];
        for(const canvas of crops){const reading=await worker.recognize(canvas.toDataURL());readings[language].push(reading.data)}
      }finally{await worker.terminate()}
    }
    regions.slice(0,12).forEach((region,i)=>{const name=ExternalCore.mixedName(readings.kor[i],readings.eng[i],EXT_MASTER);if(name)data=ExternalCore.replaceName(data,region,name)});
  }catch(error){
    // Optional refinement must preserve the original candidates for user review.
  }finally{bitmap.close()}
  return data;
}
// No guessed names, hardcoded symbol mappings, or destructive saved-row normalization.
function extNormalizeOcrName(v){return String(v||'').trim()}
function extIsRealHolding(x){return !!x&&!!String(x.name||'').trim()}
function extResolveCodes(){
  const counts=new Map();EXT_ASSETS.forEach(x=>{x.match=Object.prototype.hasOwnProperty.call(EXT_TYPES,x.accountType)?ExternalCore.match(x,EXT_MASTER):{status:'invalid',code:null,reason:'계좌 구분 확인 필요'};const key=ExternalCore.key(x);counts.set(key,(counts.get(key)||0)+1)});
  EXT_ASSETS.forEach(x=>{if(counts.get(ExternalCore.key(x))>1)x.match={status:'duplicate',code:null,reason:'같은 계좌 중복 — 확인 필요'}});return false;
}
function suggestExternalNames(query){
  const list=$('externalMasterNames');if(!list)return;list.replaceChildren();if(!EXT_MASTER||!String(query).trim())return;
  const key=ExternalCore.norm(query);[...EXT_MASTER.byCode.values()].filter(x=>ExternalCore.norm(x.name).includes(key)||x.code.startsWith(key)).slice(0,20).forEach(x=>{const option=document.createElement('option');option.value=x.name;option.label=x.code+' · '+x.market+' · '+x.type;list.appendChild(option)});
}
function extSyncWithNH(){extResolveCodes();renderExternalAssets();if(EXT_PRICE_BUSY){EXT_PRICE_PENDING=true;return}if(EXT_ASSETS.some(x=>x.match.status==='matched'))refreshExternalPrices(true)}
function parseExternalOcr(data,accountType){const result=ExternalCore.parse(data,accountType,EXT_MASTER);window.EXT_OCR_WARNINGS=result.warnings;return result.holdings}
function showOcrReview(texts){
  let el=$('externalOcrReview');if(!el){el=document.createElement('div');el.id='externalOcrReview';$('externalOcrProgress').after(el)}
  el.innerHTML='<details><summary style="cursor:pointer;margin:8px 0">OCR 원문 보기</summary><div class="mini" style="margin:8px 0">종목명·수량·평균매입가를 확인하세요. 코드가 빈 종목은 직접 입력할 수 있습니다.</div><textarea id="externalOcrRaw" rows="7" style="width:100%;box-sizing:border-box" readonly></textarea></details>';
  $('externalOcrRaw').value=texts.join('\n\n----- 이미지 구분 -----\n\n').slice(0,18000);
}

async function processExternalUploads(){
  const session=LS('invest_session_token');
  const files=Array.from(($('externalImageFiles').files||[]));if(!files.length){alert('캡처 이미지를 선택하세요.');return}
  if(files.some(f=>!/^image\//.test(f.type))){alert('이미지 파일만 업로드할 수 있습니다.');return}
  const btn=$('externalUploadBtn');btn.disabled=true;let all=[],texts=[];
  try{for(let i=0;i<files.length;i++){ $('externalOcrProgress').textContent=(i+1)+'/'+files.length+' 이미지 분석 중...';const data=await ocrImage(files[i]);if(session!==LS('invest_session_token'))return;texts.push(data.text||'');all=all.concat(parseExternalOcr(data,$('externalAccountType').value));}
    showOcrReview(texts);if((window.EXT_OCR_WARNINGS||[]).length)$('externalOcrProgress').textContent=window.EXT_OCR_WARNINGS.join(' · ');if(!all.length){$('externalOcrProgress').textContent=(window.EXT_OCR_WARNINGS||[]).join(' · ')||'종목을 인식하지 못했습니다. 머리글과 동일 행의 수량·평균매입가를 확인하세요.';return}
    if(!extImport(all))return;extResolveCodes();renderExternalAssets();$('externalOcrProgress').textContent='인식 후보 '+all.length+'개 · 수량·평균매입가를 확인·수정하고 [인식자료 저장]을 누르세요. 종목코드는 비워도 저장됩니다.'+(window.EXT_OCR_WARNINGS||[]).join(' · ');showExternalSaveButton();
  }catch(e){$('externalOcrProgress').textContent='이미지 인식 실패 · '+SafeDiagnostics.message(e)}finally{btn.disabled=false}
}
function mergeExternalRows(base,add){return ExternalCore.merge(base,add).rows}
function addExternalManual(){
  const row={accountType:$('externalAccountType').value,code:$('externalManualCode').value.trim(),name:$('externalManualName').value.trim(),quantity:ExternalCore.number($('externalManualQty').value),avgPrice:ExternalCore.number($('externalManualAvg').value),source:'manual'};
  try{ExternalCore.validate([row]);if(!extImport([row]))return;renderExternalAssets();showExternalSaveButton();['externalManualCode','externalManualName','externalManualQty','externalManualAvg'].forEach(id=>$(id).value='')}catch(error){alert(SafeDiagnostics.message(error))}
}
function showExternalSaveButton(){let b=$('externalSaveBtn');if(!b){b=document.createElement('button');b.id='externalSaveBtn';b.textContent='인식자료 저장';b.onclick=saveExternalAssets;$('externalOcrProgress').after(b)}b.style.display='inline-block'}
async function importExternalDriveImages(){
  const session=LS('invest_session_token');
  const folderId=$('externalDriveFolder').value.trim();if(!folderId){alert('Google Drive 폴더 ID를 입력하세요.');return}LS('invest_external_drive_folder',folderId);
  $('externalOcrProgress').textContent='Google Drive 폴더에서 이미지 목록을 불러오는 중...';
  try{const j=await extPost('externalDriveImages',{folderId});if(!j.images||!j.images.length)throw new Error('폴더에 이미지 파일이 없습니다.');let all=[],texts=[];
    for(let i=0;i<j.images.length;i++){const im=j.images[i];$('externalOcrProgress').textContent='Drive 이미지 OCR '+(i+1)+'/'+j.images.length+' · '+im.name;const blob=await fetch('data:'+im.mimeType+';base64,'+im.base64).then(r=>r.blob());const f=new File([blob],im.name,{type:im.mimeType});const data=await ocrImage(f);if(session!==LS('invest_session_token'))return;texts.push(data.text||'');all=all.concat(parseExternalOcr(data,$('externalAccountType').value));}
    showOcrReview(texts);if((window.EXT_OCR_WARNINGS||[]).length)$('externalOcrProgress').textContent=window.EXT_OCR_WARNINGS.join(' · ');if(!all.length)throw new Error('종목을 인식하지 못했습니다. 아래 OCR 원문을 보고 직접 등록하세요.');if(!extImport(all))return;extResolveCodes();renderExternalAssets();$('externalOcrProgress').textContent='Drive 이미지 '+j.images.length+'개 · 인식 후보 '+all.length+'개. 수량·평단가를 확인하고 저장하세요.';showExternalSaveButton();
  }catch(e){$('externalOcrProgress').textContent='Drive 가져오기 실패 · '+SafeDiagnostics.message(e)}
}
function renderExternalAssets(){
  extResolveCodes();
  const tb=$('externalAssetRows'),cards=$('externalSummaryCards');if(!tb||!cards)return;
  if(!EXT_ASSETS.length){tb.innerHTML='<tr><td colspan="9" style="text-align:center">등록된 외부계좌 종목이 없습니다.</td></tr>';cards.innerHTML='';extStoreControls();return}
  const totals={ISA:{eval:0,cost:0,count:0,priced:0},PENSION:{eval:0,cost:0,count:0,priced:0},IRP:{eval:0,cost:0,count:0,priced:0}};
  tb.innerHTML=EXT_ASSETS.map((x,i)=>{const q=ExternalCore.number(x.quantity),a=ExternalCore.number(x.avgPrice),raw=x.match.status==='matched'&&EXT_PRICES[x.code]?EXT_PRICES[x.code].price:null,p=extPositivePrice(raw),evalAmt=p==null||q==null?null:p*q,cost=q==null||a==null?null:q*a,pl=evalAmt==null||cost==null?null:evalAmt-cost,returnRate=pl!=null&&cost>0?pl/cost*100:null;const t=Object.prototype.hasOwnProperty.call(totals,x.accountType)?totals[x.accountType]:null;if(t&&evalAmt!=null&&cost!=null){t.eval+=evalAmt;t.cost+=cost;t.priced++}if(t)t.count++;
    return `<tr><td>${Object.prototype.hasOwnProperty.call(EXT_TYPES,x.accountType)?EXT_TYPES[x.accountType]:extEsc(x.accountType)}</td><td><input class="external-edit" style="min-width:100px" value="${extEsc(x.name)}" list="externalMasterNames" oninput="suggestExternalNames(this.value)" onchange="editExternalText(${i},'name',this.value)"></td><td><input class="external-edit" style="width:92px" maxlength="20" value="${extEsc(x.code)}" placeholder="코드 확인" onchange="editExternalText(${i},'code',this.value)"><div class="mini">${extEsc(x.match.reason)}</div></td><td><input class="external-edit" type="number" min="0" step="any" value="${q==null?'':q}" onchange="editExternal(${i},'quantity',this.value)"></td><td><input class="external-edit" type="number" min="0" step="any" value="${a==null?'':a}" onchange="editExternal(${i},'avgPrice',this.value)"></td><td>${p==null?'<span class="external-pending">시세 미확인</span>':extFmt(p)}</td><td>${evalAmt==null?'—':extFmt(evalAmt)}</td><td class="${pl==null?'neutral':pl>=0?'up':'down'}">${pl==null?'—':extFmt(pl)}<div class="mini">수익률 ${returnRate==null?'—':extFmt(returnRate)+'%'}</div></td><td><button onclick="removeExternal(${i})">삭제</button></td></tr>`;
  }).join('');
  let html=Object.keys(totals).map(k=>{const t=totals[k],pl=t.eval-t.cost;return `<div class="card"><div class="cl"><b>${EXT_TYPES[k]}</b><span>${t.count}종목 · 시세 ${t.priced}/${t.count}</span></div><div class="value">${t.priced?extFmt(t.eval):'—'}<span class="mini">원 평가금액</span></div><div class="change ${pl>=0?'up':'down'}">평가손익 ${t.priced?extFmt(pl)+'원':'시세 미확인'}</div>${t.priced<t.count?'<div class="mini">부분 합계 · 미조회 종목 제외</div>':''}</div>`}).join('');
  const nh={eval:0,profit:0,count:0,incomplete:false,priced:0};
  (typeof NH_ACCOUNTS!=='undefined'&&Array.isArray(NH_ACCOUNTS)?NH_ACCOUNTS:[]).forEach(a=>['domestic','overseas'].forEach(k=>{
    const d=a[k];if(!d){nh.incomplete=true;return}const sm=d.summary||{},hs=d.holdings||[];
    const sum=key=>{const values=hs.map(h=>ExternalCore.number(h[key]));return values.some(v=>v===null)?null:values.reduce((v,n)=>v+n,0)};
    const evaluation=ExternalCore.number(sm.evalAmount)??sum('evalAmount'),profit=ExternalCore.number(sm.profit)??sum('profit');
    nh.count+=hs.length;
    if(d.stale||d.partial||evaluation===null||profit===null){nh.incomplete=true;return}
    nh.eval+=evaluation;nh.profit+=profit;nh.priced+=hs.length;
  }));
  const extEval=Object.values(totals).reduce((v,t)=>v+t.eval,0),extProfit=Object.values(totals).reduce((v,t)=>v+t.eval-t.cost,0),extCount=EXT_ASSETS.length,extPriced=Object.values(totals).reduce((v,t)=>v+t.priced,0);
  const allEval=nh.eval+extEval,allProfit=nh.profit+extProfit;const incomplete=extPriced<extCount||nh.incomplete;
  html=`<div class="card"><div class="cl"><b>NH 일반계좌</b><span>${nh.count}종목</span></div><div class="value">${(typeof NH_ACCOUNT_UPDATED!=='undefined'&&NH_ACCOUNT_UPDATED)&&!nh.incomplete?extFmt(nh.eval):'—'}<span class="mini">원 평가금액</span></div><div class="change ${nh.profit>=0?'up':'down'}">평가손익 ${nh.incomplete?'미확인':extFmt(nh.profit)+'원'}</div></div>`+html+`<div class="card" style="border-color:var(--blue)"><div class="cl"><b>전체 통합 합계</b><span>NH + 외부계좌</span></div><div class="value">${(nh.priced||extPriced)?extFmt(allEval):'—'}<span class="mini">원 평가금액</span></div><div class="change ${allProfit>=0?'up':'down'}">평가손익 ${(nh.priced||extPriced)?extFmt(allProfit)+'원':'시세 미확인'}</div><div class="mini">${incomplete?'부분 합계 · 미조회 종목 제외 · ':''}외부계좌 시세 확인 ${extPriced}/${extCount}종목</div></div>`;
  cards.innerHTML=html;extStoreControls();
}
function editExternalText(i,k,v){if(!EXT_ASSETS[i])return;extCheckpoint();EXT_ASSETS[i][k]=String(v).trim();EXT_ASSETS[i].needsReview=false;showExternalSaveButton();renderExternalAssets()}
function editExternal(i,k,v){if(!EXT_ASSETS[i])return;extCheckpoint();EXT_ASSETS[i][k]=ExternalCore.number(v);showExternalSaveButton();renderExternalAssets()}
function removeExternal(i){extCheckpoint();EXT_ASSETS.splice(i,1);renderExternalAssets();showExternalSaveButton()}
function extReviewSave(rows){
  const remaining=EXT_SAVED_ROWS.map(x=>({...x})),changes=[];
  rows.forEach(after=>{const i=remaining.findIndex(before=>ExternalCore.key(before)===ExternalCore.key(after));const before=i<0?null:remaining.splice(i,1)[0];if(!before||ExternalCore.comparable(before)!==ExternalCore.comparable(after))changes.push({before,after})});
  const describe=x=>x.accountType+' '+x.name+' ['+(x.code||'코드 미확인')+'] · 수량 '+x.quantity+' / 평균매입가 '+x.avgPrice;
  const details=changes.map(x=>(x.before?describe(x.before)+' → ':'추가: ')+describe(x.after)).concat(remaining.map(x=>'삭제: '+describe(x))).join('\n');
  return window.confirm('저장된 자료 교체: 추가/변경 '+changes.length+'개, 삭제 '+remaining.length+'개\n'+details+'\n교체 전 자료를 복구 기록에 남기고 저장할까요?');
}
async function saveExternalAssets(){
  try{
    const rows=extRows(EXT_ASSETS);ExternalCore.validate(rows);
    if(!EXT_SAVED_REV)throw Error('저장/복구용 GAS v2가 필요합니다. 승인 배포 전에는 기존 자료를 교체하지 않습니다.');
    if(!extReviewSave(rows))return;
    const version=EXT_DRAFT_VERSION;
    const data=await extPost('saveExternalHoldings',{holdings:rows,expectedRevision:EXT_SAVED_REV,confirmReplace:true});
    EXT_SAVED_REV=data.revision;EXT_SAVED_ROWS=extRows(rows);if(version===EXT_DRAFT_VERSION)EXT_UNDO=[];extStoreControls();
    $('externalStatus').textContent='저장 완료 · '+data.count+'종목 · 이전 자료는 저장 복구에서 복원 가능';const button=$('externalSaveBtn');if(button)button.style.display=version===EXT_DRAFT_VERSION?'none':'inline-block';if(version!==EXT_DRAFT_VERSION)$('externalStatus').textContent+=' · 요청 중 편집한 값은 아직 미저장입니다.';
  }catch(error){if(error.name!=='StaleSession')$('externalStatus').textContent='저장 실패 · '+SafeDiagnostics.message(error)}
}
async function showExternalHistory(){
  try{
    const data=await extPost('externalHistory');EXT_HISTORY=data.history||[];const el=$('externalHistory');if(!el)return;
    el.replaceChildren();
    EXT_HISTORY.forEach(item=>{
      const card=document.createElement('div');card.className='mini';
      const title=document.createElement('p');title.textContent=item.createdAt+' · '+item.holdings.length+'종목 · '+item.reason;
      const details=document.createElement('pre');details.textContent=item.holdings.map(x=>x.accountType+' '+x.name+' / 수량 '+x.quantity+' / 평균매입가 '+x.avgPrice).join('\n');
      const button=document.createElement('button');button.textContent='이 내역으로 복원';button.addEventListener('click',()=>restoreExternalSnapshot(item.snapshotId));
      card.append(title,details,button);el.appendChild(card);
    });if(!EXT_HISTORY.length)el.textContent='저장된 복구 기록이 없습니다.';
  }catch(error){if(error.name!=='StaleSession')$('externalStatus').textContent='복구 기록 조회 실패 · '+SafeDiagnostics.message(error)}
}
async function restoreExternalSnapshot(snapshotId){
  const item=EXT_HISTORY.find(x=>x.snapshotId===snapshotId);if(!item)return;
  if(!EXT_SAVED_REV||!window.confirm(item.createdAt+'의 '+item.holdings.length+'종목으로 복원할까요? 임시 편집값도 바뀝니다. 현재 저장 자료는 새 복구 기록으로 보존합니다.'))return;
  try{await extPost('restoreExternalHoldings',{snapshotId,expectedRevision:EXT_SAVED_REV,confirmReplace:true});await loadExternalAssets();$('externalStatus').textContent='복원 완료 · 복원 전 자료도 복구 기록에 보존했습니다.'}catch(error){if(error.name!=='StaleSession')$('externalStatus').textContent='복원 실패 · '+SafeDiagnostics.message(error)}
}

async function refreshExternalPrices(silent){
  extResolveCodes();if(EXT_PRICE_BUSY)return;EXT_PRICE_BUSY=true;
  const st=$('externalStatus'),run=++EXT_RUN_ID;
  try{
    window.EXT_LAST_QUOTE_ERRORS={};window.EXT_LAST_QUOTE_DIAGNOSTICS={};renderExternalDiagnostics();
    if(!EXT_ASSETS.length){renderExternalAssets();if(!silent&&st)st.textContent='조회할 외부계좌 종목이 없습니다.';return}
    const codes=[...new Set(EXT_ASSETS.filter(x=>x.match.status==='matched').map(x=>x.match.code))];
    // 이번 조회에 실패한 종목이 지난 가격으로 합산되지 않도록 새 결과만 사용한다.
    EXT_PRICES={};const nhPrices=extNHPrices();let reused=0;
    codes.forEach(code=>{if(nhPrices[code]){EXT_PRICES[code]=nhPrices[code];reused++}});
    renderExternalAssets();
    if(!codes.length){if(st)st.textContent='마스터에서 확인된 코드가 없습니다. 확인 필요 종목은 현재가·합계에서 제외합니다.';return}
    if(st)st.textContent='NH 국내주식·ETF 현재가 조회 중...';
    const pending=codes.filter(code=>!EXT_PRICES[code]);
    for(let i=0;i<pending.length;i+=40){
      const batch=pending.slice(i,i+40);
      try{
        const j=await extPost('nhExternalQuotes',{codes:batch});
        if(run!==EXT_RUN_ID)return;
        batch.forEach(code=>{
          const quote=j.prices&&j.prices[code],price=extPositivePrice(quote&&quote.price);
          if(price!=null&&!(j.errors&&j.errors[code]))EXT_PRICES[code]={...quote,price,source:'NH 현재가'};
          else {const diagnostic=SafeDiagnostics.diagnostic(j.diagnostics&&j.diagnostics[code]||{layer:'gas',code:'MISSING_QUOTE'});window.EXT_LAST_QUOTE_ERRORS[code]=SafeDiagnostics.text(diagnostic);window.EXT_LAST_QUOTE_DIAGNOSTICS[code]=diagnostic}
        });
      }catch(e){if(run!==EXT_RUN_ID||e.name==='StaleSession')return;batch.forEach(code=>{const diagnostic=SafeDiagnostics.diagnostic(e.diagnostic||{layer:'frontend',code:'UNEXPECTED'});window.EXT_LAST_QUOTE_ERRORS[code]=SafeDiagnostics.text(diagnostic);window.EXT_LAST_QUOTE_DIAGNOSTICS[code]=diagnostic})}
    }
    renderExternalAssets();renderExternalDiagnostics();
    const got=codes.filter(code=>EXT_PRICES[code]).length,errors=Object.keys(window.EXT_LAST_QUOTE_ERRORS).length;
    const missing=EXT_ASSETS.filter(x=>x.match.status!=='matched').length;
    if(st)st.textContent='현재가 확인 '+got+'/'+codes.length+'종목 · NH 일반계좌 재사용 '+reused+'종목'+
      (reused?' (최근 5분 내 조회)':'')+(pending.length?' · 시세 조회 '+(got-reused)+'종목':'')+
      (missing?' · 코드 미확인 '+missing+'행':'')+
      (errors?' · 조회 실패 '+errors+'종목 · '+String(Object.values(window.EXT_LAST_QUOTE_ERRORS)[0]).slice(0,160):'')+
      ' · '+new Date().toLocaleString('ko-KR');
  }catch(e){if(st)st.textContent='현재가 조회 실패 · '+SafeDiagnostics.message(e)}
  finally{
    if(run!==EXT_RUN_ID)return;
    EXT_PRICE_BUSY=false;
    if(EXT_PRICE_PENDING){EXT_PRICE_PENDING=false;refreshExternalPrices(true)}
  }
}

function renderExternalDiagnostics(){
  const el=$('externalQuoteDiagnostics');if(!el)return;el.replaceChildren();
  Object.entries(window.EXT_LAST_QUOTE_DIAGNOSTICS||{}).forEach(([code,value])=>{const line=document.createElement('div');line.textContent=(/^[A-Z0-9]{6}$/.test(code)?code:'INVALID_SYMBOL')+' · '+SafeDiagnostics.text(value);el.appendChild(line)});
}
