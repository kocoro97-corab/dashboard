import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('calendar_overlay', ROOT / 'tools/prepare_calendar_identity_overlay.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class CalendarIdentityOverlayTest(unittest.TestCase):
    def owner(self, directory, script_id='synthetic-isolated-project-123456'):
        owner = directory / 'owner'
        owner.mkdir()
        (owner / '.clasp.json').write_text(json.dumps({'scriptId': script_id}))
        bridge = (ROOT / 'tests/staging/StagingBridge.gs').read_text().replace('__SCRIPT_ID__', script_id)
        bridge += '\nfunction securityEnvironmentSessionIdleMs_(){return 3600000}\n'
        (owner / 'StagingBridge.gs').write_text(bridge)
        (owner / 'Security.gs').write_text('SYNTHETIC_EXISTING_AUTH_POLICY_UNCHANGED')
        return owner, bridge

    def test_preserves_owner_source_and_hour_policy_and_only_prepares_two_modules(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            owner, original = self.owner(base)
            plan = mod.prepare(owner, base / 'private-output')
            self.assertFalse(plan['deploymentAttempted'])
            self.assertFalse(plan['authSessionPolicyChanged'])
            self.assertEqual((owner / 'StagingBridge.gs').read_text(), original)
            self.assertEqual((owner / 'Security.gs').read_text(), 'SYNTHETIC_EXISTING_AUTH_POLICY_UNCHANGED')
            candidate = (base / 'private-output/StagingBridge.gs').read_text()
            self.assertEqual(candidate.replace(mod.HOOK, '', 1), original)
            self.assertIn('return 3600000', candidate)
            self.assertEqual((base / 'private-output').stat().st_mode & 0o777, 0o700)
            self.assertNotIn('synthetic-isolated-project', json.dumps(plan))

    def test_development_form_policy_permits_only_fixed_consent_routes(self):
        from tools.build_dev_pages import build
        for configured in [True, False]:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp) / 'artifact'
                build(out, use_public_config=configured)
                text = (out / 'index.html').read_text()
                if configured:
                    self.assertIn("form-action https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/start https://accounts.google.com/o/oauth2/v2/auth;", text)
                else:
                    self.assertIn("form-action 'none';", text)
                self.assertFalse((out / 'server').exists())
                self.assertFalse((out / 'tests/staging/CalendarIdentityBridge.gs').exists())

    def test_refuses_production_mismatches_and_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            owner, _ = self.owner(base, mod.PRODUCTION_SCRIPT_ID)
            with self.assertRaisesRegex(ValueError, 'ISOLATED'):
                mod.prepare(owner, base / 'private-output')
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            owner, _ = self.owner(base)
            (base / 'existing-output').mkdir()
            with self.assertRaisesRegex(ValueError, 'NEW_PRIVATE'):
                mod.prepare(owner, base / 'existing-output')
            (owner / 'StagingBridge.gs').write_text('UNKNOWN_SOURCE')
            with self.assertRaisesRegex(ValueError, 'MISMATCH'):
                mod.prepare(owner, base / 'new-output')

    def test_refuses_repatch_or_output_inside_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            owner, content = self.owner(base)
            with self.assertRaisesRegex(ValueError, 'SEPARATE'):
                mod.prepare(owner, owner / 'output')
            (owner / 'StagingBridge.gs').write_text(content + mod.HOOK)
            with self.assertRaisesRegex(ValueError, 'REPATCH'):
                mod.prepare(owner, base / 'private-output')


if __name__ == '__main__':
    unittest.main()
