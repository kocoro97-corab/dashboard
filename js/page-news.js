(function(){
  'use strict';
  DashboardPages.register('news',()=>DashboardPages.legacy({ids:['newsSection'],
    intro:'기존 시장·기본 관심종목 뉴스의 출처와 게시시각을 사용합니다. 보유종목 맞춤 뉴스·경제 일정·실적 이벤트 모듈은 미연결입니다.',
    refresh:(ctx,force)=>ctx.news(force)}));
})();
