"""Owner-run code-only update of the EXISTING isolated development Worker.

No GAS credentials/files, secret writes, settings writes, migrations, NH calls,
new Worker creation or automatic force rollback. Token stays in memory.
"""
import argparse
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from email.parser import BytesParser
from email.policy import default as email_policy

ROOT = Path(__file__).resolve().parents[1]
NAME = 'myinvest-v2-dev-relay'
ROLE = 'myinvest-isolated-relay-v1'
ENDPOINT = 'https://myinvest-v2-dev-relay.kocoro97.workers.dev/api'
WORKER_HASH = '8d133ead746191de6c4f35c32d4a25eb666f69cd67427c42f43dd8c74a4a9dec'
POLICY_HASH = 'f17d278de6a2f20680a29d4da7995131c5075df3f3c0d0a978f4028de8e837a5'
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')
CAPABILITIES = ('freshTestEnvironment', 'testEnvironment', 'scriptHash', 'sheetHash',
                'sourceDigest', 'gatewayVersion', 'storeEngine', 'relayProfile',
                'developmentPublicMarket', 'developmentIndustryMarket',
                'developmentPublicFutures', 'developmentAccountReads',
                'developmentExternalStore', 'developmentFuturesReadVersion')


class Stop(Exception):
    def __init__(self, code, http=None, stage=None, provider_codes=None, hints=None):
        self.code, self.http, self.stage = code, http, stage
        self.provider_codes = provider_codes or []
        self.hints = hints or []


def request_stage(method, path):
    if path.endswith('/workers/subdomain'):
        return 'ACCOUNT_SUBDOMAIN_READ'
    if path.endswith('/content/v2'):
        return 'CANDIDATE_CODE_READ'
    if path.endswith('/settings'):
        return 'WORKER_SETTINGS_READ'
    if path.endswith('/deployments'):
        return 'VERSION_ACTIVATE' if method == 'POST' else 'DEPLOYMENTS_READ'
    if path.split('?', 1)[0].endswith('/versions'):
        return 'VERSION_UPLOAD' if method == 'POST' else 'VERSIONS_LIST_READ'
    if '/versions/' in path:
        return 'ACTIVE_VERSION_READ'
    return 'CLOUDFLARE_API'


def provider_codes(doc):
    errors = doc.get('errors') if isinstance(doc, dict) else None
    if not isinstance(errors, list):
        return []
    return [e['code'] for e in errors[:10] if isinstance(e, dict) and type(e.get('code')) is int]


def provider_hints(doc):
    # Fixed categories only: never expose Cloudflare's message text, which may
    # echo a submitted value, source code, account ID or URL.
    errors = doc.get('errors') if isinstance(doc, dict) else None
    if not isinstance(errors, list):
        return []
    message = ' '.join(str(e.get('message', '')) for e in errors[:10] if isinstance(e, dict)).lower()
    terms = {'DURABLE_OBJECT': 'durable object', 'BINDING_INHERIT': 'inherit',
             'METADATA': 'metadata', 'VERSION_ID': 'version_id', 'MAIN_MODULE': 'main_module',
             'BINDING': 'binding', 'SYNTAX': 'syntax', 'COMPATIBILITY': 'compatibility',
             'MULTIPART': 'multipart', 'PERMISSION': 'permission',
             'AUTHENTICATION': 'authentication', 'ACCOUNT_ID': 'account identifier'}
    return [label for label, term in terms.items() if term in message]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api_client(token):
    if not isinstance(token, str) or not token or len(token) > 2048 or any(ord(c) <= 32 or ord(c) >= 127 for c in token):
        raise Stop('TOKEN_FORMAT_INVALID')
    def call(method, path, body=None, content_type='application/json'):
        stage = request_stage(method, path)
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        req = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
            data=data, method=method, headers={'Authorization': 'Bearer ' + token,
            'Accept': '*/*' if path.endswith('/content/v2') else 'application/json', 'Content-Type': content_type})
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=60) as r:
                raw = r.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise Stop('CLOUDFLARE_RESPONSE_TOO_LARGE')
                if path.endswith('/content/v2'):
                    return {'body': raw, 'contentType': r.headers.get('Content-Type', ''), 'entrypoint': r.headers.get('cf-entrypoint'), 'contentDisposition': r.headers.get('Content-Disposition')}
                doc = json.loads(raw)
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                rejected = json.loads(e.read(16384))
                codes, hints = provider_codes(rejected), provider_hints(rejected)
            except Exception:
                codes, hints = [], []
            finally:
                e.close()
            raise Stop('CLOUDFLARE_REQUEST_REJECTED', status, stage, codes, hints) from None
        except Stop:
            raise
        except Exception:
            raise Stop('CLOUDFLARE_RESULT_UNCONFIRMED', stage=stage) from None
        if doc.get('success') is not True:
            raise Stop('CLOUDFLARE_API_REJECTED', stage=stage, provider_codes=provider_codes(doc), hints=provider_hints(doc))
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


