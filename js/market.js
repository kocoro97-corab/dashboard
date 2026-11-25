/* ===== market.js: 시세 수집 / 카드 / 보유종목 / 시나리오 / 뉴스 / 설정 ===== */
let CFG=LS('invest_cfg_v4')||JSON.parse(JSON.stringify(DEF)),MAN=LS('invest_man')||{},Q={};
// 이전에 저장된 설정에도 선물 항목을 새 방식으로 맞춤
['KR','US'].forEach(s=>CFG[s].forEach(x=>{
  if(FUT[x.id]){x.fut=FUT[x.id];x.name='코스피200 선물';delete x.y;delete x.m}
  else if(x.id==='k4'){delete x.y;delete x.m;delete x.fut;x.name='코스닥150 선물'}
}));
const FQ={},FST={},NQ={};
// ----- 나무증권(NH PLUG) 선물 시세: 서버(GAS)가 대신 조회, 로그인 토큰 필요 -----
async function nhFetch(items){
  const tk=LS('invest_session_token');
  if(!tk)return{ok:false,msg:'로그인 토큰 없음',code:'NH_AUTH_MISSING',layer:'browser'};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),25000);
  try{
    const r=await post({action:'nhQuotes',token:tk,items:items},{signal:controller.signal});
    const raw=await r.text();let j;
    try{j=JSON.parse(raw)}catch{return{ok:false,msg:'NH 중계 응답 형식 오류',code:'NH_RESPONSE_INVALID',layer:'relay',http:r.status}}
    if(!j||typeof j!=='object'||j.success!==true||r.ok===false){
      return{ok:false,msg:SafeDiagnostics.message(j),code:typeof j?.code==='string'?j.code:'NH_RESPONSE_REJECTED',layer:j?.layer||'relay',http:r.status};
    }
    if(!j.data||typeof j.data!=='object'||Array.isArray(j.data)){
      return{ok:false,msg:'NH 선물 응답 데이터 형식 오류',code:'NH_DATA_INVALID',layer:'unknown',http:r.status};
    }
    const errors={};Object.keys(j.errors||{}).filter(k=>items.some(x=>x.k===k)).forEach(k=>{errors[k]=SafeDiagnostics.message(j.errors[k],'NH_UPSTREAM')});
    return{ok:true,data:j.data,errors};
  }catch(e){
    const timedOut=e&&e.name==='AbortError';
    return{ok:false,msg:timedOut?'NH 중계 시간 초과':'NH 중계 통신 실패',code:timedOut?'NH_TIMEOUT':'NH_NETWORK_ERROR',layer:'browser'};
  }finally{clearTimeout(timeout)}
}
const FUTURE_SAFE_CODES=new Set('NH_NO_PRICE NH_CONTRACT NH_CONTRACT_CODE NH_CONTRACT_NAME NH_CONTRACT_EXPIRY NH_OBSERVATION NH_STALE NH_TOKEN NH_RSP NH_HTTP NH_NETWORK NH_TIMEOUT NH_UPSTREAM NH_IDENTITY_UNVERIFIED NH_IDENTITY_AMBIGUOUS NH_SYMBOL_MISMATCH NH_REFERENCE_UNAVAILABLE NH_REFERENCE_INVALID NH_NO_BLOCK NH_UNSUPPORTED NH_PATH NH_CURRENCY_MISMATCH'.split(' '));
function futureErrorCode(value){
 const raw=typeof value==='string'?value:typeof value?.code==='string'?value.code:typeof value?.diagnostic?.code==='string'?value.diagnostic.code:'';
 const code=/^(?:nh\s*\/\s*)?(NH_[A-Z_]+)(?:\s*\/\s*HTTP\s*[1-5][0-9]{2})?$/.exec(raw.trim())?.[1];
 return code&&FUTURE_SAFE_CODES.has(code)?code:'NH_NO_PRICE';
}
function rootFutureStatus(id,error){
 if(!window.ReadStatus)return;
 if(error===null){ReadStatus.clear('future:'+id);return}
 ReadStatus.note({code:futureErrorCode(error)},{scope:'public',key:'future:'+id});
}
async function fillNH(requested=Object.keys(NHF)){
  const validContract=d=>{if(d?.contractVerified!==true||!/^\d{8}$/.test(d.expiry||''))return false;const y=Number(d.expiry.slice(0,4)),m=Number(d.expiry.slice(4,6)),day=Number(d.expiry.slice(6,8)),date=new Date(Date.UTC(y,m-1,day)),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10).replace(/-/g,'');return date.toISOString().slice(0,10).replace(/-/g,'')===d.expiry&&d.expiry>=today&&String(y%10)===d.code?.[3]&&'123456789ABC'[m-1]===d.code?.[4]};
  const ids=[...new Set(requested.filter(id=>Object.prototype.hasOwnProperty.call(NHF,id)))],t=hms(new Date());if(!ids.length)return {ok:0,fail:0};
  const current=typeof publicReadScope==='function'?publicReadScope():()=>true;
  const scope=LS('invest_session_token'),r=await nhFetch(ids.map(id=>({k:id,t:'fut',c:NHF[id]})));if(scope!==LS('invest_session_token')||!current())return {ok:0,fail:0,discarded:true};
  if(!r.ok){ids.forEach(id=>{delete NQ[id];if(SRC[id]==='H'){delete Q[id];delete SRC[id];delete QT[id]};window.ReadStatus?.note({code:r.code,http:r.http,verifiedLayer:r.layer},{scope:'public',key:'future:'+id})});NH_STATUS='실패 · '+r.msg+' · '+t;return{ok:0,fail:ids.length}}
  let ok=0;const ds=[],er=[];
  ids.forEach(id=>{const d=r.data[id],validObservation=d&&Number.isFinite(d.observedAt)&&d.observedAt>0&&d.observedAt<=Date.now()+300000&&Date.now()-d.observedAt<=4*86400000;
    if(d&&(id!=='k4'||validObservation&&validContract(d))&&Number.isFinite(d.p)&&d.p>0&&Number.isFinite(d.prev)&&d.prev>0&&typeof d.code==='string'&&new RegExp('^'+NHF[id]+'[0-9][1-9ABC]000$').test(d.code)){NQ[id]={p:d.p,prev:d.prev,basis:d.basis,t:d.t||t,at:t,code:d.code,expiry:d.expiry||null,contractVerified:d.contractVerified===true};Q[id]={p:d.p,prev:d.prev,observedAt:d.observedAt||null,contractCode:d.code||null,expiry:d.expiry||null,contractVerified:d.contractVerified===true,observationKind:d.observationKind||null,marketState:d.marketState||'UNVERIFIED',delayStatus:d.delayStatus||'UNVERIFIED',volume:Number.isFinite(d.volume)?d.volume:null,turnover:Number.isFinite(d.turnover)?d.turnover:null};SRC[id]='H';QT[id]=Date.now();rootFutureStatus(id,null);ok++;ds.push(id+':'+d.code+'('+d.dir+')')}
    else{delete NQ[id];if(SRC[id]==='H'){delete Q[id];delete SRC[id];delete QT[id]};rootFutureStatus(id,(r.errors||{})[id]||(!d?'NH_NO_PRICE':id==='k4'&&!validObservation?'NH_OBSERVATION':id==='k4'&&!validContract(d)?'NH_CONTRACT':'NH_NO_PRICE'));er.push(id+': '+((r.errors||{})[id]||(d?'계약·관측시각 또는 시세 검증 실패':'응답 없음')))}});
  NH_STATUS='선물 '+ok+'/'+ids.length+' 성공 · '+t+(ds.length?' · '+ds.join(' '):'')+(er.length?' · 실패 '+er.join(' / '):'');
  return{ok:ok,fail:ids.length-ok};
}
// Read-only fallback priority: only adapters backed by approved provider credentials are attempted.
// NH PLUG remains the primary futures source. No quote is copied from a visual iframe.
let MARKET_SOURCE_ATTEMPTS={futures:[],tick:[]};
async function fillAuthorizedMarketSources(needFuture=true){
 const current=publicReadScope(),scope=LS('invest_session_token'),resolver=window.MyInvestMarketSourcePriority;
 if(!resolver)return;
 if(needFuture){
  if(['W','F','K','C'].includes(SRC.k4)){delete Q.k4;delete SRC.k4;delete QT.k4}
  if(!Q.k4){
  const r=await resolver.resolve('futures');if(scope!==LS('invest_session_token')||!current())return;
  MARKET_SOURCE_ATTEMPTS.futures=r.attempts;
  if(r.quote){
   const d=r.quote;Q.k4={p:d.p,prev:d.prev,observedAt:d.observedAt,contractCode:d.contractCode,expiry:d.expiry,contractVerified:true,delayed:d.delayed,stale:d.stale};
   SRC.k4=({NH_PLUG_WS:'W',NH_FUTURES:'F',KIS:'K',KOSCOM:'C'})[d.provider];QT.k4=Date.now();rootFutureStatus('k4',null);
  }
  }
 }
 const tick=await resolver.resolve('tick');if(scope!==LS('invest_session_token')||!current())return;
 MARKET_SOURCE_ATTEMPTS.tick=tick.attempts;
 if(tick.quote&&!tick.quote.stale){
  Q.TICK={p:tick.quote.p,observedAt:tick.quote.observedAt,delayed:tick.quote.delayed};
  SRC.TICK=tick.quote.provider==='IBKR'?'I':'X';QT.TICK=Date.now();
 }else if(SRC.TICK==='I'||SRC.TICK==='X'){
  delete Q.TICK;delete SRC.TICK;delete QT.TICK;
 }
}
async function fillFutures(skip){
  const current=publicReadScope();let ok=0,fail=0;
  await Promise.all(Object.keys(FUT).filter(id=>!(skip&&skip.has(id))).map(async id=>{
    const t=hms(new Date());
    try{
      const j=await getJSON('https://finance.daum.net/api/home/sec?path='+encodeURIComponent('/api/futures/'+FUT[id]));
      if(!current())return;
      const p=j&&nnum(j.tradePrice),prev=j&&nnum(j.prevClosingPrice);
      if(p==null||prev==null)throw 0;
      const k=j.kospi200&&nnum(j.kospi200.tradePrice);
      FQ[id]={p:p,prev:prev,basis:k!=null?p-k:null,t:t};FST[id]='';ok++;
      // Canonical read adapter for the V2 market cards; keep legacy FQ intact.
      Q[id]={p,prev};SRC[id]='D';QT[id]=Date.now();
       // NH can fail before the verified Daum fallback succeeds: clear the resolved visible quote error.
       // Contract/expiry remain unverified and source remains Daum (never claim NH recovery).
       rootFutureStatus(id,null);
    }catch(e){if(current()){FST[id]='수신 실패 · '+t;fail++}}
  }));
  return{ok:ok,fail:fail};
}

