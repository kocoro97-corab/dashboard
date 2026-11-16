"""Deployment plan tests only. No Cloudflare/GAS API, credentials or resources."""
import io,json,socket,sys,tempfile,unittest,urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import nh_v2_persistent as mod
class OwnerTests(unittest.TestCase):
 def test_api_errors_report_only_status_stage_and_numeric_codes(self):
  for status in (401,403):
   error=urllib.error.HTTPError('https://private.invalid',status,'PRIVATE_MESSAGE',{},io.BytesIO(json.dumps({'errors':[{'code':10000,'message':'PRIVATE_TOKEN'},{'code':'PRIVATE_ID'}]}).encode()))
   with patch.object(mod.urllib.request,'build_opener') as opener:
    opener.return_value.open.side_effect=error
    with self.assertRaises(mod.Stop) as caught:mod.cloud('/accounts/PRIVATE_ID/workers/subdomain','SYNTHETIC_TOKEN')
   self.assertEqual(caught.exception.diagnostic,{'stage':'WORKERS_SUBDOMAIN','http':status,'providerCodes':[10000]})
   self.assertNotIn('PRIVATE',str(caught.exception)+json.dumps(caught.exception.diagnostic))
 def test_dns_and_optional_missing_worker_are_distinguished(self):
  with patch.object(mod.urllib.request,'build_opener') as opener:
   opener.return_value.open.side_effect=urllib.error.URLError(socket.gaierror(-2,'PRIVATE_HOST'))
   with self.assertRaises(mod.Stop) as caught:mod.cloud('/accounts/private/workers/subdomain','SYNTHETIC')
   self.assertEqual(caught.exception.diagnostic,{'stage':'WORKERS_SUBDOMAIN','transport':'DNS'})
   opener.return_value.open.side_effect=urllib.error.HTTPError('https://private.invalid',404,'PRIVATE',{},io.BytesIO(b'{}'))
   self.assertIsNone(mod.cloud('/accounts/private/workers/scripts/test/settings','SYNTHETIC',optional=True))
 def test_read_only_diagnosis_uses_fresh_prompt_without_local_or_remote_writes(self):
  args=SimpleNamespace(environment=Path('/unused'),account_id='a'*32,free_plan_confirmed=False,disable=False,diagnose_cloudflare=True,prompt_token=True)
  def api(path,token,optional=False):
   self.assertEqual(token,'FRESH_SYNTHETIC');return None if '/scripts/' in path else {'subdomain':'synthetic'}
  with patch.dict(mod.os.environ,{'CLOUDFLARE_API_TOKEN':'STALE_SYNTHETIC'}),patch.object(mod.getpass,'getpass',return_value='FRESH_SYNTHETIC'),patch.object(mod,'private_path',side_effect=AssertionError('private environment accessed')),patch.object(mod.shutil,'which',side_effect=AssertionError('npx accessed')):
   result=mod.deploy(args,api=api,runner=lambda *a:self.fail('deployment'),preflight_fn=lambda *a,**k:self.fail('Google'),probe=lambda *a:self.fail('probe'))
  self.assertEqual(result['status'],'PASS');self.assertEqual(result['tokenSource'],'PROMPT');self.assertFalse(result['deploymentAttempted']);self.assertEqual(result['writePermission'],'NOT_RUN')
 def test_token_format_rejects_header_prefix_and_control_characters(self):
  for token in ('Bearer SYNTHETIC','SYNTHETIC\nHEADER','"SYNTHETIC"',''):
   with self.assertRaisesRegex(mod.Stop,'TOKEN_FORMAT'):mod.clean_token(token)
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
