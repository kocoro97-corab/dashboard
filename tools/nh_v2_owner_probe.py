"""Install/remove an owner-editor-only probe in the fresh test HEAD. No deployment/Sheet/Properties writes or NH calls."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

from nh_v2_fresh import private_path, invoke, pull, logical, target
from nh_v2_live_check import preflight
from build_nh_staging import ROOT, build, source_digest

TEMPLATE = ROOT / 'tests/staging/OwnerOverseasProbe.gs'
NAME = 'OwnerOverseasProbe.gs'

class Stop(Exception):
    pass


def load(environment):
    env = private_path(environment, False)
    plan = json.loads((env / 'fresh-plan.json').read_text())
    target(plan['scriptId'])
    if plan.get('sourceDigest') != source_digest():
        raise Stop('DEPLOYED_GAS_SOURCE_CHANGED')
    return env, plan


def original_deployment(client, folder, plan):
    dep = plan['url'].split('/')[-2]
    result = json.loads(client(['list-deployments', plan['scriptId']], folder, plan['scriptId']))
    if sum(d.get('deploymentId') == dep and d.get('versionNumber') == plan['activeVersion'] for d in result) != 1:
        raise Stop('ORIGINAL_DEPLOYMENT_CHANGED')


def install(environment, client=invoke, check=None):
    env, plan = load(environment)
    check = check or (lambda p: preflight(p, allow_same_source_tools=True))
    check(env)  # Original complete source/immutable/bindings checked before writes.
    root = env / 'owner-overseas-probe'
    if root.exists():
        raise Stop('PROBE_DIRECTORY_ALREADY_EXISTS_STOP')
    root.mkdir(mode=0o700)
    original = root / 'original';shutil.copytree(env / 'bundle', original)
    staged = root / 'staged';shutil.copytree(original, staged)
    (staged / NAME).write_text(TEMPLATE.read_text())
    archive = root / 'original-source.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in original.iterdir():
            z.write(p, p.name)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None or any(z.read(p.name) != p.read_bytes() for p in original.iterdir()):
            raise Stop('SOURCE_BACKUP_FAILED')
    metadata = {'phase':'PREPARED','files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in original.iterdir()},
                'probeSha256':hashlib.sha256(TEMPLATE.read_bytes()).hexdigest()}
    record = root / 'probe-plan.json';record.write_text(json.dumps(metadata, indent=2))
    for p in root.rglob('*'):
        p.chmod(0o700 if p.is_dir() else 0o600)
    with tempfile.TemporaryDirectory() as t:
        base = Path(t)
        if pull(client, base / 'before', plan['scriptId']) != logical(original):
            raise Stop('CONCURRENT_SOURCE_CHANGE')
        original_deployment(client, original, plan)
        client(['push','--force'], staged, plan['scriptId'])
        if pull(client, base / 'after', plan['scriptId']) != logical(staged):
            raise Stop('PROBE_SOURCE_READBACK_FAILED')
        original_deployment(client, original, plan)
    metadata['phase']='INSTALLED';record.write_text(json.dumps(metadata,indent=2))
    return {'status':'PASS','phase':'OWNER_EDITOR_PROBE_READY','sourceBackup':'PASS',
            'testHeadTemporarilyChanged':True,'existingDeploymentChanged':False,
            'storageWrites':False,'nhRequested':False,'sourceOrValuesIncluded':False}


def remove(environment, client=invoke):
    env,plan=load(environment);root=env/'owner-overseas-probe'
    if root.is_symlink() or any(p.is_symlink() for p in root.rglob('*')):
        raise Stop('PRIVATE_SOURCE_LAYOUT_REQUIRED')
    record=root/'probe-plan.json';metadata=json.loads(record.read_text())
    original=root/'original'
    names={p.name for p in original.iterdir() if p.is_file()}
    if names!=set(metadata['files']) or any(hashlib.sha256((original/name).read_bytes()).hexdigest()!=checksum for name,checksum in metadata['files'].items()):
        raise Stop('SOURCE_BACKUP_CHANGED')
    with tempfile.TemporaryDirectory() as t:
        base=Path(t);expected=base/'expected';build(plan['scriptId'],plan['revision'],expected)
        if logical(original)!=logical(expected):
            raise Stop('SOURCE_BACKUP_CHANGED')
        staged=base/'staged';shutil.copytree(original,staged)
        template=TEMPLATE.read_bytes()
        if hashlib.sha256(template).hexdigest()!=metadata['probeSha256']:
            raise Stop('PROBE_TEMPLATE_CHANGED')
        (staged/NAME).write_bytes(template)
        current=pull(client,base/'current',plan['scriptId'])
        if current not in (logical(original),logical(staged)):
            raise Stop('CONCURRENT_SOURCE_CHANGE')
        original_deployment(client,original,plan)
        if current!=logical(original):
            client(['push','--force'],original,plan['scriptId'])
        if pull(client,base/'restored',plan['scriptId'])!=logical(original):
            raise Stop('SOURCE_RESTORE_READBACK_FAILED')
        original_deployment(client,original,plan)
    metadata['phase']='REMOVED';record.write_text(json.dumps(metadata,indent=2))
    return {'status':'PASS','phase':'ORIGINAL_TEST_HEAD_RESTORED','existingDeploymentChanged':False,
            'storageWrites':False,'nhRequested':False,'sourceOrValuesIncluded':False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode',choices=['install','remove'])
    p.add_argument('--environment',type=Path,required=True)
    a=p.parse_args()
    try:
        result=install(a.environment) if a.mode=='install' else remove(a.environment)
    except Exception:
        result={'status':'FAIL','code':'OWNER_PROBE_STEP_FAILED_STOP','ownerSourceReviewRequired':True,
                'storageWrites':False,'nhRequested':False,'sourceOrValuesIncluded':False}
    print(json.dumps(result))
    return 0 if result['status']=='PASS' else 1

if __name__=='__main__':raise SystemExit(main())
