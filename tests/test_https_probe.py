import io
import json
from pathlib import Path
import socket
import ssl
import sys
import unittest
import urllib.error
from unittest.mock import Mock,patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
from nh_v2_https_browser import probe,HttpsProbeFailure,NoRedirect

URL='https://synthetic-only.trycloudflare.com/api'
ORIGIN='https://kocoro97-corab.github.io'
SECRET='SYNTHETIC_PRIVATE_VALUE_NEVER_PRINT'


class Response:
    def __init__(self,body,headers=None,status=200):
        self.body=body;self.status=status;self.headers=headers or {'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN}
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,size):return self.body[:size]


class HttpsProbeTests(unittest.TestCase):
    def probe_failure(self,response=None,error=None):
        opener=Mock()
        if error is not None:opener.open.side_effect=error
        else:opener.open.return_value=response
        with patch('nh_v2_https_browser.urllib.request.build_opener',return_value=opener):
            with self.assertRaises(HttpsProbeFailure) as caught:probe(URL,SECRET)
        self.assertEqual(opener.open.call_count,1)  # No replay or blind retry.
        failure=caught.exception
        self.assertNotIn(SECRET,json.dumps(failure.evidence));self.assertNotIn('https://',json.dumps(failure.evidence))
        self.assertNotIn(SECRET,str(failure))
        return failure

    def test_valid_metadata_uses_tls_default_no_redirects_and_no_login_body(self):
        opener=Mock();opener.open.return_value=Response(b'{"success":true,"freshTestEnvironment":true}')
        with patch('nh_v2_https_browser.urllib.request.build_opener',return_value=opener) as build:
            probe(URL,SECRET)
        self.assertIsInstance(build.call_args.args[0],NoRedirect)
        request=opener.open.call_args.args[0]
        self.assertEqual(request.full_url,URL);self.assertEqual(json.loads(request.data),{'action':'appVersion'})
        self.assertEqual(opener.open.call_count,1)

    def test_http_relay_denial_retains_only_whitelisted_reason_and_header_categories(self):
        headers={'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN}
        error=urllib.error.HTTPError(URL,403,SECRET,headers,io.BytesIO(json.dumps({'success':False,'code':'DEV_HTTPS_REQUIRED','message':SECRET}).encode()))
        r=self.probe_failure(error=error)
        self.assertEqual(r.code,'HTTPS_PROBE_HTTP_ERROR')
        self.assertEqual(r.evidence,{'http':403,'contentType':'JSON','allowOrigin':'APPROVED','redirectBlocked':False,'relayCode':'DEV_HTTPS_REQUIRED'})

    def test_non_json_edge_error_status_is_visible_without_html_or_raw_header(self):
        error=urllib.error.HTTPError(URL,530,SECRET,{'Content-Type':'text/html'},io.BytesIO(('<html>'+SECRET+'</html>').encode()))
        r=self.probe_failure(error=error)
        self.assertEqual(r.evidence['http'],530);self.assertEqual(r.evidence['contentType'],'HTML');self.assertEqual(r.evidence['allowOrigin'],'MISSING')

    def test_redirect_does_not_follow_location_or_disclose_it(self):
        error=urllib.error.HTTPError(URL,302,SECRET,{'Location':'https://other.example/?token='+SECRET},io.BytesIO())
        r=self.probe_failure(error=error)
        self.assertEqual(r.code,'HTTPS_PROBE_REDIRECT_BLOCKED');self.assertTrue(r.evidence['redirectBlocked'])
        self.assertIsNone(NoRedirect().redirect_request(None,None,302,'',{},'https://other.example/'))

    def test_tls_dns_timeout_and_proxy_failures_never_print_private_exception_text(self):
        cases=[(ssl.SSLCertVerificationError(1,SECRET),'TLS_CERTIFICATE'),
               (socket.gaierror(-2,SECRET),'DNS'),(TimeoutError(SECRET),'TIMEOUT'),
               (OSError('Tunnel connection failed: 403 '+SECRET),'PROXY_CONNECT')]
        for reason,expected in cases:
            with self.subTest(expected=expected):
                r=self.probe_failure(error=urllib.error.URLError(reason))
                self.assertEqual(r.code,'HTTPS_PROBE_TRANSPORT_ERROR');self.assertEqual(r.evidence['transport'],expected)

    def test_bad_json_metadata_and_missing_cors_remain_failures(self):
        for response,code in [(Response(SECRET.encode()),'HTTPS_PROBE_JSON_INVALID'),
                              (Response(b'{"success":true,"freshTestEnvironment":false}'),'HTTPS_PROBE_METADATA_MISMATCH'),
                              (Response(b'{}',{'Content-Type':'application/json','Access-Control-Allow-Origin':SECRET}),'HTTPS_PROBE_CORS_INVALID'),
                              (Response(b'x'*65537),'HTTPS_PROBE_RESPONSE_TOO_LARGE')]:
            with self.subTest(code=code):self.assertEqual(self.probe_failure(response=response).code,code)

    def test_unknown_response_code_and_message_are_not_reported(self):
        error=urllib.error.HTTPError(URL,403,SECRET,{'Content-Type':SECRET,'Access-Control-Allow-Origin':SECRET},
                                    io.BytesIO(json.dumps({'code':SECRET,'message':SECRET}).encode()))
        r=self.probe_failure(error=error)
        self.assertNotIn('relayCode',r.evidence);self.assertEqual(r.evidence['contentType'],'OTHER');self.assertEqual(r.evidence['allowOrigin'],'OTHER')
