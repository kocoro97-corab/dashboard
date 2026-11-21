import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import nh_v2_stage as stage

REVISION = 'a' * 40


class FakeClasp:
    def __init__(self, old):
        self.head = copy.deepcopy(old)
        self.versions = {2: copy.deepcopy(old)}
        self.version = 2
        self.writes = []
        self.calls = []

    def __call__(self, args, folder):
        self.calls.append(args)
        if args[0] == 'list-deployments':
            assert args[1] == stage.SCRIPT
            return json.dumps([{'deploymentId': stage.DEPLOYMENT, 'versionNumber': self.version, 'description': 'synthetic'}])
        assert stage.config(folder)
        if args[0] == 'pull':
            data = self.versions[int(args[2])] if len(args) > 1 else self.head
            for name, text in data.items():
                (folder / (name + ('.json' if name == 'appsscript' else '.js'))).write_text(text)
            return '{}'
        self.writes.append(args[0])
        if args[0] == 'push':
            self.head = stage.logical(folder)
            return '{}'
        if args[0] == 'create-version':
            self.versions[3] = copy.deepcopy(self.head)
            return json.dumps({'versionNumber': 3})
        if args[0] == 'update-deployment':
            assert args[1] == stage.DEPLOYMENT
            self.version = int(args[3])
            return json.dumps({'deploymentId': stage.DEPLOYMENT, 'versionNumber': self.version})
        raise AssertionError('unapproved test command')


