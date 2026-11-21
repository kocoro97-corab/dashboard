"""Synthetic Cloudflare version API; never uses owner credentials/network."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import io
import urllib.error
from unittest.mock import patch
from email.parser import BytesParser
from email.policy import default

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('worker_code_only', ROOT / 'tools/worker_code_only.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
OLD = '11111111-1111-1111-1111-111111111111'
NEW = '22222222-2222-2222-2222-222222222222'
OTHER = '33333333-3333-3333-3333-333333333333'


class Cloud:
    def __init__(self):
        self.version = OLD
        self.calls = []
        self.settings = {'compatibility_date': '2026-11-01', 'compatibility_flags': [],
            'limits': {'cpu_ms': 10}, 'observability': {'enabled': False},
            'bindings': [{'name': 'MYINVEST_ROLE', 'type': 'plain_text', 'text': m.ROLE},
                {'name': 'MYINVEST_GAS_URL', 'type': 'secret_text'},
                {'name': 'GATE', 'type': 'durable_object_namespace', 'class_name': 'RelayGate', 'namespace_id': 'SYNTHETIC'}]}
        self.fault = None
        self.probes = 0

    def __call__(self, method, path, body=None, mime=None):
        self.calls.append((method, path, body))
        if path.endswith('/workers/subdomain'):
            return {'subdomain': 'kocoro97'}
        if path.endswith('/settings'):
            return copy.deepcopy(self.settings)
        if path.endswith('/deployments'):
            if method == 'POST':
                self.version = body['versions'][0]['version_id']
                if self.fault == 'activation-timeout' and self.version == NEW:
                    raise m.Stop('CLOUDFLARE_RESULT_UNCONFIRMED')
                return {'id': 'new-deployment'}
            return {'deployments': [{'id': 'deployment-' + self.version, 'versions': [{'version_id': self.version, 'percentage': 100}]}]}
        if '/versions?' in path:
            self.multipart = BytesParser(policy=default).parsebytes(('Content-Type: ' + mime + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
            if self.fault == 'concurrent':
                self.version = OTHER
            return {'id': NEW}
        if path.endswith('/versions/' + OLD):
            return {'id': OLD}
        raise AssertionError('UNEXPECTED_API')

    def probe(self):
        self.probes += 1
        doc = {'success': True, 'freshTestEnvironment': True, 'testEnvironment': 'nh-staging',
            'relayProfile': 'persistent', 'gatewayVersion': 2, 'developmentPublicMarket': True,
            'developmentAccountReads': True, 'developmentIndustryMarket': True, 'sheetHash': 'synthetic'}
        if self.version == NEW:
            doc['developmentReadResilienceVersion'] = 1
            if self.fault == 'capability':
                doc['developmentAccountReads'] = False
            if self.fault == 'concurrent-after-activation':
                self.version = OTHER
                raise m.Stop('PUBLIC_METADATA_UNCONFIRMED')
        return doc, self.version == NEW


class CodeOnlyTests(unittest.TestCase):
    def test_diagnose_never_uploads_activates_or_writes_checkpoint(self):
        c = Cloud()
        saved = []
        result = m.deploy(c, 'a' * 32, saved.append, public_probe=c.probe, diagnose=True)
        self.assertEqual(result['phase'], 'WORKER_CODE_ONLY_PREFLIGHT_READ_ONLY')
        self.assertFalse(result['deploymentAttempted'])
        self.assertFalse(saved)
        self.assertTrue(all(method == 'GET' for method, _, _ in c.calls))

    def test_http400_reports_fixed_stage_numeric_codes_without_body_or_token(self):
        body = json.dumps({'errors': [{'code': 10021, 'message': 'PRIVATE_TOKEN_ACCOUNT_BODY'},
                                     {'code': 'PRIVATE_VALUE'}, {'code': True}]}).encode()
        error = urllib.error.HTTPError('https://api.cloudflare.com/private', 400, 'PRIVATE', {}, io.BytesIO(body))
        with patch.object(m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(m.Stop) as raised:
                m.api_client('SYNTHETIC_TOKEN')('POST', '/accounts/synthetic/workers/scripts/synthetic/versions?bindings_inherit=strict', b'test')
        e = raised.exception
        self.assertEqual(e.stage, 'VERSION_UPLOAD')
        self.assertEqual(e.provider_codes, [10021])
        self.assertNotIn('PRIVATE', json.dumps(vars(e)))
        self.assertNotIn('SYNTHETIC_TOKEN', json.dumps(vars(e)))

    def test_non_json_api_rejection_does_not_expose_body(self):
        error = urllib.error.HTTPError('https://api.cloudflare.com/private', 400, 'PRIVATE', {}, io.BytesIO(b'PRIVATE_BODY'))
        with patch.object(m.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(m.Stop) as raised:
                m.api_client('SYNTHETIC_TOKEN')('GET', '/accounts/synthetic/workers/scripts/synthetic/deployments')
        self.assertEqual(raised.exception.stage, 'DEPLOYMENTS_READ')
        self.assertEqual(raised.exception.provider_codes, [])

    def test_http200_api_error_also_reports_safe_codes(self):
        with patch.object(m.urllib.request, 'build_opener') as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.read.return_value = b'{"success":false,"errors":[{"code":10000,"message":"PRIVATE_BODY"}]}'
            with self.assertRaises(m.Stop) as raised:
                m.api_client('SYNTHETIC_TOKEN')('GET', '/accounts/synthetic/workers/scripts/synthetic/settings')
        self.assertEqual(raised.exception.stage, 'WORKER_SETTINGS_READ')
        self.assertEqual(raised.exception.provider_codes, [10000])

    def test_provider_message_is_reduced_to_fixed_categories(self):
        self.assertEqual(m.provider_hints({'errors': [{'message': 'Invalid inherit binding for Durable Object PRIVATE_TOKEN_URL'}]}),
                         ['DURABLE_OBJECT', 'BINDING_INHERIT', 'BINDING'])
        self.assertEqual(m.provider_hints({'errors': [{'message': 'PRIVATE_TOKEN_URL'}]}), [])

    def run_deploy(self, cloud):
        saved = []
        result = m.deploy(cloud, 'a' * 32, saved.append, public_probe=cloud.probe, code=b'// synthetic code')
        return result, saved

    def test_inherits_every_binding_from_exact_active_version_and_preserves_settings(self):
        c = Cloud()
        before = copy.deepcopy(c.settings)
        result, saved = self.run_deploy(c)
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(saved[0]['deployment']['version'], OLD)
        self.assertEqual(c.settings, before)
        parts = list(c.multipart.iter_parts())
        metadata = json.loads(parts[0].get_payload(decode=True))
        self.assertEqual(metadata['bindings'], [{'name': b['name'], 'type': 'inherit', 'version_id': OLD} for b in before['bindings']])
        self.assertNotIn('migrations', metadata)
        self.assertNotIn('observability', metadata)
        self.assertTrue(all(method in ['GET', 'POST'] for method, _, _ in c.calls))
        self.assertFalse(any('secrets' in path for _, path, _ in c.calls))

    def test_wrong_role_blocks_before_any_upload(self):
        c = Cloud()
        c.settings['bindings'][0]['text'] = 'OTHER_ROLE'
        with self.assertRaises(m.Stop):
            self.run_deploy(c)
        self.assertTrue(all(x[0] == 'GET' for x in c.calls))

    def test_failed_public_capability_readback_rolls_back(self):
        c = Cloud()
        c.fault = 'capability'
        result, _ = self.run_deploy(c)
        self.assertEqual(result['rollback'], 'PASS_PREVIOUS_VERSION_RESTORED')
        self.assertEqual(c.version, OLD)

    def test_uncertain_activation_checks_live_version_and_rolls_back(self):
        c = Cloud()
        c.fault = 'activation-timeout'
        result, _ = self.run_deploy(c)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(c.version, OLD)

    def test_concurrent_deployment_never_overwritten(self):
        c = Cloud()
        c.fault = 'concurrent'
        with self.assertRaises(m.Stop) as e:
            self.run_deploy(c)
        self.assertEqual(e.exception.code, 'CONCURRENT_CHANGE_NO_ACTIVATION')
        self.assertEqual(c.version, OTHER)
        self.assertFalse(any(method == 'POST' and path.endswith('/deployments') for method, path, _ in c.calls))

    def test_concurrent_actor_during_failed_probe_requires_manual_recovery(self):
        c = Cloud()
        c.fault = 'concurrent-after-activation'
        with self.assertRaises(m.Stop) as e:
            self.run_deploy(c)
        self.assertEqual(e.exception.code, 'ACTIVATION_FAILED_MANUAL_RECOVERY_REQUIRED')
        self.assertEqual(c.version, OTHER)

    def test_split_deployment_is_not_replaced(self):
        def split(*args):
            return {'deployments': [{'id': 'split', 'versions': [{'version_id': OLD, 'percentage': 50}, {'version_id': NEW, 'percentage': 50}]}]}
        with self.assertRaises(m.Stop):
            m.active(split, '/synthetic')

    def test_checkpoint_failure_prevents_upload(self):
        c = Cloud()
        def save(_):
            raise OSError('synthetic disk full')
        with self.assertRaises(OSError):
            m.deploy(c, 'a' * 32, save, public_probe=c.probe, code=b'test')
        self.assertTrue(all(x[0] == 'GET' for x in c.calls))

    def test_private_checkpoint_permissions_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / 'private/checkpoint.json'
            m.private_checkpoint(p, {'version': OLD})
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                m.private_checkpoint(p, {'version': NEW})

    def test_bundled_source_is_exact_reviewed_code_with_unchanged_policy(self):
        code = m.bundle().decode()
        self.assertIn('developmentReadResilienceVersion:1', code)
        self.assertNotIn("import policy from", code)
        self.assertIn('const policy=', code)
        self.assertIn('AbortSignal.timeout(25000)', code)

    def test_modified_code_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'relay/worker'
            folder.mkdir(parents=True)
            (folder / 'worker.mjs').write_text('modified')
            (folder / 'policy.json').write_text('{}')
            with self.assertRaises(m.Stop):
                m.bundle(Path(tmp))

    def test_control_characters_in_token_refused(self):
        with self.assertRaises(m.Stop):
            m.api_client('token\nheader')


if __name__ == '__main__':
    unittest.main()
