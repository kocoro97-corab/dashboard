"""Short-lived HTTPS development boundary around the existing auth-only relay.

Bind the HTTP origin to loopback only. Forwarded scheme/Host are accepted only
from that local tunnel; never expose this WSGI origin directly to the internet.
"""
import hashlib
import hmac
import json
import re
import threading
import time
from urllib.parse import urlsplit


class PublicDevelopment:
    def __init__(self, app, page, access_code, lifetime=1800, clock=time.monotonic):
        p = urlsplit(page)
        if (not app.config.isolated or not app.config.auth_only or
                p.scheme != 'https' or p.query or p.fragment or p.username or p.password or
                p.path != '/dashboard-v2-dev/' or
                p.hostname != 'kocoro97-corab.github.io' or p.port is not None or
                not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', access_code) or
                not 60 <= lifetime <= 3600):
            raise ValueError('DEV_HTTPS_CONFIG_INVALID')
        self.app = app
        self.page = page
        self.origin = p.scheme + '://' + p.netloc
        self.code_hash = hashlib.sha256(access_code.encode()).digest()
        self.clock = clock
        self.deadline = clock() + lifetime
        self.host = None  # Closed until the tunnel's exact hostname is known.
        self.closed = threading.Event()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(2)
        self.window = clock()
        self.requests = 0
        self.logins = 0

    def close(self):
        self.closed.set()

    def __call__(self, env, start):
        allowed = env.get('HTTP_ORIGIN') == self.origin

        def deny(status, code):
            headers = [('Content-Type', 'application/json'), ('Cache-Control', 'no-store'),
                       ('Vary', 'Origin'), ('X-Content-Type-Options', 'nosniff')]
            if allowed:
                headers.append(('Access-Control-Allow-Origin', self.origin))
            if status == 429:
                headers.append(('Retry-After', '60'))
            data = json.dumps({'success': False, 'code': code, 'layer': 'relay'}).encode()
            headers.append(('Content-Length', str(len(data))))
            start(str(status) + ' ' + {400: 'Bad Request', 403: 'Forbidden', 413: 'Payload Too Large',
                                      429: 'Too Many Requests', 503: 'Service Unavailable'}[status], headers)
            return [data]

        if self.closed.is_set() or self.clock() >= self.deadline:
            return deny(503, 'DEV_ACCESS_CLOSED')
        if (env.get('REMOTE_ADDR') != '127.0.0.1' or
                env.get('HTTP_X_FORWARDED_PROTO') != 'https' or
                not self.host or env.get('HTTP_HOST') != self.host):
            return deny(403, 'DEV_HTTPS_REQUIRED')
        if not allowed:
            return deny(403, 'RELAY_ORIGIN_DENIED')
        now = self.clock()
        with self.lock:
            if now - self.window >= 60:
                self.window = now
                self.requests = self.logins = 0
            self.requests += 1
            if self.requests > 120:
                return deny(429, 'DEV_RATE_LIMIT')
        if env.get('REQUEST_METHOD') == 'OPTIONS':
            requested = {x.strip().lower() for x in env.get('HTTP_ACCESS_CONTROL_REQUEST_HEADERS', '').split(',')}
            if requested - {'content-type', 'authorization', 'x-myinvest-dev-key'}:
                return deny(403, 'RELAY_PREFLIGHT_DENIED')
            # The secret is not carried in OPTIONS. Actual POST still requires it.
            forwarded = dict(env)
            forwarded['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] = ','.join(requested - {'x-myinvest-dev-key'})
            def preflight_start(status, headers, exc_info=None):
                headers = [(k, v + ', X-MyInvest-Dev-Key' if k == 'Access-Control-Allow-Headers' else v)
                           for k, v in headers]
                return start(status, headers) if exc_info is None else start(status, headers, exc_info)
            return self.app(forwarded, preflight_start)
        # Same-account Pages share an Origin. Check the full development referrer
        # too; this is a routing guard, not authentication. GAS validates sessions.
        if env.get('HTTP_REFERER') not in (self.page, self.page + 'index.html'):
            return deny(403, 'DEV_PAGE_REQUIRED')
        supplied = env.get('HTTP_X_MYINVEST_DEV_KEY', '')
        if len(supplied) > 128 or not hmac.compare_digest(hashlib.sha256(supplied.encode()).digest(), self.code_hash):
            return deny(403, 'DEV_ACCESS_REQUIRED')
        try:
            if env.get('HTTP_TRANSFER_ENCODING') or not 0 < int(env.get('CONTENT_LENGTH', '0')) <= 8192:
                return deny(413, 'RELAY_REQUEST_SIZE')
        except (ValueError, TypeError):
            return deny(400, 'RELAY_BAD_REQUEST')
        # Bound concurrent upstream calls; never rely on client-supplied IPs.
        if not self.slots.acquire(blocking=False):
            return deny(429, 'DEV_BUSY')
        try:
            import io
            n = int(env['CONTENT_LENGTH'])
            raw = env['wsgi.input'].read(n)
            if len(raw) != n:
                return deny(400, 'RELAY_BAD_REQUEST')
            try:
                payload = json.loads(raw)
            except Exception:
                return deny(400, 'RELAY_BAD_REQUEST')
            if isinstance(payload, dict) and payload.get('action') == 'login':
                with self.lock:
                    self.logins += 1
                    if self.logins > 5:
                        return deny(429, 'DEV_LOGIN_RATE_LIMIT')
            forwarded = dict(env, **{'wsgi.input': io.BytesIO(raw)})
            return self.app(forwarded, start)
        finally:
            self.slots.release()
