(function(root){'use strict';
/* Assemble transient, ALLOWLISTED comparison snapshots from existing
 * validated analysis outputs. No persistence, fetch, portfolio or orders.
 */
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const validDate=s=>typeof s==='string'&&DATE.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const sources=['market','sector','stock','event'];
const safeSymbol=s=>typeof s==='string'&&/^(?:\d{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(s);
function make({audit,queue,regime=null,sector=null,day=null}={}){
 if(!audit||!queue||audit.schemaVersion!==1||queue.schemaVersion!==1||
 !['KR','US'].includes(audit.market)||!['day','swing'].includes(audit.mode)||
 !validDate(day)||audit.nowDay!==day||queue.evaluatedOn!==day||queue.mode!==audit.mode)
 return {status:'unavailable',reason:'분석 결과·거래일 입력 불일치'};
 const coverage=Array.isArray(audit.evidence)?audit.evidence:[];
 if(coverage.length!==4||sources.some(name=>coverage.filter(x=>x.component===name).length!==1))
 return {status:'unavailable',reason:'근거 커버리지 불완전'};
 if(!Array.isArray(queue.candidateQueue?.items)||!Array.isArray(queue.holdingQueue?.items))
 return {status:'unavailable',reason:'후보/보유 결과 미확인'};
 const validated=(items,intent)=>{
  const out=[];
  for(const row of items){
   if(!row||!safeSymbol(row.symbol)||row.market!==audit.market||row.intent!==intent||
    row.mode!==audit.mode||!validDate(row.asOf)||!['risk-review','needs-evidence','technical-watch','monitor'].includes(row.reviewLane)||
    typeof row.blocked!=='boolean'||typeof row.requiresEvidence!=='boolean')return null;
   out.push({symbol:row.symbol,market:row.market,intent,mode:row.mode,
    asOf:row.asOf,reviewLane:row.reviewLane,blocked:row.blocked,
    requiresEvidence:row.requiresEvidence,
    observedTechnicalCondition:row.observedTechnicalCondition===true,
    blocking:Array.isArray(row.blocking)?row.blocking.filter(x=>typeof x==='string').slice(0,30):[]});
  }
  return out;
 };
 const candidates=validated(queue.candidateQueue.items,'candidate'),holdings=validated(queue.holdingQueue.items,'holding');
 if(!candidates||!holdings)return {status:'unavailable',reason:'출처별 종목 검토 상태 불일치'};
 const out={schemaVersion:1,market:audit.market,mode:audit.mode,day,
  audit:{schemaVersion:1,market:audit.market,mode:audit.mode,nowDay:day,status:audit.status,
   canPresentAsVerified:audit.canPresentAsVerified===true,
   evidence:coverage.map(x=>({component:x.component,status:x.status}))},
  candidates,holdings};
 // Market/sector comparison is optional and only compiled from validated
 // matching session data; no hidden inference from a queue lane.
 const marketValid=regime?.status==='descriptive'&&regime.region===audit.market&&
   ['up','down','mixed'].includes(regime.direction?.state)&&
   ['high','elevated','reference-low','unknown'].includes(regime.risk?.level)&&
   Array.isArray(regime.evidence)&&regime.evidence.length>=2&&
   regime.evidence.every(x=>x?.referenceDay===day);
 const sectorValid=sector?.status==='descriptive'&&sector.market===audit.market&&
  sector.asOf===day&&sector.rotation?.status==='descriptive'&&
  typeof sector.id==='string'&&Number.isFinite(sector.rotation.relative5dPp)&&Number.isFinite(sector.rotation.relative20dPp);
 if(marketValid&&sectorValid){
  out.signals={verified:true,asOf:day,market:{direction:regime.direction.state,risk:regime.risk.level},
   sector:{id:sector.id,relative5dPp:sector.rotation.relative5dPp,relative20dPp:sector.rotation.relative20dPp}};
 }
 return {status:'ready',snapshot:out,
  note:'공개 분석 근거/검토 상태만 비교 · 보유 수량·평단·계좌번호·토큰 출력 금지'};
}
const api=Object.freeze({make});
if(typeof module==='object'&&module.exports)module.exports=api;else root.MYInvestChangeSnapshotAdapter=api;
})(globalThis);
