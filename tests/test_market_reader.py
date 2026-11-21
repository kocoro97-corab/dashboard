"""Strict public HTTP transport regression; synthetic responses, no network."""
import io
from pathlib import Path
import sys
import unittest
import urllib.error
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from relay.market_routes import read_market_text,NoMarketRedirect,MarketReadError

URL='https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI'
SECRET='SYNTHETIC_PRIVATE_MUST_NOT_LEAK'

class Response:
    def __init__(self,body=b'[]',url=URL,status=200):self.body=body;self.url=url;self.status=status;self.limit=None
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def geturl(self):return self.url
    def read(self,n):self.limit=n;return self.body[:n]

class MarketReaderTests(unittest.TestCase):
    def test_public_get_uses_fixed_headers_no_credentials_and_default_verified_https(self):
        opener=Mock();response=Response();opener.open.return_value=response
        with patch('relay.market_routes.urllib.request.build_opener',return_value=opener) as build:
            self.assertEqual(read_market_text(URL),'[]')
        self.assertIsInstance(build.call_args.args[0],NoMarketRedirect)
        self.assertEqual(len(build.call_args.args),1)
        req=opener.open.call_args.args[0]
        self.assertEqual(req.full_url,URL);self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
        self.assertEqual({k.lower() for k,v in req.header_items()},{'accept','accept-encoding','user-agent','referer'})
        self.assertIsNone(req.get_header('Authorization'));self.assertIsNone(req.get_header('Cookie'))
        self.assertEqual(opener.open.call_args.kwargs,{'timeout':20})
        self.assertEqual(response.limit,2*1024*1024+1)

    def test_exact_scope_is_checked_before_network_even_for_same_vendor(self):
        with patch('relay.market_routes.urllib.request.build_opener') as build:
            for url in ('http://stock.naver.com/api','https://stock.naver.com/private/accounts',URL+'?token='+SECRET):
                with self.assertRaises(MarketReadError):read_market_text(url)
            build.assert_not_called()

    def assert_failure(self,response=None,error=None,code=None):
        opener=Mock()
        if error is not None:opener.open.side_effect=error
        else:opener.open.return_value=response
        with self.assertRaises(MarketReadError) as caught:read_market_text(URL,opener)
        self.assertEqual(caught.exception.code,code);self.assertNotIn(SECRET,str(caught.exception))
        self.assertEqual(opener.open.call_count,1)

    def test_redirects_are_not_followed_or_retried_and_location_is_never_disclosed(self):
        for status in (301,302,307,308):
            error=urllib.error.HTTPError(URL,status,SECRET,{'Location':'https://private.invalid/?token='+SECRET},io.BytesIO(SECRET.encode()))
            self.assert_failure(error=error,code='RELAY_REDIRECT_DENIED')
        self.assertIsNone(NoMarketRedirect().redirect_request(None,None,302,'',{},'https://private.invalid'))

    def test_http_and_transport_failures_never_return_html_or_exception_text(self):
        self.assert_failure(error=urllib.error.HTTPError(URL,403,SECRET,{},io.BytesIO(SECRET.encode())),code='RELAY_PUBLIC_FAILED')
        self.assert_failure(error=urllib.error.URLError(SECRET),code='RELAY_UPSTREAM_NETWORK')
        self.assert_failure(response=Response(status=503),code='RELAY_PUBLIC_FAILED')

    def test_size_and_final_origin_checks_remain_enforced(self):
        self.assert_failure(response=Response(b'x'*(2*1024*1024+1)),code='RELAY_RESPONSE_TOO_LARGE')
        self.assert_failure(response=Response(url='https://private.invalid'),code='RELAY_REDIRECT_DENIED')

    def test_non_utf8_responses_do_not_become_quote_data(self):
        self.assert_failure(response=Response(b'\xff\xfe'),code='RELAY_RESPONSE_INVALID')
