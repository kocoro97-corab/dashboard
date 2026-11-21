"""Owner-run actual browser -> local relay -> isolated GAS AUTH ONLY validation.
No NH calls, snapshot capture/restore, new cloud infrastructure, backups or deploys.
"""
import argparse
from contextlib import contextmanager
import getpass
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
import json
from pathlib import Path
import re
from socketserver import ThreadingMixIn
import sys
import threading
import urllib.request
import urllib.parse
from wsgiref.simple_server import make_server,WSGIServer,WSGIRequestHandler

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from relay.app import Config,RelayApp
from nh_v2_live_check import preflight
from nh_v2_fresh import private_path
from nh_staging_test import fingerprint

class ThreadedWSGI(ThreadingMixIn,WSGIServer):daemon_threads=True
class QuietWSGI(WSGIRequestHandler):
    def log_message(self,*args):pass


def deployment_settings(plan,read=None):
    """GET deployment metadata only; Google OAuth stays in owner memory, never printed."""
    try:
        if read is None:
            class NoCredentialRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self,*args,**kwargs):return None
            private_http=urllib.request.build_opener(NoCredentialRedirect())
            config=json.loads((Path.home()/'.clasprc.json').read_text())
            credentials=config.get('tokens',{}).get('default',{})
            if not credentials and config.get('token') and config.get('oauth2ClientSettings'):
                settings=config['oauth2ClientSettings'];credentials=dict(config['token'],client_id=settings.get('clientId'),client_secret=settings.get('clientSecret'))
            fields={k:credentials[k] for k in ('client_id','client_secret','refresh_token')}
            data=urllib.parse.urlencode(dict(fields,grant_type='refresh_token')).encode()
            request=urllib.request.Request('https://oauth2.googleapis.com/token',data=data,headers={'Content-Type':'application/x-www-form-urlencoded'},method='POST')
            with private_http.open(request,timeout=30) as response:token=json.load(response)['access_token']
            def read(url):
                request=urllib.request.Request(url,headers={'Authorization':'Bearer '+token,'Accept':'application/json'},method='GET')
                with private_http.open(request,timeout=30) as response:return json.load(response)
        dep=plan['url'].split('/')[-2]
        resource=read('https://script.googleapis.com/v1/projects/'+plan['scriptId']+'/deployments/'+dep)
        config=resource.get('deploymentConfig',{})
        entries=[e.get('webApp',{}) for e in resource.get('entryPoints',[]) if e.get('entryPointType')=='WEB_APP' and e.get('webApp',{}).get('url')==plan['url']]
        if resource.get('deploymentId')!=dep or config.get('scriptId')!=plan['scriptId'] or config.get('versionNumber')!=plan['activeVersion'] or len(entries)!=1:return {'status':'FAIL','code':'DEPLOYMENT_METADATA_MISMATCH'}
        settings=entries[0].get('entryPointConfig',{})
        execute=settings.get('executeAs');access=settings.get('access')
        safe_execute=execute if execute in ('USER_DEPLOYING','USER_ACCESSING') else 'UNKNOWN'
        safe_access=access if access in ('MYSELF','DOMAIN','ANYONE','ANYONE_ANONYMOUS') else 'UNKNOWN'
        return {'status':'PASS' if execute=='USER_DEPLOYING' and access=='ANYONE_ANONYMOUS' else 'FAIL','executeAs':safe_execute,'access':safe_access,'versionMatches':True}
    except Exception:return {'status':'NOT_RUN','code':'OWNER_GOOGLE_DEPLOYMENT_METADATA_REQUIRED'}


