/* Development-only, explicit AAPL reference read. No strategy/account mutations. */
(function(root){
'use strict';
const codes=new Set('RELAY_CAPABILITY_REQUIRED ISOLATION_METADATA_MISMATCH CAPABILITY_REQUEST_FAILED REFERENCE_VALIDATED LOCAL_EVIDENCE_INVALID INVALID_CLOCK INVALID_CHART IDENTITY_CURRENCY_TIMEFRAME_MISMATCH INVALID_PROVIDER_WINDOW INVALID_OHLCV_ARRAYS INVALID_BAR_TIME TIME_GRID_MISMATCH INVALID_OHLCV TERMINAL_VOLUME_UNVERIFIED INSUFFICIENT_CLOSED_BARS_OR_VOLUME INTRADAY_READ_FAILED'.split(' '));
function evidence({phase,status,code,http,result,capability,build,now=Date.now()}={}){
 const out={schemaVersion:1,mode:'BROWSER_OBSERVED_AAPL_5M_REFERENCE',status:['PASS','PARTIAL','FAIL','NOT_RUN'].includes(status)?status:'NOT_RUN',phase:['CAPABILITY','PUBLIC_READ','VALIDATION'].includes(phase)?phase:'CAPABILITY',
  symbol:'AAPL',currency:'USD',interval:'5m',range:'1d',source:'Yahoo Finance',code:codes.has(code)?code:'LOCAL_EVIDENCE_INVALID',
  serverCapabilityObserved:capability===true,independentTransportVerification:false,realTimeVerified:false,signalReady:false,credentialsIncluded:false,scope:'THIS_REFERENCE_CHECK_ONLY',nhCalls:0,accountCalls:0,orderCalls:0};
 if(Number.isInteger(http)&&http>=100&&http<=599)out.http=http;
 if(Number.isSafeInteger(now)&&now>0)out.checkedAt=now;
 if(typeof build==='string'&&/^(?:[a-f0-9]{12}|[a-f0-9]{40})$/.test(build))out.sourceRevision=build;
 const d=result?.data,bars=d?.candles,last=Array.isArray(bars)?bars.at(-1):null;
 const valid=result?.ok===true&&d?.kind==='public-five-minute-reference-v1'&&d.instrument?.symbol==='AAPL'&&d.instrument?.currency==='USD'&&Array.isArray(bars)&&bars.length>=2&&bars.length<=1000&&Number.isSafeInteger(last?.t)&&last.t>0&&Number.isSafeInteger(d.receivedAt)&&d.receivedAt>=last.t&&d.receivedAt<=now;
 if(valid){out.bars=bars.length;out.lastBarStartAt=last.t;out.adapterReceivedAt=d.receivedAt;out.providerWindowFullyObserved=d.providerWindowFullyObserved===true}
 if(['PASS','PARTIAL'].includes(out.status)&&(!valid||!out.serverCapabilityObserved)){out.status='FAIL';out.code='LOCAL_EVIDENCE_INVALID'}
 return out;
}
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
function mount(host){
 const api=root.MYInvestFiveMinuteReadCandidateV1,transport=root.DashboardTransport;
 if(!api||!transport)return null;
 let alive=true,version=0,approved=false,pending=false,lastReport=null,lastHttp=null;
 const build=(document.querySelector('script[src*="five-minute-reference-panel-v1.js"]')?.src||'').match(/[?&]dev=([a-f0-9]{12})(?:&|$)/)?.[1];
 const token=()=>typeof LS==='function'?LS('invest_session_token'):null;
 const details=el('details'),summary=el('summary','AAPL 5분봉 참고 차트 · 최근 1일');
 details.className='five-minute-reference';details.dataset.module='five-minute-reference-v1';
 const style=el('style');style.textContent='.five-minute-reference{margin:12px 0;padding:10px;border:1px solid #465775;border-radius:9px;min-width:0}.five-minute-reference summary{cursor:pointer;min-height:36px;font-weight:700}.five-minute-reference button{min-height:40px;padding:8px 12px;margin:4px;border:1px solid #52637c;border-radius:7px;background:#172238;color:#fff}.five-minute-reference svg{display:block;width:100%;height:150px;background:#101a2a}.five-minute-reference p{overflow-wrap:anywhere;font-size:12px;color:#cbd5e1}.five-minute-reference table{width:100%;font-size:12px;border-collapse:collapse}.five-minute-reference td,.five-minute-reference th{padding:5px;text-align:right}.five-minute-reference th:first-child,.five-minute-reference td:first-child{text-align:left}';
 const read=el('button','AAPL 5분봉 조회'),close=el('button','닫기'),status=el('p','버튼을 누르면 기존 인증 중계로 조회합니다. 자동 갱신하지 않습니다.'),output=el('div');
 const copy=el('button','연결 결과 복사'),copyStatus=el('p'),fallback=el('textarea');copy.type='button';copy.disabled=true;copyStatus.setAttribute('role','status');fallback.hidden=true;fallback.readOnly=true;fallback.setAttribute('aria-label','공유용 연결 결과');fallback.style.cssText='width:100%;box-sizing:border-box;min-height:100px';
 read.type=close.type='button';status.setAttribute('role','status');output.dataset.fiveMinuteResult='empty';
 details.append(style,summary,read,close,copy,status,copyStatus,fallback,output);host.append(details);
 const reader=api.create({capability:()=>approved&&alive&&details.open&&!!token(),readJSON:async url=>{
  const run=version;
  try{const response=await transport.publicRead(url);if(alive&&run===version)lastHttp=response.status;return JSON.parse(await response.text())}
  catch(error){if(alive&&run===version&&Number.isInteger(error?.http))lastHttp=error.http;throw error}
 }});
 function clear(){version++;approved=false;pending=false;lastReport=null;lastHttp=null;copy.disabled=true;copyStatus.textContent='';fallback.hidden=true;fallback.value='';reader.invalidate();read.disabled=false;output.replaceChildren();output.dataset.fiveMinuteResult='empty'}
 function report(state){lastReport=evidence({...state,build,http:lastHttp});copy.disabled=false}
 async function copyReport(){
  if(!alive||!lastReport)return;const text=JSON.stringify(lastReport),current=version;
  try{await root.navigator.clipboard.writeText(text);if(alive&&version===current)copyStatus.textContent='인증정보를 제외한 연결 결과를 복사했습니다.'}
  catch{if(alive&&version===current){fallback.value=text;fallback.hidden=false;fallback.select();copyStatus.textContent='아래 연결 결과를 선택해 복사하세요. 인증정보는 포함되지 않습니다.'}}
 }
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
  let phase='CAPABILITY';status.textContent='중계의 승인 범위 확인 중…';
  try{
   if(!session||!transport.isRelay())throw Error('AUTH_REQUIRED');
   const response=await transport.post({action:'appVersion'});if(!valid())return;lastHttp=response.status;const meta=await response.json();
   if(!valid())return;
   if(!response.ok||meta.success!==true){status.textContent='중계 연결 응답을 확인할 수 없습니다.';report({phase,status:'FAIL',code:'CAPABILITY_REQUEST_FAILED'});return}
   if(meta.freshTestEnvironment!==true||meta.testEnvironment!=='nh-staging'){status.textContent='승인된 개발 중계 환경을 확인할 수 없습니다.';report({phase,status:'FAIL',code:'ISOLATION_METADATA_MISMATCH'});return}
   if(meta.developmentPublicMarket!==true||meta.developmentFiveMinuteReferenceVersion!==1){status.textContent='개발 중계의 AAPL 5분봉 연결이 아직 활성화되지 않았습니다.';report({phase,status:'NOT_RUN',code:'RELAY_CAPABILITY_REQUIRED'});return}
   approved=true;phase='PUBLIC_READ';lastHttp=null;status.textContent='AAPL 5분봉 수신 중…';
   const result=await reader.read('AAPL');
   if(!valid())return;
   if(!result.ok){status.textContent='5분봉 자료를 확인할 수 없습니다. 연결·종목·통화·시각·OHLCV 검증이 필요합니다.';output.dataset.fiveMinuteResult='error';report({phase:result.code==='INTRADAY_READ_FAILED'?'PUBLIC_READ':'VALIDATION',status:'FAIL',code:result.code,capability:true});return}
   render(result);status.textContent='참고 자료 수신 · 실시간 및 매매 신호 아님';report({phase:'VALIDATION',status:result.warnings.length?'PARTIAL':'PASS',code:'REFERENCE_VALIDATED',capability:true,result});
  }catch{if(valid()){output.dataset.fiveMinuteResult='error';status.textContent='5분봉 조회 실패 · 로그인 및 중계 연결 상태를 확인하세요.';report({phase,status:'FAIL',code:phase==='CAPABILITY'?'CAPABILITY_REQUEST_FAILED':'INTRADAY_READ_FAILED',capability:approved})}}
  finally{if(alive&&current===version){pending=false;read.disabled=false;approved=false}}
 }
 function closePanel(){details.open=false;clear()}
 read.addEventListener('click',load);close.addEventListener('click',closePanel);copy.addEventListener('click',copyReport);details.addEventListener('toggle',toggle);root.addEventListener('myinvest:cancel-reads',cancelled);
 return {destroy(){alive=false;clear();reader.destroy();root.removeEventListener('myinvest:cancel-reads',cancelled);read.removeEventListener('click',load);close.removeEventListener('click',closePanel);copy.removeEventListener('click',copyReport);details.removeEventListener('toggle',toggle);details.remove()}};
}
const exported=Object.freeze({mount,evidence});
if(typeof module==='object'&&module.exports)module.exports=exported;else root.MYInvestFiveMinuteReferencePanelV1=exported;
})(typeof globalThis!=='undefined'?globalThis:this);
