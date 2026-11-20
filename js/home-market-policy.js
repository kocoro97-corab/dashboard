/* Home-market observation policy. No quote fetch, credentials or trade inference. */
(function(root){
'use strict';
const MAIN=Object.freeze({
 KR:Object.freeze([['^KS11','KOSPI'],['^KQ11','KOSDAQ'],['k3','KOSPI 200 선물'],['KRW=X','달러/원'],['^SOX','SOX'],['^GSPC','S&P 500']]),
 US:Object.freeze([['^GSPC','S&P 500'],['^IXIC','NASDAQ'],['^DJI','DOW'],['^SOX','SOX'],['NQ=F','나스닥 선물'],['^VIX','VIX']])
});
const SECONDARY=Object.freeze({
 KR:Object.freeze([['^IXIC','NASDAQ'],['^VIX','VIX'],['^TNX','미국 10년물']]),
 US:Object.freeze([['KRW=X','달러/원'],['^KS11','KOSPI'],['^KQ11','KOSDAQ']])
});
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
 const usable=values.filter(x=>x.valid&&x.timely&&x.delta!==null);
 if(usable.length<2)return {status:'insufficient',title:'시장 방향 판단 보류',basis:'핵심 지수의 최근 수신값·전일 대비 등락률이 충분하지 않습니다.',notes:['미수신/지연 지수는 자동으로 추정하지 않습니다.']};
 const up=usable.filter(x=>x.delta>0).length,down=usable.filter(x=>x.delta<0).length;
 const title=up===2?'주요 지수 동반 상승':down===2?'주요 지수 동반 하락':'주요 지수 혼조·보합';
 const details=usable.map(x=>x.name+' '+(x.delta>0?'+':'')+x.delta.toFixed(2)+'%');
 const notes=[];
 const v=quote('^VIX',quotes,sources,received,now);
 if(v.valid&&v.timely){notes.push('VIX '+v.price.toFixed(2)+(v.price>=30?' · 높은 변동성 경계':v.price>=20?' · 변동성 확대 경계':' · 변동성 참고'))}
 const sox=quote('^SOX',quotes,sources,received,now);
 if(sox.valid&&sox.timely&&sox.delta!==null)notes.push('SOX '+(sox.delta>0?'+':'')+sox.delta.toFixed(2)+'%');
 return {status:'observed',title,basis:details.join(' · '),notes};
}
root.HomeMarketPolicy=Object.freeze({MAIN,SECONDARY,regionAt,kstHour,quote,marketRegime});
})(window);