const isKR=c=>/^\d{6}$/.test(c);
function embed(el,name,cfg,cb){el.innerHTML='';const w=document.createElement('div');w.className='tradingview-widget-container';w.style.height='100%';
const i=document.createElement('div');i.className='tradingview-widget-container__widget';i.style.height='100%';w.appendChild(i);
const s=document.createElement('script');s.src='https://s3.tradingview.com/external-embedding/embed-widget-'+name+'.js';s.async=true;s.text=JSON.stringify(cfg);if(cb){s.onload=()=>cb(true);s.onerror=()=>cb(false)}w.appendChild(s);el.appendChild(w)}
const TABS=[['코스피','^KS11'],['코스닥','^KQ11'],['S&P500','^GSPC'],['나스닥','^IXIC'],['반도체','^SOX']];
$('tabs').innerHTML=TABS.map(t=>`<button data-y="${t[1]}" onclick="showQ('${t[1]}','${t[0]}','')">${t[0]}</button>`).join('');

const NET={log:[],ok:0,fail:0};
function publicReadScope(){
  const token=LS('invest_session_token'),route=window.location?.hash;
  const generation=typeof DashboardTransport!=='undefined'?DashboardTransport.readState?.().generation:null;
  return ()=>token===LS('invest_session_token')&&route===window.location?.hash&&generation===(typeof DashboardTransport!=='undefined'?DashboardTransport.readState?.().generation:null);
}
async function getTxt(targetUrl,options={}){
  const relay=typeof DashboardTransport!=='undefined'&&DashboardTransport.isRelay();
  const proxy=MYP();
  if(!relay&&!proxy)return null;
  const fullUrl=proxy+(proxy.includes('?')?'&':'?')+'url='+encodeURIComponent(targetUrl);
  let t=null;
  try{
    const c=relay||options.signal?null:new AbortController();t=c?setTimeout(()=>c.abort(),9000):null;
    const signal=options.signal||c?.signal;
    const r=await (typeof DashboardTransport!=='undefined'?DashboardTransport.publicRead(targetUrl,signal?{signal}:{}):fetch(fullUrl,{signal}));
    if(r.ok){const x=await r.text();if(typeof x==='string'&&x.trim()){NET.ok++;return x}}
    NET.fail++;
  }catch(e){
    if(['SESSION_CHANGED','READ_CANCELLED'].includes(e?.code))return null;
    NET.fail++;
    const family=String(targetUrl).startsWith('https://news.google.com/')?'뉴스':String(targetUrl).startsWith('https://query1.finance.yahoo.com/')?'Yahoo OHLCV':String(targetUrl).startsWith('https://m.stock.naver.com/api/stocks/theme')?'네이버 테마':'공개 시세';
    const safe=new Set(['AUTH_REQUIRED','RELAY_PUBLIC_URL_DENIED','RELAY_PUBLIC_FAILED','RELAY_RATE_LIMIT','RELAY_BUSY','RELAY_UPSTREAM_NETWORK','RELAY_REDIRECT_DENIED','RELAY_GAS_ACCESS_REQUIRED','RELAY_TARGET_MISMATCH','RELAY_ACCESS_CLOSED']);
    NET.log.push(family+' · '+(safe.has(e?.code)?e.code:e?.name==='AbortError'?'TIMEOUT':'NETWORK_OR_RESPONSE')+(Number.isInteger(e?.http)&&e.http>=100&&e.http<=599?' · HTTP '+e.http:''));
    if(NET.log.length>30)NET.log.shift();
  }finally{if(t!==null)clearTimeout(t)}
  return null;
}
async function getJSON(u){const x=await getTxt(u);try{return JSON.parse(x)}catch(e){return null}}

