"""Live NH/GAS checks against a bound staging web app. Reports never contain holdings or secrets."""
import argparse
import copy
import datetime
import getpass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from build_nh_staging import ROOT, PRODUCTION_SCRIPT_ID, PRODUCTION_DEPLOYMENT_ID, PRODUCTION_SHEET_HASH, source_digest


class Blocked(Exception):
    pass


class ApiFailure(Exception):
    def __init__(self, code, http=None, action=None):
        self.code = code if re.fullmatch(r"[A-Z0-9_]{1,50}", str(code)) else "API_FAILURE"
        self.http = http
        self.action = action


def rejection_code(result, action):
    # Only classify exact messages from our checked-in GAS. Never echo server text.
    if not isinstance(result, dict):
        return "GAS_RESPONSE_INVALID"
    if result.get("code"):
        return result["code"]
    known = {
        "아이디와 비밀번호를 확인하세요.": "LOGIN_INPUT_INVALID",
        "로그인 정보 또는 계정 승인 상태를 확인하세요.": "LOGIN_CREDENTIALS_OR_APPROVAL",
        "로그인 시도가 많습니다. 15분 후 다시 시도하세요.": "LOGIN_RATE_LIMITED",
        "요청을 처리하지 못했습니다. 입력값과 연결 상태를 확인하세요.": "GAS_HANDLER_EXCEPTION",
        "로그인이 필요합니다. 다시 로그인하세요.": "AUTH_REQUIRED",
    }
    return known.get(result.get("message"), "GAS_REJECTED")


def fingerprint(text):
    return hashlib.sha256(text.encode()).hexdigest()


def validate_target(url, script_id, sheet_id):
    if not all(isinstance(value, str) and value for value in (url, script_id, sheet_id)):
        raise Blocked("STAGING_IDENTIFIERS_REQUIRED")
    if script_id == PRODUCTION_SCRIPT_ID or fingerprint(sheet_id) == PRODUCTION_SHEET_HASH:
        raise Blocked("PRODUCTION_TARGET_REFUSED")
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", script_id) or not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", sheet_id):
        raise Blocked("STAGING_IDENTIFIERS_REQUIRED")
    match = re.fullmatch(r"https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec", url)
    if not match or match[1] == PRODUCTION_DEPLOYMENT_ID:
        raise Blocked("STAGING_WEB_APP_REQUIRED")


class GoogleRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        target = urllib.parse.urlparse(url)
        if target.scheme != "https" or target.hostname not in {"script.google.com", "script.googleusercontent.com"} or target.username or target.port not in (None, 443):
            raise ApiFailure("UNEXPECTED_REDIRECT", code)
        return super().redirect_request(request, fp, code, message, headers, url)


class WebApp:
    def __init__(self, url):
        self.url, self.token, self.binding = url, None, None
        self.opener = urllib.request.build_opener(GoogleRedirect())

    def call(self, action, **fields):
        payload = dict(fields, action=action)
        if self.token:
            payload["token"] = self.token
        if self.binding:
            payload["stagingBinding"] = self.binding
        request = urllib.request.Request(self.url, data=json.dumps(payload).encode(), headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
        try:
            with self.opener.open(request, timeout=120) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            raise ApiFailure("HTTP_FAILURE", error.code, action) from None
        except (urllib.error.URLError, TimeoutError, ValueError):
            raise ApiFailure("NETWORK_OR_JSON_FAILURE", action=action) from None
        if not isinstance(result, dict) or result.get("success") is not True:
            raise ApiFailure(rejection_code(result, action), action=action)
        return result


def canonical(rows):
    fields = ("accountType", "code", "name", "quantity", "avgPrice", "source")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ApiFailure("HOLDINGS_SCHEMA_INVALID")
    return sorted(json.dumps([row.get(key) for key in fields], sort_keys=True) for row in rows)


def load_holdings_fixture(private_path=None):
    if private_path is None:
        return json.loads((ROOT / "tests/fixtures/isa-ocr.json").read_text())
    path = Path(private_path).resolve()
    if path.is_relative_to(ROOT.resolve()):
        raise Blocked("PRIVATE_HOLDINGS_MUST_STAY_OUTSIDE_REPOSITORY")
    rows = json.loads(path.read_text())
    if not isinstance(rows, list) or len(rows) != 7:
        raise Blocked("SEVEN_PRIVATE_HOLDINGS_REQUIRED")
    codes = set()
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r"[A-Z0-9]{6}", str(row.get("code", ""))) or not isinstance(row.get("name"), str) or not row["name"] or len(row["name"]) > 60:
            raise Blocked("PRIVATE_HOLDINGS_INVALID")
        if row["code"] in codes:
            raise Blocked("PRIVATE_HOLDINGS_DUPLICATE")
        codes.add(row["code"])
        for key in ("quantity", "avgPrice"):
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise Blocked("PRIVATE_HOLDINGS_INVALID")
    return {"expected": [{key: row[key] for key in ("name", "code", "quantity", "avgPrice")} for row in rows]}


