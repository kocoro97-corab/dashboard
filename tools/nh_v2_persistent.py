"""Owner-run deployment to an EXISTING Cloudflare Free account. No GAS writes.
Cloudflare token and GAS configuration stay in memory/private owner environment.
"""
import argparse,getpass,json,os,re,shutil,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
from nh_v2_fresh import private_path,SAFE_OWNER_CODES
from nh_v2_live_check import preflight
from nh_v2_relay_check import deployment_settings
from nh_staging_test import fingerprint
from build_nh_staging import ROOT
NAME='myinvest-v2-dev-relay';ROLE='myinvest-isolated-relay-v1';WRANGLER='wrangler@4.60.0';ORIGIN='https://kocoro97-corab.github.io'
class Stop(Exception):pass
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def cloud(path,token,optional=False):
 request=urllib.request.Request('https://api.cloudflare.com/client/v4'+path,headers={'Authorization':'Bearer '+token,'Accept':'application/json'})
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:data=json.load(response)
 except urllib.error.HTTPError as error:
  status=error.code;error.close()
  if optional and status==404:return None
  raise Stop('EXISTING_CLOUDFLARE_ACCESS_REQUIRED') from None
 except Exception:raise Stop('EXISTING_CLOUDFLARE_ACCESS_REQUIRED') from None
 if data.get('success') is not True:raise Stop('EXISTING_CLOUDFLARE_ACCESS_REQUIRED')
 return data.get('result')

def run(args,folder,env,secret=None):
 result=subprocess.run(['npx','--yes',WRANGLER,*args],cwd=folder,env=env,input=secret,text=True,capture_output=True,timeout=240)
 if result.returncode:raise Stop('PERSISTENT_WORKER_COMMAND_FAILED')
 return result.stdout

def public_request(endpoint,body,token=None):
 headers={'Origin':ORIGIN,'Content-Type':'application/json','X-MyInvest-Dev-Client':'dashboard-v2-dev'}
 if token:headers['Authorization']='Bearer '+token
 request=urllib.request.Request(endpoint,data=json.dumps(body).encode(),headers=headers,method='POST')
 try:
  with urllib.request.build_opener(NoRedirect()).open(request,timeout=130) as response:
   if response.status!=200 or response.headers.get_content_type()!='application/json':raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED')
   data=json.loads(response.read(2*1024*1024))
 except Exception:raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED') from None
 if not isinstance(data,dict) or data.get('success') is not True:raise Stop('PERSISTENT_PUBLIC_PROBE_FAILED')
 return data

def expected(plan):return {'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':fingerprint(plan['scriptId']),'sheetHash':plan['sheetHash'],'sourceDigest':plan['sourceDigest'],'gatewayVersion':2,'storeEngine':'account-store-v2'}

def secrets(plan,host):return {'MYINVEST_GAS_URL':plan['url'],'MYINVEST_EXPECTED_METADATA':json.dumps(expected(plan),separators=(',',':')),'MYINVEST_PUBLIC_HOST':host,'MYINVEST_PUBLIC_MARKET':'true','MYINVEST_ACCOUNT_READS':'true','MYINVEST_EXTERNAL_STORE':'true','MYINVEST_ENABLED':'true'}

def deploy(args,api=cloud,runner=run,preflight_fn=preflight,settings_fn=deployment_settings,probe=public_request,cf_token=None):
 if not re.fullmatch(r'[a-f0-9]{32}',args.account_id or ''):raise Stop('EXISTING_CLOUDFLARE_ACCOUNT_ID_REQUIRED')
 if not args.free_plan_confirmed and not args.disable:raise Stop('EXISTING_FREE_PLAN_CONFIRMATION_REQUIRED')
 if not shutil.which('npx'):raise Stop('OWNER_NODE_NPX_REQUIRED')
 env_dir=private_path(args.environment,False);folder=env_dir/'persistent-worker';folder.mkdir(mode=0o700,exist_ok=True)
 token=cf_token or os.environ.get('CLOUDFLARE_API_TOKEN') or getpass.getpass('Existing Cloudflare API token (hidden): ')
 if not token:raise Stop('EXISTING_CLOUDFLARE_ACCESS_REQUIRED')
 root='/accounts/'+args.account_id
 subdomain=api(root+'/workers/subdomain',token)
 if not isinstance(subdomain,dict) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}',subdomain.get('subdomain','')):raise Stop('EXISTING_WORKERS_SUBDOMAIN_REQUIRED')
 host=NAME+'.'+subdomain['subdomain']+'.workers.dev';endpoint='https://'+host+'/api'
 settings=api(root+'/workers/scripts/'+NAME+'/settings',token,optional=True)
 if settings is not None and not any(x.get('name')=='MYINVEST_ROLE' and x.get('text')==ROLE for x in settings.get('bindings',[])):raise Stop('EXISTING_WORKER_NAME_CONFLICT')
 if args.disable and settings is None:raise Stop('EXISTING_WORKER_REQUIRED')
 if not args.disable:
  preflight_fn(env_dir,allow_same_source_tools=True)
  plan=json.loads((env_dir/'fresh-plan.json').read_text())
  verified=settings_fn(plan)
  if not (verified.get('status')=='PASS' and verified.get('executeAs')=='USER_DEPLOYING' and verified.get('access')=='ANYONE_ANONYMOUS' and verified.get('versionMatches') is True):raise Stop('ISOLATED_GAS_DEPLOYMENT_NOT_VERIFIED')
  values=secrets(plan,host)
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
 if any(metadata.get(k)!=v for k,v in expected(plan).items()) or metadata.get('relayProfile')!='persistent' or metadata.get('developmentAccountReads') is not True or metadata.get('developmentPublicMarket') is not True or metadata.get('developmentExternalStore') is not True:raise Stop('PERSISTENT_TARGET_NOT_VERIFIED')
 public={'profile':'isolated-persistent','endpoint':endpoint};(folder/'public-activation.json').write_text(json.dumps(public));(folder/'public-activation.json').chmod(0o600)
 return {'status':'PASS','scope':'PERSISTENT_RELAY_READY','endpoint':endpoint,'page':'https://kocoro97-corab.github.io/dashboard-v2-dev/','isolation':'PASS','publicMarket':True,'accountReads':True,'reviewedStore':True,'developmentCodeRequired':False,'pageActivation':'PENDING_VERIFIED_ENDPOINT_BINDING','actualNhCalls':0,'orderCalls':0,'credentialsIncluded':False}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);p.add_argument('--account-id',required=True);p.add_argument('--free-plan-confirmed',action='store_true',help='Owner confirms an existing Workers Free account; no paid plan or account is created');p.add_argument('--disable',action='store_true',help='Close existing relay; no GAS operation');args=p.parse_args()
 try:result=deploy(args)
 except KeyboardInterrupt:result={'status':'NOT_RUN','code':'OWNER_CANCELLED','credentialsIncluded':False}
 except Stop as error:result={'status':'NOT_RUN','code':str(error),'credentialsIncluded':False,'orderCalls':0}
 except Exception as error:result={'status':'NOT_RUN','code':str(error) if str(error) in SAFE_OWNER_CODES else 'PERSISTENT_OWNER_PREFLIGHT_FAILED','credentialsIncluded':False,'orderCalls':0}
 print(json.dumps(result));return 0 if result.get('status')=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
