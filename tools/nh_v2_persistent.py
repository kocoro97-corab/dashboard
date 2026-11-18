"""Owner-run deployment to an EXISTING Cloudflare Free account. No GAS writes.
Cloudflare token and GAS configuration stay in memory/private owner environment.
"""
import argparse,getpass,json,os,re,shutil,subprocess,sys,socket,ssl,urllib.request,urllib.error
from pathlib import Path
from nh_v2_fresh import private_path,SAFE_OWNER_CODES
from nh_v2_live_check import preflight
from nh_v2_relay_check import deployment_settings
from nh_staging_test import fingerprint
from build_nh_staging import ROOT
NAME='myinvest-v2-dev-relay';ROLE='myinvest-isolated-relay-v1';WRANGLER='wrangler@4.60.0';ORIGIN='https://kocoro97-corab.github.io'
class Stop(Exception):
 def __init__(self,code,diagnostic=None):
  super().__init__(code);self.diagnostic=diagnostic or {}

def cloud_stage(path):
 return 'WORKERS_SUBDOMAIN' if path.endswith('/workers/subdomain') else 'WORKER_SETTINGS' if path.endswith('/settings') else 'CLOUDFLARE_API'

def provider_codes(data):
 if not isinstance(data,dict) or not isinstance(data.get('errors'),list):return []
 return [row['code'] for row in data['errors'][:10] if isinstance(row,dict) and type(row.get('code')) is int]

def clean_token(value):
 if not isinstance(value,str):raise Stop('CLOUDFLARE_TOKEN_FORMAT_REQUIRED')
 value=value.strip()
 if not value or len(value)>2048 or any(ord(c)<=32 or ord(c)>=127 for c in value) or value.startswith(('\"',"'")):
  raise Stop('CLOUDFLARE_TOKEN_FORMAT_REQUIRED')
 return value
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def cloud(path,token,optional=False):
 stage=cloud_stage(path)
 request=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,headers={'Authorization':'Bearer '+clean_token(token),'Accept':'application/json'})
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:
   status=response.status
   try:data=json.loads(response.read(65536))
   except (ValueError,UnicodeError):raise Stop('CLOUDFLARE_RESPONSE_INVALID',{'stage':stage,'http':status}) from None
 except urllib.error.HTTPError as error:
  status=error.code
  try:data=json.loads(error.read(16384))
  except (ValueError,UnicodeError):data={}
  finally:error.close()
  if optional and status==404:return None
  raise Stop('EXISTING_CLOUDFLARE_ACCESS_REQUIRED',{'stage':stage,'http':status,'providerCodes':provider_codes(data)}) from None
 except Stop:raise
 except Exception as error:
  reason=getattr(error,'reason',error)
  transport='DNS' if isinstance(reason,socket.gaierror) else 'TIMEOUT' if isinstance(reason,(TimeoutError,socket.timeout)) else 'TLS' if isinstance(reason,ssl.SSLError) else 'NETWORK'
  raise Stop('CLOUDFLARE_NETWORK_UNCONFIRMED',{'stage':stage,'transport':transport}) from None
 if not isinstance(data,dict) or data.get('success') is not True:raise Stop('EXISTING_CLOUDFLARE_ACCESS_REQUIRED',{'stage':stage,'http':status,'providerCodes':provider_codes(data)})
 return data.get('result')


def run(args,folder,env,secret=None):
 result=subprocess.run(['npx','--yes',WRANGLER,*args],cwd=folder,env=env,input=secret,text=True,capture_output=True,timeout=240)
 if result.returncode:raise Stop('PERSISTENT_WORKER_COMMAND_FAILED')
 return result.stdout

