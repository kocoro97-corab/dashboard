(function(root){
'use strict';
// Stock analysis V2: public OHLCV only. Never submits orders or modifies account records.
const WATCH_KEY='myinvest_sector_watch_v2';
const valid=s=>/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(s);
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const btn=(text,fn)=>{const b=el('button',text);b.type='button';b.addEventListener('click',fn);return b};
const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2}):'미확인';
const average=(a,n)=>a.length<n?null:a.slice(-n).reduce((s,x)=>s+x,0)/n;
function calculate(bars){
 const closes=bars.map(x=>x.c),last=closes.at(-1),prior=closes.at(-2),ma5=average(closes,5),ma20=average(closes,20),ma60=average(closes,60);
 const gains=[],losses=[];for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1];gains.push(Math.max(0,d));losses.push(Math.max(0,-d))}
 const g=average(gains,14),l=average(losses,14),rsi=g===null||l===null?null:l===0?(g===0?50:100):100-100/(1+g/l);
 const previous=bars.slice(-21,-1),high20=previous.length>=20?Math.max(...previous.map(x=>x.h)):null,low20=previous.length>=20?Math.min(...previous.map(x=>x.l)):null;
 const vol=bars.slice(-21,-1).map(x=>x.v);const hasVol=vol.length===20&&vol.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0)&&typeof bars.at(-1).v==='number'&&bars.at(-1).v>=0;
 const vavg=hasVol?average(vol,20):null,volumeRatio=vavg>0?bars.at(-1).v/vavg:null;
 const change=prior>0?(last/prior-1)*100:null;
 return {last,change,ma5,ma20,ma60,rsi,high20,low20,volumeRatio,trend:ma20===null?'추세 판단 대기':last>ma20&&ma5>ma20?'상승 추세 관찰':last<ma20&&ma5<ma20?'하락 추세 관찰':'혼조 · 방향 확인 필요'};
}
function watchRead(){try{const a=JSON.parse(localStorage.getItem(WATCH_KEY));return Array.isArray(a)?a.filter(x=>typeof x==='string'&&valid(x)).slice(0,100):[]}catch{return []}}
function watchToggle(symbol){const list=watchRead(),i=list.indexOf(symbol);if(i>=0)list.splice(i,1);else list.push(symbol);try{localStorage.setItem(WATCH_KEY,JSON.stringify(list.slice(0,100)));return i<0}catch{return false}}
function create(){
 const legacy=DashboardPages.legacy({ids:['chartsec'],refresh:async(ctx,force)=>{await ctx.chart(force);if(typeof drawQ==='function')drawQ()}});
 let view,formInput,status,results,mode='swing',symbol='',active=false,sequence=0;
 const css='.sva{margin-bottom:18px}.sva-form{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.sva-form input{padding:8px;min-width:180px;flex:1}.sva button{cursor:pointer}.sva-tabs{display:flex;gap:8px;margin:10px 0}.sva-tabs button{padding:8px 12px;border-radius:7px;border:1px solid #465775;background:#172238;color:#e7eef9}.sva-tabs button[aria-pressed="true"]{background:#264365;border-color:#72b5ff}.sva-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sva-card{background:#172238;border:1px solid #344158;color:#e7eef9;border-radius:9px;padding:12px}.sva-muted{font-size:12px;color:#b6c5d9}.sva-alert{border:1px solid #465775;border-radius:8px;padding:10px;margin:8px 0}@media(max-width:550px){.sva-grid{grid-template-columns:1fr}}';
 const metric=(name,value)=>{const c=el('div',undefined,'sva-card');c.append(el('small',name),el('h3',value));return c};
 function display(bars,source,sym,stamp){if(!active||symbol!==sym)return;const m=calculate(bars),last=bars.at(-1),stale=Date.now()-last.t>4*86400000;
 results.replaceChildren();results.append(el('h3',sym+' · 기술적 분석'),el('p','원천: '+source+' · 수신: '+stamp+' · 마지막 가격 봉: '+new Date(last.t).toLocaleString('ko-KR')+(stale?' · 오래된 데이터 가능':''),'sva-muted'));
 const grid=el('div',undefined,'sva-grid');[['종가',fmt(m.last)],['직전 봉 대비',m.change===null?'미확인':m.change.toFixed(2)+'%'],['MA5 / MA20',fmt(m.ma5)+' / '+fmt(m.ma20)],['MA60',fmt(m.ma60)],['RSI(14)',fmt(m.rsi)],['거래량 / 직전 20봉 평균',m.volumeRatio===null?'미확인':m.volumeRatio.toFixed(2)+'배'],['직전 20봉 고점',fmt(m.high20)],['직전 20봉 저점',fmt(m.low20)]].forEach(([k,v])=>grid.append(metric(k,v)));results.append(grid);
 results.append(el('h3','시장 해석 · '+m.trend));
 const info=mode==='day'?'단타: 이 일봉 자료만으로는 VWAP·체결강도·분봉 돌파를 검증할 수 없습니다. 실시간 진입 신호를 확정하지 않습니다.':'스윙: 일봉 추세·20봉 고저점을 관찰합니다. 실적·기관 수급·뉴스 촉매는 별도 검증이 필요합니다.';
 results.append(el('p',info,'sva-alert'));
 const triggers=[];if(m.high20!==null)triggers.push('상방 관찰 조건: 직전 20봉 고점 '+fmt(m.high20)+' 돌파 후 종가 유지 여부');if(m.ma20!==null)triggers.push('추세 무효화 관찰: 20봉 평균 '+fmt(m.ma20)+' 이탈 여부');if(m.low20!==null)triggers.push('하방 위험 기준: 직전 20봉 저점 '+fmt(m.low20)+' 이탈 여부');
 if(m.rsi!==null)triggers.push('RSI '+fmt(m.rsi)+(m.rsi>=70?' · 과열 구간 주의':m.rsi<=30?' · 약세/과매도 구간 주의':' · 중립 범위'));
 const ul=el('ul');triggers.forEach(t=>ul.append(el('li',t)));results.append(ul);
 results.append(el('p','판단 근거: '+bars.length+'개 일봉 OHLCV · 이동평균/RSI 단순 계산. 신뢰도 한계: 수정주가·분봉·호가·기관/외국인 수급·실적·뉴스 미검증. AI 예측 확률 또는 매수 추천이 아닙니다.','sva-muted'));
 const watchBtn=btn(watchRead().includes(sym)?'관심종목 해제':'관심종목 등록',()=>{const added=watchToggle(sym);watchBtn.textContent=added?'관심종목 해제':'관심종목 등록'});results.append(watchBtn);
 }
 async function analyze(sym){symbol=sym;const seq=++sequence;results.replaceChildren();status.textContent='실제 일봉 데이터 조회 중 · '+sym;
 const candidates=/^\d{6}$/.test(sym)?[sym+'.KS',sym+'.KQ']:[sym];let bars=null,source='';
 for(const y of candidates){try{if(typeof getJSON!=='function')break;const j=await getJSON('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(y)+'?interval=1d&range=1y');if(seq!==sequence||!active)return;const r=j?.chart?.result?.[0],q=r?.indicators?.quote?.[0];if(!r?.timestamp||!q)continue;const parsed=r.timestamp.map((t,i)=>({t:t*1000,o:q.open?.[i],h:q.high?.[i],l:q.low?.[i],c:q.close?.[i],v:q.volume?.[i]})).filter(b=>[b.o,b.h,b.l,b.c].every(Number.isFinite)&&b.t>0);if(parsed.length>=21){bars=parsed;source='Yahoo Finance ('+y+')';break}}catch{}}
 if(seq!==sequence||!active)return;
 if(!bars){status.textContent='분석 불가 · 검증된 일봉 데이터 부족 또는 공용 시세 중계 미연결';results.replaceChildren(el('p','실제 OHLCV 21봉 이상이 필요합니다. 종목 코드는 상장 종목 원천 확인 후 사용하세요. 가짜 가격이나 점수를 생성하지 않습니다.','sva-alert'));return}
 status.textContent='분석 완료 · 일봉 '+bars.length+'개 · '+new Date().toLocaleString('ko-KR');display(bars,source,sym,new Date().toLocaleString('ko-KR'));
 }
 function mount(container,ctx){active=true;view=el('section',undefined,'sva');const style=el('style');style.textContent=css;view.append(style,el('h2','AI 종목 분석 V2'),el('p','실제 시세 기반 기술적 분석 · 데이터 미확인 항목은 추정하지 않음','sva-muted'));const form=el('form',undefined,'sva-form');formInput=el('input');formInput.id='stockSearch';formInput.placeholder='005930 또는 AAPL';formInput.maxLength=20;formInput.setAttribute('aria-label','국내 6자리 코드 또는 미국 티커');const submit=btn('종목 분석',()=>{});submit.type='submit';form.append(formInput,submit);form.addEventListener('submit',e=>{e.preventDefault();const s=formInput.value.trim().toUpperCase();if(!valid(s)){status.textContent='국내 6자리 코드 또는 영문 티커를 입력하세요.';return}if(typeof showQ==='function')showQ(s,s,'',1);void analyze(s)});view.append(form);const tabs=el('div',undefined,'sva-tabs');[['day','단타'],['swing','스윙']].forEach(([m,label])=>{const b=btn(label,()=>{mode=m;tabs.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));if(symbol)void analyze(symbol)});b.setAttribute('aria-pressed',String(mode===m));tabs.append(b)});view.append(tabs);status=el('p','종목을 입력하면 실제 일봉을 조회합니다.','sva-muted');results=el('div');view.append(status,results);legacy.mount(container,ctx);container.prepend(view)}
 return {mount,refresh:(ctx,force)=>legacy.refresh(ctx,force),unmount:()=>{active=false;sequence++;view?.remove();legacy.unmount()},getStatus:()=>({status:active?'ready':'unmounted',symbol,mode})};
}
DashboardPages.register('stocks',create);
})(window);
