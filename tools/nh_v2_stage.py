"""Owner-run TEST-only V2 backup/prepare/apply. Captures private clasp output; never calls NH.

Default: read-only source backup and local bundle preparation. --apply updates only the
fixed test project/deployment, after private Sheet/settings backup confirmations.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time
import zipfile

from build_nh_staging import ROOT, MANIFEST, SOURCES, build, source_digest
from nh_staging_test import WebApp, fingerprint, validate_target

SCRIPT = '1Yt2DM0m4wObHnH0ZqgMh0KMzXnK_O3YH7beDGkEcUCN5gOY832AjSzmw'
SHEET = '1oQA2wD_0jtGVOezLclzUyejsYA2Z-3X_kkD7-by0tsY'
DEPLOYMENT = 'AKfycbx5s1yhQGKUytKLAE8c6UdZA2wRzenCA3nB-EnP-BpvGGTdYMJvxY8hdzEuWEpWBXkFbQ'
URL = 'https://script.google.com/macros/s/' + DEPLOYMENT + '/exec'
BASELINE = 'd99b9a06c52ffd43b644b306d8c8b96bb1da3188'
BASE_SOURCES = ['gas/Security.gs', 'gas/SecurityKdf.gs', 'gas/ExternalHoldings.gs', 'gas/Nhplug.gs', 'tests/staging/StagingBridge.gs']


class Stop(Exception):
    pass


def git(*args):
    r = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, timeout=30)
    if r.returncode:
        raise Stop('REPOSITORY_CHECK_FAILED')
    return r.stdout


def logical(folder):
    result = {}
    for p in Path(folder).iterdir():
        if p.is_symlink():
            raise Stop('SOURCE_LAYOUT_REFUSED')
        if p.name == '.clasp.json':
            continue
        if not p.is_file():
            raise Stop('SOURCE_LAYOUT_REFUSED')
        if p.name == 'appsscript.json':
            name, text = 'appsscript', json.dumps(json.loads(p.read_text()), sort_keys=True)
        elif p.suffix in ('.gs', '.js'):
            name, text = p.stem, p.read_text().replace('\r\n', '\n').strip()
        else:
            raise Stop('SOURCE_LAYOUT_REFUSED')
        if name in result:
            raise Stop('SOURCE_LAYOUT_REFUSED')
        result[name] = text
    return result


def baseline_bundle():
    data = {p: git('show', BASELINE + ':' + p) for p in BASE_SOURCES}
    digest = hashlib.sha256()
    for name, raw in data.items():
        digest.update(name.encode() + b'\0' + str(len(raw)).encode() + b'\0' + raw)
    digest.update(json.dumps(MANIFEST, sort_keys=True).encode())
    value = {}
    for name, raw in data.items():
        text = raw.decode().replace('__SCRIPT_ID__', SCRIPT).replace('__REVISION__', BASELINE).replace('__SOURCE_DIGEST__', digest.hexdigest())
        value[Path(name).stem] = text.replace('\r\n', '\n').strip()
    value['appsscript'] = json.dumps(MANIFEST, sort_keys=True)
    return value, digest.hexdigest()


def config(folder):
    return json.loads((Path(folder) / '.clasp.json').read_text()) == {'scriptId': SCRIPT, 'rootDir': '.'}


def clasp(args, folder):
    if args[0] == 'list-deployments':
        valid = args == ['list-deployments', SCRIPT]
    else:
        valid = args[0] in ('pull', 'push', 'create-version', 'update-deployment') and config(folder)
        if args[0] == 'update-deployment':
            valid = valid and len(args) > 1 and args[1] == DEPLOYMENT
    if not valid:
        raise Stop('TEST_TARGET_REQUIRED')
    r = subprocess.run(['npx', '--yes', '@google/clasp@3.4.1', '--json', *args], cwd=folder,
                       capture_output=True, text=True, timeout=180)
    if r.returncode:
        raise Stop('CLASP_FAILED')
    return r.stdout


def configured(folder):
    folder.mkdir(mode=0o700)
    (folder / '.clasp.json').write_text(json.dumps({'scriptId': SCRIPT, 'rootDir': '.'}))
    return folder


def deployment(client, folder):
    data = json.loads(client(['list-deployments', SCRIPT], folder))
    found = [x for x in data if x.get('deploymentId') == DEPLOYMENT]
    if len(found) != 1 or type(found[0].get('versionNumber')) is not int:
        raise Stop('DEPLOYMENT_IDENTITY_FAILED')
    return found[0]


def pull(client, work, label, version=None):
    folder = configured(work / label)
    client(['pull'] + (['--versionNumber', str(version)] if version else []), folder)
    return folder, logical(folder)


def check_metadata(value, revision, digest, v2=False):
    valid = value.get('testEnvironment') == 'nh-staging' and value.get('scriptHash') == fingerprint(SCRIPT) and value.get('sheetHash') == fingerprint(SHEET) and value.get('storeVersion') == 2 and value.get('revision') == revision and value.get('sourceDigest') == digest
    if v2:
        valid = valid and value.get('gatewayVersion') == 2 and value.get('storeEngine') == 'account-store-v2'
    if not valid:
        raise Stop('TEST_BINDING_OR_SOURCE_MISMATCH')


def has_git_parent(path):
    return any((p / '.git').exists() for p in [path, *path.parents])


def run(output, apply=False, settings=False, sheet_backup=False, client=clasp, metadata=None):
    validate_target(URL, SCRIPT, SHEET)
    metadata = metadata or (lambda: WebApp(URL).call('appVersion'))
    raw = Path(output).absolute()
    if any(p.is_symlink() for p in [raw, *raw.parents]):
        raise Stop('NEW_PRIVATE_DIRECTORY_REQUIRED')
    output = raw.resolve()
    if output.exists() or has_git_parent(output):
        raise Stop('NEW_PRIVATE_DIRECTORY_REQUIRED')
    if git('status', '--porcelain', '--untracked-files=no').strip():
        raise Stop('CLEAN_COMMITTED_SOURCE_REQUIRED')
    revision = git('rev-parse', 'HEAD').decode().strip()
    expected_old, old_digest = baseline_bundle()
    check_metadata(metadata(), BASELINE, old_digest)
    if apply and not (settings and sheet_backup):
        raise Stop('PRIVATE_SHEET_AND_SETTINGS_BACKUPS_REQUIRED')
    output.mkdir(parents=True, mode=0o700)
    writes = False
    report = {'status': 'BLOCKED', 'productionChanged': False, 'sheetsOrPropertiesWrites': False, 'nhRequested': False, 'sourceOrValuesIncluded': False}
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp)
        old = deployment(client, output)
        if old['versionNumber'] != 2:
            raise Stop('EXPECTED_TEST_VERSION_2_REQUIRED')
        head, current = pull(client, output, 'head')
        deployed, active = pull(client, output, 'deployed', 2)
        if current != expected_old or active != expected_old:
            raise Stop('UNEXPECTED_TEST_SOURCE_STOP')
        manifest = {'activeVersion': 2, 'headMatchesDeployed': True, 'files': {}}
        for folder in (head, deployed):
            for p in folder.iterdir():
                p.chmod(0o600)
            manifest['files'][folder.name] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir() if p.name != '.clasp.json'}
        (output / 'inventory.json').write_text(json.dumps(manifest, indent=2))
        archive = output / 'source-backup.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
            for folder in (head, deployed):
                for p in folder.iterdir():
                    z.write(p, str(p.relative_to(output)))
            z.write(output / 'inventory.json', 'inventory.json')
        with zipfile.ZipFile(archive) as z:
            if z.testzip() is not None:
                raise Stop('BACKUP_INTEGRITY_FAILED')
            for folder in (head, deployed):
                for p in folder.iterdir():
                    if z.read(str(p.relative_to(output))) != p.read_bytes():
                        raise Stop('BACKUP_INTEGRITY_FAILED')
        bundle = output / 'v2-bundle'
        build(SCRIPT, revision, bundle)
        target = logical(bundle)
        for p in output.rglob('*'):
            p.chmod(0o700 if p.is_dir() else 0o600)
        report.update({'sourceBackup': 'PASS', 'archiveIntegrity': 'PASS', 'testVersionBefore': 2,
                       'revision': revision, 'sourceDigest': source_digest(), 'mode': 'TEST_V2_PREPARE',
                       'status': 'PREPARED', 'remoteWrites': False})
        if not apply:
            return report
        new_version = None
        try:
            _, guard = pull(client, work, 'guard')
            if guard != current or deployment(client, output)['versionNumber'] != 2:
                raise Stop('CONCURRENT_CHANGE_STOP')
            check_metadata(metadata(), BASELINE, old_digest)
            writes = True
            client(['push', '--force'], bundle)
            _, check = pull(client, work, 'uploaded')
            if check != target:
                raise Stop('UPLOAD_READBACK_MISMATCH')
            created = json.loads(client(['create-version', 'NH V2 isolated ' + revision[:12]], bundle))
            new_version = created.get('versionNumber')
            if type(new_version) is not int or new_version <= 2:
                raise Stop('NEW_TEST_VERSION_INVALID')
            _, check = pull(client, work, 'immutable', new_version)
            if check != target:
                raise Stop('IMMUTABLE_SOURCE_MISMATCH')
            client(['update-deployment', DEPLOYMENT, '--versionNumber', str(new_version), '--description', old.get('description', '')], bundle)
            for attempt in range(6):
                version = deployment(client, output)['versionNumber']
                if version == new_version:
                    try:
                        check_metadata(metadata(), revision, source_digest(), True)
                        break
                    except Stop:
                        if attempt == 5:
                            raise
                elif version != 2:
                    raise Stop('UNEXPECTED_DEPLOYMENT_CHANGE')
                if attempt == 5:
                    raise Stop('DEPLOYMENT_READBACK_MISMATCH')
                time.sleep(2)
            _, check = pull(client, work, 'final-head')
            if check != target:
                raise Stop('FINAL_SOURCE_MISMATCH')
            report.update({'mode': 'TEST_V2_APPLY', 'status': 'PASS', 'remoteWrites': True,
                           'activeTestVersion': new_version, 'sourceReadbackMatches': True,
                           'sourceDigestMatches': True, 'recovery': 'NOT_NEEDED'})
        except Exception:
            report.update({'mode': 'TEST_V2_APPLY', 'status': 'FAIL', 'code': 'TEST_V2_APPLY_FAILED', 'remoteWrites': writes, 'recovery': 'NOT_NEEDED'})
            if writes:
                try:
                    _, latest = pull(client, work, 'recovery-head')
                    version = deployment(client, output)['versionNumber']
                    if latest not in (target, current) or version not in (2, new_version):
                        raise Stop('CONCURRENT_CHANGE_STOP')
                    if version != 2:
                        client(['update-deployment', DEPLOYMENT, '--versionNumber', '2', '--description', old.get('description', '')], head)
                    if latest != current:
                        client(['push', '--force'], head)
                    _, restored = pull(client, work, 'restored-head')
                    if restored != current or deployment(client, output)['versionNumber'] != 2:
                        raise Stop('RECOVERY_READBACK_FAILED')
                    report['recovery'] = 'PASS_TEST_SOURCE_AND_DEPLOYMENT_RESTORED'
                except Exception:
                    report['recovery'] = 'OWNER_RECOVERY_REQUIRED'
        return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--settings-backup-confirmed', action='store_true')
    p.add_argument('--sheet-backup-confirmed', action='store_true')
    a = p.parse_args()
    try:
        result = run(a.output, a.apply, a.settings_backup_confirmed, a.sheet_backup_confirmed)
    except Exception:
        result = {'status': 'BLOCKED', 'code': 'TEST_V2_PREFLIGHT_FAILED', 'nhRequested': False, 'productionChanged': False, 'sourceOrValuesIncluded': False}
    print(json.dumps(result))
    return 0 if result['status'] in ('PASS', 'PREPARED') else 1


if __name__ == '__main__':
    raise SystemExit(main())
