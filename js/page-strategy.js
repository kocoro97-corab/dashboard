(function(){
  'use strict';
  DashboardPages.register('strategy',()=>DashboardPages.legacy({ids:['strategySection'],
    intro:'기존 규칙 기반 시장 시나리오를 재사용합니다. 단타·스윙 포지션 크기·손절·목표가 UI는 미연결입니다. 실제 주문 기능은 없습니다.',
    refresh(){generateScenario()}}));
})();
