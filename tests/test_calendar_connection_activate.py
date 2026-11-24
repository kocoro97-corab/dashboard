"""Synthetic operator transaction and current-code preservation; no live credentials."""
import copy, importlib.util, json, sys, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import calendar_connection_activate as m


class CalendarConnectionTransactionTest(unittest.TestCase):
    def test_success_is_source_then_configuration_then_worker_then_readback(self):
        calls=[]
        hooks=[lambda name=name:calls.append(name) for name in ['stage','gas','configure','worker','verify','restore-worker','restore-gas']]
        result=m.coordinated(*hooks)
        self.assertEqual(result['status'],'PASS')
        self.assertEqual(calls,['stage','gas','configure','worker','verify'])

    def test_each_failure_restores_only_owned_state_in_worker_before_gas_order(self):
        names=['stage','gas','configure','worker','verify','restore-worker','restore-gas']
        for failure in names[:5]:
            calls=[]
            def hook(name):
                calls.append(name)
                if name==failure:raise m.Stop('SYNTHETIC_FAILURE')
            result=m.coordinated(*(lambda name=name:hook(name) for name in names))
            self.assertEqual(result['status'],'FAIL')
            self.assertEqual(result['recovery'],'PASS_PREVIOUS_CONNECTION_RESTORED')
            self.assertIn('restore-worker',calls)
            if failure!='stage':
                self.assertEqual(calls[-2:],['restore-worker','restore-gas'])
            else:self.assertNotIn('restore-gas',calls)

    def test_unknown_worker_actor_prevents_gas_rollback_and_never_prints_exception(self):
        calls=[]
        def fail():raise RuntimeError('PRIVATE_CANARY')
        def blocked():raise m.Stop('CONCURRENT_WORKER_NO_ROLLBACK')
        result=m.coordinated(lambda:None,lambda:None,fail,lambda:None,lambda:None,blocked,lambda:calls.append('restore-gas'))
        self.assertEqual(result['recovery'],'OWNER_REVIEW_REQUIRED_NO_BLIND_ROLLBACK')
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertEqual(calls,[])


class CalendarConnectionMetadataTest(unittest.TestCase):
    def settings(self):
        return {'compatibility_date':'2026-11-01','compatibility_flags':['existing_flag'],'observability':{'enabled':False},'usage_model':'standard','bindings':[
            {'name':'MYINVEST_ROLE','type':'plain_text','text':m.worker.ROLE},
            {'name':'GATE','type':'durable_object_namespace','class_name':'RelayGate','namespace_id':'synthetic-existing'},
            {'name':'GOOGLE_CALENDAR_CLIENT_ID','type':'plain_text','text':'synthetic-public-client.apps.googleusercontent.com'},
            {'name':'MYINVEST_EXPECTED_METADATA','type':'secret_text'}]}

    def test_unknown_existing_secrets_are_inherited_and_google_values_never_replaced(self):
        before=self.settings()
        bindings=m.union_bindings(before,[{'name':'GOOGLE_CALENDAR_CLIENT_SECRET','type':'secret_text','text':'PRIVATE_CANARY'},{'name':'ANOTHER_SECRET','type':'secret_text','text':'PRIVATE_OTHER'}])
        keys={'bridge':'12'*32,'encryption':'34'*32}
        metadata=m.upload_metadata(before,bindings,{'sourceDigest':'a'*64},keys)
        by_name={v['name']:v for v in metadata['bindings']}
        self.assertEqual(by_name['GOOGLE_CALENDAR_CLIENT_SECRET'],{'name':'GOOGLE_CALENDAR_CLIENT_SECRET','type':'inherit','version_id':'latest'})
        self.assertEqual(by_name['ANOTHER_SECRET']['type'],'inherit')
        self.assertEqual(by_name['GOOGLE_CALENDAR_CLIENT_ID']['type'],'inherit')
        self.assertEqual(metadata['compatibility_flags'],['existing_flag','nodejs_compat'])
        self.assertNotIn('PRIVATE',json.dumps(metadata))
        self.assertEqual(before,self.settings())
        self.assertNotIn('migrations',metadata)

    def test_existing_key_material_requires_review_instead_of_automatic_rotation(self):
        settings=self.settings();bindings=m.union_bindings(settings,[{'name':'CALENDAR_IDENTITY_BRIDGE_KEY','type':'secret_text'}])
        with self.assertRaisesRegex(m.Stop,'EXISTING_KEY'):
            m.upload_metadata(settings,bindings,{}, {'bridge':'12'*32,'encryption':'34'*32})

    def test_settings_comparison_allows_only_authorized_flags_and_config_keys(self):
        before=self.settings();old=m.union_bindings(before,[]);after=copy.deepcopy(before)
        after['compatibility_flags'].append('nodejs_compat')
        new=copy.deepcopy(old)+[{'name':'GOOGLE_CALENDAR_ENCRYPTION_KEY','type':'secret_text'}]
        self.assertTrue(m.settings_preserved(before,after,old,new))
        after['observability']['enabled']=True
        self.assertFalse(m.settings_preserved(before,after,old,new))
        after=copy.deepcopy(before);new[2]['text']='changed-public-client'
        self.assertFalse(m.settings_preserved(before,after,old,new))

    def test_only_current_worker_single_module_is_accepted_and_unrelated_modules_not_dropped(self):
        self.assertEqual(m.current_code({'body':b'current code','contentType':'application/javascript','entrypoint':'worker.mjs'}),b'current code')
        with self.assertRaises(m.Stop):m.current_code({'body':b'code','entrypoint':'other.mjs'})
        content=b'--test\r\nContent-Disposition: form-data; name="secret.txt"; filename="secret.txt"\r\n\r\nPRIVATE_CANARY\r\n--test--\r\n'
        with self.assertRaises(m.Stop):m.current_code({'body':content,'contentType':'multipart/form-data; boundary=test'})

    def test_operator_api_does_not_allow_secret_or_project_creation_endpoints(self):
        calls=[]
        with patch.object(m.worker,'api_client',return_value=lambda *args:calls.append(args)):
            api=m.scoped_api('a'*32,'synthetic-token')
            for method,path in [('POST','/accounts/'+'a'*32+'/workers/scripts/new-project'),('PUT','/accounts/'+'a'*32+'/workers/scripts/'+m.worker.NAME+'/secrets'),('GET','/accounts/'+'a'*32+'/workers/scripts/other/content/v2')]:
                with self.assertRaises(m.Stop):api(method,path)
        self.assertEqual(calls,[])


if __name__=='__main__':unittest.main()
