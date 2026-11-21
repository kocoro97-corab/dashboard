"""Owner-run code-only update of the EXISTING isolated development Worker.

No GAS credentials/files, secret writes, settings writes, migrations, NH calls,
new Worker creation or automatic force rollback. Token stays in memory.
"""
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
NAME = 'myinvest-v2-dev-relay'
ROLE = 'myinvest-isolated-relay-v1'
ENDPOINT = 'https://myinvest-v2-dev-relay.kocoro97.workers.dev/api'
WORKER_HASH = '74a29ad355e25d89747a5bde82cc276fb03c7e6fdf52c59667a4bb3923e8f10f'
POLICY_HASH = 'f17d278de6a2f20680a29d4da7995131c5075df3f3c0d0a978f4028de8e837a5'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
CAPABILITIES = ('freshTestEnvironment', 'testEnvironment', 'scriptHash', 'sheetHash',
                'sourceDigest', 'gatewayVersion', 'storeEngine', 'relayProfile',
                'developmentPublicMarket', 'developmentIndustryMarket',
                'developmentPublicFutures', 'developmentAccountReads',
                'developmentExternalStore', 'developmentFuturesReadVersion')


class Stop(Exception):
    def __init__(self, code, http=None):
        self.code, self.http = code, http


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api_client(token):
    if not isinstance(token, str) or not token or len(token) > 2048 or any(ord(c) <= 32 or ord(c) >= 127 for c in token):
        raise Stop('TOKEN_FORMAT_INVALID')
    def call(method, path, body=None, content_type='application/json'):
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
            data=data, method=method, headers={'Authorization': 'Bearer ' + token,
            'Accept': 'application/json', 'Content-Type': content_type})
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=60) as r:
                raw = r.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise Stop('CLOUDFLARE_RESPONSE_TOO_LARGE')
                doc = json.loads(raw)
        except urllib.error.HTTPError as e:
            status = e.code
            e.close()
            raise Stop('CLOUDFLARE_REQUEST_REJECTED', status) from None
        except Stop:
            raise
        except Exception:
            raise Stop('CLOUDFLARE_RESULT_UNCONFIRMED') from None
        if doc.get('success') is not True:
            raise Stop('CLOUDFLARE_API_REJECTED')
        return doc.get('result')
    return call


def probe():
    req = urllib.request.Request(ENDPOINT, data=b'{"action":"appVersion"}',
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://kocoro97-corab.github.io',
        'X-MyInvest-Dev-Client': 'dashboard-v2-dev'}, method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=35) as r:
            doc = json.loads(r.read(65536))
            if r.status != 200 or doc.get('success') is not True or doc.get('relayProfile') != 'persistent':
                raise Stop('PUBLIC_METADATA_FAILED')
            if r.headers.get('Access-Control-Allow-Origin') != 'https://kocoro97-corab.github.io':
                raise Stop('PUBLIC_CORS_FAILED')
            return doc, 'retry-after' in r.headers.get('Access-Control-Expose-Headers', '').lower()
    except Stop:
        raise
    except Exception:
        raise Stop('PUBLIC_METADATA_UNCONFIRMED') from None


def active(api, base):
    doc = api('GET', base + '/deployments')
    rows = doc.get('deployments') if isinstance(doc, dict) else None
    if not rows or not isinstance(rows, list):
        raise Stop('EXISTING_DEPLOYMENT_REQUIRED')
    row = rows[0]
    versions = row.get('versions', [])
    if len(versions) != 1 or versions[0].get('percentage') != 100 or not UUID.fullmatch(versions[0].get('version_id', '')):
        raise Stop('SINGLE_ACTIVE_VERSION_REQUIRED')
    if not isinstance(row.get('id'), str):
        raise Stop('DEPLOYMENT_ID_REQUIRED')
    return {'id': row['id'], 'version': versions[0]['version_id']}


