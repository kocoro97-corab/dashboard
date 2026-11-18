"""Focused review of 1414d7e/503c65b/b37fa31. Synthetic services only.
Exit 1 means a supplied UI/analysis defect was reproduced; do not edit production modules.
"""
import argparse,ast,copy,json,mimetypes,sys,tempfile,time
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
from browser_review_selectors import stock_heading,watch_code_cell
from relay.app import RelayApp,RelayFault
from relay.public_dev import PublicDevelopment
from test_relay import configuration,EXPECTED,request,TOKEN
# Reuse the already established synthetic service definitions without running their tests.
source=ast.parse((ROOT/'tests/browser_work_handoff.py').read_text());nodes=[]
for item in source.body:
 if isinstance(item,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='p' for x in item.targets):break
 nodes.append(item)
fixture_ns={'__file__':str(ROOT/'tests/browser_work_handoff.py')};exec(compile(ast.Module(body=nodes,type_ignores=[]),'reused-browser-fixture','exec'),fixture_ns);Gas=fixture_ns['Gas']
p=argparse.ArgumentParser();p.add_argument('--published',action='store_true');p.add_argument('--extended',action='store_true');p.add_argument('--only',nargs='+',default=[],help='Run only cases whose names start with these prefixes');p.add_argument('--output',type=Path,default=Path('/tmp/commit-review'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
ORIGIN='https://kocoro97-corab.github.io';BASE=ORIGIN+'/dashboard-v2-dev/';HOST='synthetic-review.trycloudflare.com';ENDPOINT='https://'+HOST+'/api';CODE='SYNTHETIC_PRIVATE_REVIEW_CODE'
INSTRUMENT_CONTEXT="""(()=>{let api;window.__reviewContexts=[];Object.defineProperty(window,'AppContext',{configurable:true,get:()=>api,set:value=>{api={...value,create(){const ctx=value.create(),record={ctx,active:0};window.__reviewContexts.push(record);const subscribe=ctx.subscribe;ctx.subscribe=fn=>{record.active++;const off=subscribe(fn);let active=true;return()=>{if(active){active=false;record.active--;off()}}};return ctx}}}})})()"""
# Known independent totals: value=2000, cost=1900, profit=100, return=100/1900*100.
BASELINE="""()=>{
 const tok=LS('invest_session_token');NH_ACCOUNT_SESSION=tok;NH_ACCOUNT_FETCHED_AT=Date.now();NH_ACCOUNT_UPDATED=new Date().toISOString();
 NH_ACCOUNTS=[{accountKey:'a'.repeat(64),errors:[],domestic:{holdings:[{code:'035720',name:'Synthetic NH',currency:'KRW',quantity:4,avgPrice:75,currentPrice:100,evalAmount:400,profit:100}]},overseas:{holdings:[{code:'TEST',name:'Synthetic foreign',instrumentId:'US:XNAS:TEST',currency:'USD',quantity:2,avgPrice:4,currentPrice:5,evalAmount:600,profit:-200}]}}];
 EXT_ASSETS=[{accountType:'ISA',code:'000660',name:'Synthetic external',quantity:10,avgPrice:80,source:'manual',match:{status:'matched'}},{accountType:'IRP',code:'123456',name:'Synthetic zero',quantity:0,avgPrice:50,source:'manual',match:{status:'matched'}}];EXT_PRICES={'000660':{price:100},'123456':{price:50}};EXT_SAVED_ROWS=extRows(EXT_ASSETS);EXT_SAVED_REV='synthetic-review';$('nhAccountStatus').textContent='합성 조회 완료';$('externalStatus').textContent='합성 조회 완료';window.__reviewContexts[0].ctx.emit();
}"""
BAR_SETUP="""()=>{window.__reviewGetJSON=getJSON;window.__responseMode='valid';window.__pendingResponses={};window.__barDocument=(symbol,currency='USD',mode='valid')=>{const values=Array.from({length:70},(_,i)=>100+i),stamp=Math.floor(Date.now()/1000)-80*86400;const doc={chart:{result:[{meta:{symbol,currency},timestamp:values.map((_,i)=>stamp+i*86400),indicators:{quote:[{open:values,high:values.map(x=>x+2),low:values.map(x=>x-2),close:values,volume:values.map(()=>1000)}]}}]}};const r=doc.chart.result[0];if(mode==='wrong-symbol')r.meta.symbol='WRONG';if(mode==='wrong-currency')r.meta.currency='USD';if(mode==='missing-currency')delete r.meta.currency;if(mode==='missing-meta')delete r.meta;if(mode==='missing-close')r.indicators.quote[0].close=[];if(mode==='missing-time')r.timestamp=values.map(()=>null);if(mode==='future')r.timestamp=values.map((_,i)=>Math.floor(Date.now()/1000)+(i+1)*86400);if(mode==='duplicate')r.timestamp=values.map(()=>stamp);if(mode==='reverse')r.timestamp.reverse();if(mode==='zero-price')r.indicators.quote[0].close=values.map(()=>0);if(mode==='negative-price')r.indicators.quote[0].close=values.map(()=>-1);if(mode==='bad-high')r.indicators.quote[0].high=values.map(x=>x-1);if(mode==='bad-low')r.indicators.quote[0].low=values.map(x=>x+1);if(mode==='nonfinite-price')r.indicators.quote[0].high=values.map(()=>Infinity);if(mode==='string-epoch')r.timestamp=r.timestamp.map(String);if(mode==='partial-duplicate')r.timestamp[69]=r.timestamp[68];if(mode==='partial-reverse')r.timestamp[69]=r.timestamp[60];if(mode==='partial-ohlc')for(let i=65;i<70;i++)r.indicators.quote[0].high[i]=0;if(mode==='partial-future')for(let i=65;i<70;i++)r.timestamp[i]=Math.floor(Date.now()/1000)+(i+1)*86400;return doc};getJSON=url=>{const u=new URL(url);if(u.hostname==='query1.finance.yahoo.com'&&u.searchParams.get('range')==='1y'){const sym=decodeURIComponent(u.pathname.split('/').at(-1)),ccy=/\\.(KS|KQ)$/.test(sym)?'KRW':'USD';if(window.__responseMode==='hold')return new Promise(resolve=>{(window.__pendingResponses[sym]??=[]).push(resolve)});return Promise.resolve(window.__barDocument(sym,ccy,window.__responseMode))}return window.__reviewGetJSON(url)};window.__resolveBars=(sym)=>{for(const resolve of window.__pendingResponses[sym]||[])resolve(window.__barDocument(sym));delete window.__pendingResponses[sym]};}"""
results=[]
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
 artifact=Path(tmp)/'public';build(artifact,use_public_config=False);browser=pw.chromium.launch(headless=True)
 try:
  for width in [1440,690,344]:
   gas=Gas();edge=PublicDevelopment(RelayApp(configuration(origins=frozenset({ORIGIN}),public_market=True,account_reads=True),gas),BASE,CODE);edge.host=HOST;errors=[];unexpected=[]
   context=browser.new_context(viewport={'width':width,'height':960},timezone_id='Asia/Seoul',service_workers='block');context.add_init_script(INSTRUMENT_CONTEXT)
   def route(r):
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     if args.published:r.continue_();return
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    if r.request.url==ENDPOINT:
     h=r.request.headers;result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''));r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
    unexpected.append(u.hostname);r.abort()
   context.route('**/*',route);page=context.new_page();public_starts={}
   def asset_start(req):
    if urlsplit(req.url).hostname=='kocoro97-corab.github.io':public_starts[id(req)]=time.monotonic()
   def asset_finished(req):
    started=public_starts.pop(id(req),None)
    if started is not None and time.monotonic()-started>3:print(json.dumps({'stage':'PUBLIC_ASSET_WAIT','path':urlsplit(req.url).path,'elapsedMs':round((time.monotonic()-started)*1000)}),flush=True)
   page.on('request',asset_start);page.on('requestfinished',asset_finished);
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.set_default_timeout(7000)
   page.goto(BASE+'index.html#/accounts',wait_until='domcontentloaded');page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click();page.wait_for_selector('#devBanner');page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function('()=>!!EXT_SAVED_REV&&NH_ACCOUNT_SESSION===LS("invest_session_token")',timeout=30000 if args.published else 7000)
   def go(path):page.evaluate('(p)=>location.hash="#/"+p',path);page.wait_for_function('(p)=>DashboardShell.getStatus().path==="/"+p',arg=path)
   def emit():page.evaluate('window.__reviewContexts[0].ctx.emit()')
   def base():page.evaluate(BASELINE)
   def case(name,fn):
    if args.only and not name.startswith(tuple(args.only)):return
    try:fn();row={'width':width,'test':name,'status':'PASS'}
    except Exception as error:row={'width':width,'test':name,'status':'FAIL','reason':str(error).splitlines()[0][:240] or type(error).__name__}
    results.append(row);print(json.dumps(row),flush=True)
   def chart_values():
    base();assert page.locator('.pv-kpi strong').all_text_contents()[:3]==['2,000원','1,900원','100원'];assert page.locator('.pv-kpi strong').nth(3).inner_text()=='5.26%';snap=page.evaluate('AppContext.create().snapshot()');assert snap['knownSubtotal']==2000 and snap['result']['summary']['costKrw']==1900 and snap['result']['summary']['profitKrw']==100;assert snap['details'][1]['currency']=='USD' and snap['result']['rows'][1]['valueKrw']==600
   case('KPI_KRW_TOTALS_NO_DOUBLE_FX',chart_values)
   def donut():
    chart=page.locator('.pv-donut').first;assert 'conic-gradient' in chart.evaluate('e=>getComputedStyle(e).backgroundImage');assert chart.bounding_box()['width']>=125;assert chart.get_attribute('aria-label').count('50.0%')==2;assert '70.0%' in page.locator('.pv-donut').nth(1).get_attribute('aria-label');columns=page.locator('.pv-kpis').evaluate('e=>getComputedStyle(e).gridTemplateColumns.split(" ").length');assert columns==(4 if width==1440 else 2);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(args.output/(str(width)+'-portfolio.png')))
   case('DONUT_LAYOUT_AND_PROPORTIONS',donut)
   def partial():
    page.evaluate('()=>{delete EXT_PRICES["000660"];__reviewContexts[0].ctx.emit()}');assert page.locator('.pv-kpi strong').first.inner_text()=='1,000원';assert page.locator('.pv-kpi strong').nth(2).inner_text()=='미확인';assert '부분 합계' in page.locator('.pv-warning').inner_text();assert 'NaN' not in page.locator('.portfolio-visuals').inner_text()
   case('MISSING_PRICE_PARTIAL_NOT_ZERO',partial)
   def empty():
    page.evaluate('()=>{NH_ACCOUNTS=[];EXT_ASSETS=[];EXT_SAVED_ROWS=[];__reviewContexts[0].ctx.emit()}');assert page.locator('.pv-kpi strong').all_text_contents()==['0원','0원','0원','미확인'];assert page.locator('.pv-donut').count()==0
   case('CONFIRMED_EMPTY_PORTFOLIO',empty)
   def unknown():
    page.evaluate('()=>{NH_ACCOUNT_FETCHED_AT=0;EXT_SAVED_REV=null;__reviewContexts[0].ctx.emit()}');assert page.locator('.pv-kpi strong').all_text_contents()==['미확인']*4
   case('UNQUERIED_PORTFOLIO_UNKNOWN',unknown)
   def zero_profit():
    base();page.evaluate('()=>{NH_ACCOUNTS.push({errors:[],domestic:{holdings:[{code:"005930",name:"Synthetic zero-valued loss",currency:"KRW",quantity:1,avgPrice:100,currentPrice:null,evalAmount:0,profit:-100}]},overseas:{holdings:[]}});__reviewContexts[0].ctx.emit()}');panel=page.locator('.pv-panel').filter(has=page.get_by_role('heading',name='계좌별 평가손익',exact=True));assert '일반계좌 2' in panel.inner_text(),'zero-valued account with -100 loss absent from P/L chart';loss=panel.locator('.pv-bar-row').filter(has_text='일반계좌 2');assert '-100원' in loss.inner_text() and loss.locator('.negative').evaluate('e=>e.getBoundingClientRect().width>0');panel.screenshot(path=str(args.output/(str(width)+'-zero-loss.png')))
   case('ZERO_VALUED_LOSS_ACCOUNT_VISIBLE',zero_profit)
   def top_concentration():
    base();page.evaluate('()=>{NH_ACCOUNTS=[];EXT_ASSETS=Array.from({length:13},(_,i)=>({accountType:"ISA",code:String(100001+i),name:"Synthetic concentration "+i,quantity:i===12?1000:1,avgPrice:1,source:"manual",match:{status:"matched"}}));EXT_SAVED_ROWS=extRows(EXT_ASSETS);EXT_PRICES=Object.fromEntries(EXT_ASSETS.map(x=>[x.code,{price:1}]));__reviewContexts[0].ctx.emit()}');panel=page.locator('.pv-panel').filter(has=page.get_by_role('heading',name='종목별 평가액 집중도',exact=True));assert '100013' in panel.inner_text(),'largest holding (13th source row) absent from first 12 concentration bars';assert '100013' in panel.locator('.pv-bar-row').first.inner_text();assert '나머지 1개 생략' in panel.inner_text();panel.screenshot(path=str(args.output/(str(width)+'-concentration.png')))
   case('CONCENTRATION_INCLUDES_LARGEST_HOLDING',top_concentration)
   def sector_link():
    base();go('sectors');page.wait_for_function('()=>!THM_BUSY');assert page.locator('.stv2 input').count()==0;assert page.get_by_role('heading',name='내 보유·관심종목 연계',exact=True).count()==0
   case('SECTOR_MANAGEMENT_UI_REMOVED',sector_link)
   def sector_reactive():
    page.evaluate('()=>{EXT_ASSETS=[];EXT_SAVED_ROWS=[];__reviewContexts[0].ctx.emit()}');assert page.locator('.stv2 input').count()==0;base();page.evaluate('()=>{EXT_ASSETS[0].quantity=11;__reviewContexts[0].ctx.emit()}');assert page.locator('.stv2 input').count()==0
   case('SECTOR_MANAGEMENT_UI_STAYS_REMOVED_AFTER_CONTEXT_REFRESH',sector_reactive)
   base();go('stocks');page.wait_for_selector('#stockSearch');page.evaluate(BAR_SETUP)
   def search(symbol,mode):
    page.evaluate('(m)=>window.__responseMode=m',mode);page.locator('#stockSearch').fill(symbol);page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_function('()=>{const s=document.querySelector(".sva").textContent;return s.includes("분석 완료")||s.includes("분석 불가")}')
   def rejected(symbol,mode):search(symbol,mode);assert page.locator('.sva h3').filter(has_text='기술적 분석').count()==0,'invalid response accepted: '+mode
   case('STOCK_VALID_DOMESTIC_KRW',lambda:(search('035720','valid'),stock_heading(page,'035720').wait_for()))
   for mode in ['wrong-symbol','wrong-currency','missing-currency','missing-meta','missing-close','missing-time']:
    case('STOCK_REJECT_'+mode.upper().replace('-','_'),lambda m=mode:rejected('035720',m))
   case('STOCK_UNHELD_DOMESTIC_USD_REJECTED',lambda:rejected('555555','wrong-currency'))
   def valid_foreign():search('TEST','valid');assert stock_heading(page,'TEST').count()==1;assert '차트 마지막 종가 기준' in page.locator('.sva section.sva-alert').inner_text()
   case('STOCK_FOREIGN_MATCHED_CURRENCY',valid_foreign)
   case('STOCK_FUTURE_TIMESTAMPS_REJECTED',lambda:rejected('GOOG','future'))
   if args.extended:
    for mode in ['duplicate','reverse','zero-price','negative-price','bad-high','bad-low','nonfinite-price','string-epoch']:
     case('STOCK_EXCLUDE_'+mode.upper().replace('-','_'),lambda m=mode:rejected('GOOG',m))
    def mixed(mode,count,last):
     search('GOOG',mode);assert stock_heading(page,'GOOG').count()==1;assert '일봉 '+str(count)+'개' in page.locator('.sva').inner_text();assert page.locator('.sva-grid .sva-card').first.locator('h3').inner_text()==str(last)
    for mode,count,last in [('partial-duplicate',69,168),('partial-reverse',69,168),('partial-ohlc',65,164),('partial-future',65,164)]:
     case('STOCK_MIXED_'+mode.upper().replace('-','_'),lambda m=mode,n=count,c=last:mixed(m,n,c))
   def reverse():
    page.evaluate('window.__responseMode="hold"');page.locator('#stockSearch').fill('AAA');page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_function('()=>__pendingResponses.AAA?.length');page.locator('#stockSearch').fill('BBB');page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_function('()=>__pendingResponses.BBB?.length');page.evaluate('__resolveBars("BBB")');stock_heading(page,'BBB').wait_for();page.evaluate('__resolveBars("AAA")');assert stock_heading(page,'BBB').count()==1 and stock_heading(page,'AAA').count()==0
   case('STOCK_REVERSED_RESPONSE',reverse)
   def cleanup():
    for _ in range(3):go('sectors');go('stocks');go('accounts')
    assert page.evaluate('__reviewContexts[0].active')==1,'subscription leaked across route remounts';go('stocks');page.evaluate('window.__responseMode="hold"');page.locator('#stockSearch').fill('LATE');page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_function('()=>__pendingResponses.LATE?.length');go('home');page.evaluate('__resolveBars("LATE")');assert page.locator('.sva,.portfolio-visuals,.stv2').count()==0;assert page.evaluate('__reviewContexts[0].active')==1;go('stocks');page.evaluate('window.__responseMode="hold"');page.locator('#stockSearch').fill('AFTERLOGOUT');page.get_by_role('button',name='종목 분석',exact=True).click();page.wait_for_function('()=>__pendingResponses.AFTERLOGOUT?.length');page.evaluate('logout()');page.wait_for_function('()=>DashboardShell.getStatus().page===null');page.evaluate('__resolveBars("AFTERLOGOUT")');assert page.evaluate('__reviewContexts[0].active')==0;assert page.locator('.sva,.portfolio-visuals,.stv2').count()==0;assert not errors and not unexpected,(errors,unexpected)
   case('ROUTE_LATE_RESPONSE_LOGOUT_CLEANUP',cleanup);context.close()
 finally:browser.close()
report={'scope':'PUBLISHED_ASSETS_SYNTHETIC_SERVICES' if args.published else 'LOCAL_ARTIFACT_SYNTHETIC_SERVICES','extended':args.extended,'results':results,'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results),'liveGAS':'NOT_RUN','actualNhCalls':0,'realStorageWrites':0,'calendarApiCalls':0}
(args.output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='results'}),flush=True);raise SystemExit(1 if report['failed'] else 0)
