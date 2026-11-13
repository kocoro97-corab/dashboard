"""Owner-run native browser verification of existing auth.js against the verified fresh GAS.
No API response replacement, authentication bypass, screenshots, tracing or raw output.
"""
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
import re
import threading
import time
from urllib.parse import urlsplit

from build_nh_staging import ROOT, PRODUCTION_DEPLOYMENT_ID
from nh_v2_fresh import OLD_DEPLOYMENT
from nh_staging_test import rejection_code, SAFE_REPORT_CODES

ACTIONS = {'login', 'logout', 'sessionInfo', 'nhAccounts', 'protectedHoldings', 'externalHoldings', 'externalHistory'}
BACKGROUND = {'nhQuotes', 'nhExternalQuotes'}


def public_asset(path):
    return path in ('/', '/index.html') or bool(re.fullmatch(r'/(?:js/[A-Za-z0-9_-]+\.js|css/[A-Za-z0-9_-]+\.css)', path))


def valid_target(url):
    match = re.fullmatch(r'https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec', url)
    return bool(match and match[1] not in (OLD_DEPLOYMENT, PRODUCTION_DEPLOYMENT_ID))


def rooted_request(request):
    while request.redirected_from is not None:
        request = request.redirected_from
    return request


def request_decision(url, method, body, root_url, root_method, target, local_origin):
    """Pure boundary policy; all denied requests are aborted, never replaced."""
    if not valid_target(target):return 'VIOLATION'
    parsed=urlsplit(url)
    if url.startswith(local_origin + '/'):
        return 'ALLOW' if method == 'GET' and public_asset(parsed.path) and (not parsed.query or bool(re.fullmatch(r'v=[A-Za-z0-9._-]+', parsed.query))) else 'BLOCK'
    if url == target:
        if method == 'OPTIONS':return 'ALLOW'
        if method != 'POST':return 'BLOCK'
        try:action=json.loads(body or '{}').get('action')
        except Exception:return 'VIOLATION'
        if action in ACTIONS:return 'ALLOW'
        return 'BLOCK' if action in BACKGROUND else 'VIOLATION'
    if parsed.hostname == 'script.googleusercontent.com':
        return 'ALLOW' if (parsed.scheme == 'https' and parsed.port in (None,443) and not parsed.username and parsed.path == '/macros/echo' and method == 'GET' and root_url == target and root_method == 'POST') else 'VIOLATION'
    if parsed.hostname in ('script.google.com','accounts.google.com'):
        # Background unauthenticated public-market proxy reads are outside this check.
        if url.startswith(target+'?') and method == 'GET':return 'BLOCK'
        return 'VIOLATION'
    return 'BLOCK'


