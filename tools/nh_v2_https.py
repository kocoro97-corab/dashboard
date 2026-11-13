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
from nh_v2_fresh import private_path
from nh_staging_test import fingerprint
from build_dev_pages import PAGE
from install_dev_tunnel import SHA256
import hashlib


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
    args = parser.parse_args()
    report = {'status': 'NOT_RUN', 'actualNhCalls': 0, 'orderCalls': 0, 'accountStoreWrites': False}
    try:
        if not args.cloudflared.is_file() or not os.access(args.cloudflared, os.X_OK) or not sys.stdin.isatty():
            raise ValueError()
        if hashlib.sha256(args.cloudflared.read_bytes()).hexdigest() != SHA256:
            raise ValueError()
        if any((Path.home() / '.cloudflared' / name).exists() for name in ('config.yml', 'config.yaml')):
            raise ValueError()
        env = private_path(args.environment, False)
        plan = json.loads((env / 'fresh-plan.json').read_text())
        web = preflight(env, allow_same_source_tools=True)
        settings = deployment_settings(plan)
        if settings.get('status') != 'PASS':
            report['deploymentSettings'] = settings
            raise ValueError()
        access_code = getpass.getpass('Separate development access code (16-128 ASCII letters/digits/_/-; hidden): ')
        expected = {'freshTestEnvironment': True, 'testEnvironment': 'nh-staging',
                    'scriptHash': fingerprint(plan['scriptId']), 'sheetHash': web.binding,
                    'sourceDigest': plan['sourceDigest'], 'gatewayVersion': 2, 'storeEngine': 'account-store-v2'}
        relay = RelayApp(Config(upstream=plan['url'], origins=frozenset({'https://kocoro97-corab.github.io'}), expected=expected))
        public = PublicDevelopment(relay, PAGE, access_code, lifetime=args.minutes * 60)
        # Verify the fixed target privately before exposing login traffic.
        relay.gateway.verify()
        with serve(public, args.cloudflared.resolve(), args.minutes * 60) as (endpoint, process):
            from nh_v2_https_browser import probe, verify
            probe(endpoint, access_code)
            print(json.dumps({'status': 'HTTPS_DEV_READY', 'page': PAGE, 'endpoint': endpoint,
                              'expiresInMinutes': args.minutes, 'sourceDigest': 'PASS', 'isolation': 'PASS',
                              'authOnly': True, 'orderCalls': 0, 'secretsIncluded': False}), flush=True)
            if args.verify_browser:
                username = input('Staging user (visible): ').strip()
                password = getpass.getpass('Staging password (hidden): ')
                result = verify(endpoint, access_code, username, password)
                result['realHttpPreflights'] = relay.metrics['preflights']
                print(json.dumps(result), flush=True)
                if result['status'] != 'PASS':
                    report.update(status='FAIL', code='HTTPS_BROWSER_NOT_CONFIRMED')
                    return 2
            print('Keep this terminal open. Ctrl+C closes external access. Enter the same private development code on the development page.', flush=True)
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
        report.update(code=code if code in ('HTTPS_TUNNEL_API_DENIED', 'HTTPS_TUNNEL_UNAVAILABLE', 'HTTPS_EDGE_NOT_CONFIRMED') else 'HTTPS_DEV_PREFLIGHT_OR_TUNNEL_REQUIRED')
    print(json.dumps(report))
    return 0 if report['status'] == 'PASS' else 2


if __name__ == '__main__':raise SystemExit(main())
