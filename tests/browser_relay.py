"""Actual cross-origin local HTTP/CORS, synthetic GAS; no Playwright request routing."""
import copy
import json
from pathlib import Path
import sys
import threading
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from nh_v2_relay_check import local_servers,browser_auth
from test_relay import EXPECTED,URL
from test_nh_v2_fresh import FakeWeb
from relay.app import RelayFault

TOKEN='a'*64
class SyntheticGas:
    def __init__(self):
        w=FakeWeb();w.call('nhSnapshotCapture');self.accounts=w.accounts;self.live=False;self.holdings=[];self.rev='r0';self.history=[];self.fail=False;self.calls=[];self.lock=threading.Lock()
    def verify(self):pass
    def post(self,payload):
        with self.lock:
            action=payload['action'];self.calls.append(action)
            if self.fail:self.fail=False;raise RelayFault('RELAY_UPSTREAM_NETWORK')
            if action=='appVersion':return dict(EXPECTED,success=True)
            if action=='login':
                if payload.get('pass')!='SYNTHETIC_PRIVATE_PASSWORD':return {'success':False,'message':'로그인 정보 또는 계정 승인 상태를 확인하세요.'}
                self.live=True;return {'success':True,'token':TOKEN,'isAdmin':True,'mustChangePassword':False}
            if payload.get('token')!=TOKEN or not self.live:return {'success':False,'code':'AUTH_REQUIRED'}
            if action=='logout':self.live=False;return {'success':True}
            if action=='sessionInfo':return {'success':True,'isAdmin':True,'mustChangePassword':False}
            if action=='protectedHoldings':return {'success':True,'holdings':[]}
            if action=='nhAccounts':return {'success':True,'accounts':copy.deepcopy(self.accounts),'gatewayVersion':2}
            if action=='externalHoldings':return {'success':True,'holdings':copy.deepcopy(self.holdings),'revision':self.rev,'storeVersion':2}
            if action=='externalHistory':return {'success':True,'history':copy.deepcopy(self.history)}
            if action in ('saveExternalHoldings','restoreExternalHoldings'):
                if payload.get('expectedRevision')!=self.rev:return {'success':False,'code':'STORE_CONFLICT'}
                old=copy.deepcopy(self.holdings);self.history.insert(0,{'snapshotId':self.rev,'holdings':old})
                self.holdings=payload['holdings'] if action=='saveExternalHoldings' else []
                self.rev='r'+str(int(self.rev[1:])+1);return {'success':True,'revision':self.rev,'count':len(self.holdings),'storeVersion':2}
            return {'success':False,'code':'NH_UNSUPPORTED'}
    def public(self,url,token):return '{}'

# Existing real DOM auth workflow, including reload and classified synthetic expiry.
fake=SyntheticGas()
with local_servers(EXPECTED,URL,fake) as (origin,endpoint,app):
    report=browser_auth(origin,endpoint,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',synthetic=True)
    assert report['status']=='PASS', {k:v for k,v in report.items() if k in ('code','phase')}
    assert app.metrics['preflights']>0
    assert not any(a.startswith('nh') for a in fake.calls)
print('PASS: actual HTTP relay OPTIONS/CORS, synthetic GAS login/reload/expiry/logout; NH calls 0')

# Synthetic full app over real HTTP transport; all account data is synthetic.
fake=SyntheticGas()
with local_servers(EXPECTED,URL,fake,auth_only=False) as (origin,endpoint,app):
    import os
    with sync_playwright() as p:
        launch={'headless':True}
        if os.environ.get('CHROMIUM_EXECUTABLE'):launch['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
        browser=p.chromium.launch(**launch)
        try:
            for width in (344,1440):
                context=browser.new_context(viewport={'width':width,'height':882},service_workers='block')
                context.add_init_script('window.MYINVEST_TRANSPORT_CONFIG='+json.dumps({'mode':'relay','endpoint':endpoint,'development':True})+';')
                page=context.new_page();page.goto(origin,wait_until='domcontentloaded')
                page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('synthetic wrong password');page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>$('authMsg').textContent==='로그인 정보 또는 계정 승인 상태를 확인하세요.'")
                assert not page.evaluate("()=>LS('invest_session_token')")
                page.locator('#authId').fill('synthetic');page.locator('#authPw').fill('SYNTHETIC_PRIVATE_PASSWORD');page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>!NH_ACCOUNT_BUSY&&!!LS('invest_session_token')&&NH_ACCOUNT_SESSION===LS('invest_session_token')",timeout=15000)
                assert page.locator('#nhAccountRows tr').count()==2
                valid=page.evaluate("""async()=>{
                  const before=await extPost('externalHoldings');
                  const rows=[{accountType:'ISA',code:'000001',name:'Synthetic only',quantity:2,avgPrice:10,source:'manual'}];
                  const saved=await extPost('saveExternalHoldings',{holdings:rows,expectedRevision:before.revision,confirmReplace:true});
                  const read=await extPost('externalHoldings');
                  if(JSON.stringify(read.holdings)!==JSON.stringify(rows)||saved.revision!==read.revision)return false;
                  let conflict=false;try{await extPost('saveExternalHoldings',{holdings:rows,expectedRevision:before.revision,confirmReplace:true})}catch(e){conflict=e.diagnostic.code==='STORE_CONFLICT'}
                  await extPost('restoreExternalHoldings',{snapshotId:before.revision,expectedRevision:read.revision,confirmReplace:true});
                  return conflict&&(await extPost('externalHoldings')).holdings.length===0;
                }""")
                assert valid
                # A server-side network error remains readable JSON with valid CORS,
                # never an opaque browser response and never a silent success.
                fake.fail=True
                failure=page.evaluate("async()=>{const r=await post({action:'sessionInfo',token:LS('invest_session_token')});const d=await r.json();return {http:r.status,code:d.code,success:d.success}}")
                assert failure=={'http':502,'code':'RELAY_UPSTREAM_NETWORK','success':False}
                fake.fail=True;before_writes=fake.calls.count('saveExternalHoldings')
                uncertain=page.evaluate("""async()=>{try{await extPost('saveExternalHoldings',{holdings:[],expectedRevision:'synthetic'});return false}catch(e){return e.diagnostic.code==='RELAY_WRITE_OUTCOME_UNKNOWN'&&SafeDiagnostics.message(e).includes('다시 불러와 확인')}}""")
                assert uncertain and fake.calls.count('saveExternalHoldings')==before_writes+1
                assert fake.holdings==[]
                page.evaluate('openDg()');assert page.locator('#dgp').evaluate('(e)=>e.readOnly')
                assert page.locator('#saveProxyBtn').is_disabled()
                page.evaluate('logout()');context.close()
                print('PASS: synthetic account read/save/conflict/restore and JSON-readable upstream failure via real HTTP relay '+str(width)+'px')
            # Same HTTP server, different browser origin: real CORS must deny it.
            before=len(fake.calls)
            context=browser.new_context(service_workers='block');page=context.new_page()
            page.goto(origin.replace('127.0.0.1','localhost'),wait_until='domcontentloaded')
            blocked=page.evaluate("""async endpoint=>{try{await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'appVersion'})});return false}catch(e){return e instanceof TypeError}}""",endpoint)
            assert blocked and len(fake.calls)==before
            context.close()
            print('PASS: actual Chrome CORS denies unapproved origin; upstream calls 0')
        finally:browser.close()
