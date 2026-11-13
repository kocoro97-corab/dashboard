import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from test_nh_v2_fresh import FakeWeb

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import nh_v2_live_check as live
import nh_v2_browser_check as browser
from nh_v2_fresh import PRODUCTION_DEPLOYMENT_ID

TARGET='https://script.google.com/macros/s/SYNTHETIC_FRESH_DEPLOYMENT/exec'
ORIGIN='http://127.0.0.1:9999'

class RepeatWeb(FakeWeb):
    def __init__(self):
        super().__init__();super().call('nhSnapshotCapture');saved=copy.deepcopy(self.accounts);self.accounts=[];self.rev='v2:old-restore';self.calls=[]
        self.history=[{'snapshotId':'old-restore','reason':'restore','holdings':saved},{'snapshotId':'old-capture','reason':'nh-read-snapshot','holdings':[]}]
    def call(self,action,**fields):
        if action=='nhSnapshotCapture':
            old=copy.deepcopy(self.history);result=super().call(action,**fields);self.rev='v2:new-capture';self.history=[{'snapshotId':'new-capture','reason':'nh-read-snapshot','holdings':[]}]+old
            return dict(result,revision=self.rev,snapshotId='new-capture')
        if action=='nhSnapshotRestore':
            self.calls.append(action);assert fields=={'snapshotId':'new-capture','expectedRevision':'v2:new-capture','confirmReplace':True}
            self.history.insert(0,{'snapshotId':'new-restore','reason':'restore','holdings':copy.deepcopy(self.accounts)});self.accounts=[];self.rev='v2:new-restore'
            return {'success':True,'revision':self.rev}
        return super().call(action,**fields)

class RepeatTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)
        guard=patch('nh_v2_fresh.has_git_parent',return_value=False);guard.start();self.addCleanup(guard.stop)
    def test_full_latest_flow_retains_all_prior_history_and_real_capture_history(self):
        web=RepeatWeb();prior=copy.deepcopy(web.history)
        with patch.object(live,'browser_readback') as display:r=live.checks(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True,self.path)
        self.assertEqual(r['status'],'PASS');display.assert_called_once();self.assertEqual(web.accounts,[])
        self.assertTrue(all(h in web.history for h in prior));self.assertEqual(len(web.history),4)
        self.assertTrue(list(self.path.glob('baseline-backup-*/snapshot-before.json')))
        self.assertEqual(web.calls.count('nhSnapshotCapture'),1);self.assertEqual(web.calls.count('nhSnapshotRestore'),1)
    def test_without_explicit_repeat_mode_history_is_still_rejected(self):
        web=RepeatWeb();r=live.checks(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True)
        self.assertEqual(r['code'],'NEW_EMPTY_SNAPSHOT_REQUIRED');self.assertNotIn('nhSnapshotCapture',web.calls)
    def test_nonempty_or_unverified_baselines_never_capture(self):
        for mutation in [lambda w:setattr(w,'accounts',[{'synthetic':'keep'}]),lambda w:w.history[0].update(reason='unknown'),lambda w:setattr(w,'rev','other')]:
            web=RepeatWeb();mutation(web);r=live.checks(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True,self.path)
            self.assertEqual(r['status'],'FAIL');self.assertNotIn('nhSnapshotCapture',web.calls)
    def test_history_window_guard_prevents_hiding_original_recovery(self):
        web=RepeatWeb();web.history*=2;r=live.checks(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True,self.path)
        self.assertEqual(r['code'],'HISTORY_PRESERVATION_LIMIT');self.assertNotIn('nhSnapshotCapture',web.calls)
    def test_failed_backup_prevents_new_capture(self):
        web=RepeatWeb()
        with patch('nh_v2_restore.backup_snapshot',side_effect=OSError('SYNTHETIC_PRIVATE_CANARY')):r=live.checks(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True,self.path)
        self.assertEqual(r['status'],'FAIL');self.assertNotIn('nhSnapshotCapture',web.calls);self.assertNotIn('SYNTHETIC_PRIVATE_CANARY',json.dumps(r))
    def test_missing_currency_stops_before_quote_and_keeps_current_snapshot_for_review(self):
        web=RepeatWeb();original=web.call
        def call(action,**fields):
            result=original(action,**fields)
            if action=='nhSnapshotCapture':web.accounts[0]['overseas']['holdings'][0]['currency']=None;result['accounts']=copy.deepcopy(web.accounts)
            return result
        web.call=call;r=live.checks(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True,self.path)
        self.assertEqual(r['code'],'NATIVE_IDENTITY_OR_CURRENCY_UNCONFIRMED');self.assertTrue(r['ownerRecoveryRequired']);self.assertNotIn('nhStockQuotes',web.calls);self.assertNotIn('nhSnapshotRestore',web.calls)

