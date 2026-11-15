(function(root){
'use strict';
const KEY='myinvest_strategy_selection_v2';
const node=(t,s)=>{const e=document.createElement(t);if(s!==undefined)e.textContent=s;return e};
DashboardPages.register('strategy',()=>{
 const legacy=DashboardPages.legacy({ids:['strategySection'],intro:'기존 규칙 기반 시장 시나리오 · 실제 주문 없음',refresh(){generateScenario()}});
 let view,context,active=false;
 function render(){if(!active)return;context.replaceChildren();let selection=null;try{selection=JSON.parse(sessionStorage.getItem(KEY)||'null')}catch{}
 if(selection&&Date.now()-selection.at<3600000&&/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(selection.symbol)){
 context.append(node('h3','선택 종목 · '+selection.symbol),node('p','분석 경로: '+(selection.theme?'테마 '+selection.theme+' → ':'')+(selection.name||selection.symbol)+' → '+(selection.mode==='day'?'단타':'스윙')+' 전략'));
 context.append(node('p','시장 시나리오는 전체 시장 기준이며, 이 종목의 실시간 진입·목표·손절 신호와 자동 연결되지 않았습니다. 검증된 분봉·수급·실적·뉴스 자료 없이 추천 점수를 산출하지 않습니다.'));
 const b=node('button','종목 기술적 분석으로 돌아가기');b.type='button';b.addEventListener('click',()=>{if(root.MYInvestStockSelection)root.MYInvestStockSelection.open(selection.symbol,{name:selection.name,theme:selection.theme,mode:selection.mode})});context.append(b);
 }else{context.append(node('p','종목을 선택하지 않았습니다. 섹터·테마 또는 AI 종목분석에서 종목을 선택할 수 있습니다.'));const b=node('button','섹터·테마 보기');b.type='button';b.addEventListener('click',()=>root.location.hash='#/sectors');context.append(b)}}
 return {mount(container,ctx){active=true;view=node('section');context=node('div');view.append(context);legacy.mount(container,ctx);container.prepend(view);render()},refresh:async(ctx,force)=>{await legacy.refresh(ctx,force);render()},unmount(){active=false;view?.remove();legacy.unmount()},getStatus:()=>({status:active?'ready':'unmounted'})};
});
})(window);