/* ===== market.js: 시세 수집 / 카드 / 보유종목 / 시나리오 / 뉴스 / 설정 ===== */
let CFG=LS('invest_cfg_v4')||JSON.parse(JSON.stringify(DEF)),MAN=LS('invest_man')||{},Q={};
// 이전에 저장된 설정에도 선물 항목을 새 방식으로 맞춤
['KR','US'].forEach(s=>CFG[s].forEach(x=>{
  if(FUT[x.id]){x.fut=FUT[x.id];x.name='코스피200 선물';delete x.y;delete x.m}
  else if(x.id==='k4'&&x.y==='KQ24.KQ'){delete x.y;x.m=1;x.name='코스닥150 선물'}
}));
const FQ={},FST={},NQ={};
// ----- 나무증권(NH PLUG) 선물 시세: 서버(GAS)가 대신 조회, 로그인 토큰 필요 -----
async function nhFetch(items){
  const tk=LS('invest_session_token');
  if(!tk)return{ok:false,msg:'로그인 토큰 없음'};
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),25000);
    const r=await fetch(MYP(),{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'nhQuotes',token:tk,items:items}),signal:c.signal});
    clearTimeout(t);
    const j=JSON.parse(await r.text());
    if(!j.success)return{ok:false,msg:j.message||'서버 거부'};
    return{ok:true,data:j.data||{},errors:j.errors||{}};
  }catch(e){return{ok:false,msg:'통신 실패('+(e&&e.name==='AbortError'?'시간 초과':'서버 주소·배포 확인')+')'}}
}
async function fillNH(){
  const ids=Object.keys(NHF),t=hms(new Date());
  const r=await nhFetch(ids.map(id=>({k:id,t:'fut',c:NHF[id]})));
  if(!r.ok){ids.forEach(id=>delete NQ[id]);NH_STATUS='실패 · '+r.msg+' · '+t;return{ok:0,fail:ids.length}}
  let ok=0;const ds=[],er=[];
  ids.forEach(id=>{const d=r.data[id];
    if(d&&d.p!=null&&d.prev!=null){NQ[id]={p:d.p,prev:d.prev,basis:d.basis,t:d.t||t,at:t};ok++;ds.push(id+':'+d.code+'('+d.dir+')')}
    else{delete NQ[id];er.push(id+': '+(r.errors[id]||'응답 없음'))}});
  NH_STATUS='선물 '+ok+'/'+ids.length+' 성공 · '+t+(ds.length?' · '+ds.join(' '):'')+(er.length?' · 실패 '+er.join(' / '):'');
  return{ok:ok,fail:ids.length-ok};
}
async function fillFutures(skip){
  let ok=0,fail=0;
  await Promise.all(Object.keys(FUT).filter(id=>!(skip&&skip.has(id))).map(async id=>{
    const t=hms(new Date());
    try{
      const j=await getJSON('https://finance.daum.net/api/home/sec?path='+encodeURIComponent('/api/futures/'+FUT[id]));
      const p=j&&nnum(j.tradePrice),prev=j&&nnum(j.prevClosingPrice);
      if(p==null||prev==null)throw 0;
      const k=j.kospi200&&nnum(j.kospi200.tradePrice);
      FQ[id]={p:p,prev:prev,basis:k!=null?p-k:null,t:t};FST[id]='';ok++;
    }catch(e){FST[id]='수신 실패 · '+t;fail++}
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
async function getTxt(targetUrl){
  const proxy=MYP();
  if(!proxy)return null;
  const fullUrl=proxy+(proxy.includes('?')?'&':'?')+'url='+encodeURIComponent(targetUrl);
  try{
    const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);
    const r=await fetch(fullUrl,{signal:c.signal});
    clearTimeout(t);
    if(r.ok){const x=await r.text();if(x&&x.length>10){NET.ok++;return x}}
    NET.fail++;
  }catch(e){NET.fail++}
  return null;
}
async function getJSON(u){const x=await getTxt(u);try{return JSON.parse(x)}catch(e){return null}}

function openDg(){$('dgs').textContent='성공 '+NET.ok+'회 · 실패 '+NET.fail+'회';$('dgl').textContent=['NH 나무증권: '+NH_STATUS,'출처별 수신: '+srcSummary(Object.keys(Q)),'--- 통신 기록'].concat(NET.log.length?NET.log:['기록 없음']).join('\n');$('dgp').value=MYP();$('dg').classList.add('on')}
function closeDg(){$('dg').classList.remove('on')}
function saveProxy(){LS('invest_myproxy',$('dgp').value.trim());NET.ok=0;NET.fail=0;closeDg();refresh();loadNews();THM_AT=0;fetchTopThemes()}

const nnum=v=>{const n=parseFloat(String(v==null?'':v).replace(/[,+\s]/g,''));return isFinite(n)?n:null};
function nsgn(o,ch){if(ch==null)return ch;const c=(o&&(o.compareToPreviousPrice||o.fluctuationsType))||{},cd=String(c.code||''),tx=String(c.name||'')+String(c.text||'');
const dn=cd==='4'||cd==='5'||/FALL|하락|하한/.test(tx),up=cd==='1'||cd==='2'||/RIS|상승|상한/.test(tx);return dn?-Math.abs(ch):up?Math.abs(ch):ch}
function nq(o){if(!o)return null;const p=nnum(o.closePrice??o.calcPrice);if(p==null)return null;const ch=nsgn(o,nnum(o.compareToPreviousClosePrice??o.fluctuations));return{p:p,prev:ch==null?p:p-ch}}
const narr=j=>Array.isArray(j)?j:j?(j.datas||j.result||j.data||j.items||Object.values(j).find(Array.isArray)||((j.closePrice||j.calcPrice)?[j]:[])):[];
let INV=null;const SRC={};
// ----- 시세 출처 표시: N=네이버 · Y=Yahoo · D=다음 · H=NH(나무증권) · M=수동 -----
const QT={};   // 종목별 마지막 수신 시각
const SRC_NAME={N:'네이버',Y:'Yahoo',D:'다음',H:'NH 나무증권',M:'수동'},SRC_SHORT={N:'네',Y:'Y',D:'다',H:'NH',M:'수'};
let NH_STATUS='아직 연결 전';   // 나무증권 연동 상태 (🩺 진단에 표시)
const srcTag=(k,full)=>{const s=SRC[k];if(!s||!Q[k])return '';return full?(SRC_NAME[s]||s)+(QT[k]?' · '+hms(new Date(QT[k])):''):(SRC_SHORT[s]||s)};
const srcSummary=keys=>{const c={};keys.forEach(k=>{const s=SRC[k];if(Q[k]&&s)c[s]=(c[s]||0)+1});return Object.keys(c).map(s=>(SRC_NAME[s]||s)+' '+c[s]).join(' · ')||'수신 없음'};
const srcLine=t=>t?`<div class="mini" style="font-size:9px;margin-top:2px;opacity:.75">출처 ${t}</div>`:'';

async function fillNaver(want,fr){
  const W=new Set(want),T=[];let n=0;
  const put=(k,o)=>{const q=nq(o);if(q&&W.has(k)){Q[k]=q;SRC[k]='N';QT[k]=Date.now();fr.add(k);n++}};
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
  const m=j&&j.chart&&j.chart.result&&j.chart.result[0]&&j.chart.result[0].meta;if(!m||m.regularMarketPrice==null)return null;
  return{p:m.regularMarketPrice,prev:m.chartPreviousClose!=null?m.chartPreviousClose:m.previousClose};
}
const KY={};
async function quoteKR(c){for(const x of['.KS','.KQ']){const q=await quote(c+x);if(q){KY[c]=c+x;return q}}return null}

async function fillQuotes(list){
  let i=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(i<list.length){
      const c=list[i++];
      const q=await(isKR(c)?quoteKR(c):quote(c));
      if(q){Q[c]=q;SRC[c]='Y';QT[c]=Date.now()}
    }
  }));
}

