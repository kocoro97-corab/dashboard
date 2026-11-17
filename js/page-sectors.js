(function(root){
'use strict';
// Sector / theme V2. Read-only: reuses the existing verified Naver theme feed.
// No fabricated US rankings, multi-day returns, order routes or account writes.
const KEY='myinvest_sector_watch_v2';
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,fn)=>{const b=make('button',text);b.type='button';b.addEventListener('click',fn);return b};
const valid=s=>/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(s);
const saved=()=>{try{const a=JSON.parse(localStorage.getItem(KEY));return Array.isArray(a)?a.filter(x=>typeof x==='string'&&valid(x)).slice(0,100):[]}catch{return []}};
const safeNumber=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const pct=v=>safeNumber(v)===null?'—':(v>=0?'+':'')+v.toFixed(2)+'%';

// ETF sector proxies are not complete US industry/theme constituent rankings.
const US_SECTORS=[['XLK','정보기술'],['XLF','금융'],['XLE','에너지'],['XLV','헬스케어'],['XLI','산업재'],['XLY','경기소비재'],['XLP','필수소비재'],['XLC','커뮤니케이션'],['XLU','유틸리티'],['XLB','소재'],['XLRE','부동산']];
const PERIODS={'1d':1,'5d':5,'20d':20,'60d':60};
const SERIES_CACHE=new Map(),SERIES_TTL=10*60*1000;
const ret=(bars,n)=>bars.length>n&&bars.at(-1-n)>0?(bars.at(-1)/bars.at(-1-n)-1)*100:null;
const SERIES_PENDING=new WeakMap();
async function series(ctx,symbol){
 const cached=SERIES_CACHE.get(symbol);if(cached&&Date.now()-cached.at<SERIES_TTL)return cached.value;
 let pending=SERIES_PENDING.get(ctx);if(!pending){pending=new Map();SERIES_PENDING.set(ctx,pending)}
 if(pending.has(symbol))return pending.get(symbol);
 const job=readSeries(ctx,symbol);pending.set(symbol,job);
 try{return await job}finally{if(pending.get(symbol)===job)pending.delete(symbol)}
}
async function readSeries(ctx,symbol){
 // Reuse the existing permitted history route; 1y covers 60 trading-day windows.
 const url='https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol)+'?interval=1d&range=1y';
 const raw=await ctx.data.publicRead(url);if(!raw)throw Error('PUBLIC_DATA_UNAVAILABLE');
 const result=JSON.parse(raw)?.chart?.result?.[0],q=result?.indicators?.quote?.[0],times=result?.timestamp;
 if(!result||!q||!Array.isArray(times)||result.meta?.symbol!==symbol)throw Error('INVALID_CHART_IDENTITY');
 const domestic=symbol==='^KS11'||/\.(KS|KQ)$/.test(symbol),currency=result.meta?.currency,exchange=String(result.meta?.exchangeName||'');
 if(currency!==(domestic?'KRW':'USD'))throw Error('CHART_CURRENCY_MISMATCH');
 if(domestic&&!(/\.KQ$/.test(symbol)?/^(KOE|KOSDAQ)$/i:/^(KSC|KOSPI|KRX|SEOUL)$/i).test(exchange))throw Error('CHART_EXCHANGE_MISMATCH');
 let previous=0;const now=Date.now()/1000;
 for(const t of times){if(!Number.isSafeInteger(t)||t<=previous||t>now+300)throw Error('INVALID_CHART_TIME');previous=t}
 const regular=result.meta?.currentTradingPeriod?.regular;
 const activeDay=Number.isFinite(regular?.start)&&Number.isFinite(regular?.end)&&now<regular.end?new Date(regular.start*1000).toISOString().slice(0,10):null;
 const bars=times.map((t,i)=>({t,c:q.close?.[i],v:q.volume?.[i]})).filter(x=>Number.isFinite(x.c)&&x.c>0&&(!activeDay||new Date(x.t*1000).toISOString().slice(0,10)!==activeDay));
 if(bars.length<2)throw Error('INSUFFICIENT_BARS');
 const value={bars:bars.map(x=>x.c),times:bars.map(x=>x.t),last:bars.at(-1).t*1000,volume:bars.map(x=>x.v),currency,exchange};
 SERIES_CACHE.set(symbol,{at:Date.now(),value});return value;
}
function comparableWindow(value,benchmark,n){return value.times.length>n&&[value.times.length-1,value.times.length-1-n].every((i,k)=>new Date(value.times[i]*1000).toISOString().slice(0,10)===new Date(benchmark.times[benchmark.times.length-1-k*n]*1000).toISOString().slice(0,10))}

async function poolLimited(items,limit,fn){let index=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const item=items[index++];await fn(item)}}))}

