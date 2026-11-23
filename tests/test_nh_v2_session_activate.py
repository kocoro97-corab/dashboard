"""Offline session rollout contracts; synthetic Google/Cloudflare only."""
import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path[:0]=[str(Path(__file__).resolve().parents[1]/'tools'),str(Path(__file__).resolve().parent)]
import nh_v2_session_activate as s
from test_worker_code_only import Cloud,OLD,NEW,OTHER
from test_nh_v2_upgrade import Client,SCRIPT
REV='b'*40

def cloud():
 c=Cloud();c.settings['bindings'].append({'name':'MYINVEST_EXPECTED_METADATA','type':'secret_text'});return c

def metadata(plan):
 return {**s.edge.expected(plan),'success':True,'relayProfile':'persistent','revision':plan['revision'],'storeVersion':2,'foreignIdentityVersion':1,'developmentPublicMarket':True,'developmentAccountReads':True,'developmentExternalStore':True,'developmentPublicFutures':True,'developmentIndustryMarket':True,'developmentFuturesReadVersion':2,'developmentReadResilienceVersion':1,'developmentFiveMinuteReferenceVersion':1}

class BindingTests(unittest.TestCase):
 def setUp(self):
  self.c=cloud();self.old={'scriptId':SCRIPT,'sheetHash':'c'*64,'sourceDigest':'d'*64,'revision':'a'*40};self.code=patch.object(s.worker,'bundle',return_value=b'// synthetic code');self.code.start();self.addCleanup(self.code.stop)
 def prepare(self):return s.prepare(self.c,'a'*32,self.old,lambda:metadata(self.old))
 def test_preflight_is_read_only(self):
  self.prepare();self.assertTrue(all(c[0]=='GET' for c in self.c.calls))
 def test_active_code_mismatch_stops_before_any_upload(self):
  self.c.content['body']=b'// other actor code'
  with self.assertRaisesRegex(s.Stop,'ACTIVE_WORKER_CODE_MISMATCH'):self.prepare()
  self.assertTrue(all(c[0]=='GET' for c in self.c.calls))
 def test_pending_candidate_is_not_activated(self):
  self.c.uploads.append({'id':OTHER,'number':2})
  with self.assertRaisesRegex(s.Stop,'LATEST_VERSION_NOT_ACTIVE'):self.prepare()
 def test_only_one_metadata_binding_changes_and_code_stays_identical(self):
  cp=self.prepare();s.bind(self.c,cp,dict(self.old,sourceDigest='f'*64));parts=list(self.c.multipart.iter_parts());m=json.loads(parts[0].get_payload(decode=True));bindings=m['bindings'];changed=[b for b in bindings if b['type']!='inherit'];self.assertEqual([b['name'] for b in changed],['MYINVEST_EXPECTED_METADATA']);self.assertEqual(json.loads(changed[0]['text'])['sourceDigest'],'f'*64);self.assertTrue(all(b.get('version_id')=='latest' for b in bindings if b['type']=='inherit'));self.assertEqual(parts[1].get_payload(decode=True),b'// synthetic code');self.assertEqual(self.c.version,NEW)
 def test_changed_worker_before_binding_is_not_overwritten(self):
  cp=self.prepare();self.c.version=OTHER
  with self.assertRaisesRegex(s.Stop,'CONCURRENT_WORKER_CHANGE'):s.bind(self.c,cp,self.old)
  self.assertFalse(any(c[0]=='POST' for c in self.c.calls))
 def test_concurrent_upload_does_not_activate(self):
  cp=self.prepare();self.c.fault='upload-after'
  with self.assertRaisesRegex(s.Stop,'CONCURRENT_WORKER_CHANGE'):s.bind(self.c,cp,self.old)
  self.assertEqual(self.c.version,OLD)
 def test_other_binding_values_are_not_ignored_by_postcheck(self):
  before=copy.deepcopy(self.c.settings);after=copy.deepcopy(before);after['bindings'][0]['text']='other-role';self.assertFalse(s.compatible_settings(before,after))
 def test_public_readback_requires_both_identity_and_exact_policy(self):
  d=dict(metadata(self.old),developmentSessionPolicyVersion=1,sessionIdleMs=3600000,sessionAbsoluteMs=28800000);s.policy_verified(d,self.old)
  for key,value in [('sessionIdleMs',300000),('sessionAbsoluteMs',3600000),('developmentSessionPolicyVersion',0),('sourceDigest','f'*64)]:
   with self.assertRaises(Exception):s.policy_verified(dict(d,**{key:value}),self.old)

