"""Synthetic check of the owner UI adapter; zero external NH/Google requests."""
from test_nh_v2_fresh import FakeWeb
from nh_v2_live_check import verify_existing_snapshot_ui

web=FakeWeb()
web.call('nhSnapshotCapture')
web.calls=[]
report=verify_existing_snapshot_ui(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
assert report['status']=='PASS' and report['storedSnapshotUnchanged']
assert set(web.calls)<={'login','logout','nhSnapshotRead'}
assert not report['storageWrites'] and not report['nhRequested']
print('PASS: synthetic native snapshot UI adapter, desktop 1440 and mobile 344, no external browser network')

# Reuse this browser fixture for the native auth/communication orchestration.
# Only tests replace the approved transport. The owner helper never replaces GAS responses.
import json
from unittest.mock import patch
from playwright.sync_api import Route, Page
from nh_v2_browser_check import native_browser_check
from test_nh_v2_final import TARGET

fixture=FakeWeb();fixture.call('nhSnapshotCapture');revoked=False
real_continue=Route.continue_
real_wait=Page.wait_for_function

def synthetic_transport(route,*args,**kwargs):
    global revoked
    if route.request.url!=TARGET:return real_continue(route,*args,**kwargs)
    body=json.loads(kwargs.get('post_data') or route.request.post_data or '{}');action=body.get('action')
    assert body.get('stagingBinding')=='f'*64
    if action=='nhAccounts':data={'success':True,'accounts':fixture.accounts,'gatewayVersion':2} if body.get('token') else {'success':False}
    elif action=='login':data={'success':True,'token':'SYNTHETIC_PRIVATE_TOKEN','isAdmin':True,'mustChangePassword':False}
    elif action=='sessionInfo':data={'success':not revoked,'isAdmin':True,'mustChangePassword':False}
    elif action=='logout':revoked=True;data={'success':True}
    else:data={'success':True,'holdings':[],'history':[],'revision':'synthetic','storeVersion':2}
    route.fulfill(content_type='application/json',body=json.dumps(data),headers={'Access-Control-Allow-Origin':'*'})

def synthetic_expiry(page,expression,*args,**kwargs):
    if "!LS('invest_session_token')" in expression:
        page.evaluate("()=>{localStorage.setItem('invest_last_active',String(Date.now()-SESSION_MS-1));renderSession()}")
    kwargs['timeout']=15000
    return real_wait(page,expression,*args,**kwargs)

with patch.object(Route,'continue_',synthetic_transport),patch.object(Page,'wait_for_function',synthetic_expiry):
    report=native_browser_check(TARGET,'synthetic','SYNTHETIC_PRIVATE_PASSWORD','f'*64)
assert report['status']=='PASS', {k:v for k,v in report.items() if k in ('phase','code','status')}
assert report['unauthenticatedBlocked']=='PASS' and report['reloadSession']=='PASS'
assert report['displayMatchesResponse']=='PASS' and not report['storageWrites']
print('PASS: synthetic native browser login, real DOM/render/session orchestration with simulated GAS and inactivity; zero external network')
