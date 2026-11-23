import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('calendar_owner_preflight', ROOT / 'tools/calendar_owner_preflight.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
ACCOUNT = 'a' * 32
VERSION = '11111111-1111-1111-1111-111111111111'


def fixture():
    calls = []
    settings = {'compatibility_flags': [], 'bindings': [
        {'name': 'MYINVEST_ROLE', 'type': 'plain_text', 'text': mod.ROLE},
        {'name': 'GATE', 'type': 'durable_object_namespace', 'class_name': 'RelayGate'},
        {'name': 'GOOGLE_CALENDAR_CLIENT_ID', 'type': 'secret_text', 'text': 'SYNTHETIC_PRIVATE_CANARY_ID'},
        {'name': 'GOOGLE_CALENDAR_CLIENT_SECRET', 'type': 'secret_text', 'text': 'SYNTHETIC_PRIVATE_CANARY_SECRET'}]}
    deployments = {'deployments': [{'versions': [{'version_id': VERSION, 'percentage': 100}]}]}

    def api(path):
        calls.append(path)
        if path.endswith('/subdomain'):
            return {'subdomain': 'kocoro97'}
        if path.endswith('/settings'):
            return settings
        if path.endswith('/deployments'):
            return deployments
        if path.endswith('/versions'):
            return {'items': [{'id': VERSION, 'number': 3}]}
        raise AssertionError('Unexpected API path')
    return api, settings, deployments, calls


class CalendarOwnerPreflightTest(unittest.TestCase):
    def test_read_only_report_confirms_registered_names_without_secret_values(self):
        api, settings, deployments, calls = fixture()
        result = mod.inspect(api, ACCOUNT, probe=lambda: {'success': True, 'freshTestEnvironment': True, 'testEnvironment': 'nh-staging', 'sessionIdleMs': 3600000})
        self.assertEqual(result['status'], 'PASS')
        self.assertFalse(result['readyForActivation'])
        self.assertFalse(result['deploymentAttempted'])
        self.assertTrue(result['googleSecretBindings']['GOOGLE_CALENDAR_CLIENT_SECRET'])
        self.assertTrue(result['serverHourPolicyObserved'])
        self.assertNotIn('CANARY', json.dumps(result))
        self.assertNotIn(ACCOUNT, json.dumps(result))
        self.assertTrue(all(p.startswith('/accounts/' + ACCOUNT + '/workers/') for p in calls))
        self.assertIn('NODE_COMPATIBILITY_NOT_ENABLED', result['blockers'])

    def test_mismatched_account_role_or_active_version_is_rejected(self):
        with self.assertRaises(mod.Stop):
            mod.inspect(lambda _: {'subdomain': 'another-account'}, ACCOUNT)
        api, settings, deployments, _ = fixture()
        settings['bindings'][0]['text'] = 'other-role'
        with self.assertRaises(mod.Stop):
            mod.inspect(api, ACCOUNT)
        api, settings, deployments, _ = fixture()
        deployments['deployments'][0]['versions'][0]['percentage'] = 50
        with self.assertRaises(mod.Stop):
            mod.inspect(api, ACCOUNT)

    def test_concurrent_deployment_is_never_reported_stable(self):
        api, _, _, _ = fixture()
        reads = 0

        def changed(path):
            nonlocal reads
            if path.endswith('/deployments'):
                reads += 1
                if reads == 2:
                    return {'deployments': []}
            return api(path)
        with self.assertRaisesRegex(mod.Stop, '') as err:
            mod.inspect(changed, ACCOUNT, probe=lambda: {'success': True, 'freshTestEnvironment': True, 'testEnvironment': 'nh-staging'})
        self.assertEqual(err.exception.code, 'CONCURRENT_CHANGE_NO_WRITE')

    def test_api_client_cannot_call_other_workers_or_any_write_method(self):
        seen = []

        def fake(url, **kwargs):
            seen.append((url, kwargs))
            return {'success': True, 'result': {'subdomain': 'kocoro97'}}
        with patch.object(mod, 'read_json', side_effect=fake):
            get = mod.api_client(ACCOUNT, 'synthetic-api-token')
            self.assertEqual(get('/accounts/' + ACCOUNT + '/workers/subdomain')['subdomain'], 'kocoro97')
            with self.assertRaises(mod.Stop):
                get('/accounts/' + ACCOUNT + '/workers/scripts/production/settings')
            with self.assertRaises(mod.Stop):
                get('/accounts/' + ACCOUNT + '/workers/scripts/' + mod.WORKER + '/secrets')
        self.assertEqual(len(seen), 1)
        self.assertIsNone(seen[0][1].get('data'))


if __name__ == '__main__':
    unittest.main()