def account_state(result):
    accounts = result.get("accounts")
    if not isinstance(accounts, list) or not accounts:
        raise ApiFailure("NO_GENERAL_ACCOUNTS")
    signature = []
    for account in accounts:
        entry = []
        for market in ("domestic", "overseas"):
            part = account.get(market)
            if not isinstance(part, dict) or not isinstance(part.get("holdings"), list) or not isinstance(part.get("summary"), dict):
                raise ApiFailure("GENERAL_" + market.upper() + "_QUERY_FAILED")
            entry.append(sorted((str(row.get("code")), row.get("quantity"), str(row.get("currency"))) for row in part["holdings"]))
        if account.get("errors"):
            raise ApiFailure("GENERAL_ACCOUNT_PARTIAL_ERROR")
        signature.append(entry)
    # Only compare in memory. Never print or serialize actual general-account positions.
    return sorted(json.dumps(item, sort_keys=True) for item in signature)


def authenticate_staging(client, script_id, sheet_id, expected_digest, username, password):
    validate_target(client.url, script_id, sheet_id)
    metadata = client.call("appVersion")
    if metadata.get("testEnvironment") != "nh-staging" or metadata.get("scriptHash") != fingerprint(script_id) or metadata.get("sheetHash") != fingerprint(sheet_id) or metadata.get("sourceDigest") != expected_digest or metadata.get("storeVersion") != 2:
        raise Blocked("STAGING_BINDING_OR_SOURCE_MISMATCH")
    if not metadata.get("nhTestCredentialsDeclared"):
        raise Blocked("NH_TEST_CREDENTIAL_SETTINGS_REQUIRED")
    client.binding = metadata["sheetHash"]
    login = client.call("login", **{"user": username, "pass": password})
    client.token = login.get("token")
    if not client.token or not login.get("isAdmin") or login.get("mustChangePassword"):
        raise Blocked("STRONG_STAGING_ADMIN_REQUIRED")


def auth_check(client, script_id, sheet_id, expected_digest, username, password):
    try:
        authenticate_staging(client, script_id, sheet_id, expected_digest, username, password)
        return {"mode": "STAGING_AUTH_ONLY", "status": "PASS", "checks": [{"name": "staging_identity_source_and_login", "status": "PASS"}], "rawFinancialDataIncluded": False, "liveNhRequested": False}
    finally:
        if client.token:
            client.call("logout")


