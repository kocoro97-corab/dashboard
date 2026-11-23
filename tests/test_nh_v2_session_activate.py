"""Offline session rollout contracts; synthetic Google/Cloudflare only."""
import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path[:0]=[str(Path(__file__).resolve().parents[1]/'tools'),str(Path(__file__).resolve().parent)]
import nh_v2_session_activate as s
from test_worker_code_only import Cloud,OLD,NEW,OTHER
from test_nh_v2_upgrade import Client,SCRIPT
REV='b'*40

class PreservedCloud(Cloud):
 def __call__(self,method,path,body=None,mime=None):
  if '/content' in path:raise AssertionError('session update must never retrieve or reupload Worker source')
  if method=='PATCH':
   self.calls.append((method,path,body));self.patchBody=copy.deepcopy(body);self.patchMime=mime
   assert path=='/accounts/'+'a'*32+'/workers/workers/'+s.worker.NAME+'/versions/latest'
   if self.fault=='patch-denied':raise s.worker.Stop('CLOUDFLARE_REQUEST_REJECTED',403,'VERSION_SECRET_PATCH',[10000])
   self.uploads.append({'id':NEW,'number':max(x['number'] for x in self.uploads)+1})
   if self.fault=='upload-after':self.uploads.append({'id':OTHER,'number':3})
   if self.fault=='concurrent':self.version=OTHER
   return {'id':NEW}
  if method=='GET' and any(path.endswith('/versions/'+v) for v in [OLD,NEW]):
   self.calls.append((method,path,body));version=path.rsplit('/',1)[1]
   resources={'script':{'etag':'SYNTHETIC_SAME_CODE_HASH','handlers':['fetch'],'named_handlers':[{'name':'RelayGate','handlers':['fetch']}],'last_deployed_from':'api' if version==NEW else 'wrangler'},'script_runtime':{'compatibility_date':self.settings['compatibility_date'],'compatibility_flags':self.settings['compatibility_flags'],'limits':self.settings['limits']},'bindings':copy.deepcopy(self.settings['bindings'])}
   if self.fault=='missing-etag':resources['script'].pop('etag')
   if version==NEW:
    if self.fault=='candidate-code':resources['script']['etag']='SYNTHETIC_DIFFERENT_CODE_HASH'
    if self.fault=='candidate-runtime':resources['script_runtime']['compatibility_flags']=['nodejs_compat']
    if self.fault=='candidate-binding':resources['bindings'][0]['text']='different-role'
    resources['bindings'].reverse()
   return {'id':version,'resources':resources,'cache_options':{'enabled':True}}
  return super().__call__(method,path,body,mime)

def cloud():
 c=PreservedCloud();c.settings['bindings'].append({'name':'MYINVEST_EXPECTED_METADATA','type':'secret_text'});return c

def metadata(plan):
 return {**s.edge.expected(plan),'success':True,'relayProfile':'persistent','revision':plan['revision'],'storeVersion':2,'foreignIdentityVersion':1,'developmentPublicMarket':True,'developmentAccountReads':True,'developmentExternalStore':True,'developmentPublicFutures':True,'developmentIndustryMarket':True,'developmentFuturesReadVersion':2,'developmentReadResilienceVersion':1,'developmentFiveMinuteReferenceVersion':1}

