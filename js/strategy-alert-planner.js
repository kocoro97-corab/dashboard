(function(root){'use strict';
/**
 * MY INVEST V2 — read-only risk re-evaluation/notification planner.
 * No fetch, storage, notifications, account access or orders.
 * Caller supplies prior delivered fingerprints (not personal identities).
 */
const DAY=86400000;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const SYMBOL=/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const ALLOWED_KIND=new Set([
 'risk-escalated','risk-appears-resolved','market-direction-changed',
 'market-risk-changed','sector-relative-strength-changed','new-observation',
 'no-longer-observed','review-lane-changed','evidence-need-changed',
 'technical-observation-changed'
]);
const SEVERITY={urgent:0,review:1,informational:2};
const validDate=x=>typeof x==='string'&&DATE.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const age=(now,then)=>(Date.parse(now+'T00:00:00Z')-Date.parse(then+'T00:00:00Z'))/DAY;
const validSymbol=s=>s===null||(typeof s==='string'&&SYMBOL.test(s));
const clean=s=>typeof s==='string'?s.replace(/[\x00-\x1f]/g,' ').trim().slice(0,120):'';
const safeTokens=list=>Array.isArray(list)?[...new Set(list.filter(x=>typeof x==='string'&&/^[a-z][a-z0-9-]{1,39}$/.test(x)))].slice(0,30):[];
function signal(change){
 if(!change||!ALLOWED_KIND.has(change.kind)||!validSymbol(change.symbol??null)||
  ![null,'candidate','holding'].includes(change.intent??null))return null;
 const symbol=change.symbol??null,intent=change.intent??null,kind=change.kind;
 if(symbol===null&&intent!==null||symbol!==null&&intent===null)return null;
 if(['market-direction-changed','market-risk-changed','sector-relative-strength-changed'].includes(kind)&&symbol!==null)return null;
 if(!['market-direction-changed','market-risk-changed','sector-relative-strength-changed'].includes(kind)&&symbol===null)return null;
 if(kind==='risk-escalated'&&change.status!=='warning')return null;
 if(kind==='market-risk-changed'&&!['high','elevated','reference-low','unknown'].includes(change.to))return null;
 if(kind==='market-direction-changed'&&!['up','down','mixed'].includes(change.to))return null;
 if(kind==='sector-relative-strength-changed'&&
  (typeof change.sectorId!=='string'||!/^[A-Za-z0-9^._=-]{1,35}$/.test(change.sectorId)||
   typeof change.delta5dPp!=='number'||!Number.isFinite(change.delta5dPp)))return null;
 let severity='informational',category='change',why='관측된 분석 상태 변화';
 if(kind==='risk-escalated'){severity='urgent';category='risk';why='종목에 새로운 위험 차단조건 발생'}
 if(kind==='market-risk-changed'){
  const to=change.to,from=change.from;
  const prior=['reference-low','elevated','high'];
  const increased=prior.includes(from)&&prior.includes(to)&&prior.indexOf(to)>prior.indexOf(from);
  severity=increased?'urgent':'review';
  category='macro';why=increased?'시장 변동성 위험 구간 상승':'시장 변동성 기준 변화 · 원천 확인';
 }
 if(kind==='market-direction-changed'){
  severity=change.to==='down'?'review':'informational';category='macro';why='시장 일일 방향 관측 변화';
 }
 if(kind==='sector-relative-strength-changed'){
  severity=change.delta5dPp<=-0.5?'review':'informational';
  category='sector';why=change.delta5dPp<0?'산업 상대강도 하락 관측':'산업 상대강도 개선 관측';
 }
 if(kind==='risk-appears-resolved'){severity='review';category='risk';why='이전 위험의 실제 해소 근거 재확인 필요'}
 if(kind==='no-longer-observed'){severity='review';category='coverage';why='현재 결과에서 종목 미관측 · 청산 신호 아님'}
 if(kind==='evidence-need-changed'){severity=change.status==='requires-context'?'review':'informational';category='coverage';why='종목별 필수 데이터 변화'}
 if(kind==='review-lane-changed'){severity='review';category='watch';why='종목 검토 분류 변화'}
 if(kind==='new-observation'){category='watch';why='분석 결과에 종목 신규 등장 · 매수 신호 아님'}
 if(kind==='technical-observation-changed'){category='watch';why='종목 기술적 조건 변경'}
 const blocking=kind==='risk-escalated'?safeTokens(change.newBlocking):[];
 return {kind,symbol,intent,severity,category,why,
  blocking,sectorId:kind==='sector-relative-strength-changed'?change.sectorId:null,
  delta5dPp:kind==='sector-relative-strength-changed'?Math.round(change.delta5dPp*10000)/10000:null};
}
function hash(s){
 // Deterministic, non-cryptographic event fingerprint; not authentication.
 let x=2166136261>>>0;
 for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619)>>>0}
 return x.toString(16).padStart(8,'0');
}
function fingerprint(scope,signal){
 const basis=[scope.market,scope.mode,scope.currentDay,
  signal.intent||'market',signal.symbol||'all',signal.kind,signal.severity,
  signal.sectorId||'',...signal.blocking].join('|');
 return 'mi-v1-'+hash(basis);
}
function validHistory(delivered,today){
 if(!Array.isArray(delivered)||delivered.length>2000)return null;
 const out=new Map();
 for(const item of delivered){
  if(!item||typeof item.id!=='string'||!/^mi-v1-[a-f0-9]{8}$/.test(item.id)||
   !validDate(item.day)||age(today,item.day)<0||age(today,item.day)>30)return null;
  const prev=out.get(item.id);
  if(!prev||prev<item.day)out.set(item.id,item.day);
 }
 return out;
}
function plan({comparison,delivered=[],today,allowNotifications=false,maxAlerts=50}={}){
 if(!validDate(today)||!Number.isSafeInteger(maxAlerts)||maxAlerts<1||maxAlerts>100||
  typeof allowNotifications!=='boolean')throw Error('ALERT_PLAN_INPUT_INVALID');
 if(!comparison||comparison.schemaVersion!==1||!['comparable','partial'].includes(comparison.status)||
  !['KR','US'].includes(comparison.market)||!['day','swing'].includes(comparison.mode)||
  !validDate(comparison.currentDay)||!validDate(comparison.previousDay)||
  comparison.previousDay>=comparison.currentDay||comparison.currentDay>today||
  age(today,comparison.currentDay)>10||!Array.isArray(comparison.changes)||
  comparison.changes.length>700||!Array.isArray(comparison.sourceChanges)||
  !comparison.coverage||typeof comparison.coverage.currentVerified!=='boolean')
  return {status:'unavailable',reason:'검증된 변화 추적 자료 없음',alerts:[],recheck:[]};
 const history=validHistory(delivered,today);
 if(!history)return {status:'unavailable',reason:'발송 이력 식별자·기간 오류',alerts:[],recheck:[]};
 const available=comparison.status==='comparable'&&comparison.coverage.currentVerified===true;
 const pending=new Map(),suppressed=[];
 for(const raw of comparison.changes){
  const s=signal(raw);if(!s)continue;
  // Warnings seen in partially covered data must remain visible.
  // Risk-cleared and improvement observations cannot be interpreted as safe.
  if(!available&&(s.kind==='risk-appears-resolved'||
   s.kind==='sector-relative-strength-changed'&&s.delta5dPp>0||
   s.kind==='market-risk-changed'&&s.severity!=='urgent')){
   suppressed.push({kind:s.kind,reason:'불완전한 원천으로 개선/위험 해소 판단 보류'});
   continue;
  }
  const id=fingerprint(comparison,s);
  const item={id,day:comparison.currentDay,market:comparison.market,mode:comparison.mode,
   symbol:s.symbol,intent:s.intent,kind:s.kind,category:s.category,severity:s.severity,
   reason:s.why,requiresManualReview:true,blocking:s.blocking,
   sectorId:s.sectorId,delta5dPp:s.delta5dPp,
   eligibleForNotification:allowNotifications&&available&&s.severity==='urgent',
   label:'검토 알림 후보 · 매수/매도/주문 신호가 아님'};
  if(history.has(id)){suppressed.push({id,kind:s.kind,reason:'동일 날짜·변화의 기존 처리 이력'});continue}
  const key=[s.intent||'market',s.symbol||'all',s.kind].join('|');
  const existing=pending.get(key);
  if(!existing||SEVERITY[item.severity]<SEVERITY[existing.severity])pending.set(key,item);
 }
 // Source coverage degradation is always a review task but not an urgent
 // push notification. Do not infer that absent events imply no risks.
 for(const row of comparison.sourceChanges){
  if(!row||!['market','sector','stock','event'].includes(row.component)||
   !['degraded','changed','recovered'].includes(row.direction))continue;
  if(row.direction==='recovered'&&!available)continue;
  const key='source|'+row.component;
  pending.set(key,{id:'mi-v1-'+hash([comparison.market,comparison.mode,comparison.currentDay,key,row.direction].join('|')),
   day:comparison.currentDay,market:comparison.market,mode:comparison.mode,symbol:null,intent:null,
   kind:'source-'+row.direction,category:'coverage',severity:row.direction==='degraded'?'review':'informational',
   reason:'공식 데이터 '+row.component+' 수집 상태 '+(row.direction==='degraded'?'악화':'변화'),
   requiresManualReview:true,eligibleForNotification:false,label:'데이터 원천 재검증 요청'});
 }
 const alerts=[...pending.values()].filter(x=>!history.has(x.id)).sort((a,b)=>
  SEVERITY[a.severity]-SEVERITY[b.severity]||
  (a.intent==='holding'?0:a.intent==='candidate'?1:2)-(b.intent==='holding'?0:b.intent==='candidate'?1:2)||
  String(a.symbol||'').localeCompare(String(b.symbol||''))||a.kind.localeCompare(b.kind));
 const items=alerts.slice(0,maxAlerts);
 const recheck=Array.isArray(comparison.recheck)?comparison.recheck.slice(0,100).map(x=>({
  symbol:typeof x?.symbol==='string'&&SYMBOL.test(x.symbol)?x.symbol:null,
  intent:['candidate','holding'].includes(x?.intent)?x.intent:null,reason:clean(x?.reason)||'근거 재점검'
 })):[];
 return {schemaVersion:1,status:available?'ready':'partial',market:comparison.market,mode:comparison.mode,
  evaluatedOn:today,sourceDay:comparison.currentDay,alerts:items,suppressed,
  truncated:alerts.length>maxAlerts,recheck,
  delivery:{executed:false,enabled:allowNotifications,eligible:items.filter(x=>x.eligibleForNotification).length,
   note:'알림 전송 미구현 · 별도 명시적 사용자 선택·전송 채널 및 수신 권한 검증 필요'},
  note:'검증된 근거에 따른 수동 재평가 요청 · 자동 거래/성과 예측/발송 아님'};
}
const api=Object.freeze({plan,signal,fingerprint,validHistory});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestStrategyAlertPlanner=api;
})(globalThis);
