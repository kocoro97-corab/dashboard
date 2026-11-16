"""Approved capability through real relay policy and synthetic GAS/store only."""
import argparse,ast,copy,json,mimetypes,sys,tempfile
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
from relay.app import RelayApp,RelayFault
from relay.public_dev import PublicDevelopment
from relay.account_scope import FIXTURE
from test_relay import configuration,EXPECTED,request,TOKEN
fixture=json.loads((ROOT/'tests/fixtures/isa-ocr.json').read_text())
ns=dict(json=json,urlsplit=urlsplit,unquote=unquote,copy=copy,RelayFault=RelayFault,TOKEN=TOKEN,EXPECTED=EXPECTED,fixture=fixture)
ns['ns']=ns
for filename in ['browser_public_market.py','browser_app_shell.py']:
 tree=ast.parse((ROOT/'tests'/filename).read_text());exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Gas'],type_ignores=[]),'existing-synthetic-fixture','exec'),ns)
Base=ns['Gas']
class Gas(Base):
 def post(self,payload):
  if payload['action'] not in ['appVersion','login','sessionInfo','logout'] and (not self.live or payload.get('token')!=TOKEN):return {'success':False,'code':'AUTH_REQUIRED'}
  result=super().post(payload)
  if payload['action'] in ['login','sessionInfo'] and result.get('success'):result['isAdmin']=True
  return result
