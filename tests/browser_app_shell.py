"""Modular routes against synthetic authenticated data. Zero live NH/storage calls."""
import ast,base64,copy,json,mimetypes,sys,tempfile
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
from browser_reference_widgets import fulfill_reference_widget
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
from relay.app import RelayApp,RelayFault
from relay.public_dev import PublicDevelopment
from test_relay import configuration,EXPECTED,request,TOKEN
ns=dict(json=json,urlsplit=urlsplit,RelayFault=RelayFault,TOKEN=TOKEN,EXPECTED=EXPECTED)
tree=ast.parse((ROOT/'tests/browser_public_market.py').read_text())
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Gas'],type_ignores=[]),'existing-public-fixture','exec'),ns)
ORIGIN='https://kocoro97-corab.github.io';PAGE=ORIGIN+'/dashboard-v2-dev/index.html';HOST='synthetic-shell.trycloudflare.com';ENDPOINT='https://'+HOST+'/api';CODE='SYNTHETIC_PRIVATE_DEVELOPMENT_CODE'
pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=')
fixture=json.loads((ROOT/'tests/fixtures/isa-ocr.json').read_text())
class Gas(ns['Gas']):
 def __init__(self):
  super().__init__();self.rows=[dict(fixture['expected'][0],accountType='ISA',source='saved')];self.revision=1;self.history=[]
 def post(self,body):
  action=body['action']
  if action in ('appVersion','login','sessionInfo','logout'):return super().post(body)
  self.calls.append(action)
  if action=='nhAccounts':return {'success':True,'gatewayVersion':2,'updatedAt':'synthetic observation',
   'accounts':[{'accountKey':'a'*64,'acctType':'01','errors':[],'domestic':{'partial':False,'holdings':[{'code':'035720','name':'Synthetic domestic','currency':'KRW','quantity':1,'avgPrice':100,'currentPrice':110,'evalAmount':110,'profit':10}]},'overseas':{'partial':False,'holdings':[{'code':'TEST','instrumentId':'US:XNAS:TEST','name':'Synthetic overseas','currency':'USD','quantity':1,'avgPrice':4,'currentPrice':5,'evalAmount':6000,'profit':-1000}]}}]}
  if action=='externalHoldings':return {'success':True,'storeVersion':2,'revision':'r'+str(self.revision),'holdings':self.rows}
  if action=='nhExternalQuotes':return {'success':True,'prices':{code:{'price':200} for code in body['codes']},'errors':{}}
  if action=='externalHistory':return {'success':True,'history':self.history}
  if action in ('saveExternalHoldings','restoreExternalHoldings'):
   assert body['confirmReplace'] is True and body['expectedRevision']=='r'+str(self.revision)
   rows=body['holdings'] if action=='saveExternalHoldings' else next(row['holdings'] for row in self.history if row['snapshotId']==body['snapshotId'])
   self.history.insert(0,{'snapshotId':'synthetic-'+str(self.revision),'createdAt':'synthetic timestamp','reason':action,'holdings':copy.deepcopy(self.rows)})
   self.rows=copy.deepcopy(rows);self.revision+=1;return {'success':True,'storeVersion':2,'revision':'r'+str(self.revision),'count':len(rows)}
  if action=='nhQuotes':return {'success':True,'data':{},'errors':{}}
  if action=='protectedHoldings':return {'success':True,'holdings':[]}
  raise AssertionError('UNEXPECTED_ACTION')
 def public(self,url,token):
  u=urlsplit(url)
  if u.hostname!='query1.finance.yahoo.com':return super().public(url,token)
  symbol=unquote(u.path.rsplit('/',1)[-1]);out=json.loads(super().public(url,token));out['chart']['result'][0]['meta'].update(symbol=symbol,regularMarketTime=1794528000,currency='KRW' if symbol=='KRW=X' else 'USD');return json.dumps(out)

