"""In-memory owner provisioning simulation. No live accounts, keys or originals."""
import base64,copy,hashlib,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
from email.parser import BytesParser
from email.policy import default
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import deploy_private_news_reader as m

class State:
    def __init__(self,fault=None):
        self.fault=fault;self.calls=[];self.settings=None;self.primary_version='1'*8+'-'+'1'*4+'-'+'1'*4+'-'+'1'*4+'-'+'1'*12
        self.private_version='2'*8+'-'+'2'*4+'-'+'2'*4+'-'+'2'*4+'-'+'2'*12
        self.folder='syntheticApprovedFolder000001';self.original='SYNTHETIC ORIGINAL\r\n<Cite refs={[]}/>\n'
        self.key_id='a'*40;self.pem='-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----\n'
        self.plan={'scriptId':'syntheticScript0000000001','url':'https://script.google.com/macros/s/SYNTHETIC_ISOLATED/exec','sheetHash':'b'*64,'sourceDigest':'c'*64,'revision':'d'*40}
        self.meta={'success':True,'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':'a'*64,'sheetHash':'b'*64,'sourceDigest':'c'*64,'revision':'d'*40,'gatewayVersion':2,'storeEngine':'account-store-v2','storeVersion':2}
    def api(self,method,path,body=None,mime=None):
        self.calls.append((method,path))
        if '/scripts/'+m.preflight.PREVIEW not in path:raise AssertionError('Original Worker access outside mocked read helpers')
        if path.endswith('/settings'):
            if self.settings is None:
                if self.fault=='already-exists':return {}
                raise m.worker.Stop('CLOUDFLARE_REQUEST_REJECTED',http=404)
            return self.settings
        if method=='PUT':
            if self.fault=='cf-permission':raise m.worker.Stop('CLOUDFLARE_REQUEST_REJECTED',http=403)
            if self.fault=='cf-bad-module':raise m.worker.Stop('CLOUDFLARE_REQUEST_REJECTED',http=400,stage='PRIVATE_WORKER_UPLOAD',provider_codes=[10021],hints=['MULTIPART'])
            parts=list(BytesParser(policy=default).parsebytes(('Content-Type: '+mime+'\r\n\r\n').encode()+body).iter_parts())
            config=json.loads(parts[0].get_payload(decode=True));self.settings={'bindings':copy.deepcopy(config['bindings']),'observability':{'enabled':False}}
            self.config=config
            for row in self.settings['bindings']:
                if row['type']=='secret_text':row.pop('text',None)
            assert config['migrations']['new_sqlite_classes']==['RelayGate']
            assert len(parts)==3
            assert all(part.get_content_type()=='application/javascript+module' for part in parts[1:])
            assert b"import policy from './policy.json'" not in parts[1].get_payload(decode=True)
            return {}
        if path.endswith('/subdomain') and method=='POST':return {}
        raise AssertionError('Unexpected mutation')
    def google(self,method,url,body=None):
        self.calls.append((method,url))
        if method=='DELETE':return {}
        value={'type':'service_account','project_id':m.preflight.PROJECT,'client_email':m.preflight.READER,'private_key_id':self.key_id,'private_key':self.pem}
        return {'privateKeyData':base64.b64encode(json.dumps(value).encode()).decode()}
    def web(self,url):
        state=self
        class Web:
            token=None;binding=None
            def call(self,action,**kwargs):
                state.calls.append(('GAS',action))
                if action=='appVersion':return state.meta
                if action=='login':return {'success':True,'isAdmin':True,'mustChangePassword':False,'token':'e'*64}
                if action=='logout':return {'success':True}
                raise AssertionError('Only original GAS authentication allowed')
        return Web()
    def post(self,action,token=None,**values):
        self.calls.append(('HTTP',action))
        if action=='appVersion':return 200,{**self.meta,'developmentPrivateBriefingAuthority':'gas-login-owner-v1'}
        if action=='login':return 200,{'success':True,'token':'e'*64}
        if action=='logout':self.logged_out=True;return 200,{'success':True}
        if not token:return 401,{'success':False,'code':'AUTH_REQUIRED'}
        if self.fault=='read-failed':return 200,{'success':False,'code':'PRIVATE_BRIEFING_NOT_FOUND'}
        if getattr(self,'logged_out',False):return 200,{'success':False,'code':'PRIVATE_BRIEFING_FORBIDDEN'}
        return 200,{'success':True,'cacheable':False,'report':{'date':'2026-11-27','content':self.original,'contentSha256':hashlib.sha256(self.original.encode()).hexdigest()}}
    def execute(self):
        base='/accounts/'+'a'*32+'/workers/scripts/'+m.preflight.PREVIEW
        def active(api,path):return {'id':'synthetic-deployment','version':self.private_version if path==base else self.primary_version}
        with patch.object(m.preflight,'google_snapshot',return_value={'existingUserManagedKeyCount':0}),patch.object(m,'folder_id',return_value=self.folder),patch.object(m,'private_path',return_value=Path('/synthetic-owner')),patch.object(Path,'read_text',return_value=json.dumps(self.plan)),patch.object(m,'cloud_api',return_value=(self.api,base)),patch.object(m.owner,'inspect',return_value={'ownerCheckoutVerified':True,'ownerCheckoutInspection':{'sourceRevisionMatches':True},'latestVersionIsActive':False}),patch.object(m.owner,'public_probe',return_value=self.meta),patch.object(m.gas,'check_metadata'),patch.object(m.worker,'active',side_effect=active),patch.object(m.worker,'recent_versions',return_value=[{'id':'pending-existing'}]),patch.object(m,'access_token',return_value='SYNTHETIC_TOKEN'),patch.object(m,'google_api',return_value=(self.google,'https://iam.googleapis.com/synthetic/keys')),patch.object(m,'WebApp',side_effect=self.web),patch.object(m,'post',side_effect=self.post),patch.object(m.subprocess,'check_output',return_value='f'*40):
            return m.deploy(Path('/synthetic-owner'),'a'*32,'SYNTHETIC_TOKEN','fixture-owner','SYNTHETIC_PASSWORD',self.folder)

