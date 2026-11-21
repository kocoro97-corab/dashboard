import io
import json
from pathlib import Path
import sys
import tempfile
import shutil
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tools'), str(ROOT / 'tests')]
from relay.app import RelayApp
from relay.public_dev import PublicDevelopment
from test_relay import configuration, FakeGateway, request, TOKEN
from build_dev_pages import build, PAGE

ORIGIN = 'https://kocoro97-corab.github.io'
CODE = 'SYNTHETIC_DEV_ACCESS_CODE_ONLY'
HOST = 'synthetic-myinvest.trycloudflare.com'


class PublicDevTests(unittest.TestCase):
    def setUp(self):
        self.gateway = FakeGateway()
        relay = RelayApp(configuration(origins=frozenset({ORIGIN})), self.gateway)
        self.time = 100
        self.app = PublicDevelopment(relay, PAGE, CODE, clock=lambda: self.time)
        self.app.host = HOST

    def call(self, payload=None, **changes):
        env = dict(REMOTE_ADDR='127.0.0.1', HTTP_HOST=HOST, HTTP_X_FORWARDED_PROTO='https',
                   HTTP_REFERER=PAGE, HTTP_X_MYINVEST_DEV_KEY=CODE)
        env.update(changes)
        return request(self.app, payload, origin=ORIGIN, **env)

    def test_https_loopback_and_exact_tunnel_host_are_mandatory(self):
        for change in ({'HTTP_X_FORWARDED_PROTO': 'http'}, {'HTTP_X_FORWARDED_PROTO': 'https,http'},
                       {'REMOTE_ADDR': '198.51.100.1'}, {'HTTP_HOST': 'other.trycloudflare.com'}):
            self.assertEqual(self.call(**change)['body']['code'], 'DEV_HTTPS_REQUIRED')
        self.assertEqual(self.gateway.calls, [])

    def test_cors_is_exact_and_production_pages_path_is_rejected_even_on_shared_origin(self):
        result = request(self.app, origin='https://other.example', REMOTE_ADDR='127.0.0.1', HTTP_HOST=HOST, HTTP_X_FORWARDED_PROTO='https')
        self.assertNotIn('Access-Control-Allow-Origin', result['headers'])
        self.assertEqual(self.call(HTTP_REFERER=ORIGIN + '/dashboard/')['body']['code'], 'DEV_PAGE_REQUIRED')
        self.assertEqual(self.call(HTTP_REFERER=PAGE + '?token=synthetic')['status'], 403)
        self.assertEqual(self.gateway.calls, [])

    def test_development_code_is_separate_from_gas_session_and_never_forwarded(self):
        self.assertEqual(self.call(HTTP_X_MYINVEST_DEV_KEY='')['status'], 403)
        self.assertEqual(self.call(HTTP_X_MYINVEST_DEV_KEY='incorrect')['status'], 403)
        self.assertEqual(self.call({'action': 'sessionInfo'})['status'], 401)
        self.assertEqual(self.gateway.calls, [])
        self.assertEqual(self.call({'action': 'sessionInfo'}, authorization='Bearer ' + TOKEN)['status'], 200)
        self.assertEqual(self.gateway.calls, [{'action': 'sessionInfo', 'token': TOKEN}])

    def test_actual_preflight_advertises_dev_header_without_authentication_or_upstream(self):
        r = self.call(method='OPTIONS', HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
                      HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,content-type,x-myinvest-dev-key,x-myinvest-dev-client',
                      HTTP_X_MYINVEST_DEV_KEY='', HTTP_REFERER='')
        self.assertEqual(r['status'], 204)
        self.assertEqual(r['headers']['Access-Control-Allow-Origin'], ORIGIN)
        self.assertIn('X-MyInvest-Dev-Key', r['headers']['Access-Control-Allow-Headers'])
        self.assertIn('X-MyInvest-Dev-Client', r['headers']['Access-Control-Allow-Headers'])
        self.assertEqual(self.gateway.calls, [])

    def test_reduced_or_missing_referrer_requires_marker_and_private_code(self):
        for referer in ('', ORIGIN + '/'):
            for marker in ('', 'incorrect'):
                self.assertEqual(self.call(HTTP_REFERER=referer, HTTP_X_MYINVEST_DEV_CLIENT=marker)['body']['code'], 'DEV_PAGE_REQUIRED')
            for code in ('', 'incorrect'):
                self.assertEqual(self.call(HTTP_REFERER=referer, HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev', HTTP_X_MYINVEST_DEV_KEY=code)['body']['code'], 'DEV_ACCESS_REQUIRED')
        self.assertEqual(self.gateway.calls, [])
        for referer in ('', ORIGIN + '/'):
            self.assertEqual(self.call(HTTP_REFERER=referer, HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev')['status'], 200)
        self.assertEqual(self.gateway.calls, [{'action': 'appVersion'}] * 2)

    def test_marker_does_not_bypass_origin_session_or_explicit_production_path(self):
        for origin in ('null', 'https://other.example'):
            result = self.call(HTTP_ORIGIN=origin, HTTP_REFERER='', HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev')
            self.assertEqual(result['status'], 403)
            self.assertNotIn('Access-Control-Allow-Origin', result['headers'])
        for referer in (ORIGIN + '/dashboard/', PAGE + '?token=synthetic'):
            self.assertEqual(self.call(HTTP_REFERER=referer, HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev')['body']['code'], 'DEV_PAGE_REQUIRED')
        self.assertEqual(self.call({'action': 'sessionInfo'}, HTTP_REFERER='', HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev')['status'], 401)
        self.assertEqual(self.gateway.calls, [])
        self.assertEqual(self.call({'action': 'sessionInfo'}, HTTP_REFERER='', HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev', authorization='Bearer ' + TOKEN)['status'], 200)
        self.assertEqual(self.gateway.calls, [{'action': 'sessionInfo', 'token': TOKEN}])

    def test_no_nh_store_order_or_arbitrary_target_reaches_gas(self):
        for action in ('nhAccounts', 'nhQuotes', 'nhStockQuotes', 'nhExternalQuotes', 'saveExternalHoldings', 'nhSnapshotCapture', 'order', 'cancel'):
            self.assertIn(self.call({'action': action}, HTTP_REFERER='', HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev', authorization='Bearer ' + TOKEN)['status'], (400, 403))
        self.assertEqual(self.call({'action': 'login', 'gasUrl': 'https://other.example/'})['status'], 400)
        self.assertEqual(self.gateway.calls, [])

    def test_body_size_and_chunked_requests_are_rejected_before_read_or_upstream(self):
        for changes in ({'CONTENT_LENGTH': '8193'}, {'CONTENT_LENGTH': '-1'}, {'CONTENT_LENGTH': 'nan'},
                        {'HTTP_TRANSFER_ENCODING': 'chunked'}):
            self.assertIn(self.call(**changes)['status'], (400, 413))
        self.assertEqual(self.gateway.calls, [])

    def test_global_rate_limit_does_not_trust_changing_forwarded_ip(self):
        for i in range(120):
            self.assertEqual(self.call(HTTP_X_FORWARDED_FOR='198.51.100.' + str(i))['status'], 200)
        r = self.call()
        self.assertEqual(r['status'], 429)
        self.assertEqual(r['headers']['Retry-After'], '60')
        self.assertEqual(len(self.gateway.calls), 120)
        self.time += 60
        self.assertEqual(self.call()['status'], 200)

    def test_login_budget_and_concurrent_budget_stop_before_gas(self):
        for _ in range(5):self.assertEqual(self.call({'action': 'login'})['status'], 200)
        self.assertEqual(self.call({'action': 'login'})['body']['code'], 'DEV_LOGIN_RATE_LIMIT')
        self.assertEqual(len(self.gateway.calls), 5)
        self.app.slots.acquire();self.app.slots.acquire()
        try:self.assertEqual(self.call()['body']['code'], 'DEV_BUSY')
        finally:self.app.slots.release();self.app.slots.release()
        self.assertEqual(len(self.gateway.calls), 5)

    def test_expiry_and_owner_stop_disable_external_access(self):
        self.time += 1800
        self.assertEqual(self.call()['body']['code'], 'DEV_ACCESS_CLOSED')
        self.time = 100
        self.app.close()
        self.assertEqual(self.call()['status'], 503)
        self.assertEqual(self.gateway.calls, [])

    def test_public_profile_cannot_expose_full_or_production_gateway(self):
        for config in (configuration(auth_only=False), configuration(isolated=False, production_authorized=True)):
            with self.assertRaises(ValueError):PublicDevelopment(RelayApp(config), PAGE, CODE)

    def test_dev_artifact_contains_only_public_assets_and_fails_closed_without_bootstrap(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'public'
            manifest = build(out)
            self.assertFalse(any(p.startswith(('gas/', 'tools/', '.git/')) for p in manifest))
            self.assertIn('const DEFAULT_GAS_URL="";', (out / 'js/auth.js').read_text())
            self.assertNotIn('AKfycbxySfUKUai418', (out / 'js/auth.js').read_text())
            text = (out / 'index.html').read_text()
            self.assertIn('devSession:true', text)
            self.assertIn('js/dev_inspection.js', text)
            self.assertTrue(json.loads((out / 'development-only.json').read_text())['screenInspection'])
            self.assertIn('Content-Security-Policy', text)
            self.assertIn('name="referrer" content="strict-origin-when-cross-origin"', text)
            self.assertNotIn('https://cdn.jsdelivr.net/npm/tesseract', text)
            self.assertIn('vendor/ocr/tesseract.min.js', text)
            self.assertIn("worker-src 'self'", text)
            self.assertIn("'wasm-unsafe-eval'", text)
            self.assertNotIn("'unsafe-eval'", text)
            self.assertTrue(json.loads((out / 'development-only.json').read_text())['publicMarketCapable'])
            self.assertFalse(json.loads((out / 'development-only.json').read_text())['nhAccountQueries'])
            with self.assertRaises(ValueError):build(out)

    def test_unreferenced_private_files_in_frontend_folders_are_not_published(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'source';root.mkdir()
            shutil.copyfile(ROOT / 'index.html', root / 'index.html')
            for folder in ('js', 'css', 'data', 'vendor'):shutil.copytree(ROOT / folder, root / folder)
            (root / 'js/unreferenced-private.js').write_text('SYNTHETIC_PRIVATE_CANARY')
            (root / 'vendor/ocr/unreferenced-private.txt').write_text('SYNTHETIC_PRIVATE_CANARY')
            with patch('build_dev_pages.subprocess.check_output', return_value='f' * 40):
                manifest = build(Path(tmp) / 'public', root)
            self.assertNotIn('js/unreferenced-private.js', manifest)
            self.assertNotIn('vendor/ocr/unreferenced-private.txt', manifest)
