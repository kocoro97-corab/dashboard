"""Public HTTPS/Pages verification; no local-flow or five-minute test replay."""
import json
import os
import queue
import re
import socket
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from build_dev_pages import PAGE

PROBE_RELAY_CODES=frozenset('''DEV_ACCESS_REQUIRED DEV_ACCESS_CLOSED DEV_PAGE_REQUIRED
DEV_HTTPS_REQUIRED DEV_RATE_LIMIT DEV_BUSY RELAY_ORIGIN_DENIED RELAY_PATH_DENIED
RELAY_BAD_REQUEST RELAY_REQUEST_SIZE RELAY_TARGET_MISMATCH RELAY_GAS_ACCESS_REQUIRED
RELAY_UPSTREAM_HTTP RELAY_UPSTREAM_NETWORK RELAY_GOOGLE_CONTENT_400 RELAY_NON_JSON
RELAY_RESPONSE_INVALID RELAY_SCOPE_BLOCKED'''.split())


class HttpsProbeFailure(Exception):
    """Only constructed with local codes and sanitized evidence below."""
    def __init__(self,code,evidence):
        self.code=code;self.evidence=evidence;super().__init__(code)


def _dns_lookup(host, timeout):
    """Bound the system resolver without altering DNS, proxies, TLS or routing."""
    result=queue.Queue(maxsize=1)
    def run():
        try:result.put((True,socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)))
        except Exception as error:result.put((False,error))
    threading.Thread(target=run,daemon=True).start()
    try:ok,value=result.get(timeout=max(.001,timeout))
    except queue.Empty:raise TimeoutError() from None
    if not ok:raise value
    if not value:raise socket.gaierror(socket.EAI_NONAME,'')


def _dns_target(endpoint):
    try:
        parsed=urlsplit(endpoint)
        if (parsed.scheme!='https' or not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com',parsed.hostname or '') or
                parsed.port not in (None,443) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path!='/api'):
            raise ValueError()
    except ValueError:raise HttpsProbeFailure('HTTPS_PROBE_ENDPOINT_INVALID',{'transport':'CONFIG'}) from None
    # urllib resolves the proxy locally when an HTTPS proxy is active; it need
    # not resolve the public target locally. Preserve inherited proxy/NO_PROXY.
    proxy=urllib.request.getproxies().get('https')
    if proxy and not urllib.request.proxy_bypass(parsed.hostname):
        try:
            route=urlsplit(proxy if '://' in proxy else '//'+proxy)
            if not route.hostname or route.port==0:raise ValueError()
        except ValueError:raise HttpsProbeFailure('HTTPS_PROBE_PROXY_CONFIG',{'dnsTarget':'HTTPS_PROXY'}) from None
        return route.hostname,'HTTPS_PROXY'
    return parsed.hostname,'PUBLIC_RELAY'


def wait_for_dns(endpoint, timeout=30, interval=3, max_attempts=8, on_wait=None):
    """Retry DNS only; no HTTP, credentials, fallback IP, or resolver changes."""
    host,role=_dns_target(endpoint)
    deadline=time.monotonic()+timeout
    attempts=0;last_errno=None;timed_out=False
    while attempts<max_attempts and time.monotonic()<deadline:
        attempts+=1
        try:
            _dns_lookup(host,deadline-time.monotonic())
            return {'dnsTarget':role,'attempts':attempts}
        except socket.gaierror as error:
            last_errno=error.errno
            if error.errno not in (socket.EAI_NONAME,socket.EAI_AGAIN):break
        except TimeoutError:
            timed_out=True;break  # Do not spawn more workers after a hung resolver.
        except OSError:break
        if on_wait and attempts==1:on_wait({'dnsTarget':role,'attempts':attempts})
        if attempts<max_attempts:
            remaining=deadline-time.monotonic()
            if remaining>0:time.sleep(min(interval,remaining))
    evidence={'transport':'DNS','dnsTarget':role,'attempts':attempts}
    if isinstance(last_errno,int):evidence['errno']=last_errno
    # One DNS-only control lookup per known service helps distinguish a new
    # hostname problem from a broader resolver issue. No response/IP is logged.
    for field,control in (('tunnelApiDns','api.trycloudflare.com'),('pagesDns','kocoro97-corab.github.io')):
        evidence[field]=None
        remaining=deadline-time.monotonic()
        if timed_out or remaining<=0:continue
        try:_dns_lookup(control,min(3,remaining));evidence[field]=True
        except (OSError,TimeoutError):evidence[field]=False
    raise HttpsProbeFailure('HTTPS_DNS_NOT_READY',evidence)


