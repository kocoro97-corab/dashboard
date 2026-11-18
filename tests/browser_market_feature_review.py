"""Focused UI/runtime review. Synthetic session; optional captured PUBLIC feeds.
Never logs tokens, requests live NH, or writes account data. UI defects are evidence
for ChatGPT, not silently patched here. No full-suite replay.
"""
import argparse,json,mimetypes,os,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
from urllib.parse import urlsplit,quote
from playwright.sync_api import sync_playwright
from browser_reference_widgets import fulfill_reference_widget
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
p=argparse.ArgumentParser();p.add_argument('--public-fixture',type=Path);p.add_argument('--widths',type=int,nargs='+',default=[1440,690,344]);p.add_argument('--output',type=Path,default=Path('/tmp/market-feature-review'));args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
BASE='https://kocoro97-corab.github.io/dashboard-v2-dev/';ENDPOINT='https://myinvest-v2-dev-relay.synthetic.workers.dev/api'
LIST='https://m.stock.naver.com/api/stocks/theme?page=1&pageSize=100'
QUERY=['코스피 OR 증시 OR 나스닥 when:2d','(삼성전자 OR SK하이닉스 OR 한미반도체 OR 알테오젠) when:2d']
def bars(sym):
 values=[100+i for i in range(70)];stamp=int(time.time())-80*86400
 return {'chart':{'result':[{'meta':{'symbol':sym,'currency':'KRW' if sym.endswith('.KS') else 'USD','exchangeName':'KSC' if sym.endswith('.KS') else 'NMS'},'timestamp':[stamp+i*86400 for i in range(70)],'indicators':{'quote':[{'open':values,'close':values,'high':[v+2 for v in values],'low':[v-2 for v in values],'volume':[1000]*70}]}}]}}