class BoundaryTests(unittest.TestCase):
    def decision(self,url,method='POST',body=None,root=TARGET,root_method='POST'):
        return browser.request_decision(url,method,json.dumps(body or {'action':'nhAccounts'}),root,root_method,TARGET,ORIGIN)
    def test_exact_fresh_native_actions_and_google_redirect_only(self):
        for action in browser.ACTIONS:self.assertEqual(self.decision(TARGET,body={'action':action}),'ALLOW')
        self.assertEqual(self.decision('https://script.googleusercontent.com/macros/echo?opaque=synthetic',method='GET'),'ALLOW')
    def test_production_and_other_google_targets_are_blocked_before_network(self):
        for url in ['https://script.google.com/macros/s/'+PRODUCTION_DEPLOYMENT_ID+'/exec','https://accounts.google.com/login','https://script.google.com/macros/s/OTHER/exec']:
            self.assertEqual(self.decision(url),'VIOLATION')
    def test_unrooted_redirect_and_nonhttps_google_response_are_rejected(self):
        for url,root in [('http://script.googleusercontent.com/macros/echo',TARGET),('https://script.googleusercontent.com/macros/echo','https://unapproved.example/'),('https://script.googleusercontent.com/unapproved',TARGET)]:
            self.assertEqual(self.decision(url,method='GET',root=root),'VIOLATION')
    def test_mutations_orders_and_unknown_actions_never_reach_server(self):
        for action in ('register','changePassword','saveExternalHoldings','nhSnapshotCapture','nhSnapshotRestore','order','approveUser'):
            self.assertEqual(self.decision(TARGET,body={'action':action}),'VIOLATION')
    def test_private_files_and_thirdparty_requests_are_blocked(self):
        for url in (ORIGIN+'/.git/config',ORIGIN+'/tools/nh_v2_restore.py',ORIGIN+'/js/../private.json','https://external.example/collect'):
            self.assertEqual(self.decision(url,method='GET'),'BLOCK')
        self.assertEqual(self.decision(ORIGIN+'/js/auth.js',method='GET'),'ALLOW')

