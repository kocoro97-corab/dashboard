(function(root){
'use strict';
// Sector / theme V2. Read-only: reuses the existing verified Naver theme feed.
// No fabricated US rankings, multi-day returns, order routes or account writes.
const KEY='myinvest_sector_watch_v2';
const UI_KEY='myinvest_sectors_display_v3';
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,fn)=>{const b=make('button',text);b.type='button';b.addEventListener('click',fn);return b};
const valid=s=>/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(s);
const saved=()=>{try{const a=JSON.parse(localStorage.getItem(KEY));return Array.isArray(a)?a.filter(x=>typeof x==='string'&&valid(x)).slice(0,100):[]}catch{return []}};
const safeNumber=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const pct=v=>safeNumber(v)===null?'—':(v>=0?'+':'')+v.toFixed(2)+'%';

// ETF sector proxies are not complete US industry/theme constituent rankings.
const US_SECTORS=[['XLK','정보기술'],['XLF','금융'],['XLE','에너지'],['XLV','헬스케어'],['XLI','산업재'],['XLY','경기소비재'],['XLP','필수소비재'],['XLC','커뮤니케이션'],['XLU','유틸리티'],['XLB','소재'],['XLRE','부동산']];
const defaultMarketAt=(date=new Date())=>{const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(date));return hour>=7&&hour<21?'KR':'US'};
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
 if(typeof window!=='undefined')window.InstrumentNames?.ingest(symbol,result.meta);
 const quoteTime=result.meta?.regularMarketTime,currentObservedAt=Number.isFinite(quoteTime)&&quoteTime>0&&quoteTime<=now+300?quoteTime*1000:null;
 const value={currentPrice:currentObservedAt&&Number.isFinite(result.meta?.regularMarketPrice)&&result.meta.regularMarketPrice>0?result.meta.regularMarketPrice:null,currentObservedAt,instrumentType:result.meta?.instrumentType,bars:bars.map(x=>x.c),times:bars.map(x=>x.t),last:bars.at(-1).t*1000,volume:bars.map(x=>x.v),currency,exchange};
 SERIES_CACHE.set(symbol,{at:Date.now(),value});return value;
}
function comparableWindow(value,benchmark,n){return value.times.length>n&&[value.times.length-1,value.times.length-1-n].every((i,k)=>new Date(value.times[i]*1000).toISOString().slice(0,10)===new Date(benchmark.times[benchmark.times.length-1-k*n]*1000).toISOString().slice(0,10))}

// Compare actual observations on the benchmark calendar. A missing latest index
// close must not discard every constituent or invent an index close.
function alignedWindow(value,benchmark,n){
 if(benchmark.times.length<=n)return null;
 const days=benchmark.times.slice(-n-1),day=t=>new Date(t*1000).toISOString().slice(0,10),positions=new Map(value.times.map((t,i)=>[day(t),i]));
 const indices=days.map(t=>positions.get(day(t)));if(indices.some(i=>i===undefined))return null;
 const closes=indices.map(i=>value.bars[i]),change=ret(closes,n),base=ret(benchmark.bars,n);if(change===null||base===null)return null;
 return {change,relative:change-base,asof:days.at(-1)*1000,close:closes.at(-1),volume:value.volume?.[indices.at(-1)]};
}
let US_UNIVERSE=null,US_UNIVERSE_PENDING=null;
async function usUniverse(){
 if(US_UNIVERSE)return US_UNIVERSE;if(US_UNIVERSE_PENDING)return US_UNIVERSE_PENDING;
 US_UNIVERSE_PENDING=(async()=>{const response=await fetch('data/us-theme-instruments.json',{cache:'no-cache'});if(!response.ok)throw Error('US_UNIVERSE_UNAVAILABLE');const doc=await response.json();
 if(doc.schemaVersion!==1||doc.scope!=='ISSUER_THEMATIC_EQUITY_SAMPLES'||!Array.isArray(doc.themes)||!doc.themes.length)throw Error('INVALID_US_UNIVERSE');
 const ids=new Set();for(const t of doc.themes){if(!/^[A-Z0-9]{2,12}$/.test(t.id)||ids.has(t.id)||typeof t.name!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(t.asOf)||!Number.isFinite(Date.parse(t.asOf))||Date.parse(t.asOf)>Date.now()||!t.source?.startsWith('https://assets.ark-funds.com/fund-documents/')||!Array.isArray(t.instruments)||t.instruments.length<2)throw Error('INVALID_US_THEME');ids.add(t.id);const seen=new Set();for(const r of t.instruments){if(!/^[A-Z][A-Z0-9.-]{0,14}$/.test(r.symbol)||seen.has(r.symbol)||r.currency!=='USD'||r.instrumentType!=='EQUITY'||typeof r.name!=='string'||!r.name||typeof r.exchange!=='string')throw Error('INVALID_US_MEMBER');seen.add(r.symbol)}}
 US_UNIVERSE=doc;return doc})();try{return await US_UNIVERSE_PENDING}finally{US_UNIVERSE_PENDING=null}
}

async function poolLimited(items,limit,fn){let index=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(index<items.length){const item=items[index++];await fn(item)}}))}

