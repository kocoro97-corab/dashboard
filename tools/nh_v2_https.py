"""Owner-run, free, temporary HTTPS exposure of the EXISTING isolated auth relay.
No Google resource creation/deployment, NH calls or account-store operations.
"""
import argparse
from contextlib import contextmanager
import getpass
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
import re
import signal
import socket
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
HTTPS_PUBLIC_MARKET_FLAG_REQUIRED
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


@contextmanager
def ready_public_relay(relay, access_code, binary, lifetime, on_progress):
    """Keep the successful allocation alive; replace only confirmed missing DNS.

    At most three allocations, with full cleanup between them. Authentication,
    metadata POST, HTTP/CORS and caller/browser failures are never retried here.
    """
    from nh_v2_https_browser import probe, public_dns_status, wait_for_dns
    for attempt in range(1, 4):
        public = PublicDevelopment(relay, PAGE, access_code, lifetime=lifetime)
        with serve(public, binary, lifetime) as (endpoint, process):
            try:
                dns = probe(endpoint, access_code,
                    on_dns_wait=lambda info:on_progress(dict(info, progress='HTTPS_DNS_WAIT')),
                    on_edge_wait=lambda info:on_progress(dict(info, progress='HTTPS_EDGE_WAIT')))
            except HttpsProbeFailure as error:
                if error.code != 'HTTPS_DNS_NOT_READY' or error.evidence.get('dnsTarget') != 'PUBLIC_RELAY':
                    raise
                # Check the SAME allocation while its connector is still alive.
                # A separate diagnostic hostname cannot establish its readiness.
                status = public_dns_status(urlsplit(endpoint).hostname)
                evidence = dict(error.evidence, publicDns=status, allocationAttempt=attempt)
                missing = status in ('NXDOMAIN', 'NO_A_RECORD')
                controls = evidence.get('tunnelApiDns') is True and evidence.get('pagesDns') is True
                if status == 'ANSWER' and controls:
                    # The name exists publicly: keep THIS connector alive while
                    # the system resolver catches up. No alternate-IP connection,
                    # resolver changes or credential-bearing HTTP is retried.
                    remaining=min(60,max(0,public.deadline-public.clock()))
                    on_progress(dict(evidence,progress='HTTPS_LOCAL_DNS_WAIT',waitLimitSeconds=int(remaining)))
                    try:
                        wait_for_dns(endpoint,timeout=remaining,interval=8,max_attempts=8)
                        dns=probe(endpoint, access_code,
                            on_dns_wait=lambda info:on_progress(dict(info,progress='HTTPS_DNS_WAIT')),
                            on_edge_wait=lambda info:on_progress(dict(info,progress='HTTPS_EDGE_WAIT')))
                    except HttpsProbeFailure as pending:
                        raise HttpsProbeFailure(pending.code,dict(pending.evidence,publicDns=status,
                            allocationAttempt=attempt,localWaitAttempted=True)) from None
                elif missing and controls and attempt < 3:
                    on_progress(dict(evidence, progress='HTTPS_TUNNEL_REALLOCATING'))
                    continue  # Context cleanup closes the failed allocation first.
                else:
                    raise HttpsProbeFailure(error.code, evidence) from None
            dns = dict(dns, allocationAttempt=attempt)
            # Deliberately outside the probe exception handler: no retry after
            # yielding, when the owner/browser may already have authenticated.
            yield endpoint, process, public, dns
            return