def public_dns_status(host):
    """Diagnostic only: query Cloudflare DNS over HTTPS, never use returned IPs.

    Only the public tunnel hostname is sent. No relay key, GAS identifier,
    account data, session or password is involved; redirects remain forbidden.
    """
    if not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com', host):
        return 'UNAVAILABLE'
    request = urllib.request.Request('https://cloudflare-dns.com/dns-query?name=' + host + '&type=A',
                                     headers={'Accept': 'application/dns-json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=3) as response:
            if response.status != 200:return 'UNAVAILABLE'
            raw = response.read(16385)
            if len(raw) > 16384:return 'UNAVAILABLE'
            data = json.loads(raw)
            if not isinstance(data, dict) or type(data.get('Status')) is not int:return 'UNAVAILABLE'
            if data['Status'] == 3:return 'NXDOMAIN'
            if data['Status'] == 0:
                answers = data.get('Answer')
                if not isinstance(answers, list):return 'NO_A_RECORD'
                return 'ANSWER' if any(isinstance(a, dict) and a.get('type') == 1 for a in answers) else 'NO_A_RECORD'
            return 'DNS_ERROR'
    except Exception:return 'UNAVAILABLE'


def diagnose_tunnel_dns(endpoint, on_sample=None):
    """Three bounded snapshots while the same tunnel stays alive; no API calls."""
    _dns_target(endpoint)  # Validate the allocated public endpoint, not a user target.
    host = urlsplit(endpoint).hostname
    samples = []
    for attempt in range(1, 4):
        try:_dns_lookup(host, 3);system = True
        except (OSError, TimeoutError):system = False
        public = public_dns_status(host)
        if public == 'ANSWER':
            comparison = 'BOTH_RESOLVE' if system else 'PUBLIC_ONLY_RESOLVES'
        elif public in ('NXDOMAIN', 'NO_A_RECORD', 'DNS_ERROR'):
            comparison = 'SYSTEM_ONLY_RESOLVES' if system else 'BOTH_UNRESOLVED'
        else:comparison = 'INCONCLUSIVE'
        sample = {'attempt': attempt, 'systemDns': system, 'publicDns': public, 'comparison': comparison}
        samples.append(sample)
        if on_sample:on_sample(sample)
        if system and public == 'ANSWER':break
        if attempt < 3:time.sleep(2)
    return samples


def probe_evidence(status,headers,raw=b''):
    headers=headers or {}
    content=str(headers.get('Content-Type','')).split(';')[0].lower().strip()
    origin=headers.get('Access-Control-Allow-Origin')
    result={'http':status if isinstance(status,int) and 100<=status<=599 else None,
            'contentType':'JSON' if content=='application/json' else 'HTML' if content=='text/html' else 'OTHER',
            'allowOrigin':'APPROVED' if origin=='https://kocoro97-corab.github.io' else 'MISSING' if not origin else 'OTHER',
            'redirectBlocked':isinstance(status,int) and 300<=status<=399}
    if status == 530:
        # Only recognize known numeric edge codes; never report the body, Ray
        # ID, requested URL or arbitrary header/exception text.
        match = re.search(rb'\berror code:\s*(1016|1033)\b', raw, re.IGNORECASE)
        if match:result['cloudflareCode'] = int(match[1])
    # Parse privately; report only exact local codes, never an upstream message.
    try:
        data=json.loads(raw)
        if isinstance(data,dict) and isinstance(data.get('code'),str) and data['code'] in PROBE_RELAY_CODES:
            result['relayCode']=data['code']
    except Exception:pass
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):return None


def wait_for_https_edge(opener, endpoint, on_wait=None):
    """Bound 530 startup waiting using credential-free preflights only.

    No login/session or metadata POST is retried. Non-530 errors fail immediately.
    The caller validates DNS/endpoint first and handles transport failures.
    """
    deadline = time.monotonic() + 30
    required = {'content-type', 'x-myinvest-dev-key', 'x-myinvest-dev-client'}
    request = urllib.request.Request(endpoint, method='OPTIONS', headers={
        'Origin': 'https://kocoro97-corab.github.io',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': ','.join(sorted(required))})
    for attempt in range(1, 7):
        try:
            with opener.open(request, timeout=max(.001, min(5, deadline-time.monotonic()))) as response:
                evidence = probe_evidence(response.status, response.headers)
                methods = {v.strip().upper() for v in response.headers.get('Access-Control-Allow-Methods', '').split(',')}
                headers = {v.strip().lower() for v in response.headers.get('Access-Control-Allow-Headers', '').split(',')}
                if response.status != 204:
                    raise HttpsProbeFailure('HTTPS_PROBE_PREFLIGHT_INVALID', evidence)
                if evidence['allowOrigin'] != 'APPROVED' or 'POST' not in methods or not required <= headers:
                    raise HttpsProbeFailure('HTTPS_PROBE_CORS_INVALID', evidence)
                return
        except urllib.error.HTTPError as error:
            if error.code != 530:raise
            try:
                raw = error.read(65536)
                evidence = probe_evidence(error.code, error.headers, raw)
            finally:error.close()
            evidence['edgeAttempts'] = attempt
            remaining = deadline - time.monotonic()
            if attempt == 6 or remaining <= 0:
                raise HttpsProbeFailure('HTTPS_EDGE_NOT_READY', evidence) from None
            if on_wait:on_wait(evidence)
            time.sleep(min(3, remaining))
            if time.monotonic() >= deadline:
                raise HttpsProbeFailure('HTTPS_EDGE_NOT_READY', evidence) from None


def network_failure(request, endpoint, phase):
    if request.url != endpoint:return None
    # Chrome 141 can report a consumed fetch as aborted when reload starts.
    # Only that explicit navigation phase is exempt; CORS/ERR_FAILED is fatal.
    return 'RELOAD_CANCELLED' if phase == 'SESSION_RELOAD' and request.failure == 'net::ERR_ABORTED' else 'HTTPS_API_FAILURE'


def probe(endpoint, access_code, on_dns_wait=None, on_edge_wait=None):
    """TLS verified, no redirects; no password or session, only metadata."""
    dns=wait_for_dns(endpoint,on_wait=on_dns_wait)
    opener = urllib.request.build_opener(NoRedirect())
    request = urllib.request.Request(endpoint, data=b'{"action":"appVersion"}', method='POST', headers={
        'Origin': 'https://kocoro97-corab.github.io', 'Referer': PAGE,
        'Content-Type': 'application/json', 'X-MyInvest-Dev-Key': access_code})
    try:
        wait_for_https_edge(opener, endpoint, on_wait=on_edge_wait)
        with opener.open(request, timeout=30) as response:
            raw=response.read(65537)
            evidence=probe_evidence(response.status,response.headers,raw[:65536])
            if len(raw)>65536:raise HttpsProbeFailure('HTTPS_PROBE_RESPONSE_TOO_LARGE',evidence)
            if response.status!=200:raise HttpsProbeFailure('HTTPS_PROBE_HTTP_ERROR',evidence)
            if evidence['allowOrigin']!='APPROVED':raise HttpsProbeFailure('HTTPS_PROBE_CORS_INVALID',evidence)
            try:data=json.loads(raw)
            except Exception:raise HttpsProbeFailure('HTTPS_PROBE_JSON_INVALID',evidence) from None
            if not isinstance(data,dict) or data.get('success') is not True or data.get('freshTestEnvironment') is not True:
                raise HttpsProbeFailure('HTTPS_PROBE_METADATA_MISMATCH',evidence)
            return dns
    except HttpsProbeFailure:raise
    except urllib.error.HTTPError as error:
        try:
            try:raw=error.read(65536)
            except Exception:raw=b''
            evidence=probe_evidence(error.code,error.headers,raw)
        finally:error.close()
        raise HttpsProbeFailure('HTTPS_PROBE_REDIRECT_BLOCKED' if evidence['redirectBlocked'] else 'HTTPS_PROBE_HTTP_ERROR',evidence) from None
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        reason=error.reason if isinstance(error,urllib.error.URLError) else error
        kind=('TLS_CERTIFICATE' if isinstance(reason,ssl.SSLCertVerificationError) else
              'TLS' if isinstance(reason,ssl.SSLError) else
              'TIMEOUT' if isinstance(reason,(TimeoutError,socket.timeout)) else
              'DNS' if isinstance(reason,socket.gaierror) else 'NETWORK')
        evidence={'transport':kind}
        if kind=='DNS':evidence['dnsTarget']=dns['dnsTarget']
        if isinstance(getattr(reason,'errno',None),int):evidence['errno']=reason.errno
        proxy=re.match(r'^Tunnel connection failed: ([1-5][0-9]{2})(?:\s|$)',str(reason))
        if proxy:evidence.update(transport='PROXY_CONNECT',proxyHttp=int(proxy[1]))
        raise HttpsProbeFailure('HTTPS_PROBE_TRANSPORT_ERROR',evidence) from None


def verify(endpoint, access_code, username, password, synthetic=False, route=None, width=1440, dashboard_check=None):
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
                if dashboard_check:dashboard_check(page)
                report['phase'] = 'SESSION_RELOAD'
                page.reload(wait_until='domcontentloaded')
                page.wait_for_function("()=>!!document.getElementById('devBanner')&&$('appContainer').style.display==='block'", timeout=90000)
                if page.evaluate("()=>LS('invest_session_token')") != token:raise ValueError()
                report['sessionReload'] = 'PASS'
                if dashboard_check:dashboard_check(page)
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
