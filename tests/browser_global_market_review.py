"""29e68311 focused market UI and data-wiring review. Synthetic login only.
Optional captured PUBLIC response map; no live NH, orders, or account writes.
"""
import argparse,json,mimetypes,os,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,quote
from playwright.sync_api import sync_playwright
from browser_reference_widgets import fulfill_reference_widget
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
p=argparse.ArgumentParser();p.add_argument('--widths',type=int,nargs='+',default=[1440,690,344]);p.add_argument('--public-fixture',type=Path);p.add_argument('--all-indicators',action='store_true');p.add_argument('--indicators-only',action='store_true');p.add_argument('--ui-label-only',action='store_true');p.add_argument('--output',type=Path,default=Path('/tmp/global-market-review'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
BASE='https://kocoro97-corab.github.io/dashboard-v2-dev/';ENDPOINT='https://myinvest-v2-dev-relay.synthetic.workers.dev/api'
SYMBOLS=['^KS11','^KQ11','^GSPC','^IXIC','^DJI','^SOX','^VIX','KRW=X','^TNX','^IRX','GC=F','CL=F','NQ=F','ES=F','YM=F']
fixtures={};now=int(time.time())-86400;vals=[100+i for i in range(30)]
for sym in SYMBOLS:
 for interval,period in [('1d','1d'),('1d','3mo'),('1wk','2y'),('1mo','5y'),('1mo','10y')]:
  doc={'chart':{'result':[{'meta':{'symbol':sym,'regularMarketPrice':129,'chartPreviousClose':128,'regularMarketTime':now,'currency':'KRW' if sym in ['^KS11','^KQ11','KRW=X'] else 'USD'},'timestamp':[now-(29-i)*86400 for i in range(30)],'indicators':{'quote':[{'open':vals,'close':vals,'high':[v+2 for v in vals],'low':[v-2 for v in vals],'volume':[1000]*30}]}}]}}
  fixtures['https://query1.finance.yahoo.com/v8/finance/chart/'+quote(sym,safe="~()*!.'")+'?interval='+interval+'&range='+period]=json.dumps(doc)
fixtures['https://finance.daum.net/api/home/sec?path=%2Fapi%2Ffutures%2FKR4A016C0004']=json.dumps({'tradePrice':360,'prevClosingPrice':358,'date':'2026-11-17 15:45:00','symbolCode':'KR4A016C0004'})
if args.public_fixture:fixtures=json.loads(args.public_fixture.read_text())
mode='PUBLIC_CAPTURE_WITH_SYNTHETIC_SESSION' if args.public_fixture else 'SYNTHETIC_ONLY';results=[];ui_findings=[]
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
 artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT);f=Path(tmp)/'feeds.json';f.write_text(json.dumps(fixtures));browser=pw.chromium.launch(headless=True)
 try:
  for width in args.widths:
   bridge=subprocess.Popen(['node','tests/worker_browser_bridge.mjs'],cwd=ROOT,env=dict(os.environ,MYINVEST_TEST_PUBLIC_FIXTURE=str(f),MYINVEST_TEST_STRICT_PUBLIC_FIXTURE='1' if args.public_fixture else '0'),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);port=json.loads(bridge.stdout.readline())['port'];context=browser.new_context(viewport={'width':width,'height':1000},timezone_id='Asia/Seoul',service_workers='block');page=context.new_page();errors=[];requests=[]
   def route(r):
    if fulfill_reference_widget(r):return
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    if r.request.url==ENDPOINT:
     payload={'headers':r.request.headers,'method':r.request.method,'body':r.request.post_data};body=json.loads(r.request.post_data or '{}');entry={'action':body.get('action'),'publicUrl':body.get('url') if body.get('action')=='publicFetch' else None};requests.append(entry)
     req=urllib.request.Request('http://127.0.0.1:'+str(port),data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
     with urllib.request.urlopen(req,timeout=30) as response:data=json.load(response)
     entry['status']=data['status'];entry['code']=json.loads(data['body']).get('code');r.fulfill(status=data['status'],headers=data['headers'],body=data['body']);return
    r.abort()
   context.route('**/*',route);page.on('pageerror',lambda e:errors.append(type(e).__name__));page.set_default_timeout(10000)
   def record(name,fn):
    if args.indicators_only and not name.startswith(('INDICATOR_','LAYOUT_')):return
    if args.ui_label_only and name not in ['US_SWITCH_REQUESTS_US_FUTURES','NAVIGATION_RETURN_COLLAPSES_DETAILS','LAYOUT_AND_SECURITY_BOUNDARY']:return
    try:fn();row={'width':width,'test':name,'status':'PASS','mode':mode}
    except Exception as e:
     row={'width':width,'test':name,'status':'FAIL','reason':(str(e).splitlines() or [type(e).__name__])[0][:160],'mode':mode}
     row['recentResponses']=[{k:r.get(k) for k in ['action','status','code']} for r in requests[-3:]]
     closer=page.locator('.miv-overlay button',has_text='닫기')
     if closer.count():closer.first.click()
    results.append(row);print(json.dumps(row),flush=True)
   def settled():page.wait_for_function('()=>document.getElementById("pageStatus")?.textContent.startsWith("연결됨")||document.getElementById("pageStatus")?.textContent.startsWith("갱신 요청 완료")')
   def go(name):page.locator('#dashboardNav a[href="#/'+name+'"]').click();page.wait_for_function('(n)=>DashboardShell.getStatus().page===n',arg=name);settled()
   def close():page.locator('.miv-overlay button',has_text='닫기').click()
   def button(text):return page.locator('.miv-market button',has_text=text).first
   def login():page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_selector('#dashboardNav');settled()
   try:
    page.goto(BASE+'index.html#/market',wait_until='domcontentloaded');page.wait_for_selector('#devBanner');login()
    def collapsed():
     assert page.locator('.miv-indicator').count()==6;assert page.locator('.miv-legacy-details').count()==1;assert page.locator('.miv-legacy-details').get_attribute('open') is None;assert not page.locator('#marketSection').is_visible()
    record('NO_VISIBLE_DUPLICATE_DEFAULT_COLLAPSED',collapsed)
    def details():
     page.locator('.miv-legacy-details > summary').click();assert page.locator('#marketSection').is_visible() and page.locator('#tickSection').is_visible();page.screenshot(path=str(args.output/(str(width)+'-expanded.png')));page.locator('.miv-legacy-details > summary').click()
    record('DETAILS_EXPAND_EXISTING_CONTROLS',details)
    def future():
     assert page.evaluate('!!FQ.k3');assert '데이터 미연결' not in page.locator('.miv-indicator').filter(has_text='KOSPI 200 선물').inner_text()
    record('KOSPI_FUTURE_TOP_CARD_USES_RECEIVED_VALUE',future)
    def switch():
     button('미국장 전환').click();page.wait_for_function('()=>document.querySelector(".miv-indicator strong")?.textContent==="S&P 500"');page.wait_for_function('()=>typeof MK_BUSY!=="undefined"&&!MK_BUSY');assert page.locator('.miv-indicator').filter(has_text='NASDAQ 선물').count()==1
     page.wait_for_function('()=>!!Q["NQ=F"]');assert any(r['publicUrl'] and 'NQ%3DF' in r['publicUrl'] for r in requests)
    record('US_SWITCH_REQUESTS_US_FUTURES',switch)
    def edit():
     button('지표 편집').click();row=page.locator('.miv-edit-row').filter(has=page.locator('input[aria-label="금 선물 표시"]'));row.locator('input').check()
     # Move newly added gold into the first visible position using real controls.
     for _ in range(6):row.locator('button',has_text='▲').click()
     page.locator('.miv-dialog button',has_text='순서 저장').click();page.wait_for_function('()=>document.querySelector(".miv-indicator strong")?.textContent==="금 선물"');page.wait_for_function('()=>!!Q["GC=F"]')
     assert page.locator('.miv-indicator').count()==6
    record('EDITOR_SAVE_ORDER_FETCHES_NEW_SYMBOL',edit)
    def chart():
     page.locator('.miv-indicator').first.click();page.wait_for_selector('.miv-graph canvas');assert page.locator('.miv-dialog').inner_text().find('마지막 봉:')>=0
     for label in ([] if args.public_fixture else ['주','월','년','일']):
      page.locator('.miv-dialog .miv-controls button',has_text=label).click();page.wait_for_selector('.miv-graph canvas')
     page.screenshot(path=str(args.output/(str(width)+'-chart.png')));close()
    record('EXPANDED_CHART_DAILY_CAPTURE' if args.public_fixture else 'EXPANDED_CHART_ALL_PERIODS',chart)
    def observation():
     button('시장 국면').click();assert page.locator('.miv-observation-row').count()>0;assert '확정하지 않습니다' in page.locator('.miv-dialog').inner_text();page.screenshot(path=str(args.output/(str(width)+'-observations.png')));close()
    record('OBSERVATIONS_WITHOUT_FABRICATED_REGIME',observation)
    def response():
     button('투자 대응').click();assert '미국장 · 단타' in page.locator('.miv-dialog').inner_text();page.locator('.miv-dialog .miv-controls button',has_text='스윙').click();assert '미국장 · 스윙' in page.locator('.miv-dialog').inner_text();page.locator('.miv-dialog button',has_text='섹터·테마 확인').click();page.wait_for_function('()=>DashboardShell.getStatus().page==="sectors"');go('market')
    record('DAY_SWING_CHECKLIST_AND_THEME_NAVIGATION',response)
    def nav():
     button('주도 섹터·테마 보기').click();page.wait_for_function('()=>DashboardShell.getStatus().page==="sectors"');go('market');button('투자전략 페이지').click();page.wait_for_function('()=>DashboardShell.getStatus().page==="strategy"');go('market');collapsed()
     label=page.locator('.miv-top .miv-controls button').first.inner_text()
     if not label.startswith('미국장 표시'):
      ui_findings.append({'width':width,'status':'FAIL','issue':'US_REGION_LABEL_RESETS_TO_KR_AFTER_ROUTE_RETURN','selector':'.miv-top .miv-controls button:first-child','actualLabel':label});page.screenshot(path=str(args.output/(str(width)+'-region-label.png')))
    record('NAVIGATION_RETURN_COLLAPSES_DETAILS',nav)
    def reload():
     page.reload(wait_until='domcontentloaded');page.wait_for_selector('#devBanner');page.wait_for_selector('.miv-market');settled();collapsed();assert len(page.evaluate('JSON.parse(localStorage.getItem("myinvest_market_priority_v2")).US'))>=7
    record('RELOAD_SESSION_AND_SETTINGS',reload)
    def logout():
     button('시장 국면').click();page.evaluate('logout()');page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert page.locator('.miv-overlay,.miv-legacy-details').count()==0;login();collapsed()
    record('LOGOUT_RELOGIN_CLEANUP',logout)
    if args.all_indicators:
     # Select each real menu option, then make every symbol visible and click it.
     button('지표 편집').click();labels=page.locator('.miv-edit-row input').evaluate_all('(a)=>a.map(x=>x.getAttribute("aria-label"))')
     for label in labels:page.get_by_label(label,exact=True).check()
     page.locator('.miv-dialog button',has_text='순서 저장').click();page.wait_for_function('(ids)=>ids.every(s=>!!Q[s])',arg=SYMBOLS,timeout=30000)
     names={'^KS11':'KOSPI','^KQ11':'KOSDAQ','^GSPC':'S&P 500','^IXIC':'NASDAQ','^DJI':'DOW','^SOX':'SOX','^VIX':'VIX','KRW=X':'USD/KRW','^TNX':'미국 10년물','^IRX':'미국 단기금리','GC=F':'금 선물','CL=F':'WTI 원유','NQ=F':'NASDAQ 선물','ES=F':'S&P 500 선물','YM=F':'DOW 선물','k3':'KOSPI 200 선물','k4':'KOSDAQ 150 선물','TICK':'NYSE $TICK'}
     for sym,name in names.items():
      def check_indicator(sym=sym,name=name):
       button('지표 편집').click();row=page.locator('.miv-edit-row').filter(has=page.get_by_label(name+' 표시',exact=True))
       while row.locator('button',has_text='▲').is_enabled():row.locator('button',has_text='▲').click()
       page.locator('.miv-dialog button',has_text='순서 저장').click();card=page.locator('.miv-indicator').first;assert card.locator('strong').inner_text()==name
       if sym not in ['k4','TICK']:assert '데이터 미연결' not in card.inner_text()
       card.click()
       if sym in ['k3','k4','TICK']:
        assert 'OHLCV 제공처가 연결되지 않았습니다' in page.locator('.miv-graph').inner_text()
       else:page.wait_for_selector('.miv-graph canvas')
       close()
      record(('INDICATOR_UNAVAILABLE_CHART_MESSAGE_' if sym in ['k3','k4','TICK'] else 'INDICATOR_QUOTE_AND_CHART_')+sym,check_indicator)
    def layout():
     assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');assert not errors;assert not any(r['action'] in ['nhQuotes','order','saveExternalHoldings'] for r in requests);page.screenshot(path=str(args.output/(str(width)+'-market.png')))
    record('LAYOUT_AND_SECURITY_BOUNDARY',layout)
   finally:context.close();bridge.terminate();bridge.wait(timeout=5)
 finally:browser.close()
(args.output/'requests-summary.json').write_text(json.dumps([{k:r.get(k) for k in ['action','status','code']} for r in requests],indent=2))
(args.output/'ui-findings.json').write_text(json.dumps(ui_findings,ensure_ascii=False,indent=2))
(args.output/'results.json').write_text(json.dumps(results,indent=2));print(json.dumps({'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results),'mode':mode}))

raise SystemExit(1 if any(row["status"]=="FAIL" for row in results) else 0)
