"""Create only the approved private-news Worker. Never modifies primary Worker/GAS.
Owner Cloud Shell only. A new service-account key goes from RAM to Worker Secrets.
No plaintext key file, original report file, Pages deployment or folder ACL write.
"""
import argparse,base64,getpass,hashlib,json,os,re,secrets,shutil,subprocess,sys,tempfile,time,urllib.error,urllib.parse,urllib.request,uuid
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
LOGGING_OFF={'observability':{'enabled':False},'logpush':False}
# Exact public package previously uploaded by the owner (source 0640f48). Not arbitrary history.
PREVIOUS_MODULE_HASHES={'worker.mjs':'d79e226b0cb752ba40614880cfada347eb8e732bf1550092bd52faceed775a13',
 'drive-archive.mjs':'81e8b418263532600614c6be61084a83dea3db6a3190acc3f1ca2429716972bd'}
class Stop(Exception):pass

class ReceiptFailure(Stop):
    def __init__(self,code,diagnostic):
        super().__init__(code);self.diagnostic=diagnostic

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
        reads={base+x for x in ('/settings','/script-settings','/deployments','/versions','/content/v2')}
        reads|={primary+x for x in ('/settings','/secrets','/deployments','/versions')}
        reads.add('/accounts/'+account+'/workers/subdomain')
        version_read=path.startswith(base+'/versions/') and worker.UUID.fullmatch(path.rsplit('/',1)[-1])
        logging_patch=method=='PATCH' and path==base+'/script-settings' and body==LOGGING_OFF
        if not (method=='GET' and (path in reads or version_read) or method=='PUT' and path==base or method=='POST' and path==base+'/subdomain' or logging_patch):raise Stop('PRIVATE_NEWS_SCOPE_DENIED')
        try:return raw(method,path,body,mime)
        except worker.Stop as error:
            if method=='PUT' and path==base:error.stage='PRIVATE_WORKER_UPLOAD'
            elif method=='POST' and path==base+'/subdomain':error.stage='PRIVATE_WORKER_SUBDOMAIN'
            raise
    return api,base

def absent(api,base):
    try:api('GET',base+'/settings')
    except worker.Stop as error:
        if error.http==404:return
        raise
    raise Stop('EXISTING_PRIVATE_WORKER_REVIEW_REQUIRED')

def logging_clear(settings):
    if not isinstance(settings,dict) or settings.get('logpush') is not False:return False
    obs=settings.get('observability')
    if obs is not None and (not isinstance(obs,dict) or obs.get('enabled') is not False):return False
    # Omission is accepted only after the explicit PATCH succeeds, never on inspection alone.
    return settings.get('tail_consumers') in (None,[])

def disable_logging(api,base):
    acknowledged=api('PATCH',base+'/script-settings',LOGGING_OFF)
    readback=api('GET',base+'/script-settings')
    combined=api('GET',base+'/settings')
    if not all(logging_clear(s) for s in (acknowledged,readback,combined)):
        raise Stop('EXPLICIT_PRIVATE_LOGGING_DISABLE_UNCONFIRMED')
    return {'explicitDisableAcknowledged':True,'readbackObservability':
        'ABSENT_AFTER_EXPLICIT_DISABLE' if readback.get('observability') is None else 'FALSE'}

