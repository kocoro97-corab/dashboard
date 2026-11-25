/* Public selection/analysis state shared by stock and strategy views.
   Account rows are read on demand and never stored here or placed in URLs. */
(function(root){
'use strict';
const SELECT='myinvest_stock_selection_v2',STRATEGY='myinvest_strategy_selection_v2',TTL=3600000;
const valid=s=>typeof s==='string'&&/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(s),text=v=>typeof v==='string'?v.replace(/[\x00-\x1f]/g,'').slice(0,120):'',finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
let analyzer=null,epoch=0;const analyses=new Map(),pending=new Map();let themeGroups=[];
const event=name=>root.dispatchEvent(new Event(name));
function clean(input){if(!input||!valid(input.symbol))return null;return {symbol:input.symbol,name:text(input.name),market:/^\d{6}$/.test(input.symbol)?'KR':'US',theme:text(input.theme),industry:text(input.industry),source:['theme','holding','search','analysis','strategy','industry','news'].includes(input.source)?input.source:'search',mode:input.mode==='day'?'day':'swing',period:input.mode==='day'?'1d':(['5d','20d','60d'].includes(input.period)?input.period:'20d'),rank:finite(input.rank),strength:finite(input.strength),themeReturn:finite(input.themeReturn),relativeStrength:finite(input.relativeStrength),themeReceivedAt:finite(input.themeReceivedAt),observedAt:finite(input.observedAt),dataScope:['kr_theme_daily','kr_industry_sample','us_sector_etf','us_theme_sample'].includes(input.dataScope)?input.dataScope:null,benchmark:['^KS11','SPY'].includes(input.benchmark)?input.benchmark:null,coveragePct:finite(input.coveragePct)!==null&&input.coveragePct>=0&&input.coveragePct<=100?input.coveragePct:null,stockReturn:finite(input.stockReturn),stockRelativeStrength:finite(input.stockRelativeStrength),instrumentId:/^[A-Z]{2}:[A-Z0-9]{3,8}:[A-Z0-9._-]{1,20}$/.test(input.instrumentId||'')?input.instrumentId:null,at:Date.now()}}
function current(){for(const key of [SELECT,STRATEGY])try{const x=JSON.parse(sessionStorage.getItem(key)||'null');if(x&&valid(x.symbol)&&Number.isFinite(x.at)&&x.at<=Date.now()+60000&&Date.now()-x.at<TTL)return {...clean(x),at:x.at}}catch{}return null}
function select(symbol,options={}){const value=clean({...options,symbol:String(symbol||'').trim().toUpperCase()});if(!value)return null;try{const json=JSON.stringify(value);sessionStorage.setItem(SELECT,json);sessionStorage.setItem(STRATEGY,json)}catch{return null}event('myinvest:workflow-selection');return value}
function clear(){epoch++;analyses.clear();pending.clear();themeGroups=[];for(const k of [SELECT,STRATEGY])try{sessionStorage.removeItem(k)}catch{}}
function publish(analysis){if(!analysis||!valid(analysis.symbol)||!Array.isArray(analysis.bars)||analysis.bars.length<21)return false;analyses.set(analysis.symbol,{...analysis,receivedAt:analysis.receivedAt||Date.now()});while(analyses.size>64)analyses.delete(analyses.keys().next().value);return true}
async function ensure(selection,force=false){if(!selection||!valid(selection.symbol)||!analyzer)throw Error('ANALYSIS_UNAVAILABLE');const cached=analyses.get(selection.symbol);if(!force&&cached&&Date.now()-cached.receivedAt<300000)return cached;if(pending.has(selection.symbol))return pending.get(selection.symbol);const version=epoch,diagnosticRoute=root.location?.hash;const job=analyzer(selection.symbol).then(data=>{if(version!==epoch)throw Error('SESSION_CHANGED');publish(data);return data}).catch(error=>{if(version===epoch&&diagnosticRoute===root.location?.hash&&!['SESSION_CHANGED','READ_CANCELLED'].includes(error?.code||error?.message))root.DevelopmentDiagnostics?.note({source:'analysis',code:error?.code||error?.message});throw error}).finally(()=>{if(pending.get(selection.symbol)===job)pending.delete(selection.symbol)});pending.set(selection.symbol,job);return job}
function compatible(h,exchange){if(h.market==='domestic')return h.currency==='KRW';const id=String(h.instrumentId||''),e={NMS:'XNAS',NGM:'XNAS',NCM:'XNAS',NYQ:'XNYS',PCX:'ARCX',ASE:'XASE',BTS:'BATS'}[exchange];return h.currency==='USD'&&!!e&&id.split(':')[1]===e}
function holdings(ctx,selection,analysis){let snap;try{snap=ctx?.snapshot()}catch{return []}if(!Array.isArray(snap?.details)||!Array.isArray(snap?.result?.rows))return [];if(snap.details.length!==snap.result.rows.length)return [];return snap.details.filter((h,i)=>{const a=snap.result.rows[i];return valid(h?.code)&&!h.draft&&a?.identity&&!a.issues?.includes('IDENTITY_UNKNOWN')&&Number.isFinite(h.quantity)&&h.quantity>0&&Number.isFinite(h.avgPrice)&&h.avgPrice>0&&(!selection||h.code===selection.symbol)&&(!analysis||compatible(h,analysis.exchange))})}
function registerThemes(groups){const incoming=Array.isArray(groups)?groups:[],markets=new Set(incoming.map(g=>g.market+':'+(g.kind||'theme')));themeGroups=[...themeGroups.filter(g=>!markets.has(g.market+':'+(g.kind||'theme'))),...incoming].filter(g=>g&&typeof g.name==='string'&&Array.isArray(g.stocks)).slice(0,80).map(g=>({...g,stocks:g.stocks.filter(s=>valid(s.symbol)).slice(0,60)}));event('myinvest:workflow-themes')}
async function search(query){await root.InstrumentNames?.load();if(typeof loadExternalMaster==='function')try{await loadExternalMaster()}catch{}const q=String(query||'').trim().toLowerCase(),result=[];if(!q)return result;if(typeof EXT_MASTER!=='undefined'&&EXT_MASTER?.byCode)for(const r of EXT_MASTER.byCode.values())if(r.code.includes(q)||r.name.toLowerCase().includes(q))result.push({symbol:r.code,name:r.name,market:'KR',exchange:r.market,type:r.type==='ETF'?'ETF':'EQUITY'});for(const r of root.InstrumentNames?.search(query,20)||[])result.push({...r,name:r.nameKo||r.nameEn,market:'US'});return result.slice(0,25)}
function judge(analysis,selection,ctx){const favorable=[],unfavorable=[],changes=[];if(!analysis||!analysis.exchange||analysis.bars.length<60||!Number.isFinite(analysis.observedAt)||Date.now()-analysis.observedAt>4*86400000)return {label:'판단 불가',favorable,unfavorable:['유효한 최근 일봉 60개와 기준시각 확인 필요'],changes:['유효 시계열 수신 후 재분석'],basis:'자료 부족 또는 오래된 관측'};const m=analysis.metrics,held=holdings(ctx,selection,analysis),benchmark=selection.market==='KR'?'^KS11':'^GSPC',market=typeof Q!=='undefined'?Q[benchmark]:null;const marketRate=market&&Number.isFinite(market.observedAt)&&market.observedAt>0&&Date.now()-market.observedAt<86400000&&market.observedAt<=Date.now()+300000&&Number.isFinite(market.p)&&Number.isFinite(market.prev)&&market.prev>0?(market.p/market.prev-1)*100:null;
 if(m.last>m.ma20)favorable.push('종가가 MA20 위');else unfavorable.push('종가가 MA20 아래');if(m.ma5>m.ma20)favorable.push('MA5가 MA20 위');else unfavorable.push('단기 추세 약세');if(m.rsi>=70)unfavorable.push('RSI 과열');if(m.volumeRatio>=1.2)favorable.push('직전 20봉 평균 대비 거래량 증가');if(marketRate===null)unfavorable.push('시장 방향 미확인');if(selection.themeReturn===null)unfavorable.push('테마 적합성 미확인');changes.push('MA20 이탈 또는 직전 20봉 저점 이탈 시 재평가','돌파 후 종가 유지와 거래량 증가 확인');
 let label=held.length?'보유 관리':m.rsi>=75||m.last<m.ma20&&m.ma5<m.ma20?'위험 회피':m.last>m.ma20&&m.ma20>m.ma60&&m.rsi<70&&m.volumeRatio>=1.2&&marketRate>0&&selection.themeReturn>0?'스윙 기술적 관찰후보':'관찰';if(selection.mode==='day')label='판단 불가';return {label,favorable,unfavorable:selection.mode==='day'?['분봉·호가·실시간 체결 미수신으로 단타 진입 판단 불가',...unfavorable]:unfavorable,changes,basis:'일봉 기술 조건의 규칙 기반 분류 · AI 확률/주문 신호 아님',marketRate,holdingCount:held.length}}
// P3: public-only path evidence; no quote guessing, account persistence or order authority.
function opportunity(selection,analysis,ctx,now=Date.now()){
 const fallback={track:'unverified',status:'insufficient',label:'전략 판단 보류',basis:'선택 종목 및 원천 관측자료 확인 필요',checks:[],warnings:['검증된 시계열이나 산업·테마 맥락을 확인하지 못했습니다.']};
 if(!selection||!valid(selection.symbol))return fallback;
 const held=holdings(ctx,selection,analysis).length>0;
 const track=held?'holding':'candidate_unconfirmed';
 const kind=selection.dataScope,group=selection.industry||selection.theme;
 const scopeLabels={kr_theme_daily:'국내 당일 테마 후보',kr_industry_sample:'국내 산업 구성종목 표본',us_sector_etf:'미국 섹터 ETF 대리지표',us_theme_sample:'미국 일반종목 테마 표본'};
 const correctBenchmark=selection.market==='US'?'SPY':'^KS11';
 const scoped=!!scopeLabels[kind]&&!!group&&selection.benchmark===correctBenchmark;
 const requiresCoverage=kind==='us_theme_sample'||kind==='kr_industry_sample';
 const coverageOk=!requiresCoverage||(Number.isFinite(selection.coveragePct)&&selection.coveragePct>=60);
 const timeOk=Number.isFinite(selection.observedAt)&&selection.observedAt>0&&selection.observedAt<=now+300000&&now-selection.observedAt<=4*86400000;
 const barsOk=analysis?.symbol===selection.symbol&&!!analysis.exchange&&Array.isArray(analysis.bars)&&analysis.bars.length>=60&&Number.isFinite(analysis.observedAt)&&analysis.observedAt>0&&analysis.observedAt<=now+300000&&now-analysis.observedAt<=4*86400000;
 const validRates=Number.isFinite(selection.relativeStrength)&&Number.isFinite(selection.stockRelativeStrength);
 const positiveStrength=validRates&&selection.relativeStrength>0&&selection.stockRelativeStrength>0;
 const checks=[];
 if(scoped)checks.push((scopeLabels[kind]||'종목')+' · '+group+' · '+correctBenchmark+' 대비');else checks.push('산업·테마 분류 또는 비교기준 미검증');
 if(requiresCoverage)checks.push('검증 표본 충족률 '+(Number.isFinite(selection.coveragePct)?selection.coveragePct.toFixed(1)+'%':'미확인'));
 if(validRates)checks.push('그룹 상대강도 '+selection.relativeStrength.toFixed(2)+'%p · 종목 상대강도 '+selection.stockRelativeStrength.toFixed(2)+'%p');
 const warnings=[];
 if(!scoped)warnings.push('검증된 산업·테마와 시장 대비 기준지수가 필요합니다.');
 if(!coverageOk)warnings.push('분석 표본이 60% 미만이거나 충족률이 미확인입니다.');
 if(!timeOk)warnings.push('산업·테마 원천 관측일이 없거나 오래됐습니다. 수신 시각을 종가 시각으로 대체하지 않습니다.');
 if(!barsOk)warnings.push('식별자·거래소·최근 60개 일봉의 확인이 필요합니다.');
 if(!validRates)warnings.push('그룹 및 해당 종목의 상대강도를 모두 확인하지 못했습니다.');
 if(kind==='us_sector_etf')warnings.push('섹터 ETF 가격은 실제 산업 구성종목의 수익률이나 자금유입이 아닙니다.');
 if(kind==='kr_theme_daily')warnings.push('국내 당일 테마 점수는 스윙 상대강도나 산업 전체 순위가 아닙니다.');
 if(selection.mode==='day')warnings.push('분봉·호가·체결 자료가 없어 단타 진입/손절 신호를 생성하지 않습니다.');
 if(!held)warnings.push('검증된 보유행이 없거나 계좌가 미조회일 수 있으며 실제 미보유로 단정하지 않습니다.');
 const qualified=scoped&&['us_theme_sample','kr_industry_sample'].includes(kind)&&coverageOk&&timeOk&&barsOk&&positiveStrength&&selection.mode==='swing';
 const status=held?'holding':qualified?'qualified_watch':selection.mode==='day'?'intraday_unverified':'insufficient';
 const label=held?'기존 보유종목 관리':qualified?'스윙 상대강세 관심후보':selection.mode==='day'?'단타 관찰 · 진입 판단 보류':'스윙 검증 보류';
 return {track,status,label,basis:'주도 산업·테마 → 종목 상대강도 → 기술적 일봉 검증의 관찰 경로 · 매수 권유/주문 신호 아님',checks,warnings};
}
function scenarios(analysis,selection){if(!analysis||!analysis.exchange||analysis.bars.length<60||selection.mode==='day'||!Number.isFinite(analysis.observedAt)||Date.now()-analysis.observedAt>4*86400000)return [];const m=analysis.metrics;if(![m.high20,m.low20,m.ma20,m.last].every(x=>Number.isFinite(x)&&x>0))return [];return [['돌파 관찰',m.high20,m.low20,'직전 20봉 고점 돌파 뒤 종가 유지·거래량 확인'],['눌림목 관찰',m.ma20,m.low20,'MA20 부근 지지와 단기 추세 회복 확인']].filter(([,entry,stop])=>stop<entry).map(([name,entry,stop,condition])=>({name,entry,stop,target1:entry+(entry-stop),target2:entry+2*(entry-stop),condition,invalid:'직전 20봉 저점 이탈 또는 시장·테마 약화 시 무효',basis:'진입: 관측 고점/MA20 · 손절: 관측 20봉 저점 · 목표: 손절폭의 1R/2R 조건부 계산, 예측가격 아님'}))}
const el=(tag,value,cls)=>{const e=document.createElement(tag);if(value!=null)e.textContent=value;if(cls)e.className=cls;return e};
function selector({ctx,onSelect,searchId='workflowStockSearch'}){const element=el('section',null,'workflow-selector'),tabs=el('div',null,'sva-tabs'),body=el('div'),input=el('input'),results=el('div',null,'dense-search-results');let tab='search',alive=true,seq=0,themeLoading=false,themesTried=false;input.id=searchId;input.placeholder='종목명·회사명·코드·티커';input.setAttribute('aria-label','국내 6자리 코드 또는 미국 티커');input.maxLength=100;
 function pick(stock,options={}){const s=select(stock.symbol,{...options,...stock,name:stock.name||stock.nameKo||stock.nameEn,mode:current()?.mode||'swing',period:options.period||current()?.period});if(s){input.value=s.symbol;results.replaceChildren();onSelect(s)}}
 function choices(matches){results.replaceChildren();for(const r of matches){const b=el('button');b.type='button';b.append(root.InstrumentNames?.lookup(r.symbol)?root.InstrumentNames.node(r.symbol,r.name):document.createTextNode(r.name+' ('+r.symbol+')'));b.append(el('small',' · '+(r.market||'US')+' / '+(r.exchange||'거래소 미확인')+(r.type==='ETF'?' / ETF':'')));b.onclick=()=>pick(r,{source:'search'});results.append(b)}}
 async function lookup(){const version=++seq,value=input.value;const found=await search(value);if(alive&&version===seq&&input.value===value)choices(found.slice(0,12));return found}
 input.addEventListener('input',()=>{void lookup()});const form=el('form',null,'sva-form'),submit=el('button','종목 분석');submit.type='submit';form.append(input,submit);form.onsubmit=async e=>{e.preventDefault();const value=input.value.trim(),found=await lookup();if(!alive||input.value.trim()!==value)return;const owned=holdings(ctx).find(h=>h.code===value.toUpperCase()),exact=found.find(r=>r.symbol===value.toUpperCase())||(owned?{symbol:owned.code,name:owned.name,instrumentId:owned.instrumentId}:null)||found.filter(r=>[r.name,r.nameKo,r.nameEn].some(n=>String(n||'').toLowerCase()===value.toLowerCase())).filter((r,i,list)=>list.length===1)[0];if(exact){pick(exact,{source:'search'});return}if(found.length===1){pick(found[0],{source:'search'});return}if(found.length>1){results.prepend(el('p','회사명이 겹칩니다. 티커·거래소를 확인해 선택하세요.'));return}if(valid(value.toUpperCase())&&!/^\d{6}$/.test(value))pick({symbol:value.toUpperCase(),name:value.toUpperCase()},{source:'search'});else results.append(el('p','검증된 종목 검색 결과가 없습니다.'))};
 async function loadThemes(){
  if(themeLoading||themesTried)return;
  themeLoading=true;themesTried=true;
  const groups=[];
  try{
   if(typeof THM!=='undefined'&&!THM.length)try{await ctx.sectors()}catch{}
   if(typeof THM!=='undefined'&&Array.isArray(THM))for(const [i,t] of THM.entries()){
    if(typeof t?.name!=='string'||!Array.isArray(t.rows))continue;
    groups.push({name:t.name,market:'KR',rank:i+1,strength:t.sc,themeReturn:t.rate,dataScope:'kr_theme_daily',benchmark:'^KS11',
      stocks:t.rows.filter(r=>valid(r.code)).map(r=>({symbol:r.code,name:r.name,market:'KR'}))});
   }
   try{
    const r=await fetch('data/us-theme-instruments.json',{cache:'no-cache'}),d=await r.json();
    if(r.ok&&d.schemaVersion===1&&Array.isArray(d.themes))for(const t of d.themes){
     if(typeof t?.name!=='string'||!Array.isArray(t.instruments))continue;
     groups.push({name:t.name,market:'US',rank:null,strength:null,themeReturn:null,dataScope:'us_theme_sample',benchmark:'SPY',
       stocks:t.instruments.filter(x=>valid(x.symbol)).map(x=>({symbol:x.symbol,name:x.name,market:'US'}))});
    }
   }catch{}
  }finally{
   themeLoading=false;
   if(alive){
    const seen=new Set(themeGroups.map(g=>g.market+':'+(g.kind||'theme')+':'+g.name));
    for(const group of groups){
     const key=group.market+':'+(group.kind||'theme')+':'+group.name;
     if(seen.has(key))continue;
     seen.add(key);themeGroups.push(group);
    }
    themeGroups=themeGroups.slice(0,80);
    draw();
   }
  }
 }
 function draw(){if(!alive)return;if(tab==='themes'&&!themesTried&&!themeLoading)void loadThemes();body.replaceChildren();for(const b of tabs.children)b.setAttribute('aria-pressed',String(b.dataset.tab===tab));if(tab==='search'){body.append(form,results);return}if(tab==='holdings'){const rows=holdings(ctx);if(!rows.length)body.append(el('p','검증된 계좌 자료 미수신 또는 선택 가능 종목 없음 · 미보유를 의미하지 않습니다.'));for(const h of rows){const b=el('button',(h.name||h.code)+' ('+h.code+') · '+h.accountLabel+' · '+h.quantity+'주 · 평단 '+h.avgPrice+' '+h.currency);b.type='button';b.onclick=()=>pick({symbol:h.code,name:h.name,instrumentId:h.instrumentId},{source:'holding'});body.append(b)}return}if(!themeGroups.length){body.append(el('p',themeLoading?'테마 구성종목 조회 중…':'검증된 테마 구성종목 미수신'));if(!themesTried)void loadThemes();else if(!themeLoading){const retry=el('button','테마 다시 조회');retry.type='button';retry.onclick=()=>{themesTried=false;draw()};body.append(retry)}return}for(const group of themeGroups){const box=el('details',null,'dense-details');box.append(el('summary',(group.market==='KR'?'한국':'미국')+(group.kind==='industry'?(group.proxy==='ETF'?' · 산업 ETF':' · 산업'):' · 테마')+' · '+group.name+(group.rank?' · '+group.rank+'위':'')));for(const s of group.stocks){const b=el('button',root.InstrumentNames?.label(s.symbol,s.name)||s.name+' ('+s.symbol+')');b.type='button';b.onclick=()=>pick(s,{source:group.kind==='industry'?'industry':'theme',industry:group.kind==='industry'?group.name:'',theme:group.kind==='industry'?'':group.name,rank:group.rank,strength:group.strength,themeReturn:group.themeReturn,relativeStrength:group.relativeStrength,themeReceivedAt:group.themeReceivedAt,observedAt:group.observedAt,period:group.period,dataScope:group.dataScope,benchmark:group.benchmark,coveragePct:group.coveragePct,stockReturn:s.stockReturn,stockRelativeStrength:s.stockRelativeStrength});box.append(b)}body.append(box)}}
 for(const [value,label] of [['themes','테마 종목'],['holdings','내 보유종목'],['search','직접 검색']]){const b=el('button',label);b.type='button';b.dataset.tab=value;b.onclick=()=>{tab=value;draw()};tabs.append(b)}element.append(el('h3','공통 종목 선택'),tabs,body);const off=ctx.subscribe?.(()=>{if(tab!=='search')draw()});const update=()=>{if(tab==='themes')draw()};root.addEventListener('myinvest:workflow-themes',update);draw();return {element,input,results,refresh:draw,destroy(){alive=false;seq++;off?.();root.removeEventListener('myinvest:workflow-themes',update);element.remove()}}}
root.InvestWorkflow=Object.freeze({select,current,clear,publish,ensure,compatible,holdings,registerThemes,search,judge,opportunity,scenarios,selector,registerAnalyzer(fn){analyzer=fn}});
})(window);
