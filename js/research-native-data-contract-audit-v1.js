/* MY INVEST V2 — native public-data compatibility gate.
 * Read-only inspection of ALREADY RETURNED HomeMarketPolicy.quote,
 * page-sectors analytics, IndustryData.read, and publicAnalysis objects.
 * Never certifies a closing price, a full exchange universe, or an order.
 */
(function(root){
'use strict';
const KEYS=['market','mode','now','homeQuote','sectorPage','industryRead','stockAnalysis'];
const MAX_AGE=96*3600000,RX_AGE=30*60000,FUTURE=300000;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>obj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const number=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0;
const fresh=(x,now,age)=>time(x)&&x<=now+FUTURE&&now-x<=age;
const symbol=(s,m)=>typeof s==='string'&&(m==='KR'?/^[0-9]{6}$/.test(s):/^[A-Z][A-Z0-9.-]{0,12}$/.test(s));
const REASONS=Object.freeze({
 INVALID_INPUT:'입력 필드 또는 개인정보 가능성이 있는 추가 필드를 확인해야 합니다.',
 HOME_MISSING:'홈 기준지수 시세의 식별자·가격·관측시각이 부족합니다.',
 HOME_STALE:'홈 지수의 관측·수신시각이 오래되었거나 없습니다.',
 HOME_NOT_HISTORY:'단일 현재 시세는 5·20거래일 확정 종가와 시장 폭을 대체하지 않습니다.',
 SECTOR_PRIVATE_MAP:'기존 산업 화면 analytics Map은 외부로 노출된 읽기 전용 API가 아닙니다.',
 US_SPY_PROXY:'미국 산업 화면의 SPY는 S&P 500 지수(^GSPC)가 아닌 ETF 대리지표입니다.',
 SECTOR_BENCHMARK_ID:'시장과 산업 화면의 기준지수 식별자가 일치하지 않습니다.',
 SECTOR_SERIES_MISSING:'기준지수 최소 21개 일봉의 시각·종가·거래량 자료가 부족합니다.',
 SECTOR_SERIES_INVALID:'산업 화면의 일봉 시각·종가·거래량에 중복/불일치가 있습니다.',
 SECTOR_RECEIPT_STALE:'산업 분석 결과의 수신시각 확인이 필요합니다.',
 SECTOR_CLOSE_UNVERIFIED:'산업 분석에 거래소 확정 종가 및 휴장일 인증이 없습니다.',
 KR_INDUSTRY_MISSING:'국내 산업 구성종목 수신 데이터가 부족합니다.',
 KR_INDUSTRY_OBS_MISSING:'산업 구성종목 거래일(localTradedAt)이 일부 없거나 오래되었습니다.',
 KR_INDUSTRY_COVERAGE_UNKNOWN:'산업 전체 구성종목 수 또는 표본 커버리지가 부족합니다.',
 KR_INDUSTRY_PARTIAL:'한 번에 일부 구성종목만 조회했거나 상위 종목만 분석했습니다.',
 KR_INDUSTRY_NOT_WHOLE_MARKET:'국내 산업별 표본 상승폭은 거래소 전체 시장 폭이 아닙니다.',
 US_SECTOR_ETF_NOT_INDUSTRY:'미국 섹터 ETF 등락은 해당 산업 구성종목의 상대강도가 아닙니다.',
 US_THEME_NOT_EXCHANGE:'미국 테마 표본은 거래소 전체 상장종목 모집단이 아닙니다.',
 STOCK_MISSING:'기존 종목 일봉 분석 결과가 제공되지 않았습니다.',
 STOCK_IDENTITY:'종목 식별자·통화·거래소·제공처를 확인해야 합니다.',
 STOCK_BARS:'종목 OHLCV 일봉이 부족하거나 시간·가격 배열이 유효하지 않습니다.',
 STOCK_STALE:'종목 일봉 관측일 또는 수신시각이 오래됐거나 없습니다.',
 STOCK_CLOSE_UNVERIFIED:'종목 일봉의 거래소 확정 종가 여부를 확인할 수 없습니다.',
 STOCK_TECH_NOT_EQUIVALENT:'기존 publicAnalysis.metrics는 독립 WorkTradingStrategy.analyze 출력과 다릅니다.',
 STOCK_TURNOVER_NOT_EXPORTED:'기존 publicAnalysis는 거래대금 20일 배율과 해당 증거를 반환하지 않습니다.',
 MARKET_BREADTH_NOT_EXPORTED:'시장 전체 모집단·상승종목 수·관측시각이 제공되지 않습니다.',
 EXCHANGE_CALENDAR_NOT_VERIFIED:'시장 휴장·조기폐장 및 거래일 연속성이 검증되지 않았습니다.',
 HISTORY_PERSISTENCE_NOT_WIRED:'일별 적격 근거를 저장하는 승인된 보관 경로가 연결되지 않았습니다.',
 DAY_INTRADAY_MISSING:'일봉 근거만으로 단타 분봉·체결 시그널을 제공할 수 없습니다.'
});
const ORDER=Object.freeze(Object.keys(REASONS).filter(k=>k!=='INVALID_INPUT'));
const rejected=()=>Object.freeze({status:'blocked',code:'INVALID_INPUT',market:null,mode:null,
 layers:Object.freeze([]),needs:Object.freeze([]),fullReportEligible:false,
 canUseAsLiveMarketData:false,accountAccessed:false,providerCalls:0,ordersPlaced:0});
function barsCheck(series,now){
 if(!obj(series)||!Array.isArray(series.times)||!Array.isArray(series.bars)||
  !Array.isArray(series.volume)||series.times.length<21||series.times.length>650||
  series.bars.length!==series.times.length||series.volume.length!==series.times.length)
  return 'SECTOR_SERIES_MISSING';
 const seen=new Set();let prev=0;
 for(let i=0;i<series.times.length;i++){
  const t=series.times[i],close=series.bars[i],v=series.volume[i];
  if(!Number.isSafeInteger(t)||t<=prev||t*1000>now+FUTURE||
   !number(close)||close<=0||!(v===null||number(v)&&v>=0))
   return 'SECTOR_SERIES_INVALID';
  const d=new Date(t*1000).toISOString().slice(0,10);
  if(seen.has(d))return 'SECTOR_SERIES_INVALID';
  seen.add(d);prev=t;
 }
 if(!time(series.last)||series.last!==series.times.at(-1)*1000)
  return 'SECTOR_SERIES_INVALID';
 return null;
}
function stockCheck(s,market,now){
 if(!s)return {status:'absent',count:0,codes:['STOCK_MISSING','STOCK_TECH_NOT_EQUIVALENT',
  'STOCK_TURNOVER_NOT_EXPORTED','STOCK_CLOSE_UNVERIFIED']};
 const K=['symbol','provider','currency','exchange','bars','metrics','source','observedAt','receivedAt'];
 if(!exact(s,K)||!symbol(s.symbol,market)||
  s.currency!==(market==='KR'?'KRW':'USD')||
  typeof s.provider!=='string'||typeof s.exchange!=='string'||
  typeof s.source!=='string'||s.source.length>100||
  (market==='KR'&&!/^[0-9]{6}\.(KS|KQ)$/.test(s.provider))||
  (market==='US'&&s.provider!==s.symbol))
  return {status:'blocked',count:0,codes:['STOCK_IDENTITY',
   'STOCK_TECH_NOT_EQUIVALENT','STOCK_TURNOVER_NOT_EXPORTED']};
 const arr=s.bars;
 if(!Array.isArray(arr)||arr.length<21||arr.length>650)
  return {status:'blocked',count:0,codes:['STOCK_BARS']};
 let prev=0;
 for(const b of arr){
  if(!obj(b)||!['t','o','h','l','c','v'].every(k=>Object.hasOwn(b,k))||
   !time(b.t)||b.t<=prev||b.t>now+FUTURE||
   ![b.o,b.h,b.l,b.c].every(v=>number(v)&&v>0)||
   b.h<Math.max(b.o,b.l,b.c)||b.l>Math.min(b.o,b.h,b.c)||
   !(b.v===null||number(b.v)&&b.v>=0))
   return {status:'blocked',count:0,codes:['STOCK_BARS']};
  prev=b.t;
 }
 const codes=[];
 if(!fresh(s.observedAt,now,MAX_AGE)||!fresh(s.receivedAt,now,RX_AGE)||
  s.observedAt!==prev||s.observedAt>s.receivedAt+FUTURE)
  codes.push('STOCK_STALE');
 if(!obj(s.metrics)||s.metrics.last!==arr.at(-1).c||
  !number(s.metrics.ma20)||!number(s.metrics.change))
  codes.push('STOCK_BARS');
 codes.push('STOCK_CLOSE_UNVERIFIED','STOCK_TECH_NOT_EQUIVALENT','STOCK_TURNOVER_NOT_EXPORTED');
 return {status:codes.length===3?'structure-present':'blocked',count:arr.length,codes};
}
function audit(input){
 if(!exact(input,KEYS)||!['KR','US'].includes(input.market)||
  !['day','swing'].includes(input.mode)||!time(input.now)||
  !['homeQuote','sectorPage','industryRead','stockAnalysis']
   .every(k=>input[k]===null||obj(input[k])))return rejected();
 const market=input.market,now=input.now,findings=new Set(),layers=[];
 const mark=(name,status,codes,detail)=>{
  for(const code of codes)if(Object.hasOwn(REASONS,code))findings.add(code);
  layers.push(Object.freeze({name,status,needs:Object.freeze([...new Set(codes)]),detail}));
 };
 const h=input.homeQuote;
 if(!h||h.valid!==true||h.id!==(market==='KR'?'^KS11':'^GSPC')||
  !number(h.price)||h.price<=0)
  mark('home','blocked',['HOME_MISSING','HOME_NOT_HISTORY'],'홈 지수 시세 미확인');
 else{
  const ok=h.stale===false&&h.timely===true&&
    fresh(h.observedAt,now,MAX_AGE)&&fresh(h.receivedAt,now,RX_AGE);
  mark('home',ok?'structure-present':'blocked',
   (ok?[]:['HOME_STALE']).concat('HOME_NOT_HISTORY'),
   ok?'지수 관측 및 수신시각 구조 확인':'지수 관측·수신시각 보완 필요');
 }
 const sector=input.sectorPage;
 if(!sector)mark('sector','not-exported',
  ['SECTOR_PRIVATE_MAP','SECTOR_CLOSE_UNVERIFIED'],
  '페이지 내부 맵은 현재 읽기 전용 접근자 없음');
 else{
  const reasons=[];
  const expected=market==='KR'?'^KS11':'^GSPC';
  if(sector.benchmarkSymbol!==expected||
   sector.market!==market)
   reasons.push(market==='US'&&sector.benchmarkSymbol==='SPY'?
    'US_SPY_PROXY':'SECTOR_BENCHMARK_ID');
  const bars=barsCheck(sector.benchmarkSeries,now);
  if(bars)reasons.push(bars);
  if(!fresh(sector.received,now,RX_AGE))reasons.push('SECTOR_RECEIPT_STALE');
  if(!['theme','industry'].includes(sector.category)||
   !['1d','5d','20d','60d'].includes(sector.period)||
   !Array.isArray(sector.rows)||sector.rows.length>50||
   !number(sector.benchmark)||!time(sector.asof)||sector.asof>now+FUTURE)
   reasons.push('SECTOR_SERIES_INVALID');
  reasons.push('SECTOR_CLOSE_UNVERIFIED');
  mark('sector',reasons.length===1?'structure-present':'blocked',
   [...new Set(reasons)],'기존 산업 일봉 수신 자료. 거래소 확정 종가 미검증');
 }
 const industry=input.industryRead;
 if(market==='US')mark('industry','proxy-only',
  ['US_SECTOR_ETF_NOT_INDUSTRY','US_THEME_NOT_EXCHANGE'],
  '미국 ETF·테마 표본을 산업 전체로 승격할 수 없음');
 else if(!industry)mark('industry','absent',
  ['KR_INDUSTRY_MISSING','KR_INDUSTRY_NOT_WHOLE_MARKET'],
  '국내 산업 목록·구성종목 관측이 미제공');
 else{
  const g=industry.groups,m=industry.members;
  const codes=[];
  const okGroup=obj(g)&&Array.isArray(g.rows)&&g.rows.length<=100&&
    fresh(g.receivedAt,now,RX_AGE)&&
    typeof g.source==='string'&&g.source.startsWith('https://m.stock.naver.com/api/stocks/industry');
  const okMember=obj(m)&&Array.isArray(m.rows)&&m.rows.length<=100&&
    fresh(m.receivedAt,now,RX_AGE)&&
    typeof m.source==='string'&&
    /^https:\/\/m\.stock\.naver\.com\/api\/stocks\/industry\/\d{1,6}\?page=1&pageSize=100$/.test(m.source);
  if(!okGroup||!okMember)codes.push('KR_INDUSTRY_MISSING');
  if(okMember){
   const seen=new Set();
   if(m.rows.some(r=>!obj(r)||!symbol(r.code,'KR')||
      !['KOSPI','KOSDAQ'].includes(r.market)||seen.has(r.code)||(seen.add(r.code),false)))
    codes.push('KR_INDUSTRY_MISSING');
   if(!m.rows.every(r=>typeof r.observedAt==='string'&&
     fresh(Date.parse(r.observedAt),now,MAX_AGE)))
    codes.push('KR_INDUSTRY_OBS_MISSING');
   if(!Number.isInteger(m.total)||m.total<=0||m.rows.length>m.total)
    codes.push('KR_INDUSTRY_COVERAGE_UNKNOWN');
   else if(m.rows.length<m.total)codes.push('KR_INDUSTRY_PARTIAL');
  }
  codes.push('KR_INDUSTRY_NOT_WHOLE_MARKET');
  mark('industry',okGroup&&okMember?'partial-structure':'blocked',
   [...new Set(codes)],'국내 산업 구성원 표본 · 전체 거래소 폭 아님');
 }
 const stock=stockCheck(input.stockAnalysis,market,now);
 mark('stock',stock.status,stock.codes,
  stock.count?String(stock.count)+'개 일봉 구조 확인 · 전략 기술분석 출력 미연결':'종목 일봉 입력 검증 보류');
 mark('breadth','unavailable',['MARKET_BREADTH_NOT_EXPORTED'],
  '거래소 전체 상장종목 상승/하락 모집단 자료 미제공');
 mark('calendar','unverified',['EXCHANGE_CALENDAR_NOT_VERIFIED'],
  '공식 휴장일 및 조기폐장 확인 불가');
 mark('history','not-connected',['HISTORY_PERSISTENCE_NOT_WIRED'],
  '적격한 일별 데이터 이력 보관이 아직 연결되지 않음');
 if(input.mode==='day')mark('intraday','not-connected',['DAY_INTRADAY_MISSING'],
  '분봉·호가·체결이 확보되지 않음');
 const needs=ORDER.filter(code=>findings.has(code)).map(code=>
  Object.freeze({code,description:REASONS[code]}));
 return Object.freeze({
  status:'review-required',code:'NATIVE_REPORT_CONTRACT_INCOMPLETE',market,mode:input.mode,
  layers:Object.freeze(layers),needs:Object.freeze(needs),totalMissing:needs.length,
  originalInterfaces:Object.freeze({
   home:'HomeMarketPolicy.quote',sector:'page-sectors internal analytics',
   sectorsDerived:'SectorInsights.metrics',industry:'IndustryData.read',
   stock:'page-stocks publicAnalysis',marketWideBreadthExported:false,
   sectorMapReadOnlyExported:false,exchangeCloseVerified:false,
   technicalContractEquivalent:false,providerAuthenticityVerified:false
  }),
  fullReportEligible:false,canUseAsLiveMarketData:false,
  accountAccessed:false,providerCalls:0,ordersPlaced:0
 });
}
const api=Object.freeze({audit});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestNativeDataContractAuditV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
