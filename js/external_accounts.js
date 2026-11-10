/* ===== 외부계좌 통합: ISA / 연금저축 / IRP =====
 * 이미지 OCR은 브라우저 Tesseract.js에서 수행. OCR 값은 사용자가 확인·수정한 뒤 GAS 시트에 저장.
 * NH PLUG는 국내주식/ETF 현재가 조회만 사용. 주문 경로/기능 없음.
 */
let EXT_ASSETS=[];
let EXT_PRICES={};
let EXT_AUTO_TIMER=null;
let EXT_PRICE_BUSY=false;
const EXT_TYPES={ISA:'ISA',PENSION:'연금저축',IRP:'IRP'};
const extNum=v=>{if(v==null)return 0;const n=Number(String(v).replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
const extFmt=v=>Number(v||0).toLocaleString('ko-KR',{maximumFractionDigits:2});
const extEsc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function extPost(action,extra={}){
  const token=LS('invest_session_token');if(!token)throw new Error('로그인이 필요합니다.');
  const r=await fetch(MYP(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token,...extra})});
  const j=JSON.parse(await r.text());if(!j.success)throw new Error(j.message||'요청 실패');return j;
}
async function loadExternalAssets(){
  const st=$('externalStatus');try{const j=await extPost('externalHoldings');EXT_ASSETS=Array.isArray(j.holdings)?j.holdings:[];renderExternalAssets();
    const cfg=LS('invest_external_settings')||{auto:false,minutes:10};$('externalDriveFolder').value=LS('invest_external_drive_folder')||'';$('externalAutoRefresh').checked=!!cfg.auto;$('externalAutoMinutes').value=String(cfg.minutes||10);applyExternalAutoRefresh();
    if(EXT_ASSETS.length){await refreshExternalPrices(true)}else if(st)st.textContent='외부계좌 종목 없음 · 이미지 업로드 또는 Drive 가져오기로 등록하세요.';
  }catch(e){if(st)st.textContent='외부계좌 자료 조회 실패 · '+e.message}
}
function saveExternalSettings(){LS('invest_external_drive_folder',$('externalDriveFolder').value.trim());const cfg={auto:$('externalAutoRefresh').checked,minutes:Number($('externalAutoMinutes').value)||10};LS('invest_external_settings',cfg);applyExternalAutoRefresh();$('externalStatus').textContent=cfg.auto?'자동갱신 사용 · '+cfg.minutes+'분 간격':'자동갱신 꺼짐 · 접속 및 수동 새로고침';}
function applyExternalAutoRefresh(){if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null;const cfg=LS('invest_external_settings')||{};if(cfg.auto)EXT_AUTO_TIMER=setInterval(()=>refreshExternalPrices(true),Math.max(5,Number(cfg.minutes)||10)*60000)}
async function ocrImage(file){
  if(!window.Tesseract)throw new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
  const result=await Tesseract.recognize(file,'kor+eng',{logger:m=>{if(m.status==='recognizing text')$('externalOcrProgress').textContent='이미지 인식 중 '+Math.round((m.progress||0)*100)+'%'}});
  return result.data.text||'';
}
function parseExternalOcr(text,accountType){
  const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),out=[];
  // 보수적 후보 추출: 6자리 국내 종목코드가 포함된 행만 자동 등록. 수량·평단가는 인식 숫자 중 사용자 확인이 필요.
  lines.forEach(line=>{
    const codeMatch=line.match(/(?:A\s*)?(\d{6})(?!\d)/);if(!codeMatch)return;
    const code=codeMatch[1],before=line.slice(0,codeMatch.index).replace(/[|]/g,' ').trim(),after=line.slice(codeMatch.index+codeMatch[0].length).replace(/[|]/g,' ').trim();
    const numberPattern=/(?<![A-Za-z가-힣0-9])-?\d[\d,]*(?:\.\d+)?(?![A-Za-z가-힣0-9])/g;
    // 종목명이 코드 앞에 있는 잔고표가 일반적이므로, 이 경우 종목명 속 숫자(예: KODEX200, S&P500)를 수량으로 오인하지 않도록 분리
    const name=before.replace(/[^가-힣A-Za-z0-9 ETF&+.-]/g,' ').replace(/\s+/g,' ').trim() || after.replace(numberPattern,' ').replace(/[^가-힣A-Za-z0-9 ETF&+.-]/g,' ').replace(/\s+/g,' ').trim();
    const numericArea=before?after:after;
    const nums=(numericArea.match(numberPattern)||[]).map(extNum).filter(n=>n>0);
    if(!name||nums.length<1)return;
    // 일반적인 잔고표의 수량/평균단가 열을 가정하되 자동 추정은 임시값으로 표시.
    out.push({accountType,code,name:name.slice(0,60),quantity:nums.length>=2?nums[0]:nums[0],avgPrice:nums.length>=2?nums[1]:0,source:'OCR',needsReview:true});
  });
  const seen={};return out.filter(x=>{const k=x.accountType+'_'+x.code;if(seen[k])return false;seen[k]=1;return true});
}
async function processExternalUploads(){
  const files=Array.from(($('externalImageFiles').files||[]));if(!files.length){alert('캡처 이미지를 선택하세요.');return}
  if(files.some(f=>!/^image\//.test(f.type))){alert('이미지 파일만 업로드할 수 있습니다.');return}
  const btn=$('externalUploadBtn');btn.disabled=true;let all=[];
  try{for(let i=0;i<files.length;i++){ $('externalOcrProgress').textContent=(i+1)+'/'+files.length+' 이미지 분석 중...';const text=await ocrImage(files[i]);all=all.concat(parseExternalOcr(text,$('externalAccountType').value));}
    if(!all.length){$('externalOcrProgress').textContent='종목코드와 보유정보를 인식하지 못했습니다. 선명한 잔고 화면을 다시 올리거나 아래 표에 직접 등록하세요.';return}
    EXT_ASSETS=mergeExternalRows(EXT_ASSETS,all);renderExternalAssets();$('externalOcrProgress').textContent='인식 후보 '+all.length+'개 · 수량과 평균매입가를 확인·수정한 뒤 [인식자료 저장]을 누르세요.';showExternalSaveButton();
  }catch(e){$('externalOcrProgress').textContent='이미지 인식 실패 · '+e.message}finally{btn.disabled=false}
}
function mergeExternalRows(base,add){const map={};base.forEach(x=>map[x.accountType+'_'+x.code]=x);add.forEach(x=>map[x.accountType+'_'+x.code]={...map[x.accountType+'_'+x.code],...x});return Object.values(map)}
function addExternalManual(){const accountType=$('externalAccountType').value,code=$('externalManualCode').value.trim(),name=$('externalManualName').value.trim(),quantity=extNum($('externalManualQty').value),avgPrice=extNum($('externalManualAvg').value);if(!/^\d{6}$/.test(code)||!name){alert('6자리 종목코드와 종목명을 입력하세요.');return}EXT_ASSETS=mergeExternalRows(EXT_ASSETS,[{accountType,code,name,quantity,avgPrice,source:'manual'}]);renderExternalAssets();showExternalSaveButton();$('externalManualCode').value='';$('externalManualName').value='';$('externalManualQty').value='';$('externalManualAvg').value=''}
function showExternalSaveButton(){let b=$('externalSaveBtn');if(!b){b=document.createElement('button');b.id='externalSaveBtn';b.textContent='인식자료 저장';b.onclick=saveExternalAssets;$('externalOcrProgress').after(b)}b.style.display='inline-block'}
async function importExternalDriveImages(){
  const folderId=$('externalDriveFolder').value.trim();if(!folderId){alert('Google Drive 폴더 ID를 입력하세요.');return}LS('invest_external_drive_folder',folderId);
  $('externalOcrProgress').textContent='Google Drive 폴더에서 이미지 목록을 불러오는 중...';
  try{const j=await extPost('externalDriveImages',{folderId});if(!j.images||!j.images.length)throw new Error('폴더에 이미지 파일이 없습니다.');let all=[];
    for(let i=0;i<j.images.length;i++){const im=j.images[i];$('externalOcrProgress').textContent='Drive 이미지 OCR '+(i+1)+'/'+j.images.length+' · '+im.name;const blob=await fetch('data:'+im.mimeType+';base64,'+im.base64).then(r=>r.blob());const f=new File([blob],im.name,{type:im.mimeType});all=all.concat(parseExternalOcr(await ocrImage(f),$('externalAccountType').value));}
    if(!all.length)throw new Error('종목코드가 있는 잔고 행을 인식하지 못했습니다.');EXT_ASSETS=mergeExternalRows(EXT_ASSETS,all);renderExternalAssets();$('externalOcrProgress').textContent='Drive에서 '+j.images.length+'개 이미지 확인 · 인식 후보 '+all.length+'개. 수량·평단가를 확인하세요.';showExternalSaveButton();
  }catch(e){$('externalOcrProgress').textContent='Drive 가져오기 실패 · '+e.message}
}
function renderExternalAssets(){
  const tb=$('externalAssetRows'),cards=$('externalSummaryCards');if(!tb||!cards)return;
  if(!EXT_ASSETS.length){tb.innerHTML='<tr><td colspan="9" style="text-align:center">등록된 외부계좌 종목이 없습니다.</td></tr>';cards.innerHTML='';return}
  const totals={ISA:{eval:0,cost:0,count:0,priced:0},PENSION:{eval:0,cost:0,count:0,priced:0},IRP:{eval:0,cost:0,count:0,priced:0}};
  tb.innerHTML=EXT_ASSETS.map((x,i)=>{const q=extNum(x.quantity),a=extNum(x.avgPrice),raw=EXT_PRICES[x.code]&&EXT_PRICES[x.code].price,p=raw==null?null:extNum(raw),evalAmt=p==null?0:p*q,cost=q*a,pl=p==null?null:evalAmt-cost;const t=totals[x.accountType]||totals.ISA;t.eval+=evalAmt;if(p!=null){t.cost+=cost;t.priced++}t.count++;
    return `<tr><td>${EXT_TYPES[x.accountType]||extEsc(x.accountType)}</td><td>${extEsc(x.name)}</td><td>${extEsc(x.code)}</td><td><input class="external-edit" type="number" min="0" step="any" value="${q}" onchange="editExternal(${i},'quantity',this.value)"></td><td><input class="external-edit" type="number" min="0" step="any" value="${a}" onchange="editExternal(${i},'avgPrice',this.value)"></td><td>${p==null?'<span class="external-pending">조회 대기</span>':extFmt(p)}</td><td>${p==null?'—':extFmt(evalAmt)}</td><td class="${pl==null?'neutral':pl>=0?'up':'down'}">${pl==null?'—':extFmt(pl)}</td><td><button onclick="removeExternal(${i})">삭제</button></td></tr>`;
  }).join('');
  let html=Object.keys(totals).map(k=>{const t=totals[k],pl=t.eval-t.cost;return `<div class="card"><div class="cl"><b>${EXT_TYPES[k]}</b><span>${t.count}종목 · 시세 ${t.priced}/${t.count}</span></div><div class="value">${extFmt(t.eval)}<span class="mini">원 평가금액</span></div><div class="change ${pl>=0?'up':'down'}">평가손익 ${extFmt(pl)}원</div></div>`}).join('');
  const nh={eval:0,profit:0,count:0};
  (typeof NH_ACCOUNTS!=='undefined' && Array.isArray(NH_ACCOUNTS)?NH_ACCOUNTS:[]).forEach(a=>['domestic','overseas'].forEach(k=>{const d=a[k];if(!d)return;const sm=d.summary||{},hs=d.holdings||[];const holdingEval=hs.reduce((v,h)=>v+extNum(h.evalAmount),0),holdingProfit=hs.reduce((v,h)=>v+extNum(h.profit),0);nh.eval+=extNum(sm.evalAmount)>0?extNum(sm.evalAmount):holdingEval;nh.profit+=extNum(sm.profit)!==0?extNum(sm.profit):holdingProfit;nh.count+=hs.length}));
  const extEval=Object.values(totals).reduce((v,t)=>v+t.eval,0),extProfit=Object.values(totals).reduce((v,t)=>v+t.eval-t.cost,0),extCount=Object.values(totals).reduce((v,t)=>v+t.count,0),extPriced=Object.values(totals).reduce((v,t)=>v+t.priced,0);
  const allEval=nh.eval+extEval,allProfit=nh.profit+extProfit;
  html=`<div class="card"><div class="cl"><b>NH 일반계좌</b><span>${nh.count}종목</span></div><div class="value">${extFmt(nh.eval)}<span class="mini">원 평가금액</span></div><div class="change ${nh.profit>=0?'up':'down'}">평가손익 ${extFmt(nh.profit)}원</div></div>`+html+`<div class="card" style="border-color:var(--blue)"><div class="cl"><b>전체 통합 합계</b><span>NH + 외부계좌</span></div><div class="value">${extFmt(allEval)}<span class="mini">원 평가금액</span></div><div class="change ${allProfit>=0?'up':'down'}">평가손익 ${extFmt(allProfit)}원</div><div class="mini">외부계좌 시세 확인 ${extPriced}/${extCount}종목</div></div>`;
  cards.innerHTML=html;
}
function editExternal(i,k,v){if(!EXT_ASSETS[i])return;EXT_ASSETS[i][k]=extNum(v);renderExternalAssets()}
function removeExternal(i){EXT_ASSETS.splice(i,1);renderExternalAssets();showExternalSaveButton()}
async function saveExternalAssets(){
  try{const holdings=EXT_ASSETS.map(x=>({accountType:x.accountType,code:String(x.code||''),name:String(x.name||''),quantity:extNum(x.quantity),avgPrice:extNum(x.avgPrice),source:x.source||'manual'}));
    const j=await extPost('saveExternalHoldings',{holdings});$('externalStatus').textContent='외부계좌 자료 저장 완료 · '+(j.count||holdings.length)+'종목';const b=$('externalSaveBtn');if(b)b.style.display='none';await refreshExternalPrices(true);
  }catch(e){$('externalStatus').textContent='저장 실패 · '+e.message}
}
async function refreshExternalPrices(silent){
  if(EXT_PRICE_BUSY)return;EXT_PRICE_BUSY=true;const st=$('externalStatus');try{
    if(!EXT_ASSETS.length){if(!silent&&st)st.textContent='조회할 외부계좌 종목이 없습니다.';return}
    const codes=[...new Set(EXT_ASSETS.map(x=>String(x.code||'')).filter(x=>/^\d{6}$/.test(x)))];if(!codes.length)throw new Error('6자리 국내 종목코드가 없습니다.');
    if(st)st.textContent='NH PLUG 국내주식·ETF 현재가 조회 중...';let got=0,errors=0;for(let i=0;i<codes.length;i+=40){const j=await extPost('nhExternalQuotes',{codes:codes.slice(i,i+40)});EXT_PRICES={...EXT_PRICES,...(j.prices||{})};got+=Object.keys(j.prices||{}).length;errors+=Object.keys(j.errors||{}).length;}renderExternalAssets();
    if(st)st.textContent='NH 현재가 갱신 '+new Date().toLocaleString('ko-KR')+' · '+got+'/'+codes.length+'종목'+(errors?' · 조회 실패 '+errors+'종목':'');
  }catch(e){if(st)st.textContent='현재가 조회 실패 · '+e.message}finally{EXT_PRICE_BUSY=false}
}
