(function(root){'use strict';
/**
 * Public event-context -> integrated strategy DTO.
 * Pure adapter: NO data fetch, NO private calendar, NO accounts.
 * Absence of a provider snapshot is NOT a verified absence of events.
 */
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function eventsFromPublicContext(report,{symbol,market,asOf,mode='swing'}={}){
 if(!validDay(asOf)||!['KR','US'].includes(market)||typeof symbol!=='string'||!['day','swing'].includes(mode))
  return {status:'unavailable',coverageVerified:false,events:[],reason:'이벤트 연결 입력 검증 실패'};
 if(!report||!report.coverage||!Array.isArray(report.events))
  return {status:'unavailable',coverageVerified:false,events:[],reason:'공식 일정 캐시 미연결'};
 const required=['BLS','BEA','BOK_STAT','EARNINGS','FED','BOK_MPC'];
 // A missing unrelated foreign provider is conservatively still flagged.
 const missing=required.filter(provider=>report.coverage[provider]!==true);
 const events=[],seen=new Set();
 for(const item of report.events){
  if(!item||!validDay(item.date)||!item.sourceUrl||typeof item.sourceUrl!=='string'||
   !/^https:\/\//.test(item.sourceUrl)||!['macro','policy','earnings'].includes(item.category)||
   !['BLS','BEA','BOK','FED','EARNINGS'].includes(item.publisher))continue;
  if(item.dateStatus==='estimated'||item.category==='earnings'&&item.dateStatus!=='confirmed')continue;
  if(item.category==='earnings'&&(item.symbol!==symbol||item.market!==market))continue;
  const kind=item.category==='earnings'?'earnings':'economic';
  if(item.verified!==true)continue;
  const key=kind+'|'+item.publisher+'|'+item.type+'|'+(item.symbol||'')+'|'+item.date;
  if(seen.has(key))continue;
  seen.add(key);events.push({kind,date:item.date,type:String(item.type||'').slice(0,50),
   verified:true,dateStatus:'confirmed',
   symbol:kind==='earnings'?item.symbol:null,market:kind==='earnings'?item.market:null});
 }
 return {status:missing.length?'partial':'ready',coverageVerified:missing.length===0,
  missingSources:missing,events:events.slice(0,100),
  scope:'공식 경제·기업 발표 일정만 포함 · 미수집 일정은 별도 확인'};
}
const api=Object.freeze({eventsFromPublicContext});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestIntegratedEventAdapter=api;
})(globalThis);