let MK_BUSY=false;
async function refreshMarket(){   // '시장 종합' 카드(지수·선물·수급)만 갱신
  if(MK_BUSY)return;MK_BUSY=true;
  const btn=$('mkBtn'),st=$('mkSt');
  if(btn){btn.disabled=true;btn.textContent='갱신 중...'}
  try{
    const list=CFG[sess()],want=[...new Set(list.filter(x=>x.y).map(x=>x.y))],fr=new Set();
    await fillNaver(want,fr);
    await fillQuotes(want.filter(c=>!fr.has(c)));
    const hasNH=list.some(x=>NHF[x.id]),nh=hasNH?await fillNH():{ok:0,fail:0};
    const hasFut=list.some(x=>x.fut),fu=hasFut?await fillFutures(new Set(Object.keys(NQ))):{ok:0,fail:0};
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
function manualRefresh(){THM_AT=0;refresh();refreshNHDataCenter();loadNews()}
async function refresh(){
  $('status').textContent='시세 갱신 중...';
  const want=new Set();['KR','US'].forEach(s=>CFG[s].forEach(x=>x.y&&want.add(x.y)));H.forEach(r=>r[7]&&want.add(r[7]));
  const all=[...want],fr=new Set();
  await fillNaver(all,fr);
  await fillQuotes(all.filter(c=>!fr.has(c)));
  const nh=await fillNH();
  const fu=await fillFutures(new Set(Object.keys(NQ)));
  const got=all.filter(c=>Q[c]).length;
  renderCards();renderHoldings();fetchTopThemes();renderThemes();updateTickGauge();generateScenario();
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
    }else if(x.m){v=MAN[x.id]||'입력';c='직접 입력'}
    else{
      const q=Q[x.y];if(q){const df=q.p-q.prev,pc=df/q.prev*100;d=df>0?1:df<0?-1:0;
      if(x.t==='yld'){v=nf(q.p)+'%';c=(df>=0?'+':'')+nf(df)+'p'}
      else if(x.t==='fx'){v=nf(q.p);c=(df>=0?'+':'')+nf(df)+' ('+nf(pc)+'%)'}
      else{v=nf(q.p);c=(pc>=0?'+':'')+nf(pc)+'%'}}
    }
    const tag=x.inv?(INV?'네이버':''):NQ[x.id]?'NH 나무증권 · '+NQ[x.id].at:x.fut?(FQ[x.id]?'다음':''):x.m?'수동 입력':srcTag(x.y,true);
    return `<div class="card" style="cursor:pointer" onclick="${x.inv||x.fut||NQ[x.id]?'':x.m?`manIn('${x.id}')`:`openQ('${x.id}')`}"><div class="cl"><span>${x.name}</span><span>${x.inv||x.fut||NQ[x.id]?'':x.m?'✎':'📈'}</span></div><div class="value">${v}</div><div class="change ${d>0?'up':d<0?'down':'neutral'}">${c}</div>${srcLine(tag)}</div>`
  }).join('')
}