def recent_versions(api, base):
    doc = api('GET', base + '/versions')
    rows = doc.get('items') if isinstance(doc, dict) else doc
    if not isinstance(rows, list) or not rows:
        raise Stop('VERSION_HISTORY_REQUIRED')
    ids, numbers = set(), set()
    for row in rows:
        if not isinstance(row, dict) or not UUID.fullmatch(row.get('id', '')):
            raise Stop('VERSION_HISTORY_INVALID')
        n = row.get('number')
        if type(n) not in (int, float) or n < 1 or n != int(n) or row['id'] in ids or n in numbers:
            raise Stop('VERSION_HISTORY_INVALID')
        ids.add(row['id'])
        numbers.add(n)
    return sorted(rows, key=lambda row: row['number'], reverse=True)


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


def settings_difference(before, after):
    """Values and binding names never leave the owner machine."""
    known = {'annotations', 'bindings', 'cache_options', 'compatibility_date',
        'compatibility_flags', 'exports_reconciliation', 'limits', 'logpush',
        'observability', 'placement', 'tags', 'tail_consumers', 'usage_model',
        'migration_tag', 'main_module', 'body_part', 'etag', 'modified_on',
        'created_on', 'last_deployed_from'}
    changed = {k for k in set(before) | set(after) if before.get(k) != after.get(k) or (k in before) != (k in after)}
    old_bindings, new_bindings = before.get('bindings'), after.get('bindings')
    def binding_map(rows):
        if not isinstance(rows, list) or any(not isinstance(b, dict) or not isinstance(b.get('name'), str) for b in rows):
            return None
        result = {b['name']: b for b in rows}
        return result if len(result) == len(rows) else None
    old, new = binding_map(old_bindings), binding_map(new_bindings)
    order_only = old is not None and new is not None and old == new and old_bindings != new_bindings
    detail = set()
    if old is not None and new is not None:
        for name in set(old) & set(new):
            detail.update(k for k in set(old[name]) | set(new[name]) if old[name].get(k) != new[name].get(k) or (k in old[name]) != (k in new[name]))
    allowed_binding_fields = {'type', 'text', 'json', 'namespace_id', 'class_name', 'environment', 'script_name', 'name', 'id'}
    return {'changedSettingFields': sorted(changed & known) + (['OTHER'] if changed - known else []),
        'bindingsOrderOnly': order_only,
        'bindingNamesUnchanged': old is not None and new is not None and set(old) == set(new),
        'bindingValuesUnchanged': old is not None and new is not None and old == new,
        'changedBindingFields': sorted(detail & allowed_binding_fields) + (['OTHER'] if detail - allowed_binding_fields else []),
        'equalIgnoringOnlyBindingOrderAndVersionAnnotations':
            not (changed - {'bindings', 'annotations'}) and old is not None and new is not None and old == new}