fixtures={LIST:json.dumps({'groups':[{'no':12,'name':'Synthetic theme','changeRate':'2.0'}]}),'https://m.stock.naver.com/api/stocks/theme/12?page=1&pageSize=100':json.dumps({'stocks':[{'itemCode':'005930','stockName':'Synthetic positive','fluctuationsRatio':'2.0','accumulatedTradingValue':'100','accumulatedTradingVolume':'1000'},{'itemCode':'000660','stockName':'Synthetic negative','fluctuationsRatio':'-2.0','accumulatedTradingValue':'90','accumulatedTradingVolume':'900'}]})}
for sym in ['AAPL','005930.KS']:fixtures['https://query1.finance.yahoo.com/v8/finance/chart/'+sym+'?interval=1d&range=1y']=json.dumps(bars(sym))
for q in QUERY:fixtures['https://news.google.com/rss/search?q='+quote(q,safe="~()*!.'")+'&hl=ko&gl=KR&ceid=KR:ko']='<rss><channel><item><title>Synthetic public review headline</title><link>https://example.com/public-review</link><source>Fixture publisher</source><pubDate>Mon, 16 Nov 2026 01:00:00 GMT</pubDate></item></channel></rss>'
if args.public_fixture:fixtures.update(json.loads(args.public_fixture.read_text()))
mode='CAPTURED_PUBLIC_DATA_WITH_SYNTHETIC_SESSION' if args.public_fixture else 'SYNTHETIC_ONLY'
results=[];observations=[]
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
 artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT);fixture=Path(tmp)/'feeds.json';fixture.write_text(json.dumps(fixtures));browser=pw.chromium.launch(headless=True)
 try:
  for width in args.widths:
   bridge=subprocess.Popen(['node','tests/worker_browser_bridge.mjs'],cwd=ROOT,env=dict(os.environ,MYINVEST_TEST_PUBLIC_FIXTURE=str(fixture)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);port=json.loads(bridge.stdout.readline())['port'];context=browser.new_context(viewport={'width':width,'height':960},timezone_id='Asia/Seoul',service_workers='block');errors=[];actions=[]
   def route(r):
    if fulfill_reference_widget(r):return
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    if r.request.url==ENDPOINT:
     payload={'headers':r.request.headers,'method':r.request.method,'body':r.request.post_data}
     body=json.loads(r.request.post_data or '{}');actions.append(body.get('action'))
     req=urllib.request.Request('http://127.0.0.1:'+str(port),data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
     with urllib.request.urlopen(req,timeout=30) as response:result=json.load(response)
     r.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
    r.abort()
   context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(type(e).__name__));page.set_default_timeout(10000)
   try:
    page.goto(BASE+'index.html#/home',wait_until='domcontentloaded');page.wait_for_selector('#devBanner');page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_selector('#dashboardNav')
    def go(name):
     page.locator('#dashboardNav a[href="#/'+name+'"]').click();page.wait_for_function('(p)=>DashboardShell.getStatus().page===p',arg=name);page.wait_for_function('()=>document.getElementById("pageStatus").textContent.startsWith("연결됨")')
    def record(name,passed,**extra):
     row={'width':width,'test':name,'status':'PASS' if passed else 'FAIL','dataMode':mode,**extra};results.append(row);print(json.dumps(row),flush=True)
    for name in ['home','market','sectors','stocks','strategy','news','accounts','settings']:
     go(name)
     if name=='market':
      page.evaluate('()=>{Q["^KS11"]={p:102,prev:100};Q["^KQ11"]={p:98,prev:100};Q["KRW=X"]={p:100,prev:100}}');go('home');go('market')
      colors={k:page.locator('.miv-indicator .market-'+k).first.evaluate('e=>getComputedStyle(e).color') for k in ['up','down','flat']}
      record('MARKET_DIRECTION_COLORS',colors=={'up':'rgb(255, 119, 119)','down':'rgb(121, 184, 255)','flat':'rgb(231, 238, 249)'},colors=colors)
     if name=='sectors':
      page.wait_for_function('()=>!THM_BUSY&&THM.length>0');record('THEMES_LIST_AND_MEMBERS',page.evaluate('THM.every(t=>t.rows.length>0)'),themeCount=page.evaluate('THM.length'))
      observations.append({'width':width,'screen':'sectors','selector':'.stv2-card p','issue':'Theme return text has no directional class','color':page.locator('.stv2-card p').first.evaluate('e=>getComputedStyle(e).color')})
      # Legacy refresh must notify the new theme adapter without route switching.
      page.evaluate('()=>{THM=[];THM_AT=0}');page.locator('#themesSection button').first.click();page.wait_for_function('()=>!THM_BUSY&&THM.length>0');record('THEMES_REFRESH_RENDERS_V2',page.locator('.stv2-card').count()>0)
     if name=='stocks':
      for sym in ['005930','AAPL']:
       page.locator('#stockSearch').fill(sym);page.locator('.sva-form button').click();page.wait_for_function('(s)=>document.querySelector(".sva").textContent.includes(s+" · 기술적 분석")',arg=sym,timeout=20000)
       request_symbol=sym+'.KS' if sym=='005930' else sym
       feed=json.loads(fixtures['https://query1.finance.yahoo.com/v8/finance/chart/'+request_symbol+'?interval=1d&range=1y'])['chart']['result'][0]
       closes=feed['indicators']['quote'][0]['close'];expected_last=closes[-1];expected_ma20=sum(closes[-20:])/20
       metrics=page.locator('.sva-grid .sva-card').evaluate_all('(rows)=>Object.fromEntries(rows.map(r=>[r.querySelector("small").textContent,r.querySelector("h3").textContent]))')
       actual_last=float(metrics['종가'].replace(',',''));actual_ma20=float(metrics['MA5 / MA20'].split(' / ')[1].replace(',',''))
       record('OHLCV_ANALYSIS_'+sym,abs(actual_last-expected_last)<=.011 and abs(actual_ma20-expected_ma20)<=.011,barCount=len(closes),currency=feed['meta']['currency'])
      metric=page.locator('.sva-card').filter(has=page.locator('small',has_text='직전 봉 대비')).first
      observations.append({'width':width,'screen':'stocks','selector':'.sva-card h3 (직전 봉 대비)','issue':'Return metric lacks directional class','color':metric.locator('h3').evaluate('e=>getComputedStyle(e).color')})
     if name=='news':
      page.wait_for_function('()=>document.querySelectorAll("#nl_mk .news").length>0&&document.querySelectorAll("#nl_hd .news").length>0',timeout=20000);record('RSS_TWO_FEEDS_RENDER',True,marketArticles=page.locator('#nl_mk .news').count(),defaultArticles=page.locator('#nl_hd .news').count())
     if name=='accounts':
      page.wait_for_function('()=>NH_ACCOUNTS.length>0');page.wait_for_selector('.pv-fill.negative');observations.append({'width':width,'screen':'accounts','selector':'.pv-fill.negative','issue':'Negative profit bar background remains red','background':page.locator('.pv-fill.negative').first.evaluate('e=>getComputedStyle(e).backgroundColor')});page.locator('.portfolio-visuals .pv-panel').nth(2).screenshot(path=str(args.output/(str(width)+'-accounts-profit.png')))
     page.screenshot(path=str(args.output/(str(width)+'-'+name+'.png')));record('PAGE_'+name.upper(),page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
    page.evaluate('logout()');page.wait_for_function('()=>DashboardShell.getStatus().page===null');record('LOGOUT_CLEANUP',page.locator('#pageViewport').inner_text()=='' and page.locator('.miv-overlay,.nev5-overlay').count()==0)
    record('NO_BROWSER_ERRORS_OR_WRITES',not errors and not any(a in actions for a in ['order','saveExternalHoldings','restoreExternalHoldings']),browserErrors=len(errors))
   finally:context.close();bridge.terminate();bridge.wait(timeout=5)
 finally:browser.close()
(args.output/'results.json').write_text(json.dumps({'results':results,'uiFindings':observations},ensure_ascii=False,indent=2));print(json.dumps({'status':'PASS' if all(r['status']=='PASS' for r in results) else 'FAIL','checks':len(results),'uiFindings':len(observations),'mode':mode,'realNhCalls':0,'orderCalls':0}))
