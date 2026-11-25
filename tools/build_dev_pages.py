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
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]
PAGE = 'https://kocoro97-corab.github.io/dashboard-v2-dev/'


def fixed_relay(value):
    from urllib.parse import urlsplit
    if not isinstance(value,str):raise ValueError('PERSISTENT_RELAY_ENDPOINT_INVALID')
    u=urlsplit(value)
    if not re.fullmatch(r'https://[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}\.workers\.dev/api',value) or u.port or u.username or u.password or u.query or u.fragment:
        raise ValueError('PERSISTENT_RELAY_ENDPOINT_INVALID')
    return value


def build(output, root=ROOT, relay_endpoint=None, *, use_public_config=True, public_data=None,
          source_branch='feat/nh-integration-v2'):
    # Only the original V2 branch and this specific isolated performance review
    # may identify the source of a development Pages artifact.
    if source_branch not in ('feat/nh-integration-v2','fix/visible-first-market-20261125','fix/visible-first-data-20261125','fix/relay-timing-diagnostics-20261125'):
        raise ValueError('DEV_SOURCE_BRANCH_NOT_APPROVED')
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
    if relay_endpoint == 'https://myinvest-v2-dev-relay.kocoro97.workers.dev/api':
        # Exact development consent routes only; no wildcard form destinations.
        text=text.replace("form-action 'none'", "form-action https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/start https://accounts.google.com/o/oauth2/v2/auth")
    debug_anchor = '<script defer src="js/debug.js?v=3-safe"></script>'
    if text.count(debug_anchor) != 1:raise ValueError('DEV_DIAGNOSTIC_ANCHOR_CHANGED')
    text = text.replace(debug_anchor, '<script>window.MYINVEST_DEV_DIAGNOSTICS=true;</script>\n<script defer src="js/development-diagnostics.js?v=1"></script>\n'+debug_anchor)
    marker = '<script defer src="js/transport.js?v=1"></script>'
    if text.count(marker) != 1:
        raise ValueError('DEV_TRANSPORT_MARKER_CHANGED')
    if relay_endpoint:
        text=text.replace(marker, '<script>window.MYINVEST_PERSISTENT_RELAY=Object.freeze('+json.dumps({'profile':'isolated','endpoint':relay_endpoint},separators=(',',':'))+');</script>\n'+marker)
    text = text.replace(marker, '<script>window.MYINVEST_TRANSPORT_CONFIG={mode:"relay",endpoint:"",devSession:true};</script>\n<script defer src="js/dev_market.js?v=1"></script>\n<script defer src="js/dev_inspection.js?v=1"></script>\n<script defer src="js/dev_connect.js?v=1"></script>\n' + marker)
    # Development OCR remains available from pinned local assets, but is requested
    # by dev_ocr.js only after explicit user-granted development access.
    text = text.replace(marker, '<script defer src="js/dev_ocr.js?v=2-lazy"></script>\n'+marker)
    # Only the isolated development artifact receives the optional manual strategy
    # comparator. Production index.html, NEWS/PR#8 and live endpoints stay untouched.
    strategy_anchor = '<script defer src="js/page-strategy.js?v=1"></script>'
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
    compare_scripts = ''.join('<script defer src="js/' + name + '?v=1"></script>\n'
                              for name in strategy_optional_modules)
    text = text.replace(strategy_anchor, compare_scripts + strategy_anchor)
    shell_anchor='<script defer src="js/app-shell.js?v=2"></script>'
    if text.count(shell_anchor)!=1:raise ValueError('DEV_SHELL_ANCHOR_CHANGED')
    text=text.replace(shell_anchor, '<script defer src="js/page-diagnostics.js?v=1"></script>\n<script defer src="js/view-idle-preload.js?v=1"></script>\n'+shell_anchor)
    auth_anchor = '<script defer src="js/auth.js?v=14-transport"></script>'
    if text.count(auth_anchor) != 1:
        raise ValueError('DEV_AUTH_ANCHOR_CHANGED')
    text = text.replace(auth_anchor, auth_anchor + '\n<script defer src="js/dev_session.js?v=1"></script>')
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
    # Explicit calendar files only; server/OAuth/private files are never exported.
    calendar_validation=[]
    prior_status=[]
    if public_data is not None:
        public_data=Path(public_data)
        status=public_data.parent/'calendar-data-status.json'
        if status.is_symlink():raise ValueError('DEV_CALENDAR_ASSET_SYMLINK')
        if status.is_file() and status.stat().st_size<=16384:
            try:
                parsed=json.loads(status.read_text())
                if isinstance(parsed,list) and len(parsed)<=5:prior_status=parsed
            except (ValueError,OSError):pass
    def checked_calendar(file):
        if file.is_symlink():raise ValueError('DEV_CALENDAR_ASSET_SYMLINK')
        if not file.is_file():return None
        raw=file.read_bytes()
        if len(raw)>1500000:return None
        program="const fs=require('fs');const {validate}=require(process.argv[1]);console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(0,'utf8')))))"
        check=subprocess.run(['node','-e',program,str(root/'scripts/validate-calendar-snapshots.cjs')],input=raw,cwd=root,capture_output=True)
        if check.returncode:return None
        return raw,json.loads(check.stdout)
    def calendar_time(value):return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    for name in ['economic-events.json','bea-events.json','bok-stats-events.json','earnings-events.json','policy-events.json']:
        selected=checked_calendar(root/'data'/name)
        if public_data is not None:
            candidate=checked_calendar(public_data/name)
            if candidate and (not selected or calendar_time(candidate[1]['retrievedAt'])>=calendar_time(selected[1]['retrievedAt'])):selected=candidate
        if not selected:
            # Explicit unavailable resource, never an empty successful schedule.
            expected={'economic-events.json':'BLS','bea-events.json':'BEA','bok-stats-events.json':'BOK','earnings-events.json':'VERIFIED_EARNINGS','policy-events.json':'OFFICIAL_POLICY'}[name]
            (output/'data'/name).write_text(json.dumps({'schemaVersion':1,'source':expected,'status':'unavailable','reason':'NO_FRESH_VERIFIED_SNAPSHOT','retrievedAt':None,'events':[]}))
            calendar_validation.append({'file':name,'status':'UNAVAILABLE'});continue
        raw,metadata=selected
        (output/'data'/name).write_bytes(raw)
        row={'file':name,'status':'VERIFIED',**metadata}
        if any(isinstance(old,dict) and old.get('file')==name and old.get('status')=='FAILED' and old.get('retrievedAt')==metadata['retrievedAt'] for old in prior_status):row['status']='FAILED'
        calendar_validation.append(row)
    (output/'calendar-data-status.json').write_text(json.dumps(calendar_validation))
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
    (output / 'development-only.json').write_text(json.dumps({'myinvestDevelopmentOnly': True, 'authOnly': False, 'publicMarketCapable': True, 'nhAccountQueries': False, 'storageWrites': False, 'screenInspection': True, 'sourceBranch': source_branch, 'sourceCommit': revision}))
    manifest = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'asset-manifest.json').write_text(json.dumps(manifest, sort_keys=True))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--relay-endpoint',help='Verified fixed development Worker URL; never a GAS URL or credential')
    parser.add_argument('--preserve-public-data',type=Path,help='Existing development Pages data directory; carry forward only fresher validated public schedules')
    args = parser.parse_args()
    build(args.output,relay_endpoint=args.relay_endpoint,public_data=args.preserve_public_data)
    print(json.dumps({'status': 'PASS', 'artifact': 'DEV_FRONTEND_ONLY', 'secretsIncluded': False}))