class DeploymentTests(unittest.TestCase):
    def test_success_only_creates_private_worker_and_transfers_one_memory_key(self):
        state=State();report=state.execute()
        self.assertEqual(report['status'],'PASS');self.assertFalse(report['keyFileWritten'])
        self.assertTrue(report['primaryPendingVersionPreserved']);self.assertEqual(report['primaryWorkerWrites'],0)
        self.assertEqual(report['browserOriginalDisplay'],'NOT_RUN');self.assertEqual(report['nextScheduledSave'],'NOT_RUN')
        self.assertNotIn(state.original,json.dumps(report));self.assertNotIn(state.pem,json.dumps(report))
        writes=[path for method,path in state.calls if method in ('PUT','POST','DELETE')]
        self.assertEqual(len(writes),3);self.assertTrue(all(m.preflight.PREVIEW in path or path.startswith('https://iam.googleapis.com/') for path in writes))
        secret={r['name']:r for r in state.config['bindings'] if r['type']=='secret_text'}
        self.assertEqual(secret['MYINVEST_NEWS_READER_PEM']['text'],state.pem)
        self.assertEqual(secret['MYINVEST_NEWS_FOLDER_ID']['text'],state.folder)
    def test_existing_private_worker_stops_before_any_key_creation(self):
        state=State('already-exists')
        with self.assertRaisesRegex(m.Stop,'EXISTING_PRIVATE_WORKER_REVIEW_REQUIRED'):state.execute()
        self.assertFalse(any(method in ('POST','PUT','DELETE') for method,_ in state.calls))
    def test_permission_and_live_read_failures_revoke_only_the_new_key(self):
        for fault in ['cf-permission','cf-bad-module','read-failed']:
            with self.subTest(fault=fault):
                state=State(fault);report=state.execute()
                self.assertEqual(report['status'],'PARTIAL');self.assertEqual(report['keyRecovery'],'CREATED_KEY_REVOKED')
                self.assertEqual([path for method,path in state.calls if method=='DELETE'],['https://iam.googleapis.com/synthetic/keys/'+state.key_id])
                self.assertEqual(report['primaryWorkerWrites'],0);self.assertEqual(report['gasSourceWrites'],0)
                if fault=='cf-bad-module':
                    self.assertEqual(report['providerCodes'],[10021]);self.assertEqual(report['providerHints'],['MULTIPART'])
                    self.assertEqual(report['requestStage'],'PRIVATE_WORKER_UPLOAD')
    def test_exact_api_module_package_compiles_without_json_modules_or_network(self):
        modules=m.worker_modules()
        self.assertEqual(set(modules),{'worker.mjs','drive-archive.mjs'})
        self.assertNotIn(b"import policy from './policy.json'",modules['worker.mjs'])
        self.assertIn(b'const policy=',modules['worker.mjs'])
        m.validate_package(modules)
    def test_failed_package_check_does_not_create_a_key_or_upload_worker(self):
        state=State()
        with patch.object(m,'validate_package',side_effect=m.Stop('PRIVATE_PACKAGE_CHECK_FAILED')):
            report=state.execute()
        self.assertEqual(report['keyCreateCalls'],0)
        self.assertFalse(report['privateWorkerUploadAttempted'])
        self.assertFalse(any(method in ('POST','PUT','DELETE') for method,_ in state.calls))
    def test_google_key_identity_and_approved_folder_are_pinned(self):
        with self.assertRaises(m.Stop):m.folder_id('anotherPrivateFolder000001')
        value={'type':'service_account','project_id':'unapproved-project','client_email':m.preflight.READER,'private_key_id':'a'*40,'private_key':'PRIVATE_CANARY'}
        with self.assertRaises(m.Stop) as error:m.key_material({'privateKeyData':base64.b64encode(json.dumps(value).encode()).decode()})
        self.assertNotIn('PRIVATE_CANARY',str(error.exception))
    def test_api_scope_rejects_primary_writes_other_workers_and_key_files(self):
        calls=[]
        with patch.object(m.worker,'api_client',return_value=lambda *args:calls.append(args)):
            api,base=m.cloud_api('a'*32,'SYNTHETIC_TOKEN')
            for method,path in [('PUT',base.replace(m.preflight.PREVIEW,m.worker.NAME)),('DELETE',base),('PUT',base+'/secrets'),('POST',base+'/deployments')]:
                with self.assertRaises(m.Stop):api(method,path)
        self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
