/* MY INVEST V2 — offline public market briefing composer. No network, account access or publishing. */
(function(root){
'use strict';
const names=Object.freeze({
 sp500:['S&P 500','pt'],nasdaq:['NASDAQ','pt'],dow:['Dow Jones','pt'],sox:['SOX','pt'],
 kospi:['KOSPI','pt'],kosdaq:['KOSDAQ','pt'],esf:['S&P500 선물','pt'],
 nqf:['나스닥 선물','pt'],ymf:['다우 선물','pt'],usdkrw:['원/달러','KRW'],
 ust2y:['미 국채 2년','%'],ust10y:['미 국채 10년','%'],vix:['VIX','pt']
});
const core=['sp500','nasdaq','dow','sox'];
const groups={futures:['esf','nqf','ymf'],rates:['usdkrw','ust2y','ust10y','vix'],
 korea:['kospi','kosdaq']};
const allowed=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).every(k=>keys.includes(k));
const clock=n=>Number.isSafeInteger(n)&&n>0&&n<8640000000000000;
const error=code=>({ok:false,code});
function deps(){
 if(typeof module==='object'&&module.exports)return {
  archive:require('./news-briefing-archive-v1.js'),transfer:require('./news-briefing-transfer-v1.js')
 };
 return {archive:root.MYInvestBriefingArchiveV1,transfer:root.MYInvestBriefingTransferV1};
}
function compose(data,{now}={}){
 const {archive,transfer}=deps();
 if(!clock(now))return error('EXPLICIT_NOW_REQUIRED');
 if(!allowed(data,['type','schemaVersion','visibility','timeZone','reportDate','collectedAt','sources','quotes','calendar','sectors'])||
  data.type!=='myinvest-public-market-snapshot-v1'||data.schemaVersion!==1||
  data.visibility!=='public-market-only'||data.timeZone!=='Asia/Seoul')
  return error('INVALID_SNAPSHOT');
 if(data.reportDate!==archive.kstDate(now))return error('REPORT_DATE_NOT_TODAY_KST');
 const collected=data.collectedAt;
 if(!clock(collected)||collected>now+300000||now-collected>12*3600000)
  return error('STALE_OR_FUTURE_COLLECTION');
 if(!Array.isArray(data.sources)||!data.sources.length||data.sources.length>20||
  !Array.isArray(data.quotes)||data.quotes.length>20)return error('INVALID_COLLECTION');
 const sourceIds=new Set(),sources=[];
 for(const s of data.sources){
  if(!allowed(s,['id','title','url','publishedAt'])||typeof s.id!=='string'||
   !/^[A-Za-z0-9_-]{1,40}$/.test(s.id)||sourceIds.has(s.id)||
   typeof s.title!=='string'||!s.title.trim()||s.title.length>180)
   return error('INVALID_SOURCE');
  const url=archive.safeUrl(s.url);
  if(!url||/(?:api[_-]?key|token|secret|password|authorization)=/i.test(url))
   return error('UNSAFE_URL');
  if(s.publishedAt!=null&&(!clock(s.publishedAt)||s.publishedAt>collected+300000))
   return error('INVALID_SOURCE_TIMESTAMP');
  sourceIds.add(s.id);sources.push({id:s.id,title:s.title.trim(),url,
   publishedAt:s.publishedAt??null});
 }
 const quotes=new Map();
 for(const q of data.quotes){
  const dateOnly=q&&['ust2y','ust10y'].includes(q.key)&&q.observedAt===null&&
   typeof q.observationDate==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(q.observationDate)&&
   Number.isFinite(Date.parse(q.observationDate+'T00:00:00Z'))&&new Date(q.observationDate+'T00:00:00Z').toISOString().slice(0,10)===q.observationDate&&
   q.observationDate<=data.reportDate&&Date.parse(data.reportDate)-Date.parse(q.observationDate)<=4*86400000;
  if(!allowed(q,['key','value','changePct','phase','observedAt','sourceId','observationDate','marketState'])||
   !Object.hasOwn(names,q.key)||quotes.has(q.key)||
   !Number.isFinite(q.value)||q.value<=0||q.value>1e9||
   !(q.changePct===null||(Number.isFinite(q.changePct)&&q.changePct>=-100&&q.changePct<=100))||
   !['close','realtime','indicative'].includes(q.phase)||
   (q.marketState!==undefined&&!['OPEN','CLOSE','DAILY','UNKNOWN'].includes(q.marketState))||
   (q.marketState==='OPEN'&&q.phase==='close')||
   !(dateOnly||(clock(q.observedAt)&&q.observationDate===undefined&&q.observedAt<=collected&&collected-q.observedAt<=96*3600000))||!sourceIds.has(q.sourceId))
   return error('INVALID_QUOTE');
  quotes.set(q.key,{...q});
 }
 if(core.some(k=>!quotes.has(k)||quotes.get(k).phase!=='close'||
  quotes.get(k).changePct===null))return error('US_CLOSE_CORE_INCOMPLETE');
 const sessionDay=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
 if(new Set(core.map(k=>sessionDay(quotes.get(k).observedAt))).size!==1)return error('US_CLOSE_SESSION_MISMATCH');
 const calendar=data.calendar??{us:'UNKNOWN',kr:'UNKNOWN'};
 if(!allowed(calendar,['us','kr'])||!['UNKNOWN','WEEKEND','DECLARED_HOLIDAY'].includes(calendar.us)||!['UNKNOWN','WEEKEND','DECLARED_HOLIDAY'].includes(calendar.kr))return error('INVALID_CALENDAR');
 const sectors=data.sectors??[];
 if(!Array.isArray(sectors)||sectors.length>10||sectors.some(s=>!allowed(s,['name','changePct','up','total','observedAt','sourceId'])||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!Number.isFinite(s.changePct)||Math.abs(s.changePct)>100||s.observedAt!==null||!sourceIds.has(s.sourceId)||!((s.up===null&&s.total===null)||(Number.isInteger(s.up)&&Number.isInteger(s.total)&&s.total>0&&s.up>=0&&s.up<=s.total))))return error('INVALID_SECTOR_SAMPLE');
 const plus=n=>(n>0?'+':'')+n.toFixed(2)+'%';
 const fmt=k=>{
  const q=quotes.get(k),name=names[k][0],unit=names[k][1];
  if(!q)return name+': 미확인';
  return name+': '+q.value.toLocaleString('en-US',{maximumFractionDigits:2})+' '+unit+
   ' · 등락률 '+(q.changePct==null?'미확인':plus(q.changePct))+
   ' · '+(q.phase==='close'?'종가':q.phase==='indicative'?'참고치':'장중 (실시간 검증 전)')+
   ' · '+({OPEN:'공급자 장중 표시',CLOSE:'공급자 마감 표시',DAILY:'일별 통계'}[q.marketState]||'시장 상태 미확인')+
   (q.observedAt===null?' · 일별 관측일 '+q.observationDate+' · 시각 미확인':
   ' · 관측 '+new Date(q.observedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST');
 };
 const refs=keys=>[...new Set(keys.filter(k=>quotes.has(k)).map(k=>quotes.get(k).sourceId))];
 const section=(kind,heading,body,keys)=>({kind,heading,body,sourceIds:refs(keys)});
 const up=core.filter(k=>quotes.get(k).changePct>0).length;
 const down=core.filter(k=>quotes.get(k).changePct<0).length;
 const regime=up===4?'미국 주요 4개 지수 동반 상승':down===4?
  '미국 주요 4개 지수 동반 하락':'미국 주요 4개 지수 혼조';
 const spread=quotes.get('sox').changePct-quotes.get('nasdaq').changePct;
 const sector=spread>=1?'SOX의 나스닥 대비 상대강세를 추가 확인하세요.':
  spread<=-1?'SOX의 나스닥 대비 상대약세를 경계하세요.':
  'SOX와 나스닥의 등락률만으로 반도체 주도력을 확정할 수 없습니다.';
 const calendarText=v=>v==='WEEKEND'?'주말':v==='DECLARED_HOLIDAY'?'휴장으로 제공됨 · 원문 검증 전':'휴장 여부 미확인';
 const sections=[
  section('overview','미국 정규장 핵심 요약',regime+
   '. 제공된 종가 4종의 등락률만으로 분류했으며 한국장 방향을 예측하지 않습니다.',core),
  section('us-market','미국 정규장 종가 (외부 검증 전)',core.map(fmt).join('\n'),core),
  section('futures','주요 미국 선물 (관측시각별)',groups.futures.map(fmt).join('\n'),groups.futures),
  section('rates-fx','금리·환율·변동성',groups.rates.map(fmt).join('\n'),groups.rates),
  section('kr-market','국내 주요 지수',groups.korea.map(fmt).join('\n'),groups.korea),
  section('daytrade','한국장 단기 대응',
   '개장 전 선물·환율·거래대금·상승 종목 비율을 확인하세요. '+sector+
   ' 본 자료는 매매 신호가 아닙니다.',core),
  section('swing','스윙 대응',
   '며칠~2~3주 투자 시 섹터 5·20일 상대강도·거래량·손절 기준을 별도 확인하세요. '+
   '현재 입력에는 해당 데이터가 없어 매수 종목이나 진입가는 제시하지 않습니다.',[]),
  section('risk','미확인 자료·위험',
   'NYSE $TICK은 실제 데이터의 원천 검증 경로가 없어 수치를 표시하지 않습니다. '+
   '미국: '+calendarText(calendar.us)+' · 한국: '+calendarText(calendar.kr)+'. '+
   '개별 휴장일·특별휴장·조기폐장과 원천 시세·출처의 진위는 별도 확인이 필요합니다. '+
   '선물은 공급자의 참고 가격이며 개별 만기·실시간 여부를 검증하지 않았습니다. '+
   '07:00 자동 게시와 ChatGPT 예약 결과의 자동 전달은 활성화되지 않았습니다.',[])
 ];
 if(sectors.length)sections.splice(5,0,{kind:'sectors',heading:'국내 산업 등락 · 수신 표본',
  body:sectors.map(s=>s.name+': '+plus(s.changePct)+' · 상승비율 '+(s.total===null?'미확인':(s.up/s.total*100).toFixed(1)+'%')+' · 관측시각 미확인').join('\n')+
  '\n네이버 업종 분류의 수신 상위 표본이며 미국 개별 산업·전체 테마 분석이 아닙니다.',sourceIds:[...new Set(sectors.map(s=>s.sourceId))]});
 sections.push(section('events','경제 이벤트', '공식 경제·기업 이벤트 자동 수집 미연결 · 뉴스 메뉴의 사용자 일정과 원문을 별도로 확인하세요.',[]));
 const raw={
  schemaVersion:1,date:data.reportDate,origin:'dashboard-pipeline',
  title:'MY INVEST 공개시장 7시 브리핑 (규칙 기반 초안·검증 전)',
  visibility:'public-market-only',timeZone:'Asia/Seoul',scheduleLocal:'07:00',
  generatedAt:now,observedAt:Math.min(...core.map(k=>quotes.get(k).observedAt)),
  retrievedAt:collected,rawText:null,sections,sources
 };
 const report=archive.normalize(raw,{now});
 if(!report.ok)return error('INVALID_OUTPUT_'+report.code);
 const checked=transfer.exportJSON([report.record],{now});
 if(!checked.ok)return error('PUBLIC_ONLY_'+checked.code);
 return {ok:true,record:report.record,missingMetrics:Object.keys(names).filter(k=>!quotes.has(k)),
  ruleBasedNotAI:true,originAuthenticated:false,marketDataVerified:false,
  scheduledDeliveryConfirmed:false,autoPublished:false};
}
const api=Object.freeze({compose,metrics:names});
if(typeof module==='object'&&module.exports)module.exports=api;
else root.MYInvestMorningBriefingComposerV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