@contextmanager
def local_servers(expected,upstream,gateway=None,auth_only=True):
    """Only existing local processes; no public hosting or provider accounts."""
    state={}
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
        def log_message(self,*args):pass
        def do_GET(self):
            path=urllib.parse.urlsplit(self.path).path
            if path not in ('/','/index.html','/data/krx-instruments.json') and not re.fullmatch(r'/(?:js/[A-Za-z0-9_-]+\.js|css/[A-Za-z0-9_-]+\.css)',path):self.send_error(404);return
            super().do_GET()
        def end_headers(self):
            if state.get('relay'):
                self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' "+state['relay']+"; frame-src 'none'; worker-src 'none'")
            super().end_headers()
    front=ThreadingHTTPServer(('127.0.0.1',0),Handler);origin='http://127.0.0.1:'+str(front.server_port)
    app=RelayApp(Config(upstream=upstream,origins=frozenset({origin}),expected=expected,auth_only=auth_only,development=True),gateway)
    relay=make_server('127.0.0.1',0,app,server_class=ThreadedWSGI,handler_class=QuietWSGI)
    state['relay']='http://127.0.0.1:'+str(relay.server_port)
    for server in (front,relay):threading.Thread(target=server.serve_forever,daemon=True).start()
    try:yield origin,state['relay']+'/api',app
    finally:
        for server in (front,relay):server.shutdown();server.server_close()


