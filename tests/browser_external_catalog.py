"""Synthetic broker/account CRUD -> two-image OCR -> existing store/recovery UI."""
import ast,base64,copy,json,mimetypes,sys,tempfile
from pathlib import Path
from urllib.parse import urlsplit,unquote
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build
from relay.app import RelayApp,RelayFault
from relay.public_dev import PublicDevelopment
from test_relay import configuration,EXPECTED,request,TOKEN
fixture=json.loads((ROOT/'tests/fixtures/isa-ocr.json').read_text());ns=dict(json=json,copy=copy,urlsplit=urlsplit,unquote=unquote,RelayFault=RelayFault,EXPECTED=EXPECTED,TOKEN=TOKEN,fixture=fixture);ns['ns']=ns
for filename in ['browser_public_market.py','browser_app_shell.py']:
 tree=ast.parse((ROOT/'tests'/filename).read_text());exec(compile(ast.Module(body=[x for x in tree.body if isinstance(x,ast.ClassDef) and x.name=='Gas'],type_ignores=[]),'existing-fixture','exec'),ns)
Base=ns['Gas']
class Gas(Base):
 def __init__(self):super().__init__();self.rows=[];self.accounts=[];self.brokers=[];self.catalog=1
 def post(self,body):
  action=body['action']
  if action in ['externalAccounts','saveExternalAccounts']:
   self.calls.append(action)
   if not self.live or body.get('token')!=TOKEN:return {'success':False,'code':'AUTH_REQUIRED'}
   if action=='saveExternalAccounts':
    if body.get('expectedRevision')!='c'+str(self.catalog):return {'success':False,'code':'STORE_CONFLICT','layer':'storage'}
    assert body['confirmReplace'] is True
    self.accounts=copy.deepcopy(body['accounts']);self.brokers=copy.deepcopy(body['brokers']);self.catalog+=1
   return {'success':True,'accounts':copy.deepcopy(self.accounts),'brokers':self.brokers,'revision':'c'+str(self.catalog),'catalogVersion':1}
  result=super().post(body)
  if action in ['login','sessionInfo'] and result.get('success'):result['isAdmin']=True
  if action in ['appVersion','externalHoldings']:result['externalAccountCatalogVersion']=1
  return result
