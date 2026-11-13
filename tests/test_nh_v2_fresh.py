import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import nh_v2_fresh as fresh
import nh_v2_live_check as live
from nh_staging_test import ApiFailure

SCRIPT='SYNTHETIC_FRESH_SCRIPT_123456789'
SHEET='SYNTHETIC_FRESH_SHEET_123456789'
REV='a'*40

class NewClient:
    def __init__(self):self.head=None;self.versions={};self.deps=[];self.calls=[]
    def __call__(self,args,folder,script):
        self.calls.append(args)
        if args[0]=='create':
            assert script is None
            (folder/'.clasp.json').write_text(json.dumps({'scriptId':SCRIPT}))
            (folder/'appsscript.json').write_text('{}')
            return json.dumps({'scriptId':SCRIPT})
        assert script==SCRIPT
        assert json.loads((folder/'.clasp.json').read_text())=={'scriptId':SCRIPT,'rootDir':'.'}
        if args[0]=='push':self.head=fresh.logical(folder);return '{}'
        if args[0]=='pull':
            data=self.versions[int(args[2])] if len(args)>1 else self.head
            for name,text in data.items():(folder/(name+('.json' if name=='appsscript' else '.js'))).write_text(text)
            return '{}'
        if args[0]=='list-deployments':return json.dumps(self.deps)
        if args[0]=='create-version':self.versions[1]=copy.deepcopy(self.head);return '{"versionNumber":1}'
        if args[0]=='create-deployment':
            self.deps=[{'deploymentId':'SYNTHETIC_FRESH_DEPLOYMENT','versionNumber':1}];return json.dumps(self.deps[0])
        raise AssertionError('unexpected command')

def metadata():return {'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':fresh.fingerprint(SCRIPT),'sheetHash':fresh.fingerprint(SHEET),'sourceDigest':fresh.source_digest(),'revision':REV,'storeVersion':2,'storeEngine':'account-store-v2','nhTestCredentialsDeclared':True}

