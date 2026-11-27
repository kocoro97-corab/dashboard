"""Synthetic owner metadata checks; no external service or credentials."""
import importlib.util,io,json,os,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import news_reader_owner_preflight as m

class NewsOwnerPreflightTests(unittest.TestCase):
    def fixture(self,kind=None):
        calls=[]
        def run(args,**kwargs):
            calls.append((args,kwargs))
            if args[1:3]==['auth','list']:value=[{'account':'kocoro97@gmail.com','status':'ACTIVE'}]
            elif args[1:3]==['projects','describe']:value={'projectId':m.PROJECT,'lifecycleState':'ACTIVE'}
            elif args[1:4]==['iam','service-accounts','describe']:value={'email':m.READER,'projectId':m.PROJECT}
            elif args[1:3]==['services','list']:value=[{'config':{'name':'drive.googleapis.com'}}]
            elif args[1:3]==['projects','get-iam-policy']:value={'bindings':[]}
            elif args[1:5]==['iam','service-accounts','keys','list']:value=[]
            else:self.fail('Unexpected command')
            if kind=='wrong-owner' and args[1:3]==['auth','list']:value=[{'account':'other@example.test'}]
            if kind=='disabled' and args[1:4]==['iam','service-accounts','describe']:value['disabled']=True
            if kind=='scope-role' and args[1:3]==['projects','get-iam-policy']:value={'bindings':[{'role':'roles/owner','members':['serviceAccount:'+m.READER]}]}
            if kind=='drive-disabled' and args[1:3]==['services','list']:value=[]
            return subprocess.CompletedProcess(args,0,stdout=json.dumps(value),stderr='')
        return run,calls

    def test_exact_existing_project_and_reader_only_use_read_commands(self):
        run,calls=self.fixture()
        with patch.object(m.shutil,'which',return_value='/synthetic/gcloud'):
            result=m.google_snapshot(run)
        self.assertTrue(result['driveApiEnabled']);self.assertTrue(result['dedicatedReaderVerified'])
        self.assertEqual(result['existingUserManagedKeyCount'],0);self.assertEqual(len(calls),6)
        self.assertFalse(any(any(word in ('create','enable','add-iam-policy-binding','delete','update') for word in args) for args,_ in calls))

    def test_wrong_identity_disabled_reader_broad_roles_and_missing_api_are_rejected(self):
        for kind,code in [('wrong-owner','EXISTING_GOOGLE_OWNER_ACCOUNT_REQUIRED'),('disabled','DEDICATED_READER_IDENTITY_MISMATCH'),('scope-role','DEDICATED_READER_PROJECT_ROLES_REQUIRE_REVIEW'),('drive-disabled','DRIVE_API_NOT_ENABLED')]:
            with self.subTest(kind=kind),patch.object(m.shutil,'which',return_value='/synthetic/gcloud'):
                with self.assertRaisesRegex(m.Stop,code):m.google_snapshot(self.fixture(kind)[0])

    def test_cli_failure_never_reports_stderr_or_private_values(self):
        def failed(*args,**kwargs):return subprocess.CompletedProcess([],1,stdout='',stderr='PRIVATE_CANARY')
        with patch.object(m.shutil,'which',return_value='/synthetic/gcloud'):
            with self.assertRaises(m.Stop) as error:m.google_snapshot(failed)
        self.assertNotIn('PRIVATE',str(error.exception))

    def test_cloudflare_token_is_not_inherited_by_google_processes(self):
        run,calls=self.fixture()
        with patch.object(m.shutil,'which',return_value='/synthetic/gcloud'),patch.dict(os.environ,{'CLOUDFLARE_API_TOKEN':'PRIVATE_CANARY'}):m.google_snapshot(run)
        self.assertTrue(all('CLOUDFLARE_API_TOKEN' not in kwargs['env'] for _,kwargs in calls))

    def cloud(self,private_exists):
        calls=[]
        def raw(method,path,*args):
            calls.append((method,path))
            self.assertEqual(method,'GET')
            if path.endswith('/'+m.PREVIEW+'/settings'):
                if not private_exists:raise m.worker.Stop('CLOUDFLARE_REQUEST_REJECTED',http=404)
                return {'bindings':[{'name':'MYINVEST_NEWS_READER_PEM','type':'secret_text','text':'PRIVATE_CANARY'}]}
            return {}
        def inspect(read,account,owner_dir):
            read('/accounts/'+account+'/workers/scripts/'+m.worker.NAME+'/settings')
            return {'activeVersion':'synthetic-active','latestVersionIsActive':False,'ownerCheckoutVerified':True,'ownerCheckoutInspection':{'sourceRevisionMatches':True}}
        return raw,inspect,calls

    def test_existing_and_missing_preview_are_checked_without_creation(self):
        for exists in [True,False]:
            raw,inspect,calls=self.cloud(exists)
            with patch.object(m.worker,'api_client',return_value=raw),patch.object(m.owner,'inspect',side_effect=inspect):
                result=m.cloud_snapshot('a'*32,'PRIVATE_TOKEN',Path('/synthetic-owner'))
            self.assertEqual(result['privatePreviewExists'],exists)
            self.assertTrue(result['primaryHasPendingVersion']);self.assertNotIn('PRIVATE',json.dumps(result))
            self.assertEqual(len(calls),2)

    def test_other_workers_and_mutation_paths_cannot_be_requested(self):
        calls=[]
        def inspect(read,account,owner_dir):
            with self.assertRaises(m.Stop):read('/accounts/'+account+'/workers/scripts/another-worker/settings')
            return {'activeVersion':'synthetic-active','latestVersionIsActive':True,'ownerCheckoutVerified':False}
        with patch.object(m.worker,'api_client',return_value=lambda *a:calls.append(a) or {}),patch.object(m.owner,'inspect',side_effect=inspect):m.cloud_snapshot('a'*32,'PRIVATE_TOKEN',Path('/synthetic-owner'))
        self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
