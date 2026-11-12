import copy
import importlib.util
import json
import io
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import build_nh_staging as builder
import nh_staging_test as runner

SCRIPT = "SYNTHETIC_STAGING_SCRIPT_ID_123456"
SHEET = "SYNTHETIC_STAGING_SHEET_ID_123456"
URL = "https://script.google.com/macros/s/SYNTHETIC_STAGING_DEPLOYMENT/exec"
DIGEST = "a" * 64


class FakeApp:
    url = URL
    token = None
    binding = None

    def __init__(self, dirty=False, failed_quote=False, failed_restore=False, concurrent=False, bad_marker=False):
        self.rows = [{"name": "SYNTHETIC private existing"}] if dirty else []
        self.revision = 1
        self.history = []
        self.calls = []
        self.general_calls = 0
        self.failed_quote, self.failed_restore = failed_quote, failed_restore
        self.concurrent, self.bad_marker = concurrent, bad_marker

    def call(self, action, **fields):
        self.calls.append(action)
        if action == "appVersion":
            return {"success": True, "testEnvironment": "production" if self.bad_marker else "nh-staging", "scriptHash": runner.fingerprint(SCRIPT), "sheetHash": runner.fingerprint(SHEET), "sourceDigest": DIGEST, "storeVersion": 2, "nhTestCredentialsDeclared": True}
        if action == "login":
            return {"success": True, "isAdmin": True, "token": "SYNTHETIC_PRIVATE_TOKEN"}
        if action == "externalHoldings":
            return {"success": True, "storeVersion": 2, "holdings": copy.deepcopy(self.rows), "revision": str(self.revision)}
        if action == "nhAccounts":
            self.general_calls += 1
            if self.concurrent and self.general_calls == 2:
                self.rows = [{"accountType": "ISA", "name": "SYNTHETIC_OWNER_EDIT", "code": "000001", "quantity": 5, "avgPrice": 10, "source": "other-run"}]
            return {"success": True, "accounts": [{"masked": "SYNTHETIC_PRIVATE_ACCOUNT", "domestic": {"summary": {}, "holdings": [{"code": "PRIVATE_GENERAL_CODE", "name": "PRIVATE_GENERAL_NAME", "quantity": 9, "currency": "KRW"}]}, "overseas": {"summary": {}, "holdings": []}, "errors": []}]}
        if action == "nhExternalQuotes":
            prices = {code: {"price": 300} for code in fields["codes"]}
            if self.failed_quote:
                prices[fields["codes"][0]] = {"price": None}
            return {"success": True, "prices": prices, "diagnostics": {}}
        if action == "externalHistory":
            return {"history": copy.deepcopy(self.history)}
        if action in ("saveExternalHoldings", "restoreExternalHoldings"):
            if fields["expectedRevision"] != str(self.revision) or fields["confirmReplace"] is not True:
                raise runner.ApiFailure("STORE_CONFLICT")
            if action == "restoreExternalHoldings":
                if self.failed_restore:
                    raise runner.ApiFailure("SIMULATED_RESTORE_FAILURE")
                after = next(x["holdings"] for x in self.history if x["snapshotId"] == fields["snapshotId"])
            else:
                after = fields["holdings"]
            self.history.append({"snapshotId": str(self.revision), "holdings": copy.deepcopy(self.rows)})
            self.rows = copy.deepcopy(after)
            self.revision += 1
            return {"success": True}
        if action == "logout":
            return {"success": True}
        raise AssertionError(action)