def settings_equivalent(before, after):
    if not isinstance(before, dict) or not isinstance(after, dict):
        return False
    def normalize(settings):
        value = {k: v for k, v in settings.items() if k != 'annotations'}
        rows = value.get('bindings')
        if not isinstance(rows, list) or any(not isinstance(row, dict) or not isinstance(row.get('name'), str) for row in rows):
            raise Stop('BINDINGS_INVALID')
        if len({row['name'] for row in rows}) != len(rows):
            raise Stop('BINDINGS_INVALID')
        value['bindings'] = sorted(rows, key=lambda row: row['name'])
        return value
    # Only per-version annotations and unordered binding-list representation are
    # normalized. Every binding field and all other settings remain exact.
    return normalize(before) == normalize(after)


def candidate_source_matches(content, expected):
    body, kind = content.get('body'), content.get('contentType', '')
    if not isinstance(body, bytes) or len(body) > 2 * 1024 * 1024:
        return False
    entrypoint = content.get('entrypoint')
    if entrypoint not in (None, 'worker.mjs'):
        return False
    if kind.lower().startswith('multipart/'):
        msg = BytesParser(policy=email_policy).parsebytes(('Content-Type: ' + kind + '\r\nMIME-Version: 1.0\r\n\r\n').encode() + body)
        if not msg.is_multipart() or msg.defects:
            return False
        modules = []
        for part in msg.iter_parts():
            name = part.get_filename() or part.get_param('name', header='content-disposition')
            if name == 'metadata':
                continue
            if part.is_multipart() or name != 'worker.mjs' or part.defects:
                return False
            modules.append(part.get_payload(decode=True))
        if len(modules) != 1:
            return False
        body = modules[0]
    return body == expected


def resume_pending(api, account, checkpoint_dir, public_probe=probe, code=None):
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account):
        raise Stop('ACCOUNT_ID_INVALID')
    base = '/accounts/' + account + '/workers/scripts/' + NAME
    before = active(api, base)
    checkpoint = find_checkpoint(checkpoint_dir, before)
    settings = checkpoint['settings']
    if before != checkpoint['deployment'] or not settings_equivalent(settings, api('GET', base + '/settings')):
        raise Stop('PENDING_BASELINE_CHANGED')
    verified_settings(settings)
    if api('GET', '/accounts/' + account + '/workers/subdomain').get('subdomain') != 'kocoro97':
        raise Stop('EXISTING_SUBDOMAIN_MISMATCH')
    history = recent_versions(api, base)
    if len(history) < 2 or history[0]['id'] == before['version'] or history[1]['id'] != before['version']:
        raise Stop('SINGLE_PENDING_CANDIDATE_REQUIRED')
    candidate = history[0]['id']
    if api('GET', base + '/versions/' + candidate).get('id') != candidate:
        raise Stop('PENDING_VERSION_UNCONFIRMED')
    expected = bundle() if code is None else code
    content = api('GET', base + '/content/v2')
    if not candidate_source_matches(content, expected):
        raise Stop('PENDING_CANDIDATE_CODE_MISMATCH')
    old, _ = public_probe()
    if old.get('freshTestEnvironment') is not True or old.get('testEnvironment') != 'nh-staging':
        raise Stop('ISOLATED_GAS_METADATA_REQUIRED')
    history = recent_versions(api, base)
    if len(history) < 2 or [row['id'] for row in history[:2]] != [candidate, before['version']] or active(api, base) != before or not settings_equivalent(settings, api('GET', base + '/settings')):
        raise Stop('CONCURRENT_CHANGE_NO_ACTIVATION')
    result = activate_candidate(api, base, before, settings, old, candidate, public_probe)
    result.update(candidateCodeVerified=True, codeUploadAttempted=False)
    return result