def resume_snapshot(api,base,version):
    import inspect_private_news_worker as inspection
    if not isinstance(version,str) or not worker.UUID.fullmatch(version):raise Stop('EXPECTED_PRIVATE_VERSION_REQUIRED')
    active=worker.active(api,base);history=worker.recent_versions(api,base)
    if active['version']!=version or not history or history[0]['id']!=version:raise Stop('CONCURRENT_PRIVATE_CHANGE_STOP')
    settings=api('GET',base+'/settings');rows=settings.get('bindings',[])
    if not isinstance(rows,list) or any(not isinstance(b,dict) or not isinstance(b.get('name'),str) for b in rows):raise Stop('PRIVATE_BINDINGS_INVALID')
    bindings={b['name']:b for b in rows};stamp=bindings.get('MYINVEST_NEWS_DEPLOYMENT_MARKER',{}).get('text')
    if len(bindings)!=len(rows) or not re.fullmatch('[a-f0-9]{32}',stamp or ''):raise Stop('PRIVATE_DEPLOYMENT_MARKER_INVALID')
    expected=metadata({'url':''},{},'','','',stamp)['bindings']
    if set(bindings)!={b['name'] for b in expected}:raise Stop('PRIVATE_BINDINGS_CHANGED_STOP')
    for b in expected:
        actual=bindings[b['name']]
        if actual.get('type')!=b['type'] or b['type']=='plain_text' and actual.get('text')!=b['text']:raise Stop('PRIVATE_BINDINGS_CHANGED_STOP')
    gate=bindings['GATE'];resource=api('GET',base+'/versions/'+version).get('resources',{}).get('bindings',[])
    version_gate=next((b for b in resource if b.get('name')=='GATE'),{})
    if gate.get('class_name')!='RelayGate' or not gate.get('namespace_id') or gate.get('namespace_id')!=version_gate.get('namespace_id') or version_gate.get('class_name')!='RelayGate':raise Stop('PRIVATE_EXISTING_STORAGE_UNCONFIRMED')
    content=api('GET',base+'/content/v2')
    if not inspection.module_matches(content) and not inspection.module_matches(content,PREVIOUS_MODULE_HASHES):raise Stop('PRIVATE_CODE_CHANGED_STOP')
    if worker.active(api,base)!=active or worker.recent_versions(api,base)!=history:raise Stop('CONCURRENT_PRIVATE_CHANGE_STOP')
    return {'active':active,'history':history,'bindings':bindings,'stamp':stamp,'namespace':gate['namespace_id']}

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

def worker_modules():
    source=(ROOT/'relay/private-original/worker-dev.mjs').read_bytes().decode('utf-8')
    marker="import policy from './policy.json' with {type:'json'};"
    if source.count(marker)!=1:raise Stop('PRIVATE_MODULE_LAYOUT_REVIEW_REQUIRED')
    policy=json.loads((ROOT/'relay/private-original/policy.json').read_bytes())
    # The direct upload API accepts JSON metadata, not application/json modules.
    source=source.replace(marker,'const policy='+json.dumps(policy,ensure_ascii=False,separators=(',',':'))+';')
    return {'worker.mjs':source.encode('utf-8'),'drive-archive.mjs':(ROOT/'relay/private-original/drive-archive.mjs').read_bytes()}

def validate_package(modules):
    if not shutil.which('node'):raise Stop('LOCAL_NODE_REQUIRED_BEFORE_KEY_CREATION')
    child={k:v for k,v in os.environ.items() if not re.search('TOKEN|PASSWORD|SECRET|API_KEY',k,re.I)}
    with tempfile.TemporaryDirectory(prefix='myinvest-public-news-module-') as temporary:
        root=Path(temporary)
        for name,raw in modules.items():(root/name).write_bytes(raw)
        program='globalThis.fetch=()=>{throw Error("NETWORK_DISABLED")};const m=await import(process.argv[1]);if(typeof m.default.fetch!=="function"||typeof m.RelayGate!=="function")process.exit(1);const r=await m.default.fetch(new Request("https://example.invalid/api"),{});if(r.status!==503)process.exit(1)'
        try:r=subprocess.run(['node','--input-type=module','-e',program,(root/'worker.mjs').as_uri()],capture_output=True,timeout=20,env=child)
        except subprocess.TimeoutExpired:raise Stop('PRIVATE_PACKAGE_CHECK_TIMEOUT') from None
        except OSError:raise Stop('PRIVATE_PACKAGE_NODE_UNAVAILABLE') from None
        if r.returncode:raise Stop('PRIVATE_PACKAGE_CHECK_FAILED')

