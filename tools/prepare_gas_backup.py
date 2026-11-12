"""Owner-run READ-ONLY GAS backup. Never deploys, edits Sheets, or prints source.

Run in the owner's already authenticated Cloud Shell. Private copies stay outside
Git. A successful source backup does not mean Sheets/Properties are backed up.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

from build_nh_staging import ROOT, PRODUCTION_SCRIPT_ID, PRODUCTION_DEPLOYMENT_ID


def clasp_read(arguments, cwd):
    if arguments[0] not in ('list-deployments', 'pull'):
        raise ValueError('READ_ONLY_COMMAND_REQUIRED')
    result = subprocess.run(['npx', '--yes', '@google/clasp@3.4.1', '--json', *arguments], cwd=cwd,
                            capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise ValueError('CLASP_READ_FAILED')
    return result.stdout


def deployed_version(client, cwd):
    data = json.loads(client(['list-deployments', PRODUCTION_SCRIPT_ID], cwd))
    found = [d for d in data if d.get('deploymentId') == PRODUCTION_DEPLOYMENT_ID]
    if len(found) != 1 or type(found[0].get('versionNumber')) is not int or found[0]['versionNumber'] < 1:
        raise ValueError('IMMUTABLE_DEPLOYMENT_NOT_FOUND')
    return found[0]['versionNumber']


def inventory(folder):
    files = {}
    for path in folder.rglob('*'):
        if path.is_symlink():
            raise ValueError('BACKUP_SYMLINK_REFUSED')
        path.chmod(0o700 if path.is_dir() else 0o600)
        if path.is_file() and path.name != '.clasp.json':
            files[str(path.relative_to(folder))] = hashlib.sha256(path.read_bytes()).hexdigest()
    if 'appsscript.json' not in files or not any(p.endswith(('.js', '.gs')) for p in files):
        raise ValueError('GAS_SOURCE_BACKUP_INCOMPLETE')
    return files


def has_git_parent(path):
    return any((p / '.git').exists() for p in [path, *path.parents])


def prepare_backup(output, client=clasp_read):
    output = Path(output).resolve()
    if output.is_relative_to(ROOT.resolve()) or has_git_parent(output):
        raise ValueError('PRIVATE_BACKUP_MUST_STAY_OUTSIDE_GIT')
    if output.exists():
        raise ValueError('NEW_BACKUP_DIRECTORY_REQUIRED')
    output.mkdir(parents=True, mode=0o700)
    output.chmod(0o700)
    version = deployed_version(client, output)
    snapshots = {}
    for name, args in [('head', ['pull']), ('deployed', ['pull', '--versionNumber', str(version)])]:
        folder = output / name
        folder.mkdir(mode=0o700)
        config = folder / '.clasp.json'
        config.write_text(json.dumps({'scriptId': PRODUCTION_SCRIPT_ID, 'rootDir': '.'}))
        config.chmod(0o600)
        client(args, folder)
        snapshots[name] = inventory(folder)
    if deployed_version(client, output) != version:
        raise ValueError('DEPLOYMENT_CHANGED_DURING_BACKUP')
    same = snapshots['head'] == snapshots['deployed']
    metadata = {'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'scriptId': PRODUCTION_SCRIPT_ID, 'deploymentId': PRODUCTION_DEPLOYMENT_ID,
                'activeVersion': version, 'headMatchesDeployed': same, 'files': snapshots}
    metadata_file = output / 'inventory.json'
    metadata_file.write_text(json.dumps(metadata, indent=2) + '\n')
    metadata_file.chmod(0o600)
    archive = output / 'source-backup.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as bundle:
        for file in sorted(output.rglob('*')):
            if file.is_file() and file != archive:
                bundle.write(file, str(file.relative_to(output)))
    archive.chmod(0o600)
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise ValueError('BACKUP_ARCHIVE_INVALID')
    return {'status': 'GAS_SOURCE_BACKUP_CREATED' if same else 'STOP_REVIEW_UNPUBLISHED_GAS',
            'activeVersion': version, 'headMatchesDeployed': same, 'sourceBackupCreated': True,
            'archiveIntegrity': 'PASS', 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'sheetsBackupVerified': False, 'propertiesBackupVerified': False,
            'productionChanged': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = prepare_backup(args.output)
        print(json.dumps(result))
        return 0 if result['headMatchesDeployed'] else 2
    except Exception as error:
        # CLI/API errors can contain private source, credentials, or paths.
        safe = {'READ_ONLY_COMMAND_REQUIRED', 'CLASP_READ_FAILED', 'IMMUTABLE_DEPLOYMENT_NOT_FOUND',
                'BACKUP_SYMLINK_REFUSED', 'GAS_SOURCE_BACKUP_INCOMPLETE',
                'PRIVATE_BACKUP_MUST_STAY_OUTSIDE_GIT', 'NEW_BACKUP_DIRECTORY_REQUIRED',
                'DEPLOYMENT_CHANGED_DURING_BACKUP', 'BACKUP_ARCHIVE_INVALID'}
        code = str(error) if str(error) in safe else 'GAS_BACKUP_PREPARATION_FAILED'
        print(json.dumps({'status': 'FAILED', 'code': code,
                          'productionChanged': False, 'sourceBackupVerified': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
