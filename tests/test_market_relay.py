"""Public market scope/authorization tests with synthetic gateways only."""
import sys
from pathlib import Path
import unittest
from unittest.mock import Mock
from urllib.parse import urlencode

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
from relay.app import RelayApp, GasGateway, RelayFault
from relay.market_routes import allowed_market_url, NEWS_QUERIES
from relay.public_dev import PublicDevelopment
from test_relay import configuration, FakeGateway, request, TOKEN
from build_dev_pages import PAGE

INDEX='https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI'
VALID=[INDEX,
 'https://polling.finance.naver.com/api/realtime/domestic/stock/005930,000660',
 'https://stock.naver.com/api/polling/worldstock/index?reutersCodes=.INX,.IXIC,.VIX',
 'https://stock.naver.com/api/securityService/marketindex/majors/rpc',
 'https://stock.naver.com/api/securityService/marketindex/majors/bond',
 'https://stock.naver.com/api/securityService/marketindex/energy',
 'https://stock.naver.com/api/securityFe/api/index/KOSPI/integration',
 'https://stock.naver.com/api/domestic/market/theme/list?startIdx=0&pageSize=100&sortType=changeRate',
 'https://stock.naver.com/api/domestic/market/theme/12/stocklist?marketType=ALL&orderType=priceTop&startIdx=0&pageSize=100',
 'https://m.stock.naver.com/api/stocks/theme/12?page=1&pageSize=100',
 'https://m.stock.naver.com/api/index/KOSPI/price?pageSize=60&page=12',
 'https://m.stock.naver.com/api/stock/005930/price?pageSize=60&page=1',
 'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d',
 'https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?interval=1mo&range=10y',
 'https://finance.daum.net/api/home/sec?path=%2Fapi%2Ffutures%2FKR4A016C0004']
VALID += ['https://news.google.com/rss/search?'+urlencode({'q':q,'hl':'ko','gl':'KR','ceid':'KR:ko'}) for q in NEWS_QUERIES]


class MarketScopeTests(unittest.TestCase):
    def test_only_existing_ui_routes_and_bounded_query_shapes_are_allowed(self):
        for url in VALID:
            with self.subTest(url=url):self.assertTrue(allowed_market_url(url))

    def test_private_hosts_paths_credentials_nested_targets_and_extra_queries_are_denied(self):
        for url in ['https://api.nhplug.com:8443/order','https://127.0.0.1/api','http://stock.naver.com/api',
                    'https://user:secret@stock.naver.com/api','https://stock.naver.com/private/accounts',
                    INDEX+'?token=private',INDEX+'#private',INDEX+'?url=https://127.0.0.1',
                    'https://stock.naver.com.evil.example/api',
                    'https://query1.finance.yahoo.com/v8/finance/chart/%2e%2e%2fprivate?interval=1d&range=1d',
                    'https://query1.finance.yahoo.com/v8/finance/chart/%ZZ?interval=1d&range=1d',
                    'https://m.stock.naver.com/api/index/KOSPI/price?page=1&page=2&pageSize=60',
                    'https://m.stock.naver.com/api/index/KOSPI/price?page=13&pageSize=60',
                    'https://finance.daum.net/api/home/sec?path=%2Fapi%2Forders',
                    'https://news.google.com/rss/search?q=private-account&hl=ko&gl=KR&ceid=KR:ko']:
            with self.subTest(url=url):self.assertFalse(allowed_market_url(url))

    def test_flag_does_not_enable_the_full_gateway_or_nonisolated_targets(self):
        for kwargs in ({'auth_only':False},{'isolated':False,'production_authorized':True}):
            with self.assertRaises(RelayFault):configuration(public_market=True,**kwargs)

    def test_public_market_requires_bearer_and_keeps_every_nh_store_write_route_closed(self):
        gateway=FakeGateway();app=RelayApp(configuration(public_market=True),gateway)
        self.assertEqual(request(app,{'action':'publicFetch','url':INDEX})['status'],401)
        for action in ('nhAccounts','nhQuotes','nhStockQuotes','nhExternalQuotes','protectedHoldings',
                       'externalHoldings','externalHistory','externalDriveImages','saveExternalHoldings',
                       'restoreExternalHoldings','changePassword','register','getPendingUsers','approveUser','order'):
            self.assertIn(request(app,{'action':action},authorization='Bearer '+TOKEN)['status'],(400,403))
        self.assertEqual(gateway.calls,[])
        self.assertEqual(request(app,{'action':'publicFetch','url':INDEX},authorization='Bearer '+TOKEN)['status'],200)
        self.assertEqual(gateway.calls,[{'action':'publicFetch'}])

    def test_url_and_payload_scope_are_checked_before_upstream(self):
        gateway=FakeGateway();app=RelayApp(configuration(public_market=True),gateway)
        for extra in ({'url':'https://stock.naver.com/private'}, {'url':INDEX,'method':'POST'},
                      {'url':INDEX,'headers':{'Authorization':'private'}}):
            self.assertEqual(request(app,{'action':'publicFetch',**extra},authorization='Bearer '+TOKEN)['status'],403)
        self.assertEqual(gateway.calls,[])

    def test_capability_is_local_metadata_and_default_gateway_stays_auth_only(self):
        for enabled in (False,True):
            app=RelayApp(configuration(public_market=enabled),FakeGateway())
            self.assertEqual(request(app)['body']['developmentPublicMarket'],enabled)
            if not enabled:self.assertEqual(request(app,{'action':'publicFetch','url':INDEX},authorization='Bearer '+TOKEN)['status'],403)

    def test_public_market_still_requires_private_code_and_exact_origin(self):
        origin='https://kocoro97-corab.github.io';gateway=FakeGateway()
        app=PublicDevelopment(RelayApp(configuration(origins=frozenset({origin}),public_market=True),gateway),PAGE,'SYNTHETIC_PRIVATE_DEV_CODE')
        app.host='synthetic-market.trycloudflare.com'
        env={'REMOTE_ADDR':'127.0.0.1','HTTP_HOST':app.host,'HTTP_X_FORWARDED_PROTO':'https',
             'HTTP_X_MYINVEST_DEV_CLIENT':'dashboard-v2-dev','HTTP_X_MYINVEST_DEV_KEY':'wrong'}
        for who in (origin,'https://other.example'):
            self.assertEqual(request(app,{'action':'publicFetch','url':INDEX},origin=who,authorization='Bearer '+TOKEN,**env)['status'],403)
        self.assertEqual(gateway.calls,[])

    def test_gas_session_is_validated_before_public_get_and_no_token_enters_url(self):
        gateway=GasGateway(configuration(public_market=True));gateway.post=Mock(return_value={'success':True})
        gateway._read=Mock(return_value='SYNTHETIC_PUBLIC_DATA')
        self.assertEqual(gateway.public(INDEX,TOKEN),'SYNTHETIC_PUBLIC_DATA')
        gateway.post.assert_called_once_with({'action':'sessionInfo','token':TOKEN})
        req=gateway._read.call_args.args[0]
        self.assertEqual(req.get_method(),'GET');self.assertIsNone(req.data)
        self.assertNotIn(TOKEN,req.full_url);self.assertIsNone(req.get_header('Authorization'))
        self.assertEqual(gateway._read.call_args.kwargs,{'timeout':20,'max_bytes':2*1024*1024})
        for data in ({'success':False},{'success':True,'mustChangePassword':True}):
            gateway.post.return_value=data;gateway._read.reset_mock()
            with self.assertRaises(RelayFault):gateway.public(INDEX,TOKEN)
            gateway._read.assert_not_called()
