"""Review/apply the existing isolated futures modules and existing Worker together.
Default is a LOCAL plan only. --apply requires the existing owner Google/Cloudflare
credentials. No project creation, NH call, account/store operation or scope change.
"""
import argparse,getpass,json,os,re,shutil,tempfile,time
from pathlib import Path
from types import SimpleNamespace
import nh_v2_upgrade as gas
import nh_v2_persistent as edge
from nh_v2_fresh import private_path,target,pull,logical
from build_nh_staging import build,source_digest,ROOT
from nh_staging_test import WebApp

class Stop(Exception):pass
SAFE_CODES={'OLD_SOURCE_PROOF_FAILED','AUTH_MANIFEST_CHANGED_STOP','UNRELATED_GAS_CHANGE_STOP','EXISTING_CLOUDFLARE_ACCOUNT_ID_REQUIRED','EXISTING_WORKER_REQUIRED','EXISTING_WORKERS_SUBDOMAIN_REQUIRED','EXISTING_CLOUDFLARE_ACCESS_REQUIRED','PERSISTENT_WORKER_COMMAND_FAILED','PERSISTENT_PUBLIC_PROBE_FAILED','PERSISTENT_TARGET_NOT_VERIFIED','ISOLATED_GAS_DEPLOYMENT_NOT_VERIFIED','CAPABILITIES_NOT_VERIFIED','CONCURRENT_GAS_CHANGE_STOP','ROLLBACK_PROOF_FAILED','ROLLBACK_READBACK_FAILED'}
def safe_error(error):
 code=str(error);out={'code':code if code in SAFE_CODES else 'OWNER_FUTURES_ACTIVATION_PREFLIGHT_FAILED'}
 diagnostic=getattr(error,'diagnostic',{})
 if isinstance(diagnostic,dict):
  http=diagnostic.get('http')
  if isinstance(http,int) and 100<=http<=599:out['http']=http
  codes=diagnostic.get('providerCodes')
  if isinstance(codes,list):out['providerCodes']=[c for c in codes[:10] if type(c) is int and 0<=c<=99999999]
  stage=diagnostic.get('stage')
  if stage in {'WORKERS_SUBDOMAIN','WORKER_SETTINGS','PUBLIC_RELAY','WORKER_BUILD','WORKER_UPLOAD','SECRET_BINDINGS','WORKER_CLI'}:out['stage']=stage
 return out

def plan_for(directory):
 directory=private_path(directory,False);old=json.loads((directory/'fresh-plan.json').read_text());target(old['scriptId']);before,digest=gas.historical_bundle(old['revision'],old['scriptId'])
 if digest!=old['sourceDigest'] or logical(directory/'bundle')!=before:raise Stop('OLD_SOURCE_PROOF_FAILED')
 revision=gas.revision()
 with tempfile.TemporaryDirectory() as tmp:
  build(old['scriptId'],revision,Path(tmp)/'target');after=logical(Path(tmp)/'target')
 if before.get('appsscript')!=after.get('appsscript'):raise Stop('AUTH_MANIFEST_CHANGED_STOP')
 changed=sorted(k for k in set(before)|set(after) if before.get(k)!=after.get(k));allowed={'Nhplug','NhGatewayV2','StagingBridge'}
 if set(changed)-allowed:raise Stop('UNRELATED_GAS_CHANGE_STOP')
 return directory,old,{'status':'PASS','mode':'LOCAL_FUTURES_CONNECTION_PLAN','gasModules':[x for x in changed if x!='StagingBridge'],'metadataUpdate':'StagingBridge' in changed,'authManifestUnchanged':True,'newProject':False,'newAuthentication':False,'nhCalls':0,'accountCalls':0,'orderCalls':0,'storeWrites':False,'credentialsIncluded':False}

