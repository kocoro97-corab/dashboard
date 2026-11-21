import copy,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
from relay.app import RelayApp,RelayFault
from relay.account_scope import FIXTURE
from test_relay import configuration,request,TOKEN

class Gateway:
    def __init__(self):self.calls=[];self.rows=[];self.history=[];self.revision='r0';self.admin=True;self.fail=None
    def verify(self):pass
    def post(self,payload):
        action=payload['action'];self.calls.append(action)
        if action==self.fail:raise RelayFault('RELAY_UPSTREAM_NETWORK')
        if action=='login':return {'success':True,'token':TOKEN,'isAdmin':self.admin}
        if action=='sessionInfo':return {'success':True,'isAdmin':self.admin}
        if action=='externalHoldings':return {'success':True,'storeVersion':2,'revision':self.revision,'holdings':copy.deepcopy(self.rows)}
        if action=='externalHistory':return {'success':True,'history':copy.deepcopy(self.history)}
        if action=='saveExternalHoldings':self.rows=copy.deepcopy(payload['holdings'])
        return {'success':True}

class AccountScopeTests(unittest.TestCase):
    def setUp(self):
        self.gateway=Gateway();self.fixture=json.loads(FIXTURE.read_text())
        self.app=RelayApp(configuration(account_reads=True,external_test_store=True,test_store_user='nh_test_v2'),self.gateway)
        request(self.app,{'action':'login','user':'nh_test_v2','pass':'SYNTHETIC_PRIVATE'})
        self.gateway.calls=[]
    def call(self,payload):return request(self.app,payload,authorization='Bearer '+TOKEN)
    def save(self,**changes):return self.call(dict(action='saveExternalHoldings',holdings=self.fixture,expectedRevision='r0',confirmReplace=True,**changes))
    def test_default_profile_remains_closed_and_permissions_are_separate(self):
        for config in [configuration(),configuration(account_reads=True)]:
            app=RelayApp(config,self.gateway)
            self.assertEqual(request(app,{'action':'saveExternalHoldings'},authorization='Bearer '+TOKEN)['body']['code'],'RELAY_SCOPE_BLOCKED')
        for config in [dict(account_reads=True,auth_only=False),dict(external_test_store=True),dict(account_reads=True,external_test_store=True),dict(account_reads='false'),dict(external_test_store=1)]:
            with self.assertRaises(RelayFault):configuration(**config)
    def test_read_capability_is_exact_and_still_requires_authentication(self):
        for action in ['nhAccounts','externalHoldings','externalHistory']:
            self.assertEqual(request(self.app,{'action':action})['status'],401)
            self.assertEqual(self.call({'action':action})['status'],200)
        for action in ['register','changePassword','approveUser','protectedHoldings','externalDriveImages','nhQuotes','nhStockQuotes','nhSnapshotCapture','order']:
            self.assertIn(self.call({'action':action})['status'],(400,403))
        self.assertEqual(self.call({'action':'nhAccounts','extra':'bad'})['status'],403)
        self.assertEqual(self.call({'action':'nhExternalQuotes','codes':['035720']})['status'],200)
        self.assertEqual(self.call({'action':'nhExternalQuotes','codes':['https://bad.example']})['status'],403)
    def test_metadata_exposes_boolean_capabilities_only(self):
        body=request(self.app)['body'];self.assertIs(body['developmentAccountReads'],True);self.assertIs(body['developmentExternalTestStore'],True);self.assertNotIn('nh_test_v2',json.dumps(body));self.assertNotIn(TOKEN,json.dumps(body))
    def test_save_requires_login_binding_to_existing_test_administrator(self):
        app=RelayApp(configuration(account_reads=True,external_test_store=True,test_store_user='another_test_user'),self.gateway)
        request(app,{'action':'login','user':'nh_test_v2','pass':'SYNTHETIC_PRIVATE'})
        response=request(app,{'action':'saveExternalHoldings','holdings':self.fixture,'expectedRevision':'r0','confirmReplace':True},authorization='Bearer '+TOKEN)
        self.assertEqual(response['body']['code'],'TEST_STORE_USER_REQUIRED');self.assertNotIn('saveExternalHoldings',self.gateway.calls)
        self.gateway.admin=False
        self.assertEqual(self.save()['body']['code'],'AUTH_REQUIRED')
    def test_exact_fixture_can_save_after_state_revision_and_history_checks(self):
        response=self.save();self.assertEqual(response['status'],200);self.assertEqual(self.gateway.rows,self.fixture)
        self.assertEqual(self.gateway.calls,['sessionInfo','externalHoldings','externalHistory','saveExternalHoldings'])
    def test_real_existing_holdings_and_history_are_never_overwritten(self):
        real={'accountType':'ISA','code':'035720','name':'unapproved fixture','quantity':999,'avgPrice':999,'source':'ocr'}
        for position in ['current','history']:
            self.gateway.rows=[real] if position=='current' else []
            self.gateway.history=[{'snapshotId':'old','holdings':[real]}] if position=='history' else []
            response=self.save();self.assertEqual(response['body']['code'],'TEST_STORE_EXISTING_DATA_PROTECTED');self.assertNotIn('saveExternalHoldings',self.gateway.calls)
    def test_ocr_rows_modified_fixture_extra_fields_and_bool_numbers_are_rejected(self):
        for change in [dict(quantity=70),dict(source='ocr'),dict(quantity=True),dict(unapproved='field')]:
            rows=copy.deepcopy(self.fixture);rows[0].update(change)
            response=self.call({'action':'saveExternalHoldings','holdings':rows,'expectedRevision':'r0','confirmReplace':True})
            self.assertEqual(response['body']['code'],'TEST_STORE_SYNTHETIC_ONLY')
        self.assertNotIn('saveExternalHoldings',self.gateway.calls)
    def test_review_revision_and_restore_target_cannot_be_bypassed(self):
        self.assertEqual(self.call({'action':'saveExternalHoldings','holdings':self.fixture,'expectedRevision':'r0','confirmReplace':False})['body']['code'],'TEST_STORE_REVIEW_REQUIRED')
        self.gateway.revision='r1';self.assertEqual(self.save()['body']['code'],'STORE_CONFLICT')
        self.gateway.revision='r0';payload={'action':'restoreExternalHoldings','snapshotId':'unknown','expectedRevision':'r0','confirmReplace':True}
        self.assertEqual(self.call(payload)['body']['code'],'STORE_NOT_FOUND')
        self.gateway.history=[{'snapshotId':'unknown','holdings':self.fixture}]
        self.assertEqual(self.call(payload)['status'],200)
    def test_logout_drops_local_write_binding(self):
        self.call({'action':'logout'});self.assertEqual(self.save()['body']['code'],'TEST_STORE_USER_REQUIRED')
    def test_precheck_failure_is_not_misreported_as_an_attempted_write(self):
        self.gateway.fail='externalHoldings';response=self.save();self.assertEqual(response['body']['code'],'RELAY_UPSTREAM_NETWORK');self.assertEqual(self.app.metrics['upstreamAttempts'].get('saveExternalHoldings',0),0)
    def test_actual_mutation_failure_stays_uncertain_and_is_never_retried(self):
        self.gateway.fail='saveExternalHoldings';response=self.save();self.assertEqual(response['body']['code'],'RELAY_WRITE_OUTCOME_UNKNOWN');self.assertEqual(self.gateway.calls.count('saveExternalHoldings'),1)
    def test_account_capability_never_bypasses_https_origin_code_or_session(self):
        from relay.public_dev import PublicDevelopment
        origin='https://kocoro97-corab.github.io';host='synthetic-account.trycloudflare.com';code='SYNTHETIC_PRIVATE_DEV_CODE'
        app=PublicDevelopment(RelayApp(configuration(origins=frozenset({origin}),account_reads=True),self.gateway),origin+'/dashboard-v2-dev/',code);app.host=host
        env=dict(REMOTE_ADDR='127.0.0.1',HTTP_HOST=host,HTTP_X_FORWARDED_PROTO='https',HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev',HTTP_X_MYINVEST_DEV_KEY=code)
        for change in [dict(HTTP_X_MYINVEST_DEV_KEY='wrong'),dict(HTTP_X_FORWARDED_PROTO='http'),dict(REMOTE_ADDR='198.51.100.1')]:
            response=request(app,{'action':'nhAccounts'},origin=origin,authorization='Bearer '+TOKEN,**(env|change));self.assertEqual(response['status'],403)
        self.assertEqual(request(app,{'action':'nhAccounts'},origin=origin,**env)['status'],401)
        response=request(app,{'action':'nhAccounts'},origin='https://other.example',authorization='Bearer '+TOKEN,**env);self.assertNotIn('Access-Control-Allow-Origin',response['headers'])
        self.assertEqual(self.gateway.calls,[])

class ReviewedAccountStoreTests(unittest.TestCase):
    def setUp(self):
        self.gateway=Gateway();self.app=RelayApp(configuration(account_reads=True,external_store=True),self.gateway)
        self.rows=[{'accountType':'ISA','code':'035720','name':'Synthetic OCR module test','quantity':70,'avgPrice':43841,'source':'ocr'}]
    def call(self,payload,authenticated=True):return request(self.app,payload,authorization='Bearer '+TOKEN if authenticated else None)
    def test_catalog_actions_are_authenticated_reviewed_and_excluded_from_fixture_only_mode(self):
        payload={'action':'saveExternalAccounts','accounts':[],'brokers':[],'expectedRevision':'catalog0','confirmReplace':True}
        self.assertEqual(self.call({'action':'externalAccounts'},False)['status'],401)
        self.assertEqual(self.call({'action':'externalAccounts'})['status'],200)
        self.assertEqual(self.call(payload,False)['status'],401)
        self.assertEqual(self.call(payload|{'confirmReplace':False})['status'],403)
        self.assertEqual(self.call(payload|{'userId':'another'})['status'],403)
        self.assertEqual(self.call(payload)['status'],200)
        restricted=RelayApp(configuration(account_reads=True,external_test_store=True,test_store_user='nh_test_v2'),self.gateway)
        self.assertEqual(request(restricted,payload,authorization='Bearer '+TOKEN)['body']['code'],'RELAY_SCOPE_BLOCKED')
        self.gateway.calls=[];self.gateway.fail='saveExternalAccounts'
        self.assertEqual(self.call(payload)['body']['code'],'RELAY_WRITE_OUTCOME_UNKNOWN')
        self.assertEqual(self.gateway.calls,['saveExternalAccounts'])

    def test_reviewed_ocr_rows_use_existing_handler_without_fixed_fixture_restriction(self):
        body={'action':'saveExternalHoldings','holdings':self.rows,'expectedRevision':'r0','confirmReplace':True}
        self.assertEqual(self.call(body,False)['status'],401);self.assertEqual(self.gateway.calls,[])
        self.assertEqual(self.call(body)['status'],200);self.assertEqual(self.gateway.rows,self.rows)
        self.assertEqual(self.gateway.calls,['saveExternalHoldings'])
        self.assertEqual(self.call({'action':'restoreExternalHoldings','snapshotId':'original-user-version','expectedRevision':'r0','confirmReplace':True})['status'],200)
    def test_review_and_revision_are_mandatory_and_caller_cannot_select_another_user(self):
        body={'action':'saveExternalHoldings','holdings':self.rows,'expectedRevision':'r0','confirmReplace':True}
        for change in [{'confirmReplace':False},{'expectedRevision':''},{'userId':'other'}]:self.assertEqual(self.call(body|change)['status'],403)
        self.assertEqual(self.gateway.calls,[])
    def test_profile_never_enables_registration_admin_orders_or_other_gas_targets(self):
        for action in ['register','changePassword','approveUser','externalDriveImages','nhSnapshotCapture','order']:self.assertIn(self.call({'action':action})['status'],(400,403))
        self.assertEqual(self.call({'action':'nhAccounts','backendUrl':'https://other.example'})['status'],400)
        self.assertEqual(self.gateway.calls,[])
    def test_store_profiles_are_explicit_and_mutually_exclusive(self):
        for change in [{'external_store':True},{'account_reads':True,'external_store':True,'auth_only':False},{'account_reads':True,'external_store':True,'external_test_store':True,'test_store_user':'nh_test_v2'},{'external_store':'true'}]:
            with self.assertRaises(RelayFault):configuration(**change)
        self.assertIs(request(self.app)['body']['developmentExternalStore'],True)
    def test_network_loss_after_reviewed_write_is_not_retried(self):
        self.gateway.fail='saveExternalHoldings';response=self.call({'action':'saveExternalHoldings','holdings':self.rows,'expectedRevision':'r0','confirmReplace':True})
        self.assertEqual(response['body']['code'],'RELAY_WRITE_OUTCOME_UNKNOWN');self.assertEqual(self.gateway.calls,['saveExternalHoldings'])
    def test_reviewed_store_supports_existing_150_row_limit_with_bounded_https_body(self):
        from relay.public_dev import PublicDevelopment
        origin='https://kocoro97-corab.github.io';host='synthetic-reviewed.trycloudflare.com';access='SYNTHETIC_PRIVATE_DEV_CODE'
        app=PublicDevelopment(RelayApp(configuration(origins=frozenset({origin}),account_reads=True,external_store=True),self.gateway),origin+'/dashboard-v2-dev/',access);app.host=host
        env=dict(REMOTE_ADDR='127.0.0.1',HTTP_HOST=host,HTTP_X_FORWARDED_PROTO='https',HTTP_X_MYINVEST_DEV_CLIENT='dashboard-v2-dev',HTTP_X_MYINVEST_DEV_KEY=access)
        rows=[dict(self.rows[0],code=str(i).zfill(6),name='합성검증전용'*5) for i in range(150)]
        payload={'action':'saveExternalHoldings','holdings':rows,'expectedRevision':'r0','confirmReplace':True}
        self.assertGreater(len(json.dumps(payload).encode()),8192);self.assertLess(len(json.dumps(payload).encode()),65536)
        self.assertEqual(request(app,payload,origin=origin,authorization='Bearer '+TOKEN,**env)['status'],200)
        self.assertEqual(request(app,payload,origin=origin,authorization='Bearer '+TOKEN,CONTENT_LENGTH='65537',**env)['status'],413)

if __name__=='__main__':unittest.main()