PUBLIC_CODES=frozenset(['RELAY_ACCESS_CLOSED','RELAY_CONFIG_INVALID','RELAY_ISOLATION_REQUIRED','RELAY_PATH_DENIED','RELAY_ORIGIN_DENIED','DEV_PAGE_REQUIRED','RELAY_RATE_LIMIT','RELAY_BUSY','RELAY_GAS_ACCESS_REQUIRED','RELAY_REDIRECT_DENIED','RELAY_UPSTREAM_HTTP','RELAY_UPSTREAM_NETWORK','RELAY_NON_JSON','RELAY_RESPONSE_INVALID','RELAY_RESPONSE_TOO_LARGE','RELAY_TARGET_MISMATCH','RELAY_BAD_RESPONSE','RELAY_SCOPE_BLOCKED'])
def public_diagnostic(response,data=None):
 diagnostic={'stage':'PUBLIC_RELAY','http':response.status if hasattr(response,'status') else response.code,'contentType':'JSON' if response.headers.get_content_type()=='application/json' else 'OTHER','allowOrigin':'EXPECTED' if response.headers.get('Access-Control-Allow-Origin')==ORIGIN else 'MISSING_OR_OTHER','redirectBlocked':300<=response.code<400 if isinstance(response,urllib.error.HTTPError) else False}
 if isinstance(data,dict) and isinstance(data.get('code'),str) and data['code'] in PUBLIC_CODES:diagnostic['relayCode']=data['code']
 return diagnostic

def public_request(endpoint,body,token=None):
 # Exercise the browser-facing edge with a browser User-Agent. The default
 # Python agent can receive Cloudflare 1010 before the Worker executes.
 # This adds no authentication; Origin, GAS isolation and session checks remain.
 headers={'Origin':ORIGIN,'Content-Type':'application/json','X-MyInvest-Dev-Client':'dashboard-v2-dev','User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'}
 if token:headers['Authorization']='Bearer '+token
 request=urllib.request.Request(endpoint,data=json.dumps(body).encode(),headers=headers,method='POST')
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=130) as response:
   diagnostic=public_diagnostic(response)
   raw=response.read(2*1024*1024+1)
   if len(raw)>2*1024*1024:raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED',dict(diagnostic,reason='RESPONSE_SIZE'))
   try:data=json.loads(raw)
   except (ValueError,UnicodeError):raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED',dict(diagnostic,reason='INVALID_JSON')) from None
   diagnostic=public_diagnostic(response,data)
   if response.status!=200 or diagnostic['contentType']!='JSON' or diagnostic['allowOrigin']!='EXPECTED' or not isinstance(data,dict) or data.get('success') is not True:raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED',diagnostic)
 except urllib.error.HTTPError as error:
  try:
   try:data=json.loads(error.read(16384))
   except (ValueError,UnicodeError):data=None
   diagnostic=public_diagnostic(error,data)
  finally:error.close()
  raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED',diagnostic) from None
 except Stop:raise
 except Exception as error:
  reason=getattr(error,'reason',error)
  transport='DNS' if isinstance(reason,socket.gaierror) else 'TIMEOUT' if isinstance(reason,(TimeoutError,socket.timeout)) else 'TLS' if isinstance(reason,ssl.SSLError) else 'NETWORK'
  raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED',{'stage':'PUBLIC_RELAY','transport':transport}) from None
 return data

def expected(plan):return {'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':fingerprint(plan['scriptId']),'sheetHash':plan['sheetHash'],'sourceDigest':plan['sourceDigest'],'gatewayVersion':2,'storeEngine':'account-store-v2'}

def secrets(plan,host):return {'MYINVEST_GAS_URL':plan['url'],'MYINVEST_EXPECTED_METADATA':json.dumps(expected(plan),separators=(',',':')),'MYINVEST_PUBLIC_HOST':host,'MYINVEST_PUBLIC_MARKET':'true','MYINVEST_ACCOUNT_READS':'true','MYINVEST_EXTERNAL_STORE':'true','MYINVEST_ENABLED':'true'}

def verify_metadata(metadata,plan):
 if any(metadata.get(k)!=v for k,v in expected(plan).items()) or metadata.get('relayProfile')!='persistent' or metadata.get('developmentAccountReads') is not True or metadata.get('developmentPublicMarket') is not True or metadata.get('developmentExternalStore') is not True:raise Stop('PERSISTENT_TARGET_NOT_VERIFIED')

