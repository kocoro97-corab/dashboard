"""Existing isolated GAS + one metadata binding only. Default: local read-only plan.
No project/user creation, NH calls, account/store writes, OAuth changes or orders.
--apply requires the owner's existing private plan and Google/Cloudflare access.
"""
import argparse, copy, getpass, json, os, re, shutil, tempfile, time
from pathlib import Path
import nh_v2_upgrade as gas
import nh_v2_persistent as edge
import worker_code_only as worker
from nh_v2_fresh import private_path, target, logical, pull
from nh_staging_test import WebApp
from build_nh_staging import ROOT, build, source_digest

class Stop(Exception): pass
SAFE=set('OWNER_PRIVATE_ENVIRONMENT_UNAVAILABLE OWNER_SESSION_PREFLIGHT_FAILED OLD_SOURCE_PROOF_FAILED AUTH_MANIFEST_CHANGED_STOP UNRELATED_GAS_CHANGE_STOP CLEAN_REVIEWED_SOURCE_REQUIRED ACCOUNT_ID_INVALID EXISTING_SUBDOMAIN_MISMATCH LATEST_VERSION_NOT_ACTIVE ACTIVE_WORKER_CODE_MISMATCH ACTIVE_VERSION_CODE_PROOF_REQUIRED CANDIDATE_WORKER_CODE_MISMATCH CONCURRENT_WORKER_CODE_CHANGE METADATA_BINDING_REQUIRED CONCURRENT_WORKER_CHANGE PENDING_CANDIDATE_STOP SESSION_POLICY_READBACK_FAILED UPGRADE_FAILED ROLLBACK_PROOF_FAILED CONCURRENT_GAS_CHANGE_STOP ROLLBACK_READBACK_FAILED SOURCE_ALREADY_CURRENT CHECKPOINT_EXISTS CLOUDFLARE_REQUEST_REJECTED CLOUDFLARE_RESULT_UNCONFIRMED OWNER_GOOGLE_LOGIN_REQUIRED OWNER_GOOGLE_SCOPE_REQUIRED OWNER_APPS_SCRIPT_API_REQUIRED OWNER_CLASP_AUTH_OR_COMMAND_FAILED'.split())
def safe_error(error):
 code=getattr(error,'code',str(error));out={'code':code if code in SAFE else 'OWNER_SESSION_PREFLIGHT_FAILED'}
 http=getattr(error,'http',None)
 if type(http) is int and 100<=http<=599:out['http']=http
 stage=getattr(error,'stage',None)
 if stage in {'VERSION_SECRET_PATCH','ACTIVE_VERSION_READ','WORKER_SETTINGS_READ','VERSION_ACTIVATE','VERSIONS_LIST_READ','DEPLOYMENTS_READ','ACCOUNT_SUBDOMAIN_READ'}:out['requestStage']=stage
 codes=getattr(error,'provider_codes',[])
 if isinstance(codes,list):
  numbers=[c for c in codes[:10] if type(c) is int]
  if numbers:out['providerCodes']=numbers
 return out

def load_private(directory):
 if not (Path(directory)/'fresh-plan.json').is_file():raise Stop('OWNER_PRIVATE_ENVIRONMENT_UNAVAILABLE')
 directory=private_path(directory,False)
 if (directory/'fresh-plan.json').is_symlink() or (directory/'bundle').is_symlink():raise Stop('OWNER_PRIVATE_ENVIRONMENT_UNAVAILABLE')
 old=json.loads((directory/'fresh-plan.json').read_text());target(old['scriptId'])
 before,digest=gas.historical_bundle(old['revision'],old['scriptId'])
 if digest!=old['sourceDigest'] or logical(directory/'bundle')!=before:raise Stop('OLD_SOURCE_PROOF_FAILED')
 return directory,old,before

def plan_for(directory):
 directory,old,before=load_private(directory)
 revision=gas.revision()
 with tempfile.TemporaryDirectory() as tmp:
  build(old['scriptId'],revision,Path(tmp)/'target');after=logical(Path(tmp)/'target')
 if before.get('appsscript')!=after.get('appsscript'):raise Stop('AUTH_MANIFEST_CHANGED_STOP')
 changed={k for k in set(before)|set(after) if before.get(k)!=after.get(k)}
 if changed-{'Security','StagingBridge'}:raise Stop('UNRELATED_GAS_CHANGE_STOP')
 if not changed:raise Stop('SOURCE_ALREADY_CURRENT')
 return directory,old,{'status':'PASS','phase':'LOCAL_SESSION_POLICY_PLAN','gasModules':sorted(changed),'serverIdleMinutes':60,'operatingIdleMinutes':5,'absoluteMinutes':480,'existingTokensNotUpgraded':True,'authScopesChanged':False,'deploymentAttempted':False}