def native_browser_check(target, username, password, binding=None):
    report={'status':'FAIL','scope':'LOCAL_DEVELOPMENT_ORIGIN_TO_LIVE_GAS','login':'NOT_RUN',
            'gasCommunication':'NOT_RUN','unauthenticatedBlocked':'NOT_RUN','displayMatchesResponse':'NOT_RUN',
            'reloadSession':'NOT_RUN','naturalInactivityLogout':'NOT_RUN','expiredOrRevokedTokenBlocked':'NOT_RUN',
            'serverIdleExpiryInIsolation':'NOT_RUN','storageWrites':False,'orderCalls':0,
            'rawFinancialDataIncluded':False,'productionRequests':0}
    if not valid_target(target) or not isinstance(binding,str) or not re.fullmatch(r'[a-f0-9]{64}',binding):report['code']='FRESH_BROWSER_TARGET_AND_BINDING_REQUIRED';return report
    report['stagingBindingInjected']=True
    from playwright.sync_api import sync_playwright
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
        def log_message(self,*args):pass
        def do_GET(self):
            if not public_asset(urlsplit(self.path).path):self.send_error(404);return
            super().do_GET()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin='http://127.0.0.1:'+str(server.server_port)
    state={'violation':False,'accounts':None,'logout':False,'requests':0}
    report.update(corsFailureObserved=False,networkFailureObserved=False)
    browser=None;page=None
    try:
        with sync_playwright() as p:
            try:
                options={'headless':True}
                if os.environ.get('CHROMIUM_EXECUTABLE'):options['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
                browser=p.chromium.launch(**options)
                context=browser.new_context(viewport={'width':1440,'height':882},service_workers='block')
                # Existing endpoint setting only; no synthetic session or altered auth logic.
                context.add_init_script('localStorage.setItem("invest_myproxy",'+json.dumps(json.dumps(target))+');')
                def route(route):
                    req=route.request;root=rooted_request(req)
                    choice=request_decision(req.url,req.method,req.post_data,root.url,root.method,target,origin)
                    if choice=='ALLOW':
                        if req.url==target and req.method=='POST':state['requests']+=1
                        if req.url==target and req.method=='POST':
                            payload=json.loads(req.post_data or '{}')
                            if payload.get('stagingBinding',binding)!=binding:
                                state['violation']=True;route.abort();return
                            payload['stagingBinding']=binding
                            route.continue_(post_data=json.dumps(payload))
                        else:route.continue_()
                    else:
                        if choice=='VIOLATION':state['violation']=True;report['outOfBoundaryAttemptBlocked']=True
                        route.abort()
                context.route('**/*',route)
                page=context.new_page()
                def response(response):
                    try:
                        root=rooted_request(response.request)
                        if root.url!=target or root.method!='POST' or response.status!=200:return
                        action=json.loads(root.post_data or '{}').get('action')
                        if action not in ('nhAccounts','logout','login'):return
                        data=response.json()
                        if action=='login' and data.get('success') is not True:
                            code=rejection_code(data,'login')
                            report['loginDiagnosticCode']=code if code in SAFE_REPORT_CODES else 'GAS_REJECTED'
                        if action=='nhAccounts' and data.get('success') is True:state['accounts']=data.get('accounts')
                        if action=='logout' and data.get('success') is True:state['logout']=True
                    except Exception:pass
                page.on('response',response)
                def console(message):
                    if message.type == 'error' and 'cors' in message.text.lower():report['corsFailureObserved']=True
                page.on('console',console)
                def failed(request):
                    root=rooted_request(request)
                    if root.url==target and root.method=='POST':report['networkFailureObserved']=True
                page.on('requestfailed',failed)
                page.goto(origin,wait_until='domcontentloaded')
                report['phase']='UNAUTHENTICATED_PROBE'
                denied=page.evaluate("""async()=>{const r=await post({action:'nhAccounts'});const d=await r.json();return d.success===false&&!('accounts' in d)&&!('holdings' in d)}""")
                if not denied:raise RuntimeError('boundary')
                report['unauthenticatedBlocked']='PASS'
                report['phase']='NATIVE_LOGIN'
                page.locator('#authId').fill(username);page.locator('#authPw').fill(password)
                page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>LS('invest_session_token')&&$('appContainer').style.display==='block'",timeout=120000)
                if not page.evaluate("()=>LS('invest_is_admin')==='true'&&!LS('invest_password_change')"):raise RuntimeError('admin')
                report['login']='PASS'
                report['phase']='LIVE_NH_DISPLAY'
                page.wait_for_function("()=>!NH_ACCOUNT_BUSY&&NH_ACCOUNT_SESSION===LS('invest_session_token')",timeout=120000)
                expected=state['accounts']
                if not isinstance(expected,list) or not expected or any(a.get('errors') or any(not isinstance(a.get(m),dict) or a[m].get('partial') for m in ('domestic','overseas')) for a in expected):raise RuntimeError('inquiry')
                valid=page.evaluate("""expected=>{
                  const hs=expected.flatMap(a=>['domestic','overseas'].flatMap(m=>a[m].holdings||[]));
                  const rows=[...document.querySelectorAll('#nhAccountRows tr')];
                  return hs.length>0&&rows.length===hs.length&&hs.every((h,i)=>{
                    const c=rows[i].querySelectorAll('td');return c.length===10&&c[2].textContent===h.name&&c[3].textContent===h.code
                     &&c[4].textContent===nhMoney(h.quantity)&&c[5].textContent===nhMoney(h.avgPrice)+' '+(h.currency||'')
                     &&c[6].textContent===nhMoney(h.currentPrice)+' '+(h.currency||'')&&c[7].textContent===nhMoney(h.evalAmount)
                     &&c[8].textContent===nhMoney(h.profit)&&c[9].textContent===(h.returnRate==null?'—':Number(h.returnRate).toFixed(2)+'%');
                  });
                }""",expected)
                if not valid or state['violation']:raise RuntimeError('display')
                report.update(gasCommunication='PASS',displayMatchesResponse='PASS')
                token=page.evaluate("()=>LS('invest_session_token')")
                report['phase']='SESSION_RELOAD'
                page.reload(wait_until='domcontentloaded')
                page.wait_for_function("()=>$('appContainer').style.display==='block'&&!NH_ACCOUNT_BUSY&&NH_ACCOUNT_SESSION===LS('invest_session_token')",timeout=120000)
                if page.evaluate("()=>LS('invest_session_token')")!=token:raise RuntimeError('reload')
                report['reloadSession']='PASS'
                report['phase']='WAITING_NATURAL_INACTIVITY_LOGOUT'
                # Use real elapsed time. No timestamp editing, clock acceleration or token mutation.
                page.wait_for_function("()=>!LS('invest_session_token')&&$('authGuard').style.display==='flex'",timeout=330000)
                deadline=time.monotonic()+30
                while not state['logout'] and time.monotonic()<deadline:page.wait_for_timeout(500)
                report['naturalInactivityLogout']='PASS'
                denied=page.evaluate("""async token=>{const r=await post({action:'sessionInfo',token});const d=await r.json();return d.success===false&&!('accounts' in d)&&!('holdings' in d)}""",token)
                if not denied or state['violation']:raise RuntimeError('expired')
                report.update(status='PASS',phase='COMPLETE',expiredOrRevokedTokenBlocked='PASS')
                # Server idle timeout and logout revocation cannot be distinguished here.
                report['approvedBrowserRequests']=state['requests']
                context.close();browser.close();browser=None
            finally:
                if browser is not None:
                    try:
                        if page is not None and not page.is_closed():
                            page.evaluate("""async target=>{const token=LS('invest_session_token');if(token)await fetch(target,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action:'logout',token})})}""",target)
                    except Exception:
                        report['cleanupLogout']='NOT_CONFIRMED'
                    try:browser.close()
                    except Exception:pass
                    browser=None
    except Exception:
        report['code']='LIVE_BROWSER_AUTH_COMMUNICATION_OR_SESSION_FAILED'
    finally:
        server.shutdown();server.server_close()
    return report