def verified_settings(settings):
    if not isinstance(settings, dict) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', settings.get('compatibility_date', '')):
        raise Stop('EXISTING_SETTINGS_REQUIRED')
    bindings = settings.get('bindings')
    if not isinstance(bindings, list) or any(not isinstance(b, dict) or not isinstance(b.get('name'), str) or not b['name'] for b in bindings):
        raise Stop('BINDINGS_INVALID')
    by_name = {b['name']: b for b in bindings}
    if len(by_name) != len(bindings):
        raise Stop('BINDINGS_INVALID')
    if by_name.get('MYINVEST_ROLE', {}).get('text') != ROLE:
        raise Stop('ISOLATED_WORKER_ROLE_REQUIRED')
    if by_name.get('GATE', {}).get('type') != 'durable_object_namespace':
        raise Stop('EXISTING_GATE_REQUIRED')
    if by_name['GATE'].get('class_name') != 'RelayGate':
        raise Stop('EXISTING_GATE_REQUIRED')
    return bindings


def bundle(root=ROOT):
    folder = root / 'relay/worker'
    source, policy = (folder / 'worker.mjs').read_bytes(), (folder / 'policy.json').read_bytes()
    if hashlib.sha256(source).hexdigest() != WORKER_HASH or hashlib.sha256(policy).hexdigest() != POLICY_HASH:
        raise Stop('REVIEWED_CODE_HASH_MISMATCH')
    marker = "import policy from './policy.json' with {type:'json'};"
    text = source.decode()
    if text.count(marker) != 1:
        raise Stop('MODULE_LAYOUT_CHANGED')
    return text.replace(marker, 'const policy=' + json.dumps(json.loads(policy), separators=(',', ':')) + ';').encode()


def multipart(metadata, code):
    boundary = 'myinvest-' + uuid.uuid4().hex
    parts = []
    for name, mime, filename, body in [('metadata', 'application/json', None, json.dumps(metadata).encode()),
                                      ('worker.mjs', 'application/javascript+module', 'worker.mjs', code)]:
        disposition = 'form-data; name="' + name + '"' + ('; filename="' + filename + '"' if filename else '')
        parts.append(('--' + boundary + '\r\nContent-Disposition: ' + disposition + '\r\nContent-Type: ' + mime + '\r\n\r\n').encode() + body + b'\r\n')
    return b''.join(parts) + ('--' + boundary + '--\r\n').encode(), 'multipart/form-data; boundary=' + boundary