function create(){
 const legacy=DashboardPages.legacy({ids:['themesSection'],intro:'기존 네이버 국내 주도 테마·종목 화면 (별도 원천 데이터)',refresh:(ctx,force)=>ctx.sectors(force)});
 let ctxRef=null,unsubscribe=null,view,summary,list,notice,watchArea,market='KR',period='1d',mode='day',watch=saved(),active=false,loading=false,loadError='',analytics=new Map(),analysisBusy=false,analysisError='',analysisKey='',analysisVersion=0;
 const css='.stv2{margin-bottom:18px}.stv2 button{cursor:pointer}.stv2-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.stv2-tabs button{padding:7px 11px;border:1px solid #465775;border-radius:7px;background:#172238;color:#e7eef9}.stv2-tabs button[aria-pressed="true"]{border-color:#72b5ff;background:#264365}.stv2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stv2-card{padding:13px;background:#172238;border:1px solid #344158;border-radius:10px;min-width:0;color:#e7eef9}.stv2-muted{color:#b6c5d9;font-size:12px}.stv2-row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.stv2-row input{min-width:140px;max-width:100%}.stv2-table{width:100%;border-collapse:collapse}.stv2-table td,.stv2-table th{padding:7px;border-bottom:1px solid #344158;text-align:left}.stv2-table button{color:#e7eef9;background:#264365;border:0;border-radius:5px;padding:5px}.stv2-status{padding:10px;border:1px solid #465775;border-radius:8px}.stv2-card:focus-visible{outline:2px solid #72b5ff}@media(max-width:550px){.stv2-grid{grid-template-columns:1fr}.stv2-table{font-size:12px}}';
 function tabs(parent,options,get,set){const box=make('div',undefined,'stv2-tabs');options.forEach(([value,label])=>{const b=button(label,()=>{set(value);draw()});b.setAttribute('aria-pressed',String(get()===value));box.append(b)});parent.append(box)}
 function data(){return typeof THM!=='undefined'&&Array.isArray(THM)?THM:[]}
 function holdings(){const codes=new Set();let snap;try{snap=ctxRef?.snapshot()}catch{return codes}if(!snap||!Array.isArray(snap.details)||!Array.isArray(snap.result?.rows)||snap.details.length!==snap.result.rows.length)return codes;for(let i=0;i<snap.details.length;i++){const d=snap.details[i],a=snap.result.rows[i],code=String(d?.code||'').trim();if(!/^\d{6}$/.test(code)||d.market!=='domestic'||d.currency!=='KRW'||d.draft||!a?.identity||a.issues?.includes('IDENTITY_UNKNOWN')||!Number.isFinite(d.quantity)||d.quantity<=0)continue;codes.add(code)}return codes}
 function themeRows(t){return Array.isArray(t.rows)?t.rows.filter(r=>r&&/^\d{6}$/.test(String(r.code))):[]}
 function nameFor(code){const id=String(code||'').trim().toUpperCase();for(const t of data()){for(const row of themeRows(t)){if(String(row.code).trim().toUpperCase()===id&&typeof row.name==='string'&&row.name.trim()&&row.name.trim()!==id)return row.name.trim()}}let snap;try{snap=ctxRef?.snapshot()}catch{}if(Array.isArray(snap?.details)){const h=snap.details.find(x=>String(x?.code||'').trim().toUpperCase()===id&&!x.draft&&typeof x.name==='string'&&x.name.trim()&&x.name.trim()!==id);if(h)return h.name.trim()}return null}
 function displayName(code){const name=nameFor(code);return name?name+' ('+code+')':code+' · 종목명 미확인'}
 function ranking(){return data().filter(t=>t&&t.name&&safeNumber(t.sc)!==null&&safeNumber(t.rate)!==null).slice().sort((a,b)=>b.sc-a.sc||b.rate-a.rate)}
 function metrics(t){const rows=themeRows(t),priced=rows.filter(r=>safeNumber(r.rate)!==null),up=priced.filter(r=>r.rate>0).length,down=priced.filter(r=>r.rate<0).length,flat=priced.length-up-down,turnover=rows.filter(r=>safeNumber(r.val)!==null).reduce((sum,r)=>sum+r.val,0),coverage=rows.filter(r=>safeNumber(r.val)!==null).length;return {count:rows.length,priced:priced.length,up,down,flat,breadth:priced.length?up/priced.length*100:null,turnover:coverage?turnover:null,coverage}}
 function leaderRows(t){return themeRows(t).filter(r=>safeNumber(r.rate)!==null).slice().sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0)||b.rate-a.rate)}
 function dashboard(){const items=ranking();if(!items.length)return;const panel=make('section',undefined,'stv2-overview'),title=make('h3','당일 주도 테마 · 관측 요약');panel.append(title,make('p','네이버 수신 후보 '+items.length+'개 · 관측시각 미확인 · 수신 '+(typeof THM_AT!=='undefined'&&THM_AT?new Date(THM_AT).toLocaleString('ko-KR'):'미확인')+' · 기간: 당일만','stv2-muted'));const cards=make('div',undefined,'stv2-grid');for(const t of items.slice(0,4)){const m=metrics(t),c=button('',()=>detail(t));c.className='stv2-card';c.style.textAlign='left';c.append(make('strong',t.name),make('p','테마 등락률 '+pct(t.rate)+' · 강도 '+Math.round(t.sc)+'/100'),make('p','구성종목 상승 '+m.up+' / 하락 '+m.down+' / 보합 '+m.flat+' · 등락 확인 '+m.priced+'/'+m.count,'stv2-muted'),make('p','상승비율 '+(m.breadth===null?'미확인':m.breadth.toFixed(1)+'%')+' · 구성종목 거래대금 '+(m.turnover===null?'미확인':m.turnover.toLocaleString('ko-KR'))+' (원천 단위 확인 필요)','stv2-muted'));cards.append(c)}panel.append(cards);const all=items.flatMap(t=>leaderRows(t).slice(0,5).map(r=>({...r,theme:t.name}))),seen=new Set(),leaders=all.sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0)).filter(r=>{if(seen.has(r.code))return false;seen.add(r.code);return true}).slice(0,8);panel.append(make('h3','주도 후보 · 수신 테마 구성종목 거래대금순'));if(leaders.length){const table=make('table',undefined,'stv2-table'),header=make('tr');['종목명 (코드)','테마','등락률','거래대금','분석'].forEach(x=>header.append(make('th',x)));table.append(header);for(const r of leaders){const tr=make('tr');tr.append(make('td',displayName(r.code)),make('td',r.theme),make('td',pct(r.rate)),make('td',safeNumber(r.val)===null?'미확인':r.val.toLocaleString('ko-KR')));const td=make('td');td.append(button('종목분석',()=>{if(window.MYInvestStockSelection)window.MYInvestStockSelection.open(r.code,{name:nameFor(r.code)||'',theme:r.theme,mode});else notice.textContent='종목분석 연결을 확인하세요.'}));tr.append(td);table.append(tr)}panel.append(table)}panel.append(make('p','후보는 수신된 상위 테마의 구성종목 일부만 대상으로 합니다. 전체 시장 순위·기관/외국인 순매수·실시간 AI 추천이 아닙니다. 동일 종목의 테마 중복을 제거했습니다.','stv2-muted'));list.append(panel)}
 async function reload(){if(loading||!active||!ctxRef)return;loading=true;loadError='';notice.textContent='국내 테마 원천 데이터 새로고침 중…';try{await ctxRef.sectors(true)}catch{loadError='테마 데이터 수신 실패 · 중계와 네이버 원천 상태를 확인하세요.'}finally{loading=false;if(active)draw()}}

 function keyFor(){return market+':'+period+':'+mode}
 async function loadAnalytics(force=false){
  if(!active||!ctxRef||!ctxRef.publicConnected?.()||analysisBusy)return;
  if(market==='KR'&&period==='1d'&&mode==='day')return;
  const key=keyFor();if(!force&&analytics.has(key))return;const context=ctxRef;if(force)SERIES_CACHE.clear();
  analysisBusy=true;analysisError='';analysisKey=key;const version=++analysisVersion;draw();
  try{
   const n=PERIODS[period],benchmarkSymbol=market==='US'?'SPY':'^KS11',benchmark=await series(context,benchmarkSymbol),base=ret(benchmark.bars,n);
   if(base===null)throw Error('BENCHMARK_HISTORY_MISSING');
   if(!active||version!==analysisVersion||keyFor()!==key)return;
   const rows=[],failures=[];
   if(market==='US'){
    await poolLimited(US_SECTORS,3,async ([symbol,name])=>{try{if(!active||version!==analysisVersion||keyFor()!==key)return;const v=await series(context,symbol);const change=ret(v.bars,n);if(change!==null&&v.currency==='USD'&&comparableWindow(v,benchmark,n))rows.push({symbol,name,change,relative:change-base,asof:v.last,coverage:'ETF',v});else failures.push({symbol,reason:change===null?'INSUFFICIENT_HISTORY':'DATE_MISMATCH'})}catch{failures.push({symbol,reason:'SERIES_UNAVAILABLE'})}});
   }else{
    if((typeof EXT_MASTER==='undefined'||!EXT_MASTER)&&typeof loadExternalMaster==='function')await loadExternalMaster();
    const themes=ranking().slice(0,6);
    await poolLimited(themes,2,async t=>{
     if(!active||version!==analysisVersion||keyFor()!==key)return;
     const stocks=themeRows(t).slice(0,5),results=[];
     await poolLimited(stocks,2,async stock=>{
      if(!active||version!==analysisVersion||keyFor()!==key)return;
      const listing=typeof EXT_MASTER!=='undefined'?EXT_MASTER?.byCode?.get(stock.code):null;const suffix=listing?.market==='KOSPI'?'.KS':listing?.market==='KOSDAQ'?'.KQ':null;if(!suffix){failures.push({symbol:stock.code,reason:'IDENTITY_UNKNOWN'});return;}
      for(const verifiedSuffix of [suffix]){try{const v=await series(context,stock.code+verifiedSuffix);if(v.currency!=='KRW'||!(/KSC|KOE|KOSPI|KOSDAQ|KRX|SEOUL/i.test(v.exchange||'')))continue;const change=ret(v.bars,n);if(change!==null&&comparableWindow(v,benchmark,n)){results.push({change,symbol:stock.code,name:stock.name,asof:v.last});break}else failures.push({symbol:stock.code,reason:change===null?'INSUFFICIENT_HISTORY':'DATE_MISMATCH'})}catch{failures.push({symbol:stock.code,reason:'SERIES_UNAVAILABLE'})}}
     });
     if(results.length>=2){const change=results.reduce((a,x)=>a+x.change,0)/results.length;rows.push({symbol:String(t.no),name:t.name,change,relative:change-base,asof:Math.min(...results.map(x=>x.asof)),coverage:results.length+'/'+stocks.length+'개 구성종목 동일가중 표본',sample:results})}
    });
   }
   if(!active||version!==analysisVersion||keyFor()!==key)return;
   analytics.set(key,{rows:rows.sort((a,b)=>b.relative-a.relative),benchmark:base,benchmarkSymbol,received:Date.now(),period,market,failures});
  }catch(e){if(active&&version===analysisVersion&&keyFor()===key)analysisError='시계열 수신 또는 검증 실패 · 실제 데이터 연결 상태를 확인하세요.'}
  finally{if(active&&version===analysisVersion){analysisBusy=false;draw();if(keyFor()!==key)void loadAnalytics()}}
 }
 function analyticsView(){
  const key=keyFor(),data=analytics.get(key);
  if(analysisBusy)list.append(make('p',(analysisKey===key?'실제 일봉 데이터 분석 중…':'이전 요청 정리 후 선택 화면 자료 조회 중…')+' 다른 화면은 계속 이용할 수 있습니다.','stv2-status'));
  if(analysisError&&!data)list.append(make('p',analysisError,'stv2-status'));
  if(!data){if(!analysisBusy)list.append(button('실제 시계열 조회',()=>void loadAnalytics(true)));return}
  const n=PERIODS[period],label=market==='US'?'미국 11개 섹터 ETF 상대강도':'국내 상위 테마 구성종목 표본 분석';
  list.append(make('h3',label),make('p','기간 '+n+'거래일 · 기준 '+data.benchmarkSymbol+' '+pct(data.benchmark)+' · 수신 '+new Date(data.received).toLocaleString('ko-KR')+' · 종가 기준 (실시간 아님)','stv2-muted'));
  const table=make('table',undefined,'stv2-table'),head=make('tr');['섹터/테마','기간 수익률','기준 대비','데이터 범위','관측일'].forEach(x=>head.append(make('th',x)));table.append(head);
  for(const row of data.rows){const tr=make('tr');tr.append(make('td',row.name+' ('+row.symbol+')'),make('td',pct(row.change)),make('td',pct(row.relative)),make('td',row.coverage),make('td',new Date(row.asof).toLocaleDateString('ko-KR')));table.append(tr)}
  list.append(table);
  if(market==='US')list.append(make('p','검증 수신 '+data.rows.length+'/'+US_SECTORS.length+'개 ETF','stv2-muted'));
  if(data.failures?.length)list.append(make('p','일부 시계열 제외 · '+data.failures.map(x=>x.symbol+' ('+x.reason+')').join(', '),'stv2-status'));
  if(!data.rows.length)list.append(make('p','검증된 시계열 결과가 없습니다. 원천 연결을 확인하세요.','stv2-status'));
  list.append(make('p',market==='US'?'ETF 가격 기반 섹터 대리지표입니다. 개별 미국 테마·구성종목·실제 자금유입 순위가 아닙니다.':'네이버 상위 테마의 일부 구성종목만 사용한 동일가중 표본입니다. 전체 테마 수익률 또는 확정 스윙 순위가 아닙니다.','stv2-muted'));
  if(mode==='swing')list.append(make('p','스윙 관찰: 상대강도와 기간 수익률만 표시. 실적·기관수급·진입/손절 검증 전 매수 추천이 아닙니다.','stv2-muted'));
 }

 function detail(t){list.replaceChildren();const back=button('← 테마 순위로',()=>draw());list.append(back,make('h3',t.name),make('p','원천: 네이버 국내 테마 API · 기존 대시보드 수신값 · '+(typeof THM_AT!=='undefined'&&THM_AT?new Date(THM_AT).toLocaleString('ko-KR'):'수신시각 미확인'),'stv2-muted'));
 const rows=themeRows(t).slice().sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0));const table=make('table',undefined,'stv2-table'),head=make('tr');['종목','등락률','거래대금','내 종목'].forEach(x=>head.append(make('th',x)));table.append(head);const owned=holdings();rows.forEach(r=>{const tr=make('tr'),name=button(displayName(r.code),()=>{if(window.MYInvestStockSelection)window.MYInvestStockSelection.open(r.code,{name:nameFor(r.code)||'',theme:t.name,mode});else if(typeof showQ==='function')showQ(r.code,r.name||r.code,'')}),td=make('td');td.append(name);tr.append(td,make('td',pct(r.rate)),make('td',safeNumber(r.val)===null?'미수신':Number(r.val).toLocaleString('ko-KR')),make('td',owned.has(r.code)?'보유':watch.includes(r.code)?'관심':'—'));table.append(tr)});list.append(table);if(!rows.length)list.append(make('p','검증된 구성종목 데이터가 없습니다.','stv2-muted'));list.append(make('p','거래대금은 매수 순유입액이 아닙니다. 종목 중복으로 테마별 거래대금을 전체 시장 자금처럼 합산하지 않습니다.','stv2-muted'))}
 function watchDraw(){watchArea.replaceChildren();const h=make('h3','내 보유·관심종목 연계'),form=make('form'),input=make('input'),add=button('관심종목 추가',()=>{});input.placeholder='국내 6자리 코드 / 미국 티커';input.setAttribute('aria-label','관심종목 코드');add.type='submit';form.append(input,add);form.addEventListener('submit',e=>{e.preventDefault();const id=input.value.trim().toUpperCase();if(!valid(id)){notice.textContent='국내 6자리 코드 또는 영문 티커를 입력하세요.';return}if(!watch.includes(id))watch.push(id);watch=watch.slice(0,100);try{localStorage.setItem(KEY,JSON.stringify(watch))}catch{}input.value='';draw()});watchArea.append(h,form);
 const owned=holdings(),all=[...new Set([...owned,...watch])];if(!all.length){watchArea.append(make('p','연결된 보유종목 또는 직접 등록한 관심종목이 없습니다.','stv2-muted'));return}
 const tbl=make('table',undefined,'stv2-table'),hdr=make('tr');['종목명 (코드)','구분','국내 주도 테마','관리'].forEach(x=>hdr.append(make('th',x)));tbl.append(hdr);all.forEach(code=>{const related=ranking().filter(t=>themeRows(t).some(r=>r.code===code)).map(t=>t.name);const tr=make('tr');tr.append(make('td',displayName(code)),make('td',owned.has(code)?'보유'+(watch.includes(code)?'·관심':''):'관심'),make('td',related.length?related.join(', '):'현재 수신된 상위 테마에서 미확인'));const td=make('td');td.append(button('AI 분석',()=>{if(window.MYInvestStockSelection)window.MYInvestStockSelection.open(code,{mode,name:nameFor(code)||''})}));if(watch.includes(code))td.append(button('삭제',()=>{watch=watch.filter(x=>x!==code);try{localStorage.setItem(KEY,JSON.stringify(watch))}catch{}draw()}));tr.append(td);tbl.append(tr)});watchArea.append(tbl,make('p','보유 여부는 현재 화면의 기존 계좌 데이터에 한정됩니다. 관심종목은 이 브라우저에만 저장되며, 종목명·상장 여부를 추정하지 않습니다.','stv2-muted'))}
 function draw(){if(!active)return;summary.replaceChildren();list.replaceChildren();notice.textContent='';const h=make('h2','섹터·테마 분석 V2'),desc=make('p','전체 시장 주도 테마와 내 보유·관심종목 연결 · 데이터 검증 우선','stv2-muted');summary.append(h,desc,button(loading?'갱신 중…':'국내 테마 새로고침',reload));if(loadError)notice.textContent=loadError;
 tabs(summary,[['KR','한국'],['US','미국']],()=>market,v=>{market=v;void loadAnalytics()});
 tabs(summary,[['1d','1일'],['5d','5일'],['20d','20일'],['60d','60일']],()=>period,v=>{period=v;void loadAnalytics()});
 tabs(summary,[['day','단타'],['swing','스윙']],()=>mode,v=>{mode=v;void loadAnalytics()});
 const stamp=typeof THM_AT!=='undefined'&&THM_AT?new Date(THM_AT).toLocaleString('ko-KR'):'미수신';
 summary.append(make('p','수신 기준: '+stamp+' · 국내 테마: 네이버 API · 분석 범위: 수신된 상위 후보만 · '+(mode==='day'?'단타 관찰: 거래대금·당일 상대강도':'스윙 관찰: 중기 추세·실적·수급 검증 필요'),'stv2-muted'));
 if(market==='KR'&&period==='1d'&&mode==='day'){dashboard();renderRanks()}
 else {analyticsView();if(market==='KR'&&period==='1d'){list.append(make('p','참고: 아래는 당일 테마 목록이며 스윙 확정 순위가 아닙니다.','stv2-muted'));renderRanks()}}

 watchDraw()}
 function renderRanks(){const items=ranking(),cards=make('div',undefined,'stv2-grid');if(!items.length){list.append(make('p','검증된 국내 테마 데이터 미수신 · 기존 테마 갱신 버튼으로 조회하세요.','stv2-status'));return}
 items.forEach((t,i)=>{const card=button('',()=>detail(t));card.className='stv2-card';card.style.textAlign='left';card.append(make('strong',(i+1)+'위 · '+t.name),make('p','당일 테마 강도 '+Math.round(t.sc)+'/100 · 등락률 '+pct(t.rate)),make('p','구성종목 '+themeRows(t).length+'개 · '+(safeNumber(t.val)===null?'거래대금 미확인':'거래대금 집계 가능'),'stv2-muted'));const m=metrics(t);card.append(make('p','상승 '+m.up+' / 하락 '+m.down+' · 상승비율 '+(m.breadth===null?'미확인':m.breadth.toFixed(1)+'%'),'stv2-muted'));const owned=holdings(),matches=themeRows(t).filter(r=>owned.has(r.code)||watch.includes(r.code));if(matches.length)card.append(make('p','내 종목 연계: '+matches.map(r=>displayName(r.code)).join(', '),'stv2-muted'));cards.append(card)});list.append(cards,make('p','순위는 기존 수신 후보 내 상대점수이며 전체 시장의 확정 순위가 아닙니다. 순매수액·기관/외국인 수급·뉴스는 미반영입니다.','stv2-muted'))}
 function mount(container,ctx){active=true;ctxRef=ctx;unsubscribe=ctx.subscribe?.(()=>{if(active)draw()});view=make('section',undefined,'stv2');const style=make('style');style.textContent=css;view.append(style);summary=make('div');list=make('div');notice=make('p',undefined,'stv2-muted');watchArea=make('div');view.append(summary,notice,list,watchArea);legacy.mount(container,ctx);container.prepend(view);draw();if(!data().length&&!loading&&ctx.publicConnected?.())void reload();else void loadAnalytics()}
 return {mount,refresh:async(ctx,force)=>{await legacy.refresh(ctx,force);draw();if(force)analytics.clear();void loadAnalytics(force)},unmount:()=>{active=false;analysisVersion++;analysisBusy=false;unsubscribe?.();unsubscribe=null;ctxRef=null;view?.remove();legacy.unmount()},getStatus:()=>({status:active?'ready':'unmounted',market,period,mode})};
}
DashboardPages.register('sectors',create);
})(window);