function openDg(){const relay=typeof DashboardTransport!=='undefined'&&DashboardTransport.isRelay();$('dgs').textContent='성공 '+NET.ok+'회 · 실패 '+NET.fail+'회'+(relay?' · 중계 연결':'');$('dgl').textContent=['NH 나무증권: '+NH_STATUS,'출처별 수신: '+srcSummary(Object.keys(Q)),'--- 통신 기록'].concat(NET.log.length?NET.log:['기록 없음']).join('\n');$('dgp').value=relay?window.MYINVEST_TRANSPORT_CONFIG.endpoint:MYP();$('dgp').readOnly=relay;const save=$('saveProxyBtn');if(save)save.disabled=relay;$('dg').classList.add('on')}
function closeDg(){$('dg').classList.remove('on')}
function saveProxy(){if(typeof DashboardTransport!=='undefined'&&DashboardTransport.isRelay())return;LS('invest_myproxy',$('dgp').value.trim());NET.ok=0;NET.fail=0;closeDg();refresh();loadNews();THM_AT=0;fetchTopThemes()}

const nnum=v=>{const n=parseFloat(String(v==null?'':v).replace(/[,+\s]/g,''));return isFinite(n)?n:null};
function nsgn(o,ch){if(ch==null)return ch;const c=(o&&(o.compareToPreviousPrice||o.fluctuationsType))||{},cd=String(c.code||''),tx=String(c.name||'')+String(c.text||'');
const dn=cd==='4'||cd==='5'||/FALL|하락|하한/.test(tx),up=cd==='1'||cd==='2'||/RIS|상승|상한/.test(tx);return dn?-Math.abs(ch):up?Math.abs(ch):ch}
function nq(o){if(!o)return null;const p=nnum(o.closePrice??o.calcPrice);if(p==null)return null;const ch=nsgn(o,nnum(o.compareToPreviousClosePrice??o.fluctuations));return{p:p,prev:ch==null?null:p-ch}}
const narr=j=>Array.isArray(j)?j:j?(j.datas||j.result||j.data||j.items||Object.values(j).find(Array.isArray)||((j.closePrice||j.calcPrice)?[j]:[])):[];
let INV=null;const SRC={};
// ----- 시세 출처 표시: N=네이버 · Y=Yahoo · D=다음 · H=NH(나무증권) · M=수동 -----
const QT={};   // 종목별 마지막 수신 시각
const SRC_NAME={N:'네이버',Y:'Yahoo',D:'다음',H:'NH 나무증권',W:'NH PLUG 실시간',F:'NH선물',K:'한국투자증권',C:'코스콤',I:'IBKR',X:'dxFeed',M:'수동'},SRC_SHORT={N:'네',Y:'Y',D:'다',H:'NH',W:'NH-WSS',F:'NH선물',K:'KIS',C:'코스콤',I:'IBKR',X:'dx',M:'수'};
let NH_STATUS='아직 연결 전';   // 나무증권 연동 상태 (🩺 진단에 표시)
const srcTag=(k,full)=>{const s=SRC[k];if(!s||!Q[k])return '';return full?(SRC_NAME[s]||s)+(QT[k]?' · '+hms(new Date(QT[k])):''):(SRC_SHORT[s]||s)};
const srcSummary=keys=>{const c={};keys.forEach(k=>{const s=SRC[k];if(Q[k]&&s)c[s]=(c[s]||0)+1});return Object.keys(c).map(s=>(SRC_NAME[s]||s)+' '+c[s]).join(' · ')||'수신 없음'};
const srcLine=t=>t?`<div class="mini" style="font-size:9px;margin-top:2px;opacity:.75">출처 ${t}</div>`:'';

