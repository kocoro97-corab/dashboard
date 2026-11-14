"""Allocation lifecycle/security regressions; synthetic connectors and DNS only."""
from contextlib import contextmanager
from pathlib import Path
import json
import sys
import unittest
from unittest.mock import Mock, patch

sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'tools')]
import nh_v2_https as launcher
from nh_v2_https_browser import HttpsProbeFailure

SECRET = 'SYNTHETIC_DEV_CODE_NEVER_LOG'
EVIDENCE = {'dnsTarget': 'PUBLIC_RELAY', 'transport': 'DNS', 'attempts': 8,
            'tunnelApiDns': True, 'pagesDns': True, 'errno': -2}


class AllocationTests(unittest.TestCase):
    def setUp(self):
        self.boundaries = [];self.events = [];self.progress = Mock()
        def boundary(*a, **k):
            app = Mock();app.clock=lambda:0;app.deadline=60;self.boundaries.append(app);return app
        @contextmanager
        def serve(app, *a):
            if len(self.boundaries) > 1:self.boundaries[-2].close.assert_called_once()
            n = len(self.boundaries)
            self.events.append(('open', n))
            try:yield 'https://synthetic-' + str(n) + '.trycloudflare.com/api', Mock()
            finally:
                app.close();self.events.append(('close', n))
        for name, replacement in [('PublicDevelopment', boundary), ('serve', serve)]:
            p = patch.object(launcher, name, replacement);p.start();self.addCleanup(p.stop)
        p=patch('nh_v2_https_browser.wait_for_dns',side_effect=self.failure())
        self.waiter=p.start();self.addCleanup(p.stop)

    def ready(self):
        return launcher.ready_public_relay(Mock(), SECRET, Path('/synthetic/binary'), 60, self.progress)

    def failure(self, **changes):
        return HttpsProbeFailure('HTTPS_DNS_NOT_READY', dict(EVIDENCE, **changes))

    def test_failed_allocation_is_compared_before_cleanup_then_replaced_once(self):
        def compare(host):
            self.assertEqual(host, 'synthetic-1.trycloudflare.com')
            self.boundaries[0].close.assert_not_called()
            return 'NXDOMAIN'
        with patch('nh_v2_https_browser.probe', side_effect=[self.failure(), {'attempts': 1}]) as probe, \
             patch('nh_v2_https_browser.public_dns_status', side_effect=compare) as dns:
            with self.ready() as (endpoint, process, public, result):
                self.assertEqual(endpoint, 'https://synthetic-2.trycloudflare.com/api')
                self.assertEqual(result['allocationAttempt'], 2)
                public.close.assert_not_called()
                self.assertEqual(self.events, [('open', 1), ('close', 1), ('open', 2)])
        self.assertEqual(probe.call_count, 2);self.assertEqual(dns.call_count, 1)
        self.assertEqual(self.events[-1], ('close', 2))
        text = json.dumps(self.progress.call_args.args)
        self.assertNotIn(SECRET, text);self.assertNotIn('synthetic-', text)

    def test_three_missing_allocations_stop_without_infinite_reprovisioning(self):
        with patch('nh_v2_https_browser.probe', side_effect=lambda *a, **k: (_ for _ in ()).throw(self.failure())) as probe, \
             patch('nh_v2_https_browser.public_dns_status', return_value='NO_A_RECORD'):
            with self.assertRaises(HttpsProbeFailure) as caught:
                with self.ready():self.fail('NO_READY_ALLOCATION')
        self.assertEqual(len(self.boundaries), 3);self.assertEqual(probe.call_count, 3)
        self.assertEqual(caught.exception.evidence['allocationAttempt'], 3)
        self.assertEqual(caught.exception.evidence['publicDns'], 'NO_A_RECORD')
        self.assertEqual(self.progress.call_count, 2)
        for app in self.boundaries:app.close.assert_called_once()

    def test_local_failure_with_public_answer_unknown_or_servfail_is_not_reallocated(self):
        for status in ('ANSWER', 'UNAVAILABLE', 'DNS_ERROR'):
            with self.subTest(status=status), patch('nh_v2_https_browser.probe', side_effect=self.failure()), \
                 patch('nh_v2_https_browser.public_dns_status', return_value=status):
                before = len(self.boundaries)
                with self.assertRaises(HttpsProbeFailure):
                    with self.ready():self.fail('DNS_NOT_READY')
                self.assertEqual(len(self.boundaries), before + 1)

    def test_failed_controls_or_proxy_dns_do_not_trigger_reallocation(self):
        for changes in ({'tunnelApiDns': False}, {'pagesDns': None}, {'dnsTarget': 'HTTPS_PROXY'}):
            with self.subTest(changes=changes), patch('nh_v2_https_browser.probe', side_effect=self.failure(**changes)), \
                 patch('nh_v2_https_browser.public_dns_status', return_value='NXDOMAIN'):
                before = len(self.boundaries)
                with self.assertRaises(HttpsProbeFailure):
                    with self.ready():self.fail('DNS_NOT_READY')
                self.assertEqual(len(self.boundaries), before + 1)

    def test_auth_cors_http_errors_never_reallocate_or_query_public_dns(self):
        for code in ('HTTPS_PROBE_HTTP_ERROR', 'HTTPS_PROBE_CORS_INVALID', 'HTTPS_EDGE_NOT_READY'):
            with self.subTest(code=code), patch('nh_v2_https_browser.probe', side_effect=HttpsProbeFailure(code, {})), \
                 patch('nh_v2_https_browser.public_dns_status') as dns:
                before = len(self.boundaries)
                with self.assertRaises(HttpsProbeFailure):
                    with self.ready():self.fail('NOT_READY')
                self.assertEqual(len(self.boundaries), before + 1);dns.assert_not_called()

    def test_error_after_ready_and_owner_interrupt_close_without_any_retry(self):
        for error in (self.failure(), KeyboardInterrupt()):
            with patch('nh_v2_https_browser.probe', return_value={'attempts': 1}) as probe, \
                 patch('nh_v2_https_browser.public_dns_status') as dns:
                before = len(self.boundaries)
                with self.assertRaises(type(error)):
                    with self.ready():raise error
                self.assertEqual(len(self.boundaries), before + 1)
                probe.assert_called_once();dns.assert_not_called()
                self.boundaries[-1].close.assert_called_once()

    def test_public_answer_keeps_same_tunnel_until_local_resolution_and_single_metadata_probe(self):
        self.waiter.side_effect=None
        self.waiter.return_value={'attempts':2}
        with patch('nh_v2_https_browser.probe',side_effect=[self.failure(),{'attempts':1}]) as probe, \
             patch('nh_v2_https_browser.public_dns_status',return_value='ANSWER'):
            with self.ready() as (endpoint,process,public,dns):
                self.assertEqual(len(self.boundaries),1)
                self.assertEqual(dns['allocationAttempt'],1)
                public.close.assert_not_called()
        self.assertEqual(probe.call_count,2)  # First exits before HTTP at DNS stage.
        self.assertEqual(probe.call_args_list[0].args,probe.call_args_list[1].args)
        self.waiter.assert_called_once_with('https://synthetic-1.trycloudflare.com/api',timeout=60,interval=8,max_attempts=8)
        self.assertEqual(self.progress.call_args.args[0]['progress'],'HTTPS_LOCAL_DNS_WAIT')
        self.assertNotIn(SECRET,json.dumps(self.progress.call_args.args))

    def test_expired_local_wait_closes_without_another_http_probe_or_allocation(self):
        with patch('nh_v2_https_browser.probe',side_effect=self.failure()) as probe, \
             patch('nh_v2_https_browser.public_dns_status',return_value='ANSWER'):
            with self.assertRaises(HttpsProbeFailure) as caught:
                with self.ready():self.fail('LOCAL_DNS_NOT_READY')
        self.assertTrue(caught.exception.evidence['localWaitAttempted'])
        self.assertEqual(probe.call_count,1);self.assertEqual(len(self.boundaries),1)
        self.boundaries[0].close.assert_called_once()
