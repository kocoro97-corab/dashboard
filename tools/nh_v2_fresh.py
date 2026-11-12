"""Owner-only creation/publishing of a NEW isolated V2 project. No NH calls or existing resource updates."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile

from build_nh_staging import ROOT, build, source_digest, PRODUCTION_SCRIPT_ID, PRODUCTION_DEPLOYMENT_ID, PRODUCTION_SHEET_HASH
from nh_staging_test import WebApp, fingerprint, validate_target
from nh_v2_stage import SCRIPT as OLD_SCRIPT, SHEET as OLD_SHEET, DEPLOYMENT as OLD_DEPLOYMENT, logical, git, has_git_parent


class Stop(Exception):
    pass


def private_path(value, new):
    raw = Path(value).absolute()
    if any(p.is_symlink() for p in [raw, *raw.parents]):
        raise Stop('PRIVATE_LOCATION_REQUIRED')
    p = raw.resolve()
    if has_git_parent(p) or new and p.exists() or not new and not p.is_dir():
        raise Stop('PRIVATE_LOCATION_REQUIRED')
    return p


def target(script):
    if script == OLD_SCRIPT:
        raise Stop('EXISTING_TEST_TARGET_REFUSED')
    validate_target('https://script.google.com/macros/s/SYNTHETIC_NEW_DEPLOYMENT/exec', script, 'SYNTHETIC_NEW_SHEET_123456789')


def invoke(args, folder, script=None):
    if script is None:
        if args[:3] != ['create', '--type', 'standalone'] or len(args) != 5 or args[3] != '--title' or (folder / '.clasp.json').exists():
            raise Stop('NEW_STANDALONE_ONLY')
    else:
        target(script)
        if json.loads((folder / '.clasp.json').read_text()) != {'scriptId': script, 'rootDir': '.'}:
            raise Stop('TARGET_CONFIG_MISMATCH')
        valid = (args == ['push', '--force'] or args == ['pull']
                 or len(args) == 3 and args[:2] == ['pull', '--versionNumber'] and args[2].isdigit()
                 or len(args) == 2 and args[0] == 'create-version'
                 or len(args) == 5 and args[:2] == ['create-deployment', '--versionNumber'] and args[2].isdigit() and args[3] == '--description'
                 or args == ['list-deployments', script])
        if not valid:
            raise Stop('COMMAND_REFUSED')
    r = subprocess.run(['npx', '--yes', '@google/clasp@3.4.1', '--json', '--project', str(folder / '.clasp.json'), *args],
                       cwd=folder, capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise Stop('OWNER_CLASP_AUTH_OR_COMMAND_FAILED')
    return r.stdout


def pull(client, root, script, version=None):
    root.mkdir(mode=0o700)
    (root / '.clasp.json').write_text(json.dumps({'scriptId': script, 'rootDir': '.'}))
    client(['pull'] + (['--versionNumber', str(version)] if version else []), root, script)
    return logical(root)


def revision():
    if git('status', '--porcelain', '--untracked-files=no').strip():
        raise Stop('CLEAN_REVIEWED_SOURCE_REQUIRED')
    return git('rev-parse', 'HEAD').decode().strip()


def create(output, client=invoke):
    output = private_path(output, True)
    rev = revision()
    output.mkdir(parents=True, mode=0o700)
    initial = output / 'initial';initial.mkdir(mode=0o700)
    made = json.loads(client(['create', '--type', 'standalone', '--title', 'NH-STAGING V2 FRESH ' + rev[:12]], initial, None))
    script = made.get('scriptId');target(script)
    if json.loads((initial / '.clasp.json').read_text()).get('scriptId') != script:
        raise Stop('CREATED_PROJECT_IDENTITY_FAILED')
    # The initial source is from this invocation's newly created project, never an existing project.
    archive = output / 'initial-source.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in initial.iterdir():
            if not p.is_file() or p.is_symlink():
                raise Stop('SOURCE_LAYOUT_REFUSED')
            z.write(p, p.name)
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:
            raise Stop('BACKUP_INVALID')
        for p in initial.iterdir():
            if z.read(p.name) != p.read_bytes():
                raise Stop('BACKUP_INVALID')
    bundle = output / 'bundle';build(script, rev, bundle)
    client(['push', '--force'], bundle, script)
    with tempfile.TemporaryDirectory() as t:
        if pull(client, Path(t) / 'check', script) != logical(bundle):
            raise Stop('SOURCE_READBACK_FAILED')
    plan = {'scriptId': script, 'revision': rev, 'sourceDigest': source_digest(), 'phase': 'OWNER_PRIVATE_SETUP_REQUIRED',
            'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
    (output / 'fresh-plan.json').write_text(json.dumps(plan, indent=2))
    for p in output.rglob('*'):
        p.chmod(0o700 if p.is_dir() else 0o600)
    return {'status': 'PASS', 'phase': plan['phase'], 'newProjectCreated': True, 'sourceReadback': 'PASS',
            'initialSourceBackup': 'PASS', 'existingResourcesChanged': False, 'nhRequested': False}


def publish(output, client=invoke, metadata=None):
    output = private_path(output, False)
    plan = json.loads((output / 'fresh-plan.json').read_text());script = plan['scriptId'];target(script)
    if plan['phase'] != 'OWNER_PRIVATE_SETUP_REQUIRED' or plan['revision'] != revision() or plan['sourceDigest'] != source_digest():
        raise Stop('PLAN_OR_SOURCE_CHANGED')
    bundle = output / 'bundle'
    with tempfile.TemporaryDirectory() as t:
        root = Path(t)
        if pull(client, root / 'before', script) != logical(bundle):
            raise Stop('SOURCE_READBACK_FAILED')
        if any(type(d.get('versionNumber')) is int for d in json.loads(client(['list-deployments', script], bundle, script))):
            raise Stop('EXISTING_DEPLOYMENT_REFUSED')
        version = json.loads(client(['create-version', 'V2 fresh isolated ' + plan['revision'][:12]], bundle, script)).get('versionNumber')
        if type(version) is not int or version < 1:
            raise Stop('IMMUTABLE_VERSION_FAILED')
        if pull(client, root / 'immutable', script, version) != logical(bundle):
            raise Stop('IMMUTABLE_SOURCE_FAILED')
        value = json.loads(client(['create-deployment', '--versionNumber', str(version), '--description', 'V2 fresh read-only verification'], bundle, script))
        dep = value.get('deploymentId')
        if not isinstance(dep, str) or dep in (PRODUCTION_DEPLOYMENT_ID, OLD_DEPLOYMENT) or value.get('versionNumber') != version:
            raise Stop('DEPLOYMENT_IDENTITY_FAILED')
        url = 'https://script.google.com/macros/s/' + dep + '/exec'
        validate_target(url, script, 'SYNTHETIC_NEW_SHEET_123456789')
        plan.update(url=url, activeVersion=version, phase='PUBLIC_METADATA_VERIFICATION_REQUIRED')
        (output / 'fresh-plan.json').write_text(json.dumps(plan, indent=2))
        m = metadata(url) if metadata else WebApp(url).call('appVersion')
        if not (m.get('freshTestEnvironment') is True and m.get('testEnvironment') == 'nh-staging' and m.get('scriptHash') == fingerprint(script)
                and m.get('sheetHash') not in (None, PRODUCTION_SHEET_HASH, fingerprint(OLD_SHEET)) and m.get('sourceDigest') == source_digest()
                and m.get('revision') == plan['revision'] and m.get('storeEngine') == 'account-store-v2' and m.get('storeVersion') == 2):
            raise Stop('FRESH_ENVIRONMENT_NOT_CONFIRMED')
        plan.update(sheetHash=m['sheetHash'], phase='NH_AUTH_APPROVAL_REQUIRED')
        (output / 'fresh-plan.json').write_text(json.dumps(plan, indent=2));(output / 'fresh-plan.json').chmod(0o600)
    return {'status': 'PASS', 'phase': plan['phase'], 'sourceDigest': 'PASS', 'freshEnvironment': 'PASS',
            'existingResourcesChanged': False, 'nhRequested': False}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['create', 'publish'])
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    try:
        result = create(a.output) if a.mode == 'create' else publish(a.output)
    except Exception:
        result = {'status': 'FAIL', 'code': 'FRESH_OWNER_STEP_FAILED_STOP', 'existingResourcesChanged': False, 'nhRequested': False}
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