async function fillNaver(want,fr,onQuote=null){
  const current=publicReadScope(),W=new Set(want),T=[];let n=0;
  const put=(k,o)=>{const q=nq(o);if(current()&&q&&W.has(k)){Q[k]=q;SRC[k]='N';QT[k]=Date.now();fr.add(k);n++;if(typeof onQuote==='function')onQuote(k)}};
  [['^KS11','KOSPI'],['^KQ11','KOSDAQ']].forEach(([k,c])=>{if(W.has(k))T.push(getJSON('https://polling.finance.naver.com/api/realtime/domestic/index/'+c).then(j=>put(k,narr(j)[0])))});
  const wi={'.INX':'^GSPC','.IXIC':'^IXIC','.DJI':'^DJI','.SOX':'^SOX','.VIX':'^VIX'},wk=Object.keys(wi).filter(c=>W.has(wi[c]));
  if(wk.length)T.push(getJSON('https://stock.naver.com/api/polling/worldstock/index?reutersCodes='+wk.join(',')).then(j=>narr(j).forEach((o,i)=>{const rc=o.reutersCode||o.symbolCode||wk[i];if(wi[rc])put(wi[rc],o)})));
  [['majors/rpc',{FX_USDKRW:'KRW=X','.DXY':'DX-Y.NYB'}],['majors/bond',{'US10YT=RR':'^TNX'}],['energy',{CLcv1:'CL=F',LCOcv1:'BZ=F'}]].forEach(([ep,m])=>{
  if(Object.values(m).some(k=>W.has(k)))T.push(getJSON('https://stock.naver.com/api/securityService/marketindex/'+ep).then(j=>narr(j).forEach(o=>{const k=m[o.reutersCode];if(k)put(k,o)})))});
  const kr=want.filter(isKR);for(let i=0;i<kr.length;i+=20){const g=kr.slice(i,i+20);
  T.push(getJSON('https://polling.finance.naver.com/api/realtime/domestic/stock/'+g.join(',')).then(j=>{const a=narr(j);g.forEach((c,k)=>put(c,a.find(d=>Object.values(d).some(v=>v===c))||(a.length===g.length?a[k]:null)))}))}
  T.push(getJSON('https://stock.naver.com/api/securityFe/api/index/KOSPI/integration').then(j=>{const d=j&&j.dealTrendInfo;if(d)INV={f:d.foreignValue,i:d.institutionalValue,p:d.personalValue,d:d.bizdate}}));
  await Promise.all(T.map(t=>t.catch(e=>{})));
  return n;
}

async function quote(s){
  const j=await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(s)+'?interval=1d&range=1d');
  const m=j&&j.chart&&j.chart.result&&j.chart.result[0]&&j.chart.result[0].meta;if(!m||String(m.symbol||'').toUpperCase()!==s.toUpperCase()||!Number.isFinite(m.regularMarketPrice)||m.regularMarketPrice<=0)return null;
  return{p:m.regularMarketPrice,prev:m.chartPreviousClose!=null?m.chartPreviousClose:m.previousClose,observedAt:Number.isFinite(m.regularMarketTime)?m.regularMarketTime*1000:null};
}
const KY={};
async function quoteKR(c){for(const x of['.KS','.KQ']){const q=await quote(c+x);if(q){KY[c]=c+x;return q}}return null}

async function fillQuotes(list,onQuote=null){
  const current=publicReadScope();let i=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(i<list.length){
      if(!current())return;
      const c=list[i++];
      const q=await(isKR(c)?quoteKR(c):quote(c));
      if(!current())return;
      if(q){Q[c]=q;SRC[c]='Y';QT[c]=Date.now();if(typeof onQuote==='function')onQuote(c)}else if(Q[c])Q[c].refreshFailed=true;
    }
  }));
}

