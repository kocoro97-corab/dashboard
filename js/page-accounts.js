(function(){
  'use strict';const {node,note,button}=DashboardPages;
  const tabs=[['overview','전체 자산'],['holdings','통합보유종목'],['nh','일반계좌'],['special','ISA·연금·IRP'],['ocr','외부계좌 OCR'],['analysis','자산·손익 분석']];
  function format(v){return Number.isFinite(v)?nf(v):'—'}
  function combinedTable(target,snap){
    const section=node('section',null,'card');section.append(node('h2','동일 종목 통합 수량·평균매입가'),note('검증된 식별자·시장·통화가 같은 종목만 통합합니다. 평균매입가는 수량 가중평균입니다. 해외 식별자가 미확인인 행은 합치지 않습니다.'));
    const wrap=node('div',null,'tw'),table=node('table'),head=node('tr');for(const title of ['종목','코드','시장','통화','계좌 수','통합 수량','통합 평단가','최근 관측 시세','평가금액(KRW)','평가손익(KRW)','수익률(%)','확인 상태'])head.append(node('th',title));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
    for(const row of snap.combined){const tr=node('tr');for(const value of [row.name,row.code||'미확인',row.market==='domestic'?'국내':'해외',row.currency||'미확인',row.accountCount,format(row.quantity),format(row.avgPrice),format(row.currentPrice),format(row.valueKrw),format(row.profitKrw),format(row.returnPct),(row.verified?'식별자 확인':'식별자 미확인 · 별도 행')+(row.partial?' · 일부 시세 미확인':'')+(row.draft?' · 임시':'')+(row.observedAt?' · 관측 '+row.observedAt:' · 시세 관측시각 미확인')])tr.append(node('td',value));body.append(tr)}
    table.append(body);wrap.append(table);section.append(wrap);if(!snap.combined.length)section.append(note(snap.status==='empty'?'조회된 계좌 범위에 보유종목이 없습니다.':'미조회 · 보유종목이 없다는 뜻이 아닙니다.'));target.append(section);
  }
  function renderReport(target,ctx,tab){
    const snap=ctx.snapshot(),result=snap.result;target.replaceChildren();
    if(snap.testRows.length)target.append(note('합성 저장 검증자료 '+snap.testRows.length+'행은 실제 자산 합계·통합 수량·손익에서 제외했습니다.'));
    if(tab==='overview'||tab==='analysis'){
      target.append(note((snap.complete?'조회된 계좌 범위의 합계':'부분 합계 · 미조회 계좌/누락 시세 제외')+(snap.draft?' · 외부계좌 임시 검토값 포함':'')));
      const grid=node('div',null,'summary-grid');
      for(const [title,value] of [['확인된 평가금액',snap.knownSubtotal],['조회자료 매입금액',result.summary.costKrw],['조회자료 평가손익',result.summary.profitKrw],['수익률(%)',result.summary.returnPct]]){const card=node('dl',null,'card');card.append(node('dt',title),node('dd',format(value)));grid.append(card)}target.append(grid);
      target.append(note('NH 마지막 조회: '+(NH_ACCOUNT_UPDATED||'미조회')+' · 외부계좌 저장자료: '+(snap.externalLoaded?'조회됨':'미조회')+' · 서로 다른 통화의 금액을 임의 환산하지 않습니다.'));
      target.append(note('보유종목 평가 기준입니다. 예수금·현금과 미연결 계좌를 포함한 전체 순자산으로 간주하지 않습니다.'));
      for(const [title,list] of [['계좌별 비중·평가손익',result.accounts],['국내·해외 비중',snap.byMarket],['보유 통화별 원화 평가액',result.byCurrency],['종목별 집중도·평가손익',result.exposures]]){
        const section=node('section',null,'card');section.append(node('h2',title));if(!list.length)section.append(note('미조회'));
        for(const row of list){const label=row.key===null?'미확인':snap.details.find(x=>x.accountKey===row.key)?.accountLabel||row.key;section.append(node('p',label+' · 원화 평가액 '+format(row.valueKrw)+' · 평가손익 '+format(row.profitKrw)+' · 비중 '+(row.weight===null?'미확인':format(row.weight*100)+'%')))}target.append(section);
      }
      target.append(note(result.risk.unknownExposure?'종목 집중 위험: 식별자 미확인 종목이 있어 확정할 수 없습니다.':result.risk.incomplete?'종목 집중 위험: 조회 범위가 불완전합니다.':result.risk.concentrated.length?'종목 집중 위험: 확인된 평가액의 25% 이상을 차지하는 종목이 있습니다.':'조회된 범위에서 25% 이상 단일 종목 집중 없음'));
      target.append(note('실현손익·과거 자산 이력·기간 수익률: 데이터 미연결. 평가손익을 실현손익으로 대체하거나 과거 그래프를 생성하지 않습니다.'));
    }else if(tab==='holdings'){
      combinedTable(target,snap);
      target.append(note('계좌별 원본 상세입니다. 동일 종목의 통합 노출은 자산·손익 분석에서 확인합니다. 평가금액·평가손익은 원화, 평균매입가·현재가는 거래 통화 기준입니다.'));
      const wrap=node('div',null,'tw'),table=node('table'),head=node('tr');for(const h of ['계좌','종목','코드','시장','통화','수량','평단가','현재가','평가금액(KRW)','평가손익(KRW)','수익률','출처'])head.append(node('th',h));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
      snap.details.map((row,i)=>({row,analysis:result.rows[i]})).sort((a,b)=>(a.row.accountLabel||'').localeCompare(b.row.accountLabel||'','ko')||(a.row.name||'').localeCompare(b.row.name||'','ko')).forEach(({row,analysis})=>{const tr=node('tr');for(const value of [row.accountLabel,row.name,row.code||'미확인',row.market==='domestic'?'국내':'해외',row.currency,format(row.quantity),format(row.avgPrice),format(row.currentPrice),format(analysis.valueKrw),format(analysis.profitKrw),format(analysis.returnPct),row.source+(row.draft?' · 임시':'')])tr.append(node('td',value));body.append(tr)});
      table.append(body);wrap.append(table);target.append(wrap);if(!snap.details.length)target.append(note('미조회 · 보유종목이 없다는 뜻이 아닙니다.'));
    }else if(tab==='special')target.append(note('ISA·연금저축·IRP는 기존 OCR·수동 입력 자료를 사용합니다. 확인한 NH 공식 공개 문서에서 특수계좌 지원 범위·상품 코드는 미확인, 실제 직접 조회는 미검증입니다. 일반계좌 코드를 임의 적용하지 않습니다. 수정·저장·복구는 외부계좌 OCR 탭에서 기존 절차로 진행합니다.'));
  }
  DashboardPages.register('accounts',()=>{
    let tab='overview',route=null;
    const page=DashboardPages.legacy({
      build(view,ctx,attach){
        const diagnostic=node('section',null,'card'),connection=node('p','계좌 API 연결 상태는 아래 버튼으로 확인할 수 있습니다.','mini');connection.id='accountConnectionStatus';connection.setAttribute('role','status');
        const actions=node('div',null,'hr');actions.dataset.shellControl='true';
        actions.append(button('계좌 연결 상태 확인',async()=>{
          const session=LS('invest_session_token');if(!session){connection.textContent='로그인이 필요합니다.';return}connection.textContent='기존 인증·GAS 연결 확인 중…';
          try{
            const auth=await post({action:'sessionInfo',token:session}),identity=await auth.json();
            if(session!==LS('invest_session_token'))return;
            if(!auth.ok||identity.success!==true||identity.mustChangePassword){connection.textContent='인증 만료 또는 재인증 필요 · 다시 로그인하세요.';return}
            const response=await post({action:'appVersion'}),metadata=await response.json();if(session!==LS('invest_session_token'))return;
            if(!response.ok||metadata.success!==true||metadata.gatewayVersion!==2||metadata.storeEngine!=='account-store-v2'){connection.textContent='GAS V2 식별 확인 실패 · 기존 연결 설정을 확인하세요.';return}
            connection.textContent='로그인 유효 · NH 관리자 권한 '+(identity.isAdmin?'확인':'없음')+' · GAS V2 연결 확인 · '+(ctx.development()?(metadata.developmentAccountReads===true?'격리 계좌 읽기 허용 · '+(metadata.developmentExternalStore===true?'검토 후 계좌자료 저장·복구 사용':metadata.developmentExternalTestStore===true?'합성 테스트자료 저장·복구만 허용':'현재 연결은 저장·복구 미허용'):'현재 중계에서 계좌 기능을 제공하지 않습니다. 계좌관리 옵션으로 중계를 시작하세요.'):'기존 계좌 조회·저장 경로 사용 · 실제 조회와 저장 결과는 각 기능에서 확인하세요.')+' · 이 진단은 실제 계좌를 조회하거나 저장하지 않습니다.';
          }catch{if(session===LS('invest_session_token'))connection.textContent='연결 진단 실패 · 인증·중계·GAS 통신 상태를 확인하세요.'}
        }));
        const loadTest=button('합성 저장 검증자료 불러오기',async()=>{
          const session=LS('invest_session_token');if(!session||window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore!==true){connection.textContent='현재 연결은 합성자료 저장 검증을 허용하지 않습니다.';return}
          try{
            const response=await fetch('data/account-test-holdings.json',{cache:'no-store'});if(!response.ok)throw Error();const rows=await response.json();if(session!==LS('invest_session_token'))return;
            const canonical=x=>JSON.stringify([x.accountType,x.code,x.name,x.quantity,x.avgPrice,x.source]),allowed=new Set(rows.map(canonical));
            if(!EXT_SAVED_REV||[...EXT_ASSETS,...EXT_SAVED_ROWS].some(row=>!allowed.has(canonical(row)))){connection.textContent='기존 저장자료 또는 임시자료가 승인된 합성 검증자료와 다릅니다. 기존 자료를 변경하지 않았습니다.';return}
            if(extImport(rows)){renderExternalAssets();showExternalSaveButton()}connection.textContent='합성 테스트자료만 임시 목록에 준비했습니다. 외부계좌 OCR 탭에서 검토 후 저장하세요. 실제 OCR 자료 저장은 이 검증 권한에 포함되지 않습니다.';
          }catch{if(session===LS('invest_session_token'))connection.textContent='합성 검증자료를 준비하지 못했습니다. 기존 자료는 변경하지 않았습니다.'}
        });loadTest.id='loadAccountTestData';actions.append(loadTest);diagnostic.append(node('h2','계좌 API 연결 진단'),actions,connection);view.append(diagnostic);
        const nav=node('nav',null,'account-nav');nav.setAttribute('aria-label','계좌관리 하위 메뉴');nav.dataset.shellControl='true';for(const [key,title] of tabs){const link=node('a',title);link.href='#/accounts/'+key;link.dataset.accountTab=key;nav.append(link)}
        view.append(nav,node('div',null,'account-report'));attach('nhAccountSection');attach('externalAssetSection');
      },
      refresh:(ctx,force)=>ctx.accounts(force),
      update(view,ctx){
        tab=route?.tab||'overview';for(const link of view.querySelectorAll('[data-account-tab]')){if(link.dataset.accountTab===tab)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
        const nh=document.getElementById('nhAccountSection'),ext=document.getElementById('externalAssetSection');nh.hidden=tab!=='nh';ext.hidden=tab!=='ocr';
        if(tab==='special'){
          renderReport(view.querySelector('.account-report'),ctx,tab);
          for(const kind of ['ISA','PENSION','IRP']){const section=node('section',null,'card');section.append(node('h2',({ISA:'ISA',PENSION:'연금저축',IRP:'IRP'})[kind]));const rows=ctx.snapshot().details.filter(row=>row.accountType===kind);if(rows.length){const wrap=node('div',null,'tw'),table=node('table'),thead=node('thead'),header=node('tr');for(const h of ['종목','수량','평단가(KRW)','현재가(KRW)','출처','시세 출처','시세 관측시각'])header.append(node('th',h));thead.append(header);table.append(thead);const tbody=node('tbody');for(const row of rows){const tr=node('tr');for(const value of [row.name,format(row.quantity),format(row.avgPrice),format(row.currentPrice),row.source+(row.draft?' · 임시':''),row.quoteSource||'미확인',row.observedAt||'미확인'])tr.append(node('td',value));tbody.append(tr)}table.append(tbody);wrap.append(table);section.append(wrap)}if(!rows.length)section.append(note('저장자료 미조회 또는 해당 구분 자료 없음'));view.querySelector('.account-report').append(section)}
        }else renderReport(view.querySelector('.account-report'),ctx,tab);
        if(ctx.development())view.querySelector('.account-report').append(note(ctx.accountReads()?'기존 인증된 계좌 경로입니다. '+(window.MYINVEST_TRANSPORT_CONFIG?.externalStore?'OCR·수동 입력 자료는 저장 전 검토 후 저장·복구할 수 있습니다. 이전 버전은 복구 이력으로 유지합니다.':window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore?'선택한 합성 테스트 모드에서는 고정 합성자료만 저장·복구합니다.':'현재 중계는 조회 모드입니다. 저장·복구는 계좌관리 옵션으로 연결하세요.'):'현재 중계는 계좌관리 모드로 시작되지 않았습니다. 계좌관리 옵션으로 연결한 뒤 이용하세요.'));
        const testButton=view.querySelector('#loadAccountTestData');if(testButton){testButton.disabled=window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore!==true;testButton.hidden=window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore!==true}
      }
    });
    return {...page,setRoute(next){route=next},mount(container,ctx){page.mount(container,ctx);if(!ctx.development())applyExternalAutoRefresh()},unmount(){if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null;page.unmount()}};
  });
})();
