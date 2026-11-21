/* Local, bounded read diagnostics. Never stores request bodies, tokens or replies. */
(function(root){
'use strict';
const errors=new Map(),pending=new Map(),layers=new Set(['browser','relay','gas','nh','storage']);let serial=0;
const known=new Set('AUTH_REQUIRED RELAY_PUBLIC_URL_DENIED RELAY_PUBLIC_FAILED RELAY_RATE_LIMIT RELAY_BUSY RELAY_UPSTREAM_NETWORK RELAY_REDIRECT_DENIED RELAY_GAS_ACCESS_REQUIRED RELAY_TARGET_MISMATCH RELAY_ACCESS_CLOSED RELAY_RESPONSE_INVALID GAS_REJECTED GAS_HTTP GAS_NON_JSON NH_HTTP NH_NETWORK NH_TOKEN NH_RSP NH_NO_PRICE NH_CONTRACT NH_CONTRACT_CODE NH_CONTRACT_NAME NH_CONTRACT_EXPIRY NH_OBSERVATION NH_STALE NH_TIMEOUT NH_NETWORK_ERROR NH_RESPONSE_INVALID NH_DATA_INVALID NH_AUTH_MISSING NH_RESPONSE_REJECTED NH_UPSTREAM NH_IDENTITY_UNVERIFIED NH_IDENTITY_AMBIGUOUS NH_SYMBOL_MISMATCH NH_REFERENCE_UNAVAILABLE NH_REFERENCE_INVALID NH_NO_BLOCK NH_UNSUPPORTED NH_PATH NH_CURRENCY_MISMATCH READ_TIMEOUT READ_NETWORK READ_FORMAT READ_CANCELLED READ_QUEUE_FULL SESSION_CHANGED'.split(' '));
const identity=()=>root.crypto?.randomUUID?.()||'read-'+Date.now().toString(36)+'-'+(++serial);
function classify(error,meta={}){const http=Number.isInteger(error?.http)&&error.http>=100&&error.http<=599?error.http:null,code=known.has(error?.code)?error.code:error?.name==='AbortError'?'READ_TIMEOUT':error?.name==='SyntaxError'?'READ_FORMAT':'READ_NETWORK';let type=[502,503,504].includes(http)?'SERVER':[401,403].includes(http)?'ACCESS':['READ_TIMEOUT','NH_TIMEOUT'].includes(code)?'TIMEOUT':['READ_FORMAT','RELAY_RESPONSE_INVALID','NH_RESPONSE_INVALID','NH_DATA_INVALID'].includes(code)?'FORMAT':code==='NH_AUTH_MISSING'?'ACCESS':code==='NH_NETWORK_ERROR'?'NETWORK':code.startsWith('NH_')?'NH':code.startsWith('GAS_')?'GAS':'NETWORK';const retryable=!['READ_CANCELLED','READ_QUEUE_FULL','SESSION_CHANGED','AUTH_REQUIRED','RELAY_PUBLIC_URL_DENIED','RELAY_REDIRECT_DENIED','RELAY_GAS_ACCESS_REQUIRED','RELAY_TARGET_MISMATCH','RELAY_ACCESS_CLOSED'].includes(code)&&![401,403].includes(http)&&([502,503,504].includes(http)||['RELAY_BUSY','RELAY_UPSTREAM_NETWORK','READ_NETWORK','READ_TIMEOUT'].includes(code));return {id:meta.id||identity(),at:new Date().toISOString(),scope:meta.scope==='account'?'account':'public',layer:layers.has(error?.verifiedLayer)?error.verifiedLayer:'unknown',http,code,type,retryable,attempts:meta.attempts||1}}
function snapshot(){return [...errors.values()].map(x=>({...x}))}
// Only fixed, non-sensitive target names are exposed. Unknown keys stay unnamed.
const SAFE_TARGETS=Object.freeze({'future:k3':'KOSPI 200 선물','future:k4':'KOSDAQ 150 선물','account:nhQuotes':'NH 시세 중계','account:sessionInfo':'인증 상태'});
const TYPE_MESSAGE=Object.freeze({SERVER:'서버·중계 장애',ACCESS:'인증·권한 확인 필요',TIMEOUT:'응답 시간 초과',NETWORK:'네트워크·원천 연결 확인',FORMAT:'응답 형식·데이터 검증 실패',GAS:'GAS 중계 실패',NH:'증권사 시세 조회 실패'});
const CODE_MESSAGE=Object.freeze({
 READ_QUEUE_FULL:'조회 대기열 가득 참 · 잠시 후 새로고침',
 NH_NO_PRICE:'NH 선물 가격 미수신 · 가격·계약·원천 응답 확인 필요',
 NH_CONTRACT:'선물 계약·만기 검증 실패',NH_CONTRACT_CODE:'선물 계약코드 검증 실패',
 NH_CONTRACT_NAME:'선물 계약명 검증 실패',NH_CONTRACT_EXPIRY:'선물 만기 검증 실패',
 NH_OBSERVATION:'실제 시세 관측시각 미확인',NH_STALE:'NH 선물 자료의 관측시각이 오래됨',
 NH_SYMBOL_MISMATCH:'선물 종목식별자 불일치',NH_IDENTITY_UNVERIFIED:'선물 종목 식별 미검증',
 NH_IDENTITY_AMBIGUOUS:'선물 계약 식별 중복·불명확',NH_REFERENCE_UNAVAILABLE:'선물 검증 기준자료 미수신',
 NH_REFERENCE_INVALID:'선물 검증 기준자료 오류',NH_NO_BLOCK:'선물 응답에서 데이터 구간 미확인',
 NH_UNSUPPORTED:'선물 상품 조회 지원 여부 확인 필요',NH_PATH:'선물 조회 경로 확인 필요',
 NH_CURRENCY_MISMATCH:'시세 통화 불일치',NH_UPSTREAM:'NH 원천 데이터 응답 확인 필요'
});
const issueMessage=value=>CODE_MESSAGE[value.code]||TYPE_MESSAGE[value.type]||'원인 미확인';
const safeTarget=key=>SAFE_TARGETS[key]||'요청 범위 미확인';
const timeKST=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hourCycle:'h23',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})+' KST':'발생시각 미확인'};
function render(){
 if(typeof document==='undefined')return;
 const viewport=document.getElementById('pageViewport');if(!viewport)return;
 let panel=document.getElementById('readConnectionStatus');
 if(!errors.size){panel?.remove();return}
 if(!panel){
  panel=document.createElement('section');panel.id='readConnectionStatus';panel.className='page-note read-status-compact';
  panel.setAttribute('role','status');viewport.before(panel);
 }
 panel.replaceChildren();
 const entries=[...errors.entries()],latest=entries.at(-1),value=latest[1];
 const heading=document.createElement('strong');
 heading.textContent=(value.scope==='public'?'공개 시장':'계좌 읽기')+' 연결 상태 확인 필요 · '+safeTarget(latest[0])+' · '+issueMessage(value)+' · '+value.code;
 panel.append(heading);
 const detail=document.createElement('details'),summary=document.createElement('summary');
 summary.textContent='안전한 오류 식별 정보 '+entries.length+'건 · 코드·발생시각 보기';detail.append(summary);
 for(const [key,item] of entries){
  const line=document.createElement('p');
  line.textContent=(item.scope==='public'?'공개 시장':'계좌 읽기')+' · '+safeTarget(key)+' · '+issueMessage(item)+
   ' · '+item.code+(item.http?' · HTTP '+item.http:'')+
   ' · '+(item.layer==='unknown'?'발생 구간 미확인':item.layer+' 구간')+' · '+timeKST(item.at)+
   ' · 요청 ID '+item.id+' · '+(item.retryable?'재시도 가능':'연결/권한 점검 필요');
  detail.append(line);
 }
 panel.append(detail);
 const actions=document.createElement('div');actions.className='read-status-actions';
 const button=document.createElement('button');button.type='button';button.textContent='재연결';
 button.onclick=()=>{void root.DashboardShell?.refresh()};
 actions.append(button);
 const hint=document.createElement('small');
 hint.textContent='코드와 발생 구간만 표시하며 인증정보·계좌번호·원문 응답은 표시하지 않습니다.';
 actions.append(hint);panel.append(actions);
}
function emit(){render();root.dispatchEvent?.(new Event('myinvest:read-status'))}
function note(error,meta={}){const key=meta.key||meta.scope||'public';errors.set(key,classify(error,meta));while(errors.size>20)errors.delete(errors.keys().next().value);emit()}
function clear(key){if(key==null)errors.clear();else errors.delete(key);emit()}
function retryDelay(error,attempt,now=Date.now(),random=Math.random()){
 const raw=error?.retryAfter;let hinted=0;
 if(raw!=null){const value=String(raw).trim();hinted=/^\d+(?:\.\d+)?$/.test(value)?Number(value)*1000:Math.max(0,Date.parse(value)-now);if(!Number.isFinite(hinted))hinted=0}
 const jitter=Math.floor(Math.max(0,Math.min(1,random))*500);
 return Math.max(hinted,Math.min(8000,1000*2**(attempt-1))+jitter);
}
function waitRetry(ms,options){return new Promise((resolve,reject)=>{
 let timer;const stop=()=>{if(timer!==undefined)clearTimeout(timer);options.signal?.removeEventListener('abort',abort);root.removeEventListener?.('myinvest:cancel-reads',cancel)};
 const abort=()=>{stop();reject(Object.assign(Error('READ_CANCELLED'),{code:'READ_CANCELLED',name:'AbortError'}))};
 const cancel=()=>{if(options.current&&!options.current()){stop();reject(Object.assign(Error('SESSION_CHANGED'),{code:'SESSION_CHANGED'}))}};
 if(options.signal?.aborted){abort();return}
 options.signal?.addEventListener('abort',abort,{once:true});root.addEventListener?.('myinvest:cancel-reads',cancel);
 timer=setTimeout(()=>{stop();if(options.current&&!options.current())reject(Object.assign(Error('SESSION_CHANGED'),{code:'SESSION_CHANGED'}));else resolve()},ms);
})}
async function execute(key,operation,options={}){
 const prior=pending.get(key);if(prior&&prior.current()&&!prior.signal?.aborted&&prior.signal===options.signal)return prior.promise;
 const current=options.current||(()=>true),id=identity();
 const job=(async()=>{for(let attempt=1;attempt<=3;attempt++){
  if(!current())throw Object.assign(Error(),{code:'SESSION_CHANGED'});
  try{const result=await operation();if(!current())throw Object.assign(Error(),{code:'SESSION_CHANGED'});clear(key);return result}
  catch(error){if(!current()||options.signal?.aborted||['READ_CANCELLED','SESSION_CHANGED'].includes(error?.code))throw error;
   const safe=classify(error,{id,scope:'public',attempts:attempt});note(error,{key,id,scope:'public',attempts:attempt});
   const delay=retryDelay(error,attempt);if(attempt===3||!safe.retryable||delay>30000)throw error;
   root.DashboardTransport?.deferReads?.(delay);await waitRetry(delay,options);
  }
 }})();
 pending.set(key,{promise:job,current,signal:options.signal});try{return await job}finally{if(pending.get(key)?.promise===job)pending.delete(key)}
}

function observeResponse(response,action,current){if(typeof response?.clone!=='function')return;response.clone().json().then(value=>{if(!current())return;const key='account:'+action;if(response.ok&&value?.success===true){clear(key);return}note({http:response.status,code:value?.code||value?.diagnostic?.code,verifiedLayer:value?.layer||value?.diagnostic?.layer},{key,scope:action==='nhQuotes'?'public':'account'})}).catch(()=>{if(current())note({http:response.status,code:'READ_FORMAT'},{key:'account:'+action,scope:action==='nhQuotes'?'public':'account'})})}
root.ReadStatus=Object.freeze({execute,note,clear,snapshot,classify,observeResponse,retryDelay});
})(typeof window!=='undefined'?window:globalThis);