let MK_BUSY=false;
async function refreshMarket(requested=[]){   // '시장 종합' 카드(지수·선물·수급)만 갱신
  if(MK_BUSY)return;MK_BUSY=true;const current=publicReadScope();
  const btn=$('mkBtn'),st=$('mkSt');
  if(btn){btn.disabled=true;btn.textContent='갱신 중...'}
  try{
    const extra=Array.isArray(requested)?requested.filter(s=>typeof s==='string'&&/^[A-Za-z0-9^=.-]{1,32}$/.test(s)&&!['k3','k4','TICK'].includes(s)).slice(0,24):[];
    const list=CFG[sess()],want=[...new Set([...list.filter(x=>x.y).map(x=>x.y),...extra])],fr=new Set();
    // Paint the first verified quote while the slower sources continue.
    // A route/session change must not update the old screen.
    let firstVisible=false;
    const firstQuote=()=>{if(firstVisible||!current())return;firstVisible=true;renderCards();updateTickGauge()};
    await fillNaver(want,fr,firstQuote);if(!current())return;
    await fillQuotes(want.filter(c=>!fr.has(c)),firstQuote);if(!current())return;
    if(!firstVisible&&want.some(c=>Q[c]))firstQuote();
    const requestedNH=[...new Set([...list.filter(x=>NHF[x.id]).map(x=>x.id),...(Array.isArray(requested)?requested:[]).filter(id=>NHF[id])])],hasNH=requestedNH.length>0,nh=hasNH?await fillNH(requestedNH):{ok:0,fail:0};if(!current())return;
    const hasFut=list.some(x=>x.fut)||Array.isArray(requested)&&requested.includes('k3'),fu=hasFut?await fillFutures(new Set(Object.keys(NQ))):{ok:0,fail:0};if(!current())return;
    await fillAuthorizedMarketSources(requestedNH.includes('k4'));
    const got=want.filter(c=>Q[c]).length;
    renderCards();updateTickGauge();generateScenario();
    st.textContent='갱신 '+hms(new Date())+' · 성공 '+got+'/'+want.length+(hasNH?' · 선물 NH '+nh.ok+'/'+(nh.ok+nh.fail):'')+(fu.ok+fu.fail?' · 다음 '+fu.ok+'/'+(fu.ok+fu.fail):'')+' · 출처 '+srcSummary(want);
  }catch(e){
    if(st)st.textContent='갱신 실패 '+hms(new Date());
  }finally{
    MK_BUSY=false;
    if(btn){btn.disabled=false;btn.textContent='↻ 지수 갱신'}
  }
}
function manualRefresh(){THM_AT=0;refresh();loadNews()}
async function refresh(){
  $('status').textContent='시세 갱신 중...';
  const want=new Set();['KR','US'].forEach(s=>CFG[s].forEach(x=>x.y&&want.add(x.y)));H.forEach(r=>r[7]&&want.add(r[7]));
  const all=[...want],fr=new Set();
  await fillNaver(all,fr);
  await fillQuotes(all.filter(c=>!fr.has(c)));
  const nh=await fillNH();
  const fu=await fillFutures(new Set(Object.keys(NQ)));
  await fillAuthorizedMarketSources(true);
  const got=all.filter(c=>Q[c]).length;
  renderCards();fetchTopThemes();renderThemes();updateTickGauge();generateScenario();
  $('status').textContent='시세 갱신 '+hms(new Date())+' · 성공 '+got+' · 실패 '+(all.length-got)+'건 · 선물 NH '+nh.ok+'/'+(nh.ok+nh.fail)+(fu.ok+fu.fail?' · 다음 '+fu.ok+'/'+(fu.ok+fu.fail):'')+' · 출처 '+srcSummary(all);
  if($('mkSt'))$('mkSt').textContent='갱신 '+hms(new Date())+' · 전체 갱신 · 선물 NH '+nh.ok+'/'+(nh.ok+nh.fail)+(fu.ok+fu.fail?' · 다음 '+fu.ok+'/'+(fu.ok+fu.fail):'');
}

const nf=(v,d=2)=>v==null?'—':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
const sess=()=>{const h=new Date().getHours();return h>=7&&h<21?'KR':'US'};

function renderCards(){
  const s=sess(),b=$('sessionBadge');
  if(s==='KR'){b.className='badge badge-kr';b.textContent='🇰🇷 한국장';$('mt').textContent='시장 종합 · 코스피, 코스닥, 선물, 나스닥';$('ms').textContent='지수, 선물, 달러/원, 수급'}
  else{b.className='badge badge-us';b.textContent='🇺🇸 미국장';$('mt').textContent='시장 종합 · S&P500, 나스닥, SOX, VIX';$('ms').textContent='지수, 선물, 금리, 유가'}
  $('cards').innerHTML=CFG[s].filter(x=>x.vis).map(x=>{
    let v='—',c='불러오는 중',d=0;
    if(x.inv){
      const r=INV?nnum(INV[{foreign:'f',inst:'i',personal:'p'}[x.inv]]):null;
      if(r!=null){v=(r>=0?'+':'')+nf(r,0)+'억';c=(r>=0?'순매수':'순매도')+' · '+(INV.d||'');d=r>0?1:r<0?-1:0}
    }else if(NQ[x.id]){
      const f=NQ[x.id],df=f.p-f.prev,pc=f.prev?df/f.prev*100:0;d=df>0?1:df<0?-1:0;v=nf(f.p);c=(pc>=0?'+':'')+nf(pc)+'%'+(f.basis!=null?' · 베이시스 '+(f.basis>=0?'+':'')+nf(f.basis):'')+' · '+f.t;
    }else if(x.fut){
      const f=FQ[x.id];
      if(f){const df=f.p-f.prev,pc=df/f.prev*100;d=df>0?1:df<0?-1:0;v=nf(f.p);c=(pc>=0?'+':'')+nf(pc)+'%'+(f.basis!=null?' · 베이시스 '+(f.basis>=0?'+':'')+nf(f.basis):'')+' · '+(FST[x.id]||f.t)}
      else c=FST[x.id]||'불러오는 중';
    }else if(NHF[x.id]){const q=Q[x.id];if(q&&Number.isFinite(q.p)&&Number.isFinite(q.prev)&&q.prev>0){v=nf(q.p);const pc=(q.p/q.prev-1)*100;d=pc>0?1:pc<0?-1:0;c=(pc>=0?'+':'')+nf(pc)+'% · '+(q.stale?'마지막 관측(지연 가능)':'관측 시각 확인')}else c='선물 시세 미수신 · 연결 진단에서 사유 확인'}
    else if(x.m){v=MAN[x.id]||'입력';c='직접 입력'}
    else{
      const q=Q[x.y];if(q){const df=q.p-q.prev,pc=df/q.prev*100;d=df>0?1:df<0?-1:0;
      if(x.t==='yld'){v=nf(q.p)+'%';c=(df>=0?'+':'')+nf(df)+'p'}
      else if(x.t==='fx'){v=nf(q.p);c=(df>=0?'+':'')+nf(df)+' ('+nf(pc)+'%)'}
      else{v=nf(q.p);c=(pc>=0?'+':'')+nf(pc)+'%'}}
    }
    const tag=x.inv?(INV?'네이버':''):NQ[x.id]?'NH 나무증권 · '+NQ[x.id].at:x.fut?(FQ[x.id]?'다음':''):NHF[x.id]?(SRC_NAME[SRC[x.id]]||'NH 선물 미수신'):x.m?'수동 입력':srcTag(x.y,true);
    return `<div class="card" style="cursor:pointer" onclick="${x.inv||x.fut||NHF[x.id]||NQ[x.id]?'':x.m?`manIn('${x.id}')`:`openQ('${x.id}')`}"><div class="cl"><span>${x.name}</span><span>${x.inv||x.fut||NQ[x.id]?'':x.m?'✎':'📈'}</span></div><div class="value">${v}</div><div class="change ${d>0?'up':d<0?'down':'neutral'}">${c}</div>${srcLine(tag)}</div>`
  }).join('')
}