def compatible_settings(before,after):
 def redact(value):
  value=copy.deepcopy(value)
  for binding in value.get('bindings',[]):
   if binding.get('name')=='MYINVEST_EXPECTED_METADATA':
    binding.pop('text',None);binding.pop('json',None)
  return value
 return worker.settings_equivalent(redact(before),redact(after))

def version_proof(details,version):
 if not isinstance(details,dict) or details.get('id')!=version:raise Stop('ACTIVE_VERSION_CODE_PROOF_REQUIRED')
 resources=copy.deepcopy(details.get('resources'))
 script=resources.get('script') if isinstance(resources,dict) else None
 if not isinstance(script,dict):raise Stop('ACTIVE_VERSION_CODE_PROOF_REQUIRED')
 etag=script.get('etag')
 if not isinstance(etag,str) or not 1<=len(etag)<=256 or any(ord(c)<32 for c in etag):raise Stop('ACTIVE_VERSION_CODE_PROOF_REQUIRED')
 if not isinstance(resources.get('script_runtime'),dict):raise Stop('ACTIVE_VERSION_CODE_PROOF_REQUIRED')
 bindings=resources.get('bindings')
 if not isinstance(bindings,list) or any(not isinstance(b,dict) or not isinstance(b.get('name'),str) for b in bindings):raise Stop('ACTIVE_VERSION_CODE_PROOF_REQUIRED')
 if len({b['name'] for b in bindings})!=len(bindings):raise Stop('ACTIVE_VERSION_CODE_PROOF_REQUIRED')
 selected=[b for b in bindings if b['name']=='MYINVEST_EXPECTED_METADATA']
 if len(selected)!=1 or selected[0].get('type')!='secret_text':raise Stop('METADATA_BINDING_REQUIRED')
 resources['bindings']=sorted([b for b in bindings if b['name']!='MYINVEST_EXPECTED_METADATA'],key=lambda b:b['name'])
 script.pop('last_deployed_from',None)
 return {'resources':resources,'cache_options':details.get('cache_options')}

def prepare(api,account,old,probe):
 if not re.fullmatch('[a-fA-F0-9]{32}',account):raise Stop('ACCOUNT_ID_INVALID')
 base='/accounts/'+account+'/workers/scripts/'+worker.NAME
 active=worker.active(api,base);settings=api('GET',base+'/settings');bindings=worker.verified_settings(settings)
 if api('GET','/accounts/'+account+'/workers/subdomain').get('subdomain')!='kocoro97':raise Stop('EXISTING_SUBDOMAIN_MISMATCH')
 if not any(b.get('name')=='MYINVEST_EXPECTED_METADATA' and b.get('type')=='secret_text' for b in bindings):raise Stop('METADATA_BINDING_REQUIRED')
 if worker.recent_versions(api,base)[0]['id']!=active['version']:raise Stop('LATEST_VERSION_NOT_ACTIVE')
 proof=version_proof(api('GET',base+'/versions/'+active['version']),active['version'])
 metadata=probe();edge.verify_metadata(metadata,old)
 return {'base':base,'patchBase':'/accounts/'+account+'/workers/workers/'+worker.NAME,'active':active,'settings':settings,'bindings':bindings,'codeProof':proof,'metadata':metadata}

def assert_current(api,checkpoint):
 base=checkpoint['base']
 if worker.active(api,base)!=checkpoint['active'] or not worker.settings_equivalent(checkpoint['settings'],api('GET',base+'/settings')) or worker.recent_versions(api,base)[0]['id']!=checkpoint['active']['version']:raise Stop('CONCURRENT_WORKER_CHANGE')
 assert_code(api,checkpoint,checkpoint['active']['version'])

def assert_code(api,checkpoint,version,code='CONCURRENT_WORKER_CODE_CHANGE'):
 if version_proof(api('GET',checkpoint['base']+'/versions/'+version),version)!=checkpoint['codeProof']:raise Stop(code)