def private_checkpoint(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(doc, f)


def deploy(api, account, save, public_probe=probe, code=None):
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account):
        raise Stop('ACCOUNT_ID_INVALID')
    base = '/accounts/' + account + '/workers/scripts/' + NAME
    # GETs must succeed for an existing script; there is no create or settings API.
    before = active(api, base)
    settings = api('GET', base + '/settings')
    bindings = verified_settings(settings)
    subdomain = api('GET', '/accounts/' + account + '/workers/subdomain')
    if subdomain.get('subdomain') != 'kocoro97':
        raise Stop('EXISTING_SUBDOMAIN_MISMATCH')
    old, _ = public_probe()
    if old.get('freshTestEnvironment') is not True or old.get('testEnvironment') != 'nh-staging':
        raise Stop('ISOLATED_GAS_METADATA_REQUIRED')
    api('GET', base + '/versions/' + before['version'])
    code = bundle() if code is None else code
    # Preserve runtime compatibility and pin ALL inherited bindings, including
    # secrets and GATE, to the exact active version rather than latest upload.
    metadata = {'main_module': 'worker.mjs', 'compatibility_date': settings['compatibility_date'],
        'compatibility_flags': settings.get('compatibility_flags', []),
        'bindings': [{'name': b['name'], 'type': 'inherit', 'version_id': before['version']} for b in bindings]}
    if 'usage_model' in settings:
        metadata['usage_model'] = settings['usage_model']
    save({'worker': NAME, 'deployment': before, 'settings': settings})
    body, mime = multipart(metadata, code)
    uploaded = api('POST', base + '/versions?bindings_inherit=strict', body, mime)
    candidate = uploaded.get('id', '')
    if not UUID.fullmatch(candidate):
        raise Stop('UPLOADED_VERSION_UNCONFIRMED')
    if active(api, base) != before or api('GET', base + '/settings') != settings:
        raise Stop('CONCURRENT_CHANGE_NO_ACTIVATION')
    deployment = lambda version: {'strategy': 'percentage', 'versions': [{'version_id': version, 'percentage': 100}]}
    try:
        api('POST', base + '/deployments', deployment(candidate))
        if active(api, base)['version'] != candidate:
            raise Stop('ACTIVATION_UNCONFIRMED')
        after_settings = api('GET', base + '/settings')
        # No settings mutation is allowed, including secrets, logging and limits.
        if after_settings != settings:
            raise Stop('SETTINGS_CHANGED')
        new, exposed = public_probe()
        if any(new.get(k) != old.get(k) for k in CAPABILITIES) or new.get('developmentReadResilienceVersion') != 1 or not exposed:
            raise Stop('POST_ACTIVATION_VERIFICATION_FAILED')
        return {'status': 'PASS', 'phase': 'WORKER_CODE_ONLY_ACTIVE', 'version': candidate,
            'previousVersion': before['version'], 'rollback': 'NOT_NEEDED'}
    except Exception:
        # A timed-out activation may have succeeded. Check its result before any
        # rollback; never overwrite a different actor's concurrent deployment.
        try:
            current = active(api, base)['version']
            if current == candidate:
                api('POST', base + '/deployments', deployment(before['version']))
            elif current != before['version']:
                raise Stop('CONCURRENT_DEPLOYMENT_MANUAL_RECOVERY_REQUIRED')
            if active(api, base)['version'] != before['version'] or api('GET', base + '/settings') != settings:
                raise Stop('ROLLBACK_VERIFICATION_FAILED')
            restored, _ = public_probe()
            if any(restored.get(k) != old.get(k) for k in CAPABILITIES) or restored.get('developmentReadResilienceVersion') != old.get('developmentReadResilienceVersion'):
                raise Stop('ROLLBACK_VERIFICATION_FAILED')
        except Exception:
            raise Stop('ACTIVATION_FAILED_MANUAL_RECOVERY_REQUIRED') from None
        return {'status': 'FAIL', 'phase': 'WORKER_CODE_ONLY_ACTIVATION', 'rollback': 'PASS_PREVIOUS_VERSION_RESTORED'}


def main():
    try:
        account = os.environ.get('CLOUDFLARE_ACCOUNT_ID') or input('Cloudflare Account ID: ').strip()
        token = os.environ.get('CLOUDFLARE_API_TOKEN') or getpass.getpass('Cloudflare API token (hidden): ')
        checkpoint = Path.home() / '.myinvest-worker-rollback' / (uuid.uuid4().hex + '.json')
        result = deploy(api_client(token.strip()), account.strip(), lambda doc: private_checkpoint(checkpoint, doc))
    except Stop as e:
        result = {'status': 'FAIL' if e.code == 'ACTIVATION_FAILED_MANUAL_RECOVERY_REQUIRED' else 'NOT_RUN', 'code': e.code}
        if e.http:
            result['http'] = e.http
    except (EOFError, KeyboardInterrupt):
        result = {'status': 'NOT_RUN', 'code': 'OWNER_INPUT_REQUIRED'}
    except Exception:
        result = {'status': 'NOT_RUN', 'code': 'OWNER_UPDATE_UNCONFIRMED'}
    result.update(credentialsIncluded=False, settingsWriteCalls=0, secretWriteCalls=0,
                  actualNhCalls=0, orderCalls=0, accountStoreWrites=False)
    print(json.dumps(result))
    return 0 if result['status'] == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