class FreshTests(unittest.TestCase):
    def setUp(self):
        for module,name,value in [(fresh,'has_git_parent',False),(fresh,'revision',REV),(live,'revision',REV)]:
            p=patch.object(module,name,return_value=value);p.start();self.addCleanup(p.stop)
    def test_new_project_creation_backups_source_and_pushes_only_new_identity(self):
        with tempfile.TemporaryDirectory() as t:
            c=NewClient();result=fresh.create(Path(t)/'private',c)
            self.assertEqual(result['phase'],'OWNER_PRIVATE_SETUP_REQUIRED');self.assertFalse(result['nhRequested'])
            self.assertTrue((Path(t)/'private/initial-source.zip').exists())
            self.assertEqual(c.calls[0][:3],['create','--type','standalone'])
            self.assertNotIn('update-deployment',[x[0] for x in c.calls])
    def test_publish_checks_immutable_source_and_new_metadata_before_auth_phase(self):
        with tempfile.TemporaryDirectory() as t:
            c=NewClient();folder=Path(t)/'private';fresh.create(folder,c)
            result=fresh.publish(folder,c,lambda url:metadata());self.assertEqual(result['phase'],'NH_AUTH_APPROVAL_REQUIRED')
            class Web:
                binding=None
                def call(self,action):
                    assert action=='appVersion';return metadata()
            web=live.preflight(folder,c,Web());self.assertEqual(web.binding,fresh.fingerprint(SHEET))
    def test_readonly_tools_can_inspect_older_deployment_only_when_full_gas_source_matches(self):
        with tempfile.TemporaryDirectory() as t:
            c=NewClient();folder=Path(t)/'private';fresh.create(folder,c);fresh.publish(folder,c,lambda url:metadata())
            class Web:
                binding=None
                def call(self,action):return metadata()
            with patch.object(live,'revision',return_value='c'*40):
                with self.assertRaisesRegex(live.Stop,'FRESH_REVIEWED_PLAN_REQUIRED'):live.preflight(folder,c,Web())
                self.assertIsNotNone(live.preflight(folder,c,Web(),allow_same_source_tools=True))
            with patch.object(live,'source_digest',return_value='d'*64):
                with self.assertRaisesRegex(live.Stop,'FRESH_REVIEWED_PLAN_REQUIRED'):live.preflight(folder,c,Web(),allow_same_source_tools=True)

    def test_private_bundle_tampering_is_rejected_before_metadata_or_authentication(self):
        with tempfile.TemporaryDirectory() as t:
            c=NewClient();folder=Path(t)/'private';fresh.create(folder,c);fresh.publish(folder,c,lambda url:metadata())
            with (folder/'bundle/NhGatewayV2.gs').open('a') as f:f.write('\n// unexpected edit')
            class Web:
                def call(self,action):raise AssertionError('must not authenticate or query')
            with self.assertRaisesRegex(live.Stop,'SOURCE_IDENTITY_FAILED'):live.preflight(folder,c,Web(),allow_same_source_tools=True)

    def test_existing_project_targets_and_deployments_are_refused(self):
        with self.assertRaises(Exception):fresh.target(fresh.OLD_SCRIPT)
        with self.assertRaises(Exception):fresh.target(fresh.PRODUCTION_SCRIPT_ID)
        with tempfile.TemporaryDirectory() as t:
            c=NewClient();folder=Path(t)/'private';fresh.create(folder,c);c.deps=[{'versionNumber':4}]
            with self.assertRaisesRegex(fresh.Stop,'EXISTING_DEPLOYMENT_REFUSED'):fresh.publish(folder,c)
            self.assertNotIn('create-deployment',[a[0] for a in c.calls])
    def test_metadata_wrong_existing_sheet_stops_and_never_authenticates(self):
        with tempfile.TemporaryDirectory() as t:
            c=NewClient();folder=Path(t)/'private';fresh.create(folder,c)
            with self.assertRaisesRegex(fresh.Stop,'FRESH_ENVIRONMENT_NOT_CONFIRMED'):
                fresh.publish(folder,c,lambda url:dict(metadata(),sheetHash=fresh.fingerprint(fresh.OLD_SHEET)))
    def test_clasp_command_boundary_refuses_any_existing_deployment_update(self):
        with tempfile.TemporaryDirectory() as t, patch.object(fresh.subprocess,'run') as subprocess:
            folder=Path(t);(folder/'.clasp.json').write_text(json.dumps({'scriptId':SCRIPT,'rootDir':'.'}))
            for args in [['update-deployment','anything'],['create-deployment','--deploymentId','anything'],['list-deployments',fresh.OLD_SCRIPT]]:
                with self.assertRaises(fresh.Stop):fresh.invoke(args,folder,SCRIPT)
            subprocess.assert_not_called()
    def test_create_selects_existing_directory_not_missing_config_file(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t)
            def command(args,**kwargs):
                selected=Path(args[args.index('--project')+1])
                self.assertEqual(selected,folder)
                self.assertTrue(selected.is_dir())
                self.assertFalse((selected/'.clasp.json').exists())
                return type('R',(),{'returncode':0,'stdout':'{}','stderr':''})()
            with patch.object(fresh.subprocess,'run',side_effect=command):
                fresh.invoke(['create','--type','standalone','--title','synthetic'],folder)

    def test_existing_project_operations_keep_exact_config_file_target(self):
        with tempfile.TemporaryDirectory() as t:
            folder=Path(t);config=folder/'.clasp.json'
            config.write_text(json.dumps({'scriptId':SCRIPT,'rootDir':'.'}))
            def command(args,**kwargs):
                self.assertEqual(Path(args[args.index('--project')+1]),config)
                self.assertTrue(config.is_file())
                return type('R',(),{'returncode':0,'stdout':'{}','stderr':''})()
            with patch.object(fresh.subprocess,'run',side_effect=command):fresh.invoke(['push','--force'],folder,SCRIPT)

    def test_cli_failure_categories_never_echo_private_paths_or_credentials(self):
        for message,expected in [
            ('Invalid --project path: /SYNTHETIC_PRIVATE_CANARY/.clasp.json','CLASP_PROJECT_PATH_INVALID'),
            ('invalid_grant SYNTHETIC_PRIVATE_CANARY','OWNER_GOOGLE_LOGIN_REQUIRED'),
            ('insufficient authentication scopes SYNTHETIC_PRIVATE_CANARY','OWNER_GOOGLE_SCOPE_REQUIRED'),
            ('Apps Script API disabled SYNTHETIC_PRIVATE_CANARY','OWNER_APPS_SCRIPT_API_REQUIRED'),
            ('SYNTHETIC_PRIVATE_CANARY unknown vendor error','OWNER_CLASP_AUTH_OR_COMMAND_FAILED')]:
            self.assertEqual(fresh.clasp_failure_code('',message),expected)
            self.assertIn(expected,fresh.SAFE_OWNER_CODES)

    def test_google_auth_failure_does_not_echo_private_cli_output(self):
        with tempfile.TemporaryDirectory() as t,patch.object(fresh.subprocess,'run',return_value=type('R',(),{'returncode':1,'stdout':'SYNTHETIC_SECRET','stderr':'SYNTHETIC_SECRET'})()):
            with self.assertRaisesRegex(fresh.Stop,'OWNER_CLASP_AUTH_OR_COMMAND_FAILED'):fresh.invoke(['create','--type','standalone','--title','synthetic'],Path(t))

