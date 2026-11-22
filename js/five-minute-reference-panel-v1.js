/* Development-only, explicit AAPL reference read. No strategy/account mutations. */
(function(root){
'use strict';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
function mount(host){
 const api=root.MYInvestFiveMinuteReadCandidateV1,transport=root.DashboardTransport;
 if(!api||!transport)return null;
 let alive=true,version=0,approved=false,pending=false;
 const token=()=>typeof LS==='function'?LS('invest_session_token'):null;
 const details=el('details'),summary=el('summary','AAPL 5분봉 참고 차트 · 최근 1일');
 details.className='five-minute-reference';details.dataset.module='five-minute-reference-v1';
 const style=el('style');style.textContent='.five-minute-reference{margin:12px 0;padding:10px;border:1px solid #465775;border-radius:9px;min-width:0}.five-minute-reference summary{cursor:pointer;min-height:36px;font-weight:700}.five-minute-reference button{min-height:40px;padding:8px 12px;margin:4px;border:1px solid #52637c;border-radius:7px;background:#172238;color:#fff}.five-minute-reference svg{display:block;width:100%;height:150px;background:#101a2a}.five-minute-reference p{overflow-wrap:anywhere;font-size:12px;color:#cbd5e1}.five-minute-reference table{width:100%;font-size:12px;border-collapse:collapse}.five-minute-reference td,.five-minute-reference th{padding:5px;text-align:right}.five-minute-reference th:first-child,.five-minute-reference td:first-child{text-align:left}';
 const read=el('button','AAPL 5분봉 조회'),close=el('button','닫기'),status=el('p','버튼을 누르면 기존 인증 중계로 조회합니다. 자동 갱신하지 않습니다.'),output=el('div');
 read.type=close.type='button';status.setAttribute('role','status');output.dataset.fiveMinuteResult='empty';
 details.append(style,summary,read,close,status,output);host.append(details);
 const reader=api.create({capability:()=>approved&&alive&&details.open&&!!token(),readJSON:async url=>{
  const response=await transport.publicRead(url);return JSON.parse(await response.text());
 }});
 function clear(){version++;approved=false;pending=false;reader.invalidate();read.disabled=false;output.replaceChildren();output.dataset.fiveMinuteResult='empty'}
 function cancelled(){clear();status.textContent='화면 또는 세션 변경으로 자료를 정리했습니다.'}
 function toggle(){if(!details.open){clear();status.textContent='버튼을 누르면 기존 인증 중계로 조회합니다. 자동 갱신하지 않습니다.'}}
 const time=t=>new Date(t).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST';
 function render(result){
  const d=result.data,bars=d.candles,last=bars.at(-1),values=bars.map(b=>b.c),low=Math.min(...values),high=Math.max(...values);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 150');svg.setAttribute('role','img');svg.setAttribute('aria-label','AAPL 5분봉 종가 참고 차트 · USD');
  const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',bars.map((b,i)=>[10+i/(bars.length-1)*580,high===low?75:140-(b.c-low)/(high-low)*130].join(',')).join(' '));line.setAttribute('fill','none');line.setAttribute('stroke','#9bc8ff');line.setAttribute('stroke-width','2');svg.append(line);
  output.append(el('p','AAPL · Apple Inc. · NASDAQ (NMS) · USD · '+bars.length+'개 5분봉'),svg,
   el('p','마지막 봉 C '+last.c.toLocaleString('ko-KR',{maximumFractionDigits:4})+' USD · 봉 시작 '+time(last.t)),
   el('p','출처 Yahoo Finance · 수신 '+time(d.receivedAt)+' (이 화면 어댑터 기준; 원천 수집시각 미확인)'),
   el('p','제공처 구간 '+time(d.providerPeriodStart)+' ~ '+time(d.providerPeriodEnd)+' · '+(d.providerWindowFullyObserved?'구간 내 봉 수신':'일부 구간 미수신')),
   el('p','실시간·시장 상태·가격 확정·체결 VWAP 미검증. 종가 시점 표식과 미완성 봉은 제외합니다. 단타 신호 및 계산기 입력값으로 사용하지 않습니다.'));
  if(result.warnings.length)output.append(el('p','자료 상태: '+result.warnings.map(w=>({PROVIDER_WINDOW_NOT_FULLY_OBSERVED:'제공 구간 일부 미수신',OPEN_BAR_EXCLUDED:'미완성 봉 제외',OLD_REFERENCE_SESSION:'오래된 거래일 자료'}[w]||'추가 확인 필요')).join(' · ')));
  output.dataset.fiveMinuteResult='ready';
 }
 async function load(){
  if(!alive||pending||!details.open)return;
  clear();const current=version,session=token(),route=root.location.hash;pending=true;read.disabled=true;
  const valid=()=>alive&&current===version&&details.open&&session&&session===token()&&route===root.location.hash;
  status.textContent='중계의 승인 범위 확인 중…';
  try{
   if(!session||!transport.isRelay())throw Error('AUTH_REQUIRED');
   const response=await transport.post({action:'appVersion'}),meta=await response.json();
   if(!valid())return;
   if(!response.ok||meta.success!==true||meta.freshTestEnvironment!==true||meta.testEnvironment!=='nh-staging'||meta.developmentPublicMarket!==true||meta.developmentFiveMinuteReferenceVersion!==1){status.textContent='개발 중계의 AAPL 5분봉 연결이 아직 활성화되지 않았습니다.';return}
   approved=true;status.textContent='AAPL 5분봉 수신 중…';
   const result=await reader.read('AAPL');
   if(!valid())return;
   if(!result.ok){status.textContent='5분봉 자료를 확인할 수 없습니다. 연결·종목·통화·시각·OHLCV 검증이 필요합니다.';output.dataset.fiveMinuteResult='error';return}
   render(result);status.textContent='참고 자료 수신 · 실시간 및 매매 신호 아님';
  }catch{if(valid()){output.dataset.fiveMinuteResult='error';status.textContent='5분봉 조회 실패 · 로그인 및 중계 연결 상태를 확인하세요.'}}
  finally{if(alive&&current===version){pending=false;read.disabled=false;approved=false}}
 }
 function closePanel(){details.open=false;clear()}
 read.addEventListener('click',load);close.addEventListener('click',closePanel);details.addEventListener('toggle',toggle);root.addEventListener('myinvest:cancel-reads',cancelled);
 return {destroy(){alive=false;clear();reader.destroy();root.removeEventListener('myinvest:cancel-reads',cancelled);read.removeEventListener('click',load);close.removeEventListener('click',closePanel);details.removeEventListener('toggle',toggle);details.remove()}};
}
root.MYInvestFiveMinuteReferencePanelV1=Object.freeze({mount});
})(window);
