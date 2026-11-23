"""Owner-run, standalone READ-ONLY check of the existing development Worker.
No deploy, secret/settings write, Google OAuth, NH, account or storage API call.
Credential values are accepted only in environment or hidden terminal prompts.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

WORKER = 'myinvest-v2-dev-relay'
ORIGIN = 'https://kocoro97-corab.github.io'
ENDPOINT = 'https://myinvest-v2-dev-relay.kocoro97.workers.dev/api'
ROLE = 'myinvest-isolated-relay-v1'
PRODUCTION_SCRIPT_ID = '1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')


class Stop(Exception):
    def __init__(self, code, http=None):
        self.code, self.http = code, http


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_json(url, *, token=None, data=None, headers=None):
    h = {'Accept': 'application/json', **(headers or {})}
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
        raise Stop('PREFLIGHT_HTTP_REJECTED', error.code) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise Stop('PREFLIGHT_NETWORK_OR_RESPONSE') from None
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
        allowed.update(base + suffix for suffix in ['/settings', '/deployments', '/versions'])
        if path not in allowed:
            raise Stop('READ_ONLY_ROUTE_DENIED')
        result = read_json('https://api.cloudflare.com/client/v4' + path, token=token)
        if result.get('success') is not True:
            raise Stop('CLOUDFLARE_READ_REJECTED')
        return result.get('result')
    return get


def public_probe():
    return read_json(ENDPOINT, data=b'{"action":"appVersion"}', headers={'Origin': ORIGIN, 'X-MyInvest-Dev-Client': 'dashboard-v2-dev', 'Content-Type': 'application/json'})


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
    secrets = {name: by_name.get(name, {}).get('type') == 'secret_text' for name in ['GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'CALENDAR_IDENTITY_BRIDGE_KEY', 'GOOGLE_CALENDAR_ENCRYPTION_KEY']}
    owner_files = False
    if owner_dir:
        owner = Path(owner_dir)
        if (owner / '.clasp.json').is_file() and (owner / 'StagingBridge.gs').is_file():
            try:
                script_id = json.loads((owner / '.clasp.json').read_text()).get('scriptId')
                bridge = (owner / 'StagingBridge.gs').read_text()
                owner_files = isinstance(script_id, str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{20,200}', script_id)) and script_id != PRODUCTION_SCRIPT_ID and f"NH_STAGING_SCRIPT_ID='{script_id}'" in bridge
            except (OSError, ValueError):
                owner_files = False
    blockers = [name + '_MISSING' for name, present in secrets.items() if not present]
    if not gate_ok:
        blockers.append('EXISTING_PRIVATE_STORAGE_BINDING_REQUIRED')
    if 'nodejs_compat' not in flags:
        blockers.append('NODE_COMPATIBILITY_NOT_ENABLED')
    if not latest_active:
        blockers.append('PENDING_VERSION_REVIEW_REQUIRED')
    if not owner_files:
        blockers.append('EXISTING_OWNER_CHECKOUT_NOT_VERIFIED')
    return {'status': 'PASS', 'phase': 'CALENDAR_OWNER_READ_ONLY_PREFLIGHT', 'activeVersion': version,
            'latestVersionIsActive': latest_active, 'googleSecretBindings': secrets,
            'existingGateBinding': gate_ok, 'nodeCompatibilityEnabled': 'nodejs_compat' in flags,
            'ownerCheckoutVerified': owner_files, 'serverHourPolicyObserved': metadata.get('sessionIdleMs') == 3600000,
            'googleCapabilityAdvertised': metadata.get('developmentGoogleCalendarReadOnly') is True,
            'blockers': blockers, 'readyForActivation': False, 'liveGoogleConsent': 'NOT_RUN',
            'deploymentAttempted': False, 'settingsWriteCalls': 0, 'secretWriteCalls': 0,
            'credentialsIncluded': False, 'nhCalls': 0, 'accountCalls': 0, 'orderCalls': 0, 'storeWrites': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-dir', default='/home/kocoro97/myinvest-v2-fresh-private-r2')
    args = parser.parse_args()
    try:
        account = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
        token = os.environ.get('CLOUDFLARE_API_TOKEN')
        if (not account or not token) and not sys.stdin.isatty():
            raise Stop('HIDDEN_TERMINAL_INPUT_REQUIRED')
        account = account or getpass.getpass('Cloudflare Account ID (hidden): ')
        token = token or getpass.getpass('Existing Cloudflare API token (hidden): ')
        report = inspect(api_client(account, token), account, owner_dir=args.owner_dir)
    except Stop as error:
        report = {'status': 'NOT_RUN', 'code': error.code, 'credentialsIncluded': False, 'deploymentAttempted': False, 'settingsWriteCalls': 0, 'secretWriteCalls': 0, 'nhCalls': 0, 'accountCalls': 0, 'orderCalls': 0, 'storeWrites': False}
        if error.http:
            report['http'] = error.http
    except Exception:
        report = {'status': 'NOT_RUN', 'code': 'OWNER_PREFLIGHT_FAILED', 'credentialsIncluded': False, 'deploymentAttempted': False}
    print(json.dumps(report))
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
