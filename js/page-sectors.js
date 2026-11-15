(function(){
  'use strict';
  DashboardPages.register('sectors',()=>DashboardPages.legacy({ids:['themesSection'],
    intro:'기존 주도 테마와 강도판을 사용합니다. 글로벌 산업 상대강도·산업 순환매 전용 Work 모듈은 미연결입니다.',
    refresh:(ctx,force)=>ctx.sectors(force)}));
})();
