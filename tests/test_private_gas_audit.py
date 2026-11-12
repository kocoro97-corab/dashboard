import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import audit_private_gas_backup as audit

CANARY = 'SYNTHETIC_PRIVATE_CANARY'


def make_backup(folder, source='function test(){Logger.log("'+CANARY+'");}', version=26, unpublished=False):
    folder.mkdir()
    manifests = {}
    for snapshot in ['head', 'deployed']:
        target = folder / snapshot
        target.mkdir()
        (target / 'Code.js').write_text(source + ('\n// unpublished' if unpublished and snapshot == 'head' else ''))
        (target / 'appsscript.json').write_text('{"runtimeVersion":"V8"}')
        manifests[snapshot] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in target.iterdir()}
    data = {'createdAt': '2026-11-12T00:00:00+00:00', 'scriptId': audit.PRODUCTION_SCRIPT_ID,
            'deploymentId': audit.PRODUCTION_DEPLOYMENT_ID, 'activeVersion': version,
            'headMatchesDeployed': not unpublished, 'files': manifests}
    (folder / 'inventory.json').write_text(json.dumps(data))
    with zipfile.ZipFile(folder / 'source-backup.zip', 'w') as bundle:
        for snapshot in manifests:
            for name in manifests[snapshot]:
                bundle.write(folder / snapshot / name, snapshot + '/' + name)
    return folder


class PrivateAuditTests(unittest.TestCase):
    def setUp(self):
        # Model an owner non-Git directory; production guard remains strict.
        stub = patch.object(audit, 'has_git_parent', return_value=False)
        stub.start()
        self.addCleanup(stub.stop)

    def test_only_safe_locations_are_reported_and_inputs_remain_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            old = make_backup(root / 'old')
            current = make_backup(root / 'current')
            before = {str(p): (p.read_bytes(), p.stat().st_mtime_ns, p.stat().st_mode) for p in root.rglob('*') if p.is_file()}
            report = audit.audit(current, old)
            self.assertTrue(report['sourceBackupGatePassed'])
            self.assertTrue(report['stopProductionRelease'])
            self.assertTrue(report['matchesRecoveryVersion26'])
            self.assertEqual(report['codeReviewStatus'], 'LOCATIONS_REQUIRE_REVIEW')
            self.assertNotIn(CANARY, json.dumps(report))
            self.assertNotIn('Logger.log', json.dumps(report))
            self.assertEqual(report['findings'][0], {'snapshot': 'head', 'module': 'Code', 'line': 1, 'code': 'LOG_SINK_REVIEW'})
            self.assertEqual(before, {str(p): (p.read_bytes(), p.stat().st_mtime_ns, p.stat().st_mode) for p in root.rglob('*') if p.is_file()})

    def test_changed_source_or_new_version_blocks_the_source_backup_gate(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            old = make_backup(root / 'old')
            for index, options in enumerate([{'source': 'changed synthetic'}, {'version': 27}, {'unpublished': True}]):
                report = audit.audit(make_backup(root / str(index), **options), old)
                self.assertFalse(report['sourceBackupGatePassed'])
                self.assertTrue(report['stopProductionRelease'])

    def test_missing_previous_is_not_unchanged_or_freshness_pass(self):
        with tempfile.TemporaryDirectory() as root:
            report = audit.audit(make_backup(Path(root) / 'current'))
            self.assertIsNone(report['sourceUnchangedSincePrevious'])
            self.assertFalse(report['sourceBackupGatePassed'])

    def test_local_tampering_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            current = make_backup(Path(root) / 'current')
            (current / 'deployed/Code.js').write_text(CANARY)
            with self.assertRaisesRegex(ValueError, 'BACKUP_CONTENT_MISMATCH'):
                audit.audit(current)

    def test_different_archive_is_not_restore_verified(self):
        with tempfile.TemporaryDirectory() as root:
            current = make_backup(Path(root) / 'current')
            with zipfile.ZipFile(current / 'source-backup.zip', 'w') as bundle:
                bundle.writestr('head/Code.js', CANARY)
            with self.assertRaisesRegex(ValueError, 'BACKUP_ARCHIVE_MISMATCH'):
                audit.audit(current)

    def test_wrong_identity_and_git_paths_are_refused(self):
        with tempfile.TemporaryDirectory() as root:
            current = make_backup(Path(root) / 'current')
            meta = json.loads((current / 'inventory.json').read_text())
            meta['scriptId'] = CANARY
            (current / 'inventory.json').write_text(json.dumps(meta))
            with self.assertRaisesRegex(ValueError, 'BACKUP_IDENTITY_MISMATCH'):
                audit.audit(current)
            with patch.object(audit, 'has_git_parent', return_value=True), self.assertRaisesRegex(ValueError, 'OUTSIDE_GIT'):
                audit.audit(current)

    def test_symlinks_are_refused(self):
        with tempfile.TemporaryDirectory() as root:
            current = make_backup(Path(root) / 'current')
            (current / 'link').symlink_to(current / 'deployed/Code.js')
            with self.assertRaisesRegex(ValueError, 'BACKUP_SYMLINK_REFUSED'):
                audit.audit(current)

    def test_absent_patterns_never_mean_security_approval(self):
        with tempfile.TemporaryDirectory() as root:
            report = audit.audit(make_backup(Path(root) / 'current', source='// synthetic empty module'))
            self.assertEqual(report['codeReviewStatus'], 'NO_PATTERNS_FOUND_NOT_AUDIT_PASS')
            self.assertTrue(report['stopProductionRelease'])

    def test_cli_errors_never_print_private_values_or_paths(self):
        with patch.object(sys, 'argv', ['audit', '--current', CANARY]), patch.object(audit, 'audit', side_effect=ValueError(CANARY)), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(audit.main(), 1)
            result = json.loads(output.getvalue())
            self.assertEqual(result['code'], 'PRIVATE_BACKUP_AUDIT_FAILED')
            self.assertNotIn(CANARY, output.getvalue())


if __name__ == '__main__':
    unittest.main()