def deploy(args,api=cloud,runner=run,preflight_fn=preflight,settings_fn=deployment_settings,probe=public_request,cf_token=None):
 if not re.fullmatch(r'[a-f0-9]{32}',args.account_id or ''):raise Stop('EXISTING_CLOUDFLARE_ACCOUNT_ID_REQUIRED')
 public_only=getattr(args,'diagnose_public',False)
 diagnose=getattr(args,'diagnose_cloudflare',False) or public_only
 if not args.free_plan_confirmed and not args.disable and not diagnose:raise Stop('EXISTING_FREE_PLAN_CONFIRMATION_REQUIRED')
 if not diagnose and not shutil.which('npx'):raise Stop('OWNER_NODE_NPX_REQUIRED')
 if not diagnose:
  env_dir=private_path(args.environment,False);folder=env_dir/'persistent-worker';folder.mkdir(mode=0o700,exist_ok=True)
 token_source='PARAMETER' if cf_token else 'PROMPT' if getattr(args,'prompt_token',False) or not os.environ.get('CLOUDFLARE_API_TOKEN') else 'ENVIRONMENT'
 token=clean_token(cf_token or (None if getattr(args,'prompt_token',False) else os.environ.get('CLOUDFLARE_API_TOKEN')) or getpass.getpass('Cloudflare API token value (hidden): '))
 root='/accounts/'+args.account_id
 try:subdomain=api(root+'/workers/subdomain',token)
 except Stop as error:
  error.diagnostic={**error.diagnostic,'tokenSource':token_source};raise
 if not isinstance(subdomain,dict) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}',subdomain.get('subdomain','')):raise Stop('EXISTING_WORKERS_SUBDOMAIN_REQUIRED',{'stage':'WORKERS_SUBDOMAIN','accountReadAccess':'PASS','subdomainConfigured':False,'tokenSource':token_source})
 host=NAME+'.'+subdomain['subdomain']+'.workers.dev';endpoint='https://'+host+'/api'
 try:settings=api(root+'/workers/scripts/'+NAME+'/settings',token,optional=True)
 except Stop as error:
  error.diagnostic={**error.diagnostic,'tokenSource':token_source};raise
 if settings is not None and not any(x.get('name')=='MYINVEST_ROLE' and x.get('text')==ROLE for x in settings.get('bindings',[])):raise Stop('EXISTING_WORKER_NAME_CONFLICT')
 if public_only:
  if settings is None:raise Stop('EXISTING_WORKER_REQUIRED')
  env_dir=private_path(args.environment,False)
  plan=json.loads((env_dir/'fresh-plan.json').read_text())
  metadata=probe(endpoint,{'action':'appVersion'})
  verify_metadata(metadata,plan)
  return {'status':'PASS','scope':'PERSISTENT_PUBLIC_READ_ONLY','endpoint':endpoint,'isolation':'PASS','deploymentAttempted':False,'actualNhCalls':0,'orderCalls':0,'accountStoreWrites':False,'credentialsIncluded':False}
 if diagnose:return {'status':'PASS','scope':'CLOUDFLARE_READ_ACCESS_ONLY','tokenSource':token_source,'subdomainConfigured':True,'workerExists':settings is not None,'writePermission':'NOT_RUN','deploymentAttempted':False,'gasAccess':'NOT_RUN','credentialsIncluded':False,'orderCalls':0}
 if args.disable and settings is None:raise Stop('EXISTING_WORKER_REQUIRED')
 if not args.disable:
  preflight_fn(env_dir,allow_same_source_tools=True)
  plan=json.loads((env_dir/'fresh-plan.json').read_text())
  verified=settings_fn(plan)
  if not (verified.get('status')=='PASS' and verified.get('executeAs')=='USER_DEPLOYING' and verified.get('access')=='ANYONE_ANONYMOUS' and verified.get('versionMatches') is True):raise Stop('ISOLATED_GAS_DEPLOYMENT_NOT_VERIFIED')
  values=secrets(plan,host);values['MYINVEST_PUBLIC_FUTURES']='true' if getattr(args,'public_futures',False) else 'false'
 else:values={'MYINVEST_ENABLED':'false'}
 config=json.loads((ROOT/'relay/worker/wrangler.json').read_text());config['account_id']=args.account_id;config['vars']={'MYINVEST_ROLE':ROLE}
 for name in ['worker.mjs','policy.json']:shutil.copyfile(ROOT/'relay/worker'/name,folder/name)
 config_path=folder/'wrangler.json';config_path.write_text(json.dumps(config));config_path.chmod(0o600)
 runtime=dict(os.environ,CLOUDFLARE_API_TOKEN=token,CLOUDFLARE_ACCOUNT_ID=args.account_id,WRANGLER_SEND_METRICS='false',WRANGLER_LOG='error',WRANGLER_LOG_SANITIZE='true',CI='true')
 if not args.disable:
  # New resource starts closed; configuration()/enabled blocks all upstream access.
  runner(['deploy','--config',str(config_path),'--dry-run'],folder,runtime)
  runner(['deploy','--config',str(config_path)],folder,runtime)
 # Secrets go through stdin only. Never write a dotenv/JSON secret file or print CLI output.
 runner(['secret','bulk','--config',str(config_path)],folder,runtime,json.dumps(values))
 if args.disable:return {'status':'PASS','code':'PERSISTENT_ACCESS_CLOSED','endpoint':endpoint,'orderCalls':0,'gasWrites':False}
 metadata=probe(endpoint,{'action':'appVersion'})
 verify_metadata(metadata,plan)
 public={'profile':'isolated-persistent','endpoint':endpoint};(folder/'public-activation.json').write_text(json.dumps(public));(folder/'public-activation.json').chmod(0o600)
 return {'status':'PASS','scope':'PERSISTENT_RELAY_READY','endpoint':endpoint,'page':'https://kocoro97-corab.github.io/dashboard-v2-dev/','isolation':'PASS','publicMarket':True,'accountReads':True,'reviewedStore':True,'developmentCodeRequired':False,'pageActivation':'PENDING_VERIFIED_ENDPOINT_BINDING','actualNhCalls':0,'orderCalls':0,'credentialsIncluded':False}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);p.add_argument('--account-id',help='Existing Cloudflare account ID; otherwise read from owner environment or prompt');p.add_argument('--free-plan-confirmed',action='store_true',help='Owner confirms an existing Workers Free account; no paid plan or account is created');p.add_argument('--public-futures',action='store_true',help='Enable only authenticated fixed A01/A06 futures quote reads on the existing isolated relay');p.add_argument('--disable',action='store_true',help='Close existing relay; no GAS operation');p.add_argument('--diagnose-cloudflare',action='store_true',help='Read-only API check: no deployment, Google or NH calls');p.add_argument('--diagnose-public',action='store_true',help='Inspect existing public relay metadata without deploying or querying NH');p.add_argument('--prompt-token',action='store_true',help='Use a fresh hidden prompt instead of any existing token environment variable');args=p.parse_args()
 try:
  if not args.account_id:args.account_id=os.environ.get('CLOUDFLARE_ACCOUNT_ID') or input('Cloudflare account ID (32 characters): ').strip()
  result=deploy(args)
 except EOFError:result={'status':'NOT_RUN','code':'OWNER_CLOUDFLARE_SETUP_REQUIRED','credentialsIncluded':False,'orderCalls':0}
 except KeyboardInterrupt:result={'status':'NOT_RUN','code':'OWNER_CANCELLED','credentialsIncluded':False}
 except Stop as error:
  result={'status':'NOT_RUN','code':str(error),'credentialsIncluded':False,'orderCalls':0}
  if error.diagnostic:result['diagnostic']=error.diagnostic
 except Exception as error:result={'status':'NOT_RUN','code':str(error) if str(error) in SAFE_OWNER_CODES else 'PERSISTENT_OWNER_PREFLIGHT_FAILED','credentialsIncluded':False,'orderCalls':0}
 print(json.dumps(result));return 0 if result.get('status')=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
