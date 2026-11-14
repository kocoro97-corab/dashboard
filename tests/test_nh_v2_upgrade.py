import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import nh_v2_upgrade as u
import nh_v2_fresh as f

SCRIPT='SYNTHETIC_FRESH_SCRIPT_123456789'
OLD='a'*40
NEW='b'*40
SHEET=f.fingerprint('SYNTHETIC_FRESH_SHEET_123456789')

class Client:
    def __init__(self,source):self.head=copy.deepcopy(source);self.versions={1:copy.deepcopy(source)};self.version=1;self.calls=[];self.corrupt=False
    def __call__(self,args,folder,script):
        assert script==SCRIPT
        assert json.loads((folder/'.clasp.json').read_text())=={'scriptId':SCRIPT,'rootDir':'.'}
        self.calls.append(args)
        if args[0]=='pull':
            data=self.versions[int(args[2])] if len(args)>1 else self.head
            for name,text in data.items():(folder/(name+('.json' if name=='appsscript' else '.gs'))).write_text(text)
        elif args[0]=='push':self.head=f.logical(folder)
        elif args[0]=='create-version':self.versions[2]=copy.deepcopy(self.head);return '{"versionNumber":2}'
        elif args[0]=='list-deployments':return json.dumps([{'deploymentId':'SYNTHETIC_FRESH_DEPLOYMENT','versionNumber':self.version,'description':'synthetic'}])
        elif args[0]=='update-deployment':
            assert args[1]=='SYNTHETIC_FRESH_DEPLOYMENT'
            self.version=int(args[3])
            if self.corrupt and self.version==2:self.head['ConcurrentEdit']='// synthetic unrelated change'
        else:raise AssertionError('unexpected command')
        return '{}'