ARCHIVE_PROBE=r'''
import {createDedicatedDriveArchiveReader,createServiceAccountToken} from './relay/private-original/drive-archive.mjs';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16000)process.exit(2)}
const x=JSON.parse(input);input='';let stage='TOKEN',http=null;
const network=globalThis.fetch;
const fetcher=async(url,opts)=>{
 const u=new URL(url);
 if(u.href==='https://oauth2.googleapis.com/token'&&opts.method==='POST')stage='TOKEN';
 else if(u.origin==='https://www.googleapis.com'&&u.pathname==='/drive/v3/files'&&opts.method==='GET')stage='LIST';
 else if(u.origin==='https://www.googleapis.com'&&/^\/drive\/v3\/files\/[A-Za-z0-9_-]{20,128}$/.test(u.pathname)&&u.search==='?alt=media'&&opts.method==='GET')stage='MEDIA';
 else throw Error('scope');
 http=null;const r=await network(url,opts);http=r.status;return r;
};
const getToken=createServiceAccountToken({email:x.email,pem:x.pem,fetcher});
const read=createDedicatedDriveArchiveReader({folderId:x.folder,getToken,fetcher});
const data=await read({mode:'date',date:'2026-11-27'});
const safe=new Set(['PRIVATE_BRIEFING_NOT_FOUND','PRIVATE_BRIEFING_DUPLICATE_DATE','PRIVATE_BRIEFING_ARCHIVE_LIMIT','PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE','PRIVATE_BRIEFING_TOO_LARGE','PRIVATE_BRIEFING_READ_FAILED']);
let out={success:false,stage,http,code:safe.has(data.code)?data.code:'ARCHIVE_PROBE_FAILED'};
if(data.success===true&&typeof data.report?.content==='string'){
 const bytes=new TextEncoder().encode(data.report.content);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 out={success:hash===data.report.contentSha256,stage:'COMPLETE',http,code:hash===data.report.contentSha256?'ORIGINAL_VERIFIED':'HASH_MISMATCH',bytes:bytes.length,contentSha256:hash};
}
console.log(JSON.stringify(out));
'''

def archive_probe(pem,folder):
    """Exact existing reader; credentials enter Node only through its anonymous stdin pipe."""
    child={k:v for k,v in os.environ.items() if not re.search('TOKEN|PASSWORD|SECRET|API_KEY',k,re.I)}
    payload=json.dumps({'email':preflight.READER,'pem':pem,'folder':folder})
    for attempt in range(6):
        try:
            result=subprocess.run(['node','--input-type=module','-e',ARCHIVE_PROBE],cwd=ROOT,input=payload,text=True,capture_output=True,timeout=50,env=child)
            if result.returncode or len(result.stdout)>2048:raise ValueError()
            out=json.loads(result.stdout)
            if not isinstance(out,dict) or out.get('stage') not in ('TOKEN','LIST','MEDIA','COMPLETE') or type(out.get('success')) is not bool or out.get('http') is not None and (type(out['http']) is not int or not 100<=out['http']<=599):raise ValueError()
            if out.get('success'):
                if out.get('stage')!='COMPLETE' or not re.fullmatch('[a-f0-9]{64}',out.get('contentSha256','')) or type(out.get('bytes')) is not int or not 0<out['bytes']<=280000:raise ValueError()
                return {'success':True,'bytes':out['bytes'],'contentSha256':out['contentSha256']}
            safe={'PRIVATE_BRIEFING_NOT_FOUND','PRIVATE_BRIEFING_DUPLICATE_DATE','PRIVATE_BRIEFING_ARCHIVE_LIMIT','PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE','PRIVATE_BRIEFING_TOO_LARGE','PRIVATE_BRIEFING_READ_FAILED','ARCHIVE_PROBE_FAILED','HASH_MISMATCH'}
            diagnostic={'archiveStage':out['stage'],'archiveHttp':out['http'],'archiveCode':out.get('code') if out.get('code') in safe else 'OTHER_REDACTED','archiveAttempts':attempt+1}
        except Exception:raise ReceiptFailure('LOCAL_ARCHIVE_PROBE_UNCONFIRMED',{'archiveStage':'LOCAL_PROBE','archiveAttempts':attempt+1}) from None
        retry=out['stage']=='TOKEN' and (out.get('http') in (None,400,429) or out.get('http',0)>=500)
        if not retry or attempt==5:raise ReceiptFailure('DEDICATED_READER_ORIGINAL_UNCONFIRMED',diagnostic)
        delay=min(2**(attempt+1),30)
        progress('WAITING_FOR_GOOGLE_KEY_PROPAGATION_'+str(delay)+'S');time.sleep(delay)