def browser_auth(origin,endpoint,username,password,synthetic=False):
    from playwright.sync_api import sync_playwright
    import os
    report={'status':'FAIL','scope':'SYNTHETIC_REAL_HTTP_RELAY' if synthetic else 'LIVE_GAS_AUTH_ONLY_VIA_LOCAL_RELAY',
            'login':'NOT_RUN','gasCommunication':'NOT_RUN','unauthenticatedBlocked':'NOT_RUN','sessionReload':'NOT_RUN',
            'sessionExpiry':'NOT_RUN','logout':'NOT_RUN','revokedSessionBlocked':'NOT_RUN','rawFinancialDataIncluded':False,
            'actualNhCalls':0,'orderCalls':0,'accountStoreWrites':False}
    if not synthetic:print(json.dumps({'progress':'RELAY_BROWSER_AUTH_ONLY'}),flush=True)
    try:
        with sync_playwright() as p:
            launch={'headless':True}
            if os.environ.get('CHROMIUM_EXECUTABLE'):launch['executable_path']=os.environ['CHROMIUM_EXECUTABLE']
            browser=p.chromium.launch(**launch)
            try:
                context=browser.new_context(viewport={'width':1440,'height':882},service_workers='block')
                # No Playwright route handler: Chrome must exercise real HTTP OPTIONS/CORS.
                context.add_init_script('window.MYINVEST_TRANSPORT_CONFIG=Object.freeze('+json.dumps({'mode':'relay','endpoint':endpoint,'development':True})+');')
                page=context.new_page();report['phase']='PAGE'
                page.goto(origin,wait_until='domcontentloaded')
                report['phase']='UNAUTHENTICATED_PROBE'
                denied=page.evaluate("""async()=>{const r=await post({action:'sessionInfo'});const d=await r.json();return r.status===401&&d.code==='AUTH_REQUIRED'&&!('token' in d)}""")
                if not denied:raise RuntimeError()
                report['unauthenticatedBlocked']='PASS'
                report['phase']='METADATA'
                metadata=page.evaluate("async()=>{const r=await post({action:'appVersion'});const d=await r.json();return {ok:r.ok&&d.success&&d.freshTestEnvironment&&d.storeEngine==='account-store-v2',http:r.status,code:SafeDiagnostics.code(d.code)}}")
                if not metadata['ok']:
                    report['relayDiagnostic']={'http':metadata['http'],'code':metadata['code']};raise RuntimeError()
                report['gasCommunication']='PASS';report['phase']='LOGIN';report['login']='FAIL'
                page.locator('#authId').fill(username);page.locator('#authPw').fill(password);page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>LS('invest_session_token')&&$('appContainer').style.display==='block'||$('authMsg').textContent&&$('authMsg').textContent!=='서버 통신 중...'",timeout=150000)
                if not page.evaluate("()=>!!LS('invest_session_token')&&$('appContainer').style.display==='block'"):raise RuntimeError()
                report['login']='PASS';token=page.evaluate("()=>LS('invest_session_token')")
                page.reload(wait_until='domcontentloaded')
                page.wait_for_function("()=>$('appContainer').style.display==='block'&&!!LS('invest_session_token')",timeout=60000)
                if page.evaluate("()=>LS('invest_session_token')")!=token:raise RuntimeError()
                report['sessionReload']='PASS';report['phase']='SESSION_EXPIRY'
                if not synthetic:print(json.dumps({'progress':'REAL_FIVE_MINUTE_INACTIVITY'}),flush=True)
                def is_logout(response):
                    try:return response.url==endpoint and response.request.method=='POST' and json.loads(response.request.post_data or '{}').get('action')=='logout'
                    except Exception:return False
                # Client logout is asynchronous. Await its actual response before
                # probing revocation, rather than racing the GAS logout request.
                expiry_timeout=15000 if synthetic else 330000
                with page.expect_response(is_logout,timeout=expiry_timeout) as pending_logout:
                    if synthetic:
                        page.evaluate("()=>{localStorage.setItem('invest_last_active',String(Date.now()-SESSION_MS-1));renderSession()}")
                    page.wait_for_function("()=>!LS('invest_session_token')&&$('authGuard').style.display==='flex'",timeout=expiry_timeout)
                logout_response=pending_logout.value
                if not logout_response.ok:raise RuntimeError()
                report['sessionExpiry']='SYNTHETIC_BROWSER_CLOCK_PASS' if synthetic else 'PASS_REAL_INACTIVITY'
                denied=page.evaluate("""async token=>{const r=await post({action:'sessionInfo',token});const d=await r.json();return d.success===false&&!('accounts' in d)&&!('holdings' in d)}""",token)
                if not denied:raise RuntimeError()
                # HTTP 200 alone is insufficient: the subsequent session probe
                # must confirm that the formerly valid session is now rejected.
                report.update(status='PASS',phase='COMPLETE',revokedSessionBlocked='PASS',logout='PASS')
                # Local session must also be cleared after reload; no screenshots/traces/raw output.
            finally:
                try:
                    if 'page' in locals() and not page.is_closed():page.evaluate("async()=>{const token=LS('invest_session_token');if(token)await post({action:'logout',token})}")
                except Exception:report['logoutCleanup']='NOT_CONFIRMED'
                browser.close()
    except Exception:report['code']='RELAY_BROWSER_AUTH_NOT_CONFIRMED'
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--environment',type=Path,required=True);args=parser.parse_args()
    report={'status':'NOT_RUN','actualNhCalls':0,'orderCalls':0,'accountStoreWrites':False,'rawFinancialDataIncluded':False}
    try:
        env=private_path(args.environment,False);plan=json.loads((env/'fresh-plan.json').read_text())
        web=preflight(env,allow_same_source_tools=True)
        settings=deployment_settings(plan)
        if settings['status']!='PASS':report.update(code='DEPLOYMENT_SETTINGS_NOT_VERIFIED',deploymentSettings=settings)
        else:
            if not sys.stdin.isatty():raise ValueError()
            username=input('Fresh staging user (visible): ').strip();password=getpass.getpass('Fresh staging password (hidden): ')
            if not username or len(password)<16:raise ValueError()
            expected={'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':fingerprint(plan['scriptId']),
                      'sheetHash':web.binding,'sourceDigest':plan['sourceDigest'],'gatewayVersion':2,'storeEngine':'account-store-v2'}
            with local_servers(expected,plan['url']) as (origin,endpoint,_app):
                report=browser_auth(origin,endpoint,username,password)
                nh=sum(_app.metrics['upstreamAttempts'].get(a,0) for a in ('nhAccounts','nhQuotes','nhStockQuotes','nhExternalQuotes'))
                report['actualNhCalls']=nh;report['realHttpPreflights']=_app.metrics['preflights']
                if nh:report.update(status='FAIL',code='NH_SCOPE_VIOLATION')
            report['deploymentSettings']=settings;report['sourceDigest']='PASS';report['isolation']='PASS'
    except Exception:report.update(status='NOT_RUN',code='OWNER_RELAY_PREFLIGHT_OR_AUTH_REQUIRED')
    print(json.dumps(report));return 0 if report['status']=='PASS' else 2

if __name__=='__main__':raise SystemExit(main())
