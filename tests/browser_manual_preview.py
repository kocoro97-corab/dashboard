"""Changed local-draft UI only. Synthetic authentication; zero account/store calls."""
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_dev_pages import build,PAGE
from relay.app import RelayApp
from relay.public_dev import PublicDevelopment
from test_relay import configuration,EXPECTED,request

ORIGIN='https://kocoro97-corab.github.io';HOST='synthetic-preview.trycloudflare.com';ENDPOINT='https://'+HOST+'/api'
CODE='SYNTHETIC_PRIVATE_PREVIEW_CODE'

class Auth:
    def __init__(self):self.calls=[];self.number=0
    def verify(self):pass
    def post(self,body):
        action=body['action'];self.calls.append(action)
        if action=='appVersion':return dict(EXPECTED,success=True)
        if action=='login':
            self.number+=1;return {'success':True,'token':('a' if self.number==1 else 'b')*64,'isAdmin':False}
        if action in ('sessionInfo','logout'):return {'success':True,'isAdmin':False}
        raise AssertionError('FINANCIAL_ACTION_FORBIDDEN')

with tempfile.TemporaryDirectory() as tmp:
    public=Path(tmp)/'public';build(public)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            for width in (344,1440):
                gas=Auth();edge=PublicDevelopment(RelayApp(configuration(origins=frozenset({ORIGIN})),gas),PAGE,CODE);edge.host=HOST
                context=browser.new_context(viewport={'width':width,'height':882},service_workers='block')
                unexpected=[];errors=[]
                def route(r):
                    u=urlsplit(r.request.url)
                    if u.hostname=='kocoro97-corab.github.io' and u.path.startswith('/dashboard-v2-dev/'):
                        file=public/(u.path.removeprefix('/dashboard-v2-dev/') or 'index.html')
                        if file.is_file() and public in file.resolve().parents:
                            mime='application/javascript' if file.suffix=='.js' else 'text/css' if file.suffix=='.css' else 'application/json' if file.suffix=='.json' else 'text/html'
                            r.fulfill(status=200,content_type=mime,body=file.read_bytes());return
                    if r.request.url==ENDPOINT:
                        h=r.request.headers
                        result=request(edge,json.loads(r.request.post_data or '{}'),origin=h.get('origin',''),authorization=h.get('authorization'),method=r.request.method,
                          REMOTE_ADDR='127.0.0.1',HTTP_HOST=HOST,HTTP_X_FORWARDED_PROTO='https',HTTP_REFERER=h.get('referer',''),
                          HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client',''),HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key',''))
                        r.fulfill(status=result['status'],headers=result['headers'],body=json.dumps(result['body']));return
                    unexpected.append('EXTERNAL_REQUEST');r.abort()
                context.route('**/*',route)
                page=context.new_page();page.on('pageerror',lambda e:errors.append(type(e).__name__));page.on('dialog',lambda d:d.accept())
                page.goto(PAGE,wait_until='domcontentloaded')
                page.locator('#devEndpoint').fill(ENDPOINT);page.locator('#devCode').fill(CODE);page.locator('#devConnectSubmit').click();page.wait_for_selector('#devBanner')
                def login():
                    page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click()
                    page.wait_for_function("()=>$('appContainer').style.display==='block'")
                login();page.wait_for_function('()=>!!EXT_MASTER')
                baseline=len(gas.calls)
                for kind in ('ISA','PENSION','IRP'):
                    page.select_option('#externalAccountType',kind)
                    for field,value in {'Code':'035720','Name':'카카오','Qty':'2','Avg':'1000'}.items():page.locator('#externalManual'+field).fill(value)
                    page.locator('button[onclick="addExternalManual()"]').click()
                assert page.locator('#externalAssetRows tr').count()==3
                assert page.locator('#externalSaveBtn').is_disabled()
                assert page.locator('#externalSummaryCards').evaluate('e=>e.childElementCount')==0
                quantity=page.locator('#externalAssetRows tr').first.locator('input[type="number"]').first
                quantity.fill('3');quantity.press('Tab')
                assert page.evaluate('EXT_ASSETS[0].quantity')==3
                page.locator('#externalUndoBtn').click();assert page.evaluate('EXT_ASSETS[0].quantity')==2
                assert len(gas.calls)==baseline  # Add/edit/undo do not call GAS, NH or storage.
                assert page.locator('#externalUploadBtn').is_disabled() and page.locator('#externalDriveFolder').is_disabled()
                assert page.locator('#nhAccountBtn').is_disabled() and page.locator('#externalAutoRefresh').is_disabled()
                page.locator('#externalManualName').fill('SYNTHETIC_PRIVATE_UNSAVED_INPUT')
                page.evaluate('logout()');page.wait_for_selector('#authGuard',state='visible')
                assert page.evaluate('EXT_ASSETS.length')==0
                for name in ('Code','Name','Qty','Avg'):assert page.locator('#externalManual'+name).input_value()==''
                login();assert page.evaluate('EXT_ASSETS.length')==0
                assert '미조회' in page.locator('#externalAssetRows').inner_text()
                assert set(gas.calls)<={'appVersion','login','sessionInfo','logout'}
                assert not unexpected and not errors,(unexpected,errors)
                context.close()
                print('PASS: synthetic manual preview add/edit/undo/logout isolation; '+str(width)+'px; financial requests 0')
        finally:browser.close()
