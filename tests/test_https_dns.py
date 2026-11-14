import json
from pathlib import Path
import socket
import sys
import threading
import unittest
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from nh_v2_https_browser import wait_for_dns,_dns_lookup,probe,HttpsProbeFailure

URL='https://synthetic-only.trycloudflare.com/api'
HOST='synthetic-only.trycloudflare.com'
SECRET='SYNTHETIC_PRIVATE_VALUE_NEVER_PRINT'


class Clock:
    def __init__(self):self.now=0;self.sleeps=[]
    def monotonic(self):return self.now
    def sleep(self,n):self.sleeps.append(n);self.now+=n


class DnsReadinessTests(unittest.TestCase):
    def setUp(self):
        self.clock=Clock()
        for name,value in [('urllib.request.getproxies',{}),('urllib.request.proxy_bypass',False)]:
            p=patch('nh_v2_https_browser.'+name,return_value=value);p.start();self.addCleanup(p.stop)
        for name,fn in [('monotonic',self.clock.monotonic),('sleep',self.clock.sleep)]:
            p=patch('nh_v2_https_browser.time.'+name,side_effect=fn);p.start();self.addCleanup(p.stop)

    def test_immediate_resolution_does_not_wait_or_emit_progress(self):
        progress=Mock()
        with patch('nh_v2_https_browser._dns_lookup') as lookup:
            result=wait_for_dns(URL,on_wait=progress)
        self.assertEqual(result,{'dnsTarget':'PUBLIC_RELAY','attempts':1})
        self.assertEqual(lookup.call_args.args[0],HOST);progress.assert_not_called();self.assertEqual(self.clock.sleeps,[])

    def test_new_hostname_dns_errors_are_bounded_and_only_dns_is_retried(self):
        progress=Mock()
        failures=[socket.gaierror(socket.EAI_NONAME,SECRET),socket.gaierror(socket.EAI_AGAIN,SECRET),None]
        with patch('nh_v2_https_browser._dns_lookup',side_effect=failures) as lookup, \
             patch('nh_v2_https_browser.urllib.request.build_opener') as http:
            result=wait_for_dns(URL,on_wait=progress)
        self.assertEqual(result['attempts'],3);self.assertEqual(lookup.call_count,3)
        self.assertEqual(self.clock.sleeps,[3,3]);http.assert_not_called()
        self.assertNotIn(HOST,json.dumps(progress.call_args.args));self.assertNotIn(SECRET,json.dumps(progress.call_args.args))

    def test_persistent_public_dns_failure_reports_controls_and_sends_no_credentials(self):
        def lookup(host,timeout):
            if host==HOST:raise socket.gaierror(socket.EAI_NONAME,SECRET)
        with patch('nh_v2_https_browser._dns_lookup',side_effect=lookup) as dns, \
             patch('nh_v2_https_browser.urllib.request.build_opener') as http:
            with self.assertRaises(HttpsProbeFailure) as caught:probe(URL,SECRET)
        r=caught.exception
        self.assertEqual(r.code,'HTTPS_DNS_NOT_READY');self.assertEqual(r.evidence['attempts'],8)
        self.assertEqual(r.evidence['errno'],socket.EAI_NONAME)
        self.assertTrue(r.evidence['tunnelApiDns']);self.assertTrue(r.evidence['pagesDns'])
        self.assertEqual(dns.call_count,10);self.assertLessEqual(self.clock.now,30)
        http.assert_not_called();self.assertNotIn(SECRET,json.dumps(r.evidence));self.assertNotIn(HOST,json.dumps(r.evidence))

    def test_proxy_route_is_preserved_and_public_dns_is_not_required_locally(self):
        with patch('nh_v2_https_browser.urllib.request.getproxies',return_value={'https':'http://user:'+SECRET+'@proxy.synthetic:8080'}), \
             patch('nh_v2_https_browser._dns_lookup') as lookup:
            result=wait_for_dns(URL)
        self.assertEqual(result['dnsTarget'],'HTTPS_PROXY')
        self.assertEqual(lookup.call_count,1);self.assertEqual(lookup.call_args.args[0],'proxy.synthetic')
        self.assertNotIn(SECRET,json.dumps(result))

    def test_no_proxy_bypass_uses_the_public_target_as_urllib_does(self):
        with patch('nh_v2_https_browser.urllib.request.getproxies',return_value={'https':'http://proxy.synthetic:8080'}), \
             patch('nh_v2_https_browser.urllib.request.proxy_bypass',return_value=True), \
             patch('nh_v2_https_browser._dns_lookup') as lookup:
            result=wait_for_dns(URL)
        self.assertEqual(result['dnsTarget'],'PUBLIC_RELAY');self.assertEqual(lookup.call_args.args[0],HOST)

    def test_hung_resolver_stops_without_more_workers_or_http(self):
        with patch('nh_v2_https_browser._dns_lookup',side_effect=TimeoutError(SECRET)) as lookup:
            with self.assertRaises(HttpsProbeFailure) as caught:wait_for_dns(URL)
        self.assertEqual(lookup.call_count,1);self.assertIsNone(caught.exception.evidence['pagesDns'])
        self.assertNotIn(SECRET,json.dumps(caught.exception.evidence))

    def test_endpoint_policy_is_checked_before_dns_or_http(self):
        for url in ('http://synthetic-only.trycloudflare.com/api','https://other.example/api',URL+'?token='+SECRET,URL+'#'+SECRET):
            with self.subTest(url=url),patch('nh_v2_https_browser._dns_lookup') as lookup:
                with self.assertRaises(HttpsProbeFailure) as caught:wait_for_dns(url)
                self.assertEqual(caught.exception.code,'HTTPS_PROBE_ENDPOINT_INVALID');lookup.assert_not_called()
                self.assertNotIn(SECRET,str(caught.exception))


class ResolverDeadlineTests(unittest.TestCase):
    def test_system_lookup_can_time_out_without_changing_dns_or_global_socket_options(self):
        release=threading.Event()
        def blocked(*args,**kwargs):release.wait(2);return [(None,)]
        try:
            with patch('nh_v2_https_browser.socket.getaddrinfo',side_effect=blocked), \
                 patch('nh_v2_https_browser.socket.setdefaulttimeout') as global_timeout:
                with self.assertRaises(TimeoutError):_dns_lookup(HOST,.01)
                global_timeout.assert_not_called()
        finally:release.set()
