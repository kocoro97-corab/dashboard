"""No development code input: real Worker policy + synthetic GAS + built Pages."""
import json,mimetypes,subprocess,sys,tempfile,urllib.request
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
from browser_reference_widgets import fulfill_reference_widget
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build
ORIGIN='https://kocoro97-corab.github.io';PAGE=ORIGIN+'/dashboard-v2-dev/index.html#/accounts';ENDPOINT='https://myinvest-v2-dev-relay.synthetic.workers.dev/api'
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as pw:
 artifact=Path(tmp)/'public';build(artifact,relay_endpoint=ENDPOINT);browser=pw.chromium.launch(headless=True)
 try:
  for width in [1440,690,344]:
   bridge=subprocess.Popen(['node','tests/worker_browser_bridge.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);port=json.loads(bridge.stdout.readline())['port'];context=browser.new_context(viewport={'width':width,'height':960},service_workers='block');errors=[];unexpected=[];posted=[]
   def route(r):
    if fulfill_reference_widget(r):return
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    if r.request.url==ENDPOINT:
     h=r.request.headers;assert 'x-myinvest-dev-key' not in h and h.get('authorization')!='Bearer '+'f'*64
     payload={'headers':h,'method':r.request.method,'body':r.request.post_data};posted.append((r.request.method,json.loads(r.request.post_data or '{}').get('action')))
     req=urllib.request.Request('http://127.0.0.1:'+str(port),data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
     with urllib.request.urlopen(req,timeout=15) as response:result=json.load(response)
     r.fulfill(status=result['status'],headers=result['headers'],body=result['body']);return
    unexpected.append(u.hostname);r.abort()
   context.add_init_script("if(!sessionStorage.getItem('myinvest_v2_dev:connection')){sessionStorage.setItem('myinvest_v2_dev:connection',JSON.stringify({endpoint:'https://old.synthetic.trycloudflare.com/api',code:'SYNTHETIC_OLD_CODE'}));sessionStorage.setItem('myinvest_v2_dev:invest_session_token',JSON.stringify('f'.repeat(64)));localStorage.setItem('invest_session_token','PRODUCTION_CANARY_UNCHANGED')}");context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(PAGE,wait_until='domcontentloaded');page.wait_for_selector('#devBanner');assert page.locator('#devEndpoint,#devCode').count()==0
   page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function('()=>!!EXT_SAVED_REV&&NH_ACCOUNT_SESSION===LS("invest_session_token")');assert page.locator('#nhAccountBtn').is_enabled();assert page.locator('#nhAccountRows tr').count()==2;assert page.evaluate('AppContext.create().snapshot().knownSubtotal')==1000;page.locator('#dashboardNav a[href="#/market"]').click();page.wait_for_function('()=>Q["^GSPC"]?.p===102');token=page.evaluate('LS("invest_session_token")')
   page.reload(wait_until='domcontentloaded');page.wait_for_selector('#devBanner');page.wait_for_function('()=>DashboardShell.getStatus().page==="market"');assert page.evaluate('LS("invest_session_token")')==token
   assert page.evaluate('JSON.parse(sessionStorage.getItem("myinvest_v2_dev:connection")).kind')=='persistent'
   page.evaluate('logout()');page.wait_for_function('()=>DashboardShell.getStatus().page===null');assert page.evaluate('NH_ACCOUNTS.length===0&&EXT_ASSETS.length===0');assert page.evaluate('localStorage.getItem("invest_session_token")')=='PRODUCTION_CANARY_UNCHANGED';assert not errors and not unexpected,(errors,unexpected);assert all(action not in ['order','saveExternalHoldings'] for _,action in posted)
   print(json.dumps({'status':'PASS','scope':'SYNTHETIC_PERSISTENT_WORKER_PAGES','width':width,'usernamePasswordOnly':'PASS','reloadSession':'PASS','privateAccountReads':'PASS_SYNTHETIC','publicMarket':'PASS_SYNTHETIC','oldTokenNotReplayed':'PASS','logout':'PASS','realNhCalls':0,'realStorageWrites':0}),flush=True);context.close();bridge.terminate();bridge.wait(timeout=5)
 finally:browser.close()