function create(){
 const legacy=DashboardPages.legacy({ids:['themesSection'],refresh:(ctx,force)=>ctx.sectors(force)});
 let ctxRef=null,unsubscribe=null,legacyHolder=null,view,summary,list,notice,watchArea,market='KR',period='1d',mode='day',watch=saved(),active=false,loading=false,loadError='',analytics=new Map(),analysisBusy=false,analysisError='',analysisKey='',analysisVersion=0,detailVersion=0,category='theme',industryRows=[],industryReceived=null,industryBusy=false,industryError='',marketTimer=null,manualMarket=false;
 const css='.stv2{margin-bottom:18px}.stv2-heading{display:flex;gap:8px;align-items:center;justify-content:space-between}.stv2-heading h2{margin:0;min-width:0}.stv2-heading>button{flex-shrink:0}.stv2-industry-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.stv2-industry-head h3{margin:0}.stv2-mixed{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stv2-mixed>section{background:#172238;border:1px solid #344158;border-radius:9px;padding:11px;min-width:0}.stv2-mixed button{display:block;text-align:left;width:100%;margin:6px 0}.stv2-period-label{font-size:12px;color:#b6c5d9}.stv2-toolbar{display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin:10px 0}.stv2-toolbar .stv2-tabs{margin:0}.stv2-region{padding:7px 11px;border:1px solid #72b5ff;border-radius:7px;background:#264365;color:#e7eef9}.stv2-etfs{margin-top:12px}.stv2-status p{overflow-wrap:anywhere}.stv2 button{cursor:pointer}.stv2-tabs{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0}.stv2-tabs button{padding:7px 11px;border:1px solid #465775;border-radius:7px;background:#172238;color:#e7eef9}.stv2-tabs button[aria-pressed="true"]{border-color:#72b5ff;background:#264365}.stv2-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stv2-card{padding:13px;background:#172238;border:1px solid #344158;border-radius:10px;min-width:0;color:#e7eef9}.stv2-muted{color:#b6c5d9;font-size:12px}.stv2-row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}.stv2-row input{min-width:140px;max-width:100%}.stv2-table{width:100%;border-collapse:collapse}.stv2-table td,.stv2-table th{padding:7px;border-bottom:1px solid #344158;text-align:left}.stv2-table button{color:#e7eef9;background:#264365;border:0;border-radius:5px;padding:5px}.stv2-status{padding:10px;border:1px solid #465775;border-radius:8px}.stv2-card:focus-visible{outline:2px solid #72b5ff}@media(max-width:650px){.stv2-mixed{grid-template-columns:1fr}}@media(max-width:550px){.stv2-grid{grid-template-columns:1fr}.stv2-table{font-size:12px}}';
 function saveDisplay(){try{localStorage.setItem(UI_KEY,JSON.stringify({market:manualMarket?market:null,mode,period,category}))}catch{}}
 function restoreDisplay(){try{const state=JSON.parse(localStorage.getItem(UI_KEY)||'null');if(!state||typeof state!=='object')return;if(['KR','US','MIX'].includes(state.market)){market=state.market;manualMarket=true}if(['day','swing'].includes(state.mode))mode=state.mode;if(['theme','industry'].includes(state.category))category=state.category;period=mode==='swing'&&['5d','20d','60d'].includes(state.period)?state.period:'1d'}catch{}}
 function chooseMarket(next){if(!['KR','US','MIX'].includes(next))return false;manualMarket=true;market=next;analysisError='';saveDisplay();draw();if((next==='KR'||next==='MIX')&&category==='theme'&&!data().length)void reload();void loadAnalytics();return false}
 function tabs(parent,options,get,set){const box=make('div',undefined,'stv2-tabs');options.forEach(([value,label])=>{const b=button(label,()=>{const next=set(value);if(next!==false)draw()});b.setAttribute('aria-pressed',String(get()===value));box.append(b)});parent.append(box)}
 function data(){return typeof THM!=='undefined'&&Array.isArray(THM)?THM:[]}
 function holdings(){const codes=new Set();let snap;try{snap=ctxRef?.snapshot()}catch{return codes}if(!snap||!Array.isArray(snap.details)||!Array.isArray(snap.result?.rows)||snap.details.length!==snap.result.rows.length)return codes;for(let i=0;i<snap.details.length;i++){const d=snap.details[i],a=snap.result.rows[i],code=String(d?.code||'').trim();if(!/^\d{6}$/.test(code)||d.market!=='domestic'||d.currency!=='KRW'||d.draft||!a?.identity||a.issues?.includes('IDENTITY_UNKNOWN')||!Number.isFinite(d.quantity)||d.quantity<=0)continue;codes.add(code)}return codes}
 function themeRows(t){return Array.isArray(t.rows)?t.rows.filter(r=>r&&/^\d{6}$/.test(String(r.code))):[]}
 function nameFor(code){const id=String(code||'').trim().toUpperCase();for(const t of data()){for(const row of themeRows(t)){if(String(row.code).trim().toUpperCase()===id&&typeof row.name==='string'&&row.name.trim()&&row.name.trim()!==id)return row.name.trim()}}let snap;try{snap=ctxRef?.snapshot()}catch{}if(Array.isArray(snap?.details)){const h=snap.details.find(x=>String(x?.code||'').trim().toUpperCase()===id&&!x.draft&&typeof x.name==='string'&&x.name.trim()&&x.name.trim()!==id);if(h)return h.name.trim()}return null}
 function displayName(code){const name=nameFor(code);return name?name+' ('+code+')':code+' · 종목명 미확인'}
 function ranking(){return data().filter(t=>t&&t.name&&safeNumber(t.sc)!==null&&safeNumber(t.rate)!==null).slice().sort((a,b)=>b.sc-a.sc||b.rate-a.rate)}
 function metrics(t){const rows=themeRows(t),priced=rows.filter(r=>safeNumber(r.rate)!==null),up=priced.filter(r=>r.rate>0).length,down=priced.filter(r=>r.rate<0).length,flat=priced.length-up-down,turnover=rows.filter(r=>safeNumber(r.val)!==null).reduce((sum,r)=>sum+r.val,0),coverage=rows.filter(r=>safeNumber(r.val)!==null).length;return {count:rows.length,priced:priced.length,up,down,flat,breadth:priced.length?up/priced.length*100:null,turnover:coverage?turnover:null,coverage}}
 function leaderRows(t){return themeRows(t).filter(r=>safeNumber(r.rate)!==null).slice().sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0)||b.rate-a.rate)}
 function dashboard(){const items=ranking();if(!items.length)return;const panel=make('section',undefined,'stv2-overview'),title=make('h3','당일 주도 테마 · 관측 요약');panel.append(title,make('p','네이버 수신 후보 '+items.length+'개 · 관측시각 미확인 · 수신 '+(typeof THM_AT!=='undefined'&&THM_AT?new Date(THM_AT).toLocaleString('ko-KR'):'미확인')+' · 기간: 당일만','stv2-muted'));const cards=make('div',undefined,'stv2-grid');for(const t of items.slice(0,4)){const m=metrics(t),c=button('',()=>detail(t));c.className='stv2-card';c.style.textAlign='left';c.append(make('strong',t.name),make('p','테마 등락률 '+pct(t.rate)+' · 강도 '+Math.round(t.sc)+'/100'),make('p','구성종목 상승 '+m.up+' / 하락 '+m.down+' / 보합 '+m.flat+' · 등락 확인 '+m.priced+'/'+m.count,'stv2-muted'),make('p','상승비율 '+(m.breadth===null?'미확인':m.breadth.toFixed(1)+'%')+' · 구성종목 거래대금 '+(m.turnover===null?'미확인':m.turnover.toLocaleString('ko-KR'))+' (원천 단위 확인 필요)','stv2-muted'));cards.append(c)}const all=items.flatMap(t=>leaderRows(t).slice(0,5).map(r=>({...r,theme:t.name}))),seen=new Set(),leaders=all.sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0)).filter(r=>{if(seen.has(r.code))return false;seen.add(r.code);return true}).slice(0,8);panel.append(make('h3','거래대금 상위 관심후보 · 수신 테마 구성종목'));if(leaders.length){const table=make('table',undefined,'stv2-table'),header=make('tr');['종목명 (코드)','테마','등락률','거래대금','분석'].forEach(x=>header.append(make('th',x)));table.append(header);for(const r of leaders){const tr=make('tr');tr.append(make('td',displayName(r.code)),make('td',r.theme),make('td',pct(r.rate)),make('td',safeNumber(r.val)===null?'미확인':r.val.toLocaleString('ko-KR')));const td=make('td');td.append(button('종목분석',()=>{if(window.MYInvestStockSelection)window.MYInvestStockSelection.open(r.code,{name:nameFor(r.code)||'',theme:r.theme,mode,period,source:'theme',rank:ranking().findIndex(t=>t.name===r.theme)+1,strength:ranking().find(t=>t.name===r.theme)?.sc??null,themeReturn:ranking().find(t=>t.name===r.theme)?.rate??null});else notice.textContent='종목분석 연결을 확인하세요.'}));tr.append(td);table.append(tr)}panel.append(table)}panel.append(make('p','거래대금 상위 관심후보는 수신된 테마의 구성종목 일부를 대상으로 하며, 가격 상승 또는 초과수익이 확인된 주도주라는 뜻은 아닙니다. 전체 시장 순위·기관/외국인 순매수·실시간 AI 추천이 아니고 중복 종목은 제거했습니다.','stv2-muted'));list.append(panel)}
 async function reload(){if(loading||!active||!ctxRef)return;loading=true;loadError='';notice.textContent='국내 테마 원천 데이터 새로고침 중…';try{await ctxRef.sectors(true)}catch{loadError='테마 데이터 수신 실패 · 중계와 네이버 원천 상태를 확인하세요.'}finally{loading=false;if(active){SERIES_CACHE.clear();analytics.clear();draw();void loadAnalytics()}}}

 function keyFor(which=market){return which+':'+period+':'+mode+':'+category}
 async function loadAnalytics(force=false,requestedMarket=market){
   if(requestedMarket==='MIX'){await loadAnalytics(force,'KR');await loadAnalytics(force,'US');return}
   const market=requestedMarket;
  if(!active||!ctxRef||!ctxRef.publicConnected?.()||analysisBusy||(market==='KR'&&loading))return;
  if(market==='KR'&&period==='1d'&&mode==='day'){if(category==='industry'&&!industryRows.length)void loadIndustries(force);return;}
  const key=keyFor(market);if(!force&&analytics.has(key))return;const context=ctxRef;if(force)SERIES_CACHE.clear();
  analysisBusy=true;analysisError='';analysisKey=key;const version=++analysisVersion;draw();
  try{
   if(market==='KR'&&category==='industry'&&!industryRows.length){await loadIndustries(force);if(!industryRows.length)throw Error('INDUSTRY_UNAVAILABLE')}
   const n=PERIODS[period],benchmarkSymbol=market==='US'?'SPY':'^KS11',benchmark=await series(context,benchmarkSymbol),base=ret(benchmark.bars,n);
   if(base===null)throw Error('BENCHMARK_HISTORY_MISSING');
   if(!active||version!==analysisVersion||keyFor(market)!==key)return;
   const rows=[],failures=[],themes=[];
   if(market==='US'){
    await poolLimited(US_SECTORS,3,async ([symbol,name])=>{try{if(!active||version!==analysisVersion||keyFor(market)!==key)return;const v=await series(context,symbol);const aligned=alignedWindow(v,benchmark,n);if(v.instrumentType!=='ETF'){failures.push({symbol,reason:'ETF_IDENTITY_MISMATCH'});return}if(aligned&&v.currency==='USD')rows.push({symbol,name,...aligned,coverage:'ETF',v});else failures.push({symbol,reason:v.bars.length<=n?'INSUFFICIENT_HISTORY':'DATE_MISMATCH'})}catch{failures.push({symbol,reason:'SERIES_UNAVAILABLE'})}});
    const universe=category==='theme'?await usUniverse().catch(()=>{failures.push({symbol:'US_THEMES',reason:'UNIVERSE_UNAVAILABLE'});return {themes:[]}}):{themes:[]};
    await poolLimited(universe.themes,2,async t=>{
     if(!active||version!==analysisVersion||keyFor(market)!==key)return;const sample=[];
     await poolLimited(t.instruments,2,async stock=>{if(!active||version!==analysisVersion||keyFor(market)!==key)return;try{const v=await series(context,stock.symbol);if(v.instrumentType!=='EQUITY'||v.exchange!==stock.exchange)throw Error('IDENTITY_MISMATCH');const aligned=alignedWindow(v,benchmark,n);if(aligned)sample.push({symbol:stock.symbol,name:stock.name,...aligned,currentPrice:v.currentPrice,currentObservedAt:v.currentObservedAt,returns:Object.fromEntries([1,5,20,60].map(days=>[days,alignedWindow(v,benchmark,days)?.change??null])),relativeByPeriod:Object.fromEntries([1,5,20,60].map(days=>[days,alignedWindow(v,benchmark,days)?.relative??null]))});else failures.push({symbol:stock.symbol,reason:'DATE_MISMATCH'})}catch{failures.push({symbol:stock.symbol,reason:'SERIES_UNAVAILABLE'})}});
     const quality=root.SectorInsights.sampleBreadth(sample,t.instruments.length);
      if(quality.rankable){const change=sample.reduce((a,x)=>a+x.change,0)/sample.length;themes.push({...t,sample,change,relative:change-base,asof:benchmark.last,quality})}
      else failures.push({symbol:t.id,reason:'SAMPLE_COVERAGE_INSUFFICIENT'});
    });
   }else{
    if((typeof EXT_MASTER==='undefined'||!EXT_MASTER)&&typeof loadExternalMaster==='function')await loadExternalMaster();
    const themes=(category==='industry'?industryRows:ranking()).slice(0,6);
    await poolLimited(themes,2,async t=>{
     if(!active||version!==analysisVersion||keyFor(market)!==key)return;
     const memberRows=category==='industry'?(await root.IndustryData.read(context,t.no,force)).rows:themeRows(t),stocks=memberRows.slice().sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0)).slice(0,5),results=[];
     await poolLimited(stocks,2,async stock=>{
      if(!active||version!==analysisVersion||keyFor(market)!==key)return;
      const listing=typeof EXT_MASTER!=='undefined'?EXT_MASTER?.byCode?.get(stock.code):null;const suffix=listing?.market==='KOSPI'?'.KS':listing?.market==='KOSDAQ'?'.KQ':null;if(!suffix){failures.push({symbol:stock.code,reason:'IDENTITY_UNKNOWN'});return;}
      for(const verifiedSuffix of [suffix]){try{const v=await series(context,stock.code+verifiedSuffix);if(v.currency!=='KRW'||!(/KSC|KOE|KOSPI|KOSDAQ|KRX|SEOUL/i.test(v.exchange||'')))continue;const aligned=alignedWindow(v,benchmark,n);if(aligned){results.push({...aligned,symbol:stock.code,name:stock.name,v});break}else failures.push({symbol:stock.code,reason:v.bars.length<=n?'INSUFFICIENT_HISTORY':'DATE_MISMATCH'})}catch{failures.push({symbol:stock.code,reason:'SERIES_UNAVAILABLE'})}}
     });
     const quality=root.SectorInsights.sampleBreadth(results,stocks.length);
     if(quality.rankable){const change=results.reduce((a,x)=>a+x.change,0)/results.length;rows.push({symbol:String(t.no),name:t.name,change,relative:change-base,asof:Math.min(...results.map(x=>x.asof)),coverage:quality.observed+'/'+quality.expected+'개 구성종목 동일가중 표본',sample:results,quality})}
     else failures.push({symbol:String(t.no),reason:'SAMPLE_COVERAGE_INSUFFICIENT'});
    });
   }
   if(!active||version!==analysisVersion||keyFor(market)!==key)return;
   if(category==='industry')root.InvestWorkflow?.registerThemes(rows.map((r,i)=>({kind:'industry',proxy:market==='US'?'ETF':null,market,name:r.name,rank:i+1,themeReturn:r.change,relativeStrength:r.relative,themeReceivedAt:Date.now(),stocks:r.v?[{symbol:r.symbol,name:r.name,market}]:(r.sample||[]).map(x=>({symbol:x.symbol,name:x.name,market}))})));else root.InvestWorkflow?.registerThemes(market==='US'?themes.sort((a,b)=>b.relative-a.relative).map((t,i)=>({name:t.name,market:'US',rank:i+1,strength:null,themeReturn:t.change,relativeStrength:t.relative,themeReceivedAt:Date.now(),stocks:t.sample.map(r=>({symbol:r.symbol,name:r.name,market:'US'}))})):ranking().map((t,i)=>({name:t.name,market:'KR',rank:i+1,strength:t.sc,themeReturn:t.rate,themeReceivedAt:typeof THM_AT!=='undefined'?THM_AT:null,stocks:themeRows(t).map(r=>({symbol:r.code,name:r.name,market:'KR'}))})));
   analytics.set(key,{category,benchmarkSeries:benchmark,rows:rows.sort((a,b)=>b.relative-a.relative),benchmark:base,benchmarkSymbol,received:Date.now(),period,market,failures,themes:themes.sort((a,b)=>b.relative-a.relative),asof:benchmark.last});
  }catch(e){if(active&&version===analysisVersion&&keyFor()===key)analysisError='시계열 수신 또는 검증 실패 · 실제 데이터 연결 상태를 확인하세요.'}
  finally{if(active&&version===analysisVersion){analysisBusy=false;draw();if(keyFor(market)!==key)void loadAnalytics()}}
 }
 function analyticsView(){
  const key=keyFor(),data=analytics.get(key);
  if(market==='KR'&&category==='industry'){const titleBar=make('div',undefined,'stv2-industry-head'),refresh=button(industryBusy||analysisBusy?'갱신 중…':'국내 섹터 갱신',refreshCurrent);refresh.disabled=industryBusy||analysisBusy;titleBar.append(make('h3','국내 산업 구성종목 표본 분석'),refresh);list.append(titleBar)}
  if(analysisBusy)list.append(make('p',(analysisKey===key?'실제 일봉 데이터 분석 중…':'이전 요청 정리 후 선택 화면 자료 조회 중…')+' 다른 화면은 계속 이용할 수 있습니다.','stv2-status'));
  if(analysisError&&!data)list.append(make('p',analysisError,'stv2-status'));
  if(!data){if(!analysisBusy)list.append(button('실제 시계열 조회',()=>void loadAnalytics(true)));return}
  const n=PERIODS[period],label=market==='US'?'미국 11개 섹터 ETF 상대강도':(category==='industry'?'국내 산업 구성종목 표본 분석':'국내 상위 테마 구성종목 표본 분석');
  if(market==='US'&&category==='theme')renderUSThemes(data);
  const target=market==='US'&&category==='theme'?make('details',undefined,'stv2-etfs'):list;if(market==='US'&&category==='theme'){target.append(make('summary','참고: 11개 섹터 ETF 상대강도 펼치기'));list.append(target)}
  if(!(market==='KR'&&category==='industry'))target.append(make('h3',label));target.append(make('p','기간 '+n+'거래일 · 기준 '+data.benchmarkSymbol+' '+pct(data.benchmark)+' · 수신 '+new Date(data.received).toLocaleString('ko-KR')+' · 공통 관측일 '+new Date(data.asof).toLocaleDateString('ko-KR')+' · 관측 종가 가격수익률 (배당·분배금 제외, 실시간 아님)','stv2-muted'));
  const table=make('table',undefined,'stv2-table'),head=make('tr');['섹터/테마','기간 수익률','기준 대비','데이터 범위','관측일'].forEach(x=>head.append(make('th',x)));table.append(head);
  for(const row of data.rows){const tr=make('tr');tr.append((()=>{const cell=make('td');if(market==='US'&&category==='industry')cell.append(button(row.name+' ('+row.symbol+') · ETF 대리지표',()=>root.MYInvestStockSelection?.open(row.symbol,{name:row.name,industry:row.name,source:'industry',mode,relativeStrength:row.relative,themeReturn:row.change,themeReceivedAt:data.received,period})));else cell.textContent=row.name+' ('+row.symbol+')';return cell})(),make('td',pct(row.change)),make('td',pct(row.relative)),make('td',row.coverage),make('td',new Date(row.asof).toLocaleDateString('ko-KR')));table.append(tr)}
  target.append(table);if(category==='industry')renderInsights(data,target);
  if(market==='US')target.append(make('p','검증 수신 '+data.rows.length+'/'+US_SECTORS.length+'개 ETF','stv2-muted'));
  if(data.failures?.length){const excluded=[...new Map(data.failures.map(x=>[x.symbol,x])).values()],box=make('details',undefined,'stv2-status');box.append(make('summary','일부 종목 '+excluded.length+'개 제외 · 상세 보기'),make('p',excluded.map(x=>x.symbol+' ('+x.reason+')').join(', '),'stv2-muted'));list.append(box)}
  if(!data.rows.length)list.append(make('p','검증된 시계열 결과가 없습니다. 원천 연결을 확인하세요.','stv2-status'));
  target.append(make('p',market==='US'?'ETF 가격 기반 섹터 대리지표입니다. 개별 미국 테마·구성종목·실제 자금유입 순위가 아닙니다.':'네이버 상위 테마의 일부 구성종목만 사용한 동일가중 표본입니다. 전체 테마 수익률 또는 확정 스윙 순위가 아닙니다.','stv2-muted'));
  if(mode==='swing')list.append(make('p','스윙 관찰: 상대강도와 기간 수익률만 표시. 실적·기관수급·진입/손절 검증 전 매수 추천이 아닙니다.','stv2-muted'));
 }

 function openStock(stock,theme){const entry=analytics.get(keyFor())?.themes?.find(x=>x.name===theme);if(root.MYInvestStockSelection)root.MYInvestStockSelection.open(stock.symbol,{name:stock.name,theme,mode,source:'theme',themeReturn:entry?.change??null,relativeStrength:entry?.relative??null,rank:entry?analytics.get(keyFor()).themes.indexOf(entry)+1:null,themeReceivedAt:analytics.get(keyFor())?.received||null,period})}
 function renderUSThemes(data){
  list.append(make('h3','미국 일반종목 테마 · 검증 표본'),make('p','운용사 공개 구성자료의 미국 상장 일반종목 표본 · 종가 가격수익률 동일가중 · 검증된 구성종목 60% 미만은 순위 보류 · 전체 미국 시장 순위 아님','stv2-muted'));
  const cards=make('div',undefined,'stv2-grid stv2-us-themes');
  for(const [i,t] of (data.themes||[]).entries()){const card=button('',()=>usDetail(t));card.className='stv2-card';card.style.textAlign='left';const up=t.sample.filter(x=>x.change>0).length,down=t.sample.filter(x=>x.change<0).length;card.append(make('strong',(i+1)+'위 · '+t.name),make('p',PERIODS[period]+'일 표본 수익률 '+pct(t.change)+' · SPY 대비 '+pct(t.relative)),make('p','상승 '+up+' / 하락 '+down+' · 상승비율 '+(t.quality?.breadth==null?'미확인':t.quality.breadth.toFixed(1)+'%')+' · 확인 '+t.sample.length+'/'+t.instruments.length+'종목','stv2-muted'),make('p',t.sample.slice().sort((a,b)=>b.change-a.change).slice(0,3).map(x=>root.InstrumentNames?.label(x.symbol,x.name)||x.name+' ('+x.symbol+')').join(' · '),'stv2-muted'),make('p','구성 기준 '+t.asOf+(Date.now()-Date.parse(t.asOf)>7*86400000?' · 구성자료 7일 초과, 최신성 확인 필요':'')+' · 관측 '+new Date(t.asof).toLocaleDateString('ko-KR'),'stv2-muted'));cards.append(card)}
  list.append(cards);if(!data.themes?.length)list.append(make('p','검증된 미국 일반종목 테마 자료가 없습니다. 새로고침 후 연결 상태를 확인하세요.','stv2-status'));
  list.append(make('p','순위는 표본 충족률 60% 이상인 테마 간 비교에 한정됩니다. 구성목록 기준일과 공식 출처를 확인하세요. 시세 새로고침과 구성자료 갱신은 별개이며 ETF 가격은 테마 수익률로 사용하지 않습니다.','stv2-muted'));
 }
 function usDetail(t){list.replaceChildren();list.append(button('← 테마 순위로',draw),make('h3',t.name),make('p','구성 기준 '+t.asOf+' · 일반종목 '+t.sample.length+'/'+t.instruments.length+'개 표본 · 상승비율 '+(t.quality?.breadth==null?'미확인':t.quality.breadth.toFixed(1)+'%')+' · 공통 거래일 종가의 가격수익률 (배당 제외)','stv2-muted'));
  const link=make('a','공식 구성종목 출처');link.href=t.source;link.target='_blank';link.rel='noopener noreferrer';list.append(link);
  const table=make('table',undefined,'stv2-table stv2-us-members'),head=make('tr');['일반 종목','선택기간 수익률','SPY 대비','관측일','분석','원천 현재가','1일','5일','20일','60일','거래량','거래대금','구분','보유','1일 SPY 대비','5일 SPY 대비','20일 SPY 대비','60일 SPY 대비'].forEach(x=>head.append(make('th',x)));table.append(head);
  for(const [position,stock] of t.sample.slice().sort((a,b)=>b.change-a.change).entries()){const tr=make('tr'),td=make('td');td.append(button('종목분석',()=>openStock(stock,t.name)));tr.append((()=>{const td=make('td');td.append(button(root.InstrumentNames?.label(stock.symbol,stock.name)||stock.name+' ('+stock.symbol+')',()=>openStock(stock,t.name)));return td})(),make('td',pct(stock.change)),make('td',pct(stock.relative)),make('td',new Date(stock.asof).toLocaleDateString('ko-KR')),td,make('td',stock.currentPrice==null?'미확인':stock.currentPrice.toLocaleString('ko-KR')+' / '+new Date(stock.currentObservedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})),make('td',pct(stock.returns?.[1])),make('td',pct(stock.returns?.[5])),make('td',pct(stock.returns?.[20])),make('td',pct(stock.returns?.[60])),make('td',Number.isFinite(stock.volume)?stock.volume.toLocaleString('ko-KR'):'미확인'),make('td','미확인'),make('td',root.SectorInsights.leaderClass(stock)),make('td',root.InvestWorkflow?.holdings(ctxRef,{symbol:stock.symbol}).length?'보유':'미확인'),...[1,5,20,60].map(n=>make('td',pct(stock.relativeByPeriod?.[n]??null))));table.append(tr)}list.append(table);
 }

 function detail(t){
  const version=++detailVersion;list.replaceChildren();list.append(button('← 테마 순위로',()=>draw()),make('h3',t.name),make('p','네이버 국내 '+(category==='industry'?'산업':'테마')+' 시세 · 기간 수익률 Yahoo 일봉 / 코스피 공통 관측일 · 수신 '+(typeof THM_AT!=='undefined'&&THM_AT?new Date(THM_AT).toLocaleString('ko-KR'):'미확인'),'stv2-muted'));
  const rows=themeRows(t).slice().sort((a,b)=>(safeNumber(b.val)||0)-(safeNumber(a.val)||0)),table=make('table',undefined,'stv2-table stv2-kr-members'),head=make('tr');
  ['종목','현재가 / 관측','등락률','1일','5일','20일','60일','선택기간 코스피 대비','거래량','거래대금','구분','보유','1일 코스피 대비','5일 코스피 대비','20일 코스피 대비','60일 코스피 대비'].forEach(x=>head.append(make('th',x)));table.append(head);list.append(table);
  const fields=new Map();for(const [position,r] of rows.entries()){
   const tr=make('tr'),name=button(nameFor(r.code)?displayName(r.code):r.name+' ('+r.code+')',()=>root.MYInvestStockSelection?.open(r.code,{name:nameFor(r.code)||r.name||'',theme:category==='theme'?t.name:'',industry:category==='industry'?t.name:'',mode,period,source:category==='industry'?'industry':'theme',rank:(category==='industry'?industryRows.findIndex(x=>String(x.no)===String(t.no)):ranking().findIndex(x=>x===t))+1,strength:t.sc??null,themeReturn:t.rate,themeReceivedAt:typeof THM_AT!=='undefined'?THM_AT:null})),td=make('td');td.append(name);
   const returns=[1,5,20,60].map(()=>make('td','미확인')),relative=make('td','미확인'),volume=make('td','미확인'),relativeWindows=[1,5,20,60].map(()=>make('td','미확인'));tr.append(td,make('td',safeNumber(r.price)!==null&&r.observedAt?Number(r.price).toLocaleString('ko-KR')+' / '+r.observedAt:'미확인'),make('td',pct(r.rate)),...returns,relative,volume,make('td',safeNumber(r.val)===null?'미확인':Number(r.val).toLocaleString('ko-KR')),make('td',position===0?'거래대금 선두':'거래대금 후순위'),make('td',root.InvestWorkflow?.holdings(ctxRef,{symbol:r.code}).length?'보유':'미확인'),...relativeWindows);table.append(tr);fields.set(r.code,{returns,relative,volume,relativeWindows});
  }
  if(!rows.length){list.append(make('p','검증된 구성종목 데이터가 없습니다.'));return}
  const progress=make('p','구성종목 기간 수익률 조회 중…','stv2-muted');list.append(progress);const context=ctxRef;
  void (async()=>{let done=0,failed=0;try{if(typeof loadExternalMaster==='function')await loadExternalMaster();const benchmark=await series(context,'^KS11');await poolLimited(rows,3,async r=>{if(!active||version!==detailVersion)return;try{const master=typeof EXT_MASTER!=='undefined'?EXT_MASTER?.byCode?.get(r.code):null;if(!master||!['KOSPI','KOSDAQ'].includes(master.market))throw Error('IDENTITY_UNAVAILABLE');const value=await series(context,r.code+(master.market==='KOSDAQ'?'.KQ':'.KS'));if(!active||version!==detailVersion)return;const target=fields.get(r.code);[1,5,20,60].forEach((days,i)=>{const aligned=alignedWindow(value,benchmark,days);target.returns[i].textContent=pct(aligned?.change??null);target.relativeWindows[i].textContent=pct(aligned?.relative??null)});const aligned=alignedWindow(value,benchmark,PERIODS[period]);target.relative.textContent=pct(aligned?.relative??null);target.volume.textContent=Number.isFinite(aligned?.volume)?aligned.volume.toLocaleString('ko-KR'):'미확인';done++}catch{failed++}})}catch{failed=rows.length}if(active&&version===detailVersion)progress.textContent='기간 자료 확인 '+done+'/'+rows.length+'종목 · 미확인 '+failed+' · 표본 순위이며 전체 시장 주도 확정 아님';})();
 }
 function watchDraw(){watchArea.replaceChildren();const h=make('h3','내 보유·관심종목 연계'),form=make('form'),input=make('input'),add=button('관심종목 추가',()=>{});input.placeholder='국내 6자리 코드 / 미국 티커';input.setAttribute('aria-label','관심종목 코드');add.type='submit';form.append(input,add);form.addEventListener('submit',e=>{e.preventDefault();const id=input.value.trim().toUpperCase();if(!valid(id)){notice.textContent='국내 6자리 코드 또는 영문 티커를 입력하세요.';return}if(!watch.includes(id))watch.push(id);watch=watch.slice(0,100);try{localStorage.setItem(KEY,JSON.stringify(watch))}catch{}input.value='';draw()});watchArea.append(h,form);
 const owned=holdings(),all=[...new Set([...owned,...watch])];if(!all.length){watchArea.append(make('p','연결된 보유종목 또는 직접 등록한 관심종목이 없습니다.','stv2-muted'));return}
 const tbl=make('table',undefined,'stv2-table'),hdr=make('tr');['종목명 (코드)','구분','국내 주도 테마','관리'].forEach(x=>hdr.append(make('th',x)));tbl.append(hdr);all.forEach(code=>{const related=ranking().filter(t=>themeRows(t).some(r=>r.code===code)).map(t=>t.name);const tr=make('tr');tr.append(make('td',displayName(code)),make('td',owned.has(code)?'보유'+(watch.includes(code)?'·관심':''):'관심'),make('td',related.length?related.join(', '):'현재 수신된 상위 테마에서 미확인'));const td=make('td');td.append(button('AI 분석',()=>{if(window.MYInvestStockSelection)window.MYInvestStockSelection.open(code,{mode,name:nameFor(code)||''})}));if(watch.includes(code))td.append(button('삭제',()=>{watch=watch.filter(x=>x!==code);try{localStorage.setItem(KEY,JSON.stringify(watch))}catch{}draw()}));tr.append(td);tbl.append(tr)});watchArea.append(tbl,make('p','보유 여부는 현재 화면의 기존 계좌 데이터에 한정됩니다. 관심종목은 이 브라우저에만 저장되며, 종목명·상장 여부를 추정하지 않습니다.','stv2-muted'))}
 function renderMixed(){
  const container=make('div',undefined,'stv2-mixed'),kr=make('section'),us=make('section');
  const currentPeriod=PERIODS[period]||1;
  kr.append(make('h3','🇰🇷 한국 · '+(category==='industry'?'산업':'테마')));
  const krRows=category==='industry'?industryRows:ranking();
  const krCount=category==='industry'?industryRows.length:ranking().length;
  kr.append(make('p','수신 확인 '+krCount+'개 · '+(mode==='day'?'당일 등락/강도':'선택 '+currentPeriod+'거래일 분석은 국가별 상세 화면에서 확인'),'stv2-muted'));
  if(!krRows.length)kr.append(make('p','한국 자료 미수신 · 국내 화면에서 갱신 가능','stv2-status'));
  for(const item of krRows.slice(0,8)){
   const name=item.name,rate=item.rate;
   kr.append(button(name+' · '+pct(rate),()=>{chooseMarket('KR');if(category==='industry')void industryDetail(item);else detail(item)}));
  }
  us.append(make('h3','🇺🇸 미국 · '+(category==='industry'?'섹터 ETF 대리지표':'일반종목 테마 표본')));
  const usData=analytics.get(keyFor('US'));
  if(!usData)us.append(make('p',analysisBusy?'미국 시계열 확인 중…':'미국 실제 시계열 미수신 · 조회 대기','stv2-status'));
  else{
   us.append(make('p','SPY 대비 '+currentPeriod+'거래일 · 기준일 '+new Date(usData.asof).toLocaleDateString('ko-KR')+' · 종가 기준','stv2-muted'));
   const rows=category==='theme'&&usData.themes?.length?usData.themes:usData.rows;
   if(!rows?.length)us.append(make('p','검증된 미국 표본 없음 · 수신 누락 또는 검증 실패','stv2-status'));
   for(const item of (rows||[]).slice(0,8))us.append(button(item.name+' · '+pct(item.change)+' / SPY 대비 '+pct(item.relative),()=>{chooseMarket('US');if(category==='theme'&&item.instruments)usDetail(item);else if(category==='industry'&&item.symbol)root.MYInvestStockSelection?.open(item.symbol,{name:item.name,industry:item.name,source:'industry',mode,relativeStrength:item.relative,themeReturn:item.change,themeReceivedAt:usData?.received||null,period})}));
  }
  container.append(kr,us);list.append(make('p','혼합 비교는 국가별 독립 자료를 병렬 표시하며 한국·미국을 합산한 단일 시장 순위가 아닙니다. 관측 거래일과 기준지수가 다릅니다.','stv2-muted'),container);
 }
 function refreshCurrent(){
  if(loading||industryBusy||analysisBusy)return;
  void (async()=>{if((market==='KR'||market==='MIX')&&category==='theme')await reload();
    if((market==='KR'||market==='MIX')&&category==='industry')await loadIndustries(true);
    analytics.clear();await loadAnalytics(true);
  })();
 }
 function draw(){if(!active)return;detailVersion++;summary.replaceChildren();list.replaceChildren();notice.textContent='';
  const header=make('div',undefined,'stv2-heading'),h=make('h2','섹터·테마 분석 V2');
  header.append(h);
  if(!(market==='KR'&&category==='industry')){
   const refresh=button(loading||industryBusy||analysisBusy?'갱신 중…':'새로고침',refreshCurrent);
   refresh.disabled=loading||industryBusy||analysisBusy;
   refresh.setAttribute('aria-label','현재 시장 섹터·테마 새로고침');
   header.append(refresh);
  }
  summary.append(header);if(loadError)notice.textContent=loadError;
  const controls=make('div',undefined,'stv2-toolbar');
  const scope=button(category==='theme'?'분석: 테마 → 산업':'분석: 산업 → 테마',()=>{category=category==='theme'?'industry':'theme';saveDisplay();draw();void loadAnalytics()});
  scope.setAttribute('aria-label','분석 범위 전환: 현재 '+(category==='theme'?'테마':'산업'));controls.append(scope);
  tabs(controls,[['KR','한국'],['US','미국'],['MIX','한국+미국']],()=>market,chooseMarket);
  tabs(controls,[['day','단타'],['swing','스윙']],()=>mode,v=>{
   if(mode!==v){mode=v;period=v==='swing'?'5d':'1d'}
   saveDisplay();void loadAnalytics();
  });
  summary.append(controls);
  if(mode==='swing'){
   const periods=make('div',undefined,'stv2-toolbar');
   periods.append(make('span','스윙 분석기간 ('+(PERIODS[period]||5)+'거래일):','stv2-period-label'));
   tabs(periods,[['5d','5일'],['20d','20일'],['60d','60일']],()=>period,v=>{period=v;saveDisplay();void loadAnalytics()});
   summary.append(periods);
  }
  const observed=market==='US'?analytics.get(keyFor())?.received:market==='MIX'?analytics.get(keyFor('US'))?.received:(category==='industry'?industryReceived:typeof THM_AT!=='undefined'?THM_AT:null),stamp=observed?new Date(observed).toLocaleString('ko-KR'):'미수신';
  summary.append(make('p','수신 기준: '+stamp+' · '+(market==='KR'?'국내 네이버 원천':market==='US'?'미국 운용사 공개 구성자료 / Yahoo 종가':'한국 네이버 / 미국 시계열 분리 수신')+' · '+(mode==='day'?'단타: 1일 관찰':'스윙: '+(PERIODS[period]||5)+'거래일 종가 분석'),'stv2-muted'));
  if(market==='MIX'){renderMixed();return}
  if(market==='KR'&&period==='1d'&&mode==='day'){if(category==='industry')renderIndustryRanks();else{renderRanks();dashboard()}}
  else {analyticsView();if(market==='KR'&&period==='1d'){list.append(make('p','참고: 아래는 당일 테마 목록이며 스윙 확정 순위가 아닙니다.','stv2-muted'));renderRanks()}}
 }
 async function loadIndustries(force=false){if(!active||industryBusy)return;if(industryRows.length&&!force)return;const cfg=root.MYINVEST_TRANSPORT_CONFIG||{};if(ctxRef.development()&&cfg.publicIndustries!==true){industryError='국내 산업 API 중계 미반영 · 기존 테마 기능은 유지됩니다.';if(active)draw();return}industryBusy=true;industryError='';try{const result=await root.IndustryData.read(ctxRef,null,force);if(!active)return;if(!result.rows.length)throw Error('INDUSTRY_EMPTY');industryRows=result.rows.sort((a,b)=>(b.rate??-Infinity)-(a.rate??-Infinity));industryReceived=result.receivedAt}catch{if(active)industryError='국내 산업 자료 미수신 · 오류 식별 정보와 중계 지원 여부 확인'}finally{industryBusy=false;if(active&&category==='industry')draw()}}
 function renderIndustryRanks(){const head=make('div',undefined,'stv2-industry-head'),refresh=button(industryBusy?'갱신 중…':'국내 섹터 갱신',()=>{void loadIndustries(true)});refresh.disabled=industryBusy;head.append(make('h3','국내 산업 · 네이버 업종 분류'),refresh);list.append(head,make('p','공식 업종별 당일 등락과 상승비율 · 관측시각 미확인 · 수신 '+(industryReceived?new Date(industryReceived).toLocaleString('ko-KR'):'미수신'),'stv2-muted'));if(industryError)list.append(make('p',industryError,'stv2-status'));if(industryBusy)list.append(make('p','산업 자료 조회 중…'));if(!industryRows.length){if(!industryBusy&&!industryError)void loadIndustries();return}const table=make('table',undefined,'stv2-table stv2-industries'),header=make('tr');['산업','등락률','상승/하락','상승비율','구성종목'].forEach(x=>header.append(make('th',x)));table.append(header);for(const group of industryRows){const tr=make('tr'),cell=make('td');cell.append(button(group.name,()=>void industryDetail(group)));tr.append(cell,make('td',pct(group.rate)),make('td',(group.up??'미확인')+' / '+(group.down??'미확인')),make('td',pct(group.breadth)),make('td',String(group.count??'미확인')));table.append(tr)}list.append(table)}
 async function industryDetail(group){const version=++detailVersion;list.replaceChildren(make('p','산업 구성종목 조회 중…'));try{const result=await root.IndustryData.read(ctxRef,group.no);if(!active||version!==detailVersion||category!=='industry')return;detail({...group,rows:result.rows});list.append(make('p','구성종목 '+result.rows.length+'/'+result.total+' · 거래대금: 원천 Raw 원 단위 · 기간 수익률은 검증된 상장 종목만 사용','stv2-muted'));root.InvestWorkflow?.registerThemes([{kind:'industry',market:'KR',name:group.name,themeReturn:group.rate,themeReceivedAt:result.receivedAt,stocks:result.rows.map(r=>({symbol:r.code,name:r.name,market:'KR'}))}])}catch{if(active&&version===detailVersion)list.replaceChildren(button('← 산업 목록',draw),make('p','산업 구성종목 미수신 · 오류 식별 정보 확인'))}}
 function insightSeries(row){return row.v||root.SectorInsights.basket((row.sample||[]).map(x=>x.v).filter(Boolean))}
 function renderInsights(data,target){const box=make('details',undefined,'stv2-insights');box.append(make('summary','산업 모멘텀·로테이션 · 실제 종가 표본'));const table=make('table',undefined,'stv2-table'),head=make('tr');['산업/대리지표','1일','5일','20일','60일','5일 기준 대비','20일 기준 대비','거래량 변화','표본 상승비율','표본 확인','로테이션','1일 기준 대비','60일 기준 대비'].forEach(x=>head.append(make('th',x)));table.append(head);for(const row of data.rows){const value=insightSeries(row),m=row.v?root.SectorInsights.metrics(value,data.benchmarkSeries):root.SectorInsights.summarize((row.sample||[]).map(x=>x.v).filter(Boolean),data.benchmarkSeries),tr=make('tr');tr.append(make('td',row.name),...[1,5,20,60].map(n=>make('td',pct(m.windows[n]?.change??null))),make('td',pct(m.windows[5]?.relative??null)),make('td',pct(m.windows[20]?.relative??null)),make('td',pct(m.volumeChange)),make('td',row.v?'ETF 단일':row.quality?.breadth==null?'미확인':row.quality.breadth.toFixed(1)+'%'),make('td',row.v?'ETF 가격':row.quality?row.quality.observed+'/'+row.quality.expected:'미확인'),make('td',m.rotation),make('td',pct(m.windows[1]?.relative??null)),make('td',pct(m.windows[60]?.relative??null)));table.append(tr)}box.append(table,make('p','로테이션: 5·20일 초과수익률의 변화 관찰 규칙이며 확정 전환 신호가 아닙니다. 거래량은 직전 20봉 평균 대비. 한국 상승비율은 검증된 고정 표본에 한정되고 미국은 섹터 ETF 대리지표이므로 실제 자금유입이 아닙니다.','stv2-muted'));const other=[...analytics.values()].filter(x=>x.category==='industry'&&x.market!==data.market).at(-1);if(other){const correlation=make('table',undefined,'stv2-table'),head=make('tr');['현재 산업','다른 국가 산업','일별 수익률 상관','관측 수'].forEach(x=>head.append(make('th',x)));correlation.append(head);let count=0;for(const row of data.rows.slice(0,6))for(const peer of other.rows.slice(0,6)){const result=root.SectorInsights.correlation(insightSeries(row),insightSeries(peer));if(!result)continue;const tr=make('tr');tr.append(make('td',row.name),make('td',peer.name),make('td',result.value.toFixed(3)),make('td',String(result.count)));correlation.append(tr);count++}box.append(make('h4','한국·미국 수신 산업의 통계적 동행'),correlation,make('p',count?'같은 UTC 거래일의 실제 종가 수익률, 최대 60쌍/최소 20쌍. 시차·통화·표본 차이로 인과관계나 산업 분류 일치로 해석하지 않습니다.':'공통 관측일 또는 변동 표본 부족','stv2-muted'))}else box.append(make('p','다른 국가의 산업 화면도 조회하면 공통 거래일 상관관계를 계산합니다.','stv2-muted'));target.append(box)}
 function renderRanks(){const items=ranking();root.InvestWorkflow?.registerThemes(items.map((t,i)=>({name:t.name,market:'KR',rank:i+1,strength:t.sc,themeReturn:t.rate,themeReceivedAt:typeof THM_AT!=='undefined'?THM_AT:null,stocks:themeRows(t).map(r=>({symbol:r.code,name:r.name,market:'KR'}))})));const cards=make('div',undefined,'stv2-grid stv2-ranks');if(!items.length){list.append(make('p','검증된 국내 테마 데이터 미수신 · 기존 테마 갱신 버튼으로 조회하세요.','stv2-status'));return}
 items.forEach((t,i)=>{const card=button('',()=>detail(t));card.className='stv2-card';card.style.textAlign='left';card.append(make('strong',(i+1)+'위 · '+t.name),make('p','당일 테마 강도 '+Math.round(t.sc)+'/100 · 등락률 '+pct(t.rate)),make('p','구성종목 '+themeRows(t).length+'개 · '+(safeNumber(t.val)===null?'거래대금 미확인':'거래대금 집계 가능'),'stv2-muted'));const m=metrics(t);card.append(make('p','상승 '+m.up+' / 하락 '+m.down+' / 보합 '+m.flat+' · 상승비율 '+(m.breadth===null?'미확인':m.breadth.toFixed(1)+'%'),'stv2-muted'));const owned=holdings(),matches=themeRows(t).filter(r=>owned.has(r.code)||watch.includes(r.code));if(matches.length)card.append(make('p','내 종목 연계: '+matches.map(r=>displayName(r.code)).join(', '),'stv2-muted'));cards.append(card)});list.append(cards,make('p','순위는 기존 수신 후보 내 상대점수이며 전체 시장의 확정 순위가 아닙니다. 순매수액·기관/외국인 수급·뉴스는 미반영입니다.','stv2-muted'))}
 function mount(container,ctx){active=true;ctxRef=ctx;manualMarket=false;market=defaultMarketAt();period='1d';mode='day';category='theme';restoreDisplay();unsubscribe=ctx.subscribe?.(()=>{if(active)draw()});view=make('section',undefined,'stv2');const style=make('style');style.textContent=css;view.append(style);summary=make('div');list=make('div');notice=make('p',undefined,'stv2-muted');watchArea=make('div');view.append(summary,notice,list);legacy.mount(container,ctx);const content=container.querySelector(':scope > .page-content');if(content){legacyHolder=make('div');legacyHolder.hidden=true;content.replaceWith(legacyHolder);legacyHolder.append(content)}container.prepend(view);draw();if((market==='KR'||market==='MIX')&&category==='theme'&&!data().length&&!loading&&ctx.publicConnected?.())void reload();void loadAnalytics();const checkMarket=()=>{if(!active)return;const next=defaultMarketAt();if(!manualMarket&&next!==market){market=next;draw();if(market==='KR'&&!data().length&&ctxRef?.publicConnected?.())void reload();void loadAnalytics()}marketTimer=setTimeout(checkMarket,60000-Date.now()%60000+5)};marketTimer=setTimeout(checkMarket,60000-Date.now()%60000+5)}
 return {mount,refresh:async(ctx,force)=>{await legacy.refresh(ctx,force);draw();if(force)analytics.clear();void loadAnalytics(force)},unmount:()=>{active=false;if(marketTimer!==null){clearTimeout(marketTimer);marketTimer=null}manualMarket=false;analysisVersion++;detailVersion++;analysisBusy=false;unsubscribe?.();unsubscribe=null;ctxRef=null;view?.remove();legacy.unmount();legacyHolder?.remove();legacyHolder=null},getStatus:()=>({status:active?'ready':'unmounted',market,period,mode,category})};
}
DashboardPages.register('sectors',create);
})(window);