ORIGIN='https://kocoro97-corab.github.io';PAGE=ORIGIN+'/dashboard-v2-dev/index.html#/accounts/ocr';HOST='synthetic-catalog.trycloudflare.com';ENDPOINT='https://'+HOST+'/api';CODE='SYNTHETIC_PRIVATE_CATALOG_CODE'
pixel=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=')
with tempfile.TemporaryDirectory() as tmp,sync_playwright() as p:
 artifact=Path(tmp)/'public';build(artifact,use_public_config=False);browser=p.chromium.launch(headless=True)
 try:
  for width in [1440,344]:
   gas=Gas();app=RelayApp(configuration(origins=frozenset({ORIGIN}),public_market=True,account_reads=True,external_store=True),gas);edge=PublicDevelopment(app,ORIGIN+'/dashboard-v2-dev/',CODE);edge.host=HOST
   context=browser.new_context(viewport={'width':width,'height':900},service_workers='block');errors=[];unexpected=[]
   def route(r):
    u=urlsplit(r.request.url)
    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
     file=artifact/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
     if file.is_file() and artifact in file.resolve().parents:r.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',body=file.read_bytes());return
    if r.request.url==ENDPOINT:
     h=r.request.headers;result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''))
     r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
    unexpected.append(u.hostname);r.abort()
   context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
   page.goto(PAGE,wait_until='domcontentloaded');page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click();page.wait_for_selector('#devBanner')
   page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click();page.wait_for_function("()=>EXT_SAVED_REV==='r1'&&ExternalAccountUI.capable()")
   assert page.locator('.account-nav a').all_text_contents()==['전체 자산','통합보유종목','일반계좌','ISA·연금·IRP','외부계좌','자산·손익 분석']
   def create(broker,alias):
    page.get_by_role('button',name='+ 외부계좌 추가',exact=True).click();page.locator('#externalAccountBroker').fill(broker);page.locator('#externalAccountAlias').fill(alias);page.select_option('#externalAccountKind','GENERAL');before=len(gas.accounts);page.get_by_role('button',name='계좌 정보 저장',exact=True).click();page.wait_for_function('(n)=>ExternalAccountUI.list().length===n',arg=before+1)
   create('가 합성증권','첫 계좌');create('가 합성증권','둘째 계좌');create('나 합성증권','빈 계좌');ids=[x['id'] for x in gas.accounts]
   assert len(set(ids))==3
   first=page.locator('#externalAccountCatalogRows tr').filter(has_text='첫 계좌');first.get_by_role('button',name='자료 입력',exact=True).click();assert page.locator('#externalImportDialog').is_visible()
   page.evaluate('data=>window.Tesseract={recognize:async()=>({data})}',fixture['data']);page.locator('#externalImageFiles').set_input_files([{'name':'synthetic-a.png','mimeType':'image/png','buffer':pixel},{'name':'synthetic-b.png','mimeType':'image/png','buffer':pixel}]);page.locator('#externalUploadBtn').click();page.wait_for_function('()=>EXT_ASSETS.length===7&&!$("externalUploadBtn").disabled')
   assert page.evaluate('EXT_ASSETS.every(x=>x.accountId===ExternalAccountUI.selection().id)')
   page.get_by_role('button',name='닫기 ✕',exact=True).click();assert page.locator('#externalImportDialog').is_hidden()
   second=page.locator('#externalAccountCatalogRows tr').filter(has_text='둘째 계좌');second.get_by_role('button',name='자료 입력',exact=True).click()
   for key,value in {'Code':'035720','Name':'카카오','Qty':'2','Avg':'100'}.items():page.locator('#externalManual'+key).fill(value)
   page.locator('#externalManualAddBtn').click();assert page.evaluate('EXT_ASSETS.length')==8
   page.keyboard.press('Escape');assert page.locator('#externalImportDialog').is_hidden();assert page.locator('#externalOpenImport').evaluate('e=>e===document.activeElement')
   page.locator('#externalSaveBtn').click();page.wait_for_function("()=>EXT_SAVED_REV==='r2'");assert len(gas.rows)==8 and len({x['accountId'] for x in gas.rows})==2
   page.evaluate('loadExternalAssets()');assert page.evaluate('EXT_ASSETS.length')==8
   first.get_by_role('button',name='삭제',exact=True).click();assert len(gas.accounts)==3 and '보유종목' in page.locator('#externalCatalogStatus').inner_text()
   empty=page.locator('#externalAccountCatalogRows tr').filter(has_text='빈 계좌');empty.get_by_role('button',name='삭제',exact=True).click();page.wait_for_function('()=>ExternalAccountUI.list().length===2')
   first.get_by_role('button',name='수정',exact=True).click();page.locator('#externalAccountAlias').fill('수정 계좌');page.get_by_role('button',name='계좌 정보 저장',exact=True).click();page.wait_for_function("()=>ExternalAccountUI.list().some(x=>x.accountName==='수정 계좌')")
   page.locator('#externalBrokerCatalogRows tr').filter(has_text='가 합성증권').get_by_role('button',name='수정',exact=True).click();page.locator('#externalBrokerEdit').fill('다 합성증권');page.get_by_role('button',name='증권사 추가·수정',exact=True).click();page.wait_for_function("()=>ExternalAccountUI.list().every(x=>x.broker==='다 합성증권')")
   position=page.locator('#externalAssetRows tr').first.locator('input[type="number"]').first;position.fill('202');position.press('Tab');page.locator('#externalSaveBtn').click();page.wait_for_function("()=>EXT_SAVED_REV==='r3'")
   page.locator('button[onclick="showExternalHistory()"]').click();page.locator('#externalHistory').evaluate('e=>e.parentElement.open=true');page.locator('#externalHistory button').first.click();page.wait_for_function("()=>EXT_SAVED_REV==='r4'");assert gas.rows[0]['quantity']==101 and gas.rows[0]['accountId'] in ids
   page.locator('a[href="#/accounts/holdings"]').click();page.wait_for_selector('#pageViewport th[scope="rowgroup"]');text=page.locator('#pageViewport').inner_text();assert '다 합성증권' in text and '수정 계좌' in text and '둘째 계좌' in text
   assert page.locator('#pageViewport th[scope="rowgroup"]').count()>=2
   page.locator('a[href="#/accounts/overview"]').click();page.wait_for_function("()=>document.querySelectorAll('.account-report table').length>=5");assert page.locator('.account-report table').count()>=5 and page.locator('.account-report .summary-grid').count()==0
   page.locator('a[href="#/accounts/ocr"]').click();page.wait_for_selector('#externalAccountCatalogRows');before=copy.deepcopy(gas.accounts);gas.catalog+=1
   page.locator('#externalAccountCatalogRows tr').first.get_by_role('button',name='수정',exact=True).click();page.locator('#externalAccountAlias').fill('충돌 검증');page.get_by_role('button',name='계좌 정보 저장',exact=True).click();page.wait_for_function("()=>$('externalCatalogStatus').textContent.includes('STORE_CONFLICT')");assert gas.accounts==before
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   page.evaluate('logout()');page.wait_for_function("()=>DashboardShell.getStatus().page===null");assert page.locator('#externalAccountCatalogRows tr').count()==0 and page.locator('#externalAccountAlias').input_value()=='' and page.locator('#externalImageFiles').evaluate('e=>e.files.length')==0
   assert not errors and not unexpected,(errors,unexpected)
   print(json.dumps({'status':'PASS','scope':'SYNTHETIC_EXTERNAL_ACCOUNT_CATALOG','width':width,'brokerAccountCRUD':'PASS','twoImagesAndMultipleAccounts':'PASS','saveReadRestore':'PASS','conflictAndNonemptyDeletion':'PASS','groupedTables':'PASS','logoutCleanup':'PASS','actualNhCalls':0,'realStorageWrites':0}),flush=True)
   context.close()
 finally:browser.close()