function manIn(id){const v=prompt('값을 입력하세요',MAN[id]||'');if(v===null)return;MAN[id]=v;LS('invest_man',MAN);renderCards()}

function renderHoldings(){
  const f=$('af').value,rows=H.filter(r=>f==='all'||r[0]===f);
  const calc=r=>{const q=Q[r[7]];if(!q)return{cur:r[4],pl:r[5],rt:r[6],live:0};return{cur:q.p,pl:(q.p-r[3])*r[2],rt:(q.p/r[3]-1)*100,live:1}};
  $('hd').innerHTML=rows.map(r=>{
    const k=calc(r),cl=v=>v==null?'':v>=0?'up':'down';
    return `<tr><td>${r[0]}</td><td class="name" ${r[7]?`onclick="showH(${H.indexOf(r)})"`:''}>${r[1]}</td><td>${nf(r[2])}</td><td>${nf(r[3])}</td><td>${nf(k.cur)}${k.live?' <span class="up">●</span> <span class="mini" style="font-size:8px;opacity:.7">'+srcTag(r[7])+'</span>':' <span class="mini" style="font-size:8px;opacity:.7">기준</span>'}</td><td class="${cl(k.pl)}">${nf(k.pl,0)}</td><td class="${cl(k.rt)}">${k.rt==null?'—':k.rt.toFixed(2)+'%'}</td></tr>`
  }).join('');
  const accs=[...new Set(rows.map(r=>r[0]))];
  $('ps').innerHTML=accs.map(a=>{
    const rs=H.filter(r=>r[0]===a),tot=rs.reduce((s,r)=>s+(calc(r).pl||0),0),us=a==='해외주식';
    return `<div class="card"><div class="cl"><span>${a}</span><span>${rs.length}개 종목</span></div><div class="value ${tot>=0?'up':'down'}" style="font-size:14px">${nf(tot,us?2:0)}${us?' $':' 원'}</div><div class="mini">평가손익 합계</div></div>`
  }).join('')
}

