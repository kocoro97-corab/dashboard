"""Owner-run, free, temporary HTTPS exposure of the EXISTING isolated auth relay.
No Google resource creation/deployment, NH calls or account-store operations.
"""
import argparse
from contextlib import contextmanager
import getpass
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
from wsgiref.simple_server import make_server

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tools')]
from relay.app import Config, RelayApp
from relay.public_dev import PublicDevelopment
from nh_v2_relay_check import ThreadedWSGI, QuietWSGI, deployment_settings
from nh_v2_live_check import preflight
from nh_v2_fresh import private_path, SAFE_OWNER_CODES
from nh_staging_test import fingerprint
from build_dev_pages import PAGE
from install_dev_tunnel import SHA256
from nh_v2_https_browser import HttpsProbeFailure
import hashlib

SAFE_STARTUP_CODES = SAFE_OWNER_CODES | frozenset('''
HTTPS_CONNECTOR_MISSING HTTPS_CONNECTOR_NOT_EXECUTABLE HTTPS_CONNECTOR_CHECKSUM
HTTPS_OWNER_TTY_REQUIRED HTTPS_EXISTING_TUNNEL_CONFIG_STOP HTTPS_PRIVATE_PLAN_REQUIRED
DEPLOYMENT_SETTINGS_NOT_VERIFIED FRESH_REVIEWED_PLAN_REQUIRED FRESH_TARGET_REQUIRED
SOURCE_IDENTITY_FAILED FRESH_BINDING_FAILED HTTPS_TUNNEL_API_DENIED
HTTPS_TUNNEL_UNAVAILABLE HTTPS_EDGE_NOT_CONFIRMED DEV_HTTPS_CONFIG_INVALID
RELAY_TARGET_MISMATCH RELAY_GAS_ACCESS_REQUIRED RELAY_UPSTREAM_HTTP
RELAY_UPSTREAM_NETWORK RELAY_NON_JSON RELAY_RESPONSE_INVALID
RELAY_GOOGLE_CONTENT_400 RELAY_REDIRECT_DENIED RELAY_REDIRECT_METHOD_DENIED
'''.split())


def validate_runtime(binary, needs_tty=True):
    if not binary.is_file():raise ValueError('HTTPS_CONNECTOR_MISSING')
    if not os.access(binary, os.X_OK):raise ValueError('HTTPS_CONNECTOR_NOT_EXECUTABLE')
    if needs_tty and not sys.stdin.isatty():raise ValueError('HTTPS_OWNER_TTY_REQUIRED')
    if hashlib.sha256(binary.read_bytes()).hexdigest() != SHA256:raise ValueError('HTTPS_CONNECTOR_CHECKSUM')
    if any((Path.home() / '.cloudflared' / name).exists() for name in ('config.yml', 'config.yaml')):
        raise ValueError('HTTPS_EXISTING_TUNNEL_CONFIG_STOP')


@contextmanager
def tunnel(server_port, binary, lifetime):
    """Read bounded process output privately. Emit only the public hostname.
    No debug logging, log file, auto-update, provider account or payment setup.
    """
    command = [str(binary), 'tunnel', '--no-autoupdate', '--protocol', 'http2',
               '--edge-ip-version', '4', '--metrics', '127.0.0.1:0',
               '--no-chunked-encoding', '--loglevel', 'info', '--logfile', '',
               '--retries', '1', '--management-diagnostics=false',
               '--url', 'http://127.0.0.1:' + str(server_port)]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    stop = threading.Event()
    found = {}
    ready = threading.Event()
    connected = threading.Event()
    def drain():
        total = 0
        while not stop.is_set():
            line = process.stdout.readline(16384)
            if not line:
                return
            total += len(line)
            if b'403' in line or b'Forbidden' in line:
                found['failure'] = 'HTTPS_TUNNEL_API_DENIED'
            if b'Registered tunnel connection' in line:
                connected.set()
            match = re.search(rb'https://([a-z0-9-]+\.trycloudflare\.com)(?:\s|\|)', line)
            if match and not ready.is_set():
                found['host'] = match[1].decode()
                ready.set()
            # Raw output is discarded, never stored/printed, including on error.
            if total > 2 * 1024 * 1024:
                stop.set()
                process.terminate()
                return
    threading.Thread(target=drain, daemon=True).start()
    try:
        deadline = time.monotonic() + 45
        while not (ready.is_set() and connected.is_set()):
            if process.poll() is not None or time.monotonic() >= deadline:
                raise RuntimeError(found.get('failure', 'HTTPS_TUNNEL_UNAVAILABLE'))
            time.sleep(.25)
        yield found['host'], process
    finally:
        stop.set()
        if process.poll() is None:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        process.stdout.close()


@contextmanager
def serve(app, binary, lifetime):
    server = make_server('127.0.0.1', 0, app, server_class=ThreadedWSGI, handler_class=QuietWSGI)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tunnel(server.server_port, binary, lifetime) as (host, process):
            app.host = host
            yield 'https://' + host + '/api', process
    finally:
        app.close()
        server.shutdown()
        server.server_close()


