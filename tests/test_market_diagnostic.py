"""Response-shape diagnosis: synthetic payloads only, never raw data logging."""
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock,patch
import tempfile
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools')]
from nh_v2_https_browser import market_payload_summary,direct_market_summary,diagnose_market_proxy,NoRedirect
from relay.app import RelayFault
import nh_v2_https as launcher

SECRET='SYNTHETIC_PRIVATE_VALUE_NEVER_REPORT'
TOKEN='a'*64
INDEX='https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI'
QUOTE='{"datas":[{"closePrice":"1,234.50","private":"'+SECRET+'"}]}'
RSS='<rss><channel><item><title>'+SECRET+'</title></item></channel></rss>'

class MarketDiagnosticTests(unittest.TestCase):
    def test_owner_diagnostic_skips_tunnel_browser_and_development_code_prompt(self):
        with tempfile.TemporaryDirectory() as tmp:
            env=Path(tmp);(env/'fresh-plan.json').write_text(json.dumps({'scriptId':SECRET,'sourceDigest':'c'*64,
                'url':'https://script.google.com/macros/s/SYNTHETIC_PUBLIC_PROXY_ONLY/exec'}))
            gateway=Mock();out=io.StringIO()
            with patch.object(sys,'argv',['tool','--environment',str(env),'--cloudflared','/synthetic/binary','--public-market','--diagnose-market']), \
                 patch.object(launcher.signal,'signal'),patch.object(launcher,'validate_runtime'), \
                 patch.object(launcher,'private_path',return_value=env),patch.object(launcher,'preflight',return_value=SimpleNamespace(binding='b'*64)), \
                 patch.object(launcher,'deployment_settings',return_value={'status':'PASS'}),patch.object(launcher,'RelayApp',return_value=SimpleNamespace(gateway=gateway)), \
                 patch.object(launcher,'ready_public_relay') as tunnel,patch.object(launcher.getpass,'getpass',return_value=SECRET) as password, \
                 patch('builtins.input',return_value=SECRET),patch('nh_v2_https_browser.diagnose_market_proxy',return_value={'status':'PASS','code':'MARKET_PROXY_DIAGNOSTIC_COMPLETE','probes':[]}),redirect_stdout(out):
                self.assertEqual(launcher.main(),0)
            tunnel.assert_not_called();self.assertEqual(password.call_count,1);gateway.verify.assert_called_once()
            result=json.loads(out.getvalue());self.assertEqual(result['scope'],'TEST_GAS_PUBLIC_PROXY_ONLY')
            self.assertEqual(result['actualNhCalls'],0);self.assertFalse(result['accountStoreWrites'])
            self.assertNotIn(SECRET,out.getvalue());self.assertNotIn(str(env),out.getvalue())

    def test_valid_quote_and_rss_return_shape_and_counts_only(self):
        q=market_payload_summary(QUOTE);rss=market_payload_summary(RSS)
        self.assertTrue(q['valid']);self.assertTrue(q['priceFieldPresent'])
        self.assertEqual(rss,{'format':'RSS','items':1,'valid':True})
        self.assertNotIn(SECRET,json.dumps([q,rss]));self.assertNotIn('1,234.50',json.dumps(q))

    def test_gas_error_envelope_is_identified_without_arbitrary_message_or_fields(self):
        data={'success':False,'code':'GAS_REJECTED','message':SECRET,SECRET:'private'}
        s=market_payload_summary(json.dumps(data))
        self.assertFalse(s['valid']);self.assertTrue(s['rejected']);self.assertEqual(s['knownCode'],'GAS_REJECTED')
        self.assertNotIn(SECRET,json.dumps(s))
        s=market_payload_summary(json.dumps({'error':'허용되지 않은 주소입니다.'}))
        self.assertEqual(s['knownCode'],'GAS_PUBLIC_HOST_DENIED')

    def test_rejected_payload_does_not_become_valid_because_it_contains_a_price(self):
        s=market_payload_summary('{"success":false,"datas":[{"closePrice":100}]}')
        self.assertFalse(s['valid'])

    def test_wrapped_json_and_html_are_not_silently_unwrapped_as_market_success(self):
        for body,kind in [(json.dumps(QUOTE),'JSON_STRING'),('<!doctype html>'+SECRET,'HTML_OR_DTD'),
                          ('<broken>'+SECRET,'OTHER'),('false','JSON_SCALAR')]:
            s=market_payload_summary(body);self.assertEqual(s['format'],kind);self.assertFalse(s['valid'])
            self.assertNotIn(SECRET,json.dumps(s))
        self.assertEqual(market_payload_summary(json.dumps(QUOTE))['wrappedFormat'],'JSON_OBJECT')

    def test_diagnostic_direct_request_uses_no_credentials_and_never_follows_redirects(self):
        response=Mock();response.status=200;response.read.return_value=QUOTE.encode()
        response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
        opener=Mock();opener.open.return_value=response
        with patch('nh_v2_https_browser.urllib.request.build_opener',return_value=opener) as build:
            result=direct_market_summary(INDEX)
        self.assertTrue(result['valid']);self.assertIsInstance(build.call_args.args[0],NoRedirect)
        req=opener.open.call_args.args[0]
        self.assertIsNone(req.data);self.assertIsNone(req.get_header('Authorization'))
        self.assertEqual(req.full_url,INDEX);self.assertNotIn(SECRET,str(req.header_items()))
        with patch('nh_v2_https_browser.urllib.request.build_opener') as network:
            self.assertFalse(direct_market_summary('https://private.invalid/accounts')['valid']);network.assert_not_called()

    def test_two_fixed_reads_compare_same_urls_and_always_revoke_test_session(self):
        gateway=Mock();gateway.post.return_value={'success':True,'token':TOKEN};gateway.public.side_effect=[QUOTE,RSS]
        out=io.StringIO()
        with patch('nh_v2_https_browser.direct_market_summary',return_value={'valid':True}) as direct,redirect_stdout(out):
            result=diagnose_market_proxy(gateway,SECRET,SECRET)
        self.assertEqual(result['status'],'PASS');self.assertEqual(len(result['probes']),2)
        self.assertEqual([c.args[0] for c in gateway.public.call_args_list],[c.args[0] for c in direct.call_args_list])
        gateway.post.assert_any_call({'action':'logout','token':TOKEN})
        self.assertNotIn(SECRET,json.dumps(result)+out.getvalue());self.assertNotIn(TOKEN,json.dumps(result)+out.getvalue())
        self.assertEqual(gateway.public.call_count,2)  # No retries or browser replay.

    def test_gas_failure_with_direct_success_is_preserved_and_cleanup_is_not_skipped(self):
        gateway=Mock();gateway.post.return_value={'success':True,'token':TOKEN}
        gateway.public.side_effect=[RelayFault('RELAY_UPSTREAM_HTTP'),'{"success":false,"code":"GAS_REJECTED"}']
        with patch('nh_v2_https_browser.direct_market_summary',return_value={'valid':True}),redirect_stdout(io.StringIO()):
            result=diagnose_market_proxy(gateway,SECRET,SECRET)
        self.assertEqual(result['status'],'FAIL')
        self.assertEqual(result['probes'][0]['gasProxy']['knownCode'],'RELAY_UPSTREAM_HTTP')
        self.assertEqual(result['probes'][1]['gasProxy']['knownCode'],'GAS_REJECTED')
        self.assertTrue(result['probes'][0]['directPublic']['valid'])
        gateway.post.assert_any_call({'action':'logout','token':TOKEN})

    def test_required_password_change_stops_public_reads_and_revokes_new_session(self):
        gateway=Mock();gateway.post.return_value={'success':True,'token':TOKEN,'mustChangePassword':True}
        result=diagnose_market_proxy(gateway,SECRET,SECRET)
        self.assertEqual(result['status'],'FAIL');gateway.public.assert_not_called()
        gateway.post.assert_any_call({'action':'logout','token':TOKEN})