class StagingTests(unittest.TestCase):
    def test_private_holdings_reports_do_not_identify_the_real_portfolio(self):
        fixture = self.fixture()
        report = runner.live_checks(FakeApp(), fixture, SCRIPT, SHEET, DIGEST, 'SYNTHETIC_USER', 'SYNTHETIC_PRIVATE_PASSWORD', redact_symbols=True)
        text = json.dumps(report)
        self.assertEqual(report['status'], 'PASS')
        for row in fixture['expected']:
            self.assertNotIn(row['code'], text)
            self.assertNotIn(row['name'], text)

    def test_private_holdings_require_external_path_and_valid_unique_rows(self):
        with self.assertRaises(runner.Blocked):
            runner.load_holdings_fixture(ROOT / 'tests/fixtures/isa-ocr.json')
        rows = self.fixture()['expected']
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'private.json'
            file.write_text(json.dumps(rows))
            self.assertEqual(runner.load_holdings_fixture(file)['expected'], rows)
            for invalid in [rows[:6], rows[:6] + [rows[0]], [dict(row, quantity=True) for row in rows]]:
                file.write_text(json.dumps(invalid))
                with self.assertRaises(runner.Blocked):
                    runner.load_holdings_fixture(file)

    def test_gas_login_rejections_are_classified_without_server_text(self):
        for message, expected in [
            ("로그인 정보 또는 계정 승인 상태를 확인하세요.", "LOGIN_CREDENTIALS_OR_APPROVAL"),
            ("로그인 시도가 많습니다. 15분 후 다시 시도하세요.", "LOGIN_RATE_LIMITED"),
            ("요청을 처리하지 못했습니다. 입력값과 연결 상태를 확인하세요.", "GAS_HANDLER_EXCEPTION"),
            ("SYNTHETIC_PRIVATE_PASSWORD_AND_TOKEN", "GAS_REJECTED"),
        ]:
            app = runner.WebApp(URL)
            app.opener = SimpleNamespace(open=lambda *a, **kw: io.BytesIO(json.dumps({"success": False, "message": message}).encode()))
            with self.assertRaises(runner.ApiFailure) as caught:
                app.call("login", user="SYNTHETIC", **{"pass": "SYNTHETIC_PRIVATE_PASSWORD"})
            self.assertEqual(caught.exception.code, expected)
            self.assertEqual(caught.exception.action, "login")
            self.assertNotIn("PRIVATE", str(caught.exception))

    def test_auth_only_checks_identity_login_logout_without_nh_or_store(self):
        app = FakeApp()
        report = runner.auth_check(app, SCRIPT, SHEET, DIGEST, "SYNTHETIC_USER", "SYNTHETIC_PRIVATE_PASSWORD")
        self.assertEqual(app.calls, ["appVersion", "login", "logout"])
        self.assertEqual(report["status"], "PASS")
        self.assertFalse(report["liveNhRequested"])
        self.assertNotIn("PRIVATE", json.dumps(report))

    def test_auth_only_refuses_wrong_environment_before_login(self):
        app = FakeApp(bad_marker=True)
        with self.assertRaises(runner.Blocked):
            runner.auth_check(app, SCRIPT, SHEET, DIGEST, "SYNTHETIC_USER", "SYNTHETIC_PRIVATE_PASSWORD")
        self.assertEqual(app.calls, ["appVersion"])

    def test_auth_only_failed_login_never_queries_nh_or_writes(self):
        app = FakeApp()
        original = app.call
        def call(action, **fields):
            if action == "login":
                app.calls.append(action)
                raise runner.ApiFailure("LOGIN_CREDENTIALS_OR_APPROVAL", action=action)
            return original(action, **fields)
        app.call = call
        with self.assertRaises(runner.ApiFailure):
            runner.auth_check(app, SCRIPT, SHEET, DIGEST, "SYNTHETIC_USER", "SYNTHETIC_PRIVATE_PASSWORD")
        self.assertEqual(app.calls, ["appVersion", "login"])

    def fixture(self):
        return json.loads((ROOT / "tests/fixtures/isa-ocr.json").read_text())

    def run_checks(self, app):
        return runner.live_checks(app, self.fixture(), SCRIPT, SHEET, DIGEST, "SYNTHETIC_USER", "SYNTHETIC_PRIVATE_PASSWORD")

    def test_builder_binds_new_project_and_preserves_production_guard(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "build"
            result = builder.build(SCRIPT, "a" * 40, output)
            self.assertEqual(result["sourceDigest"], builder.source_digest())
            bridge = (output / "StagingBridge.gs").read_text()
            self.assertIn(SCRIPT, bridge)
            self.assertNotIn("__SCRIPT_ID__", bridge)
            self.assertIn(builder.PRODUCTION_SCRIPT_ID, bridge)
            self.assertNotIn("NHPLUG_APP_SECRET=", bridge)
            with self.assertRaises(ValueError):
                builder.build(SCRIPT, "a" * 40, output)
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            builder.build(builder.PRODUCTION_SCRIPT_ID, "a" * 40, Path(directory) / "build")

    def test_production_and_non_google_targets_are_refused_before_requests(self):
        for url, script in [(URL, builder.PRODUCTION_SCRIPT_ID), ("https://script.google.com/macros/s/" + builder.PRODUCTION_DEPLOYMENT_ID + "/exec", SCRIPT), ("https://example.test/exec", SCRIPT)]:
            with self.assertRaises(runner.Blocked):
                runner.validate_target(url, script, SHEET)

    def test_wrong_marker_stops_before_login_or_private_queries(self):
        app = FakeApp(bad_marker=True)
        with self.assertRaises(runner.Blocked):
            self.run_checks(app)
        self.assertEqual(app.calls, ["appVersion"])

    def test_seven_quotes_save_delete_restore_and_cleanup(self):
        app = FakeApp()
        report = self.run_checks(app)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["cleanup"], "PASS_BASELINE_EMPTY")
        self.assertEqual(app.rows, [])
        self.assertEqual(app.general_calls, 2)
        text = json.dumps(report)
        for private in ("PRIVATE_GENERAL", "PRIVATE_ACCOUNT", "PRIVATE_TOKEN", "PRIVATE_PASSWORD"):
            self.assertNotIn(private, text)
        self.assertEqual(len([check for check in report["checks"] if check["name"].startswith("isa_quote_")]), 7)

    def test_dirty_staging_store_is_not_overwritten(self):
        app = FakeApp(dirty=True)
        report = self.run_checks(app)
        self.assertEqual(report["status"], "BLOCKED")
        self.assertEqual(app.general_calls, 0)
        self.assertNotIn("saveExternalHoldings", app.calls)

    def test_unavailable_quote_is_failure_not_zero_or_overall_pass(self):
        app = FakeApp(failed_quote=True)
        report = self.run_checks(app)
        self.assertEqual(report["status"], "FAIL_OR_INCONCLUSIVE")
        self.assertEqual(report["cleanup"], "PASS_BASELINE_EMPTY")
        self.assertTrue(any(x["status"] == "FAIL" and x["name"].startswith("isa_quote_") for x in report["checks"]))

    def test_failed_restore_still_cleans_only_the_fixture(self):
        app = FakeApp(failed_restore=True)
        report = self.run_checks(app)
        self.assertEqual(report["status"], "FAIL_OR_INCONCLUSIVE")
        self.assertEqual(report["cleanup"], "PASS_BASELINE_EMPTY")
        self.assertEqual(app.rows, [])

    def test_concurrent_non_fixture_rows_are_never_deleted(self):
        app = FakeApp(concurrent=True)
        report = self.run_checks(app)
        self.assertEqual(report["cleanup"], "OWNER_RECOVERY_REQUIRED")
        self.assertEqual(app.rows[0]["source"], "other-run")
        self.assertNotIn("SYNTHETIC_OWNER_EDIT", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