def main():
    def terminate(_signum, _frame):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--cloudflared', type=Path, required=True)
    parser.add_argument('--minutes', type=int, default=30, choices=range(1, 61))
    parser.add_argument('--verify-browser', action='store_true', help='Verify only the new public HTTPS/Pages path, then keep it open for Fold6')
    parser.add_argument('--diagnose-preflight', action='store_true', help='Read-only checks only: no tunnel, password prompt, login, browser or account writes')
    args = parser.parse_args()
    report = {'status': 'NOT_RUN', 'phase': 'LOCAL_RUNTIME', 'actualNhCalls': 0, 'orderCalls': 0, 'accountStoreWrites': False}
    try:
        validate_runtime(args.cloudflared, needs_tty=not args.diagnose_preflight)
        report['phase'] = 'PRIVATE_ENVIRONMENT'
        env = private_path(args.environment, False)
        try:plan = json.loads((env / 'fresh-plan.json').read_text())
        except Exception:raise ValueError('HTTPS_PRIVATE_PLAN_REQUIRED') from None
        report['phase'] = 'GAS_SOURCE_PREFLIGHT'
        web = preflight(env, allow_same_source_tools=True)
        report['phase'] = 'DEPLOYMENT_SETTINGS'
        settings = deployment_settings(plan)
        if settings.get('status') != 'PASS':
            report['deploymentSettings'] = settings
            raise ValueError('DEPLOYMENT_SETTINGS_NOT_VERIFIED')
        if args.diagnose_preflight:
            report.update(status='PASS', phase='PREFLIGHT_COMPLETE', scope='HTTPS_PREFLIGHT_ONLY', sourceDigest='PASS', isolation='PASS', deploymentSettings=settings)
            print(json.dumps(report));return 0
        report['phase'] = 'DEVELOPMENT_CODE'
        access_code = getpass.getpass('Separate development access code (16-128 ASCII letters/digits/_/-; hidden): ')
        expected = {'freshTestEnvironment': True, 'testEnvironment': 'nh-staging',
                    'scriptHash': fingerprint(plan['scriptId']), 'sheetHash': web.binding,
                    'sourceDigest': plan['sourceDigest'], 'gatewayVersion': 2, 'storeEngine': 'account-store-v2'}
        relay = RelayApp(Config(upstream=plan['url'], origins=frozenset({'https://kocoro97-corab.github.io'}), expected=expected))
        public = PublicDevelopment(relay, PAGE, access_code, lifetime=args.minutes * 60)
        # Verify the fixed target privately before exposing login traffic.
        report['phase'] = 'TARGET_METADATA'
        relay.gateway.verify()
        report['phase'] = 'HTTPS_TUNNEL'
        with serve(public, args.cloudflared.resolve(), args.minutes * 60) as (endpoint, process):
            from nh_v2_https_browser import probe, verify
            report['phase'] = 'PUBLIC_HTTPS_PROBE'
            dns=probe(endpoint, access_code,
                      on_dns_wait=lambda info:print(json.dumps(dict(info,progress='HTTPS_DNS_WAIT')),flush=True),
                      on_edge_wait=lambda info:print(json.dumps(dict(info,progress='HTTPS_EDGE_WAIT')),flush=True))
            print(json.dumps({'status': 'HTTPS_DEV_READY', 'page': PAGE, 'endpoint': endpoint,
                              'expiresInMinutes': args.minutes, 'sourceDigest': 'PASS', 'isolation': 'PASS',
                              'authOnly': True, 'orderCalls': 0, 'secretsIncluded': False, 'dns': dns}), flush=True)
            if args.verify_browser:
                report['phase'] = 'PAGES_BROWSER'
                username = input('Staging user (visible): ').strip()
                password = getpass.getpass('Staging password (hidden): ')
                result = verify(endpoint, access_code, username, password)
                result['realHttpPreflights'] = relay.metrics['preflights']
                print(json.dumps(result), flush=True)
                if result['status'] != 'PASS':
                    report.update(status='FAIL', code='HTTPS_BROWSER_NOT_CONFIRMED')
                    return 2
            print('Keep this terminal open. Ctrl+C closes external access. Enter the same private development code on the development page.', flush=True)
            report['phase'] = 'SERVING'
            while process.poll() is None and time.monotonic() < public.deadline:
                time.sleep(.5)
            if process.poll() is not None:
                report.update(status='FAIL', code='HTTPS_TUNNEL_STOPPED')
            else:
                report.update(status='PASS', code='HTTPS_DEV_EXPIRED_CLOSED')
    except KeyboardInterrupt:
        report.update(status='PASS', code='HTTPS_DEV_OWNER_CLOSED')
    except Exception as error:
        code = str(error)
        if isinstance(error,HttpsProbeFailure):report.update(code=error.code,probe=error.evidence)
        else:report.update(code=code if code in SAFE_STARTUP_CODES else 'HTTPS_DEV_PREFLIGHT_OR_TUNNEL_REQUIRED')
    print(json.dumps(report))
    return 0 if report['status'] == 'PASS' else 2


if __name__ == '__main__':raise SystemExit(main())
