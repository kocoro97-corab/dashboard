"""Synthetic checks for credential-free, non-routing DNS diagnosis."""
from contextlib import contextmanager, redirect_stdout
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'tools'), str(Path(__file__).resolve().parent)]
import nh_v2_https as launcher
from nh_v2_https_browser import public_dns_status, diagnose_tunnel_dns, NoRedirect
from test_https_probe import URL, SECRET, Response

HOST = 'synthetic-only.trycloudflare.com'


class DnsDiagnosticTests(unittest.TestCase):
    def test_public_query_uses_fixed_verified_https_no_credentials_and_no_redirects(self):
        opener = Mock();opener.open.return_value = Response(b'{"Status":0,"Answer":[{"type":1,"data":"192.0.2.1"}]}')
        with patch('nh_v2_https_browser.urllib.request.build_opener', return_value=opener) as build:
            result = public_dns_status(HOST)
        self.assertEqual(result, 'ANSWER')
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, 'https://cloudflare-dns.com/dns-query?name=' + HOST + '&type=A')
        self.assertEqual(request.get_method(), 'GET');self.assertIsNone(request.data)
        self.assertIsInstance(build.call_args.args[0], NoRedirect)
        self.assertEqual(opener.open.call_args.kwargs['timeout'], 3)
        self.assertIsNone(request.get_header('Authorization'))
        self.assertIsNone(request.get_header('X-myinvest-dev-key'))
        self.assertNotIn('192.0.2.1', result)

    def test_only_fixed_public_dns_categories_are_returned(self):
        cases = [(b'{"Status":3}', 'NXDOMAIN'), (b'{"Status":0}', 'NO_A_RECORD'),
                 (b'{"Status":2}', 'DNS_ERROR'), (b'{"Status":true}', 'UNAVAILABLE'),
                 (SECRET.encode(), 'UNAVAILABLE'), (b'x' * 16385, 'UNAVAILABLE')]
        for body, expected in cases:
            opener = Mock();opener.open.return_value = Response(body)
            with self.subTest(expected=expected), patch('nh_v2_https_browser.urllib.request.build_opener', return_value=opener):
                self.assertEqual(public_dns_status(HOST), expected)
        with patch('nh_v2_https_browser.urllib.request.build_opener', side_effect=RuntimeError(SECRET)):
            self.assertEqual(public_dns_status(HOST), 'UNAVAILABLE')

    def test_arbitrary_host_never_reaches_dns_service(self):
        with patch('nh_v2_https_browser.urllib.request.build_opener') as opener:
            for host in ('localhost', 'other.example', HOST + '?token=' + SECRET):
                self.assertEqual(public_dns_status(host), 'UNAVAILABLE')
            opener.assert_not_called()

    def run_diagnostic(self, system, public):
        with patch('nh_v2_https_browser._dns_target'), \
             patch('nh_v2_https_browser._dns_lookup', side_effect=None if system else OSError(SECRET)) as local, \
             patch('nh_v2_https_browser.public_dns_status', return_value=public) as independent, \
             patch('nh_v2_https_browser.time.sleep') as sleep:
            samples = diagnose_tunnel_dns(URL)
        self.assertNotIn(SECRET, json.dumps(samples))
        self.assertNotIn(HOST, json.dumps(samples))
        self.assertEqual(local.call_args.args, (HOST, 3))
        self.assertLessEqual(local.call_count, 3);self.assertLessEqual(independent.call_count, 3)
        self.assertLessEqual(sleep.call_count, 2)
        return samples

    def test_public_resolution_distinguishes_system_only_failure_without_rerouting(self):
        samples = self.run_diagnostic(False, 'ANSWER')
        self.assertEqual(len(samples), 3)
        self.assertEqual(samples[-1]['comparison'], 'PUBLIC_ONLY_RESOLVES')

    def test_public_nxdomain_is_distinguished_from_unavailable_diagnostic_service(self):
        self.assertEqual(self.run_diagnostic(False, 'NXDOMAIN')[-1]['comparison'], 'BOTH_UNRESOLVED')
        self.assertEqual(self.run_diagnostic(False, 'UNAVAILABLE')[-1]['comparison'], 'INCONCLUSIVE')

    def test_success_stops_after_one_snapshot(self):
        samples = self.run_diagnostic(True, 'ANSWER')
        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0]['comparison'], 'BOTH_RESOLVE')

    def test_diagnostic_mode_reads_no_private_environment_and_requests_no_secrets(self):
        @contextmanager
        def tunnel(*args):yield HOST, None
        output = io.StringIO()
        with patch.object(sys, 'argv', ['tool', '--environment', '/nonexistent-private-environment',
                                       '--cloudflared', '/synthetic/binary', '--diagnose-tunnel-dns']), \
             patch.object(launcher, 'validate_runtime'), patch.object(launcher, 'tunnel', tunnel), \
             patch.object(launcher.socket, 'socket'), patch.object(launcher.signal, 'signal'), \
             patch.object(launcher, 'private_path') as private, patch.object(launcher, 'preflight') as gas, \
             patch.object(launcher.getpass, 'getpass') as secrets, \
             patch('nh_v2_https_browser.diagnose_tunnel_dns', return_value=[]), redirect_stdout(output):
            self.assertEqual(launcher.main(), 0)
        private.assert_not_called();gas.assert_not_called();secrets.assert_not_called()
        report = json.loads(output.getvalue())
        self.assertTrue(report['diagnosticComplete'])
        self.assertEqual(report['actualNhCalls'], 0);self.assertEqual(report['orderCalls'], 0)
        self.assertFalse(report['accountStoreWrites'])
        self.assertEqual(report['status'], 'NOT_RUN')  # Never a live HTTPS/login PASS.