const TS={w:'wait',wAt:null,g:null,gAt:null};
const hms=d=>{if(!d)return'—';const p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())};   // HH:MM:SS 고정 형식
function tickStatus(){
  const el=$('tickSt');if(!el)return;
  const c=ok=>ok===true?'#4ade80':ok===false?'var(--red)':'var(--amber)';
  const wo=TS.w==='ok'?true:TS.w==='fail'?false:null,wl=wo===true?'성공':wo===false?'실패':'대기';
  const g=TS.g;
  el.innerHTML='실시간 위젯 <b style="color:'+c(wo)+'">'+wl+'</b> · '+hms(TS.wAt)+'<br>게이지 <b style="color:'+c(g?g.ok:null)+'">'+(g?(g.ok?'성공':'실패'):'대기')+'</b> · '+(g?g.src:'')+' · '+hms(TS.gAt);
}
function updateTickGauge(){
  if($('tin').value)return;   // 직접 입력값이 있으면 입력값 우선
  const qN=Q['^IXIC'],qS=Q['^GSPC'];let tv=null,src='';
  if(qN&&qN.prev){tv=Math.round((qN.p/qN.prev-1)*100*450);src='나스닥 등락률로 추정'}
  else if(qS&&qS.prev){tv=Math.round((qS.p/qS.prev-1)*100*550);src='S&P500 등락률로 추정'}
  TS.gAt=new Date();
  if(tv==null||isNaN(tv)){TS.g={ok:false,src:'지수 시세 없음'};$('tl2').textContent='데이터 없음';tickStatus();return}
  TS.g={ok:true,src:src};
  $('tm').style.left='calc('+((Math.max(-1000,Math.min(1000,tv))+1000)/20)+'% - 1px)';
  $('tl2').textContent='추정: '+(tv>=600?'매수 우위':tv<=-600?'매도 우위':'중립권')+' ('+tv+')';
  tickStatus();
}

function generateScenario(){
  const h=new Date().getHours(),isDay=h>=7&&h<21;
  const qK=Q['^KS11'],qQ=Q['^KQ11'],qN=Q['^IXIC'],qS=Q['^GSPC'];
  const getP=q=>q&&q.prev?((q.p/q.prev-1)*100).toFixed(2):'0.00';
  const txt=isDay?`[📊 한국장 주간 시나리오]\n• 코스피(${getP(qK)}%), 코스닥(${getP(qQ)}%)\n• 주도 테마 수급 집중 구간, 5일선 눌림목 중심 대응.`:`[🌙 미국장 야간 시나리오]\n• 나스닥(${getP(qN)}%), S&P500(${getP(qS)}%)\n• 필라델피아 반도체 및 빅테크 흐름 연동 대응.`;
  $('gv').textContent=txt;
  $('gptTime').textContent=new Date().toLocaleTimeString('ko-KR')+' 생성';
}
function copyScenario(){navigator.clipboard.writeText($('gv').textContent).then(()=>alert('복사되었습니다.'))}
function refreshScenario(){generateScenario()}

const openKR=()=>{const n=new Date(),m=n.getHours()*60+n.getMinutes(),d=n.getDay();return d>0&&d<6&&m>=540&&m<=930},openUS=()=>{const n=new Date(),m=n.getHours()*60+n.getMinutes();return m>=1350||m<=360};
const esc=v=>String(v).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const ago=d=>{const m=(Date.now()-d)/60000;return m<1?'방금':m<60?Math.floor(m)+'분 전':Math.floor(m/1440)+'일 전'};

async function fetchNews(q){
  const x=await getTxt('https://news.google.com/rss/search?q='+encodeURIComponent(q)+'&hl=ko&gl=KR&ceid=KR:ko');if(!x)return[];
  const d=new DOMParser().parseFromString(x,'text/xml');return[...d.querySelectorAll('item')].map(i=>{const g=t=>{const e=i.querySelector(t);return e?e.textContent:''};return{t:g('title'),l:g('link'),s:g('source'),d:new Date(g('pubDate')||0)}})
}

async function loadNews(){
  $('nst_mk').textContent='불러오는 중...';$('nst_hd').textContent='불러오는 중...';
  const mks=await fetchNews('코스피 OR 증시 OR 나스닥 when:2d');
  const hds=await fetchNews('(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d');
  const renderN=(list,el,stEl)=>{
    const m={};list.forEach(a=>{const k=a.t.replace(/\s-\s[^-]+$/,'');if(!m[k]||a.d>m[k].d)m[k]={t:k,l:a.l,s:a.s,d:a.d}});
    const arr=Object.values(m).sort((a,b)=>b.d-a.d).slice(0,6);
    $(el).innerHTML=arr.length?arr.map(a=>`<div class="news"><strong><a href="${a.l}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(a.t)}</a></strong><span class="mini">${esc(a.s)} · ${ago(a.d)}</span></div>`).join(''):'<div class="mini">기사 없음</div>';
    $(stEl).textContent=arr.length?arr.length+'건':'없음';
  };
  renderN(mks,'nl_mk','nst_mk');renderN(hds,'nl_hd','nst_hd');
}