def live_checks(client, fixture, script_id, sheet_id, expected_digest, username, password, redact_symbols=False):
    validate_target(client.url, script_id, sheet_id)
    report = {"mode": "LIVE_NH_STAGING", "status": "BLOCKED", "checks": [], "cleanup": "NOT_NEEDED", "rawFinancialDataIncluded": False, "liveNhRequested": False}
    def record(name, status="PASS", code=None, diagnostic=None):
        item = {"name": name, "status": status}
        if code:
            item["code"] = code
        if diagnostic:
            if diagnostic.get("layer") in ("frontend", "gas", "nh", "storage", "staging"):
                item["layer"] = diagnostic["layer"]
            if isinstance(diagnostic.get("http"), int) and 100 <= diagnostic["http"] <= 599:
                item["http"] = diagnostic["http"]
            if re.fullmatch(r"[A-Za-z0-9_-]{1,20}", str(diagnostic.get("rspCode", ""))):
                item["rspCode"] = diagnostic["rspCode"]
        report["checks"].append(item)
    run_source = 'nh-test-' + uuid.uuid4().hex[:8]
    stage_rows = [dict(row, accountType="ISA", source=run_source) for row in fixture["expected"]]
    if len(stage_rows) != 7 or any(not re.fullmatch(r"[A-Z0-9]{6}", row["code"]) for row in stage_rows):
        raise Blocked("SEVEN_VERIFIED_ISA_FIXTURES_REQUIRED")
    authenticate_staging(client, script_id, sheet_id, expected_digest, username, password)
    record("isolated_staging_identity_and_source")
    wrote = False
    known = [canonical([]), canonical(stage_rows), canonical(stage_rows[1:])]
    try:
        baseline = client.call("externalHoldings")
        if baseline.get("storeVersion") != 2 or not baseline.get("revision") or baseline.get("holdings"):
            raise Blocked("EMPTY_DEDICATED_TEST_USER_REQUIRED")
        record("empty_staging_store")
        before = None
        try:
            report["liveNhRequested"] = True
            before = account_state(client.call("nhAccounts"))
            record("general_domestic_overseas_before")
        except ApiFailure as error:
            record("general_domestic_overseas_before", "FAIL", error.code)
        try:
            quote = client.call("nhExternalQuotes", codes=[row["code"] for row in stage_rows])
            for position, row in enumerate(stage_rows, 1):
                price = quote.get("prices", {}).get(row["code"], {}).get("price")
                valid = isinstance(price, (int, float)) and not isinstance(price, bool) and math.isfinite(price) and price > 0
                diagnosis = quote.get("diagnostics", {}).get(row["code"], {})
                code = diagnosis.get("code", "PRICE_UNAVAILABLE")
                code = code if re.fullmatch(r"[A-Z0-9_]{1,50}", str(code)) else "PRICE_UNAVAILABLE"
                record("isa_quote_" + (str(position) if redact_symbols else row["code"]), "PASS" if valid else "FAIL", None if valid else code, None if valid else diagnosis)
        except ApiFailure as error:
            record("isa_quote_batch", "FAIL", error.code)
        wrote = True
        client.call("saveExternalHoldings", holdings=stage_rows, expectedRevision=baseline["revision"], confirmReplace=True)
        saved = client.call("externalHoldings")
        if canonical(saved.get("holdings", [])) != canonical(stage_rows):
            raise ApiFailure("SAVE_READBACK_MISMATCH")
        record("isa_seven_save_and_readback")
        client.call("saveExternalHoldings", holdings=stage_rows[1:], expectedRevision=saved["revision"], confirmReplace=True)
        deleted = client.call("externalHoldings")
        if canonical(deleted.get("holdings", [])) != canonical(stage_rows[1:]):
            raise ApiFailure("DELETE_READBACK_MISMATCH")
        record("isa_delete_one")
        history = client.call("externalHistory")
        backup = next((item for item in history.get("history", []) if canonical(item.get("holdings", [])) == canonical(stage_rows)), None)
        if not backup:
            raise ApiFailure("RECOVERY_SNAPSHOT_NOT_FOUND")
        client.call("restoreExternalHoldings", snapshotId=backup["snapshotId"], expectedRevision=deleted["revision"], confirmReplace=True)
        restored = client.call("externalHoldings")
        if canonical(restored.get("holdings", [])) != canonical(stage_rows):
            raise ApiFailure("RESTORE_READBACK_MISMATCH")
        record("isa_restore_exact_seven")
        try:
            after = account_state(client.call("nhAccounts"))
            record("general_domestic_overseas_after")
            record("general_positions_unchanged", "PASS" if before is not None and before == after else "INCONCLUSIVE", None if before == after else "POSITIONS_CHANGED_OR_BASELINE_FAILED")
        except ApiFailure as error:
            record("general_domestic_overseas_after", "FAIL", error.code)
    except ApiFailure as error:
        record("integration_flow", "FAIL", error.code)
    except Blocked as error:
        record("staging_preconditions", "BLOCKED", str(error))
    finally:
        if wrote:
            try:
                current = client.call("externalHoldings")
                if canonical(current.get("holdings", [])) not in known:
                    raise ApiFailure("CONCURRENT_NON_FIXTURE_DATA")
                if current["holdings"]:
                    client.call("saveExternalHoldings", holdings=[], expectedRevision=current["revision"], confirmReplace=True)
                if client.call("externalHoldings").get("holdings"):
                    raise ApiFailure("CLEANUP_READBACK_FAILED")
                report["cleanup"] = "PASS_BASELINE_EMPTY"
            except ApiFailure as error:
                report["cleanup"] = "OWNER_RECOVERY_REQUIRED"
                record("cleanup", "FAIL", error.code)
        try:
            client.call("logout")
        except ApiFailure:
            record("logout", "FAIL", "LOGOUT_FAILED")
    report["status"] = "BLOCKED" if any(item["status"] == "BLOCKED" for item in report["checks"]) else "PASS" if report["checks"] and all(item["status"] == "PASS" for item in report["checks"]) else "FAIL_OR_INCONCLUSIVE"
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("NH_STAGING_URL"))
    parser.add_argument("--script-id", default=os.environ.get("NH_STAGING_SCRIPT_ID"))
    parser.add_argument("--sheet-id", default=os.environ.get("NH_STAGING_SHEET_ID"))
    parser.add_argument("--allow-staging-write", action="store_true")
    parser.add_argument("--auth-only", action="store_true", help="Check staging identity and login only; no NH requests or holdings writes")
    parser.add_argument("--private-holdings", type=Path, help="Opt-in private OCR expectations outside Git, for staging only")
    parser.add_argument("--report", type=Path, default=Path("nh-staging-report.json"))
    args = parser.parse_args()
    report = {"mode": "LIVE_NH_STAGING", "status": "BLOCKED", "checks": [], "rawFinancialDataIncluded": False, "liveNhRequested": False}
    if args.auth_only:
        report["mode"] = "STAGING_AUTH_ONLY"
    try:
        if not all((args.url, args.script_id, args.sheet_id)):
            raise Blocked("STAGING_URL_SCRIPT_AND_SHEET_REQUIRED")
        if not args.auth_only and not args.allow_staging_write:
            raise Blocked("EXPLICIT_STAGING_WRITE_FLAG_REQUIRED")
        validate_target(args.url, args.script_id, args.sheet_id)
        if not sys.stdin.isatty() and not all(os.environ.get(name) for name in ("NH_STAGING_USER", "NH_STAGING_PASSWORD")):
            raise Blocked("STAGING_TEST_CREDENTIALS_REQUIRED")
        username = os.environ.get("NH_STAGING_USER") or input("Staging test user: ")
        password = os.environ.get("NH_STAGING_PASSWORD") or getpass.getpass("Staging test password: ")
        if not username or len(password) < 16:
            raise Blocked("STRONG_STAGING_TEST_CREDENTIALS_REQUIRED")
        if args.auth_only:
            report = auth_check(WebApp(args.url), args.script_id, args.sheet_id, source_digest(), username, password)
            args.report.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report))
            return 0
        fixture = load_holdings_fixture(args.private_holdings)
        master = json.loads((ROOT / "data/krx-instruments.json").read_text())
        age = datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(master["source"]["fetchedAt"])
        if age > datetime.timedelta(days=30):
            raise Blocked("MASTER_REFRESH_REQUIRED")
        by_code = {row["code"]: row for row in master["instruments"]}
        if any(by_code.get(row["code"], {}).get("name") != row["name"] for row in fixture["expected"]):
            raise Blocked("FIXTURE_MASTER_MISMATCH")
        report = live_checks(WebApp(args.url), fixture, args.script_id, args.sheet_id, source_digest(), username, password, redact_symbols=bool(args.private_holdings))
        report["holdingsInput"] = "PRIVATE_LOCAL" if args.private_holdings else "SYNTHETIC_FIXTURE"
    except Blocked as error:
        report["reason"] = str(error)
    except ApiFailure as error:
        report["status"], report["reason"] = "FAIL", error.code
        if error.action:
            report["failedAction"] = error.action
        if error.http:
            report["http"] = error.http
    except Exception:
        report["status"], report["reason"] = "FAIL", "UNEXPECTED_TEST_FAILURE"
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))
    return 0 if report["status"] == "PASS" else 2 if report["status"] == "BLOCKED" else 1


if __name__ == "__main__":
    sys.exit(main())