def coordinated(upgrade,deploy,restore,verify,prepare=lambda:None):
 changed=False;stage='WORKER_PREPARE'
 try:
  prepare();stage='ISOLATED_GAS';step=upgrade()
  if step.get('status')!='PASS':return {'status':'FAIL','phase':'ISOLATED_GAS','recovery':step.get('recovery','NOT_NEEDED')}
  changed=step.get('changed',True);stage='BINDING_UPDATE';deploy();stage='PUBLIC_READBACK';verify();return {'status':'PASS','phase':'ISOLATED_FUTURES_CONNECTION_READY','recovery':'NOT_NEEDED'}
 except Exception as error:
  failure={'status':'FAIL','phase':'CONNECTION_ACTIVATION','failureStage':stage,**safe_error(error)}
  if stage=='ISOLATED_GAS':return {**failure,'recovery':'UPGRADE_TOOL_RESULT_REQUIRED'}
  try:restore(changed);return {**failure,'recovery':'PASS_PREVIOUS_CONNECTION_RESTORED'}
  except Exception:return {**failure,'recovery':'OWNER_REVIEW_REQUIRED'}

def apply(directory,old,account,token,prepare_only=False):
 if not re.fullmatch('[a-f0-9]{32}',account):raise Stop('EXISTING_CLOUDFLARE_ACCOUNT_ID_REQUIRED')
 root='/accounts/'+account;settings=edge.cloud(root+'/workers/scripts/'+edge.NAME+'/settings',token)
 if not any(x.get('name')=='MYINVEST_ROLE' and x.get('text')==edge.ROLE for x in settings.get('bindings',[])):raise Stop('EXISTING_WORKER_REQUIRED')
 sub=edge.cloud(root+'/workers/subdomain',token).get('subdomain','')
 if not re.fullmatch('[a-z0-9][a-z0-9-]{0,62}',sub):raise Stop('EXISTING_WORKERS_SUBDOMAIN_REQUIRED')
 host=edge.NAME+'.'+sub+'.workers.dev';endpoint='https://'+host+'/api';previous=edge.public_request(endpoint,{'action':'appVersion'});edge.verify_metadata(previous,old);gas.check_metadata(WebApp(old['url']).call('appVersion'),old)
 # Build/validate the Worker before changing the active GAS version.
 runtime=dict(os.environ,CLOUDFLARE_API_TOKEN=token,CLOUDFLARE_ACCOUNT_ID=account,WRANGLER_SEND_METRICS='false',WRANGLER_LOG='error',WRANGLER_LOG_SANITIZE='true',CI='true')
 with tempfile.TemporaryDirectory(prefix='myinvest-worker-preflight-') as tmp:
  folder=Path(tmp);conf=json.loads((ROOT/'relay/worker/wrangler.json').read_text());conf['account_id']=account;conf['vars']={'MYINVEST_ROLE':edge.ROLE}
  for file in ['worker.mjs','policy.json']:shutil.copyfile(ROOT/'relay/worker'/file,folder/file)
  config=folder/'wrangler.json';config.write_text(json.dumps(conf));edge.run(['deploy','--config',str(config),'--dry-run'],folder,runtime)
 needed=old['sourceDigest']!=source_digest()
 def upgrade():
  if not needed:return {'status':'PASS','changed':False}
  return {**gas.upgrade(directory),'changed':True}
 def prepare_worker():
  # New Worker remains bound to the old, verified GAS until that path is proven.
  def old_proof(env,**kwargs):
   expected,digest=gas.historical_bundle(old['revision'],old['scriptId'])
   if logical(directory/'bundle')!=expected or digest!=old['sourceDigest']:raise Stop('OLD_SOURCE_PROOF_FAILED')
   gas.check_metadata(WebApp(old['url']).call('appVersion'),old)
  args=SimpleNamespace(environment=directory,account_id=account,free_plan_confirmed=True,public_futures=previous.get('developmentPublicFutures') is True,disable=False,diagnose_public=False,diagnose_cloudflare=False,prompt_token=False)
  edge.deploy(args,cf_token=token,preflight_fn=old_proof)
 def deploy():
  current=json.loads((directory/'fresh-plan.json').read_text());values=edge.secrets(current,host);values['MYINVEST_PUBLIC_FUTURES']='true';folder=directory/'persistent-worker';edge.run(['secret','bulk','--config',str(folder/'wrangler.json')],folder,runtime,json.dumps(values))
 def verify():
  current=json.loads((directory/'fresh-plan.json').read_text())
  for attempt in range(6):
   try:
    m=edge.public_request(endpoint,{'action':'appVersion'});edge.verify_metadata(m,current)
    if m.get('developmentPublicFutures') is not True or m.get('developmentIndustryMarket') is not True:raise Stop('CAPABILITIES_NOT_VERIFIED')
    return
   except Exception as error:
    transient=isinstance(error,edge.Stop) and (str(error)=='PERSISTENT_TARGET_NOT_VERIFIED' or error.diagnostic.get('http') in (502,503,504))
    if not transient or attempt==5:raise
    time.sleep(2)
 def restore(changed):
  current=json.loads((directory/'fresh-plan.json').read_text());bundle=directory/'bundle'
  if changed:
   original=directory/('upgrade-'+gas.revision()[:12])/'original';expected,digest=gas.historical_bundle(old['revision'],old['scriptId'])
   if logical(original)!=expected or digest!=old['sourceDigest']:raise Stop('ROLLBACK_PROOF_FAILED')
   with tempfile.TemporaryDirectory() as temp:
    if pull(gas.upgrade_clasp,Path(temp)/'head',old['scriptId'])!=logical(bundle) or gas.deployment(gas.upgrade_clasp,bundle,old)['versionNumber']!=current['activeVersion']:raise Stop('CONCURRENT_GAS_CHANGE_STOP')
    deployment=old['url'].split('/')[-2];gas.upgrade_clasp(['update-deployment',deployment,'--versionNumber',str(old['activeVersion']),'--description','Restore previous isolated futures connection'],bundle,old['scriptId'])
    gas.upgrade_clasp(['push','--force'],original,old['scriptId'])
    if pull(gas.upgrade_clasp,Path(temp)/'restored',old['scriptId'])!=expected:raise Stop('ROLLBACK_READBACK_FAILED')
   backup=directory/('upgrade-'+gas.revision()[:12])/'failed-current-bundle'
   if backup.exists():raise Stop('ROLLBACK_BACKUP_EXISTS')
   bundle.rename(backup);shutil.copytree(original,bundle);file=directory/'fresh-plan.json';file.write_text(json.dumps(old,indent=2));file.chmod(0o600)
  values=edge.secrets(old,host);values['MYINVEST_PUBLIC_FUTURES']='true' if previous.get('developmentPublicFutures') is True else 'false';folder=directory/'persistent-worker';edge.run(['secret','bulk','--config',str(folder/'wrangler.json')],folder,runtime,json.dumps(values))
  # Metadata is sufficient: never validate recovery with a balance or order call.
  for attempt in range(6):
   try:edge.verify_metadata(edge.public_request(endpoint,{'action':'appVersion'}),old);break
   except Exception:
    if attempt==5:raise
    time.sleep(2)
 if prepare_only:
  try:prepare_worker();out={'status':'PASS','phase':'WORKER_PREPARED_NO_GAS_CHANGE','gasCodeChanged':False}
  except Exception as error:
   out={'status':'FAIL','phase':'WORKER_PREPARE',**safe_error(error)}
   try:restore(False);out['recovery']='PASS_PREVIOUS_CONNECTION_RESTORED'
   except Exception:out['recovery']='OWNER_REVIEW_REQUIRED'
 else:out=coordinated(upgrade,deploy,restore,verify,prepare_worker)
 return {**out,'newProject':False,'authScopesChanged':False,'nhCalls':0,'accountCalls':0,'orderCalls':0,'storeWrites':False,'credentialsIncluded':False}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);p.add_argument('--apply',action='store_true');p.add_argument('--prepare-relay-only',action='store_true');p.add_argument('--free-plan-confirmed',action='store_true');a=p.parse_args()
 try:
  directory,old,report=plan_for(a.environment)
  if a.apply:
   if not a.free_plan_confirmed:raise Stop('EXISTING_FREE_PLAN_CONFIRMATION_REQUIRED')
   config=directory/'persistent-worker/wrangler.json';account=json.loads(config.read_text()).get('account_id') if config.exists() else None
   account=account or os.environ.get('CLOUDFLARE_ACCOUNT_ID') or input('Existing Cloudflare account ID: ').strip();token=edge.clean_token(os.environ.get('CLOUDFLARE_API_TOKEN') or getpass.getpass('Existing Cloudflare API token (hidden): '));report=apply(directory,old,account,token,a.prepare_relay_only)
 except Exception as error:report={'status':'NOT_RUN',**safe_error(error),'nhCalls':0,'accountCalls':0,'orderCalls':0,'storeWrites':False,'credentialsIncluded':False}
 print(json.dumps(report));return 0 if report.get('status')=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
