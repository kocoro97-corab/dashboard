"""Deployment plan tests only. No Cloudflare/GAS API, credentials or resources."""
import json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import nh_v2_persistent as mod
class OwnerTests(unittest.TestCase):
 def test_deploy_targets_existing_free_account_and_sends_secrets_only_on_stdin(self):
  with tempfile.TemporaryDirectory() as t:
   folder=Path(t);plan={'scriptId':'SYNTHETIC_SCRIPT','url':'https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT/exec','sheetHash':'b'*64,'sourceDigest':'c'*64};(folder/'fresh-plan.json').write_text(json.dumps(plan));calls=[]
   def api(path,token,optional=False):return None if '/scripts/' in path else {'subdomain':'synthetic'}
   def runner(args,cwd,env,secret=None):calls.append((args,env,secret));return ''
   def probe(endpoint,body):return dict(mod.expected(plan),success=True,relayProfile='persistent',developmentAccountReads=True,developmentPublicMarket=True,developmentExternalStore=True)
   args=SimpleNamespace(environment=folder,account_id='a'*32,free_plan_confirmed=True,disable=False)
   with patch.object(mod,'private_path',return_value=folder),patch.object(mod.shutil,'which',return_value='/synthetic/npx'):
    result=mod.deploy(args,api=api,runner=runner,preflight_fn=lambda *a,**k:None,settings_fn=lambda p:dict(status='PASS',executeAs='USER_DEPLOYING',access='ANYONE_ANONYMOUS',versionMatches=True),probe=probe,cf_token='SYNTHETIC_PRIVATE_TOKEN')
   self.assertEqual(result['status'],'PASS');self.assertEqual(len(calls),3);self.assertIsNone(calls[0][2]);self.assertEqual(calls[-1][0][:2],['secret','bulk']);self.assertIn(plan['url'],calls[-1][2]);self.assertNotIn('SYNTHETIC_PRIVATE_TOKEN',json.dumps(result));self.assertNotIn(plan['url'],''.join(p.read_text() for p in (folder/'persistent-worker').iterdir() if p.suffix=='.json' and p.name!='policy.json'))
 def test_missing_free_plan_attestation_and_name_conflicts_stop_before_deployment(self):
  args=SimpleNamespace(environment=Path('/unused'),account_id='a'*32,free_plan_confirmed=False,disable=False)
  with self.assertRaisesRegex(mod.Stop,'FREE_PLAN'):mod.deploy(args,cf_token='SYNTHETIC')
  args.free_plan_confirmed=True
  with tempfile.TemporaryDirectory() as t,patch.object(mod,'private_path',return_value=Path(t)),patch.object(mod.shutil,'which',return_value='/synthetic/npx'):
   with self.assertRaisesRegex(mod.Stop,'NAME_CONFLICT'):mod.deploy(args,api=lambda path,*a,**k:{'bindings':[]} if '/scripts/' in path else {'subdomain':'synthetic'},cf_token='SYNTHETIC')
 def test_disable_does_not_read_google_or_enable_missing_resources(self):
  with tempfile.TemporaryDirectory() as t,patch.object(mod,'private_path',return_value=Path(t)),patch.object(mod.shutil,'which',return_value='/synthetic/npx'):
   calls=[];args=SimpleNamespace(environment=Path(t),account_id='a'*32,free_plan_confirmed=False,disable=True)
   def api(path,*a,**k):return {'bindings':[{'name':'MYINVEST_ROLE','text':mod.ROLE}]} if '/scripts/' in path else {'subdomain':'synthetic'}
   result=mod.deploy(args,api=api,runner=lambda *a:calls.append(a),preflight_fn=lambda *a,**k:self.fail('must not call Google'),cf_token='SYNTHETIC')
   self.assertEqual(result['code'],'PERSISTENT_ACCESS_CLOSED');self.assertEqual(len(calls),1);self.assertEqual(json.loads(calls[0][-1]),{'MYINVEST_ENABLED':'false'})
if __name__=='__main__':unittest.main()