function manIn(id){const v=prompt('값을 입력하세요',MAN[id]||'');if(v===null)return;MAN[id]=v;LS('invest_man',MAN);renderCards()}

function renderHoldings(){
  if(!$('af')||!$('hd')||!$('ps'))return;
  const f=$('af').value,rows=H.filter(r=>f==='all'||r[0]===f);
  const calc=r=>{const q=Q[r[7]];if(!q)return{cur:r[4],pl:r[5],rt:r[6],live:0};return{cur:q.p,pl:(q.p-r[3])*r[2],rt:(q.p/r[3]-1)*100,live:1}};
  $('hd').innerHTML=rows.map(r=>{
    const k=calc(r),cl=v=>v==null?'':v>=0?'up':'down';
    return `<tr><td>${esc(r[0])}</td><td class="name" ${r[7]?`onclick="showH(${H.indexOf(r)})"`:''}>${esc(r[1])}</td><td>${nf(r[2])}</td><td>${nf(r[3])}</td><td>${nf(k.cur)}${k.live?' <span class="up">●</span> <span class="mini" style="font-size:8px;opacity:.7">'+srcTag(r[7])+'</span>':' <span class="mini" style="font-size:8px;opacity:.7">기준</span>'}</td><td class="${cl(k.pl)}">${nf(k.pl,0)}</td><td class="${cl(k.rt)}">${k.rt==null?'—':k.rt.toFixed(2)+'%'}</td></tr>`
  }).join('');
  const accs=[...new Set(rows.map(r=>r[0]))];
  $('ps').innerHTML=accs.map(a=>{
    const rs=H.filter(r=>r[0]===a),tot=rs.reduce((s,r)=>s+(calc(r).pl||0),0),us=a==='해외주식';
    return `<div class="card"><div class="cl"><span>${esc(a)}</span><span>${rs.length}개 종목</span></div><div class="value ${tot>=0?'up':'down'}" style="font-size:14px">${nf(tot,us?2:0)}${us?' $':' 원'}</div><div class="mini">평가손익 합계</div></div>`
  }).join('')
}

const TS={w:'wait',wAt:null,g:null,gAt:null};
const hms=d=>{if(!d)return'—';const p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())};   // HH:MM:SS 고정 형식
function tickStatus(){
  const el=$('tickSt');if(!el)return;
  const c=ok=>ok===true?'#4ade80':ok===false?'var(--red)':'var(--amber)';
  const wo=TS.w==='ok'?true:TS.w==='fail'?false:null,wl=wo===true?'프레임 수신':wo===false?'실패':'대기';
  const g=TS.g;
  el.innerHTML='참고 위젯 <b style="color:'+c(wo)+'">'+wl+'</b> · '+hms(TS.wAt)+'<br>게이지 <b style="color:'+c(g?g.ok:null)+'">'+(g?(g.src==='직접 입력'?'수동 입력':g.ok?'관측 확인':'미연결'):'미확인')+'</b> · '+(g?g.src:'')+' · '+hms(TS.gAt);
}
function updateTickGauge(){
  if($('tin').value)return; // Manual entries remain explicit and are never copied to Q.TICK.
  const q=Q.TICK,source=({I:'IBKR',X:'dxFeed'})[SRC.TICK],at=q?.observedAt,now=Date.now();
  const valid=source&&Number.isInteger(q?.p)&&Math.abs(q.p)<=5000&&Number.isFinite(at)&&at>0&&at<=now+60000&&now-at<=120000;
  if(!valid){TS.g={ok:false,src:'숫자 API 미연결 · TradingView 참고용'};TS.gAt=null;$('tm').hidden=true;$('tl2').textContent='실제 TICK 수치 미연결';tickStatus();return}
  TS.g={ok:true,src:source+' · 검증된 관측값'};TS.gAt=new Date(at);$('tm').hidden=false;
  $('tm').style.left='calc('+((Math.max(-1000,Math.min(1000,q.p))+1000)/20)+'% - 1px)';
  $('tl2').textContent='관측값: '+q.p+' · '+(q.p>=600?'매수 우위':q.p<=-600?'매도 우위':'±600 범위 안');
  tickStatus();
}

function generateScenario(){
  const h=new Date().getHours(),isDay=h>=7&&h<21;
  const qK=Q['^KS11'],qQ=Q['^KQ11'],qN=Q['^IXIC'],qS=Q['^GSPC'];
  const getP=q=>q&&Number.isFinite(q.p)&&q.p>0&&Number.isFinite(q.prev)&&q.prev>0?((q.p/q.prev-1)*100).toFixed(2)+'%':'미확인';
  const txt=isDay?`[📊 한국장 주간 시나리오]\n• 코스피(${getP(qK)}), 코스닥(${getP(qQ)})\n• 주도 테마 수급 집중 구간, 5일선 눌림목 중심 대응.`:`[🌙 미국장 야간 시나리오]\n• 나스닥(${getP(qN)}), S&P500(${getP(qS)})\n• 필라델피아 반도체 및 빅테크 흐름 연동 대응.`;
  $('gv').textContent=txt;
  $('gptTime').textContent=new Date().toLocaleTimeString('ko-KR')+' 생성';
}
function copyScenario(){navigator.clipboard.writeText($('gv').textContent).then(()=>alert('복사되었습니다.'))}
function refreshScenario(){generateScenario()}

