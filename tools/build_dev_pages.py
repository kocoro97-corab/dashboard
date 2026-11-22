"""Export only public frontend assets to a NEW development Pages artifact.
Never copy GAS, credentials, private configurations, source backups or CI files.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PAGE = 'https://kocoro97-corab.github.io/dashboard-v2-dev/'
CALENDAR_MODULES = (
    'invest-calendar-core-v2.js',
    'invest-calendar-style-v2.js',
    'invest-calendar-google-readonly-v2.js',
    'invest-calendar-google-oauth-setup-v1.js',
    'invest-calendar-official-market-events-v1.js',
    'invest-calendar-krx-official-v1.js',
    'invest-calendar-unified-market-v1.js',
    'invest-calendar-workspace-v2.js',
)
CALENDAR_CLIENT_RE = re.compile(r'^[0-9]{8,32}-[A-Za-z0-9_-]{12,80}\.apps\.googleusercontent\.com$')


def fixed_relay(value):
    from urllib.parse import urlsplit
    if not isinstance(value,str):raise ValueError('PERSISTENT_RELAY_ENDPOINT_INVALID')
    u=urlsplit(value)
    if not re.fullmatch(r'https://[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}\.workers\.dev/api',value) or u.port or u.username or u.password or u.query or u.fragment:
        raise ValueError('PERSISTENT_RELAY_ENDPOINT_INVALID')
    return value


def build(output, root=ROOT, relay_endpoint=None, *, use_public_config=True,
          include_calendar=False, google_calendar_client_id=None):
    if google_calendar_client_id is not None and not include_calendar:
        raise ValueError('GOOGLE_OAUTH_REQUIRES_CALENDAR_PREVIEW')
    public_config=root/'config/development-relay.json'
    if use_public_config and relay_endpoint is None and public_config.is_file():
        doc=json.loads(public_config.read_text())
        if set(doc)!={'profile','endpoint'} or doc['profile']!='isolated-persistent':raise ValueError('PERSISTENT_RELAY_CONFIG_INVALID')
        relay_endpoint=doc['endpoint']
    if relay_endpoint is not None:relay_endpoint=fixed_relay(relay_endpoint)
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError('DEV_OUTPUT_NOT_EMPTY')
    output.mkdir(parents=True, exist_ok=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    text = (root / 'index.html').read_text()
    text = '\n'.join(line for line in text.splitlines() if 'https://cdn.jsdelivr.net/npm/tesseract' not in line)
    text = text.replace('<head>', '<head>\n<meta name="referrer" content="strict-origin-when-cross-origin">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
        'script-src \'self\' \'unsafe-inline\' \'wasm-unsafe-eval\'; style-src \'self\' \'unsafe-inline\'; '
        'img-src \'self\' data:; connect-src \'self\' data: https://*.trycloudflare.com; '
        'frame-src https://s.tradingview.com; worker-src \'self\'; form-action \'none\'; base-uri \'none\'">')
    if relay_endpoint:
        from urllib.parse import urlsplit
        text=text.replace("https://*.trycloudflare.com;","https://*.trycloudflare.com "+urlsplit(relay_endpoint).scheme+'://'+urlsplit(relay_endpoint).netloc+';')
    marker = '<script src="js/transport.js?v=1"></script>'
    if text.count(marker) != 1:
        raise ValueError('DEV_TRANSPORT_MARKER_CHANGED')
    if relay_endpoint:
        text=text.replace(marker, '<script>window.MYINVEST_PERSISTENT_RELAY=Object.freeze('+json.dumps({'profile':'isolated','endpoint':relay_endpoint},separators=(',',':'))+');</script>\n'+marker)
    text = text.replace(marker, '<script>window.MYINVEST_TRANSPORT_CONFIG={mode:"relay",endpoint:"",devSession:true};</script>\n<script src="js/dev_market.js?v=1"></script>\n<script src="js/dev_inspection.js?v=1"></script>\n<script src="js/dev_connect.js?v=1"></script>\n' + marker)
    text = text.replace(marker, '<script src="vendor/ocr/tesseract.min.js"></script>\n<script src="js/dev_ocr.js?v=1"></script>\n'+marker)
    # Only the isolated development artifact receives the optional manual strategy
    # comparator. Production index.html, NEWS/PR#8 and live endpoints stay untouched.
    strategy_anchor = '<script src="js/page-strategy.js?v=1"></script>'
    if text.count(strategy_anchor) != 1:
        raise ValueError('DEV_STRATEGY_ANCHOR_CHANGED')
    strategy_optional_modules = (
        'market-evidence-gate-v1.js',
        'market-session-context-v1.js',
        'strategy-risk-capacity-v1.js',
        'strategy-scenario-compare-v1.js',
        'strategy-market-link-v1.js',
        'five-minute-read-candidate-v1.js',
        'five-minute-reference-panel-v1.js',
        'strategy-scenario-compare-panel-v1.js',
    )
    compare_scripts = ''.join('<script src="js/' + name + '?v=1"></script>\n'
                              for name in strategy_optional_modules)
    text = text.replace(strategy_anchor, compare_scripts + strategy_anchor)
    # Calendar explicitly OPT-IN for isolated dev review. No default build
    # or production index is changed. OAuth web client ID is PUBLIC, never a
    # client secret or access/refresh token; GIS requires a user gesture.
    if include_calendar:
        news_anchor = '<script src="js/page-news.js?v=2"></script>'
        if text.count(news_anchor) != 1:
            raise ValueError('DEV_CALENDAR_NEWS_ANCHOR_CHANGED')
        # Permission for the SDK/API is not a network request. Scripts are
        # loaded on explicit user action when no public client ID is built in.
        # Keep the ordinary (non-calendar) development CSP unchanged.
        text = text.replace("script-src 'self' ", "script-src 'self' https://accounts.google.com ")
        text = text.replace("connect-src 'self' data:", "connect-src 'self' https://www.googleapis.com https://accounts.google.com data:")
        text = text.replace("frame-src https://s.tradingview.com;",
                            "frame-src https://s.tradingview.com https://accounts.google.com;")
        oauth_scripts = ''
        if google_calendar_client_id is not None:
            if (not isinstance(google_calendar_client_id,str) or
                    not CALENDAR_CLIENT_RE.fullmatch(google_calendar_client_id)):
                raise ValueError('GOOGLE_PUBLIC_OAUTH_CLIENT_ID_INVALID')
            oauth_scripts = (
                '<script>window.MYINVEST_GOOGLE_CALENDAR_CLIENT_ID=' +
                json.dumps(google_calendar_client_id) + ';</script>\n' +
                '<script src="https://accounts.google.com/gsi/client"></script>\n'
            )
        calendar_scripts = ''.join(
            '<script src="js/' + name + '?calendar=v2"></script>\n'
            for name in CALENDAR_MODULES
        )
        text = text.replace(news_anchor,news_anchor+'\n'+oauth_scripts+calendar_scripts)
    auth_anchor = '<script src="js/auth.js?v=14-transport"></script>'
    if text.count(auth_anchor) != 1:
        raise ValueError('DEV_AUTH_ANCHOR_CHANGED')
    text = text.replace(auth_anchor, auth_anchor + '\n<script src="js/dev_session.js?v=1"></script>')
    text = re.sub(r'(src="js/[^"?]+\?[^" ]+)(")', lambda m: m[1] + '&dev=' + revision[:12] + m[2], text)
    (output / 'index.html').write_text(text)
    assets = {'js': set(re.findall(r'src="js/([A-Za-z0-9_-]+\.js)', text)),
              'css': set(re.findall(r'href="css/([A-Za-z0-9_-]+\.css)', text))}
    for folder, names in assets.items():
        target = output / folder
        target.mkdir()
        for name in sorted(names):
            source = root / folder / name
            if source.is_symlink():
                raise ValueError('DEV_ASSET_SYMLINK')
            if source.name == 'auth.js':
                closed = re.sub(r'const (DEFAULT_GAS_URL|LEGACY_GAS_URL)="[^"]*";', r'const \1="";', source.read_text())
                session_marker = 'const SESSION_MS=300000;   // 5분. 절대 시각 기준이라 화면 꺼짐·백그라운드에서도 정확히 만료'
                if closed.count(session_marker) != 1:
                    raise ValueError('DEV_SESSION_DURATION_MARKER_CHANGED')
                if relay_endpoint:
                    closed = closed.replace(session_marker, 'const SESSION_MS=3600000; // Development-only: one hour of user inactivity; background checks do not reset it.')
                (target / source.name).write_text(closed)
            else:
                shutil.copyfile(source, target / source.name)
    (output / 'data').mkdir()
    shutil.copyfile(root / 'data/krx-instruments.json', output / 'data/krx-instruments.json')
    shutil.copyfile(root / 'data/us-theme-instruments.json', output / 'data/us-theme-instruments.json')
    shutil.copyfile(root / 'data/us-instruments.json', output / 'data/us-instruments.json')
    shutil.copyfile(root / 'data/account-test-holdings.json', output / 'data/account-test-holdings.json')
    ocr = root / 'vendor/ocr'
    pinned = json.loads((ocr / 'manifest.json').read_text())
    for name, digest in pinned['sha256'].items():
        source = ocr / name
        if source.is_symlink() or source.parent != ocr or hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError('DEV_OCR_ASSET_INVALID')
        target = output / 'vendor/ocr' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    shutil.copyfile(ocr / 'manifest.json', output / 'vendor/ocr/manifest.json')
    (output / '.nojekyll').write_text('')
    (output / 'robots.txt').write_text('User-agent: *\nDisallow: /\n')
    dev_metadata = {'myinvestDevelopmentOnly': True, 'authOnly': False, 'publicMarketCapable': True, 'nhAccountQueries': False, 'storageWrites': False, 'screenInspection': True, 'sourceBranch': 'feat/nh-integration-v2', 'sourceCommit': revision}
    if include_calendar:
        dev_metadata.update({
            'calendarReview': 'LOCAL_MANUAL_AND_OPTIONAL_GOOGLE_READ_ONLY',
            'googleOAuthClientConfigured': bool(google_calendar_client_id),
            'googleScope': 'calendar.events.readonly',
            'googleScopes': ['calendar.events.readonly','calendar.calendarlist.readonly'],
            'googleEventWrites': False,
            'browserLocalCalendarWrites': True,
            'calendarGASWrites': False,
            'calendarNHCalls': False,
            'published': False
        })
    (output / 'development-only.json').write_text(json.dumps(dev_metadata))
    manifest = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'asset-manifest.json').write_text(json.dumps(manifest, sort_keys=True))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--relay-endpoint',help='Verified fixed development Worker URL; never a GAS URL or credential')
    parser.add_argument('--include-calendar',action='store_true',help='Review optional local and market calendar (no publish)')
    parser.add_argument('--google-calendar-client-id',help='Public OAuth Web client ID, NOT Google secrets/tokens')
    args = parser.parse_args()
    build(args.output,relay_endpoint=args.relay_endpoint,include_calendar=args.include_calendar,
          google_calendar_client_id=args.google_calendar_client_id)
    print(json.dumps({'status': 'PASS', 'artifact': 'DEV_FRONTEND_ONLY', 'secretsIncluded': False}))
