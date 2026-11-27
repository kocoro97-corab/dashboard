import json,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import inspect_private_news_worker as m

OLD='11111111-1111-1111-1111-111111111111'

class PrivateInspectionTests(unittest.TestCase):
    def content(self):
        raw,kind=m.deploy.upload_body({})
        return {'body':raw,'contentType':kind,'entrypoint':'worker.mjs'}
    def test_exact_uploaded_code_is_verified_without_printing_modules(self):
        content=self.content();self.assertTrue(m.module_matches(content))
        self.assertFalse(m.module_matches({**content,'body':content['body'].replace(b'const policy=',b'const alteredPolicy=')}))
        self.assertFalse(m.module_matches({'body':b'private-canary','contentType':'text/plain'}))
    def test_absent_combined_observability_is_distinguished_from_script_setting_false(self):
        self.assertEqual(m.observability_state({})['observabilityEnabled'],'ABSENT')
        self.assertEqual(m.observability_state({'observability':{'enabled':False}})['observabilityEnabled'],'FALSE')
        self.assertEqual(m.observability_state({'observability':{'enabled':True}})['observabilityEnabled'],'TRUE')
    def test_only_exact_private_worker_gets_and_sanitized_metadata_are_used(self):
        calls=[]
        gate={'name':'GATE','type':'durable_object_namespace','class_name':'RelayGate','namespace_id':'PRIVATE_NAMESPACE_CANARY'}
        settings={'bindings':[gate,{'name':'MYINVEST_ROLE','type':'plain_text','text':m.deploy.ROLE},{'name':'MYINVEST_NEWS_READER_PEM','type':'secret_text','text':'PRIVATE_KEY_CANARY'}]}
        def api(method,path,*args):
            self.assertEqual(method,'GET');self.assertIn('/'+m.preflight.PREVIEW+'/',path);calls.append(path)
            if path.endswith('/script-settings'):return {'observability':{'enabled':False},'logpush':False}
            if path.endswith('/settings'):return settings
            if path.endswith('/deployments'):return {'deployments':[{'id':'private-deployment','versions':[{'version_id':OLD,'percentage':100}]}]}
            if path.endswith('/versions'):return {'items':[{'id':OLD,'number':1}]}
            if path.endswith('/versions/'+OLD):return {'resources':{'bindings':[gate]}}
            if path.endswith('/content/v2'):return self.content()
            self.fail('Unexpected read')
        with patch.object(m.worker,'api_client',return_value=api):report=m.inspect('a'*32,'PRIVATE_API_TOKEN')
        self.assertTrue(report['uploadedPublicModulesMatch']);self.assertTrue(report['gateClassMatches'])
        self.assertEqual(report['combinedSettings']['observabilityEnabled'],'ABSENT')
        self.assertEqual(report['scriptSettings']['observabilityEnabled'],'FALSE')
        self.assertEqual(report['keyCreateCalls'],0);self.assertEqual(report['settingsWriteCalls'],0)
        self.assertNotIn('PRIVATE_',json.dumps(report));self.assertEqual(len(calls),7)

if __name__=='__main__':unittest.main()
