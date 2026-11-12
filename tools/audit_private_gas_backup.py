"""Owner-only OFFLINE audit of private GAS backups. No network, source output or writes."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import zipfile

from prepare_gas_backup import has_git_parent
from build_nh_staging import PRODUCTION_SCRIPT_ID, PRODUCTION_DEPLOYMENT_ID

SAFE_FAILURES = {'PRIVATE_BACKUP_OUTSIDE_GIT_REQUIRED', 'BACKUP_IDENTITY_MISMATCH',
                 'BACKUP_SCHEMA_INVALID', 'BACKUP_CONTENT_MISMATCH', 'BACKUP_ARCHIVE_MISMATCH',
                 'BACKUP_SYMLINK_REFUSED', 'CODE_SOURCE_NOT_FOUND'}
PATTERNS = {
    'LOG_SINK_REVIEW': r'\b(?:Logger|console)\s*(?:\.\s*(?:log|error|warn|info|debug|trace)|\[\s*[\'"](?:log|error|warn|info|debug|trace)[\'"]\s*\])\s*\(',
    'EXCEPTION_TEXT_REVIEW': r'\.\s*(?:message|stack)\b|\bString\s*\(\s*(?:e|err|error)\s*\)',
    'UPSTREAM_TEXT_REVIEW': r'\brsp_msg\b|\.\s*getContentText\s*\(',
    'RESPONSE_SINK_REVIEW': r'\bjsonResponse\s*\(|\.\s*createTextOutput\s*\(',
    'THROW_REVIEW': r'\bthrow\b',
    'CATCH_REVIEW': r'\bcatch\s*\(',
}


def checked_backup(folder):
    folder = Path(folder).absolute()
    if any(p.is_symlink() for p in [folder, *folder.parents]) or any(p.is_symlink() for p in folder.rglob('*')):
        raise ValueError('BACKUP_SYMLINK_REFUSED')
    if has_git_parent(folder):
        raise ValueError('PRIVATE_BACKUP_OUTSIDE_GIT_REQUIRED')
    data = json.loads((folder / 'inventory.json').read_text())
    if data.get('scriptId') != PRODUCTION_SCRIPT_ID or data.get('deploymentId') != PRODUCTION_DEPLOYMENT_ID:
        raise ValueError('BACKUP_IDENTITY_MISMATCH')
    if type(data.get('activeVersion')) is not int or data['activeVersion'] < 1 or type(data.get('headMatchesDeployed')) is not bool:
        raise ValueError('BACKUP_SCHEMA_INVALID')
    if set(data.get('files', {})) != {'head', 'deployed'}:
        raise ValueError('BACKUP_SCHEMA_INVALID')
    try:
        created = datetime.datetime.fromisoformat(data['createdAt'])
        if created.tzinfo is None:
            raise ValueError()
        data['createdAt'] = created.astimezone(datetime.timezone.utc).isoformat()
    except (KeyError, TypeError, ValueError):
        raise ValueError('BACKUP_SCHEMA_INVALID') from None
    archive = zipfile.ZipFile(folder / 'source-backup.zip')
    with archive:
        if archive.testzip() is not None:
            raise ValueError('BACKUP_ARCHIVE_MISMATCH')
        for snapshot in ('head', 'deployed'):
            manifest = data['files'][snapshot]
            if not isinstance(manifest, dict) or 'appsscript.json' not in manifest:
                raise ValueError('BACKUP_SCHEMA_INVALID')
            actual = {str(p.relative_to(folder / snapshot)) for p in (folder / snapshot).rglob('*') if p.is_file() and p.name != '.clasp.json'}
            if actual != set(manifest):
                raise ValueError('BACKUP_CONTENT_MISMATCH')
            for name, digest in manifest.items():
                # Names and contents are private input. Never echo them in failures.
                relative = Path(name)
                if relative.is_absolute() or '..' in relative.parts or not re.fullmatch(r'[a-f0-9]{64}', str(digest)):
                    raise ValueError('BACKUP_SCHEMA_INVALID')
                content = (folder / snapshot / relative).read_bytes()
                if hashlib.sha256(content).hexdigest() != digest:
                    raise ValueError('BACKUP_CONTENT_MISMATCH')
                archive_name = snapshot + '/' + name
                if archive_name not in archive.namelist() or hashlib.sha256(archive.read(archive_name)).hexdigest() != digest:
                    raise ValueError('BACKUP_ARCHIVE_MISMATCH')
    if data['headMatchesDeployed'] != (data['files']['head'] == data['files']['deployed']):
        raise ValueError('BACKUP_SCHEMA_INVALID')
    return data


def scan_code(text, snapshot):
    # Conservative review locations, not a parser or a proof of absence. Even a
    # literal-only log or authenticated normal response requires owner review.
    findings = []
    for code, pattern in PATTERNS.items():
        for match in re.finditer(pattern, text):
            findings.append({'snapshot': snapshot, 'module': 'Code',
                             'line': text.count('\n', 0, match.start()) + 1, 'code': code})
    return sorted(findings, key=lambda item: (item['line'], item['code']))


def audit(current, previous=None):
    current = Path(current).absolute()
    data = checked_backup(current)
    old = checked_backup(previous) if previous else None
    findings = []
    for snapshot in ('head', 'deployed'):
        candidates = [name for name in data['files'][snapshot] if Path(name).stem == 'Code' and Path(name).suffix in ('.js', '.gs')]
        if len(candidates) != 1:
            raise ValueError('CODE_SOURCE_NOT_FOUND')
        findings.extend(scan_code((current / snapshot / candidates[0]).read_text(), snapshot))
    unchanged = data['files'] == old['files'] if old else None
    version26 = data['activeVersion'] == 26
    return {
        'status': 'OWNER_REVIEW_REQUIRED', 'productionDeploymentIdentityMatched': True,
        'activeVersion': data['activeVersion'],
        'matchesRecoveryVersion26': version26, 'headMatchesDeployed': data['headMatchesDeployed'],
        'sourceUnchangedSincePrevious': unchanged,
        'sameDeploymentVersionAsPrevious': data['activeVersion'] == old['activeVersion'] if old else None,
        'backupContentAndArchiveIntegrity': 'PASS',
        'backupCreatedAtUTC': data['createdAt'],
        'previousBackupCreatedAtUTC': old['createdAt'] if old else None,
        'codeReviewStatus': 'LOCATIONS_REQUIRE_REVIEW' if findings else 'NO_PATTERNS_FOUND_NOT_AUDIT_PASS',
        'findings': findings,
        'sourceBackupGatePassed': version26 and data['headMatchesDeployed'] and unchanged is True and old['activeVersion'] == 26,
        'stopProductionRelease': True,  # Code, access, data backups and approval still require owner review.
        'webAppRunAsAndAccess': 'OWNER_UI_VERIFICATION_REQUIRED',
        'sheetsBackupFreshness': 'OWNER_VERIFICATION_REQUIRED',
        'propertiesBackupFreshness': 'OWNER_VERIFICATION_REQUIRED',
        'productionChanged': False, 'privateSourceOrValuesIncluded': False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--current', type=Path, required=True)
    parser.add_argument('--previous', type=Path)
    args = parser.parse_args()
    try:
        result = audit(args.current, args.previous)
        print(json.dumps(result))
        return 0 if result['sourceBackupGatePassed'] else 2
    except Exception as error:
        code = str(error) if str(error) in SAFE_FAILURES else 'PRIVATE_BACKUP_AUDIT_FAILED'
        print(json.dumps({'status': 'BLOCKED', 'code': code, 'productionChanged': False,
                          'privateSourceOrValuesIncluded': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
