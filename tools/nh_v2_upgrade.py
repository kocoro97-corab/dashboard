"""Owner-run code-only upgrade of the proven fresh test deployment. No NH or Sheet/Properties operations."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import zipfile

from build_nh_staging import ROOT, build, source_digest
from nh_v2_fresh import private_path, target, invoke, logical, pull, revision, OLD_SHEET, OLD_DEPLOYMENT, PRODUCTION_DEPLOYMENT_ID, PRODUCTION_SHEET_HASH
from nh_staging_test import WebApp, fingerprint

class Stop(Exception):
    pass


def historical_bundle(rev,script):
    if not re.fullmatch(r'[a-f0-9]{40}',rev):raise Stop('BASELINE_REVISION_REQUIRED')
    def blob(name):
        r=subprocess.run(['git','show',rev+':'+name],cwd=ROOT,capture_output=True,timeout=30)
        if r.returncode:raise Stop('FETCH_DEPLOYED_REVISION_REQUIRED')
        return r.stdout
    tree=ast.parse(blob('tools/build_nh_staging.py').decode())
    values={}
    for node in tree.body:
        if isinstance(node,ast.Assign):
            for name in node.targets:
                if isinstance(name,ast.Name) and name.id in ('SOURCES','MANIFEST'):values[name.id]=ast.literal_eval(node.value)
    sources=values.get('SOURCES');manifest=values.get('MANIFEST')
    if not isinstance(sources,list) or not isinstance(manifest,dict) or not sources or any(not re.fullmatch(r'(?:gas/[A-Za-z0-9]+\.gs|tests/staging/StagingBridge\.gs)',p) for p in sources):raise Stop('BASELINE_GRAPH_REQUIRED')
    if len(set(sources))!=len(sources):raise Stop('BASELINE_GRAPH_REQUIRED')
    contents={p:blob(p) for p in sources};digest=hashlib.sha256()
    for p,data in contents.items():digest.update(p.encode()+b'\0'+str(len(data)).encode()+b'\0'+data)
    digest.update(json.dumps(manifest,sort_keys=True).encode());hash_value=digest.hexdigest()
    result={}
    for name,data in contents.items():
        key=Path(name).stem
        if key in result:raise Stop('BASELINE_GRAPH_REQUIRED')
        text=data.decode()
        if name.endswith('StagingBridge.gs'):text=text.replace('__SCRIPT_ID__',script).replace('__REVISION__',rev).replace('__SOURCE_DIGEST__',hash_value)
        result[key]=text.replace('\r\n','\n').strip()
    result['appsscript']=json.dumps(manifest,sort_keys=True)
    return result,hash_value


def deployment(client,folder,plan):
    dep=plan['url'].split('/')[-2]
    if dep in (OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID):raise Stop('FRESH_DEPLOYMENT_REQUIRED')
    data=json.loads(client(['list-deployments',plan['scriptId']],folder,plan['scriptId']))
    found=[d for d in data if d.get('deploymentId')==dep]
    if len(found)!=1 or type(found[0].get('versionNumber')) is not int:raise Stop('FRESH_DEPLOYMENT_REQUIRED')
    return found[0]


def check_metadata(m,plan,digest=None,rev=None,new=False):
    if not (m.get('freshTestEnvironment') is True and m.get('testEnvironment')=='nh-staging' and m.get('scriptHash')==fingerprint(plan['scriptId']) and m.get('sheetHash')==plan.get('sheetHash') and plan.get('sheetHash') not in (None,PRODUCTION_SHEET_HASH,fingerprint(OLD_SHEET)) and m.get('sourceDigest')==(digest or plan['sourceDigest']) and m.get('revision')==(rev or plan['revision']) and m.get('storeEngine')=='account-store-v2' and m.get('storeVersion')==2 and (not new or m.get('foreignIdentityVersion')==1)):
        raise Stop('FRESH_BINDING_OR_SOURCE_FAILED')


def upgrade_clasp(args,folder,script):
    if args[0]!='update-deployment':return invoke(args,folder,script)
    target(script)
    cfg=json.loads((folder/'.clasp.json').read_text())
    if cfg!={'scriptId':script,'rootDir':'.'} or len(args)!=6 or args[2]!='--versionNumber' or not args[3].isdigit() or args[4]!='--description':raise Stop('UPGRADE_COMMAND_REFUSED')
    # Caller compares this deployment ID to the verified fresh private plan before every update.
    if args[1] in (OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID) or not re.fullmatch(r'[A-Za-z0-9_-]+',args[1]):raise Stop('FRESH_DEPLOYMENT_REQUIRED')
    r=subprocess.run(['npx','--yes','@google/clasp@3.4.1','--json','--project',str(folder/'.clasp.json'),*args],cwd=folder,capture_output=True,text=True,timeout=180)
    if r.returncode:raise Stop('TEST_DEPLOYMENT_UPDATE_FAILED')
    return r.stdout


def upgrade(environment,client=upgrade_clasp,metadata=None):
    env=private_path(environment,False);old=json.loads((env/'fresh-plan.json').read_text());script=old['scriptId'];target(script)
    if old.get('phase')!='NH_AUTH_APPROVAL_REQUIRED' or not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec',old['url']):raise Stop('VERIFIED_FRESH_PLAN_REQUIRED')
    current_revision=revision();expected,old_digest=historical_bundle(old['revision'],script)
    if old_digest!=old['sourceDigest'] or logical(env/'bundle')!=expected:raise Stop('OLD_SOURCE_PROOF_FAILED')
    getmeta=metadata or (lambda:WebApp(old['url']).call('appVersion'))
    check_metadata(getmeta(),old)
    root=env/('upgrade-'+current_revision[:12])
    if root.exists():raise Stop('NEW_UPGRADE_BACKUP_REQUIRED')
    root.mkdir(mode=0o700)
    original=root/'original';shutil.copytree(env/'bundle',original)
    staged=root/'target';build(script,current_revision,staged)
    desired=logical(staged)
    if desired==expected:raise Stop('NO_SOURCE_UPGRADE_REQUIRED')
    if desired.get('appsscript')!=expected.get('appsscript'):raise Stop('MANIFEST_CHANGE_REQUIRES_REVIEW')
    (root/'previous-plan.json').write_text(json.dumps(old,indent=2))
    archive=root/'source-before-upgrade.zip'
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for p in original.iterdir():z.write(p,p.name)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None or any(z.read(p.name)!=p.read_bytes() for p in original.iterdir()):raise Stop('SOURCE_BACKUP_FAILED')
    for p in root.rglob('*'):p.chmod(0o700 if p.is_dir() else 0o600)
    # Fixed fresh identity and deployment checked again in every mutating callback.
    def update(version,description):
        cfg=json.loads((staged/'.clasp.json').read_text())
        if cfg!={'scriptId':script,'rootDir':'.'}:raise Stop('UPGRADE_COMMAND_REFUSED')
        return client(['update-deployment',old['url'].split('/')[-2],'--versionNumber',str(version),'--description',description],staged,script)
    report={'status':'FAIL','storageWrites':False,'propertiesWrites':False,'nhRequested':False,'productionChanged':False,'sourceOrValuesIncluded':False,'backup':'PASS'}
    writes=False;new_version=None;local_moved=False
    with tempfile.TemporaryDirectory() as t:
        tmp=Path(t)
        before=deployment(client,original,old)
        if before['versionNumber']!=old['activeVersion']:raise Stop('CONCURRENT_DEPLOYMENT_CHANGE')
        if pull(client,tmp/'head',script)!=expected or pull(client,tmp/'active',script,old['activeVersion'])!=expected:raise Stop('CONCURRENT_SOURCE_CHANGE')
        try:
            check_metadata(getmeta(),old)
            writes=True;client(['push','--force'],staged,script)
            if pull(client,tmp/'uploaded',script)!=desired:raise Stop('UPLOAD_READBACK_FAILED')
            new_version=json.loads(client(['create-version','V2 verified foreign identity '+current_revision[:12]],staged,script)).get('versionNumber')
            if type(new_version) is not int or new_version<=old['activeVersion']:raise Stop('IMMUTABLE_VERSION_FAILED')
            if pull(client,tmp/'new-immutable',script,new_version)!=desired:raise Stop('IMMUTABLE_SOURCE_FAILED')
            update(new_version,before.get('description',''))
            for attempt in range(6):
                listed=deployment(client,staged,old)['versionNumber']
                if listed==new_version:
                    try:check_metadata(getmeta(),old,source_digest(),current_revision,True);break
                    except Stop:
                        if attempt==5:raise
                elif listed!=old['activeVersion']:raise Stop('CONCURRENT_DEPLOYMENT_CHANGE')
                if attempt==5:raise Stop('PUBLISHED_SOURCE_READBACK_FAILED')
                time.sleep(2)
            if pull(client,tmp/'final-head',script)!=desired:raise Stop('FINAL_SOURCE_READBACK_FAILED')
            # Preserve the old bundle and plan in the private upgrade backup.
            (env/'bundle').rename(root/'previous-bundle');local_moved=True
            shutil.copytree(staged,env/'bundle')
            new_plan=dict(old,revision=current_revision,sourceDigest=source_digest(),activeVersion=new_version)
            next_plan=root/'next-plan.json';next_plan.write_text(json.dumps(new_plan,indent=2));next_plan.chmod(0o600);next_plan.replace(env/'fresh-plan.json')
            for p in (env/'bundle').rglob('*'):p.chmod(0o700 if p.is_dir() else 0o600)
            report.update(status='PASS',phase='FRESH_TEST_IDENTITY_UPGRADE_VERIFIED',activeTestVersion=new_version,sourceDigest='PASS',recovery='NOT_NEEDED')
        except Exception:
            report.update(code='FRESH_TEST_UPGRADE_FAILED',recovery='NOT_NEEDED')
            if writes:
                try:
                    latest=pull(client,tmp/'rollback-check',script);version=deployment(client,original,old)['versionNumber']
                    if latest not in (expected,desired) or version not in (old['activeVersion'],new_version):raise Stop('CONCURRENT_CHANGE_STOP')
                    if version!=old['activeVersion']:update(old['activeVersion'],before.get('description',''))
                    if latest!=expected:client(['push','--force'],original,script)
                    if pull(client,tmp/'restored',script)!=expected or deployment(client,original,old)['versionNumber']!=old['activeVersion']:raise Stop('RESTORE_READBACK_FAILED')
                    check_metadata(getmeta(),old)
                    if local_moved:
                        if (env/'bundle').exists():
                            if logical(env/'bundle')!=desired:raise Stop('LOCAL_CONCURRENT_CHANGE')
                            shutil.rmtree(env/'bundle')
                        (root/'previous-bundle').rename(env/'bundle')
                    (env/'fresh-plan.json').write_text(json.dumps(old,indent=2));(env/'fresh-plan.json').chmod(0o600)
                    report['recovery']='PASS_FRESH_SOURCE_AND_DEPLOYMENT_RESTORED'
                except Exception:report['recovery']='OWNER_REVIEW_REQUIRED'
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);a=p.parse_args()
    try:result=upgrade(a.environment)
    except Exception:result={'status':'FAIL','code':'FRESH_TEST_UPGRADE_PREFLIGHT_FAILED','storageWrites':False,'propertiesWrites':False,'nhRequested':False,'productionChanged':False,'sourceOrValuesIncluded':False}
    print(json.dumps(result));return 0 if result['status']=='PASS' else 1

if __name__=='__main__':raise SystemExit(main())
