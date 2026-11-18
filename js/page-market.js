(function(root){
'use strict';
// Market V2: isolated UI. No account, GAS, authentication, or order writes.
const KEY='myinvest_market_priority_v2';
const ALL=[
 ['^KS11','KOSPI','한국','KRX / Naver'],['^KQ11','KOSDAQ','한국','KRX / Naver'],
 ['k3','KOSPI 200 선물','선물','NH / 시세 중계'],['k4','KOSDAQ 150 선물','선물','시세 중계'],
 ['^GSPC','S&P 500','미국','Naver / Yahoo'],['^IXIC','NASDAQ','미국','Naver / Yahoo'],
 ['^DJI','DOW','미국','Naver / Yahoo'],['^SOX','SOX','산업','Naver / Yahoo'],
 ['^VIX','VIX','변동성','Naver / Yahoo'],['KRW=X','USD/KRW','환율','Naver / Yahoo'],
 ['^TNX','미국 10년물','금리','Naver / Yahoo'],['^IRX','미국 단기금리','금리','Yahoo'],
 ['GC=F','금 선물','원자재','Yahoo'],['CL=F','WTI 원유','원자재','Yahoo'],
 ['NQ=F','NASDAQ 선물','선물','Yahoo'],['ES=F','S&P 500 선물','선물','Yahoo'],
 ['YM=F','DOW 선물','선물','Yahoo'],['TICK','NYSE $TICK','시장 내부','TradingView (별도 확인)']
].map(([id,name,group,origin])=>({id,name,group,origin}));
const DEFAULT={KR:['^KS11','^KQ11','k3','k4','KRW=X','^SOX','^GSPC','^IXIC','TICK'],US:['^GSPC','^IXIC','NQ=F','^SOX','^VIX','KRW=X','ES=F','^DJI','TICK']};
const regionAt=(date=new Date())=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const hour=Number(parts.find(p=>p.type==='hour')?.value);return hour>=7&&hour<21?'KR':'US'};
const byId=id=>ALL.find(x=>x.id===id);
const unitFor=id=>['k3','k4'].includes(id)&&typeof Q!=='undefined'&&Q[id]?.contractVerified?'지수 포인트 · 단일 계약':({'^TNX':'% (공급자 수익률 표기)','^IRX':'% (공급자 수익률 표기)','GC=F':'USD/트로이온스','CL=F':'USD/배럴','KRW=X':'원/USD','NQ=F':'지수 포인트 · 공급자 연속선물','ES=F':'지수 포인트 · 공급자 연속선물','YM=F':'지수 포인트 · 공급자 연속선물','k3':'지수 포인트 · 계약/만기 미확인','k4':'지수 포인트 · 계약/만기 미확인','^VIX':'변동성 지수 포인트','TICK':'NYSE $TICK 지표값'})[id]||'지수 포인트';
const timeLabel=(value,missing)=>{if(value==null||value==='')return missing;const t=typeof value==='number'&&value>0&&value<1e11?value*1000:value;const d=new Date(t);return Number.isFinite(d.getTime())?d.toLocaleString('ko-KR'):missing};
const contractNote=id=>['NQ=F','ES=F','YM=F','GC=F','CL=F'].includes(id)?'Yahoo 공급자 선물 심볼 · 개별 만기물 아님 / 롤 조정 방식 미확인':['k3','k4'].includes(id)?(typeof Q!=='undefined'&&Q[id]?.contractVerified?'NH 계약 '+Q[id].contractCode+' · 만기 '+Q[id].expiry+' · 단일 계약':'국내 선물 · 계약/만기 식별 미확인'):null;
const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(txt!==undefined)n.textContent=txt;if(cls)n.className=cls;return n};
const btn=(txt,fn)=>{const b=el('button',txt);b.type='button';b.addEventListener('click',fn);return b};
function load(){try{const x=JSON.parse(localStorage.getItem(KEY));if(!x||typeof x!=='object')return structuredClone(DEFAULT);return Object.fromEntries(['KR','US'].map(k=>[k,Array.isArray(x[k])?Array.from(new Set([...x[k].filter(id=>byId(id)),...DEFAULT[k]])).slice(0,ALL.length):[...DEFAULT[k]]]))}catch{return {KR:[...DEFAULT.KR],US:[...DEFAULT.US]}}}
function quote(id){const q=typeof Q!=='undefined'&&Q[id];if(!q||typeof q.p!=='number'||!Number.isFinite(q.p))return null;const p=q.p,prev=typeof q.prev==='number'?q.prev:null;return {p,delta:Number.isFinite(prev)&&prev!==0?(p-prev)/prev*100:null,source:typeof SRC!=='undefined'?({N:'Naver',Y:'Yahoo',D:'Daum',H:'NH',M:'수동'}[SRC[id]]||'출처 미확인'):'출처 미확인',observed:timeLabel(q.observedAt,'관측시각 미확인'),received:typeof QT!=='undefined'?timeLabel(QT[id],'수신시각 미확인'):'수신시각 미확인'}}
function format(v){return Number.isFinite(v)?v.toLocaleString('ko-KR',{maximumFractionDigits:3}):'미연결'}
function create(){
 const legacy=DashboardPages.legacy({ids:['marketSection','tickSection','workMacroLivePreview'],intro:'기존 시장 지표 및 거시경제 화면',refresh:async(ctx,force)=>{await ctx.market(force,[...settings[region],'^VIX','KRW=X','^TNX','^SOX']);if(!ctx.development())await ctx.once('tick-widget',()=>{const ti=LS('invest_tick');if(ti){$('tin').value=ti;setTick()}TS.w='wait';tickStatus();embed($('tickq'),'single-quote',{symbol:'USI:TICK',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'},ok=>{TS.w=ok?'ok':'fail';TS.wAt=new Date();tickStatus()})})}});
 let view,modal,grid,legacyDetails,connectionContext=null,region='KR',settings=load(),alive=false,request=0,regionTimer=null,manualRegion=false,regionBtnRef=null,modalCleanups=[];
 // Reuse the existing collector when visible symbols change; no new source/UI engine.
 function requestVisible(){if(!alive||!connectionContext)return;void legacy.refresh(connectionContext).then(()=>{if(alive)draw()}).catch(()=>{if(alive&&typeof $==='function'&&$('mkSt'))$('mkSt').textContent='시세 연결 실패 · 연결 진단을 확인하세요.'})}
 function close(){for(const cleanup of modalCleanups.splice(0))cleanup();if(modal){modal.remove();modal=null}request++}
 function dialog(title){close();modal=el('div',undefined,'miv-overlay');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',title);const panel=el('div',undefined,'miv-dialog');panel.append(el('h2',title),btn('✕ 닫기',close));modal.append(panel);modal.addEventListener('click',e=>{if(e.target===modal)close()});view.append(modal);return panel}
 let tickWidgetNode=null;
 function tickCard(){
  const c=el('section',undefined,'miv-indicator'),heading=el('div');
  heading.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:6px';
  heading.append(el('strong','NYSE $TICK'),btn('차트',openTick));
  c.append(heading);
  const raw=typeof Q!=='undefined'?Q.TICK:null;
  const supported=typeof SRC!=='undefined'&&['I','X'].includes(SRC.TICK);
  const observed=Number(raw?.observedAt),fresh=supported&&Number.isFinite(raw?.p)&&Number.isFinite(observed)&&Date.now()-observed>=-60000&&Date.now()-observed<=120000;
  if(fresh){
   const v=el('strong',Math.round(raw.p).toLocaleString('ko-KR'));v.style.fontSize='22px';
   const interpret=root.MyInvestMarketSourcePriority?.tickContext?.(raw.p)||'관측된 NYSE TICK';
   c.append(v,el('small',interpret),el('small',(SRC.TICK==='I'?'IBKR':'dxFeed')+' · '+timeLabel(observed,'시각 미확인')+(raw.delayed?' · 지연 시세':'')));
  }else{
   if(!tickWidgetNode){
    tickWidgetNode=el('div');tickWidgetNode.style.cssText='width:100%;min-height:75px;overflow:hidden';
    if(typeof embed==='function')embed(tickWidgetNode,'single-quote',{symbol:'USI:TICK.NY',width:'100%',colorTheme:'dark',isTransparent:true,locale:'kr'});
    else tickWidgetNode.textContent='TradingView 시세 위젯 미지원';
   }
   c.append(tickWidgetNode);
   c.append(el('small','TradingView 위젯 참고 수치 · 자동 판정용 데이터 연동 전'));
   c.append(el('small','±1000: 극단적인 매수/매도 우위 · 지속 여부와 지수 방향 확인'));
  }
  return c;
 }
 function card(id){if(id==='TICK')return tickCard();const d=byId(id);if(!d)return null;const q=quote(id),c=btn('',()=>openChart(id));c.className='miv-indicator';const delta=el('small',q&&q.delta!==null?(q.delta>0?'+':'')+q.delta.toFixed(2)+'%':'등락률 미확인');if(q&&q.delta!==null)delta.classList.add(q.delta>0?'market-up':q.delta<0?'market-down':'market-flat');c.append(el('strong',d.name),el('div',q?format(q.p)+' · '+unitFor(id):id==='k4'?'선물 시세 미수신':'데이터 미연결'),delta,el('small',q?q.source+' · 수신 '+q.received:id==='k4'?'승인된 공급자 연결 필요':'원천 '+d.origin+' · 수신 없음'));return c}
 function draw(){if(!alive)return;grid.replaceChildren();settings[region].slice(0,9).forEach(id=>{const c=card(id);if(c)grid.append(c)});if(settings[region].length<9)grid.append(el('p','표시 지표가 9개 미만입니다. 지표 편집에서 추가하세요.'))}
 function edit(){const panel=dialog('전체 지표 · 표시 및 우선순위 편집');const draft=[...settings[region]];const hint=el('p','체크된 지표 중 상위 9개를 메인에 표시합니다. ▲▼로 우선순위를 변경하세요.','mini');panel.append(hint);const search=el('input');search.placeholder='지표 검색';search.setAttribute('aria-label','지표 검색');panel.append(search);const rows=el('div',undefined,'miv-editor');panel.append(rows);
 function render(){rows.replaceChildren();const sorted=[...ALL].sort((a,b)=>{const i=draft.indexOf(a.id),j=draft.indexOf(b.id);return (i<0?999:i)-(j<0?999:j)});sorted.filter(x=>x.name.toLowerCase().includes(search.value.toLowerCase())).forEach(d=>{const row=el('div',undefined,'miv-edit-row'),check=el('input');check.type='checkbox';check.checked=draft.includes(d.id);check.setAttribute('aria-label',d.name+' 표시');check.addEventListener('change',()=>{if(check.checked&&!draft.includes(d.id))draft.push(d.id);if(!check.checked){const i=draft.indexOf(d.id);if(i>=0)draft.splice(i,1)}render()});row.append(check,el('span',d.name+(draft.includes(d.id)?' · '+(draft.indexOf(d.id)+1)+'순위':'')));[-1,1].forEach(dir=>{const b=btn(dir<0?'▲':'▼',()=>{const i=draft.indexOf(d.id),j=i+dir;if(i>=0&&j>=0&&j<draft.length){[draft[i],draft[j]]=[draft[j],draft[i]];render()}});const i=draft.indexOf(d.id);b.disabled=i<0||i+dir<0||i+dir>=draft.length;row.append(b)});rows.append(row)})}
 search.addEventListener('input',render);render();panel.append(btn('기본값 복원',()=>{draft.splice(0,draft.length,...DEFAULT[region]);render()}),btn('순서 저장',()=>{if(draft.length<9){alert('메인 표시용 지표를 9개 이상 선택하세요.');return}settings[region]=[...draft];try{localStorage.setItem(KEY,JSON.stringify(settings))}catch{}close();draw();requestVisible()}))}
 const rangeMap={일:['1d','3mo'],주:['1wk','2y'],월:['1mo','5y'],년:['1mo','max']};
 function openChart(id){
  const d=byId(id),panel=dialog(d.name+' · 확대 차트'),q=quote(id);panel.classList.add('miv-chart-panel');
  if(contractNote(id))panel.append(el('p',contractNote(id),'mini'));
  panel.append(el('p',q?format(q.p)+' · '+unitFor(id)+' · 출처 '+q.source+' · 관측 '+q.observed+' · 수신 '+q.received:'현재 시세 미연결','mini'));
  if(id==='k4'){
   const note=el('p','1순위 NH 선물 현재가 · 외부 참고 심볼은 TradingView KRX:KQI1! 연속선물입니다. 연속선물은 개별 월물과 가격이 다를 수 있고, 차트 값은 대시보드 카드로 자동 전송되지 않습니다.','mini');
   const widget=el('p','외부 위젯 미지원 · TradingView 임베드가 이 상품을 Invalid symbol로 반환했습니다. 아래 공식 사이트 링크에서 계약·차트 지원 여부를 직접 확인하세요.');widget.className='mini';
   const link=el('a','TradingView에서 코스닥150 선물 계약·차트 확인');link.href='https://kr.tradingview.com/symbols/KRX-KQI1!/contracts/';link.target='_blank';link.rel='noopener noreferrer';
   const check=btn('코스닥150 선물 조회',async()=>{const cfg=root.MYINVEST_TRANSPORT_CONFIG||{};if(cfg.devSession&&cfg.publicFutures!==true){result.textContent='현재 중계의 선물 조회 기능 미활성 · 기존 격리 GAS 및 승인된 소유자 연결 절차 확인 필요';return}check.disabled=true;result.textContent='코스닥150 선물 한 종목 조회 중…';try{await connectionContext.once('future-inspection:k4',()=>fillNH(['k4']),true);if(!alive||!result.isConnected)return;draw();const value=quote('k4'),contract=typeof Q!=='undefined'?Q.k4:null;result.textContent=value?'NH · 계약 '+contract.contractCode+' · 만기 '+contract.expiry+' · 가격 '+format(value.p)+' · 관측 '+value.observed+' · 수신 '+value.received+' · 장 상태·지연 여부 미확인':'검증된 선물 시세 미수신 · 오류 식별 정보에서 코드 확인'}catch{if(result.isConnected)result.textContent='조회 결과 미확인 · 오류 식별 정보 확인'}finally{if(check.isConnected)check.disabled=false}}),result=el('p','계약·만기·날짜를 포함한 실제 관측시각이 확인된 시세만 표시합니다.','mini');result.setAttribute('role','status');panel.append(check,result,note,widget,link);

   return;
  }
  const periods=el('div',undefined,'miv-controls'),controls=el('div',undefined,'miv-controls'),graph=el('div','차트 데이터를 불러오는 중…','miv-graph'),info=el('p','','mini'),countLabel=el('span','','mini');
  const zoomOut=btn('− 축소',()=>changeZoom(-1)),zoomIn=btn('+ 확대',()=>changeZoom(1)),reset=btn('전체 보기',()=>{if(chartBars.length){visibleCount=chartBars.length;drawBars()}});
  const countInput=el('input');countInput.type='range';countInput.min='2';countInput.max='200';countInput.step='1';countInput.setAttribute('aria-label','차트 표시 봉 수');
  controls.append(zoomOut,countInput,zoomIn,reset,countLabel);
  panel.append(periods,controls,graph,info);
  let chartBars=[],visibleCount=60,selected='일',receivedAt='',lastCanvas=null,referenceWidth=null,resizeFrame=null;
  const effectiveWidth=()=>lastCanvas?lastCanvas.getBoundingClientRect().width/(root.visualViewport?.scale||1):0;
  function syncViewport(){resizeFrame=null;if(!alive||!modal||!chartBars.length||!lastCanvas)return;const width=effectiveWidth();if(width<=0)return;if(referenceWidth&&Math.abs(width-referenceWidth)>1){visibleCount=clamp(Math.round(visibleCount*width/referenceWidth),2,chartBars.length);drawBars()}referenceWidth=width}
  const queueResize=()=>{if(resizeFrame===null)resizeFrame=requestAnimationFrame(syncViewport)};
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(queueResize):null;observer?.observe(graph);root.addEventListener('resize',queueResize);root.visualViewport?.addEventListener('resize',queueResize);
  modalCleanups.push(()=>{observer?.disconnect();root.removeEventListener('resize',queueResize);root.visualViewport?.removeEventListener('resize',queueResize);if(resizeFrame!==null)cancelAnimationFrame(resizeFrame);lastCanvas=null;chartBars=[]});
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function changeZoom(direction){if(!chartBars.length)return;const amount=Math.max(1,Math.round(visibleCount*.2));visibleCount=clamp(visibleCount+(direction>0?-amount:amount),2,chartBars.length);drawBars()}
  countInput.addEventListener('input',()=>{if(!chartBars.length)return;visibleCount=clamp(Number(countInput.value),2,chartBars.length);drawBars()});
  graph.addEventListener('wheel',e=>{if(!chartBars.length||!e.ctrlKey)return;e.preventDefault();changeZoom(e.deltaY<0?1:-1)},{passive:false});
  function drawBars(){
   if(!chartBars.length||!modal)return;
   visibleCount=clamp(visibleCount,2,chartBars.length);
   const bars=chartBars.slice(-visibleCount),W=1000,H=480,pad=55,plotH=320,ctx=lastCanvas?.getContext('2d');
   if(!ctx)return;
   const min=Math.min(...bars.map(x=>x.l)),max=Math.max(...bars.map(x=>x.h)),span=Math.max(.0001,max-min),step=(W-pad*2)/bars.length;
   const y=v=>pad+(max-v)/span*(plotH-pad);
   ctx.clearRect(0,0,W,H);ctx.fillStyle='#101827';ctx.fillRect(0,0,W,H);ctx.strokeStyle='#344158';ctx.fillStyle='#d4dce8';ctx.font='14px sans-serif';
   for(let k=0;k<5;k++){const yy=pad+(plotH-pad)*k/4;ctx.beginPath();ctx.moveTo(pad,yy);ctx.lineTo(W-pad,yy);ctx.stroke();ctx.fillText((max-span*k/4).toFixed(2),W-pad+4,yy)}
   const maxV=Math.max(1,...bars.map(x=>x.v||0));
   bars.forEach((c,i)=>{const x=pad+(i+.5)*step,up=c.c>=c.o,w=Math.max(2,Math.min(16,step*.6));ctx.strokeStyle=ctx.fillStyle=up?'#ef6b6b':'#5e9df1';ctx.beginPath();ctx.moveTo(x,y(c.h));ctx.lineTo(x,y(c.l));ctx.stroke();ctx.fillRect(x-w/2,Math.min(y(c.o),y(c.c)),w,Math.max(1,Math.abs(y(c.o)-y(c.c))));ctx.globalAlpha=.65;ctx.fillRect(x-w/2,H-30-(c.v||0)/maxV*110,w,(c.v||0)/maxV*110);ctx.globalAlpha=1});
   [[5,'#f5b942'],[20,'#b494f5']].forEach(([n,color])=>{ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let started=false;for(let i=chartBars.length-bars.length;i<chartBars.length;i++){if(i<n-1)continue;const avg=chartBars.slice(i-n+1,i+1).reduce((sum,c)=>sum+c.c,0)/n,x=pad+(i-(chartBars.length-bars.length)+.5)*step;if(!started){ctx.moveTo(x,y(avg));started=true}else ctx.lineTo(x,y(avg))}ctx.stroke()});
   ctx.fillStyle='#d4dce8';ctx.fillText('캔들 · 거래량 · MA5(노랑) · MA20(보라)',pad,H-8);
   countInput.max=String(chartBars.length);countInput.value=String(visibleCount);countLabel.textContent='표시 '+visibleCount+' / 수신 '+chartBars.length+'봉';zoomIn.disabled=visibleCount<=2;zoomOut.disabled=visibleCount>=chartBars.length;
   info.textContent='봉: '+selected+' · 표시 '+visibleCount+'/'+chartBars.length+'봉 · 원천: Yahoo Finance · 공용 중계 · 수신 '+receivedAt+' · 마지막 봉 '+new Date(chartBars.at(-1).t*1000).toLocaleString('ko-KR')+' · 데이터 지연 가능'+(chartBars.length<20?' · MA20 표본 부족':'')+(chartBars.length<5?' · MA5 표본 부족':'')+(bars.some(c=>!Number.isFinite(c.v))?' · 거래량 미확인':'');
  }
  async function render(period){
   selected=period;periods.querySelectorAll('button').forEach(b=>b.disabled=b.textContent===period);const epoch=++request;chartBars=[];lastCanvas=null;referenceWidth=null;controls.style.display='none';graph.textContent='실제 OHLCV 데이터 조회 중…';info.textContent='시세 제공처: Yahoo Finance · 공용 중계 · 수신 확인 중';
   if(['TICK','k3','k4'].includes(id)){graph.textContent='이 지표의 OHLCV 제공처가 연결되지 않았습니다.';info.textContent='차트 미연결 · 임의 데이터 미표시';return}
   const [interval,range]=rangeMap[period],url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(id)+'?interval='+interval+'&range='+range;
   try{
    if(typeof getTxt!=='function')throw Error('transport');const raw=await getTxt(url);if(!raw)throw Error('unavailable');
    const result=JSON.parse(raw)?.chart?.result?.[0],q=result?.indicators?.quote?.[0];if(!result||!q||!Array.isArray(result.timestamp)||result.meta?.symbol!==id)throw Error('empty');
    let previous=0;for(const t of result.timestamp){if(!Number.isSafeInteger(t)||t<=previous||t>Date.now()/1000+300)throw Error('invalid-time');previous=t}
    let bars=result.timestamp.map((t,i)=>({t,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i]})).filter(c=>Number.isSafeInteger(c.t)&&[c.o,c.h,c.l,c.c].every(n=>Number.isFinite(n)&&n>0)&&c.h>=Math.max(c.o,c.c,c.l)&&c.l<=Math.min(c.o,c.c,c.h));
    if(period==='년'&&typeof qAgg==='function')bars=qAgg(bars.map(c=>({...c,t:c.t*1000})),3).map(c=>({...c,t:c.t/1000}));
    if(epoch!==request||!modal)return;if(bars.length<2)throw Error('few');
    chartBars=bars;visibleCount=Math.min(60,bars.length);receivedAt=new Date().toLocaleString('ko-KR');graph.replaceChildren();const canvas=el('canvas');canvas.width=1000;canvas.height=480;canvas.style.width='100%';canvas.style.height='auto';canvas.style.touchAction='pan-y';let pinchDistance=0;canvas.addEventListener('touchstart',e=>{if(e.touches.length===2){pinchDistance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)}},{passive:true});canvas.addEventListener('touchmove',e=>{if(e.touches.length!==2||!pinchDistance)return;e.preventDefault();const distance=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(distance>pinchDistance*1.12){changeZoom(1);pinchDistance=distance}else if(distance<pinchDistance/1.12){changeZoom(-1);pinchDistance=distance}},{passive:false});canvas.addEventListener('touchend',()=>{pinchDistance=0});graph.append(canvas);lastCanvas=canvas;controls.style.display='flex';drawBars();referenceWidth=effectiveWidth();
   }catch{if(epoch!==request||!modal)return;graph.textContent='OHLCV 수신 실패 · 실제 차트를 표시할 수 없습니다.';info.textContent='원천: Yahoo Finance · 공용 중계 · 수신 실패 · 임의 차트 미표시'}
  }
  Object.keys(rangeMap).forEach(p=>periods.append(btn(p,()=>render(p))));render('일')
 }
 function openMacro(){const panel=dialog('거시경제 분석'),macro=document.getElementById('workMacroLivePreview');if(!macro){panel.append(el('p','분석 화면 연결을 확인하세요.'));return}const slot=document.createComment('macro compatibility slot');macro.before(slot);panel.append(macro);modalCleanups.push(()=>{macro.dispatchEvent(new Event('dashboard:pageleave'));slot.replaceWith(macro)})}
 function openTick(){const panel=dialog('NYSE $TICK(순간값) · TradingView'),info=el('p','공급자 명칭: NYSE TICK INDICATOR · 위젯 연결 중','mini'),frame=el('iframe');frame.title='NYSE $TICK TradingView 차트';frame.src='https://s.tradingview.com/widgetembed/?symbol=USI%3ATICK.NY&interval=1&theme=dark&style=1&locale=kr&hideideas=1&saveimage=0&hide_side_toolbar=1';frame.loading='eager';frame.referrerPolicy='no-referrer';frame.setAttribute('sandbox','allow-scripts allow-same-origin');frame.style.cssText='width:100%;height:420px;border:0;display:block';frame.addEventListener('load',()=>{info.textContent='NYSE TICK INDICATOR · TradingView 프레임 수신 · 관측시각은 위젯 기준'});const link=el('a','TradingView 원문에서 $TICK 확인');link.href='https://www.tradingview.com/symbols/USI-TICK.NY/';link.target='_blank';link.rel='noopener noreferrer';panel.append(info,frame,link,el('p','지수 등락률로 $TICK을 추정하지 않습니다. 제공처가 시세를 제공하지 않으면 미연결 상태입니다.','mini'));modalCleanups.push(()=>{frame.remove()})}
 function regime(){const panel=dialog('시장 국면 · 관측 지표');panel.append(el('p','실제 수신된 지표만 표시합니다. 시장 국면 자동 판정: 미구현 · 지표 간 상관관계나 매매 신호는 검증된 판정 엔진이 없어 확정하지 않습니다.','mini'));const table=el('div',undefined,'miv-observation');let available=0;for(const id of [...new Set([...settings[region],'^VIX','KRW=X','^TNX','^SOX'])]){const d=byId(id),q=quote(id);if(!d||!q)continue;available++;const line=el('div',undefined,'miv-observation-row'),delta=el('strong',q.delta===null?'등락 미확인':(q.delta>0?'+':'')+q.delta.toFixed(2)+'%');if(q.delta!==null)delta.className=q.delta>0?'market-up':q.delta<0?'market-down':'market-flat';line.append(el('span',d.name),el('span',format(q.p)+' · '+unitFor(id)),delta);const provenance=el('small','출처: '+q.source+' · 관측: '+q.observed+' · 수신: '+q.received+(contractNote(id)?' · '+contractNote(id):''),'mini');provenance.style.gridColumn='1 / -1';line.append(provenance);table.append(line)}panel.append(table);if(!available)panel.append(el('p','현재 수신된 지표가 없습니다. 중계 연결과 새로고침을 확인하세요.'));panel.append(el('p','판단 시 확인: 한국·미국 지수 방향, 선물, SOX, VIX, 금리, 환율 및 $TICK. 결측치는 추정하지 않습니다.','mini'))}
 function strategy(){const panel=dialog('시장 대응 · 단타 / 스윙');panel.append(el('p','아래는 실시간 매수 추천이 아닌, 관측 지표를 바탕으로 한 사전 점검 항목입니다. 자동 추천 엔진: 미구현입니다.','mini'));const tabs=el('div',undefined,'miv-controls'),body=el('div');panel.append(tabs,body);let mode='단타';function drawStrategy(){body.replaceChildren();const ids=region==='KR'?['^KS11','^KQ11','k3','^SOX','KRW=X']:['^GSPC','^IXIC','NQ=F','^SOX','^VIX'];const received=ids.filter(id=>quote(id));body.append(el('h3',(region==='KR'?'한국장':'미국장')+' · '+mode),el('p','필수 관측 지표 '+received.length+'/'+ids.length+'개 수신 · 미수신: '+(ids.filter(id=>!quote(id)).map(id=>byId(id)?.name||id).join(', ')||'없음')));const list=el('ul');(mode==='단타'?['당일 지수·선물 방향과 주도 섹터의 동행 여부','거래대금·분봉·VWAP·실시간 체결 데이터 확인','진입·손절·목표·1회 손실한도 확정']:['지수·SOX의 20일/60일 추세 및 변동성 확인','실적·경제지표 발표와 환율·금리 위험 확인','보유 기간 2~3주를 가정한 손익비·갭 위험 검토']).forEach(t=>list.append(el('li',t)));body.append(list,btn('섹터·테마 확인',()=>{close();root.location.hash='#/sectors'}),btn('매매계획 계산',()=>{close();root.location.hash='#/strategy'}))}['단타','스윙'].forEach(m=>tabs.append(btn(m,()=>{mode=m;drawStrategy()})));drawStrategy()}
 function mount(container,ctx){alive=true;connectionContext=ctx;manualRegion=false;region=regionAt();view=el('section',undefined,'miv-market');const css=el('style');css.textContent='.miv-market{margin-bottom:16px}.miv-top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin-bottom:12px}.miv-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.miv-indicator{display:flex;flex-direction:column;gap:5px;text-align:left;padding:12px;min-width:0;background:#172238;border:1px solid #35445c;border-radius:10px;color:#e7eef9}.miv-indicator{overflow-wrap:anywhere}.miv-indicator small{font-size:11px;color:#b6c5d9;overflow-wrap:anywhere}.miv-indicator .market-up{color:#ff7777;font-weight:800;font-size:14px}.miv-indicator .market-down{color:#79b8ff;font-weight:800;font-size:14px}.miv-indicator .market-flat{color:#e7eef9;font-weight:700}.miv-overlay{position:fixed;inset:0;z-index:9999;background:#000b;display:flex;align-items:center;justify-content:center;padding:12px}.miv-dialog{background:#111d30;color:#e7eef9;border:1px solid #465775;border-radius:12px;padding:18px;width:min(750px,96vw);max-height:90vh;overflow:auto}.miv-chart-panel{width:min(1150px,96vw)}.miv-graph{min-height:170px;margin:12px 0}.miv-controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.miv-editor{max-height:55vh;overflow:auto}.miv-edit-row{display:flex;align-items:center;gap:8px;border-bottom:1px solid #344158;padding:6px}.miv-edit-row span{flex:1}.miv-market button{cursor:pointer}.miv-market .mini{font-size:12px;color:#b6c5d9}.miv-legacy-details{border:1px solid #344158;border-radius:9px;margin-top:14px;padding:9px;color:#e7eef9}.miv-legacy-details>summary{cursor:pointer;padding:8px;font-weight:650}@media(max-width:720px){.miv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:410px){.miv-grid{grid-template-columns:1fr}}.miv-observation-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:12px;padding:9px;border-bottom:1px solid #344158}.miv-observation-row .market-up{color:#ff7777}.miv-observation-row .market-down{color:#79b8ff}';view.append(css);const top=el('div',undefined,'miv-top'),heading=el('h2','시장환경 · 핵심 9개 지표'),actions=el('div',undefined,'miv-controls');const regionLabel=()=>region==='KR'?'한국장 표시 · 미국장 전환':'미국장 표시 · 한국장 전환';const regionBtn=btn(regionLabel(),()=>{manualRegion=true;region=region==='KR'?'US':'KR';regionBtn.textContent=regionLabel();draw();requestVisible()});regionBtnRef=regionBtn;actions.append(regionBtn,btn('지표 편집',edit),btn('주도 섹터·테마 보기',()=>{root.location.hash='#/sectors'}));top.append(heading,actions);view.append(top);const summary=el('div',undefined,'miv-controls');summary.append(btn('시장 국면 · 근거 보기',regime),btn('투자 대응 · 단타 / 스윙',strategy),btn('투자전략 페이지',()=>{root.location.hash='#/strategy'}),btn('거시경제 분석',openMacro));grid=el('div',undefined,'miv-grid');view.append(grid,summary,el('p','실제 연결된 지표만 수치 표시 · 차트 데이터 원천 및 수신시각은 상세 팝업에서 확인','mini'));legacy.mount(container,ctx);const legacyContent=container.querySelector(':scope > .page-content');if(legacyContent){legacyDetails=el('div');legacyDetails.hidden=true;legacyContent.replaceWith(legacyDetails);legacyDetails.append(legacyContent)}container.prepend(view);draw();const checkRegion=()=>{if(!alive)return;if(!manualRegion){const next=regionAt();if(next!==region){region=next;if(regionBtnRef)regionBtnRef.textContent=regionLabel();draw();requestVisible()}}regionTimer=setTimeout(checkRegion,60000-Date.now()%60000+5)};regionTimer=setTimeout(checkRegion,60000-Date.now()%60000+5)}
 return {mount,refresh:async(ctx,force)=>{await legacy.refresh(ctx,force);draw()},unmount:()=>{alive=false;connectionContext=null;if(regionTimer!==null){clearTimeout(regionTimer);regionTimer=null}regionBtnRef=null;manualRegion=false;close();view?.remove();legacy.unmount();legacyDetails?.remove();legacyDetails=null},getStatus:()=>({status:alive?'ready':'unmounted'})};
 }
 DashboardPages.register('market',create);
})(window);