const openKR=()=>{const n=new Date(),m=n.getHours()*60+n.getMinutes(),d=n.getDay();return d>0&&d<6&&m>=540&&m<=930},openUS=()=>{const n=new Date(),m=n.getHours()*60+n.getMinutes();return m>=1350||m<=360};
const esc=v=>String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const ago=d=>{const m=(Date.now()-d)/60000;return m<1?'방금':m<60?Math.floor(m)+'분 전':Math.floor(m/1440)+'일 전'};

async function fetchNews(q){
  const x=await getTxt('https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=ko&gl=KR&ceid=KR:ko');if(!x)return null;
  const d=new DOMParser().parseFromString(x,'text/xml');if(d.querySelector('parsererror')||!d.querySelector('rss,feed'))return null;
  return[...d.querySelectorAll('item')].map(i=>{const g=t=>{const e=i.querySelector(t);return e?e.textContent:''};return{t:g('title'),l:g('link'),s:g('source'),d:new Date(g('pubDate')||NaN)}})
}

async function loadNews(){
  $('nst_mk').textContent='불러오는 중...';$('nst_hd').textContent='불러오는 중...';
  // Independent read-only feeds can load concurrently; each retains its own failure state.
  const [mks,hds]=await Promise.all([
    fetchNews('코스피 OR 증시 OR 나스닥 when:2d'),
    fetchNews('(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d')
  ]);
  const renderN=(list,el,stEl)=>{
    if(!Array.isArray(list)){$(el).replaceChildren();$(stEl).textContent='뉴스 수신 실패 · 미확인';return}
    const m={};list.forEach(a=>{const k=a.t.replace(/\s-\s[^-]+$/,'');if(!m[k]||a.d>m[k].d)m[k]={t:k,l:a.l,s:a.s,d:a.d}});
    const arr=Object.values(m).sort((a,b)=>b.d-a.d).slice(0,6);
    $(el).innerHTML=arr.length?arr.map(a=>`<div class="news" data-news-published="${Number.isFinite(a.d.getTime())&&a.d.getTime()<=Date.now()+300000?a.d.toISOString():''}"><strong><a href="${escA(/^https:\/\//i.test(String(a.l))?a.l:'#')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(a.t)}</a></strong><span class="mini">${esc(a.s)} · ${Number.isFinite(a.d.getTime())&&a.d.getTime()<=Date.now()+300000?esc(a.d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}))+' KST':'게시시각 미확인'}</span></div>`).join(''):'<div class="mini">기사 없음</div>';
    $(stEl).textContent=arr.length?arr.length+'건':'없음';
  };
  renderN(mks,'nl_mk','nst_mk');renderN(hds,'nl_hd','nst_hd');
}

function setTick(){
  const v=parseFloat($('tin').value);LS('invest_tick',$('tin').value);
  if(isNaN(v)){updateTickGauge();return}
  $('tm').style.left='calc('+((Math.max(-1000,Math.min(1000,v))+1000)/20)+'% - 1px)';   // tv → v 수정
  $('tm').hidden=false;$('tl2').textContent='입력값: '+v;TS.g={ok:true,src:'직접 입력'};TS.gAt=new Date();tickStatus();
}

let cur='KR';
function openModal(){swTab(sess());$('mo').classList.add('on')}
function closeModal(){$('mo').classList.remove('on')}
function swTab(t){cur=t;$('tKR').classList.toggle('active',t==='KR');$('tUS').classList.toggle('active',t==='US');
$('sl').innerHTML=CFG[t].map((x,i)=>`<div class="si"><label><input type="checkbox" ${x.vis?'checked':''} onchange="CFG[cur][${i}].vis=this.checked?1:0"> <b>${x.name}</b></label><span><button class="sm" onclick="mv(${i},-1)">▲</button> <button class="sm" onclick="mv(${i},1)">▼</button> <button class="sm" style="color:var(--blue)" onclick="CFG[cur].splice(${i},1);swTab(cur)">✕</button></span></div>`).join('')}
function mv(i,d){const a=CFG[cur],j=i+d;if(j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];swTab(cur)}
function addItem(){const n=prompt('항목 이름:');if(!n)return;const y=prompt('Yahoo 심볼 (예: AAPL, 005930.KS):');if(!y)return;
CFG[cur].push({id:'c'+Date.now(),name:n,y:y,tv:'NASDAQ:'+y,vis:1});swTab(cur)}
function resetSettings(){CFG=JSON.parse(JSON.stringify(DEF));LS('invest_cfg_v4',CFG);swTab(cur);renderCards();refresh()}
function saveSettings(){LS('invest_cfg_v4',CFG);renderCards();closeModal();refresh()}