function setTick(){
  const v=parseFloat($('tin').value);LS('invest_tick',$('tin').value);
  if(isNaN(v)){updateTickGauge();return}
  $('tm').style.left='calc('+((Math.max(-1000,Math.min(1000,v))+1000)/20)+'% - 1px)';   // tv → v 수정
  $('tl2').textContent='입력값: '+v;TS.g={ok:true,src:'직접 입력'};TS.gAt=new Date();tickStatus();
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
function clock(){const n=new Date(),p=v=>String(v).padStart(2,'0');$('clock').textContent=`${n.getMonth()+1}.${n.getDate()} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())} KST`}


// ---------- NH 데이터센터 화면 ----------
let NHDC = null;
const nhEsc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nhWon = v => v == null ? '—' : Number(v).toLocaleString('ko-KR',{maximumFractionDigits:0}) + '원';
const nhNumFmt = v => v == null ? '—' : Number(v).toLocaleString('ko-KR',{maximumFractionDigits:2});
function nhHoldingRows(rows, overseas) {
  if (!rows || !rows.length) return '<tr><td colspan="8" class="mini">보유 종목 없음</td></tr>';
  return rows.map(x => {
    const qty = x.qty == null ? '—' : nhNumFmt(x.qty);
    const price = x.currentPrice == null ? '—' : (overseas ? nhNumFmt(x.currentPrice) + ' ' + nhEsc(x.currency || 'USD') : nhWon(x.currentPrice));
    const avg = x.avgPrice == null ? '—' : (overseas ? nhNumFmt(x.avgPrice) + ' ' + nhEsc(x.currency || 'USD') : nhWon(x.avgPrice));
    const pnl = x.pnl == null ? '—' : (overseas ? nhWon(x.pnl) : nhWon(x.pnl));
    const pc = x.returnPct == null ? '—' : Number(x.returnPct).toFixed(2) + '%';
    const cls = Number(x.pnl) > 0 ? 'up' : Number(x.pnl) < 0 ? 'down' : '';
    return `<tr><td>${nhEsc(x.name)}</td><td>${nhEsc(x.code)}</td><td>${qty}</td><td>${avg}</td><td>${price}</td><td>${nhWon(x.marketValue)}</td><td class="${cls}">${pnl}</td><td class="${cls}">${pc}</td></tr>`;
  }).join('');
}
function nhAccountBlock(a) {
  const sections = [];
  if (a.domestic) {
    const s = a.domestic.summary || {};
    sections.push(`<div class="card" style="margin-top:8px"><div class="sh"><b>국내주식</b><span class="mini">예수금 ${nhWon(s.cash)} · 주문가능 ${nhWon(s.orderable)}</span></div>
      <div class="grid three">
        <div class="mini">평가금액<br><b>${nhWon(s.evalAmount)}</b></div>
        <div class="mini">평가손익<br><b class="${Number(s.evalPnl)>=0?'up':'down'}">${nhWon(s.evalPnl)}</b></div>
        <div class="mini">수익률<br><b>${s.returnPct==null?'—':Number(s.returnPct).toFixed(2)+'%'}</b></div>
      </div>
      <div class="tw"><table><thead><tr><th>종목</th><th>코드</th><th>수량</th><th>평단가</th><th>현재가</th><th>평가금액</th><th>손익</th><th>수익률</th></tr></thead><tbody>${nhHoldingRows(a.domestic.holdings,false)}</tbody></table></div></div>`);
  } else if (a.domesticError) sections.push(`<div class="mini" style="color:var(--red)">국내주식 조회 실패: ${nhEsc(a.domesticError)}</div>`);
  if (a.overseas) {
    const s = a.overseas.summary || {};
    sections.push(`<div class="card" style="margin-top:8px"><div class="sh"><b>해외주식 (미국)</b><span class="mini">원화예수금 ${nhWon(s.cashKRW)} · 외화예수금 ${nhNumFmt(s.cashForeign)} USD</span></div>
      <div class="grid three">
        <div class="mini">원화환산 평가금액<br><b>${nhWon(s.evalAmountKRW)}</b></div>
        <div class="mini">원화환산 평가손익<br><b class="${Number(s.evalPnlKRW)>=0?'up':'down'}">${nhWon(s.evalPnlKRW)}</b></div>
        <div class="mini">수익률<br><b>${s.returnPct==null?'—':Number(s.returnPct).toFixed(2)+'%'}</b></div>
      </div>
      <div class="tw"><table><thead><tr><th>종목</th><th>티커</th><th>수량</th><th>평단가</th><th>기준가</th><th>원화평가금액</th><th>원화손익</th><th>수익률</th></tr></thead><tbody>${nhHoldingRows(a.overseas.holdings,true)}</tbody></table></div></div>`);
  } else if (a.overseasError) sections.push(`<div class="mini" style="color:var(--red)">해외주식 조회 실패: ${nhEsc(a.overseasError)}</div>`);
  if (a.status === 'mock_not_connected') sections.push('<div class="mini">모의투자 계좌: 별도 모의 서버 설정이 필요하여 이번 조회에서 제외했습니다.</div>');
  return `<div class="sh" style="margin-top:14px"><b>계좌 ${nhEsc(a.masked)} · ${a.type==='01'?'일반':a.type==='02'?'주문대리인':'모의투자'}</b><span class="mini">${nhEsc(a.environment)}</span></div>${sections.join('')}`;
}
async function refreshNHDataCenter() {
  const status = $('nhdcStatus'), btn = $('nhdcBtn'), box = $('nhdcAccounts');
  if (!status || !box) return;
  const token = LS('invest_session_token');
  if (!token) { status.textContent = '로그인 필요'; return; }
  status.textContent = 'NH 계좌 및 잔고 조회 중...';
  if (btn) btn.disabled = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000);
    const res = await fetch(MYP(), {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({action:'nhDataCenter',token:token}),signal:ctrl.signal});
    clearTimeout(timer);
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'NH 조회 실패');
    NHDC = data;
    const accounts = data.accounts || [];
    const domestic = accounts.reduce((n,a)=>n+(a.domestic&&a.domestic.holdings?a.domestic.holdings.length:0),0);
    const overseas = accounts.reduce((n,a)=>n+(a.overseas&&a.overseas.holdings?a.overseas.holdings.length:0),0);
    const dEval = accounts.reduce((n,a)=>n+(a.domestic&&a.domestic.summary&&a.domestic.summary.evalAmount||0),0);
    const dPnl = accounts.reduce((n,a)=>n+(a.domestic&&a.domestic.summary&&a.domestic.summary.evalPnl||0),0);
    const oEval = accounts.reduce((n,a)=>n+(a.overseas&&a.overseas.summary&&a.overseas.summary.evalAmountKRW||0),0);
    const oPnl = accounts.reduce((n,a)=>n+(a.overseas&&a.overseas.summary&&a.overseas.summary.evalPnlKRW||0),0);
    $('nhdcSummary').innerHTML = `
      <div class="card"><div class="mini">연결 계좌</div><div class="value">${accounts.length}개</div></div>
      <div class="card"><div class="mini">국내주식 평가금액</div><div class="value">${nhWon(dEval)}</div><div class="${dPnl>=0?'up':'down'} mini">손익 ${nhWon(dPnl)}</div></div>
      <div class="card"><div class="mini">해외주식 원화환산 평가금액</div><div class="value">${nhWon(oEval)}</div><div class="${oPnl>=0?'up':'down'} mini">손익 ${nhWon(oPnl)}</div></div>`;
    box.innerHTML = accounts.length ? accounts.map(nhAccountBlock).join('') : '<div class="mini">NH 연결 계좌가 없습니다.</div>';
    const errs = data.errors && data.errors.length ? ` · 오류 ${data.errors.length}건` : '';
    status.textContent = `NH 조회 완료 ${data.fetchedAt} · 국내 ${domestic}종목 · 해외 ${overseas}종목${errs}`;
  } catch (e) {
    status.textContent = 'NH 조회 실패 · ' + (e.name === 'AbortError' ? '응답 시간 초과' : (e.message || '통신 오류'));
    box.innerHTML = '<div class="mini" style="color:var(--red)">NH API 연결 상태와 GAS 배포 버전을 확인해 주세요.</div>';
  } finally {
    if (btn) btn.disabled = false;
  }
}