def bind(api,checkpoint,plan,save=lambda:None):
 assert_current(api,checkpoint);base=checkpoint['base'];settings=checkpoint['settings']
 body={'env':{'MYINVEST_EXPECTED_METADATA':{'type':'secret_text','text':json.dumps(edge.expected(plan),separators=(',',':'))}}}
 uploaded=api('PATCH',checkpoint['patchBase']+'/versions/latest',body,'application/merge-patch+json');candidate=uploaded.get('id','')
 if not worker.UUID.fullmatch(candidate):raise Stop('PENDING_CANDIDATE_STOP')
 checkpoint['candidate']=candidate;save()
 history=worker.recent_versions(api,base)
 if len(history)<2 or [x['id'] for x in history[:2]]!=[candidate,checkpoint['active']['version']] or worker.active(api,base)!=checkpoint['active'] or not worker.settings_equivalent(settings,api('GET',base+'/settings')):raise Stop('CONCURRENT_WORKER_CHANGE')
 assert_code(api,checkpoint,candidate,'CANDIDATE_WORKER_CODE_MISMATCH')
 api('POST',base+'/deployments',{'strategy':'percentage','versions':[{'version_id':candidate,'percentage':100}]})
 checkpoint['activated']=worker.active(api,base);save()
 if checkpoint['activated']['version']!=candidate or not compatible_settings(settings,api('GET',base+'/settings')):raise Stop('CONCURRENT_WORKER_CHANGE')

def restore_worker(api,checkpoint):
 base=checkpoint['base'];current=worker.active(api,base)
 if current['version']==checkpoint.get('candidate'):
  if checkpoint.get('activated')!=current or not compatible_settings(checkpoint['settings'],api('GET',base+'/settings')):raise Stop('CONCURRENT_WORKER_CHANGE')
  api('POST',base+'/deployments',{'strategy':'percentage','versions':[{'version_id':checkpoint['active']['version'],'percentage':100}]})
 elif current!=checkpoint['active']:raise Stop('CONCURRENT_WORKER_CHANGE')
 if worker.active(api,base)['version']!=checkpoint['active']['version'] or not worker.settings_equivalent(checkpoint['settings'],api('GET',base+'/settings')):raise Stop('ROLLBACK_READBACK_FAILED')
 assert_code(api,checkpoint,checkpoint['active']['version'])

def restore_gas(directory,old):
 current=json.loads((directory/'fresh-plan.json').read_text());bundle=directory/'bundle';original=directory/('upgrade-'+gas.revision()[:12])/'original'
 expected,digest=gas.historical_bundle(old['revision'],old['scriptId'])
 if logical(original)!=expected or digest!=old['sourceDigest']:raise Stop('ROLLBACK_PROOF_FAILED')
 with tempfile.TemporaryDirectory() as tmp:
  if pull(gas.upgrade_clasp,Path(tmp)/'head',old['scriptId'])!=logical(bundle) or gas.deployment(gas.upgrade_clasp,bundle,old)['versionNumber']!=current['activeVersion']:raise Stop('CONCURRENT_GAS_CHANGE_STOP')
  gas.upgrade_clasp(['update-deployment',old['url'].split('/')[-2],'--versionNumber',str(old['activeVersion']),'--description','Restore previous isolated session policy'],bundle,old['scriptId'])
  gas.upgrade_clasp(['push','--force'],original,old['scriptId'])
  if pull(gas.upgrade_clasp,Path(tmp)/'restored',old['scriptId'])!=expected:raise Stop('ROLLBACK_READBACK_FAILED')
 failed=directory/('upgrade-'+gas.revision()[:12])/'session-failed-bundle'
 if failed.exists():raise Stop('ROLLBACK_PROOF_FAILED')
 bundle.rename(failed);shutil.copytree(original,bundle)
 if json.loads((directory/'fresh-plan.json').read_text())!=current:raise Stop('CONCURRENT_GAS_CHANGE_STOP')
 restored=directory/('upgrade-'+gas.revision()[:12])/'session-restored-plan.json'
 worker.private_checkpoint(restored,old);restored.replace(directory/'fresh-plan.json')
 gas.check_metadata(WebApp(old['url']).call('appVersion'),old)

def policy_verified(data,plan):
 edge.verify_metadata(data,plan)
 if data.get('developmentSessionPolicyVersion')!=1 or data.get('sessionIdleMs')!=3600000 or data.get('sessionAbsoluteMs')!=28800000:raise Stop('SESSION_POLICY_READBACK_FAILED')

def transaction(upgrade,bind_relay,verify,restore):
 changed=False
 try:
  step=upgrade()
  if step.get('status')!='PASS':return {'status':'FAIL','phase':'ISOLATED_GAS','recovery':step.get('recovery','OWNER_REVIEW_REQUIRED')}
  changed=True;bind_relay();verify();return {'status':'PASS','phase':'ISOLATED_SESSION_HOUR_ACTIVE','recovery':'NOT_NEEDED','metadataBindingUpdates':1}
 except Exception as error:
  if not changed:return {'status':'NOT_RUN','phase':'ISOLATED_GAS',**safe_error(error)}
  try:restore();recovery='PASS_PREVIOUS_CONNECTION_RESTORED'
  except Exception:recovery='OWNER_REVIEW_REQUIRED'
  return {'status':'FAIL','phase':'SESSION_ACTIVATION',**safe_error(error),'recovery':recovery}