class FakeWeb:
    token=None
    def __init__(self,fail=None):self.accounts=[];self.history=[];self.rev='0';self.calls=[];self.fail=fail
    def call(self,action,**fields):
        self.calls.append(action)
        if action=='login':return {'token':'SYNTHETIC_PRIVATE_TOKEN','isAdmin':True,'mustChangePassword':False,'success':True}
        if action=='logout':return {'success':True}
        if action=='nhSnapshotRead':return {'success':True,'accounts':copy.deepcopy(self.accounts),'history':copy.deepcopy(self.history),'revision':self.rev}
        if action=='nhSnapshotCapture':
            if self.fail=='partial':raise ApiFailure('NH_INCOMPLETE')
            self.accounts=[{'accountKey':'a'*64,'acctType':'01','errors':[],'domestic':{'holdings':[{'code':'000001','name':'SYNTHETIC_PRIVATE_HOLDING','quantity':321,'avgPrice':10,'currentPrice':20,'evalAmount':6420,'profit':3210,'returnRate':100,'currency':'KRW'}]},'overseas':{'holdings':[{'code':'SYNTH','name':'SYNTHETIC_OVERSEAS','currency':'USD','quantity':654,'avgPrice':10,'currentPrice':20,'evalAmount':13080,'profit':6540,'returnRate':100}]}}]
            self.history=[{'snapshotId':'synthetic-before','holdings':[]}];self.rev='1'
            return {'success':True,'accounts':copy.deepcopy(self.accounts),'revision':self.rev,'snapshotId':'synthetic-before'}
        if action=='nhStockQuotes':
            item=fields['items'][0]
            return {'success':True,'prices':{item['market']+':'+item['code']:{'price':999.125,'currency':'KRW' if item['market']=='DOMESTIC' else 'USD'}}}
        if action=='nhSnapshotRestore':self.rev='2';self.accounts=[];return {'success':True,'revision':'2'}
        raise AssertionError('unexpected action')