def find_checkpoint(checkpoint_dir, current):
    checkpoint = None
    # Checkpoints belong to the owner; no paths, settings, binding names or values
    # are printed. Reject symlinks and cap parsing. No checkpoint is rewritten.
    paths = sorted(checkpoint_dir.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths[:100]:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            continue
        try:
            doc = json.loads(path.read_text())
            if doc.get('worker') == NAME and doc.get('deployment', {}).get('version') == current['version']:
                verified_settings(doc.get('settings'))
                checkpoint = doc
                break
        except Exception:
            continue
    if checkpoint is None:
        raise Stop('MATCHING_OWNER_CHECKPOINT_REQUIRED')
    return checkpoint


def inspect_pending(api, account, checkpoint_dir):
    if not re.fullmatch(r'[a-fA-F0-9]{32}', account):
        raise Stop('ACCOUNT_ID_INVALID')
    base = '/accounts/' + account + '/workers/scripts/' + NAME
    current = active(api, base)
    history = recent_versions(api, base)
    settings = api('GET', base + '/settings')
    checkpoint = find_checkpoint(checkpoint_dir, current)
    return {'status': 'PASS', 'phase': 'PENDING_CANDIDATE_INSPECTION_READ_ONLY',
        'deploymentAttempted': False, 'activeVersionUnchanged': True,
        'deploymentIdUnchanged': current['id'] == checkpoint['deployment']['id'],
        'latestIsActive': history[0]['id'] == current['version'],
        'candidateImmediatelyFollowsActive': len(history) > 1 and history[0]['id'] != current['version'] and history[1]['id'] == current['version'],
        **settings_difference(checkpoint['settings'], settings)}


def deploy(api, account, save, public_probe=probe, code=None, diagnose=False):
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
    # The legacy /workers/scripts/.../versions API accepts only "latest" for
    # inherit.version_id; UUID inheritance is supported by a different Workers
    # API, not this existing script. Refuse an unactivated latest upload.
    if recent_versions(api, base)[0]['id'] != before['version']:
        raise Stop('LATEST_VERSION_NOT_ACTIVE')
    if diagnose:
        return {'status': 'PASS', 'phase': 'WORKER_CODE_ONLY_PREFLIGHT_READ_ONLY',
                'deploymentAttempted': False}
    code = bundle() if code is None else code
    # At this point latest is the active version. Strict inheritance prevents
    # unresolved bindings being silently dropped; lineage is checked afterward.
    metadata = {'main_module': 'worker.mjs', 'compatibility_date': settings['compatibility_date'],
        'compatibility_flags': settings.get('compatibility_flags', []),
        'bindings': [{'name': b['name'], 'type': 'inherit', 'version_id': 'latest'} for b in bindings]}
    if 'usage_model' in settings:
        metadata['usage_model'] = settings['usage_model']
    save({'worker': NAME, 'deployment': before, 'settings': settings})
    if recent_versions(api, base)[0]['id'] != before['version'] or active(api, base) != before or not settings_equivalent(settings, api('GET', base + '/settings')):
        raise Stop('CONCURRENT_CHANGE_NO_UPLOAD')
    body, mime = multipart(metadata, code)
    uploaded = api('POST', base + '/versions?bindings_inherit=strict', body, mime)
    candidate = uploaded.get('id', '')
    if not UUID.fullmatch(candidate):
        raise Stop('UPLOADED_VERSION_UNCONFIRMED')
    history = recent_versions(api, base)
    if len(history) < 2 or [row['id'] for row in history[:2]] != [candidate, before['version']]:
        raise Stop('CONCURRENT_UPLOAD_NO_ACTIVATION')
    if active(api, base) != before or not settings_equivalent(settings, api('GET', base + '/settings')):
        raise Stop('CONCURRENT_CHANGE_NO_ACTIVATION')
    return activate_candidate(api, base, before, settings, old, candidate, public_probe)


def activate_candidate(api, base, before, settings, old, candidate, public_probe):
    deployment = lambda version: {'strategy': 'percentage', 'versions': [{'version_id': version, 'percentage': 100}]}
    try:
        api('POST', base + '/deployments', deployment(candidate))
        if active(api, base)['version'] != candidate:
            raise Stop('ACTIVATION_UNCONFIRMED')
        after_settings = api('GET', base + '/settings')
        # No settings mutation is allowed, including secrets, logging and limits.
        if not settings_equivalent(settings, after_settings):
            raise Stop('SETTINGS_CHANGED')
        for attempt in range(3):
            new, exposed = public_probe()
            if any(new.get(k) != old.get(k) for k in CAPABILITIES):
                raise Stop('POST_ACTIVATION_CAPABILITIES_CHANGED')
            if new.get('developmentReadResilienceVersion') == 1 and new.get('developmentFiveMinuteReferenceVersion') == (1 if old.get('developmentPublicMarket') is True else 0) and exposed:
                break
            if attempt == 2:
                raise Stop('POST_ACTIVATION_MARKER_UNCONFIRMED')
            time.sleep(attempt + 1)
        return {'status': 'PASS', 'phase': 'WORKER_CODE_ONLY_ACTIVE', 'version': candidate,
            'previousVersion': before['version'], 'rollback': 'NOT_NEEDED'}
    except Exception as activation_error:
        # A timed-out activation may have succeeded. Check its result before any
        # rollback; never overwrite a different actor's concurrent deployment.
        try:
            current = active(api, base)['version']
            if current == candidate:
                api('POST', base + '/deployments', deployment(before['version']))
            elif current != before['version']:
                raise Stop('CONCURRENT_DEPLOYMENT_MANUAL_RECOVERY_REQUIRED')
            if active(api, base)['version'] != before['version'] or not settings_equivalent(settings, api('GET', base + '/settings')):
                raise Stop('ROLLBACK_VERIFICATION_FAILED')
            restored, _ = public_probe()
            if any(restored.get(k) != old.get(k) for k in CAPABILITIES) or restored.get('developmentReadResilienceVersion') != old.get('developmentReadResilienceVersion'):
                raise Stop('ROLLBACK_VERIFICATION_FAILED')
        except Exception:
            raise Stop('ACTIVATION_FAILED_MANUAL_RECOVERY_REQUIRED') from None
        result = {'status': 'FAIL', 'phase': 'WORKER_CODE_ONLY_ACTIVATION', 'rollback': 'PASS_PREVIOUS_VERSION_RESTORED', 'code': activation_error.code if isinstance(activation_error, Stop) else 'ACTIVATION_RESULT_UNCONFIRMED'}
        if isinstance(activation_error, Stop) and activation_error.stage:
            result.update(requestStage=activation_error.stage, providerCodes=activation_error.provider_codes, providerHints=activation_error.hints)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--diagnose', action='store_true', help='Read-only existing Worker/version preflight; no upload or activation')
    modes.add_argument('--inspect-pending', action='store_true', help='Read-only compare the owner checkpoint and current pending candidate; never upload or activate')
    modes.add_argument('--resume-pending', action='store_true', help='Verify existing pending candidate bytes and activate it; no code upload')
    args = parser.parse_args()
    try:
        account = os.environ.get('CLOUDFLARE_ACCOUNT_ID') or input('Cloudflare Account ID: ').strip()
        token = os.environ.get('CLOUDFLARE_API_TOKEN') or getpass.getpass('Cloudflare API token (hidden): ')
        checkpoint_dir = Path.home() / '.myinvest-worker-rollback'
        checkpoint = checkpoint_dir / (uuid.uuid4().hex + '.json')
        api = api_client(token.strip())
        if args.inspect_pending:
            result = inspect_pending(api, account.strip(), checkpoint_dir)
        elif args.resume_pending:
            result = resume_pending(api, account.strip(), checkpoint_dir)
        else:
            result = deploy(api, account.strip(), lambda doc: private_checkpoint(checkpoint, doc), diagnose=args.diagnose)
    except Stop as e:
        result = {'status': 'FAIL' if e.code == 'ACTIVATION_FAILED_MANUAL_RECOVERY_REQUIRED' else 'NOT_RUN', 'code': e.code}
        if e.http:
            result['http'] = e.http
        if e.stage:
            result['requestStage'] = e.stage
            result['providerCodes'] = e.provider_codes
            result['providerHints'] = e.hints
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
