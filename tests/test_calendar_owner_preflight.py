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
        if path.endswith('/secrets'):
            return [row for row in settings['bindings'] if row.get('type') == 'secret_text']
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
                get('/accounts/' + ACCOUNT + '/workers/scripts/' + mod.WORKER + '/secrets/GOOGLE_CALENDAR_CLIENT_SECRET')
        self.assertEqual(len(seen), 1)
        self.assertIsNone(seen[0][1].get('data'))

class CalendarOwnerDiagnosticsTest(unittest.TestCase):
    def reject(self, url, raw, content_type, **kwargs):
        import io
        import urllib.error
        headers = {'Content-Type': content_type}
        error = urllib.error.HTTPError(url, 403, 'PRIVATE_ERROR_REASON', headers, io.BytesIO(raw))
        with patch.object(mod.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = error
            with self.assertRaises(mod.Stop) as raised:
                mod.read_json(url, **kwargs)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header('User-agent'), mod.USER_AGENT)
        return raised.exception

    def test_cloudflare_api_403_has_exact_read_stage_and_numeric_codes_only(self):
        error = self.reject('https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/subdomain', json.dumps({'errors': [{'code': 10000, 'message': 'SYNTHETIC_PRIVATE_TOKEN'}, {'code': 'SYNTHETIC_PRIVATE_TOKEN'}]}).encode(), 'application/json', token='synthetic-api-token', stage='ACCOUNT_SUBDOMAIN_READ')
        self.assertEqual(error.http, 403)
        self.assertEqual(error.diagnostic['failedHost'], 'api.cloudflare.com')
        self.assertEqual(error.diagnostic['stage'], 'ACCOUNT_SUBDOMAIN_READ')
        self.assertEqual(error.diagnostic['providerCodes'], [10000])
        self.assertNotIn('PRIVATE', json.dumps(error.diagnostic))
        self.assertNotIn(ACCOUNT, json.dumps(error.diagnostic))

    def test_public_relay_edge_403_is_distinct_from_cloudflare_api_auth(self):
        error = self.reject(mod.ENDPOINT, b'error code: 1010 PRIVATE_CANARY', 'text/plain', data=b'{"action":"appVersion"}', stage='PUBLIC_RELAY')
        self.assertEqual(error.diagnostic['failedHost'], 'myinvest-v2-dev-relay.kocoro97.workers.dev')
        self.assertEqual(error.diagnostic['providerCodes'], [1010])
        self.assertEqual(error.diagnostic['stage'], 'PUBLIC_RELAY')
        self.assertNotIn('PRIVATE_CANARY', json.dumps(error.diagnostic))

    def test_only_allowlisted_relay_error_is_reported(self):
        for value, expected in [('DEV_PAGE_REQUIRED', True), ('SYNTHETIC_PRIVATE_CANARY', False)]:
            error = self.reject(mod.ENDPOINT, json.dumps({'code': value, 'message': 'SYNTHETIC_PRIVATE_CANARY'}).encode(), 'application/json', data=b'{"action":"appVersion"}', stage='PUBLIC_RELAY')
            self.assertEqual('relayCode' in error.diagnostic, expected)
            self.assertNotIn('PRIVATE_CANARY', json.dumps(error.diagnostic))

    def test_read_only_network_boundary_prevents_writes_and_credentials_to_relay(self):
        with patch.object(mod.urllib.request, 'build_opener') as build:
            for url, kwargs in [('https://untrusted.example/', {}), ('https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT, {'data': b'{}'}), (mod.ENDPOINT, {'token': 'synthetic-api-token', 'data': b'{"action":"appVersion"}'}), (mod.ENDPOINT, {'data': b'{"action":"nhAccounts"}'})]:
                with self.assertRaises(mod.Stop):
                    mod.read_json(url, **kwargs)
            build.assert_not_called()

    def test_api_and_probe_pass_safe_stage_labels(self):
        with patch.object(mod, 'read_json', return_value={'success': True, 'result': {}}) as read:
            mod.api_client(ACCOUNT, 'synthetic-api-token')('/accounts/' + ACCOUNT + '/workers/scripts/' + mod.WORKER + '/settings')
            self.assertEqual(read.call_args.kwargs['stage'], 'WORKER_SETTINGS_READ')
            mod.public_probe()
            self.assertEqual(read.call_args.kwargs['stage'], 'PUBLIC_RELAY')
            self.assertIsNone(read.call_args.kwargs.get('token'))

class CalendarBindingPresenceTest(unittest.TestCase):
    def test_separate_secret_names_endpoint_can_confirm_binding_omitted_by_settings(self):
        presence, states = mod.secret_presence({}, [{'name': 'GOOGLE_CALENDAR_CLIENT_ID', 'type': 'secret_text', 'text': 'PRIVATE_CANARY'}], True)
        self.assertTrue(presence['GOOGLE_CALENDAR_CLIENT_ID'])
        self.assertEqual(states['GOOGLE_CALENDAR_CLIENT_ID'], 'SECRET_CONFIRMED')
        self.assertEqual(states['GOOGLE_CALENDAR_CLIENT_SECRET'], 'MISSING')
        self.assertNotIn('CANARY', json.dumps([presence, states]))

    def test_plain_variable_unknown_query_and_name_mismatch_are_not_called_missing(self):
        name = 'GOOGLE_CALENDAR_CLIENT_SECRET'
        p, s = mod.secret_presence({name: {'name': name, 'type': 'plain_text', 'text': 'PRIVATE_CANARY'}}, [], True)
        self.assertFalse(p[name])
        self.assertEqual(s[name], 'WRONG_BINDING_TYPE')
        p, s = mod.secret_presence({}, [], False)
        self.assertIsNone(p[name])
        self.assertEqual(s[name], 'UNVERIFIED')
        p, s = mod.secret_presence({}, [{'name': name.lower(), 'type': 'secret_text'}], True)
        self.assertFalse(p[name])
        self.assertEqual(s[name], 'NAME_MISMATCH')

    def test_conflicting_views_require_review_and_never_dump_other_secret_names(self):
        name = 'GOOGLE_CALENDAR_CLIENT_ID'
        p, s = mod.secret_presence({name: {'name': name, 'type': 'plain_text'}}, [{'name': name, 'type': 'secret_text'}, {'name': 'SYNTHETIC_PRIVATE_CANARY', 'type': 'secret_text'}], True)
        self.assertIsNone(p[name])
        self.assertEqual(s[name], 'METADATA_CONFLICT')
        self.assertNotIn('PRIVATE', json.dumps([p, s]))

    def test_list_is_the_only_new_read_route(self):
        with patch.object(mod, 'read_json', return_value={'success': True, 'result': []}) as read:
            get = mod.api_client(ACCOUNT, 'synthetic-api-token')
            get('/accounts/' + ACCOUNT + '/workers/scripts/' + mod.WORKER + '/secrets')
            self.assertEqual(read.call_args.kwargs['stage'], 'WORKER_SECRET_NAMES_READ')
            self.assertIsNone(read.call_args.kwargs.get('data'))
            with self.assertRaises(mod.Stop):
                get('/accounts/' + ACCOUNT + '/workers/scripts/' + mod.WORKER + '/secrets/private-key')

    def test_unavailable_list_does_not_destroy_other_checks_or_claim_absent_secrets(self):
        api, settings, _, _ = fixture()
        settings['bindings'] = settings['bindings'][:2]

        def unavailable(path):
            if path.endswith('/secrets'):
                raise mod.Stop('PREFLIGHT_HTTP_REJECTED', 403)
            return api(path)
        result = mod.inspect(unavailable, ACCOUNT, probe=lambda: {'success': True, 'freshTestEnvironment': True, 'testEnvironment': 'nh-staging'})
        self.assertEqual(result['secretNamesInspection']['status'], 'UNAVAILABLE')
        self.assertIsNone(result['googleSecretBindings']['GOOGLE_CALENDAR_CLIENT_SECRET'])
        self.assertIn('GOOGLE_CALENDAR_CLIENT_SECRET_UNVERIFIED', result['blockers'])
        self.assertNotIn('GOOGLE_CALENDAR_CLIENT_SECRET_MISSING', result['blockers'])


class CalendarOwnerLayoutTest(unittest.TestCase):
    def test_existing_flat_bundle_and_clasp_rootdir_layouts_are_verified_without_source_output(self):
        import tempfile
        import hashlib
        script_id = 'synthetic-owner-script-0123456789'
        revision = 'b' * 40
        metadata = {'scriptHash': hashlib.sha256(script_id.encode()).hexdigest(), 'revision': revision}
        bridge = "const NH_STAGING_SCRIPT_ID='" + script_id + "';\nconst NH_STAGING_REVISION='" + revision + "';\nfunction stagingProjectGuard_(){}"
        for layout in ['FLAT', 'BUNDLE', 'CLASP_ROOTDIR']:
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                source = root if layout == 'FLAT' else root / 'bundle'
                source.mkdir(exist_ok=True)
                (source / 'StagingBridge.gs').write_text(bridge)
                config = root if layout == 'CLASP_ROOTDIR' else source
                (config / '.clasp.json').write_text(json.dumps({'scriptId': script_id, 'rootDir': 'bundle' if layout == 'CLASP_ROOTDIR' else '.'}))
                (root / 'fresh-plan.json').write_text(json.dumps({'scriptId': script_id, 'privateValue': 'PRIVATE_CANARY'}))
                result = mod.owner_checkout(root, metadata)
                self.assertTrue(result['verified'])
                self.assertTrue(result['sourceRevisionMatches'])
                self.assertEqual(result['layout'], layout)
                self.assertNotIn(script_id, json.dumps(result))
                self.assertNotIn('CANARY', json.dumps(result))
                self.assertFalse(mod.owner_checkout(root, {'scriptHash': '0' * 64})['verified'])

    def test_missing_directory_has_specific_status(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(mod.owner_checkout(Path(tmp) / 'missing', {})['status'], 'BASE_NOT_FOUND')


if __name__ == '__main__':
    unittest.main()
