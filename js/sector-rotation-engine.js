(function(root){'use strict';
/**
 * MY INVEST V2 — Sector/Theme Rotation Engine (standalone, no I/O).
 *
 * Only analyses verified existing quote histories with matching trading
 * sessions, currency/market identity, and explicit coverage. No fabricated
 * cash flow, universe breadth, theme-wide rankings or buy/sell signals.
 */
const PERIODS=Object.freeze([1,5,20,60]);
const ALLOWED_MARKETS=new Set(['KR','US']);
const ALLOWED_TYPES=new Set(['industry','theme','sector_etf_proxy']);
const ID=/^[A-Za-z0-9^._=-]{1,35}$/;
const SYMBOL=/^(?:[0-9]{6}(?:\.(?:KS|KQ))?|[A-Z^][A-Z0-9.^=-]{0,19})$/;
const isNum=n=>typeof n==='number'&&Number.isFinite(n);
const nonneg=n=>isNum(n)&&n>=0;
function day(s){
 if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;
 const n=Date.parse(s+'T00:00:00Z');
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===s?s:null;
}
function pct(a,b){return isNum(a)&&isNum(b)&&a>0&&b>0?(a/b-1)*100:null}
function cleanBar(raw){
 if(!raw||typeof raw!=='object'||!day(raw.date)||!isNum(raw.close)||raw.close<=0)return null;
 if(raw.volume!=null&&!nonneg(raw.volume))return null;
 if(raw.turnover!=null&&!nonneg(raw.turnover))return null;
 return {date:raw.date,close:raw.close,volume:raw.volume??null,turnover:raw.turnover??null};
}
function series(raw,{maxBars=370}={}){
 if(!Array.isArray(raw)||!raw.length||raw.length>maxBars)return {status:'unavailable',reason:'일봉 개수/자료 없음',bars:[]};
 const out=[],seen=new Set();
 for(const e of raw){
  const row=cleanBar(e);
  if(!row)return {status:'unavailable',reason:'종가·거래량·거래대금 자료 오류',bars:[]};
  if(seen.has(row.date)||out.length&&out.at(-1).date>=row.date)return {status:'unavailable',reason:'중복·역순 거래일',bars:[]};
  seen.add(row.date);out.push(row);
 }
 return {status:'ready',bars:out,asOf:out.at(-1).date};
}
function compareAtDays(bars,reference,periods=PERIODS){
 const index=new Map(bars.map(e=>[e.date,e])),out={};
 for(const n of periods){
  if(reference.length<n+1){out[n]={status:'insufficient',reason:'기준지수 거래일 부족'};continue}
  const days=reference.slice(-(n+1)).map(x=>x.date);
  const matching=days.map(d=>index.get(d));
  if(matching.some(x=>!x)){out[n]={status:'insufficient',reason:'구성자산 거래일 누락'};continue}
  const end=matching.at(-1),start=matching[0];
  out[n]={status:'ready',returnPct:pct(end.close,start.close),asOf:end.date,
    startDate:start.date,observations:matching.length,turnover:end.turnover??null,
    turnoverUnit:null};
 }
 return out;
}
function normalizeBenchmark(input,market){
 if(!input||typeof input!=='object'||input.market!==market||typeof input.symbol!=='string'||
    !SYMBOL.test(input.symbol)||input.verified!==true)return {status:'unavailable',reason:'기준지수 식별/검증 실패'};
 const result=series(input.bars);
 if(result.status!=='ready')return result;
 return {status:'ready',symbol:input.symbol,bars:result.bars,
  source:typeof input.source==='string'&&input.source.length<150?input.source:'출처 미확인',
  asOf:result.asOf,market};
}
function identity(item,market){
 if(!item||typeof item!=='object'||item.market!==market||!ALLOWED_TYPES.has(item.type)||
 !ID.test(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>100||
 item.verified!==true||typeof item.source!=='string'||!item.source.trim()||
 !['KRW','USD'].includes(item.currency)||item.currency!==(market==='KR'?'KRW':'USD'))return false;
 if(item.type==='sector_etf_proxy'&&market!=='US')return false;
 return true;
}
function breadth(members,{declaredCount=null}={}){
 if(!Array.isArray(members)||!members.length)return {status:'unavailable',reason:'검증된 구성종목 없음'};
 if(members.length>400)return {status:'unavailable',reason:'구성종목 개수 초과'};
 if(declaredCount!=null&&(!Number.isSafeInteger(declaredCount)||declaredCount<members.length))return {status:'unavailable',reason:'전체 구성종목 수 오류'};
 const unique=new Set(),valid=[],missing=[];
 for(const m of members){
  const symbol=String(m?.symbol||'').toUpperCase();
  if(!SYMBOL.test(symbol)||unique.has(symbol))return {status:'unavailable',reason:'구성종목 식별자 중복/오류'};
  unique.add(symbol);
  if(isNum(m.changePct)){if(Math.abs(m.changePct)>10000)return {status:'unavailable',reason:'등락률 범위 오류'};valid.push(m)}
  else missing.push(symbol);
 }
 const up=valid.filter(x=>x.changePct>0).length,down=valid.filter(x=>x.changePct<0).length;
 const flat=valid.length-up-down;
 const fraction=valid.length/members.length;
 return {status:valid.length?'partial':'unavailable',observed:valid.length,sampled:members.length,
  declaredTotal:declaredCount,coveragePct:Math.round(fraction*10000)/100,
  up,down,flat,upPct:valid.length?Math.round(up/valid.length*10000)/100:null,
  fullUniverseVerified:declaredCount===members.length&&missing.length===0&&members.length>0,
  missingSymbols:missing.slice(0,30),
  note:'표본 상승비율 · 전체 시장 상승종목 비율이 아님'};
}
function turnover(members,currency,unit){
 if(!Array.isArray(members)||!members.length)return {status:'unavailable',value:null,coveragePct:0};
 if(!['KRW','USD'].includes(currency)||unit!==currency)return {status:'unavailable',value:null,reason:'금액 단위 미검증'};
 const valid=members.filter(m=>m&&nonneg(m.turnover));
 const all=valid.length===members.length;const total=valid.reduce((sum,m)=>sum+m.turnover,0);
 if(!isNum(total))return {status:'unavailable',value:null,reason:'금액 합계 오류'};
 return {status:all?'complete':valid.length?'partial':'unavailable',value:valid.length?total:null,
  currency,coveragePct:Math.round(valid.length/members.length*10000)/100,
  note:'제공된 표본 구성종목 거래대금 합계 · 산업 전체 자금 유입이 아님'};
}
function memberRank(members,{minimum=3}={}){
 if(!Array.isArray(members)||!members.length)return {status:'unavailable',leaders:[],laggards:[]};
 const seen=new Set(),valid=[];
 for(const row of members){
  const symbol=String(row?.symbol||'').toUpperCase();
  if(!SYMBOL.test(symbol)||seen.has(symbol))continue;
  seen.add(symbol);
  if(!isNum(row.changePct)||!nonneg(row.turnover)||!row.sourceVerified)continue;
  valid.push({symbol,name:String(row.name||symbol).slice(0,80),changePct:row.changePct,
   turnover:row.turnover,source:String(row.source||'').slice(0,120)});
 }
 if(valid.length<minimum)return {status:'insufficient',leaders:[],laggards:[],count:valid.length,reason:'검증된 등락률·동일 단위 거래대금 표본 부족'};
 // Relative ranking within this verified SAMPLE only. No all-market leader claim.
 const ascending=[...valid].sort((a,b)=>a.changePct-b.changePct||b.turnover-a.turnover);
 const descending=[...valid].sort((a,b)=>b.changePct-a.changePct||b.turnover-a.turnover);
 return {status:'sample-only',leaders:descending.slice(0,5),laggards:ascending.slice(0,5),
  count:valid.length,note:'검증된 표본 내 상승률·거래대금 보조 비교 · 주도주 확정 아님'};
}
function assess({market,benchmark,candidates=[],nowDay=null}={}){
 if(!ALLOWED_MARKETS.has(market)||!Array.isArray(candidates)||candidates.length>150)throw Error('SECTOR_INPUT_INVALID');
 const benchmarkInfo=normalizeBenchmark(benchmark,market);
 if(benchmarkInfo.status!=='ready')return {status:'insufficient',market,reason:'기준지수: '+(benchmarkInfo.reason||'일봉 미확인'),candidates:[],rotation:[],coverage:{benchmark:false}};
 const observed=benchmarkInfo.bars,benchmarkDay=observed.at(-1).date;
 if(nowDay!==null&&(!day(nowDay)||nowDay<benchmarkDay))return {status:'insufficient',market,reason:'기준지수 기준일 오류',candidates:[],rotation:[],coverage:{benchmark:false}};
 const benchmarkChanges=compareAtDays(observed,observed);
 const results=[],ids=new Set();
 for(const item of candidates){
  if(!identity(item,market)||ids.has(item.id)){results.push({id:typeof item?.id==='string'?item.id:'UNKNOWN',status:'unavailable',reason:'산업/테마 식별·출처 오류 또는 ID 중복'});continue}
  ids.add(item.id);
  const value=series(item.bars);
  if(value.status!=='ready'){results.push({id:item.id,name:item.name,status:'unavailable',reason:value.reason});continue}
  const aligned=compareAtDays(value.bars,observed);
  const period={};for(const n of PERIODS){
   const v=aligned[n],b=benchmarkChanges[n],ready=v.status==='ready'&&b.status==='ready';
   period[n+'d']=ready?{status:'ready',returnPct:v.returnPct,benchmarkPct:b.returnPct,
     relativePp:v.returnPct-b.returnPct,asOf:v.asOf,startDate:v.startDate}:{
     status:'insufficient',reason:v.reason||b.reason||'기준자료 부족'};
  }
  const groupBreadth=breadth(item.members,{declaredCount:item.universeCount??null});
  const activity=turnover(item.members,item.currency,item.turnoverCurrency);
  const ranks=memberRank(item.members);
  const possible=period['5d'].status==='ready'&&period['20d'].status==='ready';
  const rotation=possible?{
   status:'descriptive',relative5dPp:period['5d'].relativePp,relative20dPp:period['20d'].relativePp,
   shortVsMidPp:period['5d'].relativePp-period['20d'].relativePp,
   label:period['5d'].relativePp>0&&period['20d'].relativePp>0?'시장 대비 지속 우위':
    period['5d'].relativePp>0&&period['20d'].relativePp<=0?'단기 상대강도 개선':
    period['5d'].relativePp<=0&&period['20d'].relativePp>0?'단기 상대강도 약화':'시장 대비 지속 열위'
  }:{status:'insufficient',reason:'5일 및 20일 동시 비교 불가'};
  results.push({id:item.id,name:item.name,market,type:item.type,currency:item.currency,
   source:item.source,verified:true,status:'descriptive',asOf:benchmarkDay,
   isProxy:item.type==='sector_etf_proxy',periods:period,rotation,breadth:groupBreadth,
   turnover:activity,memberRank:ranks,universeCoverage:groupBreadth.fullUniverseVerified,
   note:item.type==='sector_etf_proxy'?'섹터 ETF 대용지표 · 실제 전체 산업 수익률 아님':'검증된 표본 범위 내 설명'});
 }
 const rotation=results.filter(x=>x.status==='descriptive'&&x.rotation.status==='descriptive')
 .slice().sort((a,b)=>b.rotation.relative5dPp-a.rotation.relative5dPp||a.id.localeCompare(b.id))
 .map((x,i)=>({rank:i+1,id:x.id,name:x.name,relative5dPp:x.rotation.relative5dPp,
   relative20dPp:x.rotation.relative20dPp,status:x.rotation.label,
   scope:'제공된 후보만 순위 · 전체 산업 순위 아님'}));
 return {status:results.some(x=>x.status==='descriptive')?'descriptive':'insufficient',
  market,asOf:benchmarkDay,benchmark:{symbol:benchmarkInfo.symbol,source:benchmarkInfo.source,changes:benchmarkChanges},
  candidates:results,rotation,coverage:{benchmark:true,provided:candidates.length,analysed:results.filter(x=>x.status==='descriptive').length},
  warnings:['개별 일봉과 기준지수 동일 거래일 기준 비교','미조회 구간·주식 우주 전체의 상대강도는 추정하지 않음',
   '표본 거래대금은 순매수·자금유입이 아님','추천·주문·수익 예측 기능 아님']};
}
const api=Object.freeze({assess,series,compareAtDays,breadth,turnover,memberRank,PERIODS});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestSectorRotation=api;
})(globalThis);
