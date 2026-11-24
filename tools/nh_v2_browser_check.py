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

ACTIONS = {'appVersion', 'login', 'logout', 'sessionInfo', 'nhAccounts', 'protectedHoldings', 'externalHoldings', 'externalHistory'}
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


def safe_network_failure(request, headers, event):
    """Fixed Chrome categories only: never retain event payloads, headers or URLs."""
    allowed={'MissingAllowOriginHeader','PreflightMissingAllowOriginHeader','PreflightDisallowedRedirect',
             'InvalidAllowOriginValue','AllowOriginMismatch','WildcardOriginNotAllowed','InvalidAllowCredentials',
             'PreflightInvalidStatus','MethodDisallowedByPreflightResponse','HeaderDisallowedByPreflightResponse',
             'InsecurePrivateNetwork','DisallowedByMode','CorsDisabledScheme','InvalidResponse'}
    value=event.get('corsErrorStatus',{}).get('corsError')
    errors={'net::ERR_FAILED','net::ERR_BLOCKED_BY_CLIENT','net::ERR_ABORTED','net::ERR_TIMED_OUT',
            'net::ERR_CONNECTION_RESET','net::ERR_NAME_NOT_RESOLVED','net::ERR_CERT_AUTHORITY_INVALID'}
    result={'role':request['role'],'method':request['method'],
            'requestContentType':request.get('contentType','NOT_REPORTED'),
            'corsCode':value if value in allowed else 'OTHER' if value else 'NOT_REPORTED',
            'networkCode':event.get('errorText') if event.get('errorText') in errors else 'OTHER'}
    if headers:
        result.update({k:headers[k] for k in ('http','contentType','allowOrigin','locationRole')})
    return result


