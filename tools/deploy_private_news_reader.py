"""Create only the approved private-news Worker. Never modifies primary Worker/GAS.
Owner Cloud Shell only. A new service-account key goes from RAM to Worker Secrets.
No plaintext key file, original report file, Pages deployment or folder ACL write.
"""
import argparse,base64,getpass,hashlib,json,os,re,secrets,subprocess,sys,time,urllib.error,urllib.parse,urllib.request,uuid
from pathlib import Path
import news_reader_owner_preflight as preflight
import calendar_owner_preflight as owner
import worker_code_only as worker
import nh_v2_upgrade as gas
from nh_v2_fresh import private_path,target,OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID
from nh_staging_test import WebApp,ApiFailure

ROOT=Path(__file__).resolve().parents[1]
HOST='myinvest-v2-private-original-preview.kocoro97.workers.dev'
ENDPOINT='https://'+HOST+'/api'
FOLDER_HASH='db18cd877473eb77afd569a89e219af45bc398c916b6212e15926c759fb9072b'
ROLE='myinvest-private-original-reader-v1'
class Stop(Exception):pass

def progress(value):print('[news] '+value,file=sys.stderr,flush=True)
def sha(value):return hashlib.sha256(value).hexdigest()
def folder_id(value):
    if value.startswith('https://drive.google.com/'):
        value=urllib.parse.urlsplit(value).path.rstrip('/').rsplit('/',1)[-1]
    if not re.fullmatch('[A-Za-z0-9_-]{20,128}',value) or sha(value.encode())!=FOLDER_HASH:raise Stop('APPROVED_ORIGINAL_FOLDER_REQUIRED')
    return value

def cloud_api(account,token):
    if not re.fullmatch('[a-fA-F0-9]{32}',account or ''):raise Stop('CLOUDFLARE_ACCOUNT_ID_INVALID')
    raw=worker.api_client(token);base='/accounts/'+account+'/workers/scripts/'+preflight.PREVIEW
    primary='/accounts/'+account+'/workers/scripts/'+worker.NAME
    def api(method,path,body=None,mime='application/json'):
        reads={base+x for x in ('/settings','/deployments','/versions','/content/v2')}
        reads|={primary+x for x in ('/settings','/secrets','/deployments','/versions')}
        reads.add('/accounts/'+account+'/workers/subdomain')
        if not (method=='GET' and path in reads or method=='PUT' and path==base or method=='POST' and path==base+'/subdomain'):raise Stop('PRIVATE_NEWS_SCOPE_DENIED')
        return raw(method,path,body,mime)
    return api,base

def absent(api,base):
    try:api('GET',base+'/settings')
    except worker.Stop as error:
        if error.http==404:return
        raise
    raise Stop('EXISTING_PRIVATE_WORKER_REVIEW_REQUIRED')

def google_api(token):
    prefix='https://iam.googleapis.com/v1/projects/'+preflight.PROJECT+'/serviceAccounts/'+preflight.READER+'/keys'
    def call(method,url,data=None):
        if not (method=='POST' and url==prefix or method=='DELETE' and url.startswith(prefix+'/') and re.fullmatch('[a-f0-9]{40}',url.rsplit('/',1)[-1])):raise Stop('GOOGLE_KEY_SCOPE_DENIED')
        req=urllib.request.Request(url,method=method,data=json.dumps(data).encode() if data else None,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'MYInvest-Private-News-Owner/1.0'})
        try:
            with urllib.request.build_opener(worker.NoRedirect()).open(req,timeout=35) as response:raw=response.read(65537)
        except urllib.error.HTTPError as error:raise Stop('GOOGLE_KEY_HTTP_'+str(error.code)) from None
        except Exception:raise Stop('GOOGLE_KEY_RESULT_UNCONFIRMED') from None
        if len(raw)>65536:raise Stop('GOOGLE_KEY_RESPONSE_INVALID')
        return json.loads(raw) if raw else {}
    return call,prefix

def access_token():
    child={k:v for k,v in os.environ.items() if not re.search('TOKEN|PASSWORD|SECRET|API_KEY',k,re.I)}
    r=subprocess.run(['gcloud','auth','print-access-token','--quiet'],capture_output=True,text=True,timeout=45,env=child)
    token=r.stdout.strip()
    if r.returncode or not token or re.search(r'\s',token):raise Stop('EXISTING_GOOGLE_OWNER_AUTH_REQUIRED')
    return token