def validate_receipt(status,data,original):
    data=data if isinstance(data,dict) else {};report=data.get('report');report=report if isinstance(report,dict) else {}
    content=report.get('content');digest=sha(content.encode()) if isinstance(content,str) else None
    safe={'PRIVATE_BRIEFING_FORBIDDEN','AUTH_REQUIRED','PRIVATE_BRIEFING_NOT_FOUND','PRIVATE_BRIEFING_DUPLICATE_DATE','PRIVATE_BRIEFING_ARCHIVE_LIMIT','PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE','PRIVATE_BRIEFING_TOO_LARGE','PRIVATE_BRIEFING_READ_FAILED','GAS_REJECTED','RELAY_BAD_RESPONSE','RELAY_RATE_LIMIT','RELAY_BUSY'}
    checks={'http':status,'responseSuccess':data.get('success') is True,'responseCode':data.get('code') if data.get('code') in safe else 'NONE_OR_REDACTED',
      'cacheDisabled':data.get('cacheable') is False,'dateMatches':report.get('date')=='2026-11-27','contentPresent':isinstance(content,str),
      'responseHashMatches':digest is not None and digest==report.get('contentSha256'),'sourceHashMatches':digest is not None and digest==original['contentSha256'],
      'sourceBytesMatch':isinstance(content,str) and len(content.encode())==original['bytes']}
    detail=data.get('archiveDiagnostic')
    if isinstance(detail,dict) and detail.get('stage') in ('TOKEN','KEY_IMPORT','TOKEN_SIGN','TOKEN_REQUEST','TOKEN_RESPONSE','LIST','MEDIA') and (detail.get('http') is None or type(detail['http']) is int and 100<=detail['http']<=599):
        checks.update(archiveStage=detail['stage'],archiveHttp=detail.get('http'))
    if status!=200 or not all(checks[k] for k in ('responseSuccess','cacheDisabled','dateMatches','contentPresent','responseHashMatches','sourceHashMatches','sourceBytesMatch')):
        raise ReceiptFailure('LIVE_ORIGINAL_RECEIPT_OR_HASH_UNCONFIRMED',checks)
    return digest,len(content.encode())

def wait_private_revision(current,stamp):
    for attempt in range(12):
        try:
            status,info=post('appVersion')
            if status==200 and info.get('success') is True and info.get('developmentPrivateBriefingAuthority')=='gas-login-owner-v1' and info.get('scriptHash')==current['scriptHash'] and info.get('sourceDigest')==current['sourceDigest'] and info.get('developmentPrivateBriefingRevision')==stamp:return
        except Exception:pass
        if attempt==11:raise Stop('PRIVATE_EXACT_REVISION_ACTIVATION_UNCONFIRMED')
        progress('WAITING_FOR_EXACT_PRIVATE_WORKER_REVISION');time.sleep(3)

def read_live_original(token,original):
    for attempt in range(6):
        status,data=post('privateMorningBriefing',token,mode='date',date='2026-11-27')
        try:return validate_receipt(status,data,original)
        except ReceiptFailure as error:
            detail=error.diagnostic;http=detail.get('archiveHttp')
            transient=detail.get('archiveStage') in ('TOKEN','TOKEN_REQUEST','TOKEN_RESPONSE') and (http is None or http in (400,429) or http>=500)
            if not transient or attempt==5:raise
            delay=min(2**(attempt+1),30)
            progress('WAITING_FOR_WORKER_GOOGLE_TOKEN_'+str(delay)+'S');time.sleep(delay)

def upload_body(metadata,modules=None):
    modules=worker_modules() if modules is None else modules
    boundary='myinvest-private-news-'+uuid.uuid4().hex;parts=[]
    files=[('metadata',None,'application/json',json.dumps(metadata).encode())]+[(name,name,'application/javascript+module',raw) for name,raw in modules.items()]
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

