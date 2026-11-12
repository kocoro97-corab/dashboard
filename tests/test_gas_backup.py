import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import prepare_gas_backup as backup


class BackupTests(unittest.TestCase):
    def setUp(self):
        # Some executors make /tmp itself a repository. Model an owner's private
        # non-Git home folder for these synthetic snapshots; test the guard below.
        stub = patch.object(backup, 'has_git_parent', return_value=False)
        stub.start()
        self.addCleanup(stub.stop)

    def client(self, mismatch=False, changed=False):
        calls = []
        def run(args, cwd):
            calls.append(args)
            if args[0] == 'list-deployments':
                version = 13 if changed and len(calls) > 1 else 12
                return json.dumps([{'deploymentId': backup.PRODUCTION_DEPLOYMENT_ID, 'versionNumber': version}])
            self.assertEqual(args[0], 'pull')
            (cwd / 'appsscript.json').write_text('{"runtimeVersion":"V8"}')
            (cwd / 'Code.js').write_text('SYNTHETIC_PRIVATE_SOURCE' + ('changed' if mismatch and len(args) == 1 else ''))
            return 'SYNTHETIC_PRIVATE_CLI_TEXT'
        return run, calls

    def test_source_backup_is_private_and_uses_only_read_commands(self):
        with tempfile.TemporaryDirectory() as folder:
            client, calls = self.client()
            output = Path(folder) / 'backup'
            result = backup.prepare_backup(output, client)
            self.assertEqual(result['status'], 'GAS_SOURCE_BACKUP_CREATED')
            self.assertEqual(result['activeVersion'], 12)
            self.assertFalse(result['sheetsBackupVerified'])
            self.assertFalse(result['propertiesBackupVerified'])
            self.assertTrue(all(c[0] in ('pull', 'list-deployments') for c in calls))
            self.assertEqual((output / 'source-backup.zip').stat().st_mode & 0o777, 0o600)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertNotIn('SYNTHETIC_PRIVATE', json.dumps(result))
            with zipfile.ZipFile(output / 'source-backup.zip') as archive:
                self.assertIn('deployed/Code.js', archive.namelist())
            with self.assertRaises(ValueError):
                backup.prepare_backup(output, client)

    def test_unpublished_changes_are_backed_up_but_block_release(self):
        with tempfile.TemporaryDirectory() as folder:
            result = backup.prepare_backup(Path(folder) / 'backup', self.client(mismatch=True)[0])
            self.assertEqual(result['status'], 'STOP_REVIEW_UNPUBLISHED_GAS')
            self.assertFalse(result['headMatchesDeployed'])

    def test_concurrent_deployment_change_cannot_produce_verified_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(ValueError, 'DEPLOYMENT_CHANGED'):
                backup.prepare_backup(Path(folder) / 'backup', self.client(changed=True)[0])

    def test_repository_output_is_refused_before_private_reads(self):
        def refused(*args):
            self.fail('private source must not be fetched')
        with self.assertRaisesRegex(ValueError, 'OUTSIDE_GIT'):
            backup.prepare_backup(backup.ROOT / 'private-backup', refused)
        with tempfile.TemporaryDirectory() as folder, patch.object(backup, 'has_git_parent', return_value=True):
            with self.assertRaisesRegex(ValueError, 'OUTSIDE_GIT'):
                backup.prepare_backup(Path(folder) / 'backup', refused)


if __name__ == '__main__':
    unittest.main()
