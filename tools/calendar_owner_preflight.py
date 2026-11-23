"""Owner-run, standalone READ-ONLY check of the existing development Worker.
No deploy, secret/settings write, Google OAuth, NH, account or storage API call.
Credential values are accepted only in environment or hidden terminal prompts.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

WORKER = 'myinvest-v2-dev-relay'
ORIGIN = 'https://kocoro97-corab.github.io'
ENDPOINT = 'https://myinvest-v2-dev-relay.kocoro97.workers.dev/api'
ROLE = 'myinvest-isolated-relay-v1'
PRODUCTION_SCRIPT_ID = '1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
USER_AGENT = 'MYInvest-Calendar-Owner-Preflight/1.0'
STAGES = {'ACCOUNT_SUBDOMAIN_READ', 'WORKER_SETTINGS_READ', 'WORKER_SECRET_NAMES_READ', 'DEPLOYMENTS_READ', 'VERSIONS_READ', 'PUBLIC_RELAY', 'UNCLASSIFIED_READ'}
CALENDAR_SECRETS = ('GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'CALENDAR_IDENTITY_BRIDGE_KEY', 'GOOGLE_CALENDAR_ENCRYPTION_KEY')
RELAY_CODES = {'AUTH_REQUIRED', 'DEV_PAGE_REQUIRED', 'RELAY_ORIGIN_DENIED', 'RELAY_ACCESS_CLOSED', 'RELAY_PATH_DENIED', 'RELAY_CONFIG_INVALID', 'RELAY_SCOPE_BLOCKED', 'RELAY_ISOLATION_REQUIRED', 'RELAY_TARGET_MISMATCH', 'RELAY_RATE_LIMIT', 'RELAY_BUSY'}


class Stop(Exception):
    def __init__(self, code, http=None, diagnostic=None):
        self.code, self.http, self.diagnostic = code, http, diagnostic


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def error_diagnostic(raw, content_type, *, host, stage):
    """Only fixed labels/numeric codes, never provider text or reflected values."""
    kind = 'JSON' if 'json' in content_type.lower() else 'HTML' if 'html' in content_type.lower() else 'OTHER'
    result = {'failedHost': host, 'stage': stage, 'contentType': kind}
    codes = []
    try:
        doc = json.loads(raw)
        if isinstance(doc, dict):
            errors = doc.get('errors')
            if isinstance(errors, list):
                codes.extend(e['code'] for e in errors[:10] if isinstance(e, dict) and type(e.get('code')) is int)
            if doc.get('code') in RELAY_CODES:
                result['relayCode'] = doc['code']
    except (ValueError, TypeError):
        pass
    codes.extend(int(v) for v in re.findall(r'(?i)\berror\s+code:\s*(\d{4,5})\b', raw.decode('utf8', 'replace')))
    result['providerCodes'] = list(dict.fromkeys(codes))[:10]
    return result


def read_json(url, *, token=None, data=None, headers=None, stage='UNCLASSIFIED_READ'):
    host = urlsplit(url).hostname
    if host not in {'api.cloudflare.com', 'myinvest-v2-dev-relay.kocoro97.workers.dev'}:
        raise Stop('READ_ONLY_HOST_DENIED')
    if host == 'api.cloudflare.com' and data is not None:
        raise Stop('READ_ONLY_METHOD_DENIED')
    if host != 'api.cloudflare.com' and (token is not None or data != b'{"action":"appVersion"}'):
        raise Stop('READ_ONLY_PUBLIC_ACTION_DENIED')
    stage = stage if stage in STAGES else 'UNCLASSIFIED_READ'
    diagnostic = {'failedHost': host, 'stage': stage}
    h = {'Accept': 'application/json', 'User-Agent': USER_AGENT, **(headers or {})}
    if token:
        h['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=data, headers=h, method='GET' if data is None else 'POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=30) as r:
            raw = r.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise Stop('PREFLIGHT_RESPONSE_TOO_LARGE')
            value = json.loads(raw)
    except urllib.error.HTTPError as error:
        try:
            detail = error_diagnostic(error.read(65536), error.headers.get('Content-Type', ''), host=host, stage=stage)
        except Exception:
            detail = diagnostic
        raise Stop('PREFLIGHT_HTTP_REJECTED', error.code, detail) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise Stop('PREFLIGHT_NETWORK_OR_RESPONSE', diagnostic=diagnostic) from None
    if not isinstance(value, dict):
        raise Stop('PREFLIGHT_RESPONSE_INVALID')
    return value


def api_client(account, token):
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account or '') or not isinstance(token, str) or not token or len(token) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in token):
        raise Stop('CREDENTIAL_INPUT_INVALID')
    prefix = '/accounts/' + account

    def get(path):
        # Fixed account/subdomain and exact existing Worker read endpoints only.
        allowed = {prefix + '/workers/subdomain'}
        base = prefix + '/workers/scripts/' + WORKER
        allowed.update(base + suffix for suffix in ['/settings', '/secrets', '/deployments', '/versions'])
        if path not in allowed:
            raise Stop('READ_ONLY_ROUTE_DENIED')
        stages = {'/subdomain': 'ACCOUNT_SUBDOMAIN_READ', '/settings': 'WORKER_SETTINGS_READ', '/secrets': 'WORKER_SECRET_NAMES_READ', '/deployments': 'DEPLOYMENTS_READ', '/versions': 'VERSIONS_READ'}
        stage = next(value for suffix, value in stages.items() if path.endswith(suffix))
        result = read_json('https://api.cloudflare.com/client/v4' + path, token=token, stage=stage)
        if result.get('success') is not True:
            detail = error_diagnostic(json.dumps(result).encode(), 'application/json', host='api.cloudflare.com', stage=stage)
            raise Stop('CLOUDFLARE_READ_REJECTED', diagnostic=detail)
        return result.get('result')
    return get


def public_probe():
    return read_json(ENDPOINT, data=b'{"action":"appVersion"}', headers={'Origin': ORIGIN, 'X-MyInvest-Dev-Client': 'dashboard-v2-dev', 'Content-Type': 'application/json'}, stage='PUBLIC_RELAY')


def secret_presence(by_name, rows, available):
    listed = {r['name']: r for r in rows}
    presence, states = {}, {}
    for name in CALENDAR_SECRETS:
        setting, secret = by_name.get(name), listed.get(name)
        if setting and secret and setting.get('type') != secret.get('type'):
            state, found = 'METADATA_CONFLICT', None
        elif (setting or secret or {}).get('type') == 'secret_text':
            state, found = 'SECRET_CONFIRMED', True
        elif setting or secret:
            state, found = 'WRONG_BINDING_TYPE', False
        elif any(key != name and key.strip().upper() == name for key in (*by_name, *listed)):
            state, found = 'NAME_MISMATCH', False
        elif available:
            state, found = 'MISSING', False
        else:
            state, found = 'UNVERIFIED', None
        presence[name], states[name] = found, state
    return presence, states


def owner_checkout(owner_dir, metadata):
    """Inspect bounded existing metadata layouts, not credentials or the whole home."""
    if not owner_dir or not Path(owner_dir).is_dir():
        return {'verified': False, 'status': 'BASE_NOT_FOUND'}
    owner = Path(owner_dir).resolve()
    plan = {}
    try:
        if (owner / 'fresh-plan.json').is_file() and not (owner / 'fresh-plan.json').is_symlink():
            plan = json.loads((owner / 'fresh-plan.json').read_text())
    except (ValueError, OSError):
        return {'verified': False, 'status': 'PLAN_REVIEW_REQUIRED'}
    candidates, seen_sources = [], set()
    for folder, layout in [(owner, 'FLAT'), (owner / 'bundle', 'BUNDLE')]:
        if folder.is_symlink() or not folder.is_dir():
            continue
        config_path = folder / '.clasp.json'
        config = {}
        try:
            if config_path.is_file() and not config_path.is_symlink():
                config = json.loads(config_path.read_text())
            script_id = config.get('scriptId') or (plan.get('scriptId') if layout == 'BUNDLE' else None)
            root = config.get('rootDir', '.')
            if not isinstance(root, str):
                continue
            source = (folder / root).resolve()
            if source != owner and owner not in source.parents:
                continue
            bridge = source / 'StagingBridge.gs'
            if not bridge.is_file() or bridge.is_symlink() or not isinstance(script_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{20,200}', script_id) or script_id == PRODUCTION_SCRIPT_ID:
                continue
            text = bridge.read_text()
            match = re.search(r"NH_STAGING_SCRIPT_ID\s*=\s*['\"]([A-Za-z0-9_-]+)['\"]", text)
            if not match or match[1] != script_id or 'function stagingProjectGuard_()' not in text:
                continue
            if hashlib.sha256(script_id.encode()).hexdigest() != metadata.get('scriptHash'):
                continue
            revision = re.search(r"NH_STAGING_REVISION\s*=\s*['\"]([a-f0-9]{40})['\"]", text)
            marker = (source, script_id)
            if marker in seen_sources:
                continue
            seen_sources.add(marker)
            label = 'CLASP_ROOTDIR' if source != folder else layout
            candidates.append({'verified': True, 'status': 'VERIFIED_TARGET', 'layout': label,
                               'sourceRevisionMatches': bool(revision and revision[1] == metadata.get('revision'))})
        except (ValueError, OSError, TypeError, AttributeError):
            continue
    if len(candidates) == 1:
        return candidates[0]
    return {'verified': False, 'status': 'AMBIGUOUS_LAYOUT' if candidates else 'EXISTING_TARGET_NOT_VERIFIED'}


def inspect(api_get, account, *, probe=public_probe, owner_dir=None):
    prefix = '/accounts/' + account
    subdomain = api_get(prefix + '/workers/subdomain')
    if not isinstance(subdomain, dict) or subdomain.get('subdomain') != 'kocoro97':
        raise Stop('EXISTING_ACCOUNT_MISMATCH')
    base = prefix + '/workers/scripts/' + WORKER
    settings = api_get(base + '/settings')
    bindings = settings.get('bindings') if isinstance(settings, dict) else None
    if not isinstance(bindings, list) or any(not isinstance(b, dict) or not isinstance(b.get('name'), str) for b in bindings):
        raise Stop('EXISTING_BINDINGS_REQUIRED')
    by_name = {b['name']: b for b in bindings}
    if len(by_name) != len(bindings) or by_name.get('MYINVEST_ROLE', {}).get('text') != ROLE:
        raise Stop('EXISTING_WORKER_ROLE_MISMATCH')
    gate = by_name.get('GATE', {})
    gate_ok = gate.get('type') == 'durable_object_namespace' and gate.get('class_name') == 'RelayGate'
    secret_rows, secret_available = [], False
    secret_inspection = {'status': 'UNAVAILABLE'}
    try:
        secret_rows = api_get(base + '/secrets')
        if not isinstance(secret_rows, list) or any(not isinstance(r, dict) or not isinstance(r.get('name'), str) for r in secret_rows) or len({r['name'] for r in secret_rows}) != len(secret_rows):
            raise Stop('SECRET_NAMES_RESPONSE_INVALID')
        secret_available = True
        secret_inspection = {'status': 'PASS'}
    except Stop as error:
        secret_rows = []
        secret_inspection = {'status': 'UNAVAILABLE', 'code': error.code}
        if error.http:
            secret_inspection['http'] = error.http
        if error.diagnostic:
            secret_inspection['diagnostic'] = error.diagnostic
    deployments = api_get(base + '/deployments')
    rows = deployments.get('deployments') if isinstance(deployments, dict) else None
    if not isinstance(rows, list) or not rows:
        raise Stop('EXISTING_DEPLOYMENT_REQUIRED')
    active = rows[0].get('versions', [])
    if len(active) != 1 or active[0].get('percentage') != 100 or not UUID.fullmatch(active[0].get('version_id', '')):
        raise Stop('SINGLE_ACTIVE_VERSION_REQUIRED')
    version = active[0]['version_id']
    versions = api_get(base + '/versions')
    history = versions.get('items') if isinstance(versions, dict) else versions
    if not isinstance(history, list) or not history or any(not isinstance(v, dict) or type(v.get('number')) not in (int, float) for v in history):
        raise Stop('VERSION_HISTORY_REQUIRED')
    latest_active = max(history, key=lambda v: v['number']).get('id') == version
    metadata = probe()
    if metadata.get('success') is not True or metadata.get('freshTestEnvironment') is not True or metadata.get('testEnvironment') != 'nh-staging':
        raise Stop('PUBLIC_ISOLATION_NOT_VERIFIED')
    # Repeat read before reporting so a concurrent deployment is not called stable.
    after = api_get(base + '/deployments')
    if after != deployments:
        raise Stop('CONCURRENT_CHANGE_NO_WRITE')
    flags = settings.get('compatibility_flags', [])
    secrets, secret_states = secret_presence(by_name, secret_rows, secret_available)
    owner_info = owner_checkout(owner_dir, metadata)
    owner_files = owner_info['verified']
    blockers = [name + '_' + state for name, state in secret_states.items() if state != 'SECRET_CONFIRMED']
    if not gate_ok:
        blockers.append('EXISTING_PRIVATE_STORAGE_BINDING_REQUIRED')
    if 'nodejs_compat' not in flags:
        blockers.append('NODE_COMPATIBILITY_NOT_ENABLED')
    if not latest_active:
        blockers.append('PENDING_VERSION_REVIEW_REQUIRED')
    if not owner_files:
        blockers.append('EXISTING_OWNER_CHECKOUT_NOT_VERIFIED')
    elif not owner_info.get('sourceRevisionMatches'):
        blockers.append('OWNER_SOURCE_REVISION_REVIEW_REQUIRED')
    return {'status': 'PASS', 'phase': 'CALENDAR_OWNER_READ_ONLY_PREFLIGHT', 'activeVersion': version,
            'latestVersionIsActive': latest_active, 'googleSecretBindings': secrets,
            'googleBindingStates': secret_states, 'secretNamesInspection': secret_inspection,
            'existingGateBinding': gate_ok, 'nodeCompatibilityEnabled': 'nodejs_compat' in flags,
            'ownerCheckoutVerified': owner_files, 'ownerCheckoutInspection': owner_info, 'serverHourPolicyObserved': metadata.get('sessionIdleMs') == 3600000,
            'googleCapabilityAdvertised': metadata.get('developmentGoogleCalendarReadOnly') is True,
            'blockers': blockers, 'readyForActivation': False, 'liveGoogleConsent': 'NOT_RUN',
            'deploymentAttempted': False, 'settingsWriteCalls': 0, 'secretWriteCalls': 0,
            'credentialsIncluded': False, 'nhCalls': 0, 'accountCalls': 0, 'orderCalls': 0, 'storeWrites': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-dir', default='/home/kocoro97/myinvest-v2-fresh-private-r2')
    parser.add_argument('--prompt', action='store_true', help='Use hidden prompts instead of potentially stale environment credentials')
    args = parser.parse_args()
    sources = {}
    try:
        account = None if args.prompt else os.environ.get('CLOUDFLARE_ACCOUNT_ID')
        token = None if args.prompt else os.environ.get('CLOUDFLARE_API_TOKEN')
        sources = {'accountId': 'ENVIRONMENT' if account else 'HIDDEN_PROMPT', 'token': 'ENVIRONMENT' if token else 'HIDDEN_PROMPT'}
        if (not account or not token) and not sys.stdin.isatty():
            raise Stop('HIDDEN_TERMINAL_INPUT_REQUIRED')
        account = account or getpass.getpass('Cloudflare Account ID (hidden): ')
        token = token or getpass.getpass('Existing Cloudflare API token (hidden): ')
        report = inspect(api_client(account, token), account, owner_dir=args.owner_dir)
    except Stop as error:
        report = {'status': 'NOT_RUN', 'code': error.code, 'credentialsIncluded': False, 'deploymentAttempted': False, 'settingsWriteCalls': 0, 'secretWriteCalls': 0, 'nhCalls': 0, 'accountCalls': 0, 'orderCalls': 0, 'storeWrites': False}
        if error.http:
            report['http'] = error.http
        if error.diagnostic:
            report['diagnostic'] = error.diagnostic
    except Exception:
        report = {'status': 'NOT_RUN', 'code': 'OWNER_PREFLIGHT_FAILED', 'credentialsIncluded': False, 'deploymentAttempted': False}
    report['credentialSources'] = sources
    print(json.dumps(report))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
