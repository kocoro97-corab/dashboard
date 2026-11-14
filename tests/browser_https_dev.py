"""Simulated HTTPS Pages/edge UI regression, not proof of live TLS or CORS.
Playwright routing is used only here with synthetic data; owner verification
does not route/intercept requests. Existing local/live tests are not replayed.
"""
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tools'), str(ROOT / 'tests')]
from build_dev_pages import build, PAGE
from nh_v2_https_browser import verify
from relay.app import RelayApp
from relay.public_dev import PublicDevelopment
from test_relay import configuration, EXPECTED, request

HOST = 'synthetic-myinvest.trycloudflare.com'
ENDPOINT = 'https://' + HOST + '/api'
ORIGIN = 'https://kocoro97-corab.github.io'
CODE = 'SYNTHETIC_DEV_ACCESS_CODE_ONLY'
PASSWORD = 'SYNTHETIC_PRIVATE_PASSWORD'
TOKEN = 'a' * 64


def inspect_screens(page):
    try:inspect_screen_controls(page)
    except Exception:
        import traceback
        traceback.print_exc()
        raise


def inspect_screen_controls(page):
    assert page.locator('#cards .card').count() > 0
    assert '미조회' in page.locator('#status').inner_text()
    assert '미조회' in page.locator('#nhAccountRows').inner_text()
    assert '미조회' in page.locator('#externalAssetRows').inner_text()
    assert page.locator('#nhAccountBtn').is_disabled()
    assert page.locator('#externalUploadBtn').is_enabled()
    assert page.locator('#externalDriveFolder').is_disabled()
    assert page.locator('#authToggleTxt').is_hidden()
    assert page.locator('#adminBtn').is_hidden()
    page.locator('button[onclick="openModal()"]').click()
    assert page.locator('#mo').evaluate("el=>el.classList.contains('on')")
    page.locator('#tKR').click();assert page.locator('#tKR').evaluate("el=>el.classList.contains('active')")
    page.locator('#tUS').click();assert page.locator('#tUS').evaluate("el=>el.classList.contains('active')")
    page.locator('button[onclick="closeModal()"]').click()
    page.locator('button[onclick="openDg()"]').click()
    assert page.locator('#dg').evaluate("el=>el.classList.contains('on')")
    assert page.locator('#saveProxyBtn').is_disabled()
    page.locator('button[onclick="closeDg()"]').click()
    page.locator('#qm1').click();page.locator('#qm2').click()
    # The existing public listing master loads from this artifact only.
    page.wait_for_function("()=>!document.getElementById('externalMasterStatus').textContent.includes('확인 중')")


class AuthOnlyGas:
    def __init__(self):self.live = False;self.calls = []
    def verify(self):pass
    def post(self, payload):
        self.calls.append(payload['action'])
        if payload['action'] == 'appVersion':return dict(EXPECTED, success=True)
        if payload['action'] == 'login':
            self.live = payload.get('pass') == PASSWORD
            return {'success': True, 'token': TOKEN, 'isAdmin': True} if self.live else {'success': False, 'code': 'AUTH_REQUIRED'}
        if payload.get('token') != TOKEN or not self.live:return {'success': False, 'code': 'AUTH_REQUIRED'}
        if payload['action'] == 'logout':self.live = False;return {'success': True}
        if payload['action'] == 'sessionInfo':return {'success': True, 'isAdmin': True}
        raise AssertionError('AUTH_ONLY_SCOPE_VIOLATION')


with tempfile.TemporaryDirectory() as tmp:
    public = Path(tmp) / 'frontend'
    build(public)
    for width in (344, 768, 1440):
        gas = AuthOnlyGas()
        boundary = PublicDevelopment(RelayApp(configuration(origins=frozenset({ORIGIN})), gas), PAGE, CODE)
        boundary.host = HOST
        unexpected = []
        browser_actions = []
        def route(r):
            url = urlsplit(r.request.url)
            if url.hostname == 'kocoro97-corab.github.io' and url.path.startswith('/dashboard-v2-dev/'):
                name = url.path.removeprefix('/dashboard-v2-dev/') or 'index.html'
                file = public / name
                if file.is_file() and public in file.resolve().parents:
                    content = 'application/javascript' if file.suffix == '.js' else 'text/css' if file.suffix == '.css' else 'application/json' if file.suffix == '.json' else 'text/html'
                    r.fulfill(status=200, content_type=content, body=file.read_bytes());return
            if url.hostname == HOST and url.path == '/api':
                h = r.request.headers
                payload = json.loads(r.request.post_data or '{}')
                if r.request.method == 'POST':browser_actions.append(payload.get('action'))
                changes = dict(REMOTE_ADDR='127.0.0.1', HTTP_HOST=HOST, HTTP_X_FORWARDED_PROTO='https',
                               HTTP_REFERER='' if width == 344 else h.get('referer', ''),
                               HTTP_X_MYINVEST_DEV_CLIENT=h.get('x-myinvest-dev-client', ''),
                               HTTP_X_MYINVEST_DEV_KEY=h.get('x-myinvest-dev-key', ''))
                result = request(boundary, payload, origin=h.get('origin', ''),
                                 authorization=h.get('authorization'), method=r.request.method, **changes)
                r.fulfill(status=result['status'], headers=result['headers'], body=json.dumps(result['body']));return
            unexpected.append('UNEXPECTED_HOST_OR_PATH')
            r.abort()
        result = verify(ENDPOINT, CODE, 'synthetic-user', PASSWORD, synthetic=True, route=route, width=width, dashboard_check=inspect_screens)
        assert result['status'] == 'PASS', {k: v for k, v in result.items() if k in ('scope', 'code', 'phase', 'login', 'logout', 'sessionReload', 'developmentGate', 'networkEvidence')}
        assert not unexpected
        assert set(gas.calls) <= {'appVersion', 'login', 'sessionInfo', 'logout'}
        assert set(browser_actions) <= {'appVersion', 'login', 'sessionInfo', 'logout'}
        assert boundary.app.metrics['upstreamAttempts'].get('nhAccounts', 0) == 0
        print('PASS: SIMULATED HTTPS Pages connection/login/reload/logout, dev gate, isolated storage; ' + str(width) + 'px; actual NH calls 0')
