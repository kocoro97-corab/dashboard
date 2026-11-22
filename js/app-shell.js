(function(root){
  'use strict';
  const titles={home:'홈',market:'글로벌 시장',sectors:'산업·테마',stocks:'종목 분석',strategy:'투자 전략',news:'뉴스·이벤트',accounts:'내 계좌관리',settings:'설정·진단'};
  if(AppRouter.routes.includes('diagnostics')){titles.settings='설정';titles.diagnostics='검증·진단'}
  let prepared=false,started=false,current=null,revision=0;const instances=new Map(),scrolls=new Map();
  const ctx=AppContext.create();let viewport,title,status,nav,router;
  function prepare(){
    if(prepared)return;prepared=true;
    const app=$('appContainer'),main=app.querySelector('main'),parking=document.createElement('div');parking.id='legacyParking';parking.hidden=true;parking.setAttribute('aria-hidden','true');
    for(const id of ['chartsec','marketSection','tickSection','strategySection','themesSection','nhAccountSection','externalAssetSection','newsSection','workMacroLivePreview']){const el=$(id);if(el)parking.append(el)}
    app.append(parking);main.replaceChildren();nav=document.createElement('nav');nav.className='dashboard-nav';nav.id='dashboardNav';nav.setAttribute('aria-label','주요 메뉴');
    for(const [key,text] of Object.entries(titles)){const a=document.createElement('a');a.href='#/'+key;a.textContent=text;a.dataset.page=key;nav.append(a)}
    const heading=document.createElement('div');heading.className='shell-heading';title=document.createElement('h1');title.id='pageTitle';title.tabIndex=-1;
    const refresh=DashboardPages.button('현재 페이지 갱신',()=>void refreshPage(true));const controls=document.createElement('div');controls.dataset.shellControl='true';const calendar=DashboardPages.button('▦ 일정',()=>{if(current?.page==='news'){root.MYInvestCalendar?.open();return}root.MYInvestCalendarPending=true;router.go('/news');});calendar.title='투자 캘린더 열기';calendar.setAttribute('aria-label','투자 캘린더');controls.append(calendar,refresh);heading.append(title,controls);
    const meta=document.createElement('div');meta.className='shell-meta';meta.append(DashboardPages.node('span','로그인됨 · 기존 세션 유지'));status=DashboardPages.node('span','페이지 준비');status.id='pageStatus';status.setAttribute('role','status');meta.append(status);if(root.DevelopmentDiagnostics)meta.style.display='none';
    viewport=document.createElement('div');viewport.id='pageViewport';viewport.setAttribute('role','region');viewport.setAttribute('aria-labelledby','pageTitle');main.append(nav,heading,meta,viewport);
    if(root.DevelopmentDiagnostics){const layout=document.createElement('style');layout.textContent='#dashboardNav a.has-diagnostic-errors{color:#ffd37a;border-color:#b88935}@media(min-width:320px) and (max-width:600px){#dashboardNav{grid-template-columns:repeat(5,minmax(0,1fr))}#dashboardNav a[data-page=diagnostics]{grid-column:span 2}}';app.append(layout);const update=()=>{const a=nav.querySelector('[data-page=diagnostics]');if(!a)return;const n=root.DevelopmentDiagnostics.snapshot().issues.filter(r=>r.active).length;a.textContent='검증·진단'+(n?' · '+n:'');a.classList.toggle('has-diagnostic-errors',n>0);a.setAttribute('aria-label','검증·진단 · 확인할 오류 '+n+'건')};root.addEventListener('myinvest:development-diagnostics',update)}
    router=AppRouter.create({location,history,target:window,onChange:change});
    // Original renderers retain their IDs/contracts. Only their page adapter
    // subscribes; no timer or API is created by rendering or switching menus.
    for(const key of ['renderNHAccounts','renderExternalAssets','renderCards','renderThemes']){
      const original=root[key];root[key]=function(...args){const result=original(...args);ctx.emit();return result};
    }
    const originalChart=root.showQ;root.showQ=function(...args){const result=originalChart(...args);if(started&&current?.page!=='stocks')router.go('/stocks');return result};
    const auto=root.applyExternalAutoRefresh;root.applyExternalAutoRefresh=function(){if(current?.page==='accounts')return auto();if(EXT_AUTO_TIMER)clearInterval(EXT_AUTO_TIMER);EXT_AUTO_TIMER=null};
    const observer=new MutationObserver(()=>{if(started&&app.style.display!=='block')stop()});observer.observe(app,{attributes:true,attributeFilter:['style']});
  }
  function error(){root.DevelopmentDiagnostics?.pageResult(current?.page,'error');status.textContent='이 페이지 처리 실패 · 다른 메뉴는 계속 사용할 수 있습니다.';status.classList.add('shell-error')}
  function unmount(name){try{instances.get(name)?.unmount()}catch{}}
  function change(route){
    if(!started||!ctx.authenticated())return;
    if(current){root.DashboardTransport?.cancelReads?.();ctx.cancelPending?.();scrolls.set(current.path,viewport.scrollTop);unmount(current.page)}
    current=route;const epoch=++revision;title.textContent=titles[route.page];title.focus({preventScroll:true});
    for(const a of nav.querySelectorAll('a')){if(a.dataset.page===route.page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
    status.classList.remove('shell-error');status.textContent='페이지 연결 중';root.DevelopmentDiagnostics?.pageResult(route.page,'mounted');
    try{
      if(!instances.has(route.page))instances.set(route.page,DashboardPages.create(route.page));
      const page=instances.get(route.page);page.setRoute?.(route);page.mount(viewport,ctx);viewport.scrollTop=scrolls.get(route.path)||0;
      Promise.resolve(page.refresh(ctx)).then(()=>{if(epoch===revision){status.textContent='연결됨 · 미확인 항목은 페이지에서 확인하세요.';root.DevelopmentDiagnostics?.pageResult(route.page,'ready')}}).catch(()=>{if(epoch===revision)error()});
    }catch{viewport.replaceChildren(DashboardPages.note('해당 페이지를 열지 못했습니다. 다른 메뉴를 이용할 수 있습니다.'));error()}
  }
  async function refreshPage(force=true){if(!started||!current)return;const epoch=revision;status.textContent='현재 페이지 갱신 중';try{await instances.get(current.page).refresh(ctx,force);if(epoch===revision){status.textContent='갱신 요청 완료 · 각 영역의 수신 상태 확인';root.DevelopmentDiagnostics?.pageResult(current.page,'ready')}}catch{if(epoch===revision)error()}}
  function start(){
    prepare();if(!LS('invest_session_token')||$('appContainer').style.display!=='block')return;
    if(started)return;if(root.DevelopmentDiagnostics){root.DevelopmentDiagnostics.synchronize();$('errBar')?.remove()}started=true;clock();startTimers();manualRefresh=()=>refreshPage(true);router.start();
  }
  function stop(){started=false;revision++;root.DashboardTransport?.cancelReads?.();root.MYInvestCalendar?.close();root.MYInvestCalendarPending=false;root.InvestWorkflow?.clear();root.ReadStatus?.clear();root.DevelopmentDiagnostics?.clear();router?.stop();unmount(current?.page);instances.clear();scrolls.clear();current=null;ctx.clear();viewport?.replaceChildren();
    // Detached page views are discarded on logout; original account clear logic
    // remains the authority for holdings, OCR, drafts and server session cleanup.
    for(const id of ['nhAccountSection','externalAssetSection'])if($(id))$(id).hidden=false;
  }
  function connect(name,factory){
    DashboardPages.register(name,factory,{replace:true});const active=current?.page===name,route=current;
    unmount(name);instances.delete(name);
    if(active){current=null;change(route)}
  }
  root.DashboardShell=Object.freeze({start,refresh:refreshPage,navigate:path=>router?.go(path),getStatus:()=>({page:current?.page||null,path:current?.path||null,pages:[...instances].map(([name,page])=>{try{return {name,...page.getStatus()}}catch{return {name,status:'error'}}}),...ctx.state()}),connect});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',prepare,{once:true});else prepare();
})(window);
