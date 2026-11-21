"""Deployment plan tests only. No Cloudflare/GAS API, credentials or resources."""
import io,json,socket,sys,tempfile,unittest,urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch,MagicMock
from email.message import Message
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import nh_v2_persistent as mod
class OwnerTests(unittest.TestCase):
 def test_public_success_requires_json_cors_and_success_flag(self):
  for content,cors,body,passed in [('application/json',mod.ORIGIN,b'{"success":true}',True),('text/html',mod.ORIGIN,b'{"success":true}',False),('application/json','*',b'{"success":true}',False),('application/json',mod.ORIGIN,b'{"success":false,"code":"RELAY_TARGET_MISMATCH"}',False),('application/json',mod.ORIGIN,b'PRIVATE_INVALID_JSON',False)]:
   headers=Message();headers['Content-Type']=content;headers['Access-Control-Allow-Origin']=cors
   response=MagicMock();response.status=200;response.headers=headers;response.read.return_value=body
   with patch.object(mod.urllib.request,'build_opener') as opener:
    opener.return_value.open.return_value.__enter__.return_value=response
    if passed:self.assertTrue(mod.public_request('https://test.synthetic.workers.dev/api',{'action':'appVersion'})['success'])
    else:
     with self.assertRaises(mod.Stop) as caught:mod.public_request('https://test.synthetic.workers.dev/api',{'action':'appVersion'})
     self.assertNotIn('PRIVATE',json.dumps(caught.exception.diagnostic))
    request=opener.return_value.open.call_args.args[0]
    self.assertIsNone(request.get_header('Authorization'));self.assertEqual(json.loads(request.data),{'action':'appVersion'});self.assertTrue(request.get_header('User-agent').startswith('Mozilla/5.0'))
 def test_public_http_errors_redact_body_and_identify_worker_failure(self):
  headers=Message();headers['Content-Type']='application/json';headers['Access-Control-Allow-Origin']=mod.ORIGIN
  for code,expected in [('RELAY_CONFIG_INVALID','RELAY_CONFIG_INVALID'),('PRIVATE_TOKEN',None)]:
   error=urllib.error.HTTPError('https://private.invalid',503,'PRIVATE',headers,io.BytesIO(json.dumps({'code':code,'message':'PRIVATE_DATA','url':'PRIVATE_GAS'}).encode()))
   with patch.object(mod.urllib.request,'build_opener') as opener:
    opener.return_value.open.side_effect=error
    with self.assertRaises(mod.Stop) as caught:mod.public_request('https://test.synthetic.workers.dev/api',{'action':'appVersion'})
   self.assertEqual(caught.exception.diagnostic.get('relayCode'),expected);self.assertEqual(caught.exception.diagnostic['http'],503);self.assertEqual(caught.exception.diagnostic['allowOrigin'],'EXPECTED');self.assertNotIn('PRIVATE',json.dumps(caught.exception.diagnostic))
 def test_public_dns_and_redirect_errors_are_sanitized(self):
  with patch.object(mod.urllib.request,'build_opener') as opener:
   opener.return_value.open.side_effect=urllib.error.URLError(socket.gaierror(-2,'PRIVATE_HOST'))
   with self.assertRaises(mod.Stop) as caught:mod.public_request('https://test.synthetic.workers.dev/api',{'action':'appVersion'})
   self.assertEqual(caught.exception.diagnostic,{'stage':'PUBLIC_RELAY','transport':'DNS'})
   headers=Message();headers['Location']='https://private.invalid/TOKEN'
   opener.return_value.open.side_effect=urllib.error.HTTPError('https://private.invalid',302,'PRIVATE',headers,io.BytesIO(b'PRIVATE_HTML'))
   with self.assertRaises(mod.Stop) as caught:mod.public_request('https://test.synthetic.workers.dev/api',{'action':'appVersion'})
   self.assertTrue(caught.exception.diagnostic['redirectBlocked']);self.assertNotIn('PRIVATE',json.dumps(caught.exception.diagnostic))
 def test_public_diagnosis_never_deploys_or_queries_accounts(self):
  with tempfile.TemporaryDirectory() as t:
   folder=Path(t);plan={'scriptId':'SYNTHETIC','sheetHash':'b'*64,'sourceDigest':'c'*64};(folder/'fresh-plan.json').write_text(json.dumps(plan));calls=[]
   args=SimpleNamespace(environment=folder,account_id='a'*32,free_plan_confirmed=False,disable=False,diagnose_public=True)
   def api(path,*a,**k):return {'bindings':[{'name':'MYINVEST_ROLE','text':mod.ROLE}]} if '/scripts/' in path else {'subdomain':'synthetic'}
   def probe(endpoint,body):
    calls.append(body);return dict(mod.expected(plan),success=True,relayProfile='persistent',developmentAccountReads=True,developmentPublicMarket=True,developmentExternalStore=True)
   with patch.object(mod,'private_path',return_value=folder),patch.object(mod.shutil,'which',side_effect=AssertionError('npx')):
    result=mod.deploy(args,api=api,probe=probe,preflight_fn=lambda *a,**k:self.fail('preflight'),runner=lambda *a:self.fail('deploy'),cf_token='SYNTHETIC')
   self.assertEqual(calls,[{'action':'appVersion'}]);self.assertFalse(result['deploymentAttempted']);self.assertFalse((folder/'persistent-worker').exists());self.assertEqual(result['status'],'PASS')
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
