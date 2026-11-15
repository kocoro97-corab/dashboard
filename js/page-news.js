(function(){
  'use strict';
  DashboardPages.register('news',()=>DashboardPages.legacy({ids:['newsSection'],
    build(view){const nav=document.createElement('div');for(const [label,route] of [['AI 종목분석','stocks'],['섹터·테마','sectors'],['투자전략','strategy']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>window.location.hash='#/'+route);nav.append(b)}view.prepend(nav)},
    intro:'기존 시장·기본 관심종목 뉴스의 출처와 게시시각을 사용합니다. 보유종목 맞춤 뉴스·경제 일정·실적 이벤트 모듈은 미연결입니다.',
    refresh:(ctx,force)=>ctx.news(force)}));
})();