def key_material(result):
    try:
        value=json.loads(base64.b64decode(result['privateKeyData'],validate=True))
        key_id=value['private_key_id'];pem=value['private_key']
        if value['type']!='service_account' or value['client_email']!=preflight.READER or value['project_id']!=preflight.PROJECT or not re.fullmatch('[a-f0-9]{40}',key_id) or not re.fullmatch(r'-----BEGIN PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]+\s+-----END PRIVATE KEY-----\s*',pem) or len(pem)>8192:raise ValueError()
        return key_id,pem
    except Exception:raise Stop('NEW_SERVICE_KEY_IDENTITY_INVALID') from None

def upload_body(metadata):
    boundary='myinvest-private-news-'+uuid.uuid4().hex;parts=[]
    files=[('metadata',None,'application/json',json.dumps(metadata).encode()),
      ('worker.mjs','worker.mjs','application/javascript+module',(ROOT/'relay/private-original/worker-dev.mjs').read_bytes()),
      ('drive-archive.mjs','drive-archive.mjs','application/javascript+module',(ROOT/'relay/private-original/drive-archive.mjs').read_bytes()),
      ('policy.json','policy.json','application/json',(ROOT/'relay/private-original/policy.json').read_bytes())]
    for name,filename,mime,raw in files:
        disposition='form-data; name="'+name+'"'+('; filename="'+filename+'"' if filename else '')
        parts.append(('--'+boundary+'\r\nContent-Disposition: '+disposition+'\r\nContent-Type: '+mime+'\r\n\r\n').encode()+raw+b'\r\n')
    return b''.join(parts)+('--'+boundary+'--\r\n').encode(),'multipart/form-data; boundary='+boundary

def metadata(plan,expected,user,pem,folder,marker):
    plain={'MYINVEST_ROLE':ROLE,'MYINVEST_ENABLED':'true','MYINVEST_PUBLIC_HOST':HOST,
      'MYINVEST_PUBLIC_MARKET':'false','MYINVEST_PUBLIC_FUTURES':'false','MYINVEST_ACCOUNT_READS':'false','MYINVEST_EXTERNAL_STORE':'false',
      'MYINVEST_PRIVATE_BRIEFINGS':'true','MYINVEST_PRIVATE_BRIEFING_PROVIDER':'dedicated-drive','MYINVEST_NEWS_AUTHORITY':'gas-login-owner-v1','MYINVEST_NEWS_DEPLOYMENT_MARKER':marker}
    secret={'MYINVEST_GAS_URL':plan['url'],'MYINVEST_EXPECTED_METADATA':json.dumps(expected,separators=(',',':')),
      'MYINVEST_NEWS_OWNER_USER':user,'MYINVEST_NEWS_READER_EMAIL':preflight.READER,'MYINVEST_NEWS_READER_PEM':pem,'MYINVEST_NEWS_FOLDER_ID':folder}
    return {'main_module':'worker.mjs','compatibility_date':'2026-11-01','observability':{'enabled':False},'logpush':False,
      'bindings':[{'name':k,'type':'plain_text','text':v} for k,v in plain.items()]+[{'name':k,'type':'secret_text','text':v} for k,v in secret.items()]+[{'name':'GATE','type':'durable_object_namespace','class_name':'RelayGate'}],
      'migrations':{'new_tag':'v1','new_sqlite_classes':['RelayGate']}}