def native_browser_check(target, username, password, binding=None):
    report={'status':'FAIL','scope':'LOCAL_DEVELOPMENT_ORIGIN_TO_LIVE_GAS','login':'NOT_RUN',
            'gasCommunication':'NOT_RUN','unauthenticatedBlocked':'NOT_RUN','displayMatchesResponse':'NOT_RUN',
            'reloadSession':'NOT_RUN','naturalInactivityLogout':'NOT_RUN','expiredOrRevokedTokenBlocked':'NOT_RUN',
            'serverIdleExpiryInIsolation':'NOT_RUN','browserMetadata':'NOT_RUN','storageWrites':False,'orderCalls':0,
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
                            if 'stagingBinding' not in payload:
                                payload['stagingBinding']=binding
                                route.continue_(post_data=json.dumps(payload))
                            else:route.continue_()
                        else:route.continue_()
                    else:
                        if choice=='VIOLATION':state['violation']=True;report['outOfBoundaryAttemptBlocked']=True
                        route.abort()
                context.route('**/*',route)
                page=context.new_page()
                # Observe actual Chrome headers/failures even when page JS cannot
                # read a CORS-blocked response. Network.enable does not rewrite it.
                cdp=context.new_cdp_session(page);known={};extra={}
                def chrome_request(event):
                    r=event.get('request',{});url=r.get('url','')
                    if url.startswith(target+'?'):return
                    role=cors_role(url,target)
                    if url=='https://script.google.com/macros/s/'+PRODUCTION_DEPLOYMENT_ID+'/exec':role='PRODUCTION_DEFAULT'
                    if role=='OTHER':return
                    if event.get('redirectResponse'):extra.pop(event['requestId'],None)
                    headers={str(k).lower():str(v) for k,v in r.get('headers',{}).items()}
                    kind=headers.get('content-type','').split(';')[0].lower()
                    known[event['requestId']]={'role':role,'method':r.get('method') if r.get('method') in ('POST','GET','OPTIONS') else 'OTHER',
                                               'contentType':'TEXT_PLAIN' if kind=='text/plain' else 'JSON' if kind=='application/json' else 'OTHER_OR_MISSING'}
                def chrome_headers(event):
                    if event.get('requestId') in known:
                        extra[event['requestId']]=safe_cors_response(event.get('statusCode',0),event.get('headers',{}),origin,target)
                def chrome_failure(event):
                    request=known.get(event.get('requestId'))
                    if request:
                        report.setdefault('nativeNetworkFailures',[]).append(safe_network_failure(request,extra.get(event['requestId']),event))
                        report['nativeNetworkFailures']=report['nativeNetworkFailures'][-6:]
                cdp.on('Network.requestWillBeSent',chrome_request)
                cdp.on('Network.responseReceivedExtraInfo',chrome_headers)
                cdp.on('Network.loadingFailed',chrome_failure)
                cdp.send('Network.enable')
                def response(response):
                    try:
                        root=rooted_request(response.request)
                        if root.url!=target or root.method!='POST':return
                        evidence=safe_cors_response(response.status,response.headers,origin,target)
                        evidence['role']=cors_role(response.url,target)
                        evidence={k:evidence[k] for k in ('role','http','contentType','allowOrigin','locationRole')}
                        report.setdefault('networkEvidence',[]).append(evidence)
                        report['networkEvidence']=report['networkEvidence'][-8:]
                        if response.status!=200:return
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
                    if message.type == 'error' and 'cors' in message.text.lower():
                        report['corsFailureObserved']=True
                        code=cors_error_category(message.text)
                        if code and code not in report.setdefault('corsCodes',[]):report['corsCodes'].append(code)
                page.on('console',console)
                def failed(request):
                    root=rooted_request(request)
                    if root.url==target and root.method=='POST':report['networkFailureObserved']=True
                page.on('requestfailed',failed)
                page.goto(origin,wait_until='domcontentloaded')
                # Match the passing anonymous diagnostic's browser-side metadata first.
                # This is a visible identity/transport check, not a CORS bypass or retry.
                report['phase']='BROWSER_METADATA'
                metadata=page.evaluate("""async binding=>{const r=await post({action:'appVersion',stagingBinding:binding});const d=await r.json();return d.success===true&&d.freshTestEnvironment===true&&d.sheetHash===binding}""",binding)
                if not metadata:raise RuntimeError('metadata')
                report['browserMetadata']='PASS'
                report['phase']='UNAUTHENTICATED_PROBE'
                denied=page.evaluate("""async()=>{const r=await post({action:'nhAccounts'});const d=await r.json();return d.success===false&&!('accounts' in d)&&!('holdings' in d)}""")
                if not denied:raise RuntimeError('boundary')
                report['unauthenticatedBlocked']='PASS'
                report['phase']='NATIVE_LOGIN'
                report['login']='FAIL'
                page.locator('#authId').fill(username);page.locator('#authPw').fill(password)
                page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>LS('invest_session_token')&&$('appContainer').style.display==='block'||$('authMsg').textContent&&$('authMsg').textContent!=='서버 통신 중...'",timeout=120000)
                if not page.evaluate("()=>!!LS('invest_session_token')&&$('appContainer').style.display==='block'"):raise RuntimeError('login')
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
    except Exception as error:
        report['code']='LIVE_BROWSER_AUTH_COMMUNICATION_OR_SESSION_FAILED'
        report['errorType']='TypeError' if 'TypeError:' in str(error) else 'SyntaxError' if 'SyntaxError:' in str(error) else 'TimeoutError' if type(error).__name__=='TimeoutError' else 'OTHER'
    finally:
        server.shutdown();server.server_close()
    if report['status']=='PASS':
        report.pop('networkEvidence',None);report.pop('nativeNetworkFailures',None)
    return report


def cors_role(url,target):
    if url==target:return 'FRESH_EXEC'
    host=urlsplit(url).hostname
    if host=='script.googleusercontent.com':return 'GOOGLE_CONTENT'
    if host=='accounts.google.com':return 'GOOGLE_AUTH'
    if host=='script.google.com':return 'OTHER_GOOGLE_SCRIPT'
    return 'OTHER'


def safe_cors_response(status,headers,origin,target):
    h={str(k).lower():str(v) for k,v in headers.items()}
    value=h.get('access-control-allow-origin','')
    kind=h.get('content-type','').split(';')[0].lower()
    return {'http':status if type(status) is int and 100<=status<=599 else None,
            'contentType':'JSON' if kind=='application/json' else 'HTML' if kind=='text/html' else 'OTHER_OR_MISSING',
            'allowOrigin':'WILDCARD' if value=='*' else 'REQUEST_ORIGIN' if value==origin else 'OTHER' if value else 'MISSING',
            'allowsCredentials':h.get('access-control-allow-credentials','').lower()=='true',
            'redirect':300<=status<400,
            'locationRole':cors_role(h['location'],target) if 'location' in h else 'MISSING'}


def cors_error_category(message):
    text=message.lower()
    if 'cors' not in text:return None
    if 'preflight' in text and 'redirect' in text:return 'PREFLIGHT_REDIRECT'
    if 'preflight' in text:return 'PREFLIGHT_REJECTED'
    if 'access-control-allow-origin' in text and ('no ' in text or 'missing' in text):return 'ALLOW_ORIGIN_MISSING'
    if 'credentials' in text:return 'CREDENTIALS_POLICY'
    if 'private' in text and 'address' in text:return 'PRIVATE_NETWORK_POLICY'
    return 'OTHER_CORS_POLICY'


def diagnose_browser_cors(target,binding):
    """Three anonymous native browser requests. Header categories only, no NH or login."""
    report={'mode':'ANONYMOUS_BROWSER_CORS_DIAGNOSTIC','status':'FAIL','cases':[],
            'credentialsRequested':False,'nhRequested':False,'storageWrites':False,'orderCalls':0,
            'rawFinancialDataIncluded':False,'rawHeadersOrUrlsIncluded':False}
    if not valid_target(target) or not isinstance(binding,str) or not re.fullmatch(r'[a-f0-9]{64}',binding):
        report['code']='FRESH_BROWSER_TARGET_AND_BINDING_REQUIRED';return report
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
    state={'case':None,'mutate':False,'violation':False}
    try:
        with sync_playwright() as p:
            options={'headless':True}
            if os.environ.get('CHROMIUM_EXECUTABLE'):options['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
            browser=p.chromium.launch(**options)
            try:
                context=browser.new_context(service_workers='block')
                context.add_init_script('localStorage.setItem("invest_myproxy",'+json.dumps(json.dumps(target))+');')
                def route(route):
                    r=route.request;root=rooted_request(r)
                    if r.url==target and r.method=='POST':
                        try:body=json.loads(r.post_data or '{}')
                        except Exception:state['violation']=True;route.abort();return
                        if body.get('action') not in ('appVersion','nhAccounts') or set(body)-{'action','stagingBinding'}:
                            state['violation']=True;route.abort();return
                        if state['mutate']:
                            body['stagingBinding']=binding;route.continue_(post_data=json.dumps(body))
                        else:route.continue_()
                        return
                    choice=request_decision(r.url,r.method,r.post_data,root.url,root.method,target,origin)
                    if choice=='ALLOW':route.continue_()
                    else:
                        if choice=='VIOLATION':state['violation']=True
                        route.abort()
                context.route('**/*',route);page=context.new_page()
                def request(r):
                    case=state['case']
                    if case is None or 'requests' not in case or cors_role(r.url,target)=='OTHER':return
                    kind=r.headers.get('content-type','').split(';')[0].lower()
                    case['requests'].append({'role':cors_role(r.url,target),'method':r.method if r.method in ('GET','POST','OPTIONS') else 'OTHER',
                                             'contentType':'TEXT_PLAIN' if kind=='text/plain' else 'JSON' if kind=='application/json' else 'OTHER_OR_MISSING'})
                def response(r):
                    case=state['case']
                    if case is None or cors_role(r.url,target)=='OTHER':return
                    item=safe_cors_response(r.status,r.headers,origin,target);item['role']=cors_role(r.url,target)
                    if len(case['responses'])<12:case['responses'].append(item)
                def console(message):
                    case=state['case'];code=cors_error_category(message.text)
                    if case is not None and code and code not in case['corsCodes']:case['corsCodes'].append(code)
                page.on('request',request);page.on('response',response);page.on('console',console)
                page.goto(origin,wait_until='domcontentloaded')
                for name,action,mutate in [('METADATA_NATIVE_BODY','appVersion',False),('AUTH_PROBE_ROUTE_MUTATION','nhAccounts',True),('AUTH_PROBE_NATIVE_BODY','nhAccounts',False)]:
                    case={'case':name,'requests':[],'responses':[],'corsCodes':[]};state.update(case=case,mutate=mutate)
                    result=page.evaluate("""async x=>{
                      try{const payload={action:x.action};if(!x.mutate)payload.stagingBinding=x.binding;
                        const r=await post(payload);const d=await r.json();
                        const privateFields=['accounts','holdings','token','access_token'].some(k=>k in d);
                        const denied=d.success===false&&!privateFields;
                        const authCode=d.code==='AUTH_REQUIRED'||d.message==='로그인이 필요합니다. 다시 로그인하세요.';
                        return {jsonReadable:true,http:r.status,metadataValid:x.action==='appVersion'&&d.success===true&&d.freshTestEnvironment===true,
                          denied:denied,authBlockedAtSessionCheck:denied&&authCode,privateFieldsPresent:privateFields};
                      }catch(e){return {jsonReadable:false,errorType:['TypeError','SyntaxError'].includes(e.name)?e.name:'OTHER'}}
                    }""",{'action':action,'binding':binding,'mutate':mutate})
                    case.update(result)
                    requests=case.pop('requests')
                    case['requestContentTypes']=sorted(set(r['contentType'] for r in requests if r['role']=='FRESH_EXEC' and r['method']=='POST'))
                    case['preflightObserved']=any(r['method']=='OPTIONS' for r in requests)
                    case['googleContentGetObserved']=any(r['role']=='GOOGLE_CONTENT' and r['method']=='GET' for r in requests)
                    case['responses']=[{k:r[k] for k in ('role','http','contentType','allowOrigin','locationRole')} for r in case['responses']]
                    case['status']='PASS' if result.get('metadataValid') or result.get('authBlockedAtSessionCheck') else 'FAIL'
                    report['cases'].append(case)
                    if result.get('privateFieldsPresent') or state['violation']:
                        report['code']='UNEXPECTED_ANONYMOUS_RESPONSE_OR_DESTINATION';return report
                report.update(status='PASS',code='CORS_DIAGNOSTIC_COMPLETED')
            finally:browser.close()
    except Exception:
        report['code']='ANONYMOUS_CORS_DIAGNOSTIC_FAILED'
    finally:server.shutdown();server.server_close()
    return report
