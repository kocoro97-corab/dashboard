(function(){
  'use strict';const {node,note,button}=DashboardPages;
  DashboardPages.register('settings',()=>DashboardPages.legacy({
    build(view){const actions=node('div',null,'hr');actions.dataset.shellControl='true';actions.append(button('지표 표시·우선순위 설정',()=>openModal()),button('연결 진단',()=>openDg()));view.append(actions,node('div',null,'settings-status'),note('기존 사용자 설정 저장 방식을 유지합니다. 개발 점검 환경의 저장 제한·권한은 확대하지 않습니다. 인증정보·토큰·API 키는 표시하지 않습니다.'))},
    update(view,ctx){const target=view.querySelector('.settings-status'),state=ctx.state();target.replaceChildren();
      for(const text of ['로그인: '+(state.authenticated?'인증됨':'로그아웃'),'시장 데이터: '+(state.publicConnected?'기존 연결 사용':'미연결'),'계좌 조회: '+(ctx.development()?'현재 개발 중계 범위에서 차단':'기존 조회 전용 경로'),'NH 상태: '+NH_STATUS])target.append(note(text));
    }
  }));
})();