class RolloutTests(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.env=Path(t.name)/'private';self.env.mkdir();bundle=self.env/'bundle';bundle.mkdir();(bundle/'.clasp.json').write_text(json.dumps({'scriptId':SCRIPT,'rootDir':'.'}));(bundle/'Synthetic.gs').write_text('// baseline');(bundle/'appsscript.json').write_text(json.dumps(s.gas.build.__globals__['MANIFEST']));self.before=s.logical(bundle);self.client=Client(self.before);self.c=cloud();self.bad=False;self.concurrent=False
  self.old={'scriptId':SCRIPT,'revision':'a'*40,'sourceDigest':'c'*64,'activeVersion':1,'sheetHash':s.gas.fingerprint('SYNTHETIC_FRESH_SHEET_123456789'),'phase':'NH_AUTH_APPROVAL_REQUIRED','url':'https://script.google.com/macros/s/SYNTHETIC_FRESH_DEPLOYMENT/exec'};(self.env/'fresh-plan.json').write_text(json.dumps(self.old))
  raw=s.gas.upgrade
  def meta():
   plan=json.loads((self.env/'fresh-plan.json').read_text())
   if self.client.version==2:plan=dict(plan,sourceDigest=s.source_digest(),revision=REV)
   out=metadata(plan)
   if self.client.version==2:out.update(developmentSessionPolicyVersion=1,sessionIdleMs=3600000,sessionAbsoluteMs=28800000)
   return out
  self.meta=meta
  def public(*args):
   if self.concurrent and self.c.version==NEW:self.c.version=OTHER;raise s.Stop('SESSION_POLICY_READBACK_FAILED')
   if (self.c.version==OLD)!=(self.client.version==1):raise s.Stop('SESSION_POLICY_READBACK_FAILED')
   out=meta()
   if self.bad and self.c.version==NEW:out.pop('developmentSessionPolicyVersion')
   return out
  class App:
   def __init__(a,url):pass
   def call(a,action):assert action=='appVersion';return meta()
  patches=[patch.object(s.gas,'revision',return_value=REV),patch.object(s.gas,'historical_bundle',return_value=(self.before,'c'*64)),patch('nh_v2_fresh.has_git_parent',return_value=False),patch.object(s.gas,'upgrade_clasp',self.client),patch.object(s.gas,'upgrade',side_effect=lambda path:raw(path,client=self.client,metadata=meta)),patch.object(s.worker,'api_client',return_value=self.c),patch.object(s.worker,'bundle',return_value=b'// synthetic code'),patch.object(s.edge,'public_request',side_effect=public),patch.object(s,'WebApp',App),patch.object(s.time,'sleep',return_value=None)]
  for p in patches:p.start();self.addCleanup(p.stop)
 def test_coordinated_upgrade_retains_scope_and_verifies_hour_policy(self):
  result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['status'],'PASS');self.assertEqual(self.client.version,2);self.assertEqual(self.c.version,NEW);self.assertEqual(result['metadataBindingUpdates'],1);self.assertTrue(all(c[0] in ['GET','POST'] for c in self.c.calls));self.assertTrue(all(c[0] in ['pull','push','list-deployments','create-version','update-deployment'] for c in self.client.calls))
 def test_failed_hour_readback_restores_both_connections_without_data_restore(self):
  self.bad=True;result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['status'],'FAIL');self.assertEqual(result['recovery'],'PASS_PREVIOUS_CONNECTION_RESTORED');self.assertEqual(self.client.version,1);self.assertEqual(self.c.version,OLD);self.assertEqual(json.loads((self.env/'fresh-plan.json').read_text()),self.old);self.assertEqual(s.logical(self.env/'bundle'),self.before)
 def test_concurrent_deployment_is_not_overwritten_by_rollback(self):
  self.concurrent=True;result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['recovery'],'OWNER_REVIEW_REQUIRED');self.assertEqual(self.c.version,OTHER);self.assertEqual(self.client.version,2)
 def test_gas_failure_never_updates_worker(self):
  calls=[];r=s.transaction(lambda:{'status':'FAIL','recovery':'PASS_PREVIOUS_CONNECTION_RESTORED'},lambda:calls.append('bind'),lambda:None,lambda:calls.append('restore'));self.assertEqual(r['status'],'FAIL');self.assertEqual(calls,[])

class PlanTests(unittest.TestCase):
 def test_missing_owner_environment_is_explicit_and_never_calls_cloudflare(self):
  with patch.object(s.worker,'api_client') as api:
   with self.assertRaisesRegex(s.Stop,'OWNER_PRIVATE_ENVIRONMENT_UNAVAILABLE'):s.plan_for('/nonexistent/synthetic-private-environment')
   api.assert_not_called()
 def test_unknown_error_details_are_filtered(self):
  self.assertEqual(s.safe_error(RuntimeError('PRIVATE_TOKEN_OR_ACCOUNT')),{'code':'OWNER_SESSION_PREFLIGHT_FAILED'})
 def test_local_plan_allows_only_security_and_staging_bridge_and_keeps_manifest(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp);s.build(SCRIPT,REV,folder/'bundle');before=s.logical(folder/'bundle');before['Security']='// prior security';before['StagingBridge']='// prior bridge'
   for key,value in before.items():(folder/'bundle'/(key+('.json' if key=='appsscript' else '.gs'))).write_text(value)
   old={'scriptId':SCRIPT,'revision':'a'*40,'sourceDigest':'c'*64};(folder/'fresh-plan.json').write_text(json.dumps(old))
   with patch.object(s.gas,'historical_bundle',return_value=(before,'c'*64)),patch.object(s.gas,'revision',return_value=REV),patch('nh_v2_fresh.has_git_parent',return_value=False):
    _,_,r=s.plan_for(folder);self.assertEqual(r['gasModules'],['Security','StagingBridge']);self.assertFalse(r['deploymentAttempted'])
    before['NhAccountsV2']='// unrelated';(folder/'bundle/NhAccountsV2.gs').write_text('// unrelated')
    with self.assertRaisesRegex(s.Stop,'UNRELATED_GAS_CHANGE_STOP'):s.plan_for(folder)

if __name__=='__main__':unittest.main()