ORIGIN='https://kocoro97-corab.github.io';PAGE=ORIGIN+'/dashboard-v2-dev/index.html#/accounts/nh';HOST='synthetic-accounts.trycloudflare.com';ENDPOINT='https://'+HOST+'/api';CODE='SYNTHETIC_PRIVATE_DEV_CODE'
parser=argparse.ArgumentParser();parser.add_argument('--management-only',action='store_true');args=parser.parse_args()
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as p:
 artifact=Path(tmp)/'public';build(artifact,use_public_config=False);browser=p.chromium.launch(headless=True)
 try:
  for mode,width in [('test',1440),('test',344),('test',690),('management',1440),('management',344),('management',690)]:
   if args.management_only and mode!='management':continue
   gas=Gas();gas.rows=[] if mode=='test' else [dict(fixture['expected'][0],accountType='ISA',source='ocr',quantity=777,avgPrice=888)]
   app=RelayApp(configuration(origins=frozenset({ORIGIN}),public_market=True,account_reads=True,external_test_store=mode=='test',external_store=mode=='management',test_store_user='nh_test_v2'),gas)
   edge=PublicDevelopment(app,ORIGIN+'/dashboard-v2-dev/',CODE);edge.host=HOST;errors=[];unexpected=[]
   context=browser.new_context(viewport={'width':width,'height':900},service_workers='block')
   def route(r):
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    if r.request.url==ENDPOINT:
     h=r.request.headers;result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''))
     r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
    unexpected.append(u.hostname);r.abort()
   dialog={'accept':True}
   context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(type(e).__name__));page.on('dialog',lambda d:d.accept() if dialog['accept'] else d.dismiss())
   page.goto(PAGE,wait_until='domcontentloaded');page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click();page.wait_for_selector('#devBanner')
   page.locator('#authId').fill('nh_test_v2');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click()
   page.wait_for_function("()=>EXT_SAVED_REV==='r1'&&NH_ACCOUNT_SESSION===LS('invest_session_token')")
   assert page.locator('#nhAccountBtn').is_enabled() and page.locator('#nhAccountRows tr').count()==2
   assert gas.calls.count('nhAccounts')==1 and 'protectedHoldings' not in gas.calls
   page.get_by_role('button',name='계좌 연결 상태 확인',exact=True).click();page.wait_for_function("()=>$('accountConnectionStatus').textContent.includes('격리 계좌 읽기 허용')")
   if mode=='test':
    page.locator('a[href="#/accounts/ocr"]').click();page.get_by_role('button',name='합성 저장 검증자료 불러오기',exact=True).click();page.wait_for_function('()=>EXT_ASSETS.length===3')
    assert not any(action=='saveExternalHoldings' for action in gas.calls)
    page.locator('#externalSaveBtn').click();page.wait_for_function("()=>EXT_SAVED_REV==='r2'")
    assert gas.rows==json.loads(FIXTURE.read_text())
    page.locator('a[href="#/accounts/holdings"]').click();assert '합성 저장 검증자료 3행은 실제 자산 합계' in page.locator('#pageViewport').inner_text()
    assert page.evaluate('AppContext.create().snapshot().details.length')==2
    page.locator('a[href="#/accounts/ocr"]').click();page.locator('button[onclick="showExternalHistory()"]').click();page.locator('#externalHistory').evaluate('e=>e.parentElement.open=true');page.locator('#externalHistory button').first.click();page.wait_for_function("()=>EXT_SAVED_REV==='r3'");assert gas.rows==[]
    # Unsafe existing data remains untouched even if a caller directly invokes save.
    gas.rows=[{'accountType':'ISA','code':'035720','name':'UNAPPROVED SYNTHETIC CANARY','quantity':999,'avgPrice':999,'source':'ocr'}]
    before=gas.calls.count('saveExternalHoldings')
    result=page.evaluate("async rows=>{const r=await post({action:'saveExternalHoldings',token:LS('invest_session_token'),holdings:rows,expectedRevision:'r3',confirmReplace:true});return (await r.json()).code}",json.loads(FIXTURE.read_text()))
    assert result=='TEST_STORE_EXISTING_DATA_PROTECTED' and gas.calls.count('saveExternalHoldings')==before
   else:
    page.locator('a[href="#/accounts/ocr"]').click()
    assert page.locator('#externalImageFiles').is_enabled() and page.locator('#externalAutoRefresh').is_enabled()
    assert page.locator('#externalDriveFolder').is_disabled() and page.locator('#loadAccountTestData').is_hidden()
    quantity=page.locator('#externalAssetRows tr').first.locator('input[type="number"]').first;quantity.fill('778');quantity.press('Tab')
    before=gas.calls.count('saveExternalHoldings')
    dialog['accept']=False;page.locator('#externalSaveBtn').click();assert gas.calls.count('saveExternalHoldings')==before
    dialog['accept']=True;page.locator('#externalSaveBtn').click();page.wait_for_function("()=>EXT_SAVED_REV==='r2'");assert gas.rows[0]['quantity']==778
    page.evaluate('loadExternalAssets()');assert page.evaluate('EXT_ASSETS[0].quantity')==778
    page.locator('button[onclick="showExternalHistory()"]').click();page.locator('#externalHistory').evaluate('e=>e.parentElement.open=true');page.locator('#externalHistory button').first.click();page.wait_for_function("()=>EXT_SAVED_REV==='r3'");assert gas.rows[0]['quantity']==777
    before=gas.calls.count('saveExternalHoldings')
    code=page.evaluate("async()=>{const r=await post({action:'saveExternalHoldings',token:LS('invest_session_token'),holdings:[],expectedRevision:EXT_SAVED_REV,confirmReplace:true,userId:'other'});return (await r.json()).code}")
    assert code=='RELAY_BAD_REQUEST' and gas.calls.count('saveExternalHoldings')==before
   token=page.evaluate("LS('invest_session_token')");page.reload(wait_until='domcontentloaded');page.wait_for_function("()=>!!document.getElementById('devBanner')&&DashboardShell.getStatus().page==='accounts'");assert page.evaluate("LS('invest_session_token')")==token
   page.wait_for_function('()=>!NH_ACCOUNT_BUSY&&!!EXT_SAVED_REV');gas.live=False
   page.evaluate('loadNHAccounts()');assert '조회 실패' in page.locator('#nhAccountStatus').text_content();assert page.evaluate('AppContext.create().snapshot().complete===false')
   page.evaluate("()=>{LS('invest_last_active',Date.now()-SESSION_MS-1);renderSession()}");page.wait_for_function("()=>DashboardShell.getStatus().page===null");assert page.evaluate('NH_ACCOUNTS.length===0&&EXT_ASSETS.length===0')
   page.locator('#authId').fill('nh_test_v2');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function("()=>NH_ACCOUNT_SESSION===LS('invest_session_token')&&!!EXT_SAVED_REV")
   page.evaluate('logout()');page.wait_for_function("()=>DashboardShell.getStatus().page===null")
   assert not errors and not unexpected,(errors,unexpected)
   print(json.dumps({'status':'PASS','scope':'SYNTHETIC_HTTPS_ACCOUNT_CAPABILITY','mode':mode,'width':width,'privateRead':'PASS','sourceScopeGuard':'PASS','syntheticSaveReadRestore':'PASS','existingDataProtected':'PASS_FIXED_FIXTURE' if mode=='test' else 'PASS_REVIEW_CANCEL_AND_USER_ISOLATION','testDataExcludedFromRealTotals':'PASS' if mode=='test' else 'NOT_RUN','reloadAndLogout':'PASS','actualNhCalls':0,'realStorageWrites':0}),flush=True)
   context.close()
 finally:browser.close()