def apply(directory,old,account,token):
 attempted=False
 api=worker.api_client(token);probe=lambda:edge.public_request(worker.ENDPOINT,{'action':'appVersion'})
 checkpoint=prepare(api,account,old,probe)
 gas.check_metadata(WebApp(old['url']).call('appVersion'),old)
 save=directory/('session-activation-'+gas.revision()[:12]+'.json')
 if save.exists():raise Stop('CHECKPOINT_EXISTS')
 worker.private_checkpoint(save,{k:v for k,v in checkpoint.items() if k!='code'})
 def save_phase():
  phase='active' if 'activated' in checkpoint else 'uploaded'
  path=save.with_name(save.stem+'-'+phase+'.json')
  worker.private_checkpoint(path,{k:v for k,v in checkpoint.items() if k!='code'})
 def upgrade():
  nonlocal attempted
  assert_current(api,checkpoint)
  attempted=True
  return gas.upgrade(directory)
 def binding():
  current=json.loads((directory/'fresh-plan.json').read_text());bind(api,checkpoint,current,save_phase)
 def verify():
  current=json.loads((directory/'fresh-plan.json').read_text())
  for attempt in range(6):
   try:
    if worker.active(api,checkpoint['base'])!=checkpoint['activated']:raise Stop('CONCURRENT_WORKER_CHANGE')
    assert_code(api,checkpoint,checkpoint['candidate'],'CANDIDATE_WORKER_CODE_MISMATCH')
    data=probe();policy_verified(data,current)
    for name in worker.CAPABILITIES:
     if name!='sourceDigest' and data.get(name)!=checkpoint['metadata'].get(name):raise Stop('SESSION_POLICY_READBACK_FAILED')
    if worker.active(api,checkpoint['base'])!=checkpoint['activated'] or not compatible_settings(checkpoint['settings'],api('GET',checkpoint['base']+'/settings')):raise Stop('CONCURRENT_WORKER_CHANGE')
    return
   except Exception:
    if attempt==5:raise
    time.sleep(2)
 def restore():
  restore_worker(api,checkpoint);restore_gas(directory,old);edge.verify_metadata(probe(),old)
 result={**transaction(upgrade,binding,verify,restore),'deploymentAttempted':attempted,'workerCodeVerification':'PROVIDER_SCRIPT_ETAG_AND_RUNTIME'}
 if result['status']=='PASS':result['workerCodePreserved']=True
 return result

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);mode=p.add_mutually_exclusive_group();mode.add_argument('--apply',action='store_true');mode.add_argument('--inspect',action='store_true',help='Read only existing GAS/relay policy metadata; no login or Cloudflare credential');p.add_argument('--account-id');args=p.parse_args()
 report={'nhCalls':0,'accountCalls':0,'orderCalls':0,'storeWrites':False,'credentialsIncluded':False,'productionChanged':False,'newProject':False,'authScopesChanged':False,'ownerAuthenticatedFlow':'NOT_RUN'}
 try:
  if args.inspect:
   directory,old,_=load_private(args.environment)
   gas.check_metadata(WebApp(old['url']).call('appVersion'),old)
   policy_verified(edge.public_request(worker.ENDPOINT,{'action':'appVersion'}),old)
   report.update(status='PASS',phase='SESSION_POLICY_READ_ONLY_VERIFIED',serverIdleMinutes=60,absoluteMinutes=480,ownerSessionTest='NOT_RUN')
   print(json.dumps(report));return 0
  directory,old,plan=plan_for(args.environment);report.update(plan)
  if args.apply:
   account=args.account_id or os.environ.get('CLOUDFLARE_ACCOUNT_ID')
   config=directory/'persistent-worker/wrangler.json'
   if not account and config.is_file():account=json.loads(config.read_text()).get('account_id')
   account=account or input('Existing Cloudflare account ID: ').strip()
   token=edge.clean_token(os.environ.get('CLOUDFLARE_API_TOKEN') or getpass.getpass('Existing Cloudflare API token (hidden): '))
   report.update(apply(directory,old,account,token))
 except Exception as error:report.update(status='NOT_RUN',**safe_error(error))
 print(json.dumps(report));return 0 if report['status']=='PASS' else 2
if __name__=='__main__':raise SystemExit(main())
