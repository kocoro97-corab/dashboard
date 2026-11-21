/* Home-market observation policy. No quote fetch, credentials or trade inference. */
(function(root){
'use strict';
const MAIN=Object.freeze({
 KR:Object.freeze([['^KS11','KOSPI'],['^KQ11','KOSDAQ'],['k3','KOSPI 200 선물'],['k4','KOSDAQ 150 선물'],['KRW=X','달러/원'],['^SOX','SOX'],['^GSPC','S&P 500']]),
 US:Object.freeze([['^GSPC','S&P 500'],['^IXIC','NASDAQ'],['^DJI','DOW'],['^SOX','SOX'],['NQ=F','나스닥 선물'],['^VIX','VIX']])
});
const SECONDARY=Object.freeze({
 KR:Object.freeze([['^IXIC','NASDAQ'],['^VIX','VIX'],['^TNX','미국 10년물']]),
 US:Object.freeze([['KRW=X','달러/원'],['^TNX','미국 10년물'],['^KS11','KOSPI']])
});
// Home-only presentation preferences. Reuse the market page's verified symbol catalog,
 // not arbitrary user-entered URLs or order/quote sources. TICK remains a separate widget.
const STORAGE_KEY='myinvest_home_priorities_v1';
const CATALOG=Object.freeze([
 ['^KS11','KOSPI'],['^KQ11','KOSDAQ'],['k3','KOSPI 200 선물'],['k4','KOSDAQ 150 선물'],
 ['^GSPC','S&P 500'],['^IXIC','NASDAQ'],['^DJI','DOW'],['^SOX','SOX'],
 ['^VIX','VIX'],['KRW=X','달러/원'],['^TNX','미국 10년물'],['^IRX','미국 단기금리'],
 ['GC=F','금 선물'],['CL=F','WTI 원유'],['NQ=F','NASDAQ 선물'],
 ['ES=F','S&P 500 선물'],['YM=F','DOW 선물']
].map(item=>Object.freeze(item)));
const LABELS=Object.freeze(Object.fromEntries(CATALOG));
function selections(saved){
 const list=region=>{
  const values=Array.isArray(saved?.[region])?saved[region]:MAIN[region].map(([id])=>id);
  return [...new Set(values.filter(id=>typeof id==='string'&&Object.prototype.hasOwnProperty.call(LABELS,id)))].slice(0,CATALOG.length);
 };
 return {KR:list('KR'),US:list('US')};
}
function display(region,saved){return selections(saved)[region].map(id=>[id,LABELS[id]])}
function editSelection(saved,region,action,id){
 const result=selections(saved),items=result[region];if(!items||!Object.prototype.hasOwnProperty.call(LABELS,id))return result;
 const at=items.indexOf(id);
 if(action==='add'&&at<0)items.push(id);
 if(action==='remove'&&at>=0)items.splice(at,1);
 if(action==='up'&&at>0)[items[at-1],items[at]]=[items[at],items[at-1]];
 if(action==='down'&&at>=0&&at<items.length-1)[items[at],items[at+1]]=[items[at+1],items[at]];
 return result;
}
const SOURCE=Object.freeze({N:'네이버',Y:'Yahoo',D:'Daum',H:'NH',W:'NH PLUG',F:'NH선물',K:'KIS',C:'코스콤',I:'IBKR',X:'dxFeed'});
function kstHour(date=new Date()){
 return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(date));
}
function regionAt(date=new Date()){const h=kstHour(date);return h>=7&&h<21?'KR':'US'}
function numeric(n){return typeof n==='number'&&Number.isFinite(n)}
function quote(id,quotes,sources,received,now=Date.now()){
 const q=quotes?.[id],p=q?.p,prev=q?.prev,at=q?.observedAt,rx=received?.[id];
 if(!numeric(p)||p<=0)return {id,valid:false,reason:'시세 미수신'};
 const delta=numeric(prev)&&prev>0?(p/prev-1)*100:null;
 const observed=numeric(at)&&at>0&&at<=now+300000?at:null;
 const seen=numeric(rx)&&rx>0&&rx<=now+300000?rx:null;
 const stale=(observed!==null&&now-observed>4*86400000)||(seen!==null&&now-seen>30*60000);
 // A receipt verifies transport timing, not the original exchange quote time.
 const timely=seen!==null&&now-seen<=30*60000&&(observed===null||now-observed<=86400000);
 return {id,valid:true,price:p,delta,source:SOURCE[sources?.[id]]||'출처 미확인',receivedAt:seen,observedAt:observed,stale,timely};
}
function marketRegime(region,quotes,sources,received,now=Date.now()){
 const core=region==='KR'?[['^KS11','KOSPI'],['^KQ11','KOSDAQ']]:[['^GSPC','S&P 500'],['^IXIC','NASDAQ']];
 const values=core.map(([id,name])=>({name,...quote(id,quotes,sources,received,now)}));
 const DAY=86400000;
 const usable=value=>value.valid&&value.delta!==null&&(value.timely||
  (value.observedAt!==null&&value.receivedAt!==null&&now-value.observedAt<=4*DAY&&now-value.receivedAt<=4*DAY));
 const found=values.filter(usable),reason=value=>!value.valid?'시세 미수신':value.delta===null?'전일 비교값 미확인':
  value.observedAt===null?'최근 수신/원천 시각 미확인':'관측·수신 시점이 오래됨';
 const unresolved=values.filter(value=>!usable(value)).map(value=>value.name+' · '+reason(value));
 const mismatched=found.length===2&&found.every(value=>value.observedAt!==null)&&
  Math.abs(found[0].observedAt-found[1].observedAt)>36*3600000;
 if(found.length<2||mismatched){
  return {status:'insufficient',title:'시장 방향 판단 보류',
   basis:mismatched?'두 지수의 원천 관측일이 일치하지 않습니다.':'핵심 지수 2개 중 확인 '+found.length+'개 · 최근 수신값과 전일 대비 수치가 필요합니다.',
   notes:[...unresolved,...(mismatched?['관측일 불일치 · 같은 기준일 비교 필요']:[]),'미수신·오래된 값으로 시장 방향을 추정하지 않습니다.']};
 }
 const up=found.filter(x=>x.delta>0).length,down=found.filter(x=>x.delta<0).length;
 const direction=up===2?'주요 지수 동반 상승':down===2?'주요 지수 동반 하락':'주요 지수 혼조·보합';
 const historical=found.some(x=>!x.timely),unknownTime=found.some(x=>x.observedAt===null);
 const title=historical?'최근 확인 종가 기준 · '+direction:direction;
 const notes=[];
 if(historical)notes.push('과거 원천 관측자료 기준 · 실시간 시장 상황이 아닙니다.');
 else if(unknownTime)notes.push('수신 시각만 확인 · 원천 관측시각 미제공으로 실시간 여부 미확인');
 else notes.push('최근 수신 및 원천 관측시각 확인 · 거래소 실시간 제공 여부는 별도 확인 필요');
 const v=quote('^VIX',quotes,sources,received,now);
 if(v.valid&&(v.timely||(v.observedAt!==null&&now-v.observedAt<=4*DAY)))notes.push('VIX '+v.price.toFixed(2)+(v.price>=30?' · 높은 변동성 경계':v.price>=20?' · 변동성 확대 경계':' · 변동성 참고'));
 const sox=quote('^SOX',quotes,sources,received,now);
 if(sox.valid&&sox.delta!==null&&(sox.timely||(sox.observedAt!==null&&now-sox.observedAt<=4*DAY)))notes.push('SOX '+(sox.delta>0?'+':'')+sox.delta.toFixed(2)+'% · 반도체 참고');
 const fx=quote('KRW=X',quotes,sources,received,now);
 if(fx.valid&&fx.delta!==null&&fx.timely)notes.push('달러/원 '+(fx.delta>0?'+':'')+fx.delta.toFixed(2)+'% · 환율 참고');
 const bond=quote('^TNX',quotes,sources,received,now);
 if(bond.valid&&bond.timely)notes.push('미국 10년물 '+bond.price.toFixed(2)+'% · 공급자 수익률 표기');
 return {status:historical?'last-close':'observed',title,basis:found.map(x=>x.name+' '+(x.delta>0?'+':'')+x.delta.toFixed(2)+'%').join(' · '),notes};
}
root.HomeMarketPolicy=Object.freeze({MAIN,SECONDARY,CATALOG,STORAGE_KEY,selections,display,editSelection,regionAt,kstHour,quote,marketRegime});
})(window);