class BindingTests(unittest.TestCase):
 def setUp(self):
  self.c=cloud();self.old={'scriptId':SCRIPT,'sheetHash':'c'*64,'sourceDigest':'d'*64,'revision':'a'*40};self.code=patch.object(s.worker,'bundle',return_value=b'// synthetic code');self.code.start();self.addCleanup(self.code.stop)
 def prepare(self):return s.prepare(self.c,'a'*32,self.old,lambda:metadata(self.old))
 def test_preflight_is_read_only(self):
  self.prepare();self.assertTrue(all(c[0]=='GET' for c in self.c.calls))
 def test_source_format_does_not_require_bundle_parser_or_local_code(self):
  self.c.content={'body':b'unknown compiled format','contentType':'application/octet-stream'}
  with patch.object(s.worker,'bundle',side_effect=AssertionError('must not upload local worker code')):
   cp=self.prepare();s.bind(self.c,cp,self.old)
  self.assertFalse(any('/content' in path for _,path,_ in self.c.calls))
  self.assertFalse(any(method=='POST' and '/versions' in path for method,path,_ in self.c.calls))
 def test_missing_provider_code_proof_stops_before_any_change(self):
  self.c.fault='missing-etag'
  with self.assertRaisesRegex(s.Stop,'ACTIVE_VERSION_CODE_PROOF_REQUIRED'):self.prepare()
  self.assertTrue(all(c[0]=='GET' for c in self.c.calls))
 def test_checkpoint_contains_configuration_proof_without_source_bodies(self):
  cp=self.prepare();self.assertIn('codeProof',cp);self.assertNotIn('code',cp);self.assertNotIn('codeManifest',cp);json.dumps(cp)
 def test_runtime_and_unrelated_binding_change_are_detected_before_activation(self):
  for fault in ['candidate-runtime','candidate-binding']:
   with self.subTest(fault=fault):
    self.c=cloud();cp=self.prepare();self.c.fault=fault
    with self.assertRaisesRegex(s.Stop,'CANDIDATE_WORKER_CODE_MISMATCH'):s.bind(self.c,cp,self.old)
    self.assertEqual(self.c.version,OLD)
 def test_invalid_code_proof_shapes_are_rejected(self):
  base=self.c('GET','/versions/'+OLD)
  cases=[None,{'id':OLD},{**base,'id':OTHER}]
  for path,value in [('script',{}),('script_runtime',None),('bindings',[])]:
   v=copy.deepcopy(base);v['resources'][path]=value;cases.append(v)
  for value in cases:
   with self.subTest(value=value),self.assertRaises(s.Stop):s.version_proof(value,OLD)
 def test_secret_patch_rejection_exposes_only_fixed_diagnostics(self):
  cp=self.prepare();self.c.fault='patch-denied'
  try:s.bind(self.c,cp,self.old)
  except s.worker.Stop as e:self.assertEqual(s.safe_error(e),{'code':'CLOUDFLARE_REQUEST_REJECTED','http':403,'requestStage':'VERSION_SECRET_PATCH','providerCodes':[10000]})
  else:self.fail('rejection not propagated')
  self.assertEqual(self.c.version,OLD)
 def test_real_transport_serializes_merge_patch_without_source_files(self):
  payload={'env':{'MYINVEST_EXPECTED_METADATA':{'type':'secret_text','text':'SYNTHETIC_METADATA_ONLY'}}}
  with patch.object(s.worker.urllib.request,'build_opener') as opener:
   response=opener.return_value.open.return_value.__enter__.return_value
   response.read.return_value=json.dumps({'success':True,'result':{'id':NEW}}).encode()
   result=s.worker.api_client('SYNTHETIC_TOKEN')('PATCH','/accounts/'+'a'*32+'/workers/workers/'+s.worker.NAME+'/versions/latest',payload,'application/merge-patch+json')
   request=opener.return_value.open.call_args.args[0]
  self.assertEqual(result,{'id':NEW});self.assertEqual(request.method,'PATCH');self.assertEqual(request.get_header('Content-type'),'application/merge-patch+json');self.assertEqual(json.loads(request.data),payload)
 def test_secret_patch_api_stage_is_distinct_from_source_upload(self):
  self.assertEqual(s.worker.request_stage('PATCH','/accounts/'+'a'*32+'/workers/workers/'+s.worker.NAME+'/versions/latest'),'VERSION_SECRET_PATCH')
 def test_candidate_code_change_is_detected_before_activation(self):
  cp=self.prepare();self.c.fault='candidate-code'
  with self.assertRaisesRegex(s.Stop,'CANDIDATE_WORKER_CODE_MISMATCH'):s.bind(self.c,cp,self.old)
  self.assertEqual(self.c.version,OLD)
  self.assertFalse(any(method=='POST' and path.endswith('/deployments') for method,path,body in self.c.calls))
 def test_pending_candidate_is_not_activated(self):
  self.c.uploads.append({'id':OTHER,'number':2})
  with self.assertRaisesRegex(s.Stop,'LATEST_VERSION_NOT_ACTIVE'):self.prepare()
 def test_only_one_metadata_binding_changes_without_code_upload(self):
  cp=self.prepare();s.bind(self.c,cp,dict(self.old,sourceDigest='f'*64));self.assertEqual(self.c.patchMime,'application/merge-patch+json');self.assertEqual(set(self.c.patchBody),{'env'});self.assertEqual(set(self.c.patchBody['env']),{'MYINVEST_EXPECTED_METADATA'});binding=self.c.patchBody['env']['MYINVEST_EXPECTED_METADATA'];self.assertEqual(binding['type'],'secret_text');self.assertEqual(json.loads(binding['text']),s.edge.expected(dict(self.old,sourceDigest='f'*64)));self.assertEqual(self.c.version,NEW)
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
  result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['status'],'PASS');self.assertEqual(self.client.version,2);self.assertEqual(self.c.version,NEW);self.assertEqual(result['metadataBindingUpdates'],1);self.assertTrue(all(c[0] in ['GET','PATCH','POST'] for c in self.c.calls));self.assertTrue(all(c[0] in ['pull','push','list-deployments','create-version','update-deployment'] for c in self.client.calls))
 def test_failed_hour_readback_restores_both_connections_without_data_restore(self):
  self.bad=True;result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['status'],'FAIL');self.assertEqual(result['recovery'],'PASS_PREVIOUS_CONNECTION_RESTORED');self.assertEqual(self.client.version,1);self.assertEqual(self.c.version,OLD);self.assertEqual(json.loads((self.env/'fresh-plan.json').read_text()),self.old);self.assertEqual(s.logical(self.env/'bundle'),self.before)
 def test_concurrent_deployment_is_not_overwritten_by_rollback(self):
  self.concurrent=True;result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['recovery'],'OWNER_REVIEW_REQUIRED');self.assertEqual(self.c.version,OTHER);self.assertEqual(self.client.version,2)
 def test_candidate_code_mismatch_restores_gas_without_activating_changed_code(self):
  self.c.fault='candidate-code';result=s.apply(self.env,self.old,'a'*32,'SYNTHETIC_ONLY');self.assertEqual(result['status'],'FAIL');self.assertEqual(result['recovery'],'PASS_PREVIOUS_CONNECTION_RESTORED');self.assertEqual(self.c.version,OLD);self.assertEqual(self.client.version,1);self.assertNotIn('workerCodePreserved',result)
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
