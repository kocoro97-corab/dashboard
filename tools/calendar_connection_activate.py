"""Existing isolated GAS + existing Worker calendar connection. Default: private build/plan.
--apply uses owner credentials in memory; no Google Calendar, NH, order or holdings call.
Never recreates a project, namespace, Sheet, user or authentication manifest.
"""
import argparse, copy, getpass, hashlib, json, os, re, secrets, shutil, subprocess, tempfile, time
from pathlib import Path
from email.parser import BytesParser
from email.policy import default as email_policy
import urllib.request, urllib.error
import worker_code_only as worker
import calendar_owner_preflight as check
import nh_v2_upgrade as gas
from nh_v2_fresh import private_path, target, logical, pull, revision, OLD_DEPLOYMENT, PRODUCTION_DEPLOYMENT_ID, SAFE_OWNER_CODES
from nh_staging_test import WebApp
from build_nh_staging import ROOT, build, source_digest

class Stop(Exception):
    pass

OVERRIDES={'MYINVEST_EXPECTED_METADATA','CALENDAR_IDENTITY_BRIDGE_KEY','GOOGLE_CALENDAR_ENCRYPTION_KEY','GOOGLE_CALENDAR_ENABLED'}

def digest(raw):return hashlib.sha256(raw).hexdigest()
def private_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(value,indent=2)+'\n');tmp.chmod(0o600);tmp.replace(path)