def main():
    def terminate(_signum, _frame):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--environment', type=Path, required=True)
    parser.add_argument('--cloudflared', type=Path, required=True)
    parser.add_argument('--minutes', type=int, default=30, choices=range(1, 61))
    parser.add_argument('--verify-browser', action='store_true', help='Verify only the new public HTTPS/Pages path, then keep it open for Fold6')
    parser.add_argument('--public-market', action='store_true', help='Enable only authenticated allowlisted public market GETs; NH and storage stay blocked')
    parser.add_argument('--verify-market', action='store_true', help='Check public market display with the existing browser verifier; requires --public-market')
    parser.add_argument('--diagnose-market', action='store_true', help='Inspect only two fixed public response shapes through existing GAS; no tunnel/browser/NH/store')
    parser.add_argument('--diagnose-preflight', action='store_true', help='Read-only checks only: no tunnel, password prompt, login, browser or account writes')
    parser.add_argument('--diagnose-tunnel-dns', action='store_true', help='Credential-free tunnel DNS comparison only; no GAS or login')
    args = parser.parse_args()
    report = {'status': 'NOT_RUN', 'phase': 'LOCAL_RUNTIME', 'actualNhCalls': 0, 'orderCalls': 0, 'accountStoreWrites': False}
    try:
        validate_runtime(args.cloudflared, needs_tty=not (args.diagnose_preflight or args.diagnose_tunnel_dns))
        if (args.verify_market or args.diagnose_market) and not args.public_market:raise ValueError('HTTPS_PUBLIC_MARKET_FLAG_REQUIRED')
        if args.diagnose_tunnel_dns:
            from nh_v2_https_browser import diagnose_tunnel_dns
            report['phase'] = 'TUNNEL_DNS_DIAGNOSTIC'
            # Reserve an unlistening loopback port: this diagnostic exposes no
            # application, even while the connector is registered at the edge.
            with socket.socket() as reserved:
                reserved.bind(('127.0.0.1', 0))
                with tunnel(reserved.getsockname()[1], args.cloudflared.resolve(), 60) as (host, _):
                    samples = diagnose_tunnel_dns('https://' + host + '/api',
                        on_sample=lambda sample:print(json.dumps(dict(sample, progress='TUNNEL_DNS_DIAGNOSTIC')), flush=True))
            report.update(code='TUNNEL_DNS_DIAGNOSTIC_COMPLETE', diagnosticComplete=True, samples=samples)
            print(json.dumps(report));return 0
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
        access_code = None if args.diagnose_market else getpass.getpass('Separate development access code (16-128 ASCII letters/digits/_/-; hidden): ')
        expected = {'freshTestEnvironment': True, 'testEnvironment': 'nh-staging',
                    'scriptHash': fingerprint(plan['scriptId']), 'sheetHash': web.binding,
                    'sourceDigest': plan['sourceDigest'], 'gatewayVersion': 2, 'storeEngine': 'account-store-v2'}
        relay = RelayApp(Config(upstream=plan['url'], origins=frozenset({'https://kocoro97-corab.github.io'}), expected=expected,public_market=args.public_market))
        # Verify the fixed target privately before exposing login traffic.
        report['phase'] = 'TARGET_METADATA'
        relay.gateway.verify()
        if args.diagnose_market:
            from nh_v2_https_browser import diagnose_market_proxy
            report['phase']='MARKET_PROXY_DIAGNOSTIC'
            username=input('Staging user (visible): ').strip()
            password=getpass.getpass('Staging password (hidden): ')
            report.update(diagnose_market_proxy(relay.gateway,username,password),scope='TEST_GAS_AUTH_PUBLIC_MARKET_ONLY')
            print(json.dumps(report));return 0 if report['status']=='PASS' else 2
        report['phase'] = 'PUBLIC_HTTPS_PROBE'
        with ready_public_relay(relay, access_code, args.cloudflared.resolve(), args.minutes * 60,
                                lambda info:print(json.dumps(info), flush=True)) as (endpoint, process, public, dns):
            from nh_v2_https_browser import verify
            print(json.dumps({'status': 'HTTPS_DEV_READY', 'page': PAGE, 'endpoint': endpoint,
                              'expiresInMinutes': args.minutes, 'sourceDigest': 'PASS', 'isolation': 'PASS',
                              'authOnly': not args.public_market, 'publicMarket': args.public_market,
                              'publicTransport': 'RELAY_DIRECT_AFTER_GAS_AUTH' if args.public_market else 'DISABLED',
                              'nhCallsAllowed': False, 'storageWritesAllowed': False,
                              'orderCalls': 0, 'secretsIncluded': False, 'dns': dns}), flush=True)
            if args.verify_browser or args.verify_market:
                report['phase'] = 'PAGES_BROWSER'
                username = input('Staging user (visible): ').strip()
                password = getpass.getpass('Staging password (hidden): ')
                samples=[]
                def check_market(page):
                    from nh_v2_https_browser import market_screen_check
                    samples.append(market_screen_check(page))
                result = verify(endpoint, access_code, username, password,
                                dashboard_check=check_market if args.verify_market else None)
                if args.verify_market:result.update(publicMarket='PASS' if result['status']=='PASS' else 'FAIL',publicSamples=samples)
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
