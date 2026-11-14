"""Synthetic edge startup/security checks; no public service is contacted."""
import io
import json
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest.mock import Mock, patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'tools'), str(Path(__file__).resolve().parent)]
from nh_v2_https_browser import wait_for_https_edge, probe, probe_evidence, HttpsProbeFailure
from test_https_probe import Response, URL, ORIGIN, SECRET
from test_https_dns import Clock

PREFLIGHT = {'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
             'Access-Control-Allow-Headers': 'Content-Type, X-MyInvest-Dev-Key, X-MyInvest-Dev-Client'}


def edge_error(code=530, body=b'error code: 1033'):
    return urllib.error.HTTPError(URL, code, SECRET, {'Content-Type': 'text/plain'}, io.BytesIO(body))


class EdgeReadinessTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        for name, fn in [('monotonic', self.clock.monotonic), ('sleep', self.clock.sleep)]:
            p = patch('nh_v2_https_browser.time.' + name, side_effect=fn)
            p.start();self.addCleanup(p.stop)

    def test_530_wait_uses_only_credential_free_options_then_one_metadata_post(self):
        opener = Mock()
        opener.open.side_effect = [edge_error(), Response(b'', PREFLIGHT, 204),
                                  Response(b'{"success":true,"freshTestEnvironment":true}')]
        progress = Mock()
        with patch('nh_v2_https_browser.wait_for_dns', return_value={'attempts': 1}), \
             patch('nh_v2_https_browser.urllib.request.build_opener', return_value=opener):
            probe(URL, SECRET, on_edge_wait=progress)
        calls = [c.args[0] for c in opener.open.call_args_list]
        self.assertEqual([r.get_method() for r in calls], ['OPTIONS', 'OPTIONS', 'POST'])
        for request in calls[:2]:
            self.assertIsNone(request.data)
            self.assertIsNone(request.get_header('Authorization'))
            self.assertIsNone(request.get_header('X-myinvest-dev-key'))
            self.assertNotIn(SECRET, str(request.header_items()))
        self.assertEqual(json.loads(calls[2].data), {'action': 'appVersion'})
        self.assertEqual(self.clock.sleeps, [3])
        self.assertEqual(progress.call_args.args[0]['cloudflareCode'], 1033)
        self.assertNotIn(SECRET, json.dumps(progress.call_args.args))

    def test_persistent_530_stops_at_six_without_post_or_credentials(self):
        opener = Mock();opener.open.side_effect = lambda *a, **k: (_ for _ in ()).throw(edge_error())
        with self.assertRaises(HttpsProbeFailure) as caught:wait_for_https_edge(opener, URL)
        self.assertEqual(caught.exception.code, 'HTTPS_EDGE_NOT_READY')
        self.assertEqual(caught.exception.evidence['edgeAttempts'], 6)
        self.assertEqual(opener.open.call_count, 6)
        self.assertLessEqual(self.clock.now, 30)
        self.assertTrue(all(c.args[0].get_method() == 'OPTIONS' for c in opener.open.call_args_list))

    def test_slow_530_stops_at_deadline(self):
        def slow(*a, **k):
            self.clock.now += k['timeout']
            raise edge_error()
        opener = Mock();opener.open.side_effect = slow
        with self.assertRaises(HttpsProbeFailure):wait_for_https_edge(opener, URL)
        self.assertLessEqual(self.clock.now, 30)
        self.assertLessEqual(opener.open.call_count, 6)

    def test_auth_redirect_rate_limit_and_other_http_errors_are_not_retried(self):
        for code in (302, 401, 403, 429, 502):
            opener = Mock();opener.open.side_effect = edge_error(code)
            with self.subTest(code=code), self.assertRaises(urllib.error.HTTPError):wait_for_https_edge(opener, URL)
            self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(self.clock.sleeps, [])

    def test_transport_errors_are_not_retried(self):
        opener = Mock();opener.open.side_effect = urllib.error.URLError(SECRET)
        with self.assertRaises(urllib.error.URLError):wait_for_https_edge(opener, URL)
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(self.clock.sleeps, [])

    def test_wrong_status_origin_or_missing_client_header_blocks_before_post(self):
        cases = [(200, PREFLIGHT), (204, {}),
                 (204, dict(PREFLIGHT, **{'Access-Control-Allow-Origin': '*'})),
                 (204, dict(PREFLIGHT, **{'Access-Control-Allow-Headers': 'Content-Type, X-MyInvest-Dev-Key'}))]
        for status, headers in cases:
            opener = Mock();opener.open.return_value = Response(b'', headers, status)
            with self.subTest(status=status, headers=headers), self.assertRaises(HttpsProbeFailure):
                wait_for_https_edge(opener, URL)
            self.assertEqual(opener.open.call_count, 1)
            self.assertEqual(opener.open.call_args.args[0].get_method(), 'OPTIONS')

    def test_diagnostics_report_only_known_numeric_edge_codes(self):
        for raw, code in [(b'error code: 1016 ' + SECRET.encode(), 1016),
                          (b'ERROR CODE: 1033 ' + SECRET.encode(), 1033),
                          (b'error code: 10330', None), (b'error code: 9999', None)]:
            evidence = probe_evidence(530, {}, raw)
            self.assertEqual(evidence.get('cloudflareCode'), code)
            self.assertNotIn(SECRET, json.dumps(evidence))
        self.assertNotIn('cloudflareCode', probe_evidence(403, {}, b'error code: 1033'))
