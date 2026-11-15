(function(){
  'use strict';const {node,note}=DashboardPages;
  const tabs=[['overview','전체 자산'],['nh','NH 나무'],['special','ISA·연금·IRP'],['ocr','외부계좌 OCR'],['holdings','통합 보유종목'],['analysis','자산·손익 분석']];
  function format(v){return Number.isFinite(v)?nf(v):'—'}
  function renderReport(target,ctx,tab){
    const snap=ctx.snapshot(),result=snap.result;target.replaceChildren();
    if(tab==='overview'||tab==='analysis'){
      target.append(note((snap.complete?'조회된 계좌 범위의 합계':'부분 합계 · 미조회 계좌/누락 시세 제외')+(snap.draft?' · 외부계좌 임시 검토값 포함':'')));
      const grid=node('div',null,'summary-grid');
      for(const [title,value] of [['확인된 평가금액',snap.knownSubtotal],['총매입금액',result.summary.costKrw],['총평가손익',result.summary.profitKrw],['수익률(%)',result.summary.returnPct]]){const card=node('dl',null,'card');card.append(node('dt',title),node('dd',format(value)));grid.append(card)}target.append(grid);
      target.append(note('NH 마지막 조회: '+(NH_ACCOUNT_UPDATED||'미조회')+' · 외부계좌 저장자료: '+(snap.externalLoaded?'조회됨':'미조회')+' · 서로 다른 통화의 금액을 임의 환산하지 않습니다.'));
      for(const [title,list] of [['계좌별 비중',result.accounts],['국내·해외 비중',result.byCountry],['보유 통화별 원화 평가액',result.byCurrency],['종목별 집중도',result.exposures]]){
        const section=node('section',null,'card');section.append(node('h2',title));if(!list.length)section.append(note('미조회'));
        for(const row of list){const label=row.key===null?'미확인':row.key;section.append(node('p',label+' · 원화 평가액 '+format(row.valueKrw)+' · 비중 '+(row.weight===null?'미확인':format(row.weight*100)+'%')))}target.append(section);
      }
      target.append(note('실현손익·과거 자산 이력·기간 수익률: 데이터 미연결. 평가손익을 실현손익으로 대체하거나 과거 그래프를 생성하지 않습니다.'));
    }else if(tab==='holdings'){
      target.append(note('계좌별 원본 상세입니다. 동일 종목의 통합 노출은 자산·손익 분석에서 확인합니다. 평가금액·평가손익은 원화, 평균매입가·현재가는 거래 통화 기준입니다.'));
      const wrap=node('div',null,'tw'),table=node('table'),head=node('tr');for(const h of ['계좌','종목','코드','시장','통화','수량','평단가','현재가','평가금액(KRW)','평가손익(KRW)','수익률','출처'])head.append(node('th',h));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
      snap.details.forEach((row,i)=>{const analysis=result.rows[i],tr=node('tr');for(const value of [row.accountLabel,row.name,row.code||'미확인',row.market==='domestic'?'국내':'해외',row.currency,format(row.quantity),format(row.avgPrice),format(row.currentPrice),format(analysis.valueKrw),format(analysis.profitKrw),format(analysis.returnPct),row.source+(row.draft?' · 임시':'')])tr.append(node('td',value));body.append(tr)});
      table.append(body);wrap.append(table);target.append(wrap);if(!snap.details.length)target.append(note('미조회 · 보유종목이 없다는 뜻이 아닙니다.'));
    }else if(tab==='special')target.append(note('ISA·연금저축·IRP는 기존 OCR·수동 입력 자료를 사용합니다. NH 직접 조회는 미검증입니다. 수정·저장·복구는 외부계좌 OCR 탭에서 기존 절차로 진행합니다.'));
  }
  DashboardPages.register('accounts',()=>{
    let tab='overview',route=null;
    const page=DashboardPages.legacy({
      build(view,ctx,attach){
        const nav=node('nav',null,'account-nav');nav.setAttribute('aria-label','계좌관리 하위 메뉴');nav.dataset.shellControl='true';for(const [key,title] of tabs){const link=node('a',title);link.href='#/accounts/'+key;link.dataset.accountTab=key;nav.append(link)}
        view.append(nav,node('div',null,'account-report'));attach('nhAccountSection');attach('externalAssetSection');
      },
      refresh:(ctx,force)=>ctx.accounts(force),
      update(view,ctx){
        tab=route?.tab||'overview';for(const link of view.querySelectorAll('[data-account-tab]')){if(link.dataset.accountTab===tab)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
        const nh=document.getElementById('nhAccountSection'),ext=document.getElementById('externalAssetSection');nh.hidden=tab!=='nh';ext.hidden=tab!=='ocr';
        if(tab==='special'){
          renderReport(view.querySelector('.account-report'),ctx,tab);
          for(const kind of ['ISA','PENSION','IRP']){const section=node('section',null,'card');section.append(node('h2',({ISA:'ISA',PENSION:'연금저축',IRP:'IRP'})[kind]));const rows=ctx.snapshot().details.filter(row=>row.accountType===kind);for(const row of rows)section.append(node('p',row.name+' · 수량 '+format(row.quantity)+' · 평단 '+format(row.avgPrice)+' KRW · 현재가 '+format(row.currentPrice)+' · '+row.source+(row.draft?' · 임시':'')+' · 시세 출처 '+(row.quoteSource||'미확인')+' · 시세 관측시각 '+(row.observedAt||'미확인')));if(!rows.length)section.append(note('저장자료 미조회 또는 해당 구분 자료 없음'));view.querySelector('.account-report').append(section)}
        }else renderReport(view.querySelector('.account-report'),ctx,tab);
        if(ctx.development())view.querySelector('.account-report').append(note('개발 중계의 기존 보안 범위: NH 조회·저장·복구는 차단, OCR·수동 입력은 임시 미리보기입니다. 기존 저장자료는 변경하지 않았습니다.'));
      }
    });
    return {...page,setRoute(next){route=next},mount(container,ctx){page.mount(container,ctx);if(!ctx.development())applyExternalAutoRefresh()},unmount(){if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null;page.unmount()}};
  });
})();