// ----- NH 나무 일반계좌 잔고 조회(조회 전용) -----
let NH_ACCOUNTS = [];
let NH_ACCOUNT_BUSY = false;
let NH_ACCOUNT_RUN=0;
const nhMoney = v => v==null ? '—' : Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
const nhSafe = v => String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function mergeNhAccountResultsV2(previous,incoming){
  if(!Array.isArray(incoming))throw Error('NH_CONTRACT');
  const old=new Map((previous||[]).filter(a=>typeof a.accountKey==='string'&&a.accountKey).map(a=>[a.accountKey,a]));
  return incoming.map(a=>{
    const result={...a},before=old.get(a.accountKey);
    if(before)for(const market of ['domestic','overseas']){
      if(!result[market]&&before[market])result[market]={...before[market],stale:true};
      else if(result[market]&&result[market].partial&&before[market]){
        const rows=new Map((before[market].holdings||[]).map(h=>[h.code+'|'+h.currency,h]));
        (result[market].holdings||[]).forEach(h=>rows.set(h.code+'|'+h.currency,h));
        result[market]={...result[market],holdings:[...rows.values()],stale:true};
      }
    }
    return result;
  });
}
async function loadNHAccounts(){
  if(NH_ACCOUNT_BUSY)return;NH_ACCOUNT_BUSY=true;const run=++NH_ACCOUNT_RUN;
  const btn=$('nhAccountBtn'),st=$('nhAccountStatus');
  if(btn){btn.disabled=true;btn.textContent='조회 중...'}
  if(st)st.textContent='NH 일반계좌 및 국내·해외 잔고 조회 중...';
  try{
    const tk=LS('invest_session_token');
    if(!tk)throw new Error('로그인이 필요합니다.');
    const res=await post({action:'nhAccounts',token:tk});
    const data=JSON.parse(await res.text());
    if(run!==NH_ACCOUNT_RUN||tk!==LS('invest_session_token'))return;
    if(!data.success){
      throw Object.assign(new Error(''),{diagnostic:SafeDiagnostics.diagnostic(data)});
    }
    NH_ACCOUNTS=mergeNhAccountResultsV2(NH_ACCOUNT_SESSION===tk?NH_ACCOUNTS:[],data.accounts).filter(a=>['domestic','overseas'].some(k=>Array.isArray(a[k]&&a[k].holdings)&&a[k].holdings.length>0)).map(a=>({...a,errors:(Array.isArray(a.errors)?a.errors:[]).map(x=>SafeDiagnostics.message(x,'NH_UPSTREAM'))}));
    NH_ACCOUNT_UPDATED=data.updatedAt||'';
    NH_ACCOUNT_FETCHED_AT=Date.now();
    NH_ACCOUNT_SESSION=tk;
    renderNHAccounts();
    if(typeof extSyncWithNH==='function')extSyncWithNH();
    const count=NH_ACCOUNTS.length;
    if(st)st.textContent='조회 '+(NH_ACCOUNT_UPDATED||hms(new Date()))+' · 일반계좌 '+count+'개 · 모의계좌 제외'+(NH_ACCOUNTS.some(a=>['domestic','overseas'].some(k=>a[k]&&(a[k].stale||a[k].partial)))?' · 일부 이전 조회값 유지':'')+(data.gatewayVersion===2?' · ISA·연금저축·IRP: OCR·수동 관리(직접조회 미검증)':'');
  }catch(e){if(run!==NH_ACCOUNT_RUN)return;if(st)st.textContent='조회 실패(기존 조회값 유지) · '+SafeDiagnostics.message(e,'FRONTEND_NETWORK');if(typeof renderExternalAssets==='function')renderExternalAssets()}
  finally{if(run===NH_ACCOUNT_RUN){NH_ACCOUNT_BUSY=false;if(btn){btn.disabled=false;btn.textContent='↻ 계좌 잔고 조회'}}}
}
let NH_ACCOUNT_UPDATED='';
let NH_ACCOUNT_FETCHED_AT=0;
let NH_ACCOUNT_SESSION='';
function renderNHAccounts(){
  const cards=$('nhAccountCards'),tbody=$('nhAccountRows');if(!cards||!tbody)return;
  if(!NH_ACCOUNTS.length){cards.innerHTML='';tbody.innerHTML='<tr><td colspan="10" style="text-align:center">조회된 일반계좌가 없습니다.</td></tr>';if(typeof renderExternalAssets==='function')renderExternalAssets();return}
  const filter=$('nhAssetFilter')?$('nhAssetFilter').value:'all';
  const rows=[];let cardHtml='';
  NH_ACCOUNTS.forEach(a=>{
    [['domestic','국내주식',a.domestic],['overseas','해외주식',a.overseas]].forEach(([key,label,d])=>{
      if(!d||!Array.isArray(d.holdings)||!d.holdings.length)return;
      const sm=d.summary||{},hs=Array.isArray(d.holdings)?d.holdings:[];
      const money=sm.evalAmount,profit=sm.profit,dep=sm.deposit;
      cardHtml+=`<div class="card"><div class="cl"><span>일반계좌 · ${label}</span><span>${hs.length}종목${d.stale?' · 이전 조회값':d.partial?' · 부분 조회':''}</span></div><div class="value">${nhMoney(money)}<span class="mini"> 원 평가금액</span></div><div class="change ${profit>0?'up':profit<0?'down':'neutral'}">손익 ${nhMoney(profit)}원${sm.returnRate!=null?' · '+Number(sm.returnRate).toFixed(2)+'%':''}</div><div class="mini">예수금 ${nhMoney(dep)}원 · 계좌유형 ${a.acctType==='02'?'주문대리인':'일반'}</div></div>`;
      if(filter==='all'||filter===key)hs.forEach(h=>rows.push({a:'일반계좌',market:label,h:h}));
    });
    if(a.errors&&a.errors.length)cardHtml+=`<div class="mini" style="grid-column:1/-1;color:var(--amber)">일반계좌 조회 안내: ${nhSafe(a.errors.map(x=>SafeDiagnostics.message(x,'NH_UPSTREAM')).join(' / '))}</div>`;
  });
  cards.innerHTML=cardHtml||'<div class="mini">표시할 계좌 요약이 없습니다.</div>';
  tbody.innerHTML=rows.length?rows.map(x=>{const h=x.h,cl=v=>v>0?'up':v<0?'down':'neutral';return `<tr><td>${nhSafe(x.a)}</td><td>${x.market}</td><td class="name">${nhSafe(h.name)}</td><td>${nhSafe(h.code)}</td><td>${nhMoney(h.quantity)}</td><td>${nhMoney(h.avgPrice)} ${nhSafe(h.currency||'')}</td><td>${nhMoney(h.currentPrice)} ${nhSafe(h.currency||'')}</td><td>${nhMoney(h.evalAmount)}</td><td class="${cl(h.profit)}">${nhMoney(h.profit)}</td><td class="${cl(h.returnRate)}">${h.returnRate==null?'—':Number(h.returnRate).toFixed(2)+'%'}</td></tr>`}).join(''):'<tr><td colspan="10" style="text-align:center">해당 구분의 보유종목이 없습니다.</td></tr>';
  if(typeof renderExternalAssets==='function')renderExternalAssets();
}

function clock(){const n=new Date(),p=v=>String(v).padStart(2,'0');$('clock').textContent=`${n.getMonth()+1}.${n.getDate()} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())} KST`}

