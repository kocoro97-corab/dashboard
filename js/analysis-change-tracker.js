(function(root){'use strict';
/* MY INVEST V2 — analysis change / re-evaluation planner.
 * Pure comparison of public, allowlisted analysis summaries.
 * No order, no fetch, no persistence, no private portfolio fields.
 */
const dateRE=/^\d{4}-\d{2}-\d{2}$/;
const symbolRE=/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/;
const lanes=new Set(['risk-review','needs-evidence','technical-watch','monitor']);
const parts=['market','sector','stock','event'];
const states=new Set(['usable','missing','stale','partial','invalid','failed']);
const validDate=d=>typeof d==='string'&&dateRE.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const trim=s=>typeof s==='string'?s.replace(/[\x00-\x1f]/g,' ').trim().slice(0,110):'';
const age=(today,d)=>(Date.parse(today+'T00:00:00Z')-Date.parse(d+'T00:00:00Z'))/86400000;
function cleanQueueItem(item,day){
 if(!item||typeof item!=='object'||!symbolRE.test(item.symbol||'')||!['KR','US'].includes(item.market)||
  (item.market==='KR')!==/^\d{6}$/.test(item.symbol)||!['candidate','holding'].includes(item.intent)||
  !['day','swing'].includes(item.mode)||!validDate(item.asOf)||age(day,item.asOf)<0||age(day,item.asOf)>10||
  !lanes.has(item.reviewLane)||typeof item.blocked!=='boolean'||typeof item.requiresEvidence!=='boolean')
  return null;
 const blocking=Array.isArray(item.blocking)?item.blocking.map(trim).filter(Boolean):[];
 // Unknown future blocker is never silently cleared.
 const unsafe=blocking.some(x=>x==='market-high-risk'||x==='event-near');
 if(unsafe&&!item.blocked)return null;
 return {symbol:item.symbol,market:item.market,intent:item.intent,mode:item.mode,asOf:item.asOf,
  lane:item.reviewLane,blocked:item.blocked,requiresEvidence:item.requiresEvidence,
  blocking:[...new Set(blocking)].slice(0,30),
  observedTechnicalCondition:item.observedTechnicalCondition===true};
}
function auditBrief(a){
 if(!a||a.schemaVersion!==1||!['US','KR'].includes(a.market)||!['day','swing'].includes(a.mode)||
  !validDate(a.nowDay)||!['ready','incomplete','invalid'].includes(a.status)||!Array.isArray(a.evidence))
  return null;
 const map={};for(const c of a.evidence){
  if(!c||!parts.includes(c.component)||!states.has(c.status)||map[c.component])return null;
  map[c.component]=c.status;
 }
 if(parts.some(k=>!map[k]))return null;
 return {market:a.market,mode:a.mode,day:a.nowDay,status:a.status,
  canPresentAsVerified:a.canPresentAsVerified===true&&parts.every(k=>map[k]==='usable'),
  sources:map};
}
function publicSignals(input,scopeDay){
 if(input==null)return {status:'missing'};
 if(typeof input!=='object'||input.asOf!==scopeDay||input.verified!==true)
  return {status:'unavailable'};
 const market=input.market,sector=input.sector;
 if(!market||!sector||!['up','down','mixed'].includes(market.direction)||
   !['high','elevated','reference-low','unknown'].includes(market.risk)||
   typeof sector.id!=='string'||!/^[A-Za-z0-9^._=-]{1,35}$/.test(sector.id)||
   !finiteNumber(sector.relative5dPp)||!finiteNumber(sector.relative20dPp))
  return {status:'unavailable'};
 return {status:'ready',market:{direction:market.direction,risk:market.risk},
   sector:{id:sector.id,relative5dPp:sector.relative5dPp,relative20dPp:sector.relative20dPp}};
}
function finiteNumber(v){return typeof v==='number'&&Number.isFinite(v)}
function verify(s,day){
 if(!s||s.schemaVersion!==1||!validDate(s.day)||s.day>day||
  !['US','KR'].includes(s.market)||!['day','swing'].includes(s.mode)||
  !Array.isArray(s.candidates)||!Array.isArray(s.holdings)||s.candidates.length>300||s.holdings.length>300)
  throw Error('CHANGE_SNAPSHOT_INVALID');
 const audit=auditBrief(s.audit);
 if(!audit||audit.market!==s.market||audit.mode!==s.mode||audit.day!==s.day)return {ok:false,reason:'근거 감사 범위 불일치'};
 const all=[],ids=new Set();
 for(const [intent,list] of [['candidate',s.candidates],['holding',s.holdings]]){
  for(const raw of list){
   const item=cleanQueueItem(raw,day);
   if(!item||item.intent!==intent||item.mode!==s.mode||item.market!==s.market)return {ok:false,reason:'종목 검토 데이터 검증 실패'};
   const key=intent+'|'+item.symbol;if(ids.has(key))return {ok:false,reason:'종목 중복 검토 결과'};
   ids.add(key);all.push(item);
  }
 }
 return {ok:true,audit,items:all,signals:publicSignals(s.signals,s.day)};
}
function compare({previous,current,today}={}){
 if(!validDate(today))throw Error('CHANGE_DATE_REQUIRED');
 let prev,cur;
 try{prev=verify(previous,today);cur=verify(current,today)}catch{return {status:'unavailable',reason:'분석 스냅샷 스키마 오류',changes:[],recheck:[]}}
 if(!prev.ok||!cur.ok)return {status:'unavailable',reason:prev.reason||cur.reason,changes:[],recheck:[]};
 if(prev.audit.market!==cur.audit.market||prev.audit.mode!==cur.audit.mode||previous.day>=current.day||
  age(today,current.day)>10||age(today,previous.day)>30)
  return {status:'unavailable',reason:'시장·투자기간·기준일 불일치 또는 과거 기록 만료',changes:[],recheck:[]};
 const changes=[],recheck=[],before=new Map(prev.items.map(x=>[x.intent+'|'+x.symbol,x]));
 const signalsComparable=prev.signals.status==='ready'&&cur.signals.status==='ready'&&
   prev.audit.canPresentAsVerified&&cur.audit.canPresentAsVerified;
 if(signalsComparable){
  const pm=prev.signals.market,cm=cur.signals.market;
  if(pm.direction!==cm.direction){
   changes.push({kind:'market-direction-changed',symbol:null,intent:null,status:'observed',
    from:pm.direction,to:cm.direction,label:'시장 일일 방향 관측 변화 · 추세 예측 아님'});
   recheck.push({symbol:null,intent:null,reason:'시장 국면 재점검'});
  }
  if(pm.risk!==cm.risk){
   const increased=(cm.risk==='high'&&pm.risk!=='high')||
     (cm.risk==='elevated'&&pm.risk==='reference-low');
   changes.push({kind:'market-risk-changed',symbol:null,intent:null,
    status:increased?'warning':'requires-context',from:pm.risk,to:cm.risk,
    label:increased?'시장 위험 지표 구간 상승':'시장 위험 지표 구간 변화 · 재확인'});
   recheck.push({symbol:null,intent:null,reason:'시장 위험 근거 재평가'});
  }
  const ps=prev.signals.sector,cs=cur.signals.sector;
  if(ps.id===cs.id){
   const relativeChange=cs.relative5dPp-ps.relative5dPp;
   if(Math.abs(relativeChange)>=0.5){
    changes.push({kind:'sector-relative-strength-changed',symbol:null,intent:null,
     status:'observed',sectorId:cs.id,delta5dPp:Math.round(relativeChange*10000)/10000,
     label:relativeChange<0?'산업 5일 상대강도 약화 관측':'산업 5일 상대강도 개선 관측'});
    recheck.push({symbol:null,intent:null,reason:'산업 상대강도 변화 점검'});
   }
  }else recheck.push({symbol:null,intent:null,reason:'비교 산업 식별자 변경 · 강도 직접 비교 불가'});
 }else if(prev.signals.status!=='missing'||cur.signals.status!=='missing'){
  recheck.push({symbol:null,intent:null,reason:'시장·산업 변화 비교를 위한 검증된 동일 기준일 근거 부족'});
 }
 const after=new Map(cur.items.map(x=>[x.intent+'|'+x.symbol,x]));
 // Coverage must be compared BEFORE interpreting new/absent items.
 const sourceChanges=[];
 for(const key of parts){
  const old=prev.audit.sources[key],next=cur.audit.sources[key];
  if(old!==next)sourceChanges.push({component:key,from:old,to:next,
   direction:next==='usable'?'recovered':old==='usable'?'degraded':'changed'});
 }
 for(const [key,item] of after){
  const old=before.get(key);
  if(!old){
   changes.push({kind:'new-observation',symbol:item.symbol,intent:item.intent,
    status:'requires-context',label:'분석 대상 신규 관측 · 신규 투자기회 확정 아님'});
   recheck.push({symbol:item.symbol,intent:item.intent,reason:'이전 분석 없음 · 최초 검증'});
   continue;
  }
  const newlyBlocked=item.blocking.filter(b=>!old.blocking.includes(b));
  const cleared=old.blocking.filter(b=>!item.blocking.includes(b));
  if(!old.blocked&&item.blocked||newlyBlocked.some(x=>x==='market-high-risk'||x==='event-near')){
   changes.push({kind:'risk-escalated',symbol:item.symbol,intent:item.intent,
    status:'warning',label:'새로운 위험 경고 발생',newBlocking:newlyBlocked});
   recheck.push({symbol:item.symbol,intent:item.intent,reason:'새로운 위험 경고 우선 점검'});
  }else if(old.blocked&&!item.blocked&&cur.audit.canPresentAsVerified){
   changes.push({kind:'risk-appears-resolved',symbol:item.symbol,intent:item.intent,
    status:'requires-context',label:'이전 위험 경고 해제 여부 재확인'});
   recheck.push({symbol:item.symbol,intent:item.intent,reason:'위험 해소 근거 확인 필요'});
  }
  if(old.blocked&&!item.blocked&&!cur.audit.canPresentAsVerified)
   recheck.push({symbol:item.symbol,intent:item.intent,reason:'일부 근거 미연결 · 이전 위험 해소 미확정'});
  if(old.lane!==item.lane){
   changes.push({kind:'review-lane-changed',symbol:item.symbol,intent:item.intent,
    status:'observed',from:old.lane,to:item.lane,label:'검토 분류 변화 · 기대수익률 변화 아님'});
  }
  if(old.requiresEvidence!==item.requiresEvidence){
   changes.push({kind:'evidence-need-changed',symbol:item.symbol,intent:item.intent,
    status:item.requiresEvidence?'requires-context':'observed',
    label:item.requiresEvidence?'필수 근거 확인 필요':'기존 근거 부족 항목 재평가'});
  }
  if(old.observedTechnicalCondition!==item.observedTechnicalCondition){
   changes.push({kind:'technical-observation-changed',symbol:item.symbol,intent:item.intent,
    status:'observed',label:'기술적 관찰조건 변화 · 매매 신호 아님'});
  }
  if(item.asOf===old.asOf&&!newlyBlocked.length&&!cleared.length&&
    (old.lane!==item.lane||old.observedTechnicalCondition!==item.observedTechnicalCondition))
   recheck.push({symbol:item.symbol,intent:item.intent,reason:'동일 종가 기준 결과 차이 · 계산/원천 확인'});
 }
 for(const [key,item] of before){
  if(after.has(key))continue;
  changes.push({kind:'no-longer-observed',symbol:item.symbol,intent:item.intent,status:'unknown',
   label:'현재 후보 목록에서 미관측 · 매도 또는 기회 종료 의미 아님'});
  recheck.push({symbol:item.symbol,intent:item.intent,reason:'분석 제외 사유·커버리지 확인'});
 }
 const snapshotTrusted=prev.audit.canPresentAsVerified&&cur.audit.canPresentAsVerified;
 const sourceDegraded=sourceChanges.some(x=>x.direction==='degraded');
 if(!snapshotTrusted||sourceDegraded){
  recheck.push({symbol:null,intent:null,reason:'시장·산업·종목·일정 근거 재검증 필요'});
 }
 // Priority is an examination sequence; never a trading/return score.
 const order={warning:0,'requires-context':1,observed:2,unknown:3};
 changes.sort((a,b)=>(order[a.status]??4)-(order[b.status]??4)||
  String(a.intent||'').localeCompare(String(b.intent||''))||String(a.symbol||'').localeCompare(String(b.symbol||''))||a.kind.localeCompare(b.kind));
 const unique=new Map(recheck.map(r=>[(r.intent||'all')+'|'+(r.symbol||'all')+'|'+r.reason,r]));
 return {schemaVersion:1,status:snapshotTrusted?'comparable':'partial',
  market:cur.audit.market,mode:cur.audit.mode,
  previousDay:previous.day,currentDay:current.day,evaluatedOn:today,
  sourceChanges,changes,recheck:[...unique.values()],
  coverage:{previousVerified:prev.audit.canPresentAsVerified,currentVerified:cur.audit.canPresentAsVerified,
   previousCount:prev.items.length,currentCount:cur.items.length},
  warnings:['변화는 관측된 검토 상태의 비교이며 투자성과·매수·매도 판단이 아님',
   '자료 누락으로 사라진 종목은 투자 기회 소멸 또는 청산 신호가 아님',
   '개인 계좌번호·평단·수량·토큰을 저장하거나 출력하지 않음']};
}
const api=Object.freeze({compare,verify,cleanQueueItem,auditBrief});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestAnalysisChangeTracker=api;
})(globalThis);
