(function(root){
'use strict';
// Read-only strategy planner. Manual inputs are scenarios, never live quotes or orders.
const KEY='myinvest_strategy_selection_v2';
const valid=s=>/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(s);
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const button=(text,fn)=>{const e=make('button',text);e.type='button';e.addEventListener('click',fn);return e};
const fmt=n=>Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2}):'미확인';
function readSelection(){const shared=root.InvestWorkflow?.current();if(shared)return shared;try{const x=JSON.parse(sessionStorage.getItem(KEY)||'null');return x&&valid(x.symbol)&&Number.isFinite(x.at)&&Date.now()-x.at<3600000?x:null}catch{return null}}
function plan({capital,riskPct,entry,stop,target,allocation}){
 if(![capital,riskPct,entry,stop,target,allocation].every(Number.isFinite)||capital<=0||riskPct<=0||riskPct>10||entry<=0||stop<=0||target<=0||allocation<=0||allocation>100)return {error:'입력값을 확인하세요. 투자금은 양수, 위험허용은 0~10%, 배분은 0~100% 범위입니다.'};
 if(!(stop<entry&&entry<target))return {error:'롱 포지션 기준 손절가 < 진입가 < 목표가 조건을 만족해야 합니다.'};
 const risk=capital*riskPct/100,perShare=entry-stop,unitByRisk=Math.floor(risk/perShare),unitByCapital=Math.floor(capital*allocation/100/entry),units=Math.min(unitByRisk,unitByCapital);
 if(!Number.isSafeInteger(units)||units<0)return {error:'수량을 안전하게 계산할 수 없습니다. 입력 규모를 확인하세요.'};
 return {risk,perShare,units,invested:units*entry,loss:units*perShare,gain:units*(target-entry),rr:(target-entry)/perShare,breakEven:null,unitByRisk,unitByCapital};
}
function create(){
 const legacy=DashboardPages.legacy({ids:['strategySection'],intro:'기존 규칙 기반 시장 시나리오 · 실제 주문 없음',refresh(){generateScenario()}});
 let view,head,output,holdingPanel,conditional,selector=null,unsubscribe=null,requestVersion=0,latestData=null,lastSelectionKey='',inputs={},mode='swing',active=false,ctxRef=null;
 let compareDisclosure=null,compareHost=null,compareInstance=null;

 const css='.str4{margin-bottom:18px;color:inherit}.str4 button{cursor:pointer}.str4-nav,.str4-modes{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.str4-nav button,.str4-modes button{border:1px solid #465775;background:#172238;color:#e7eef9;border-radius:7px;padding:8px 12px}.str4-modes button[aria-pressed="true"]{background:#264365;border-color:#72b5ff}.str4-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.str4-field{display:flex;flex-direction:column;gap:5px;padding:10px;border:1px solid #344158;border-radius:9px;background:#172238;color:#e7eef9}.str4-field input{min-width:0;padding:9px;border-radius:6px;border:1px solid #52637c;background:#101a2a;color:#fff}.str4-output{padding:12px;border:1px solid #465775;border-radius:9px;margin-top:12px}.str4-muted{font-size:12px;color:#b6c5d9}.str4-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.str4-cards div{padding:10px;border-radius:8px;background:#172238;color:#e7eef9}.str4-cards strong{display:block;font-size:17px;margin-top:5px}@media(max-width:550px){.str4-grid,.str4-cards{grid-template-columns:1fr}}';
 const field=(label,key,initial,step)=>{const wrap=make('label',undefined,'str4-field');wrap.append(make('span',label));const input=make('input');input.type='number';input.min='0';input.step=step;input.inputMode='decimal';input.value=initial;input.addEventListener('input',calculate);inputs[key]=input;wrap.append(input);return wrap};
 const num=k=>inputs[k].value.trim()===''?NaN:Number(inputs[k].value);
 function calculate(){if(!active)return;output.replaceChildren();renderHolding();const p=plan({capital:num('capital'),riskPct:num('riskPct'),entry:num('entry'),stop:num('stop'),target:num('target'),allocation:num('allocation')});if(p.error){output.append(make('p',p.error));return}
 const cards=make('div',undefined,'str4-cards');for(const [label,value] of [['계획 수량',fmt(p.units)+'주'],['투입 예정금',fmt(p.invested)],['손절 시 예상손실',fmt(p.loss)],['목표 시 예상이익',fmt(p.gain)],['손익비',p.rr.toFixed(2)+':1'],['설정 위험한도',fmt(p.risk)]]){const card=make('div');card.append(make('small',label),make('strong',value));cards.append(card)}output.append(cards);
 output.append(make('p',p.units===0?'현재 위험한도 또는 배분금으로 매수 가능한 수량이 없습니다.':'수량 제한: 손실한도 기준 '+fmt(p.unitByRisk)+'주 / 투자금 배분 기준 '+fmt(p.unitByCapital)+'주 중 작은 값 적용','str4-muted'));
 output.append(make('p','계산은 롱 포지션·단일 통화·정수 주식·수수료/세금/슬리피지/갭 하락 제외한 가상 시나리오입니다. 실제 손실은 손절 기준을 초과할 수 있습니다.','str4-muted'));
 }
 function renderHolding(){if(!active||!holdingPanel)return;holdingPanel.replaceChildren();const selection=readSelection();if(!selection){holdingPanel.append(make('p','종목을 선택하면 계좌별 평균매입가를 확인합니다.','str4-muted'));return}let snap;try{snap=ctxRef?.snapshot()}catch{}if(!snap||!Array.isArray(snap.details)||!Array.isArray(snap.result?.rows)||snap.details.length!==snap.result.rows.length){holdingPanel.append(make('p','계좌별 자료 미수신','str4-muted'));return}const market=/^\d{6}$/.test(selection.symbol)?'domestic':'overseas',entry=num('entry'),stop=num('stop'),target=num('target');let count=0,excluded=0;holdingPanel.append(make('h3','계좌별 보유 전략 · '+selection.symbol));for(let i=0;i<snap.details.length;i++){const h=snap.details[i],a=snap.result.rows[i];if(String(h?.code||'').trim().toUpperCase()!==selection.symbol)continue;if(h.market!==market||h.draft||!a?.identity||a.issues?.includes('IDENTITY_UNKNOWN')||!Number.isFinite(h.avgPrice)||h.avgPrice<=0||!Number.isFinite(h.quantity)||h.quantity<=0||!((market==='domestic'&&h.currency==='KRW')||(market==='overseas'&&typeof h.currency==='string'&&/^[A-Z]{3}$/.test(h.currency)&&h.currency!=='KRW'))){excluded++;continue}count++;const card=make('section',undefined,'str4-field');card.append(make('strong',(h.broker||'증권사 미확인')+' · '+(h.accountLabel||'계좌명 미확인')),make('p','보유 '+fmt(h.quantity)+'주 · 평균매입가 '+fmt(h.avgPrice)+' '+h.currency));if(Number.isFinite(a.returnPct))card.append(make('p','계좌 평가 기준 수익률 '+a.returnPct.toFixed(2)+'%'));if((!latestData||root.InvestWorkflow.compatible(h,latestData.exchange))&&Number.isFinite(entry)&&entry>0)card.append(make('p','가정 진입가 기준 수익률 '+((entry/h.avgPrice-1)*100).toFixed(2)+'% · 손익 '+fmt((entry-h.avgPrice)*h.quantity)+' '+h.currency));if((!latestData||root.InvestWorkflow.compatible(h,latestData.exchange))&&Number.isFinite(stop)&&stop>0)card.append(make('p','손절가 시 매입원가 대비 손익 '+fmt((stop-h.avgPrice)*h.quantity)+' '+h.currency));if((!latestData||root.InvestWorkflow.compatible(h,latestData.exchange))&&Number.isFinite(target)&&target>0)card.append(make('p','목표가 시 매입원가 대비 손익 '+fmt((target-h.avgPrice)*h.quantity)+' '+h.currency));holdingPanel.append(card)}if(!count)holdingPanel.append(make('p','검증된 계좌별 보유정보 미확인 · 미보유를 의미하지 않습니다.','str4-muted'));if(excluded)holdingPanel.append(make('p','미검증 보유 행 '+excluded+'건은 분석에서 제외했습니다.','str4-muted'));holdingPanel.append(make('p','기존 보유 수량과 신규 매수 계획은 별개입니다. 가정 가격은 실제 현재가가 아니며 수수료·세금·환율·갭 위험은 제외됩니다.','str4-muted'))}
 function renderHeader(){head.replaceChildren();const s=readSelection();if(s){mode=s.mode==='day'?'day':'swing';head.append(make('h3','선택 종목: '+(s.name||s.symbol)+' ('+s.symbol+')'),make('p',(s.industry?'산업 '+s.industry+' → ':s.theme?'테마 '+s.theme+' → ':'')+'AI 종목분석 → 투자전략 · '+(s.mode==='day'?'단타':('스윙 '+({'5d':'5일','20d':'20일','60d':'60일'}[s.period]||'20일')+' 관찰'))+' · 조건부 전략은 별도 20봉 지표 기준','str4-muted'));const back=button('종목분석 보기',()=>root.MYInvestStockSelection?.open(s.symbol,{...s,mode,source:'strategy'}));head.append(back)}else{head.append(make('p','선택된 종목 없음 · 직접 입력한 가격으로도 전략 시나리오를 계산할 수 있습니다.','str4-muted'));head.append(button('섹터·테마에서 종목 선택',()=>root.location.hash='#/sectors'),button('AI 종목분석에서 검색',()=>root.location.hash='#/stocks'))}}
 function drawConditional(data,selection){if(!active||!conditional)return;conditional.replaceChildren();const judgment=root.InvestWorkflow.judge(data,selection,ctxRef),owned=root.InvestWorkflow.holdings(ctxRef,selection,data);const path=root.InvestWorkflow.opportunity(selection,data,ctxRef);conditional.append(make('h3',(owned.length?'기존 보유종목 관리':'신규 투자 후보 관찰')+' · '+(root.InstrumentNames?.label(selection.symbol,selection.name)||selection.symbol)),make('p','주도 산업·테마 → 종목 → 전략: '+path.label+' · '+(path.track==='holding'?'보유종목 경로':'신규 후보 경로 (실제 미보유 확정 아님)'), 'str4-muted'),make('p','근거: '+(path.checks.join(' · ')||'검증된 상대강도 없음'),'str4-muted'),make('p','추가 검증: '+(path.warnings.join(' · ')||'연결된 데이터 범위에서 추가 확인 항목 없음'),'str4-muted'),make('p','관측 종가 '+fmt(data.metrics.last)+' '+data.currency+' · 직전 봉 대비 '+fmt(data.metrics.change)+'%'),make('p','현재 판단: '+judgment.label+' · '+judgment.basis),make('p','유리: '+(judgment.favorable.join(' · ')||'확인 자료 없음')),make('p','불리: '+(judgment.unfavorable.join(' · ')||'확인 자료 없음')),make('p','변경 조건: '+judgment.changes.join(' · ')),make('p','출처 '+data.source+' · 기준 '+new Date(data.observedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' KST · 수신 '+new Date(data.receivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}),'str4-muted'));
 const cases=root.InvestWorkflow.scenarios(data,selection);if(!cases.length)conditional.append(make('p',selection.mode==='day'?'일봉만 수신: 실시간 단타 진입·손절·목표 신호는 생성하지 않습니다. 분봉·호가·체결 수신 필요.':'자료 부족: 유효한 조건부 진입·손절 구간을 만들 수 없습니다.','str4-muted'));
 for(const scenario of cases){const card=make('section',undefined,'str4-field');card.append(make('strong',scenario.name),make('p',scenario.condition),make('p','조건 진입 '+fmt(scenario.entry)+' · 손절 '+fmt(scenario.stop)+' · 1차 목표 '+fmt(scenario.target1)+' · 2차 목표 '+fmt(scenario.target2)+' '+data.currency),make('p','무효 조건: '+scenario.invalid),make('p',scenario.basis,'str4-muted'));card.append(button('이 조건값으로 위험한도 계산',()=>{inputs.entry.value=scenario.entry;inputs.stop.value=scenario.stop;inputs.target.value=scenario.target2;calculate()}));conditional.append(card)}
 if(owned.length)conditional.append(make('p','보유 관리: 각 계좌 평단을 유지합니다. 추세 유지 시 보유 조건 관찰, 지지 이탈 시 비중 축소/손절 기준 재검토, 목표 도달 시 분할익절 검토. 추가매수·확대는 시장/테마·위험한도 확인 전 확정하지 않습니다.','str4-muted'));else conditional.append(make('p','보유 자료가 없거나 미조회일 수 있습니다. 후보 조건은 실제 매수 권유·주문이 아니며 자금유입·실적·뉴스 검증이 필요합니다.','str4-muted'));
 conditional.append(button('보유종목 관리 보기',()=>{root.location.hash='#/accounts/holdings'}));
 }
 async function loadStrategy(force=false){const selection=readSelection(),version=++requestVersion;latestData=null;if(!selection||!active)return;const key=selection.symbol+':'+selection.mode;if(key!==lastSelectionKey){lastSelectionKey=key;for(const field of ['entry','stop','target'])if(inputs[field])inputs[field].value='';calculate()}conditional.replaceChildren(make('p','동일 종목의 검증된 일봉 분석을 준비하는 중…'));try{const data=await root.InvestWorkflow.ensure(selection,force);if(!active||version!==requestVersion||readSelection()?.symbol!==selection.symbol)return;latestData=data;drawConditional(data,selection);const cases=root.InvestWorkflow.scenarios(data,selection);if(cases.length&&!inputs.entry.value){inputs.entry.value=cases[0].entry;inputs.stop.value=cases[0].stop;inputs.target.value=cases[0].target2;calculate()}renderHolding()}catch{if(active&&version===requestVersion)conditional.replaceChildren(make('p','전략 판단 불가 · 실제 일봉 자료의 수신·식별자·통화를 확인하세요. 이전 종목 조건값은 사용하지 않습니다.'))}}
 function cleanupComparison(){
  try{compareInstance?.destroy?.()}catch{}
  compareInstance=null;
  compareHost?.replaceChildren();
 }
 function toggleComparison(){
  if(!active||!compareDisclosure||!compareHost)return;
  cleanupComparison();
  if(!compareDisclosure.open)return;
  // Deliberately do NOT pass ctxRef or account holdings to this manual-only tool.
  const panel=root.MYInvestScenarioComparePanelV1;
  if(!panel||typeof panel.mount!=='function'){
   compareHost.append(make('p','이 개발 빌드에는 가상 비교 모듈이 없습니다. 원래 투자전략 계산기를 계속 사용하세요.','str4-muted'));
   return;
  }
  try{
   const instance=panel.mount(compareHost);
   if(!instance?.ok){
    compareHost.replaceChildren(make('p','비교 계산기를 준비하지 못했습니다. 입력 내용은 저장되지 않았습니다.','str4-muted'));
    return;
   }
   compareInstance=instance;
  }catch{
   compareHost.replaceChildren(make('p','비교 계산기 연결 실패 · 기존 투자전략 기능은 계속 사용할 수 있습니다.','str4-muted'));
  }
 }
 function mount(container,ctx){active=true;ctxRef=ctx;view=make('section',undefined,'str4');const style=make('style');style.textContent=css+'.str4-compare-disclosure{margin-top:14px;border:1px solid #465775;border-radius:10px;padding:10px;background:#112039;min-width:0}.str4-compare-disclosure>summary{font-size:14px;font-weight:700;cursor:pointer;padding:6px;min-height:32px}.str4-compare-disclosure[open]>summary{margin-bottom:12px}.str4-compare-host{min-width:0;max-width:100%}';view.append(style,make('h2','단타·스윙 투자전략 V2'),make('p','검증된 일봉의 조건부 시나리오와 직접 입력한 매매계획의 위험한도를 구분합니다.','str4-muted'));head=make('div',undefined,'str4-nav');view.append(head);renderHeader();selector=root.InvestWorkflow.selector({ctx,searchId:'strategyStockSearch',onSelect:selected=>{mode=selected.mode;renderHeader();void loadStrategy()}});view.append(selector.element);conditional=make('section',undefined,'str4-output workflow-conditional');view.append(conditional);const modes=make('div',undefined,'str4-modes');const checklist=make('div');for(const [value,label] of [['day','단타'],['swing','스윙']]){const b=button(label,()=>{mode=value;const selection=readSelection();if(selection){root.InvestWorkflow.select(selection.symbol,{...selection,mode});void loadStrategy()}for(const x of modes.querySelectorAll('button'))x.setAttribute('aria-pressed',String(x===b));drawChecklist()});b.dataset.mode=value;modes.append(b)}view.append(modes,checklist);
 function drawChecklist(){for(const b of modes.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));checklist.replaceChildren(make('h3',mode==='day'?'단타 진입 전 점검':'스윙 진입 전 점검'));const list=make('ul');(mode==='day'?['시장 방향 및 해당 테마 당일 강도 확인','분봉·VWAP·거래량과 호가 데이터 확인 (현재 미연결)','진입·손절·목표·1회 손실한도 사전 설정','뉴스 급변·갭 리스크 및 유동성 점검']:['시장 국면과 테마 추세의 지속성 확인','일봉 MA20·MA60 및 최근 고저점 점검','실적 발표·주요 뉴스·기관 수급 확인 (현재 미연결)','2~3주 보유 가정 시 갭·오버나이트 위험 반영']).forEach(t=>list.append(make('li',t)));checklist.append(list)}drawChecklist();
 view.append(make('h3','매매계획 계산기'),make('p','모든 금액은 동일 통화 단위입니다. 예: 한국 종목은 원, 미국 종목은 달러. 조건부 계산값 또는 직접 입력값이며 실시간 주문가격이 아닙니다.','str4-muted'));const grid=make('div',undefined,'str4-grid');grid.append(field('계획 자본금','capital','1000000','any'),field('1회 허용 손실 (%)','riskPct','1','0.1'),field('최대 투자금 배분 (%)','allocation','30','1'),field('가정 진입가','entry','','any'),field('가정 손절가','stop','','any'),field('가정 목표가','target','','any'));view.append(grid);holdingPanel=make('div',undefined,'str4-output');view.append(holdingPanel);output=make('div',undefined,'str4-output');output.setAttribute('aria-live','polite');view.append(output);
 // Opt-in, offline comparison: do not change existing strategy math or holdings.
 compareDisclosure=make('details',undefined,'str4-compare-disclosure');
 compareDisclosure.setAttribute('data-module','strategy-scenario-compare-v1');
 const summary=make('summary','단타·스윙 위험예산 비교 (가상 · 수동 입력)');
 compareHost=make('div',undefined,'str4-compare-host');
 compareDisclosure.append(summary,compareHost);
 compareDisclosure.addEventListener('toggle',toggleComparison);
 view.append(compareDisclosure);
 legacy.mount(container,ctx);container.prepend(view);calculate();unsubscribe=ctx.subscribe?.(()=>{if(active){renderHolding();if(latestData&&readSelection())drawConditional(latestData,readSelection())}});void loadStrategy()}
 return {mount,refresh:async(ctx,force)=>{await legacy.refresh(ctx,force);renderHeader();renderHolding();void loadStrategy(force)},unmount(){active=false;requestVersion++;latestData=null;compareDisclosure?.removeEventListener('toggle',toggleComparison);cleanupComparison();compareDisclosure=null;compareHost=null;selector?.destroy();selector=null;unsubscribe?.();unsubscribe=null;view?.remove();legacy.unmount()},getStatus:()=>({status:active?'ready':'unmounted',mode})};
}
DashboardPages.register('strategy',create);
root.MYInvestStrategyMath=Object.freeze({plan});
})(window);