class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.env=Path(self.temp.name)/'private';self.env.mkdir();bundle=self.env/'bundle';bundle.mkdir()
        (bundle/'.clasp.json').write_text(json.dumps({'scriptId':SCRIPT,'rootDir':'.'}))
        (bundle/'Synthetic.gs').write_text('// baseline')
        (bundle/'appsscript.json').write_text(json.dumps(u.build.__globals__['MANIFEST']))
        self.expected=f.logical(bundle);self.client=Client(self.expected)
        self.plan={'scriptId':SCRIPT,'revision':OLD,'sourceDigest':'c'*64,'activeVersion':1,'sheetHash':SHEET,'phase':'NH_AUTH_APPROVAL_REQUIRED','url':'https://script.google.com/macros/s/SYNTHETIC_FRESH_DEPLOYMENT/exec'}
        (self.env/'fresh-plan.json').write_text(json.dumps(self.plan))
        for obj,name,kw in [(u,'revision',{'return_value':NEW}),(u,'historical_bundle',{'return_value':(self.expected,'c'*64)}),(f,'has_git_parent',{'return_value':False}),(u.time,'sleep',{'return_value':None})]:
            p=patch.object(obj,name,**kw);p.start();self.addCleanup(p.stop)
    def meta(self):
        new=self.client.version==2
        return {'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':f.fingerprint(SCRIPT),'sheetHash':SHEET,'storeEngine':'account-store-v2','storeVersion':2,'sourceDigest':u.source_digest() if new else self.plan['sourceDigest'],'revision':NEW if new else OLD,'foreignIdentityVersion':1 if new else 0}
    def test_upgrade_proves_sources_preserves_backups_and_only_changes_fresh_code(self):
        r=u.upgrade(self.env,self.client,self.meta)
        self.assertEqual(r['status'],'PASS');self.assertEqual(self.client.version,2)
        saved=json.loads((self.env/'fresh-plan.json').read_text())
        self.assertEqual(saved['sourceDigest'],u.source_digest());self.assertEqual(saved['sheetHash'],SHEET)
        root=self.env/('upgrade-'+NEW[:12]);self.assertTrue((root/'source-before-upgrade.zip').is_file())
        self.assertEqual(f.logical(root/'previous-bundle'),self.expected)
        self.assertTrue(all(x[0] in ('pull','push','list-deployments','create-version','update-deployment') for x in self.client.calls))
        self.assertFalse(r['storageWrites']);self.assertFalse(r['propertiesWrites']);self.assertFalse(r['nhRequested'])
    def test_wrong_binding_refuses_before_mutation(self):
        with self.assertRaises(u.Stop):u.upgrade(self.env,self.client,lambda:dict(self.meta(),sheetHash=f.fingerprint(f.OLD_SHEET)))
        self.assertEqual(self.client.calls,[])
    def test_concurrent_head_edit_refuses_before_mutation(self):
        self.client.head['Extra']='// unrelated'
        with self.assertRaisesRegex(u.Stop,'CONCURRENT_SOURCE_CHANGE'):u.upgrade(self.env,self.client,self.meta)
        self.assertNotIn('push',[x[0] for x in self.client.calls])
    def test_bad_published_proof_restores_source_version_and_plan_without_data_restore(self):
        def metadata():return dict(self.meta(),sourceDigest='d'*64) if self.client.version==2 else self.meta()
        r=u.upgrade(self.env,self.client,metadata)
        self.assertEqual(r['status'],'FAIL');self.assertEqual(r['recovery'],'PASS_FRESH_SOURCE_AND_DEPLOYMENT_RESTORED')
        self.assertEqual(self.client.head,self.expected);self.assertEqual(self.client.version,1)
        self.assertEqual(json.loads((self.env/'fresh-plan.json').read_text()),self.plan)
    def test_concurrent_edit_during_upgrade_is_never_overwritten_by_rollback(self):
        self.client.corrupt=True
        r=u.upgrade(self.env,self.client,self.meta)
        self.assertEqual(r['status'],'FAIL');self.assertEqual(r['recovery'],'OWNER_REVIEW_REQUIRED')
        self.assertIn('ConcurrentEdit',self.client.head)
        self.assertEqual(sum(x[0]=='push' for x in self.client.calls),1)
    def test_protected_deployment_cannot_be_updated(self):
        with patch.object(u.subprocess,'run') as run:
            for dep in (u.OLD_DEPLOYMENT,u.PRODUCTION_DEPLOYMENT_ID):
                with self.assertRaises(u.Stop):u.upgrade_clasp(['update-deployment',dep,'--versionNumber','2','--description','synthetic'],self.env/'bundle',SCRIPT)
            run.assert_not_called()

class HistoricalTests(unittest.TestCase):
    def test_historical_graph_is_literal_parsed_not_executed_and_digest_is_rebuilt(self):
        manifest={'runtimeVersion':'V8'}
        blobs={'tools/build_nh_staging.py':b'SOURCES=["gas/Synthetic.gs", "tests/staging/StagingBridge.gs"]\nMANIFEST={"runtimeVersion":"V8"}\nraise RuntimeError("do not execute history")', 'gas/Synthetic.gs':b'// __REVISION__ unchanged', 'tests/staging/StagingBridge.gs':b'// __SCRIPT_ID__ __REVISION__ __SOURCE_DIGEST__'}
        def run(args,**kwargs):return type('R',(),{'returncode':0,'stdout':blobs[args[-1].split(':',1)[1]]})()
        with patch.object(u.subprocess,'run',side_effect=run):result,digest=u.historical_bundle(OLD,SCRIPT)
        d=hashlib.sha256()
        for name in ('gas/Synthetic.gs','tests/staging/StagingBridge.gs'):
            data=blobs[name];d.update(name.encode()+b'\0'+str(len(data)).encode()+b'\0'+data)
        d.update(json.dumps(manifest,sort_keys=True).encode())
        self.assertEqual(digest,d.hexdigest());self.assertEqual(result['Synthetic'],'// __REVISION__ unchanged');self.assertIn(SCRIPT,result['StagingBridge'])
