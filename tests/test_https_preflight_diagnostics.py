from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools')]
import nh_v2_https as launcher


class PreflightDiagnosticsTests(unittest.TestCase):
    def run_diagnostic(self, runtime_error=None, source_error=None, settings=None):
        with tempfile.TemporaryDirectory() as tmp:
            env=Path(tmp);(env/'fresh-plan.json').write_text(json.dumps({'scriptId':'SYNTHETIC_PRIVATE_VALUE','sourceDigest':'c'*64}))
            args=['nh_v2_https.py','--environment',str(env),'--cloudflared','/synthetic/connector','--diagnose-preflight']
            out=io.StringIO()
            with patch.object(sys,'argv',args), patch.object(launcher.signal,'signal'), \
                 patch.object(launcher,'validate_runtime',side_effect=runtime_error), \
                 patch.object(launcher,'private_path',return_value=env), \
                 patch.object(launcher,'preflight',side_effect=source_error,return_value=SimpleNamespace(binding='b'*64)), \
                 patch.object(launcher,'deployment_settings',return_value=settings or {'status':'PASS'}) as metadata, \
                 patch.object(launcher.getpass,'getpass') as password, patch.object(launcher,'serve') as server, \
                 redirect_stdout(out):
                code=launcher.main()
                password.assert_not_called();server.assert_not_called()
                if runtime_error or source_error:metadata.assert_not_called()
            report=json.loads(out.getvalue())
            self.assertNotIn('SYNTHETIC_PRIVATE_VALUE',out.getvalue());self.assertNotIn(str(env),out.getvalue())
            self.assertEqual(report['actualNhCalls'],0);self.assertFalse(report['accountStoreWrites'])
            return code,report

    def test_read_only_success_returns_before_password_tunnel_and_browser(self):
        code,r=self.run_diagnostic()
        self.assertEqual(code,0);self.assertEqual(r['scope'],'HTTPS_PREFLIGHT_ONLY');self.assertEqual(r['phase'],'PREFLIGHT_COMPLETE')

    def test_runtime_failure_is_specific_without_echoing_connector_path(self):
        code,r=self.run_diagnostic(runtime_error=ValueError('HTTPS_CONNECTOR_MISSING'))
        self.assertEqual(code,2);self.assertEqual(r['phase'],'LOCAL_RUNTIME');self.assertEqual(r['code'],'HTTPS_CONNECTOR_MISSING')

    def test_dirty_source_and_google_auth_failures_keep_exact_safe_reason(self):
        for reason in ('CLEAN_REVIEWED_SOURCE_REQUIRED','OWNER_GOOGLE_LOGIN_REQUIRED','SOURCE_IDENTITY_FAILED'):
            with self.subTest(reason=reason):
                code,r=self.run_diagnostic(source_error=RuntimeError(reason))
                self.assertEqual(r['phase'],'GAS_SOURCE_PREFLIGHT');self.assertEqual(r['code'],reason)

    def test_unknown_private_exception_is_never_echoed(self):
        code,r=self.run_diagnostic(source_error=RuntimeError('SYNTHETIC_PRIVATE_VALUE'))
        self.assertEqual(r['phase'],'GAS_SOURCE_PREFLIGHT');self.assertEqual(r['code'],'HTTPS_DEV_PREFLIGHT_OR_TUNNEL_REQUIRED')

    def test_unverified_deployment_is_reported_and_stops_before_any_launch(self):
        code,r=self.run_diagnostic(settings={'status':'NOT_RUN','code':'OWNER_GOOGLE_DEPLOYMENT_METADATA_REQUIRED'})
        self.assertEqual(code,2);self.assertEqual(r['phase'],'DEPLOYMENT_SETTINGS');self.assertEqual(r['code'],'DEPLOYMENT_SETTINGS_NOT_VERIFIED')

    def test_runtime_checks_refuse_missing_and_unverified_local_binaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing=Path(tmp)/'connector'
            with self.assertRaisesRegex(ValueError,'HTTPS_CONNECTOR_MISSING'):launcher.validate_runtime(missing,needs_tty=False)
            missing.write_bytes(b'SYNTHETIC_UNVERIFIED_BINARY');missing.chmod(0o700)
            with self.assertRaisesRegex(ValueError,'HTTPS_CONNECTOR_CHECKSUM'):launcher.validate_runtime(missing,needs_tty=False)