def current_code(content):
    raw=content.get('body');kind=content.get('contentType','')
    if not isinstance(raw,bytes) or len(raw)>2*1024*1024 or content.get('entrypoint') not in (None,'worker.mjs'):raise Stop('CURRENT_WORKER_MODULE_REVIEW_REQUIRED')
    if kind.lower().startswith('multipart/'):
        message=BytesParser(policy=email_policy).parsebytes(('Content-Type: '+kind+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
        if not message.is_multipart() or message.defects:raise Stop('CURRENT_WORKER_MODULE_REVIEW_REQUIRED')
        files=[]
        for part in message.iter_parts():
            name=part.get_filename() or part.get_param('name',header='content-disposition')
            if name=='metadata':continue
            if name!='worker.mjs' or part.is_multipart() or part.defects:raise Stop('CURRENT_WORKER_MODULE_REVIEW_REQUIRED')
            files.append(part.get_payload(decode=True))
        if len(files)!=1:raise Stop('CURRENT_WORKER_MODULE_REVIEW_REQUIRED')
        raw=files[0]
    if not raw or not isinstance(raw,bytes):raise Stop('CURRENT_WORKER_MODULE_REVIEW_REQUIRED')
    return raw

def union_bindings(settings,secret_rows):
    rows=copy.deepcopy(worker.verified_settings(settings));names={r['name']:r for r in rows}
    if not isinstance(secret_rows,list):raise Stop('EXISTING_SECRET_NAMES_REQUIRED')
    if len({r.get('name') for r in secret_rows if isinstance(r,dict)})!=len(secret_rows):raise Stop('EXISTING_SECRET_NAMES_REQUIRED')
    for row in secret_rows:
        if not isinstance(row,dict) or not isinstance(row.get('name'),str) or row.get('type') not in ('secret_text','secret_key'):raise Stop('EXISTING_SECRET_NAMES_REQUIRED')
        if row['name'] in names and names[row['name']]['type']!=row['type']:raise Stop('BINDING_VIEWS_CONFLICT')
        if row['name'] not in names:names[row['name']]={k:v for k,v in row.items() if k!='text'}
    return list(names.values())

def upload_metadata(settings,bindings,expected,keys):
    if any(b['name'] in ('CALENDAR_IDENTITY_BRIDGE_KEY','GOOGLE_CALENDAR_ENCRYPTION_KEY') for b in bindings):raise Stop('EXISTING_KEY_MATERIAL_REQUIRES_REVIEW')
    flag=next((b for b in bindings if b['name']=='GOOGLE_CALENDAR_ENABLED'),None)
    if flag and not (flag.get('type')=='plain_text' and flag.get('text')=='false'):raise Stop('EXISTING_ENABLE_FLAG_REQUIRES_REVIEW')
    rows=[{'name':b['name'],'type':'inherit','version_id':'latest'} for b in bindings if b['name'] not in OVERRIDES]
    rows += [{'name':'MYINVEST_EXPECTED_METADATA','type':'secret_text','text':json.dumps(expected,separators=(',',':'))},
             {'name':'CALENDAR_IDENTITY_BRIDGE_KEY','type':'secret_text','text':keys['bridge']},
             {'name':'GOOGLE_CALENDAR_ENCRYPTION_KEY','type':'secret_text','text':keys['encryption']},
             {'name':'GOOGLE_CALENDAR_ENABLED','type':'plain_text','text':'true'}]
    flags=list(settings.get('compatibility_flags',[]))
    if 'nodejs_compat' not in flags:flags.append('nodejs_compat')
    result={'main_module':'worker.mjs','compatibility_date':settings['compatibility_date'],'compatibility_flags':flags,'bindings':rows}
    if 'usage_model' in settings:result['usage_model']=settings['usage_model']
    return result

def settings_preserved(before,after,old_bindings,new_bindings):
    def clean(settings,bindings):
        value=copy.deepcopy(settings);value['bindings']=[]
        for row in bindings:
            if row['name'] in OVERRIDES:continue
            row=copy.deepcopy(row)
            if row.get('type') in ('secret_text','secret_key'):row.pop('text',None);row.pop('key_base64',None)
            value['bindings'].append(row)
        value['compatibility_flags']=sorted(f for f in value.get('compatibility_flags',[]) if f!='nodejs_compat')
        return value
    return worker.settings_equivalent(clean(before,old_bindings),clean(after,new_bindings))

def coordinated(stage,activate_gas,configure,activate_worker,verify,restore_worker,restore_gas):
    """Only caller-owned versions are restored; rollback routines must refuse other actors."""
    phase='PREPARED';gas_attempted=False;worker_attempted=False
    try:
        phase='CANDIDATE_UPLOAD';worker_attempted=True;stage()
        phase='ISOLATED_GAS';gas_attempted=True;activate_gas()
        phase='IDENTITY_CONFIGURATION';configure()
        phase='WORKER_ACTIVATION';worker_attempted=True;activate_worker()
        phase='READBACK';verify()
        return {'status':'PASS','phase':'ISOLATED_CALENDAR_RUNTIME_READY','recovery':'NOT_NEEDED'}
    except Exception as error:
        failed={'status':'FAIL','phase':phase,'code':safe_code(error),'calendarKeysRetainedPrivately':True}
        try:
            if worker_attempted:restore_worker()
            if gas_attempted:restore_gas()
            return {**failed,'recovery':'PASS_PREVIOUS_CONNECTION_RESTORED'}
        except Exception:return {**failed,'recovery':'OWNER_REVIEW_REQUIRED_NO_BLIND_ROLLBACK'}

def safe_code(error):
    if isinstance(error,worker.Stop):return error.code
    if isinstance(error,Stop):return str(error)
    if str(error) in SAFE_OWNER_CODES:return str(error)
    return 'OWNER_CALENDAR_STEP_FAILED'

def scoped_api(account,token):
    if not re.fullmatch('[a-fA-F0-9]{32}',account or ''):raise Stop('ACCOUNT_ID_INVALID')
    raw=worker.api_client(token);base='/accounts/'+account+'/workers/scripts/'+worker.NAME
    def call(method,path,body=None,content_type='application/json'):
        reads={base+x for x in ['/settings','/secrets','/deployments','/versions','/content/v2']}
        reads.add('/accounts/'+account+'/workers/subdomain')
        valid=method=='GET' and (path in reads or path.startswith(base+'/versions/') and worker.UUID.fullmatch(path.rsplit('/',1)[-1]))
        valid=valid or method=='POST' and path in (base+'/versions?bindings_inherit=strict',base+'/deployments')
        if not valid:raise Stop('CALENDAR_SCOPE_DENIED')
        return raw(method,path,body,content_type)
    return call

def public():return check.public_probe()

def assert_worker(api,base,checkpoint,*,pending=None,active_version=None):
    active=worker.active(api,base)
    if active['version']!=(active_version or checkpoint['active']['version']):raise Stop('CONCURRENT_WORKER_CHANGE_STOP')
    if worker.recent_versions(api,base)[0]['id']!=(pending or active['version']):raise Stop('CONCURRENT_WORKER_VERSION_STOP')
    if active_version is None and not worker.settings_equivalent(checkpoint['settings'],api('GET',base+'/settings')):raise Stop('CONCURRENT_WORKER_SETTINGS_STOP')

def ensure_history(rev):
    if not re.fullmatch('[a-f0-9]{40}',rev):raise Stop('DEPLOYED_HISTORY_REQUIRED')
    if subprocess.run(['git','cat-file','-e',rev+'^{commit}'],cwd=ROOT,capture_output=True).returncode:
        r=subprocess.run(['git','fetch','--quiet','origin',rev],cwd=ROOT,capture_output=True,timeout=90)
        if r.returncode:raise Stop('DEPLOYED_HISTORY_REQUIRED')

def compile_worker(legacy,output,folder):
    tools=folder/'build-tools';tools.mkdir(mode=0o700)
    child_env={k:v for k,v in os.environ.items() if not re.search(r'TOKEN|PASSWORD|SECRET|API_KEY',k,re.I)}
    run=subprocess.run(['npm','install','--prefix',str(tools),'--ignore-scripts','--no-audit','--no-fund','--no-package-lock','esbuild@0.25.12'],capture_output=True,text=True,timeout=180,env=child_env)
    if run.returncode:raise Stop('LOCAL_BUNDLE_DEPENDENCY_FAILED')
    r=subprocess.run(['node',str(ROOT/'tools/build_calendar_worker_overlay.cjs'),'--legacy-file',str(legacy),'--output',str(output),'--esbuild-module',str(tools/'node_modules/esbuild')],capture_output=True,text=True,timeout=60,env=child_env)
    try:ok=r.returncode==0 and json.loads(r.stdout).get('status')=='PASS'
    except ValueError:ok=False
    if not ok:raise Stop('CURRENT_WORKER_BUNDLE_FAILED')
    smoke=subprocess.run(['node','--input-type=module','-e','globalThis.fetch=()=>{throw Error("BUNDLE_SMOKE_NETWORK_DISABLED")};const m=await import(process.argv[1]);if(typeof m.default.fetch!=="function"||typeof m.RelayGate!=="function")process.exit(1)',output.as_uri()],capture_output=True,timeout=30,env=child_env)
    if smoke.returncode:raise Stop('CURRENT_WORKER_EXPORTS_FAILED')

def apply(environment,account,token,username,password,*,plan_only=False):
    print('[calendar] VERIFYING_EXISTING_TARGET',file=__import__('sys').stderr,flush=True)
    env=private_path(environment,False);old=json.loads((env/'fresh-plan.json').read_text());target(old['scriptId'])
    match=re.fullmatch(r'https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec',old.get('url',''))
    if not match or match[1] in (OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID):raise Stop('EXISTING_ISOLATED_DEPLOYMENT_REQUIRED')
    ensure_history(old['revision']);original,old_hash=gas.historical_bundle(old['revision'],old['scriptId'])
    if old_hash!=old['sourceDigest'] or logical(env/'bundle')!=original:raise Stop('OWNER_SOURCE_PROOF_FAILED')
    api=scoped_api(account,token);base='/accounts/'+account+'/workers/scripts/'+worker.NAME
    readiness=check.inspect(lambda p:api('GET',p),account,owner_dir=env)
    if not readiness.get('ownerCheckoutVerified') or not readiness.get('ownerCheckoutInspection',{}).get('sourceRevisionMatches'):raise Stop('OWNER_SOURCE_LOCATION_REVIEW_REQUIRED')
    active=worker.active(api,base);settings=api('GET',base+'/settings');bindings=union_bindings(settings,api('GET',base+'/secrets'))
    before=public();gas.check_metadata(before,old)
    if before.get('sessionIdleMs')!=3600000 or before.get('developmentGoogleCalendarOverlayVersion')==1:raise Stop('CURRENT_SESSION_OR_OVERLAY_REVIEW_REQUIRED')
    configured,states=check.secret_presence({r['name']:r for r in bindings},[],True)
    if states['GOOGLE_CALENDAR_CLIENT_ID'] not in ('SECRET_CONFIRMED','CLIENT_ID_TEXT_CONFIRMED') or configured['GOOGLE_CALENDAR_CLIENT_SECRET'] is not True:raise Stop('GOOGLE_BINDINGS_NOT_CONFIRMED')
    root=env/(('calendar-preview-' if plan_only else 'calendar-connect-')+revision()[:12])
    if root.exists():
        previous=json.loads((root/'private-checkpoint.json').read_text())
        if previous.get('phase')!='PREPARED' or previous.get('oldPlan')!=old or previous.get('active')!=active or not worker.settings_equivalent(previous.get('settings',{}),settings):raise Stop('PRIVATE_CHECKPOINT_EXISTS_REVIEW_REQUIRED')
        with tempfile.TemporaryDirectory() as t:
            preview=Path(t)/'expected';build(old['scriptId'],revision(),preview)
            if logical(root/'original')!=original or logical(root/'target')!=logical(preview):raise Stop('PRIVATE_CHECKPOINT_SOURCE_REVIEW_REQUIRED')
        root.rename(root.with_name(root.name+'-prewrite-backup-'+str(time.time_ns())))
    root.mkdir(mode=0o700);shutil.copytree(env/'bundle',root/'original')
    staged=root/'target';build(old['scriptId'],revision(),staged);desired=logical(staged)
    changed={k for k in set(original)|set(desired) if original.get(k)!=desired.get(k)}
    if changed-{'StagingBridge','CalendarIdentityBridge'} or desired.get('appsscript')!=original.get('appsscript'):raise Stop('UNRELATED_GAS_OR_SCOPE_CHANGE_STOP')
    cp={'active':active,'settings':settings,'oldPlan':old,'keys':{'bridge':secrets.token_hex(32),'user':secrets.token_hex(32),'encryption':secrets.token_hex(32)},'phase':'PREPARED'}
    record=root/'private-checkpoint.json';private_json(record,cp)
    assert_worker(api,base,cp)
    legacy=root/'legacy-worker.mjs';legacy.write_bytes(current_code(api('GET',base+'/content/v2')));legacy.chmod(0o600)
    assert_worker(api,base,cp)
    print('[calendar] BUILDING_CURRENT_WORKER_OVERLAY',file=__import__('sys').stderr,flush=True)
    candidate_file=root/'calendar-worker.mjs';compile_worker(legacy,candidate_file,root)
    web=WebApp(old['url']);old_meta=web.call('appVersion');gas.check_metadata(old_meta,old);web.binding=old['sheetHash']
    next_plan={**old,'revision':revision(),'sourceDigest':source_digest()}
    expected={k:v for k,v in old_meta.items() if isinstance(v,(str,int,float,bool)) or v is None}
    expected.update(sourceDigest=next_plan['sourceDigest'],revision=next_plan['revision'],calendarIdentityVersion=1,calendarIdentityConfigured=True)
    metadata=upload_metadata(settings,bindings,expected,cp['keys'])
    with tempfile.TemporaryDirectory() as tmp:
        tmp=Path(tmp)
        if pull(gas.upgrade_clasp,tmp/'head-before',old['scriptId'])!=original or gas.deployment(gas.upgrade_clasp,env/'bundle',old)['versionNumber']!=old['activeVersion']:raise Stop('CONCURRENT_GAS_CHANGE_STOP')
    if plan_only:return {'status':'PASS','phase':'PRIVATE_CALENDAR_CANDIDATE_PREPARED','deploymentAttempted':False,'authScopesChanged':False,'nodeCompatibilityChangeRequired':'nodejs_compat' not in settings.get('compatibility_flags',[])}
    login=web.call('login',**{'user':username,'pass':password})
    if login.get('isAdmin') is not True or login.get('mustChangePassword') is True or not re.fullmatch('[a-fA-F0-9]{64}',login.get('token','')):raise Stop('EXISTING_OWNER_LOGIN_REQUIRED')
    web.token=login['token']
    def save(phase):
        cp.update(phase=phase);private_json(record,cp)
        print('[calendar] '+phase,file=__import__('sys').stderr,flush=True)
    def upload():
        assert_worker(api,base,cp);save('CANDIDATE_UPLOAD_ATTEMPTED');body,mime=worker.multipart(metadata,candidate_file.read_bytes());result=api('POST',base+'/versions?bindings_inherit=strict',body,mime);candidate=result.get('id','')
        if not worker.UUID.fullmatch(candidate):raise Stop('CANDIDATE_UPLOAD_UNCONFIRMED')
        cp['candidate']=candidate;save('CANDIDATE_UPLOADED');assert_worker(api,base,cp,pending=candidate)
        if not worker.candidate_source_matches(api('GET',base+'/content/v2'),candidate_file.read_bytes()):raise Stop('CANDIDATE_CODE_MISMATCH')
    def activate_gas():
        assert_worker(api,base,cp,pending=cp['candidate'])
        with tempfile.TemporaryDirectory() as t:
            if pull(gas.upgrade_clasp,Path(t)/'before',old['scriptId'])!=original or gas.deployment(gas.upgrade_clasp,env/'bundle',old)['versionNumber']!=old['activeVersion']:raise Stop('CONCURRENT_GAS_CHANGE_STOP')
            save('GAS_PUSH_ATTEMPTED');gas.upgrade_clasp(['push','--force'],staged,old['scriptId'])
            if pull(gas.upgrade_clasp,Path(t)/'after',old['scriptId'])!=desired:raise Stop('GAS_SOURCE_READBACK_FAILED')
            version=json.loads(gas.upgrade_clasp(['create-version','Existing isolated calendar connection'],staged,old['scriptId'])).get('versionNumber')
            if type(version) is not int or version<=old['activeVersion']:raise Stop('GAS_IMMUTABLE_VERSION_FAILED')
            cp['gasVersion']=version;private_json(record,cp)
            if pull(gas.upgrade_clasp,Path(t)/'immutable',old['scriptId'],version)!=desired:raise Stop('GAS_IMMUTABLE_READBACK_FAILED')
            gas.upgrade_clasp(['update-deployment',old['url'].split('/')[-2],'--versionNumber',str(version),'--description','Existing isolated calendar connection'],staged,old['scriptId']);save('GAS_DEPLOYED')
    def configure():
        for attempt in range(6):
            current=web.call('appVersion')
            if current.get('revision')==next_plan['revision'] and current.get('sourceDigest')==next_plan['sourceDigest'] and current.get('calendarIdentityVersion')==1:break
            if attempt==5:raise Stop('GAS_DEPLOYMENT_PROPAGATION_UNCONFIRMED')
            time.sleep(2)
        result=web.call('calendarOwnerConfigureIdentityV1',confirm='INITIALIZE_PRIVATE_CALENDAR_IDENTITY_ONLY',bridgeKey=cp['keys']['bridge'],userKey=cp['keys']['user'])
        if result.get('bridgeKeyHash')!=digest(cp['keys']['bridge'].encode()) or result.get('userKeyHash')!=digest(cp['keys']['user'].encode()):raise Stop('GAS_KEY_CONFIGURATION_UNCONFIRMED')
        cp['propertiesChanged']=result.get('propertiesChanged') is True;save('IDENTITY_CONFIGURED')
        gas.check_metadata(web.call('appVersion'),old,next_plan['sourceDigest'],next_plan['revision'])
    def activate_worker():
        assert_worker(api,base,cp,pending=cp['candidate']);save('WORKER_ACTIVATION_ATTEMPTED')
        api('POST',base+'/deployments',{'strategy':'percentage','versions':[{'version_id':cp['candidate'],'percentage':100}]})
        assert_worker(api,base,cp,pending=cp['candidate'],active_version=cp['candidate']);save('WORKER_ACTIVE')
    def verify():
        after_settings=api('GET',base+'/settings');after_bindings=union_bindings(after_settings,api('GET',base+'/secrets'))
        if not settings_preserved(settings,after_settings,bindings,after_bindings) or 'nodejs_compat' not in after_settings.get('compatibility_flags',[]):raise Stop('UNRELATED_WORKER_SETTINGS_CHANGED')
        meta=None
        for attempt in range(6):
            try:
                meta=public();gas.check_metadata(meta,old,next_plan['sourceDigest'],next_plan['revision']);break
            except Exception:
                if attempt==5:raise Stop('PUBLIC_METADATA_PROPAGATION_UNCONFIRMED')
                time.sleep(2)
        if meta.get('sessionIdleMs')!=3600000 or meta.get('developmentGoogleCalendarReadOnly') is not True:raise Stop('PUBLIC_CALENDAR_CAPABILITY_UNCONFIRMED')
        for k in worker.CAPABILITIES:
            if k not in ('sourceDigest','developmentGoogleCalendarOverlayVersion','developmentGoogleCalendarReadOnly') and meta.get(k)!=before.get(k):raise Stop('LEGACY_CAPABILITY_CHANGED')
        req=urllib.request.Request(check.ENDPOINT,data=b'{"action":"googleCalendarStatus"}',headers={'User-Agent':check.USER_AGENT,'Origin':check.ORIGIN,'Content-Type':'application/json','X-MyInvest-Dev-Client':'dashboard-v2-dev','Authorization':'Bearer '+web.token})
        with urllib.request.build_opener(worker.NoRedirect()).open(req,timeout=35) as response:status=json.loads(response.read(65536))
        if status.get('success') is not True or status.get('readOnly') is not True:raise Stop('AUTHORITATIVE_CALENDAR_STATUS_FAILED')
        save('REMOTE_VERIFIED')
        next_plan['activeVersion']=cp['gasVersion'];(env/'bundle').rename(root/'previous-bundle');staged.rename(env/'bundle');private_json(env/'fresh-plan.json',next_plan);save('COMPLETE')
    def restore_worker():
        current=worker.active(api,base)['version']
        if current==cp.get('candidate'):api('POST',base+'/deployments',{'strategy':'percentage','versions':[{'version_id':active['version'],'percentage':100}]})
        elif current!=active['version']:raise Stop('CONCURRENT_WORKER_NO_ROLLBACK')
        if worker.active(api,base)['version']!=active['version'] or not worker.settings_equivalent(settings,api('GET',base+'/settings')):raise Stop('WORKER_RECOVERY_UNCONFIRMED')
    def restore_gas():
        with tempfile.TemporaryDirectory() as t:
            now=pull(gas.upgrade_clasp,Path(t)/'head',old['scriptId']);version=gas.deployment(gas.upgrade_clasp,env/'bundle',old)['versionNumber']
            if now not in (original,desired) or version not in (old['activeVersion'],cp.get('gasVersion')):raise Stop('CONCURRENT_GAS_NO_ROLLBACK')
            if version!=old['activeVersion']:gas.upgrade_clasp(['update-deployment',old['url'].split('/')[-2],'--versionNumber',str(old['activeVersion']),'--description','Restore previous isolated connection'],root/'original',old['scriptId'])
            if now!=original:gas.upgrade_clasp(['push','--force'],root/'original',old['scriptId'])
            if pull(gas.upgrade_clasp,Path(t)/'restored',old['scriptId'])!=original:raise Stop('GAS_RECOVERY_UNCONFIRMED')
        gas.check_metadata(public(),old)
        if (root/'previous-bundle').exists():
            if logical(env/'bundle')!=desired or logical(root/'previous-bundle')!=original:raise Stop('LOCAL_CONCURRENT_SOURCE_STOP')
            (env/'bundle').rename(root/'failed-calendar-bundle');(root/'previous-bundle').rename(env/'bundle');private_json(env/'fresh-plan.json',old)
    try:report=coordinated(upload,activate_gas,configure,activate_worker,verify,restore_worker,restore_gas)
    finally:
        try:web.call('logout');cp['temporarySessionLogout']='PASS'
        except Exception:cp['temporarySessionLogout']='UNCONFIRMED'
        try:private_json(record,cp)
        except Exception:report.update(status='PARTIAL',phase='REMOTE_STATE_CHECKPOINT_WRITE_UNCONFIRMED')
    if cp['temporarySessionLogout']!='PASS':report.update(status='PARTIAL',phase='TEMPORARY_SESSION_LOGOUT_UNCONFIRMED')
    return {**report,'temporarySessionLogout':cp['temporarySessionLogout'],'liveGoogleConsent':'NOT_RUN','authScopesChanged':False,'newProject':False,'newNamespace':False,'googleClientValuesOverwritten':False,'deploymentAttempted':True,'candidateVersionCreated':bool(cp.get('candidate')),'workerVersion':cp.get('candidate'),'previousWorkerVersion':active['version'],'gasVersion':cp.get('gasVersion'),'sourceRevision':next_plan['revision'],'newPrivateKeyBindings':2 if cp.get('candidate') else None,'configurationPropertyWrites':3 if cp.get('propertiesChanged') else 0,'credentialsIncluded':False,'nhCalls':0,'accountCalls':0,'orderCalls':0,'accountStoreWrites':False}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    try:
        if not os.isatty(0):raise Stop('HIDDEN_OWNER_TERMINAL_REQUIRED')
        account=getpass.getpass('Existing Cloudflare Account ID (hidden): ')
        if not re.fullmatch('[a-fA-F0-9]{32}',account):raise Stop('ACCOUNT_ID_INVALID')
        token=getpass.getpass('Existing Cloudflare API token (hidden): ')
        user=getpass.getpass('Existing MY INVEST dashboard ID (hidden, not Google/NH): ') if a.apply else None
        password=getpass.getpass('Existing MY INVEST dashboard password (hidden, not Google/NH): ') if a.apply else None
        report=apply(a.environment,account,token,user,password,plan_only=not a.apply)
    except Exception as e:
        report={'status':'NOT_RUN','code':safe_code(e),'credentialsIncluded':False,'nhCalls':0,'accountCalls':0,'orderCalls':0,'accountStoreWrites':False}
        if isinstance(e,worker.Stop):report.update(http=e.http,requestStage=e.stage,providerCodes=e.provider_codes)
    print(json.dumps(report));return 0 if report.get('status')=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
