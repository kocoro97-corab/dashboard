"""Read only the existing private-news Worker. Never creates keys or changes settings."""
import getpass,json,re,sys
from email.parser import BytesParser
from email.policy import default
import deploy_private_news_reader as deploy
import news_reader_owner_preflight as preflight
import worker_code_only as worker

class Stop(Exception):pass

def bool_state(value):
    return 'TRUE' if value is True else 'FALSE' if value is False else 'ABSENT' if value is None else 'OTHER'

def observability_state(settings):
    obs=settings.get('observability')
    obs=obs if isinstance(obs,dict) else {}
    return {'observabilityEnabled':bool_state(obs.get('enabled')),
        'logsEnabled':bool_state((obs.get('logs') or {}).get('enabled')),
        'tracesEnabled':bool_state((obs.get('traces') or {}).get('enabled')),
        'invocationLogsEnabled':bool_state((obs.get('logs') or {}).get('invocation_logs')),
        'logpush':bool_state(settings.get('logpush')),
        'tailConsumerCount':len(settings['tail_consumers']) if isinstance(settings.get('tail_consumers'),list) else None}

def module_matches(content,expected_hashes=None):
    expected=deploy.worker_modules();raw=content.get('body');kind=content.get('contentType','')
    if content.get('entrypoint') not in (None,'worker.mjs'):return False
    if not isinstance(raw,bytes) or len(raw)>2*1024*1024:return False
    if not kind.lower().startswith('multipart/'):return False
    message=BytesParser(policy=default).parsebytes(('Content-Type: '+kind+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+raw)
    if not message.is_multipart() or message.defects:return False
    actual={}
    for part in message.iter_parts():
        name=part.get_filename() or part.get_param('name',header='content-disposition')
        if name=='metadata':continue
        if name not in expected or name in actual or part.is_multipart() or part.defects:return False
        actual[name]=part.get_payload(decode=True)
    hashes={name:deploy.sha(raw) for name,raw in actual.items()}
    return hashes==expected_hashes if expected_hashes is not None else actual==expected

def inspect(account,token):
    if not re.fullmatch('[a-fA-F0-9]{32}',account or ''):raise Stop('ACCOUNT_ID_INVALID')
    raw=worker.api_client(token);base='/accounts/'+account+'/workers/scripts/'+preflight.PREVIEW
    allowed={base+s for s in ('/settings','/script-settings','/deployments','/versions','/content/v2')}
    def read(path):
        if path not in allowed and not (path.startswith(base+'/versions/') and worker.UUID.fullmatch(path.rsplit('/',1)[-1])):raise Stop('READ_ONLY_SCOPE_DENIED')
        return raw('GET',path)
    settings=read(base+'/settings');script_status='READ'
    try:script=read(base+'/script-settings')
    except worker.Stop as error:
        if error.http not in (403,404):raise
        script={};script_status='HTTP_'+str(error.http)
    before=worker.active(lambda method,path:read(path),base)
    history=worker.recent_versions(lambda method,path:read(path),base)
    version=read(base+'/versions/'+before['version'])
    content=read(base+'/content/v2')
    if worker.active(lambda method,path:read(path),base)!=before:raise Stop('CONCURRENT_PRIVATE_CHANGE_STOP')
    bindings=settings.get('bindings',[])
    gate=next((b for b in bindings if b.get('name')=='GATE'),{})
    resource=next((b for b in version.get('resources',{}).get('bindings',[]) if b.get('name')=='GATE'),{})
    role=next((b.get('text') for b in bindings if b.get('name')=='MYINVEST_ROLE'),None)
    return {'status':'PASS','scope':'READ_ONLY_INSPECTION_ONLY','privateWorkerVersion':before['version'],
        'latestVersionIsActive':history[0]['id']==before['version'],'expectedRoleConfirmed':role==deploy.ROLE,
        'uploadedPublicModulesMatch':module_matches(content),
        'gateBindingType':gate.get('type') if gate.get('type')=='durable_object_namespace' else 'OTHER_OR_ABSENT',
        'gateClassMatches':gate.get('class_name')=='RelayGate','gateClassFieldPresent':'class_name' in gate,
        'gateNamespacePresent':bool(gate.get('namespace_id')),
        'versionGateClassMatches':resource.get('class_name')=='RelayGate',
        'namespaceAgreesAcrossViews':bool(gate.get('namespace_id')) and gate.get('namespace_id')==resource.get('namespace_id'),
        'combinedSettings':observability_state(settings),'scriptSettingsRead':script_status,'scriptSettings':observability_state(script),
        'keyCreateCalls':0,'secretWriteCalls':0,'settingsWriteCalls':0,'deploymentAttempted':False,
        'credentialsIncluded':False,'nhCalls':0,'orderCalls':0}

def main():
    try:
        if not sys.stdin.isatty():raise Stop('HIDDEN_OWNER_TERMINAL_REQUIRED')
        account=getpass.getpass('Existing Cloudflare Account ID (hidden): ')
        token=getpass.getpass('Existing Cloudflare API token (hidden): ')
        report=inspect(account,token)
    except (Stop,worker.Stop) as error:
        report={'status':'NOT_RUN','code':error.code if isinstance(error,worker.Stop) else str(error),'keyCreateCalls':0,'settingsWriteCalls':0,'credentialsIncluded':False}
        if isinstance(error,worker.Stop):report.update(http=error.http,requestStage=error.stage,providerCodes=error.provider_codes)
    except Exception:report={'status':'NOT_RUN','code':'PRIVATE_READ_ONLY_INSPECTION_FAILED','keyCreateCalls':0,'settingsWriteCalls':0,'credentialsIncluded':False}
    print(json.dumps(report));return 0 if report.get('status')=='PASS' else 1
if __name__=='__main__':raise SystemExit(main())
