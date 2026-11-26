(function(){
  'use strict';const {node,note,button}=DashboardPages;
  const tabs=[['overview','전체 자산'],['holdings','통합보유종목'],['nh','일반계좌'],['special','ISA·연금·IRP'],['ocr','외부계좌'],['analysis','자산·손익 분석']];
  const brokerStorageKey='myinvest_external_broker_choices_v1';
  function brokerChoices(){try{const values=JSON.parse(localStorage.getItem(brokerStorageKey)||'[]');return Array.isArray(values)?values.filter(v=>typeof v==='string'&&v.length<=30).slice(0,30):[]}catch{return []}}
  function refreshBrokerChoices(){
    if(window.ExternalAccountUI){ExternalAccountUI.selectorChanged();return}
    const type=document.getElementById('externalAccountType'),wrap=document.getElementById('externalBrokerSelectWrap'),input=document.getElementById('externalBrokerNameInput'),list=document.getElementById('externalBrokerNames');
    if(!type||!wrap||!input||!list)return;
    const isBroker=type.value==='BROKER';wrap.hidden=!isBroker;
    list.replaceChildren();for(const name of brokerChoices()){const option=document.createElement('option');option.value=name;list.append(option)}
    const upload=document.getElementById('externalUploadBtn');if(upload)upload.disabled=isBroker;
    const manual=document.getElementById('externalManualAddBtn');if(manual)manual.disabled=isBroker;
    const info=document.getElementById('externalOcrProgress');
    if(isBroker&&info)info.textContent='증권사명을 직접 입력하고 추가할 수 있습니다. 현재 목록은 이 브라우저에 저장됩니다. 다른 증권사의 OCR·GAS 보유종목 저장은 저장 규격 확장 후 지원합니다.';
  }
  window.addExternalBrokerChoice=function(){
    if(window.ExternalAccountUI&&ExternalAccountUI.capable())return ExternalAccountUI.addBroker(document.getElementById('externalBrokerNameInput')?.value);
    const input=document.getElementById('externalBrokerNameInput');if(!input)return;
    const value=input.value.trim();if(!value||value.length>30||/^[=+@-]/.test(value)){window.alert('증권사 이름을 1~30자로 입력하세요.');input.focus();return}
    const choices=brokerChoices();if(choices.includes(value)){window.alert('이미 등록된 증권사입니다.');return}
    if(choices.length>=30){window.alert('최대 30개까지 등록할 수 있습니다.');return}
    try{localStorage.setItem(brokerStorageKey,JSON.stringify([...choices,value]))}catch{window.alert('이 브라우저에 증권사명을 저장할 수 없습니다.');return}
    document.getElementById('externalAccountType').value='BROKER';refreshBrokerChoices();input.value=value;
  };
  window.removeExternalBrokerChoice=function(){
    if(window.ExternalAccountUI&&ExternalAccountUI.capable())return ExternalAccountUI.removeBroker(document.getElementById('externalBrokerNameInput')?.value.trim());
    const input=document.getElementById('externalBrokerNameInput'),name=input&&input.value.trim();
    if(!name||!brokerChoices().includes(name)){window.alert('등록된 증권사명을 입력하거나 목록에서 선택하세요.');return}
    if(!window.confirm(name+' 증권사를 선택 목록에서 삭제할까요? 보유종목 저장자료는 삭제하지 않습니다.'))return;
    try{localStorage.setItem(brokerStorageKey,JSON.stringify(brokerChoices().filter(x=>x!==name)))}catch{window.alert('증권사 목록을 변경할 수 없습니다.');return}
    input.value='';refreshBrokerChoices();
  };
  function initBrokerSelector(){
    const type=document.getElementById('externalAccountType');if(!type||type.dataset.brokerReady)return;
    type.dataset.brokerReady='true';type.addEventListener('change',refreshBrokerChoices);refreshBrokerChoices();
  }
  function format(v){return Number.isFinite(v)?nf(v):'—'}
  function displayName(row,verified){const record=window.InstrumentNames?.lookup(row.code),id=row.instrumentId||row.identity||'',exchange={XNAS:'NASDAQ',XNYS:'NYSE',ARCX:'ARCA',XASE:'AMEX',BATS:'BATS'}[String(id).split(':')[1]];return verified&&row.market==='overseas'&&row.currency==='USD'&&record&&exchange===record.exchange?window.InstrumentNames.node(row.code,row.name):row.name}
  function presentCell(value){const cell=node('td');if(value instanceof Node)cell.append(value);else cell.textContent=value==null?'':value;return cell}
  function combinedTable(target,snap){
    const section=node('section',null,'card');section.append(node('h2','동일 종목 통합 수량·평균매입가'),note('검증된 식별자·시장·통화가 같은 종목만 통합합니다. 평균매입가는 수량 가중평균입니다. 해외 식별자가 미확인인 행은 합치지 않습니다.'));
    const wrap=node('div',null,'tw'),table=node('table'),head=node('tr');table.className='account-line-table';for(const title of ['종목','코드','시장','통화','계좌 수','통합 수량','통합 평단가','최근 관측 시세','평가금액(KRW)','평가손익(KRW)','수익률(%)','확인 상태'])head.append(node('th',title));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
    for(const row of snap.combined){const tr=node('tr');for(const value of [displayName(row,row.verified),row.code||'미확인',row.market==='domestic'?'국내':'해외',row.currency||'미확인',row.accountCount,format(row.quantity),format(row.avgPrice),format(row.currentPrice),format(row.valueKrw),format(row.profitKrw),format(row.returnPct),(row.verified?'식별자 확인':'식별자 미확인 · 별도 행')+(row.partial?' · 일부 시세 미확인':'')+(row.draft?' · 임시':'')+(row.observedAt?' · 관측 '+row.observedAt:' · 시세 관측시각 미확인')])tr.append(presentCell(value));body.append(tr)}
    table.append(body);wrap.append(table);section.append(wrap);if(!snap.combined.length)section.append(note(snap.status==='empty'?'조회된 계좌 범위에 보유종목이 없습니다.':'미조회 · 보유종목이 없다는 뜻이 아닙니다.'));target.append(section);
  }
  // Read-only portfolio visuals: use calculated KRW values, never recompute FX or account cost basis.
  function portfolioVisuals(target,snap){
    const result=snap.result||{},summary=result.summary||{};
    const section=node('section',null,'card');section.classList.add('portfolio-visuals');
    const style=node('style');style.textContent=`
      .portfolio-visuals{min-width:0}.pv-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0 18px}
      .pv-kpi{border:1px solid #40516a;border-radius:10px;padding:12px;min-width:0;background:#172238;color:#e7eef9}
      .pv-kpi small{display:block;color:#bdcadc;font-size:12px}.pv-kpi strong{display:block;font-size:clamp(15px,1.8vw,23px);overflow-wrap:anywhere;margin-top:5px}
      .pv-panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.pv-panel{border:1px solid #40516a;border-radius:10px;padding:13px;min-width:0}
      .pv-panel h3{margin:0 0 12px}.pv-bar-row{margin:10px 0}.pv-bar-label{display:flex;justify-content:space-between;gap:10px;font-size:13px;overflow-wrap:anywhere}
      .pv-track{height:12px;background:#344158;border-radius:20px;overflow:hidden;margin-top:5px}.pv-fill{height:100%;background:#69a7e9}
      .pv-fill.negative{background:#e58b8b}.pv-donut{width:150px;height:150px;border-radius:50%;margin:10px auto;position:relative}
      .pv-donut:after{content:'';position:absolute;inset:27px;border-radius:50%;background:#172238}.pv-legend{font-size:12px;display:grid;gap:5px}
      .pv-legend-item{display:flex;align-items:center;gap:7px;overflow-wrap:anywhere}.pv-dot{width:10px;height:10px;flex:none;border-radius:3px}
      .pv-muted{font-size:12px;color:#b6c5d9}.pv-warning{margin:10px 0}
      @media(max-width:900px){.pv-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.pv-panels{grid-template-columns:1fr}}
      @media(max-width:390px){.pv-kpis{grid-template-columns:1fr 1fr}.pv-kpi{padding:9px}.pv-donut{width:125px;height:125px}.pv-donut:after{inset:24px}}
    `;section.append(style,node('h2','포트폴리오 한눈에 보기'));
    const kpis=node('div',null,'pv-kpis');
    const entries=[['확인된 보유종목 평가액',snap.knownSubtotal,'원'],['조회자료 매입금액',summary.costKrw,'원'],['평가손익',summary.profitKrw,'원'],['평가수익률',summary.returnPct,'%']];
    for(const [label,value,unit] of entries){const card=node('div',null,'pv-kpi');card.append(node('small',label),node('strong',Number.isFinite(value)?format(value)+unit:'미확인'));kpis.append(card)}section.append(kpis);
    const warning=node('p',(snap.complete?'조회된 계좌 범위 기준':'부분 합계 · 미조회 계좌 또는 시세 누락')+(snap.draft?' · 임시 검토자료 포함':'')+' · 현금·예수금 제외 · 실현손익·과거 추이 미연결','pv-muted pv-warning');section.append(warning);
    const panels=node('div',null,'pv-panels');
    const colors=['#69a7e9','#67c6a4','#e7bd70','#bb9de6','#e58b8b','#84c8d8','#a9bc7b'];
    function rowsFor(list){return(Array.isArray(list)?list:[]).filter(x=>x&&Number.isFinite(x.valueKrw)&&x.valueKrw>0)}
    function labelFor(x){if(x.key===null||x.key===undefined)return '미확인';return snap.details?.find(d=>d.accountKey===x.key)?.accountLabel||String(x.key)}
    function panel(title,list,mode){const box=node('section',null,'pv-panel');box.append(node('h3',title));const rows=(mode==='profit'?(Array.isArray(list)?list:[]).filter(x=>x&&Number.isFinite(x.profitKrw)).slice().sort((a,b)=>Math.abs(b.profitKrw)-Math.abs(a.profitKrw)):rowsFor(list).slice().sort((a,b)=>b.valueKrw-a.valueKrw));if(!rows.length){box.append(node('p','확인된 평가액 없음 · 미보유를 뜻하지 않습니다.','pv-muted'));return box}
      const sum=rows.reduce((a,x)=>a+x.valueKrw,0);
      if(mode==='donut'){const donut=node('div',null,'pv-donut');donut.setAttribute('role','img');donut.setAttribute('aria-label',title+' · '+rows.map(x=>labelFor(x)+' '+(x.valueKrw/sum*100).toFixed(1)+'%').join(', '));let pos=0;const stops=rows.map((x,i)=>{const from=pos;pos+=x.valueKrw/sum*100;return colors[i%colors.length]+' '+from.toFixed(3)+'% '+pos.toFixed(3)+'%'});donut.style.background='conic-gradient('+stops.join(',')+')';box.append(donut);const legend=node('div',null,'pv-legend');rows.forEach((x,i)=>{const item=node('div',null,'pv-legend-item'),dot=node('span',null,'pv-dot');dot.style.background=colors[i%colors.length];item.append(dot,node('span',labelFor(x)+' · '+(x.valueKrw/sum*100).toFixed(1)+'%'));legend.append(item)});box.append(legend)}
      else{const max=Math.max(...rows.map(x=>mode==='profit'?Math.abs(x.profitKrw):x.valueKrw));rows.slice(0,12).forEach(x=>{const item=node('div',null,'pv-bar-row'),line=node('div',null,'pv-bar-label');const val=mode==='profit'?x.profitKrw:x.valueKrw;line.append(node('span',labelFor(x)),node('span',Number.isFinite(val)?format(val)+'원':'미확인'));item.append(line);const track=node('div',null,'pv-track'),fill=node('div',null,'pv-fill'+(Number.isFinite(val)&&val<0?' negative':''));fill.style.width=(Number.isFinite(val)&&max>0?Math.min(100,Math.abs(val)/max*100):0)+'%';track.append(fill);item.append(track);box.append(item)});if(rows.length>12)box.append(node('p','상위 12개 표시 · 나머지 '+(rows.length-12)+'개 생략 · 전체 '+rows.length+'개 기준','pv-muted'))}
      return box}
    panels.append(panel('계좌별 평가액 비중',result.accounts,'donut'),panel('국내·해외 구성',snap.byMarket,'donut'),panel('계좌별 평가손익',result.accounts,'profit'),panel('종목별 평가액 집중도',result.exposures,'value'));section.append(panels);
    const risk=result.risk||{};section.append(node('p',risk.unknownExposure?'식별자 미확인 종목이 있어 집중도 확정 불가':risk.incomplete?'조회 범위가 불완전하여 집중도는 부분 자료 기준':risk.concentrated?.length?'단일 종목 25% 이상 집중 경고':'집중도는 조회된 평가액 기준이며 미연결 자산은 제외','pv-muted'));
    section.append(node('p','표 아래의 원본 계좌별 자료와 평단가는 변경하지 않습니다. 그래프의 비중은 확인된 양의 원화 평가액만을 분모로 계산합니다. 환율 기준시각이 없으면 확인할 수 없습니다.','pv-muted'));
    target.append(section);
  }
  function renderReport(target,ctx,tab){
    const snap=ctx.snapshot(),result=snap.result;target.replaceChildren();
    if(snap.testRows.length)target.append(note('합성 저장 검증자료 '+snap.testRows.length+'행은 실제 자산 합계·통합 수량·손익에서 제외했습니다.'));
    if(tab==='overview'||tab==='analysis'){
      portfolioVisuals(target,snap);
      target.append(note((snap.complete?'조회된 계좌 범위의 합계':'부분 합계 · 미조회 계좌/누락 시세 제외')+(snap.draft?' · 외부계좌 임시 검토값 포함':'')));
      const summary=node('div',null,'tw'),summaryTable=node('table'),summaryHead=node('tr'),summaryBody=node('tr');
      for(const [title,value] of [['확인된 평가금액(KRW)',snap.knownSubtotal],['조회자료 매입금액(KRW)',result.summary.costKrw],['조회자료 평가손익(KRW)',result.summary.profitKrw],['수익률(%)',result.summary.returnPct]]){summaryHead.append(node('th',title));summaryBody.append(node('td',format(value)))}const summaryThead=node('thead'),summaryTbody=node('tbody');summaryThead.append(summaryHead);summaryTbody.append(summaryBody);summaryTable.append(summaryThead,summaryTbody);summary.append(summaryTable);target.append(summary);
      target.append(note('NH 마지막 조회: '+(NH_ACCOUNT_UPDATED||'미조회')+' · 외부계좌 저장자료: '+(snap.externalLoaded?'조회됨':'미조회')+' · 서로 다른 통화의 금액을 임의 환산하지 않습니다.'));
      target.append(note('보유종목 평가 기준입니다. 예수금·현금과 미연결 계좌를 포함한 전체 순자산으로 간주하지 않습니다.'));
      for(const [title,list] of [['계좌별 비중·평가손익',result.accounts],['국내·해외 비중',snap.byMarket],['보유 통화별 원화 평가액',result.byCurrency],['종목별 집중도·평가손익',result.exposures]]){
        const section=node('section',null,'card');section.append(node('h2',title));if(!list.length)section.append(note('미조회'));
        if(list.length){const wrap=node('div',null,'tw'),table=node('table'),thead=node('thead'),head=node('tr');for(const h of ['구분','평가금액(KRW)','평가손익(KRW)','비중(%)'])head.append(node('th',h));thead.append(head);table.append(thead);const tbody=node('tbody');for(const row of list){const label=row.key===null?'미확인':snap.details.find(x=>x.accountKey===row.key)?.accountLabel||row.key;const tr=node('tr');for(const value of [label,format(row.valueKrw),format(row.profitKrw),row.weight===null?'미확인':format(row.weight*100)])tr.append(presentCell(value));tbody.append(tr)}table.append(tbody);wrap.append(table);section.append(wrap)}target.append(section);
      }
      target.append(note(result.risk.unknownExposure?'종목 집중 위험: 식별자 미확인 종목이 있어 확정할 수 없습니다.':result.risk.incomplete?'종목 집중 위험: 조회 범위가 불완전합니다.':result.risk.concentrated.length?'종목 집중 위험: 확인된 평가액의 25% 이상을 차지하는 종목이 있습니다.':'조회된 범위에서 25% 이상 단일 종목 집중 없음'));
      target.append(note('실현손익·과거 자산 이력·기간 수익률: 데이터 미연결. 평가손익을 실현손익으로 대체하거나 과거 그래프를 생성하지 않습니다.'));
    }else if(tab==='holdings'){
      combinedTable(target,snap);
      target.append(note('계좌별 원본 상세입니다. 동일 종목의 통합 노출은 자산·손익 분석에서 확인합니다. 평가금액·평가손익은 원화, 평균매입가·현재가는 거래 통화 기준입니다.'));
      const wrap=node('div',null,'tw'),table=node('table'),head=node('tr');table.className='account-line-table';table.setAttribute('aria-label','계좌별 보유종목 상세 · 가로 스크롤 표');for(const h of ['증권사','계좌명','계좌 유형','종목','종목코드','시장','통화','수량','평균매입가','현재가','평가금액(KRW)','평가손익(KRW)','수익률','자료 출처','최근 갱신'])head.append(node('th',h));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
      snap.details.map((row,i)=>({row,analysis:result.rows[i]})).sort((a,b)=>(a.row.broker||'').localeCompare(b.row.broker||'','ko')||(a.row.accountLabel||'').localeCompare(b.row.accountLabel||'','ko')||a.row.accountKey.localeCompare(b.row.accountKey)||(a.row.name||'').localeCompare(b.row.name||'','ko')).forEach(({row,analysis})=>{const tr=node('tr');for(const value of [row.broker||'증권사 미지정',row.accountLabel,({GENERAL:'일반',ISA:'ISA',PENSION:'연금저축',IRP:'IRP'})[row.accountType]||row.accountType,displayName(row,!!analysis.identity),row.code||'미확인',row.market==='domestic'?'국내':'해외',row.currency,format(row.quantity),format(row.avgPrice),format(row.currentPrice),format(analysis.valueKrw),format(analysis.profitKrw),format(analysis.returnPct),row.source+(row.draft?' · 임시':''),row.observedAt||row.receivedAt&&'수신 '+row.receivedAt||row.storedAt&&'저장 '+row.storedAt||'미확인'])tr.append(presentCell(value));body.append(tr)});
      table.append(body);wrap.append(table);target.append(wrap);if(!snap.details.length)target.append(note('미조회 · 보유종목이 없다는 뜻이 아닙니다.'));
    }else if(tab==='special')target.append(note('ISA·연금저축·IRP는 기존 OCR·수동 입력 자료를 사용합니다. 확인한 NH 공식 공개 문서에서 특수계좌 지원 범위·상품 코드는 미확인, 실제 직접 조회는 미검증입니다. 일반계좌 코드를 임의 적용하지 않습니다. 수정·저장·복구는 외부계좌 메뉴에서 기존 절차로 진행합니다.'));
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
            if(extImport(rows)){renderExternalAssets();showExternalSaveButton()}connection.textContent='합성 테스트자료만 임시 목록에 준비했습니다. 외부계좌 메뉴에서 검토 후 저장하세요. 실제 OCR 자료 저장은 이 검증 권한에 포함되지 않습니다.';
          }catch{if(session===LS('invest_session_token'))connection.textContent='합성 검증자료를 준비하지 못했습니다. 기존 자료는 변경하지 않았습니다.'}
        });loadTest.id='loadAccountTestData';actions.append(loadTest);diagnostic.append(node('h2','계좌 API 연결 진단'),actions,connection);view.append(diagnostic);
        const nav=node('nav',null,'account-nav');nav.setAttribute('aria-label','계좌관리 하위 메뉴');nav.dataset.shellControl='true';for(const [key,title] of tabs){const link=node('a',title);link.href='#/accounts/'+key;link.dataset.accountTab=key;nav.append(link)}
        const progress=node('p','계좌 자료 연결 상태 확인 중…','mini');progress.id='accountFetchProgress';progress.setAttribute('role','status');view.append(nav,progress,node('div',null,'account-report'));attach('nhAccountSection');attach('externalAssetSection');
      },
      refresh:async(ctx,force)=>{
        const progress=document.getElementById('accountFetchProgress');
        if(progress)progress.textContent=ctx.accountReads()?'NH·외부계좌 실제 읽기 조회 중 · 보이는 이전 자료는 최신 여부를 확인하세요.':'현재 연결은 계좌 조회가 허용되지 않았습니다.';
        if(!ctx.accountReads())return;
        try{
          await ctx.accounts(force);
          if(progress)progress.textContent='계좌 조회 요청 완료 · 실제 수신/누락 및 평가금액은 각 계좌의 확인 상태를 따르세요.';
        }catch(error){
          if(progress)progress.textContent='계좌 조회 실패 또는 일부 누락 · 연결 진단을 확인하세요. 이전 자료는 최신으로 간주하지 마세요.';
          throw error;
        }
      },
      update(view,ctx){
        tab=route?.tab||'overview';for(const link of view.querySelectorAll('[data-account-tab]')){if(link.dataset.accountTab===tab)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
        if(window.ExternalAccountUI)ExternalAccountUI.mount();
        initBrokerSelector();const nh=document.getElementById('nhAccountSection'),ext=document.getElementById('externalAssetSection');nh.hidden=tab!=='nh';ext.hidden=tab!=='ocr';document.getElementById('nhAccountCards').hidden=true;document.getElementById('externalSummaryCards').hidden=true;
        if(tab==='special'){
          renderReport(view.querySelector('.account-report'),ctx,tab);
          for(const kind of ['ISA','PENSION','IRP']){const section=node('section',null,'card');section.append(node('h2',({ISA:'ISA',PENSION:'연금저축',IRP:'IRP'})[kind]));const rows=ctx.snapshot().details.filter(row=>row.accountType===kind);if(rows.length){const wrap=node('div',null,'tw'),table=node('table'),thead=node('thead'),header=node('tr');for(const h of ['증권사','계좌명','종목','수량','평단가(KRW)','현재가(KRW)','출처','시세 출처','시세 관측시각'])header.append(node('th',h));thead.append(header);table.append(thead);const tbody=node('tbody');for(const row of rows){const tr=node('tr');for(const value of [row.broker||'증권사 미지정',row.accountLabel,row.name,format(row.quantity),format(row.avgPrice),format(row.currentPrice),row.source+(row.draft?' · 임시':''),row.quoteSource||'미확인',row.observedAt||'미확인'])tr.append(presentCell(value));tbody.append(tr)}table.append(tbody);wrap.append(table);section.append(wrap)}if(!rows.length)section.append(note('저장자료 미조회 또는 해당 구분 자료 없음'));view.querySelector('.account-report').append(section)}
        }else renderReport(view.querySelector('.account-report'),ctx,tab);
        if(ctx.development())view.querySelector('.account-report').append(note(ctx.accountReads()?'기존 인증된 계좌 경로입니다. '+(window.MYINVEST_TRANSPORT_CONFIG?.externalStore?'OCR·수동 입력 자료는 저장 전 검토 후 저장·복구할 수 있습니다. 이전 버전은 복구 이력으로 유지합니다.':window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore?'선택한 합성 테스트 모드에서는 고정 합성자료만 저장·복구합니다.':'현재 중계는 조회 모드입니다. 저장·복구는 계좌관리 옵션으로 연결하세요.'):'현재 중계는 계좌관리 모드로 시작되지 않았습니다. 계좌관리 옵션으로 연결한 뒤 이용하세요.'));
        const testButton=view.querySelector('#loadAccountTestData');if(testButton){testButton.disabled=window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore!==true;testButton.hidden=window.MYINVEST_TRANSPORT_CONFIG?.externalTestStore!==true}
      }
    });
    return {...page,setRoute(next){route=next},mount(container,ctx){page.mount(container,ctx);if(!ctx.development())applyExternalAutoRefresh()},unmount(){if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null;if(window.ExternalAccountUI)ExternalAccountUI.closeImport();page.unmount()}};
  });
})();