class LiveRunnerTests(unittest.TestCase):
    def test_live_flow_reports_only_statuses_and_restores_active_baseline(self):
        w=FakeWeb()
        with patch.object(live,'browser_readback') as browser:
            report=live.checks(w,'synthetic','SYNTHETIC_PRIVATE_PASSWORD',True)
        self.assertEqual(report['status'],'PASS');self.assertEqual(w.accounts,[]);browser.assert_called_once_with(w)
        text=json.dumps(report)
        for value in ['321','654','999.125','SYNTHETIC_PRIVATE_HOLDING','SYNTHETIC_PRIVATE_TOKEN','SYNTHETIC_PRIVATE_PASSWORD']:self.assertNotIn(value,text)
        self.assertEqual(report['specialAccounts'],{'ISA':'NOT_RUN','PENSION':'NOT_RUN','IRP':'NOT_RUN'})
    def test_ui_not_run_is_never_counted_as_complete(self):
        report=live.checks(FakeWeb(),'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
        self.assertEqual(report['status'],'NOT_RUN')
    def test_partial_inquiry_stops_and_does_not_attempt_quotes_or_restore(self):
        w=FakeWeb('partial');report=live.checks(w,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
        self.assertEqual(report['status'],'FAIL');self.assertEqual(report['code'],'NH_INCOMPLETE')
        self.assertNotIn('nhStockQuotes',w.calls);self.assertNotIn('nhSnapshotRestore',w.calls);self.assertEqual(w.calls[-1],'logout')
    def test_transport_failure_after_capture_attempt_requires_owner_state_check(self):
        w=FakeWeb();original=w.call
        def call(action,**fields):
            if action=='nhSnapshotCapture':raise ApiFailure('NETWORK_OR_JSON_FAILURE')
            return original(action,**fields)
        w.call=call;report=live.checks(w,'synthetic','SYNTHETIC_PRIVATE_PASSWORD')
        self.assertTrue(report['ownerRecoveryRequired']);self.assertEqual(report['privateHistoryRetained'],'NOT_CONFIRMED')

class QuoteDiagnosticTests(unittest.TestCase):
    def ready(self,currency='USD'):
        w=FakeWeb();w.call('nhSnapshotCapture');w.accounts[0]['overseas']['holdings'][0]['currency']=currency;w.calls=[];return w
    def test_diagnostic_performs_one_quote_and_no_storage_changes(self):
        w=self.ready();before=copy.deepcopy(w.accounts);report=live.diagnose_overseas_quote(w,'synthetic','SYNTHETIC_PASSWORD')
        self.assertEqual(report['status'],'PASS');self.assertTrue(report['storedSnapshotUnchanged']);self.assertEqual(w.accounts,before)
        self.assertEqual(w.calls.count('nhStockQuotes'),1);self.assertEqual(w.calls,['login','nhSnapshotRead','nhStockQuotes','nhSnapshotRead','logout'])
        self.assertTrue(report['emptyBaselineRecoverable']);self.assertFalse(report['storageWrites'])
    def test_currency_mismatch_is_distinguished_from_missing_balance_currency(self):
        for currency,expected in [(None,'BALANCE_CURRENCY_NOT_CONFIRMED'),('KRW','QUOTE_CURRENCY_MISMATCH')]:
            report=live.diagnose_overseas_quote(self.ready(currency),'synthetic','SYNTHETIC_PASSWORD')
            self.assertEqual(report['status'],'FAIL');self.assertEqual(report['code'],expected);self.assertTrue(report['positivePriceConfirmed']);self.assertTrue(report['storedSnapshotUnchanged'])
    def test_vendor_failure_is_reported_only_as_allowlisted_code_and_http(self):
        w=self.ready();original=w.call
        def call(action,**fields):
            if action=='nhStockQuotes':
                w.calls.append(action);return {'success':True,'prices':{},'diagnostics':{'OVERSEAS:SYNTH':{'code':'NH_HTTP','http':503,'message':'SYNTHETIC_PRIVATE_CANARY'}}}
            return original(action,**fields)
        w.call=call;report=live.diagnose_overseas_quote(w,'synthetic','SYNTHETIC_PASSWORD')
        self.assertEqual(report['code'],'PRICE_NOT_CONFIRMED');self.assertEqual(report['quoteDiagnosticCode'],'NH_HTTP');self.assertEqual(report['quoteHttp'],503)
        self.assertNotIn('SYNTHETIC_PRIVATE_CANARY',json.dumps(report));self.assertTrue(report['storedSnapshotUnchanged'])
    def test_diagnostic_reports_neither_symbols_amounts_names_nor_tokens(self):
        report=live.diagnose_overseas_quote(self.ready(),'synthetic','SYNTHETIC_PASSWORD');text=json.dumps(report)
        for value in ['OVERSEAS:SYNTH','999.125','654','SYNTHETIC_PRIVATE_HOLDING','SYNTHETIC_PRIVATE_TOKEN','SYNTHETIC_PASSWORD']:self.assertNotIn(value,text)
    def test_no_stored_symbol_does_not_trigger_any_nh_quote(self):
        w=FakeWeb();report=live.diagnose_overseas_quote(w,'synthetic','SYNTHETIC_PASSWORD')
        self.assertEqual(report['status'],'NOT_RUN');self.assertEqual(report['code'],'NO_ELIGIBLE_OVERSEAS_SYMBOL');self.assertNotIn('nhStockQuotes',w.calls);self.assertTrue(report['storedSnapshotUnchanged'])

class PrivatePromptTests(unittest.TestCase):
    def test_username_is_visible_and_trimmed_while_password_remains_hidden(self):
        import contextlib
        import io
        output=io.StringIO()
        password='SYNTHETIC_PRIVATE_PASSWORD'
        with patch.object(sys,'argv',['nh_v2_live_check.py','--environment','synthetic','--diagnose-overseas-quote']), \
             patch.object(live,'preflight',return_value=object()), \
             patch.object(sys.stdin,'isatty',return_value=True), \
             patch('builtins.input',return_value='  synthetic-user  ') as username_prompt, \
             patch.object(live.getpass,'getpass',return_value=password) as password_prompt, \
             patch.object(live,'diagnose_overseas_quote',return_value={'status':'PASS'}) as diagnose, \
             contextlib.redirect_stdout(output):
            self.assertEqual(live.main(),0)
        username_prompt.assert_called_once_with('Fresh staging user (visible): ')
        password_prompt.assert_called_once_with('Fresh staging password (hidden): ')
        self.assertEqual(diagnose.call_args.args[1:],('synthetic-user',password))
        self.assertNotIn(password,output.getvalue())
        self.assertNotIn('synthetic-user',output.getvalue())

if __name__=='__main__':unittest.main()