with tempfile.TemporaryDirectory() as tmp,sync_playwright() as p:
 artifact=Path(tmp)/'public';build(artifact,use_public_config=False);browser=p.chromium.launch(headless=True)
 try:
  for development,width in [(True,1440),(True,344),(True,690),(False,1440)]:
   gas=Gas();edge=PublicDevelopment(RelayApp(configuration(origins=frozenset({ORIGIN}),public_market=True),gas),ORIGIN+'/dashboard-v2-dev/',CODE);edge.host=HOST
   context=browser.new_context(viewport={'width':width,'height':900},timezone_id='Asia/Seoul',service_workers='block');errors=[];unexpected=[]
   def route(r):
    if fulfill_reference_widget(r):return
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     folder=artifact if development else ROOT;file=folder/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and folder in file.resolve().parents:
      raw=file.read_bytes()
      if not development and file.name=='index.html':raw=raw.replace(b'<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script>',b'')
      r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=raw);return
    # The optional public-only briefing feed is intentionally absent in this fixture.
    # Permit ONLY this fixed same-origin JSON path; no broad host whitelist.
    if r.request.method=='GET' and r.request.url=='https://kocoro97-corab.github.io/dashboard-v2-dev/data/myinvest-public-briefings-v1.json':
     r.fulfill(status=404,content_type='application/json',body='');return
    if r.request.url==ENDPOINT:
     h=r.request.headers;result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''))
     r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
    if not development and u.hostname=='script.google.com':
     if r.request.method=='POST':data=gas.post(json.loads(r.request.post_data or '{}'));r.fulfill(content_type='application/json',body=json.dumps(data))
     else:
      from urllib.parse import parse_qs
      try:r.fulfill(content_type='text/plain',body=gas.public(parse_qs(u.query)['url'][0],TOKEN))
      except RelayFault:r.fulfill(status=401,content_type='application/json',body=json.dumps({'success':False,'error':'AUTH_REQUIRED'}))
     return
    if not development and u.hostname=='s3.tradingview.com':r.fulfill(content_type='application/javascript',body='');return
    unexpected.append(u.hostname);r.abort()
   context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(type(e).__name__));page.on('dialog',lambda d:d.accept())
   page.goto(PAGE+'#/accounts/ocr',wait_until='domcontentloaded')
   # Wait for async scripts: a DOMContentLoaded-only resource snapshot can miss eager OCR.
   page.wait_for_load_state('load',timeout=30000)
   startup=page.evaluate("""() => {
     const urls=performance.getEntriesByType('resource').map(x=>x.name);
     return {
       ocrBeforeLogin:urls.filter(x=>x.includes('tesseract.min.js')).length,
       catalogBeforeLogin:urls.filter(x=>x.includes('/data/us-instruments.json')).length
     };
   }""")
   assert startup['ocrBeforeLogin']==0 and startup['catalogBeforeLogin']==0,startup
   if development:
    page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click()
    page.wait_for_function("()=>!!document.getElementById('devBanner')||document.getElementById('devConnectStatus').textContent.includes('(')")
    assert page.locator('#devBanner').count(),{'connection':page.locator('#devConnectStatus').inner_text(),'errors':errors,'unexpected':unexpected}
   page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function("()=>window.DashboardShell?.getStatus().path==='/accounts/ocr'")
   page.wait_for_function('()=>!!EXT_MASTER')
   if not development:page.wait_for_function("()=>EXT_SAVED_REV==='r1'")
   ocr_before_upload=page.evaluate("()=>performance.getEntriesByType('resource').filter(x=>x.name.includes('tesseract.min.js')).length")
   page.locator('#externalOpenImport').click()
   page.evaluate('data=>window.Tesseract={recognize:async()=>({data})}',fixture['data'])
   page.locator('#externalImageFiles').set_input_files([{'name':'synthetic-1.png','mimeType':'image/png','buffer':pixel},{'name':'synthetic-2.png','mimeType':'image/png','buffer':pixel}]);page.locator('#externalUploadBtn').click();page.wait_for_function("()=>$('externalUploadBtn').disabled===false&&EXT_ASSETS.length>0")
   page.get_by_role('button',name='닫기 ✕',exact=True).click()
   count=page.evaluate('EXT_ASSETS.length');assert count==len(fixture['expected'])
   token=page.evaluate("LS('invest_session_token')")
   def go(path):
    if path.startswith('/accounts/') and not page.locator('a[href="#'+path+'"]').count():
     page.locator('#dashboardNav a[href="#/accounts"]').click();page.wait_for_function("()=>DashboardShell.getStatus().page==='accounts'")
    page.locator('a[href="#'+path+'"]').first.click();page.wait_for_function('(path)=>DashboardShell.getStatus().path===path',arg=path)
   go('/home');page.wait_for_function('()=>!MK_BUSY');home_top=page.locator('#pageViewport').evaluate('e=>{e.scrollTop=90;return e.scrollTop}')
   for path in ['/market','/sectors','/stocks','/strategy','/news','/settings','/accounts']:
    go(path);page.wait_for_function("()=>!DashboardShell.getStatus().pages.some(p=>p.status==='loading')",timeout=30000)
    assert page.evaluate("LS('invest_session_token')")==token
    assert page.locator('#pageViewport .page-content').count()==1
    if path=='/market':assert not page.locator('#marketSection').is_visible()
   if development:
    go('/diagnostics')
    panel=page.locator('#devBrowserPerformance')
    assert panel.count()==1
    panel.locator('summary').click()
    page.wait_for_function("()=>document.querySelector('#devBrowserPerformanceResults')?.textContent.includes('JavaScript 요청')")
    assert '대기 중인 읽기 요청' in page.locator('#devBrowserPerformanceResults').inner_text()
    assert page.evaluate("()=>{const s=DashboardTransport.readState();return Number.isInteger(s.active)&&Number.isInteger(s.queued)&&Number.isInteger(s.limit)&&Number.isFinite(s.backpressureMs)}")
    # Content is already populated; the details disclosure is explicitly opened
    # before testing layout visibility to avoid relying on toggle-event timing.
    panel.evaluate("e=>e.open=true")
    assert page.locator('#devBrowserPerformanceResults').is_visible()
    assert page.evaluate("()=>MYInvestWebPerformance.browserSnapshot().containsPrivateFields===false")
    go('/home')
   # Synthetic, anonymous performance evidence: never print accounts, tokens or request URLs.
   # CI wall-clock timings vary between runs; record them without brittle thresholds.
   perf=page.evaluate("""() => {
     const observed=window.MYInvestWebPerformance?.snapshot?.();
     const nav=performance.getEntriesByType('navigation')[0];
     const resources=performance.getEntriesByType('resource');
     const publicScripts=resources.filter(x=>x.name.includes('/js/'));
     const ocrScripts=resources.filter(x=>x.name.includes('tesseract.min.js'));
     const menuMedian={};
     for(const [name,stats] of Object.entries(observed?.summary||{}))
       menuMedian[name]={count:stats.count,medianMs:stats.medianMs,maxMs:stats.maxMs};
     return {
       initialDomContentLoadedMs:Math.round(nav?.domContentLoadedEventEnd??0),
       firstPartyScriptRequests:publicScripts.length,
       ocrRequestsAfterUpload:ocrScripts.length,
       routeSamples:observed?.samples?.length??0,
       menuMedianMs:menuMedian,
       anonymous:observed?.containsPrivateFields===false&&observed?.memoryOnly===true
     };
   }""")
   perf['ocrRequestsBeforeUpload']=ocr_before_upload
   perf.update(startup)
   assert perf['anonymous'] and perf['ocrRequestsAfterUpload']>=ocr_before_upload,perf
   print('PERF_SYNTHETIC '+json.dumps({'development':development,'width':width,**perf},sort_keys=True),flush=True)
   go('/accounts/ocr');assert page.evaluate('EXT_ASSETS.length')==count and page.locator('#externalAssetSection').is_visible()
   for sub in ['overview','nh','special','holdings','analysis']:
    go('/accounts/'+sub);assert page.evaluate('EXT_ASSETS.length')==count
    assert 'NaN' not in page.locator('#pageViewport').inner_text()
    if sub=='holdings':assert page.get_by_role('heading',name='동일 종목 통합 수량·평균매입가').is_visible()
    if sub=='nh':assert page.locator('#nhAccountSection').is_visible()
   go('/accounts/ocr')
   page.get_by_role('button',name='계좌 연결 상태 확인',exact=True).click();page.wait_for_function("()=>$('accountConnectionStatus').textContent.includes('GAS V2 연결 확인')")
   if development and width==344:
    page.set_viewport_size({'width':690,'height':900});page.set_viewport_size({'width':344,'height':900});assert page.evaluate('EXT_ASSETS.length')==count and page.evaluate("LS('invest_session_token')")==token
   if not development:
    page.locator('#externalSaveBtn').click();page.wait_for_function("()=>$('externalStatus').textContent.includes('저장 완료')")
    saved=copy.deepcopy(gas.rows);page.locator('#externalAssetRows tr').first.locator('button').click();page.locator('#externalSaveBtn').click();page.wait_for_function("()=>EXT_SAVED_REV==='r3'")
    page.locator('button[onclick="showExternalHistory()"]').click();page.locator('#externalHistory').evaluate('e=>e.parentElement.open=true');page.locator('#externalHistory button').first.click();page.wait_for_function("()=>$('externalStatus').textContent.includes('복원 완료')");assert gas.rows==saved
   go('/home');assert page.locator('#pageViewport').evaluate('e=>e.scrollTop')==home_top
   if not development:
    page.evaluate("LS('invest_external_settings',{auto:true,minutes:10})");go('/accounts');assert page.evaluate('EXT_AUTO_TIMER!==null');go('/home');assert page.evaluate('EXT_AUTO_TIMER===null')
   before=Counter(gas.reads);go('/market');go('/home');page.wait_for_timeout(100);assert Counter(gas.reads)==before
   if development:
    go('/market');assert not page.locator('#marketSection').is_visible();page.get_by_role('button',name='거시경제 분석',exact=True).click();macro=page.locator('#workMacroLivePreview');macro.get_by_role('button',name='거시경제 분석 · 실제 시세로 열기',exact=True).click();page.wait_for_function("()=>document.querySelectorAll('#workMacroLivePreview .macro-card').length>0",timeout=60000)
    page.locator('.miv-overlay').get_by_role('button',name='✕ 닫기',exact=True).click();go('/home');assert macro.locator('.work-macro').count()==0
   page.go_back();page.wait_for_function("()=>DashboardShell.getStatus().path==='/market'");page.go_forward();page.wait_for_function("()=>DashboardShell.getStatus().path==='/home'")
   page.reload(wait_until='domcontentloaded');page.wait_for_function("()=>DashboardShell.getStatus().path==='/home'");assert page.evaluate("LS('invest_session_token')")==token
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   page.evaluate('logout()');page.wait_for_function("()=>DashboardShell.getStatus().page===null");assert page.evaluate('EXT_ASSETS.length')==0
   page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function("()=>DashboardShell.getStatus().page==='home'")
   go('/accounts/ocr');page.locator('#externalOpenImport').click();assert page.locator('#externalImageFiles').is_visible();assert not errors and not unexpected,(errors,unexpected)
   page.get_by_role('button',name='닫기 ✕',exact=True).click()
   page.evaluate("()=>DashboardShell.connect('settings',()=>({mount(){throw Error('SYNTHETIC_PAGE_FAILURE')},refresh(){},unmount(){throw Error('SYNTHETIC_UNMOUNT_FAILURE')},getStatus(){throw Error('SYNTHETIC_STATUS_FAILURE')}}))")
   go('/settings');assert '이 페이지 처리 실패' in page.locator('#pageStatus').inner_text();go('/home');assert page.locator('#pageViewport>.page-content').count()==1;assert not errors
   if development:assert set(gas.calls)<={'appVersion','login','sessionInfo','logout'}
   print(json.dumps({'status':'PASS','scope':'SYNTHETIC_MODULAR_BROWSER','development':development,'width':width,'routes':8,'deepLinkReloadHistory':'PASS','sessionAndDraftPreserved':'PASS','twoImageOcrDedup':'PASS','noDuplicatePageReads':'PASS','scrollRestored':'PASS','logoutAndRelogin':'PASS','saveRestore':'BLOCKED_AS_BEFORE' if development else 'PASS_SYNTHETIC','actualNhCalls':0,'realStorageWrites':0}),flush=True)
   context.close()
 finally:browser.close()