def deploy(environment,account,cf_token,user,password,folder,resume_version=None):
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
    if resume_version=='inspected-active':resume_version=worker.active(api,base)['version']
    resume=resume_snapshot(api,base,resume_version) if resume_version else None
    if not resume:absent(api,base)
    def private_unchanged():
        if resume:
            if resume_snapshot(api,base,resume_version)!=resume:raise Stop('CONCURRENT_PRIVATE_CHANGE_STOP')
        else:absent(api,base)
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
        primary_unchanged();private_unchanged()
        progress('CHECKING_PUBLIC_MODULE_PACKAGE_BEFORE_KEY_CREATION')
        modules=worker_modules();validate_package(modules)
        if resume:
            progress('EXPLICITLY_DISABLING_ONLY_PRIVATE_LOGGING')
            disable_logging(api,base);private_unchanged();primary_unchanged()
        progress('CREATING_ONE_KEY_IN_MEMORY')
        key_attempted=True
        key_id,pem=key_material(key_client('POST',key_url,{'privateKeyType':'TYPE_GOOGLE_CREDENTIALS_FILE','keyAlgorithm':'KEY_ALG_RSA_2048'}))
        progress('VERIFYING_DEDICATED_READER_TOKEN_AND_ORIGINAL_BEFORE_UPLOAD')
        original=archive_probe(pem,folder)
        expected={k:v for k,v in current.items() if k in ('freshTestEnvironment','testEnvironment','scriptHash','sheetHash','sourceDigest','revision','gatewayVersion','storeEngine','storeVersion')}
        config=metadata(plan,expected,user,pem,folder,stamp)
        if resume:config.pop('migrations')
        primary_unchanged();private_unchanged()
        progress('RESUMING_ONLY_VERIFIED_PRIVATE_NEWS_WORKER' if resume else 'CREATING_ONLY_PRIVATE_NEWS_WORKER')
        body,mime=upload_body(config,modules);worker_attempted=True
        api('PUT',base,body,mime)
        settings=api('GET',base+'/settings');bindings={b['name']:b for b in settings.get('bindings',[])}
        if bindings.get('MYINVEST_NEWS_DEPLOYMENT_MARKER',{}).get('text')!=stamp or bindings.get('MYINVEST_ROLE',{}).get('text')!=ROLE:raise Stop('PRIVATE_WORKER_CREATION_UNCONFIRMED')
        if set(bindings)!={b['name'] for b in config['bindings']}:raise Stop('PRIVATE_BINDING_NAMES_UNCONFIRMED')
        for b in config['bindings']:
            if b['type']=='plain_text' and bindings[b['name']].get('text')!=b['text'] or b['type']=='secret_text' and bindings[b['name']].get('type')!='secret_text':raise Stop('PRIVATE_BINDING_TYPE_OR_VALUE_UNCONFIRMED')
        if bindings['GATE'].get('type')!='durable_object_namespace' or bindings['GATE'].get('class_name')!='RelayGate' or not bindings['GATE'].get('namespace_id'):raise Stop('PRIVATE_STORAGE_UNCONFIRMED')
        if resume and bindings['GATE']['namespace_id']!=resume['namespace']:raise Stop('PRIVATE_STORAGE_CHANGED_STOP')
        logging=disable_logging(api,base)
        api('POST',base+'/subdomain',{'enabled':True,'previews_enabled':False})
        progress('VERIFYING_LIVE_PRIVATE_AUTH_AND_ORIGINAL')
        wait_private_revision(current,stamp)
        status,anonymous=post('privateMorningBriefing',mode='date',date='2026-11-27')
        if status!=401 or anonymous.get('code')!='AUTH_REQUIRED':raise Stop('ANONYMOUS_ACCESS_BLOCK_UNCONFIRMED')
        status,login=post('login',user=user,**{'pass':password});logged=login.get('token')
        if status!=200 or login.get('success') is not True or not re.fullmatch('[a-fA-F0-9]{64}',logged or ''):raise Stop('PRIVATE_OWNER_LOGIN_UNCONFIRMED')
        digest,size=read_live_original(logged,original)
        status,logout=post('logout',logged)
        if status!=200 or logout.get('success') is not True:raise Stop('OWNER_LOGOUT_UNCONFIRMED')
        status,denied=post('privateMorningBriefing',logged,mode='date',date='2026-11-27')
        if status not in (200,401,403) or denied.get('success') is not False or denied.get('code') not in ('PRIVATE_BRIEFING_FORBIDDEN','AUTH_REQUIRED'):raise Stop('LOGOUT_ACCESS_BLOCK_UNCONFIRMED')
        logged=None;primary_unchanged()
        active=worker.active(api,base)
        return {**fixed,'status':'PASS','phase':'PRIVATE_READER_LIVE_API_VERIFIED','keyCreateCalls':1,'privateWorkerCreated':not bool(resume),'resumedExistingPrivateWorker':bool(resume),'existingNamespacePreserved':bool(resume),'loggingDisable':logging,'workerVersion':active['version'],'sourceRevision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'originalDate':'2026-11-27','originalBytes':size,'sourceContentSha256':original['contentSha256'],'serverContentSha256':digest,'sourceServerHashMatch':True,'anonymousBlocked':True,'loggedOutBlocked':True,'generalMemberLiveTest':'NOT_RUN','browserOriginalDisplay':'NOT_RUN','nextScheduledSave':'NOT_RUN','primaryPendingVersionPreserved':snapshot['latestVersionIsActive'] is False,'keyFileWritten':False}
    except Exception as error:
        cleanup='KEY_CREATE_RESULT_REVIEW_REQUIRED' if key_attempted and key_id is None else 'NOT_NEEDED'
        if key_id:
            try:key_client('DELETE',key_url+'/'+key_id);cleanup='CREATED_KEY_REVOKED'
            except Exception:cleanup='CREATED_KEY_REVOCATION_UNCONFIRMED'
        code=str(error) if isinstance(error,Stop) else error.code if isinstance(error,(worker.Stop,owner.Stop,ApiFailure)) else 'PRIVATE_NEWS_SETUP_FAILED'
        diagnostic=error.diagnostic if isinstance(error,ReceiptFailure) else {}
        if isinstance(error,worker.Stop):diagnostic={'requestStage':error.stage,'providerCodes':error.provider_codes,'providerHints':error.hints}
        return {**fixed,'status':'PARTIAL' if worker_attempted or key_attempted else 'NOT_RUN','code':code,'keyCreateCalls':int(key_attempted),'privateWorkerUploadAttempted':worker_attempted,'keyRecovery':cleanup,'keyFileWritten':False,'browserOriginalDisplay':'NOT_RUN',**diagnostic,**({'http':error.http} if isinstance(error,(worker.Stop,owner.Stop,ApiFailure)) and error.http else {})}
    finally:
        if logged:
            try:post('logout',logged)
            except Exception:pass

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--owner-dir',type=Path,default=Path('/home/kocoro97/myinvest-v2-fresh-private-r2'));p.add_argument('--apply',action='store_true',required=True);p.add_argument('--resume-private-version');a=p.parse_args()
    try:
        if not sys.stdin.isatty():raise Stop('HIDDEN_OWNER_TERMINAL_REQUIRED')
        account=getpass.getpass('Existing Cloudflare Account ID (hidden): ')
        cf_token=getpass.getpass('Existing Cloudflare API token (hidden): ')
        user=getpass.getpass('Existing MY INVEST owner ID (hidden, not Google): ')
        password=getpass.getpass('Existing MY INVEST password (hidden): ')
        folder=getpass.getpass('Approved archive folder URL or ID (hidden): ')
        result=deploy(a.owner_dir,account,cf_token,user,password,folder,a.resume_private_version)
    except (Stop,worker.Stop,owner.Stop) as error:result={'status':'NOT_RUN','code':error.code if isinstance(error,(worker.Stop,owner.Stop)) else str(error),'credentialsIncluded':False,'nhCalls':0,'orderCalls':0}
    except (EOFError,KeyboardInterrupt):result={'status':'NOT_RUN','code':'OWNER_INPUT_INTERRUPTED','credentialsIncluded':False}
    except Exception:result={'status':'NOT_RUN','code':'PRIVATE_NEWS_OWNER_STEP_FAILED','credentialsIncluded':False}
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