def post(action,token=None,**values):
    headers={'Origin':owner.ORIGIN,'Content-Type':'application/json','X-MyInvest-Dev-Client':'dashboard-v2-dev','User-Agent':'MYInvest-Private-News-Owner/1.0'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(ENDPOINT,method='POST',headers=headers,data=json.dumps({'action':action,**values}).encode())
    try:
        with urllib.request.build_opener(worker.NoRedirect()).open(req,timeout=45) as response:status=response.status;raw=response.read(400001)
    except urllib.error.HTTPError as error:status=error.code;raw=error.read(4096)
    if len(raw)>400000:raise Stop('PRIVATE_RESPONSE_TOO_LARGE')
    try:return status,json.loads(raw)
    except ValueError:raise Stop('PRIVATE_RESPONSE_NOT_JSON') from None

def deploy(environment,account,cf_token,user,password,folder):
    progress('VERIFYING_EXISTING_GOOGLE_READER');gcp=preflight.google_snapshot()
    if gcp['existingUserManagedKeyCount']!=0:raise Stop('EXISTING_READER_KEYS_REQUIRE_REVIEW')
    if not re.fullmatch(r'[가-힣A-Za-z0-9][가-힣A-Za-z0-9_.@-]{1,63}',user or ''):raise Stop('EXISTING_OWNER_USER_REQUIRED')
    folder=folder_id(folder);env=private_path(environment,False);plan=json.loads((env/'fresh-plan.json').read_text())
    target(plan['scriptId'])
    deployment=re.fullmatch(r'https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec',plan.get('url',''))
    if not deployment or deployment[1] in (OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID):raise Stop('EXISTING_ISOLATED_GAS_TARGET_REQUIRED')
    api,base=cloud_api(account,cf_token)
    progress('VERIFYING_ORIGINAL_PRIMARY_AND_GAS')
    snapshot=owner.inspect(lambda p:api('GET',p),account,owner_dir=env)
    if not snapshot['ownerCheckoutVerified'] or not snapshot.get('ownerCheckoutInspection',{}).get('sourceRevisionMatches'):raise Stop('VERIFIED_EXISTING_OWNER_BUNDLE_REQUIRED')
    current=owner.public_probe();gas.check_metadata(current,plan)
    absent(api,base)
    primary='/accounts/'+account+'/workers/scripts/'+worker.NAME
    original_active=worker.active(api,primary);original_history=worker.recent_versions(api,primary)
    def primary_unchanged():
        if worker.active(api,primary)!=original_active or worker.recent_versions(api,primary)!=original_history:raise Stop('PRIMARY_CHANGED_STOP_NO_PRIMARY_WRITES')
    primary_unchanged()
    stamp=secrets.token_hex(16);key_id=None;key_attempted=False;worker_attempted=False;logged=None;key_client,key_url=google_api(access_token())
    fixed={'primaryWorkerWrites':0,'gasSourceWrites':0,'folderPermissionWrites':0,'originalFileWrites':0,'accountStoreWrites':False,'nhCalls':0,'accountCalls':0,'orderCalls':0,'credentialsIncluded':False}
    try:
        progress('VALIDATING_EXISTING_GAS_OWNER_LOGIN')
        web=WebApp(plan['url']);web.binding=plan['sheetHash'];gas.check_metadata(web.call('appVersion'),plan)
        login=web.call('login',user=user,**{'pass':password});web.token=login.get('token')
        try:
            if login.get('isAdmin') is not True or login.get('mustChangePassword') is not False or not re.fullmatch('[a-fA-F0-9]{64}',web.token or ''):raise Stop('EXISTING_APPROVED_OWNER_LOGIN_REQUIRED')
        finally:
            if web.token:web.call('logout')
        primary_unchanged();absent(api,base)
        progress('CREATING_ONE_KEY_IN_MEMORY')
        key_attempted=True
        key_id,pem=key_material(key_client('POST',key_url,{'privateKeyType':'TYPE_GOOGLE_CREDENTIALS_FILE','keyAlgorithm':'KEY_ALG_RSA_2048'}))
        expected={k:v for k,v in current.items() if k in ('freshTestEnvironment','testEnvironment','scriptHash','sheetHash','sourceDigest','revision','gatewayVersion','storeEngine','storeVersion')}
        config=metadata(plan,expected,user,pem,folder,stamp)
        primary_unchanged();absent(api,base)
        progress('CREATING_ONLY_PRIVATE_NEWS_WORKER')
        body,mime=upload_body(config);worker_attempted=True
        api('PUT',base,body,mime)
        settings=api('GET',base+'/settings');bindings={b['name']:b for b in settings.get('bindings',[])}
        if bindings.get('MYINVEST_NEWS_DEPLOYMENT_MARKER',{}).get('text')!=stamp or bindings.get('MYINVEST_ROLE',{}).get('text')!=ROLE:raise Stop('PRIVATE_WORKER_CREATION_UNCONFIRMED')
        if set(bindings)!={b['name'] for b in config['bindings']}:raise Stop('PRIVATE_BINDING_NAMES_UNCONFIRMED')
        for b in config['bindings']:
            if b['type']=='plain_text' and bindings[b['name']].get('text')!=b['text'] or b['type']=='secret_text' and bindings[b['name']].get('type')!='secret_text':raise Stop('PRIVATE_BINDING_TYPE_OR_VALUE_UNCONFIRMED')
        if bindings['GATE'].get('type')!='durable_object_namespace' or bindings['GATE'].get('class_name')!='RelayGate' or settings.get('observability',{}).get('enabled') is not False:raise Stop('PRIVATE_STORAGE_OR_NO_LOGGING_UNCONFIRMED')
        api('POST',base+'/subdomain',{'enabled':True,'previews_enabled':False})
        progress('VERIFYING_LIVE_PRIVATE_AUTH_AND_ORIGINAL')
        for attempt in range(6):
            try:
                status,info=post('appVersion')
                if status==200 and info.get('success') is True and info.get('developmentPrivateBriefingAuthority')=='gas-login-owner-v1' and info.get('scriptHash')==current['scriptHash'] and info.get('sourceDigest')==current['sourceDigest']:break
            except Exception:pass
            if attempt==5:raise Stop('PRIVATE_PUBLIC_ACTIVATION_UNCONFIRMED')
            time.sleep(3)
        status,anonymous=post('privateMorningBriefing',mode='date',date='2026-11-27')
        if status!=401 or anonymous.get('code')!='AUTH_REQUIRED':raise Stop('ANONYMOUS_ACCESS_BLOCK_UNCONFIRMED')
        status,login=post('login',user=user,**{'pass':password});logged=login.get('token')
        if status!=200 or login.get('success') is not True or not re.fullmatch('[a-fA-F0-9]{64}',logged or ''):raise Stop('PRIVATE_OWNER_LOGIN_UNCONFIRMED')
        status,data=post('privateMorningBriefing',logged,mode='date',date='2026-11-27');report=data.get('report',{})
        if status!=200 or data.get('success') is not True or data.get('cacheable') is not False or report.get('date')!='2026-11-27' or not isinstance(report.get('content'),str) or sha(report['content'].encode())!=report.get('contentSha256'):raise Stop('LIVE_ORIGINAL_RECEIPT_OR_HASH_UNCONFIRMED')
        digest=report['contentSha256'];size=len(report['content'].encode());del data,report
        status,logout=post('logout',logged)
        if status!=200 or logout.get('success') is not True:raise Stop('OWNER_LOGOUT_UNCONFIRMED')
        status,denied=post('privateMorningBriefing',logged,mode='date',date='2026-11-27')
        if status not in (200,401,403) or denied.get('success') is not False or denied.get('code') not in ('PRIVATE_BRIEFING_FORBIDDEN','AUTH_REQUIRED'):raise Stop('LOGOUT_ACCESS_BLOCK_UNCONFIRMED')
        logged=None;primary_unchanged()
        active=worker.active(api,base)
        return {**fixed,'status':'PASS','phase':'PRIVATE_READER_LIVE_API_VERIFIED','keyCreateCalls':1,'privateWorkerCreated':True,'workerVersion':active['version'],'sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'originalDate':'2026-11-27','originalBytes':size,'serverContentSha256':digest,'anonymousBlocked':True,'loggedOutBlocked':True,'generalMemberLiveTest':'NOT_RUN','browserOriginalDisplay':'NOT_RUN','nextScheduledSave':'NOT_RUN','primaryPendingVersionPreserved':snapshot['latestVersionIsActive'] is False,'keyFileWritten':False}
    except Exception as error:
        cleanup='KEY_CREATE_RESULT_REVIEW_REQUIRED' if key_attempted and key_id is None else 'NOT_NEEDED'
        if key_id:
            try:key_client('DELETE',key_url+'/'+key_id);cleanup='CREATED_KEY_REVOKED'
            except Exception:cleanup='CREATED_KEY_REVOCATION_UNCONFIRMED'
        code=str(error) if isinstance(error,Stop) else error.code if isinstance(error,(worker.Stop,owner.Stop,ApiFailure)) else 'PRIVATE_NEWS_SETUP_FAILED'
        return {**fixed,'status':'PARTIAL' if worker_attempted or key_attempted else 'NOT_RUN','code':code,'keyCreateCalls':int(key_attempted),'privateWorkerUploadAttempted':worker_attempted,'keyRecovery':cleanup,'keyFileWritten':False,'browserOriginalDisplay':'NOT_RUN',**({'http':error.http} if isinstance(error,(worker.Stop,owner.Stop,ApiFailure)) and error.http else {})}
    finally:
        if logged:
            try:post('logout',logged)
            except Exception:pass

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--owner-dir',type=Path,default=Path('/home/kocoro97/myinvest-v2-fresh-private-r2'));p.add_argument('--apply',action='store_true',required=True);a=p.parse_args()
    try:
        if not sys.stdin.isatty():raise Stop('HIDDEN_OWNER_TERMINAL_REQUIRED')
        account=getpass.getpass('Existing Cloudflare Account ID (hidden): ')
        cf_token=getpass.getpass('Existing Cloudflare API token (hidden): ')
        user=getpass.getpass('Existing MY INVEST owner ID (hidden, not Google): ')
        password=getpass.getpass('Existing MY INVEST password (hidden): ')
        folder=getpass.getpass('Approved archive folder URL or ID (hidden): ')
        result=deploy(a.owner_dir,account,cf_token,user,password,folder)
    except (Stop,worker.Stop,owner.Stop) as error:result={'status':'NOT_RUN','code':error.code if isinstance(error,(worker.Stop,owner.Stop)) else str(error),'credentialsIncluded':False,'nhCalls':0,'orderCalls':0}
    except (EOFError,KeyboardInterrupt):result={'status':'NOT_RUN','code':'OWNER_INPUT_INTERRUPTED','credentialsIncluded':False}
    except Exception:result={'status':'NOT_RUN','code':'PRIVATE_NEWS_OWNER_STEP_FAILED','credentialsIncluded':False}
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