class StageV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old = {'Security': '// synthetic old security', 'Nhplug': '// synthetic old gateway', 'appsscript': json.dumps(stage.MANIFEST, sort_keys=True)}
        cls.old_digest = 'b' * 64

    def setUp(self):
        # Managed test executor places a .git marker directly in /tmp. Isolate
        # that host detail; production path protection remains independently tested.
        self.git_parent = patch.object(stage, 'has_git_parent', return_value=False)
        self.git_parent.start()
        self.addCleanup(self.git_parent.stop)

    def git(self, *args):
        if args[0] == 'status':
            return b''
        if args[0] == 'rev-parse':
            return REVISION.encode()
        raise AssertionError('unexpected git command')

    def meta(self, v2=False):
        value = {'testEnvironment': 'nh-staging', 'scriptHash': stage.fingerprint(stage.SCRIPT),
                 'sheetHash': stage.fingerprint(stage.SHEET), 'storeVersion': 2,
                 'revision': REVISION if v2 else stage.BASELINE,
                 'sourceDigest': stage.source_digest() if v2 else self.old_digest}
        if v2:
            value.update(gatewayVersion=2, storeEngine='account-store-v2')
        return value

    def run_tool(self, path, fake, apply=False, bad_final=False):
        with patch.object(stage, 'git', side_effect=self.git), patch.object(stage, 'baseline_bundle', return_value=(self.old, self.old_digest)), patch.object(stage.time, 'sleep'):
            return stage.run(path, apply, True, True, fake, lambda: self.meta(fake.version == 3 and not bad_final))

    def test_baseline_digest_uses_fixed_paths_raw_bytes_and_manifest(self):
        import hashlib
        values = {name: ('// ' + name + '\n').encode() for name in stage.BASE_SOURCES}
        def fake_git(*args):
            self.assertEqual(args[0], 'show')
            prefix, name = args[1].split(':', 1)
            self.assertEqual(prefix, stage.BASELINE)
            return values[name]
        expected = hashlib.sha256()
        for name, data in values.items():
            expected.update(name.encode() + b'\0' + str(len(data)).encode() + b'\0' + data)
        expected.update(json.dumps(stage.MANIFEST, sort_keys=True).encode())
        with patch.object(stage, 'git', side_effect=fake_git):
            bundle, digest = stage.baseline_bundle()
        self.assertEqual(digest, expected.hexdigest())
        self.assertEqual(len(bundle), 6)

    def test_readonly_backup_and_preparation_never_mutates_remote(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = FakeClasp(self.old)
            result = self.run_tool(Path(directory) / 'private', fake)
            self.assertEqual(result['status'], 'PREPARED')
            self.assertEqual(fake.writes, [])
            self.assertTrue((Path(directory) / 'private/source-backup.zip').exists())
            self.assertFalse(result['nhRequested'])

    def test_successful_test_update_verifies_all_modules_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = FakeClasp(self.old)
            result = self.run_tool(Path(directory) / 'private', fake, True)
            self.assertEqual(result['status'], 'PASS')
            self.assertEqual(fake.version, 3)
            self.assertEqual(fake.head, fake.versions[3])
            self.assertIn('NhGatewayV2', fake.head)
            self.assertIn('NhAccountsV2', fake.head)
            self.assertIn('AccountStoreV2', fake.head)
            self.assertFalse(result['sheetsOrPropertiesWrites'])

    def test_bad_published_metadata_restores_only_test_source_and_deployment(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = FakeClasp(self.old)
            result = self.run_tool(Path(directory) / 'private', fake, True, True)
            self.assertEqual(result['status'], 'FAIL')
            self.assertEqual(result['recovery'], 'PASS_TEST_SOURCE_AND_DEPLOYMENT_RESTORED')
            self.assertEqual(fake.head, self.old)
            self.assertEqual(fake.version, 2)

    def test_sheet_and_settings_backup_gate_precedes_source_writes(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(stage, 'git', side_effect=self.git), patch.object(stage, 'baseline_bundle', return_value=(self.old, self.old_digest)):
            fake = FakeClasp(self.old)
            with self.assertRaisesRegex(stage.Stop, 'PRIVATE_SHEET_AND_SETTINGS_BACKUPS_REQUIRED'):
                stage.run(Path(directory) / 'private', True, False, False, fake, lambda: self.meta())
            self.assertEqual(fake.calls, [])

    def test_unexpected_source_stops_without_any_remote_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = FakeClasp(dict(self.old, UnknownPrivate='SYNTHETIC_PRIVATE_CANARY'))
            with self.assertRaisesRegex(stage.Stop, 'UNEXPECTED_TEST_SOURCE_STOP'):
                self.run_tool(Path(directory) / 'private', fake, True)
            self.assertEqual(fake.writes, [])

    def test_wrong_environment_blocks_before_clasp(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(stage, 'git', side_effect=self.git), patch.object(stage, 'baseline_bundle', return_value=(self.old, self.old_digest)):
            fake = FakeClasp(self.old)
            with self.assertRaisesRegex(stage.Stop, 'TEST_BINDING_OR_SOURCE_MISMATCH'):
                stage.run(Path(directory) / 'private', client=fake, metadata=lambda: dict(self.meta(), testEnvironment='production'))
            self.assertEqual(fake.calls, [])

    def test_existing_private_directory_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(stage.Stop, 'NEW_PRIVATE_DIRECTORY_REQUIRED'):
                stage.run(directory)

    def test_git_backed_output_is_refused_before_remote_access(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(stage, 'has_git_parent', return_value=True):
            with self.assertRaisesRegex(stage.Stop, 'NEW_PRIVATE_DIRECTORY_REQUIRED'):
                stage.run(Path(directory) / 'private')

    def test_clasp_rejects_production_and_unknown_commands_before_subprocess(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(stage.subprocess, 'run') as command:
            folder = Path(directory)
            (folder / '.clasp.json').write_text(json.dumps({'scriptId': 'SYNTHETIC_UNAPPROVED_TARGET', 'rootDir': '.'}))
            for args in (['push', '--force'], ['delete-project'], ['list-deployments', 'SYNTHETIC_UNAPPROVED_TARGET']):
                with self.assertRaisesRegex(stage.Stop, 'TEST_TARGET_REQUIRED'):
                    stage.clasp(args, folder)
            command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
