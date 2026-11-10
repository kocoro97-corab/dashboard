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
  const st=$('externalStatus');try{const j=await extPost('externalHoldings');EXT_ASSETS=(Array.isArray(j.holdings)?j.holdings:[]).filter(x=>!(x.code==='485987'&&!extNum(x.quantity)&&!extNum(x.avgPrice)&&(!x.name||x.name==='--')));renderExternalAssets();
    const cfg=LS('invest_external_settings')||{auto:false,minutes:10};$('externalDriveFolder').value=LS('invest_external_drive_folder')||'';$('externalAutoRefresh').checked=!!cfg.auto;$('externalAutoMinutes').value=String(cfg.minutes||10);applyExternalAutoRefresh();
    if(EXT_ASSETS.length){await refreshExternalPrices(true)}else if(st)st.textContent='외부계좌 종목 없음 · 이미지 업로드 또는 Drive 가져오기로 등록하세요.';
  }catch(e){if(st)st.textContent='외부계좌 자료 조회 실패 · '+e.message}
}
function saveExternalSettings(){LS('invest_external_drive_folder',$('externalDriveFolder').value.trim());const cfg={auto:$('externalAutoRefresh').checked,minutes:Number($('externalAutoMinutes').value)||10};LS('invest_external_settings',cfg);applyExternalAutoRefresh();$('externalStatus').textContent=cfg.auto?'자동갱신 사용 · '+cfg.minutes+'분 간격':'자동갱신 꺼짐 · 접속 및 수동 새로고침';}
function applyExternalAutoRefresh(){if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null;const cfg=LS('invest_external_settings')||{};if(cfg.auto)EXT_AUTO_TIMER=setInterval(()=>refreshExternalPrices(true),Math.max(5,Number(cfg.minutes)||10)*60000)}
async function ocrImage(file){
  if(!window.Tesseract)throw new Error('OCR 엔진을 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
  const result=await Tesseract.recognize(file,'kor+eng',{logger:m=>{if(m.status==='recognizing text')$('externalOcrProgress').textContent='이미지 인식 중 '+Math.round((m.progress||0)*100)+'%'}});
  return result.data||{text:''};
}
// 종목코드가 없는 나무 모바일 잔고 캡처를 기본으로 지원한다.
// 계좌번호를 6자리 종목코드로 오인하지 않도록 표 헤더 이전의 숫자는 무시한다.
const EXT_KNOWN_CODES={'카카오':'035720'};
const EXT_OCR_STOP=/^(현금|종목명|구분|주식잔고|매입금액|평가금액|총자산|평가손익|수익률|매입가|현재가|잔고수량|일괄매도|자산현황|비용포함|예수금|종목코드|국내잔고|평생우대|계좌|주식잔고손익|매매손익|평가손익률|순자산|총자산|원|KRW)$/;
function extCleanName(t){return String(t||'').replace(/\s+/g,'').replace(/^[•·\-]+|[•·\-]+$/g,'').replace(/[^가-힣A-Za-z0-9&+._-]/g,'').slice(0,60)}
function extLooksLikeName(t){return /[가-힣A-Za-z]/.test(t)&&t.length>=2&&!EXT_OCR_STOP.test(t)&&!/(조회|평가|매입|손익|잔고|계좌|증권|비용|주문|설정|기준|현황|수익|총자산|예수금|일괄|매도)/.test(t)}
function extOcrRows(data){
  const words=(data.words||[]).filter(w=>w&&w.bbox&&String(w.text||'').trim());
  if(!words.length)return [];
  const W=Math.max(...words.map(w=>w.bbox.x1),1),H=Math.max(...words.map(w=>w.bbox.y1),1);
  const items=words.map(w=>({t:String(w.text||'').trim(),x0:w.bbox.x0/W,x1:w.bbox.x1/W,x:(w.bbox.x0+w.bbox.x1)/(2*W),y:(w.bbox.y0+w.bbox.y1)/(2*H)}));
  // 화면 상단 계좌번호와 요약금액은 보유종목으로 취급하지 않는다.
  const header=items.filter(w=>/종목명|잔고수량/.test(w.t)&&w.y>.20).map(w=>w.y);
  const tableStart=header.length?Math.max(...header)+.014:.42;
  const usable=items.filter(w=>w.y>tableStart&&w.y<.96);
  const grouped=[];
  usable.sort((a,b)=>a.y-b.y).forEach(w=>{
    let g=grouped.find(r=>Math.abs(r.y-w.y)<.012);
    if(!g){g={y:w.y,parts:[]};grouped.push(g)}g.parts.push(w);
  });
  return grouped.sort((a,b)=>a.y-b.y).map(g=>({y:g.y,parts:g.parts.sort((a,b)=>a.x-b.x)}));
}
function parseExternalOcr(data,accountType){
  const rows=extOcrRows(data),out=[];
  // 종목명은 첫 번째 열(왼쪽 약 30%)의 한글이며 수량/매입가는 같은 행 오른쪽 두 열에 위치.
  rows.forEach((r,i)=>{
    const left=r.parts.filter(w=>w.x<.30).map(w=>w.t).join('');
    const name=extCleanName(left);
    if(!extLooksLikeName(name))return;
    const right=r.parts.filter(w=>w.x>.56).map(w=>({x:w.x,n:extNum(w.t),raw:w.t})).filter(w=>/^\d[\d,]*$/.test(w.raw));
    // 수량은 세 번째 열, 매입가는 네 번째 열. 매입가가 OCR에서 분리되면 수정 가능하게 둔다.
    const q=right.filter(w=>w.x>.56&&w.x<.80).sort((a,b)=>a.x-b.x);
    const avg=right.filter(w=>w.x>=.80).sort((a,b)=>a.x-b.x);
    const quantity=q.length?q[0].n:0,avgPrice=avg.length?avg[0].n:0;
    // 값이 모두 없으면 종목 후보가 아닌 제목/메뉴로 판단한다.
    if(!quantity&&!avgPrice)return;
    out.push({accountType,code:EXT_KNOWN_CODES[name]||'',name,quantity,avgPrice,source:'OCR',needsReview:!quantity||!avgPrice});
  });
  // 중복 캡처는 종목명 기준으로 합치고, 수량·매입가가 더 잘 인식된 행을 선택한다.
  const map=new Map();
  out.forEach(x=>{const k=x.accountType+'|'+extCleanName(x.name),old=map.get(k);
    if(!old||Number(!!x.quantity)+Number(!!x.avgPrice)>Number(!!old.quantity)+Number(!!old.avgPrice))map.set(k,x);
  });
  return [...map.values()];
}
function showOcrReview(texts){
  let el=$('externalOcrReview');if(!el){el=document.createElement('div');el.id='externalOcrReview';$('externalOcrProgress').after(el)}
  el.innerHTML='<div class="mini" style="margin:8px 0">인식된 원문을 확인하세요. 종목코드 없는 캡처도 후보를 추출합니다. 종목명·수량·평단가를 확인하고 코드가 빈 종목은 직접 입력하세요.</div><textarea id="externalOcrRaw" rows="7" style="width:100%;box-sizing:border-box" readonly></textarea>';
  $('externalOcrRaw').value=texts.join('\n\n----- 이미지 구분 -----\n\n').slice(0,18000);
}

async function processExternalUploads(){
  const files=Array.from(($('externalImageFiles').files||[]));if(!files.length){alert('캡처 이미지를 선택하세요.');return}
  if(files.some(f=>!/^image\//.test(f.type))){alert('이미지 파일만 업로드할 수 있습니다.');return}
  const btn=$('externalUploadBtn');btn.disabled=true;let all=[],texts=[];
  try{for(let i=0;i<files.length;i++){ $('externalOcrProgress').textContent=(i+1)+'/'+files.length+' 이미지 분석 중...';const data=await ocrImage(files[i]);texts.push(data.text||'');all=all.concat(parseExternalOcr(data,$('externalAccountType').value));}
    showOcrReview(texts);if(!all.length){$('externalOcrProgress').textContent='종목을 인식하지 못했습니다. 아래 OCR 원문을 확인하고 직접 등록하세요.';return}
    EXT_ASSETS=mergeExternalRows(EXT_ASSETS,all);renderExternalAssets();$('externalOcrProgress').textContent='인식 후보 '+all.length+'개 · 수량·평균매입가를 확인·수정하고 [인식자료 저장]을 누르세요. 종목코드는 비워도 저장됩니다.';showExternalSaveButton();
  }catch(e){$('externalOcrProgress').textContent='이미지 인식 실패 · '+e.message}finally{btn.disabled=false}
}
function mergeExternalRows(base,add){const map=new Map();const key=x=>x.accountType+'_'+(String(x.name||'').replace(/\s/g,'')||x.code);base.forEach(x=>map.set(key(x),x));add.forEach(x=>{const k=key(x);const old=map.get(k)||{};map.set(k,{...old,...x,code:x.code||old.code||''})});return [...map.values()]}
function addExternalManual(){const accountType=$('externalAccountType').value,code=$('externalManualCode').value.trim(),name=$('externalManualName').value.trim(),quantity=extNum($('externalManualQty').value),avgPrice=extNum($('externalManualAvg').value);if((code&&!/^\d{6}$/.test(code))||!name){alert('종목명을 입력하고, 종목코드는 비워두거나 6자리로 입력하세요.');return}EXT_ASSETS=mergeExternalRows(EXT_ASSETS,[{accountType,code,name,quantity,avgPrice,source:'manual'}]);renderExternalAssets();showExternalSaveButton();$('externalManualCode').value='';$('externalManualName').value='';$('externalManualQty').value='';$('externalManualAvg').value=''}
function showExternalSaveButton(){let b=$('externalSaveBtn');if(!b){b=document.createElement('button');b.id='externalSaveBtn';b.textContent='인식자료 저장';b.onclick=saveExternalAssets;$('externalOcrProgress').after(b)}b.style.display='inline-block'}
async function importExternalDriveImages(){
  const folderId=$('externalDriveFolder').value.trim();if(!folderId){alert('Google Drive 폴더 ID를 입력하세요.');return}LS('invest_external_drive_folder',folderId);
  $('externalOcrProgress').textContent='Google Drive 폴더에서 이미지 목록을 불러오는 중...';
  try{const j=await extPost('externalDriveImages',{folderId});if(!j.images||!j.images.length)throw new Error('폴더에 이미지 파일이 없습니다.');let all=[],texts=[];
    for(let i=0;i<j.images.length;i++){const im=j.images[i];$('externalOcrProgress').textContent='Drive 이미지 OCR '+(i+1)+'/'+j.images.length+' · '+im.name;const blob=await fetch('data:'+im.mimeType+';base64,'+im.base64).then(r=>r.blob());const f=new File([blob],im.name,{type:im.mimeType});const data=await ocrImage(f);texts.push(data.text||'');all=all.concat(parseExternalOcr(data,$('externalAccountType').value));}
    showOcrReview(texts);if(!all.length)throw new Error('종목을 인식하지 못했습니다. 아래 OCR 원문을 보고 직접 등록하세요.');EXT_ASSETS=mergeExternalRows(EXT_ASSETS,all);renderExternalAssets();$('externalOcrProgress').textContent='Drive 이미지 '+j.images.length+'개 · 인식 후보 '+all.length+'개. 수량·평단가를 확인하고 저장하세요.';showExternalSaveButton();
  }catch(e){$('externalOcrProgress').textContent='Drive 가져오기 실패 · '+e.message}
}
function renderExternalAssets(){
  const tb=$('externalAssetRows'),cards=$('externalSummaryCards');if(!tb||!cards)return;
  if(!EXT_ASSETS.length){tb.innerHTML='<tr><td colspan="9" style="text-align:center">등록된 외부계좌 종목이 없습니다.</td></tr>';cards.innerHTML='';return}
  const totals={ISA:{eval:0,cost:0,count:0,priced:0},PENSION:{eval:0,cost:0,count:0,priced:0},IRP:{eval:0,cost:0,count:0,priced:0}};
  tb.innerHTML=EXT_ASSETS.map((x,i)=>{const q=extNum(x.quantity),a=extNum(x.avgPrice),raw=EXT_PRICES[x.code]&&EXT_PRICES[x.code].price,p=raw==null?null:extNum(raw),evalAmt=p==null?0:p*q,cost=q*a,pl=p==null?null:evalAmt-cost;const t=totals[x.accountType]||totals.ISA;t.eval+=evalAmt;if(p!=null){t.cost+=cost;t.priced++}t.count++;
    return `<tr><td>${EXT_TYPES[x.accountType]||extEsc(x.accountType)}</td><td><input class="external-edit" style="min-width:100px" value="${extEsc(x.name)}" onchange="editExternalText(${i},'name',this.value)"></td><td><input class="external-edit" style="width:92px" maxlength="6" value="${extEsc(x.code)}" placeholder="코드 확인" onchange="editExternalText(${i},'code',this.value)"></td><td><input class="external-edit" type="number" min="0" step="any" value="${q}" onchange="editExternal(${i},'quantity',this.value)"></td><td><input class="external-edit" type="number" min="0" step="any" value="${a}" onchange="editExternal(${i},'avgPrice',this.value)"></td><td>${p==null?'<span class="external-pending">조회 대기</span>':extFmt(p)}</td><td>${p==null?'—':extFmt(evalAmt)}</td><td class="${pl==null?'neutral':pl>=0?'up':'down'}">${pl==null?'—':extFmt(pl)}</td><td><button onclick="removeExternal(${i})">삭제</button></td></tr>`;
  }).join('');
  let html=Object.keys(totals).map(k=>{const t=totals[k],pl=t.eval-t.cost;return `<div class="card"><div class="cl"><b>${EXT_TYPES[k]}</b><span>${t.count}종목 · 시세 ${t.priced}/${t.count}</span></div><div class="value">${extFmt(t.eval)}<span class="mini">원 평가금액</span></div><div class="change ${pl>=0?'up':'down'}">평가손익 ${t.priced?extFmt(pl)+'원':'시세 미확인'}</div></div>`}).join('');
  const nh={eval:0,profit:0,count:0};
  (typeof NH_ACCOUNTS!=='undefined' && Array.isArray(NH_ACCOUNTS)?NH_ACCOUNTS:[]).forEach(a=>['domestic','overseas'].forEach(k=>{const d=a[k];if(!d)return;const sm=d.summary||{},hs=d.holdings||[];const holdingEval=hs.reduce((v,h)=>v+extNum(h.evalAmount),0),holdingProfit=hs.reduce((v,h)=>v+extNum(h.profit),0);nh.eval+=extNum(sm.evalAmount)>0?extNum(sm.evalAmount):holdingEval;nh.profit+=extNum(sm.profit)!==0?extNum(sm.profit):holdingProfit;nh.count+=hs.length}));
  const extEval=Object.values(totals).reduce((v,t)=>v+t.eval,0),extProfit=Object.values(totals).reduce((v,t)=>v+t.eval-t.cost,0),extCount=Object.values(totals).reduce((v,t)=>v+t.count,0),extPriced=Object.values(totals).reduce((v,t)=>v+t.priced,0);
  const allEval=nh.eval+extEval,allProfit=nh.profit+extProfit;
  html=`<div class="card"><div class="cl"><b>NH 일반계좌</b><span>${nh.count}종목</span></div><div class="value">${extFmt(nh.eval)}<span class="mini">원 평가금액</span></div><div class="change ${nh.profit>=0?'up':'down'}">평가손익 ${extFmt(nh.profit)}원</div></div>`+html+`<div class="card" style="border-color:var(--blue)"><div class="cl"><b>전체 통합 합계</b><span>NH + 외부계좌</span></div><div class="value">${extFmt(allEval)}<span class="mini">원 평가금액</span></div><div class="change ${allProfit>=0?'up':'down'}">평가손익 ${extFmt(allProfit)}원</div><div class="mini">외부계좌 시세 확인 ${extPriced}/${extCount}종목</div></div>`;
  cards.innerHTML=html;
}
function editExternalText(i,k,v){if(!EXT_ASSETS[i])return;EXT_ASSETS[i][k]=String(v).trim();EXT_ASSETS[i].needsReview=false;showExternalSaveButton();renderExternalAssets()}
function editExternal(i,k,v){if(!EXT_ASSETS[i])return;EXT_ASSETS[i][k]=extNum(v);showExternalSaveButton();renderExternalAssets()}
function removeExternal(i){EXT_ASSETS.splice(i,1);renderExternalAssets();showExternalSaveButton()}
async function saveExternalAssets(){
  try{if(EXT_ASSETS.some(x=>!x.name||!extNum(x.quantity)||!extNum(x.avgPrice))){throw new Error('종목명·수량·평균매입가가 누락된 행을 확인해 주세요. 코드는 나중에 입력해도 저장할 수 있습니다.')}const holdings=EXT_ASSETS.map(x=>({accountType:x.accountType,code:String(x.code||''),name:String(x.name||''),quantity:extNum(x.quantity),avgPrice:extNum(x.avgPrice),source:x.source||'manual'}));
    const j=await extPost('saveExternalHoldings',{holdings});$('externalStatus').textContent='외부계좌 자료 저장 완료 · '+(j.count||holdings.length)+'종목';const b=$('externalSaveBtn');if(b)b.style.display='none';await refreshExternalPrices(true);
  }catch(e){$('externalStatus').textContent='저장 실패 · '+e.message}
}
async function refreshExternalPrices(silent){
  if(EXT_PRICE_BUSY)return;EXT_PRICE_BUSY=true;const st=$('externalStatus');try{
    if(!EXT_ASSETS.length){if(!silent&&st)st.textContent='조회할 외부계좌 종목이 없습니다.';return}
    const codes=[...new Set(EXT_ASSETS.map(x=>String(x.code||'')).filter(x=>/^\d{6}$/.test(x)))];if(!codes.length){renderExternalAssets();if(st)st.textContent='종목은 저장되어 있습니다. 현재가 조회를 위해 종목코드를 입력하세요.';return;}
    if(st)st.textContent='NH PLUG 국내주식·ETF 현재가 조회 중...';let got=0,errors=0;for(let i=0;i<codes.length;i+=40){const j=await extPost('nhExternalQuotes',{codes:codes.slice(i,i+40)});EXT_PRICES={...EXT_PRICES,...(j.prices||{})};got+=Object.keys(j.prices||{}).length;errors+=Object.keys(j.errors||{}).length;}renderExternalAssets();
    if(st)st.textContent='NH 현재가 갱신 '+new Date().toLocaleString('ko-KR')+' · '+got+'/'+codes.length+'종목'+(errors?' · 조회 실패 '+errors+'종목':'');
  }catch(e){if(st)st.textContent='현재가 조회 실패 · '+e.message}finally{EXT_PRICE_BUSY=false}
}