class RepresentativeTests(unittest.TestCase):
    def test_three_public_groups_are_reported_without_prices_and_no_storage_changes(self):
        w=FakeWeb();original=w.call
        def call(action,**fields):
            if action=='nhStockQuotes':
                w.calls.append(action)
                return {'prices':{'OVERSEAS:'+item['code']:{'price':123.456,'currency':'USD','identity':{'verified':True}} for item in fields['items']}}
            return original(action,**fields)
        w.call=call;r=live.representative_quotes(w,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
        self.assertEqual(r['status'],'PASS');self.assertEqual(len(r['groups']),3);self.assertNotIn('123.456',json.dumps(r));self.assertNotIn('nhSnapshotCapture',w.calls);self.assertFalse(r['storageWrites']);self.assertEqual(r['quoteDelay'],'NOT_RUN')
    def test_absent_price_or_identity_is_not_mislabeled_supported(self):
        w=FakeWeb();r=live.representative_quotes(w,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
        self.assertEqual(r['status'],'FAIL');self.assertEqual(len(r['groups']),3)
        self.assertTrue(any(g['status']=='FAIL' for g in r['groups']))

class DispatchTests(unittest.TestCase):
    def test_repeat_full_flow_requires_explicit_local_write_flag_before_credentials(self):
        import contextlib,io
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--repeat-empty-baseline']),patch.object(live,'preflight',return_value=object()),patch('builtins.input') as credentials,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(live.main(),2)
        credentials.assert_not_called()
    def test_repeating_full_flow_cannot_be_combined_with_readonly_diagnostic(self):
        import contextlib,io
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--repeat-empty-baseline','--diagnose-overseas-quote']),patch.object(live,'preflight') as preflight,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(live.main(),2)
        preflight.assert_not_called()

class CorsEvidenceTests(unittest.TestCase):
    def test_header_evidence_drops_private_values_urls_and_unknown_headers(self):
        result=browser.safe_cors_response(302,{'Content-Type':'text/html;charset=UTF-8','Access-Control-Allow-Origin':'https://SYNTHETIC_PRIVATE_ORIGIN','Location':'https://script.googleusercontent.com/macros/echo?key=SYNTHETIC_PRIVATE_KEY','Authorization':'SYNTHETIC_PRIVATE_TOKEN'},ORIGIN,TARGET)
        self.assertEqual(result['http'],302);self.assertEqual(result['allowOrigin'],'OTHER');self.assertEqual(result['locationRole'],'GOOGLE_CONTENT')
        self.assertNotIn('SYNTHETIC_PRIVATE',json.dumps(result));self.assertNotIn('https:',json.dumps(result))
    def test_allow_origin_categories_are_fixed_and_do_not_claim_missing_headers_pass(self):
        for value,expected in [('*','WILDCARD'),(ORIGIN,'REQUEST_ORIGIN'),('other','OTHER'),('','MISSING')]:
            r=browser.safe_cors_response(200,{'Access-Control-Allow-Origin':value,'Content-Type':'application/json'},ORIGIN,TARGET)
            self.assertEqual(r['allowOrigin'],expected);self.assertEqual(r['contentType'],'JSON')
    def test_console_errors_become_fixed_categories_without_copying_text(self):
        for text,code in [('CORS: preflight redirect SYNTHETIC_PRIVATE_KEY','PREFLIGHT_REDIRECT'),('CORS No Access-Control-Allow-Origin header SYNTHETIC_PRIVATE_KEY','ALLOW_ORIGIN_MISSING'),('CORS preflight rejected','PREFLIGHT_REJECTED'),('CORS credentials rejected','CREDENTIALS_POLICY')]:
            self.assertEqual(browser.cors_error_category(text),code)
        self.assertIsNone(browser.cors_error_category('unrelated SYNTHETIC_PRIVATE_KEY'))
    def test_diagnostic_cli_never_prompts_for_login_or_selects_full_capture(self):
        import contextlib,io
        from types import SimpleNamespace
        web=SimpleNamespace(url=TARGET,binding='f'*64)
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--diagnose-browser-cors']),patch.object(live,'preflight',return_value=web) as preflight,patch.object(browser,'diagnose_browser_cors',return_value={'status':'PASS'}) as diagnostic,patch('builtins.input') as credentials,patch.object(live,'checks') as full,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(live.main(),0)
        preflight.assert_called_once_with(Path('synthetic'),allow_same_source_tools=True);diagnostic.assert_called_once_with(TARGET,'f'*64);credentials.assert_not_called();full.assert_not_called()
    def test_diagnostic_cannot_be_combined_with_repeat_or_write_flow(self):
        import contextlib,io
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--diagnose-browser-cors','--repeat-empty-baseline']),patch.object(live,'preflight') as preflight,contextlib.redirect_stdout(io.StringIO()):self.assertEqual(live.main(),2)
        preflight.assert_not_called()

class NativeOnlyTests(unittest.TestCase):
    def test_native_only_can_continue_quotes_without_capture_restore_or_new_full_run(self):
        import contextlib,io
        from types import SimpleNamespace
        web=SimpleNamespace(url=TARGET,binding='f'*64)
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--native-browser-only','--representative-quotes']),patch.object(live,'preflight',return_value=web) as preflight,patch.object(sys.stdin,'isatty',return_value=True),patch('builtins.input',return_value=' synthetic ') as credentials,patch.object(live.getpass,'getpass',return_value='SYNTHETIC_PRIVATE_PASSWORD'),patch.object(browser,'native_browser_check',return_value={'status':'PASS'}) as native,patch.object(live,'checks') as full,patch.object(live,'representative_quotes',return_value={'status':'PASS'}) as quotes,contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(live.main(),0)
        preflight.assert_called_once_with(Path('synthetic'),allow_same_source_tools=True)
        native.assert_called_once_with(TARGET,'synthetic','SYNTHETIC_PRIVATE_PASSWORD','f'*64);full.assert_not_called();quotes.assert_called_once_with(web,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
        self.assertEqual(credentials.call_count,1);self.assertNotIn('SYNTHETIC_PRIVATE_PASSWORD',output.getvalue())
    def test_native_only_failure_stops_before_representative_queries_and_full_store(self):
        import contextlib,io
        from types import SimpleNamespace
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--native-browser-only','--representative-quotes']),patch.object(live,'preflight',return_value=SimpleNamespace(url=TARGET,binding='f'*64)),patch.object(sys.stdin,'isatty',return_value=True),patch('builtins.input',return_value='synthetic'),patch.object(live.getpass,'getpass',return_value='SYNTHETIC_PRIVATE_PASSWORD'),patch.object(browser,'native_browser_check',return_value={'status':'FAIL'}),patch.object(live,'checks') as full,patch.object(live,'representative_quotes') as quotes,contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(live.main(),2)
        quotes.assert_not_called();full.assert_not_called()
    def test_native_only_cannot_select_repeat_capture(self):
        import contextlib,io
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--native-browser-only','--repeat-empty-baseline']),patch.object(live,'preflight') as preflight,contextlib.redirect_stdout(io.StringIO()):self.assertEqual(live.main(),2)
        preflight.assert_not_called()
