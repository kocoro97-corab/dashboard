"""Public HTTPS/Pages verification; no local-flow or five-minute test replay."""
import json
import os
import subprocess
import urllib.error
import urllib.request
from build_dev_pages import PAGE


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):return None


def network_failure(request, endpoint, phase):
    if request.url != endpoint:return None
    # Chrome 141 can report a consumed fetch as aborted when reload starts.
    # Only that explicit navigation phase is exempt; CORS/ERR_FAILED is fatal.
    return 'RELOAD_CANCELLED' if phase == 'SESSION_RELOAD' and request.failure == 'net::ERR_ABORTED' else 'HTTPS_API_FAILURE'


def probe(endpoint, access_code):
    """TLS verified, no redirects; no password or session, only metadata."""
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(endpoint, data=b'{"action":"appVersion"}', method='POST', headers={
        'Origin': 'https://kocoro97-corab.github.io', 'Referer': PAGE,
        'Content-Type': 'application/json', 'X-MyInvest-Dev-Key': access_code})
    with opener.open(request, timeout=30) as response:
        if response.status != 200 or response.headers.get('Access-Control-Allow-Origin') != 'https://kocoro97-corab.github.io':
            raise ValueError('HTTPS_EDGE_NOT_CONFIRMED')
        data = json.load(response)
        if data.get('success') is not True or data.get('freshTestEnvironment') is not True:
            raise ValueError('HTTPS_EDGE_NOT_CONFIRMED')


def verify(endpoint, access_code, username, password, synthetic=False, route=None, width=1440):
    from playwright.sync_api import sync_playwright
    report = {'status': 'FAIL', 'scope': 'SIMULATED_HTTPS_PAGES' if synthetic else 'LIVE_HTTPS_PAGES_TO_TEST_GAS',
              'https': 'NOT_RUN', 'login': 'NOT_RUN', 'unauthenticatedBlocked': 'NOT_RUN',
              'developmentGate': 'NOT_RUN', 'sessionReload': 'NOT_RUN', 'logout': 'NOT_RUN',
              'revokedSessionBlocked': 'NOT_RUN', 'productionStorageUnchanged': 'NOT_RUN',
              'corsAndRedirects': 'NOT_RUN', 'phase': 'SETUP',
              'actualNhCalls': 0, 'orderCalls': 0, 'accountStoreWrites': False,
              'rawFinancialDataIncluded': False}
    try:
        with sync_playwright() as p:
            launch = {'headless': True}
            if os.environ.get('CHROMIUM_EXECUTABLE'):launch['executable_path'] = os.environ['CHROMIUM_EXECUTABLE']
            browser = p.chromium.launch(**launch)
            try:
                context = browser.new_context(viewport={'width': width, 'height': 882}, service_workers='block')
                # Only synthetic tests install routing. Actual owner check has none.
                if route:context.route('**/*', route)
                page = context.new_page()
                failures = []
                def failed(request):
                    code = network_failure(request, endpoint, report['phase'])
                    if code:failures.append(code)
                page.on('requestfailed', failed)
                page.on('request', lambda request: failures.append('DIRECT_GAS_REQUEST') if request.url.startswith(('https://script.google.com/', 'https://script.googleusercontent.com/')) else None)
                page.goto(PAGE, wait_until='domcontentloaded')
                report['phase'] = 'SOURCE_METADATA'
                marker = page.evaluate("async()=>{const r=await fetch('development-only.json',{cache:'no-store'});return r.json()}")
                revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
                if marker.get('myinvestDevelopmentOnly') is not True or marker.get('sourceCommit') != revision:
                    report['code'] = 'DEV_PAGES_SOURCE_MISMATCH';return report
                before = page.evaluate('()=>JSON.stringify(Object.entries(localStorage).sort())')
                report['phase'] = 'DEV_CONNECTION'
                page.locator('#devEndpoint').fill(endpoint)
                page.locator('#devCode').fill(access_code)
                page.locator('#devConnectSubmit').click()
                page.wait_for_selector('#devBanner', timeout=90000)
                report['https'] = 'SIMULATED_PASS' if synthetic else 'PASS'
                report['phase'] = 'UNAUTHENTICATED_PROBE'
                blocked = page.evaluate("""async()=>{const r=await post({action:'sessionInfo'});const d=await r.json();return r.status===401&&d.success===false}""")
                if not blocked:raise ValueError()
                report['unauthenticatedBlocked'] = 'PASS'
                report['phase'] = 'DEV_GATE'
                blocked = page.evaluate("""async()=>{const c=window.MYINVEST_TRANSPORT_CONFIG,old=c.devAccessCode;c.devAccessCode='SYNTHETIC_INVALID_DEV_ACCESS';try{const r=await post({action:'appVersion'});return r.status===403}finally{c.devAccessCode=old}}""")
                if not blocked:raise ValueError()
                report['developmentGate'] = 'PASS'
                report['phase'] = 'LOGIN'
                page.locator('#authId').fill(username)
                page.locator('#authPw').fill(password)
                page.locator('#authSubmitBtn').click()
                page.wait_for_function("()=>!!LS('invest_session_token')&&$('appContainer').style.display==='block'", timeout=120000)
                token = page.evaluate("()=>LS('invest_session_token')")
                report['login'] = 'PASS'
                report['phase'] = 'SESSION_RELOAD'
                page.reload(wait_until='domcontentloaded')
                page.wait_for_function("()=>!!document.getElementById('devBanner')&&$('appContainer').style.display==='block'", timeout=90000)
                if page.evaluate("()=>LS('invest_session_token')") != token:raise ValueError()
                report['sessionReload'] = 'PASS'
                report['phase'] = 'LOGOUT'
                with page.expect_response(lambda r: r.url == endpoint and r.request.method == 'POST' and json.loads(r.request.post_data or '{}').get('action') == 'logout', timeout=90000):
                    page.evaluate('logout()')
                report['phase'] = 'REVOCATION'
                blocked = page.evaluate("""async token=>{const r=await post({action:'sessionInfo',token});const d=await r.json();return d.success===false&&!('accounts' in d)&&!('holdings' in d)}""", token)
                if not blocked:raise ValueError()
                report['logout'] = report['revokedSessionBlocked'] = 'PASS'
                report['phase'] = 'STORAGE_PRESERVATION'
                after = page.evaluate('()=>JSON.stringify(Object.entries(localStorage).sort())')
                if before != after:raise ValueError()
                report['phase'] = 'NETWORK_EVIDENCE'
                report['networkEvidence'] = {code: failures.count(code) for code in ('RELOAD_CANCELLED', 'HTTPS_API_FAILURE', 'DIRECT_GAS_REQUEST')}
                if any(code != 'RELOAD_CANCELLED' for code in failures):raise ValueError()
                report.update(status='PASS', phase='COMPLETE', productionStorageUnchanged='PASS', corsAndRedirects='SIMULATED_PASS' if synthetic else 'PASS')
            finally:
                try:
                    if 'page' in locals():page.evaluate("async()=>{const t=LS('invest_session_token');if(t)await Promise.race([post({action:'logout',token:t}),new Promise(resolve=>setTimeout(resolve,2000))])}")
                except Exception:report['logoutCleanup'] = 'NOT_CONFIRMED'
                browser.close()
    except Exception:
        report.setdefault('code', 'HTTPS_PAGES_BROWSER_NOT_CONFIRMED')
    return report
