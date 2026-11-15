(function(){
  'use strict';const {node,note,button}=DashboardPages;
  DashboardPages.register('stocks',()=>DashboardPages.legacy({ids:['chartsec'],
    build(view){
      const form=node('form',null,'shell-form');form.dataset.shellControl='true';const label=node('label','국내 6자리 코드 또는 해외 티커'),input=node('input');input.type='text';input.maxLength=20;input.id='stockSearch';input.placeholder='005930 또는 AAPL';label.append(input);const submit=button('차트 열기',()=>{});submit.type='submit';const status=node('p','', 'mini');form.append(label,submit,status);
      form.addEventListener('submit',event=>{event.preventDefault();const symbol=input.value.trim().toUpperCase();if(!/^(?:[0-9]{6}|[A-Z][A-Z0-9.=-]{0,14})$/.test(symbol)){status.textContent='국내 6자리 코드 또는 지원되는 해외 티커를 입력하세요.';return}status.textContent='기존 공개 시세 어댑터로 조회합니다.';showQ(symbol,symbol,'',1)});
      view.prepend(form);view.append(note('기술적 분석·기업 기본정보·관심종목 등록 전용 모듈은 미연결입니다. 거래량·거래대금이 없는 응답은 추정하지 않습니다.'));
    },refresh:async(ctx,force)=>{await ctx.chart(force);drawQ()}}));
})();
