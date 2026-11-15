(function(){
  'use strict';const {node,note}=DashboardPages;
  DashboardPages.register('home',()=>DashboardPages.legacy({
    intro:'홈은 다른 메뉴의 조회 결과를 재사용합니다. 미조회·미연결 항목은 요약을 만들지 않습니다.',
    build(view){const links=node('div',null,'shell-form');for(const [label,path] of [['글로벌 시장','market'],['섹터·테마','sectors'],['AI 종목분석','stocks'],['투자전략','strategy'],['뉴스·이벤트','news'],['내 계좌','accounts']]){const b=node('button',label);b.type='button';b.addEventListener('click',()=>window.location.hash='#/'+path);links.append(b)}view.append(links);view.append(node('div',null,'summary-grid'));view.append(note('주도 산업 TOP 3·경제 이벤트·관심종목 변화: 전용 모듈 미연결. 단타·스윙 판단은 투자 전략에서 확인하세요.'))},
    refresh:(ctx,force)=>ctx.market(force),
    update(view,ctx){
      const grid=view.querySelector('.summary-grid');grid.replaceChildren();
      for(const [name,key] of [['코스피','^KS11'],['S&P 500','^GSPC'],['나스닥','^IXIC'],['달러/원','KRW=X'],['변동성 VIX','^VIX'],['미국 10년물','^TNX']]){
        const card=node('dl',null,'card');card.append(node('dt',name),node('dd',Q[key]?.p==null?'미조회':nf(Q[key].p)),node('small',Q[key]?srcTag(key,true)+' · 수신시각 기준 / 실시간 여부 미확인':'미확인'));grid.append(card);
      }
      const snap=ctx.snapshot(),card=node('dl',null,'card');card.append(node('dt',snap.complete?'조회 자산 합계':'조회된 자산 부분 합계'),node('dd',snap.knownSubtotal===null?'미조회':nf(snap.knownSubtotal)+'원'),node('small',snap.complete?'조회 범위 내 집계':'미조회 계좌·누락 시세가 있을 수 있습니다.'));grid.append(card);
      const regime=node('div',null,'card');regime.append(node('h2','시장 국면 요약'),node('p',Q['^GSPC']&&Q['^VIX']?'시장 관측값 수신 · 글로벌 시장에서 관측시각을 확인하고 거시경제 분석을 여세요.':'시장 국면 판단 미확인 · 필요한 지표 미수신'));grid.append(regime);
    }
  }));
})();
