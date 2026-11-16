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


def fixed_relay(value):
    from urllib.parse import urlsplit
    if not isinstance(value,str):raise ValueError('PERSISTENT_RELAY_ENDPOINT_INVALID')
    u=urlsplit(value)
    if not re.fullmatch(r'https://[a-z0-9][a-z0-9-]{0,62}\.[a-z0-9][a-z0-9-]{0,62}\.workers\.dev/api',value) or u.port or u.username or u.password or u.query or u.fragment:
        raise ValueError('PERSISTENT_RELAY_ENDPOINT_INVALID')
    return value


def build(output, root=ROOT, relay_endpoint=None, *, use_public_config=True):
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
        'frame-src \'none\'; worker-src \'self\'; form-action \'none\'; base-uri \'none\'">')
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
                (target / source.name).write_text(closed)
            else:
                shutil.copyfile(source, target / source.name)
    (output / 'data').mkdir()
    shutil.copyfile(root / 'data/krx-instruments.json', output / 'data/krx-instruments.json')
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
    (output / 'development-only.json').write_text(json.dumps({'myinvestDevelopmentOnly': True, 'authOnly': False, 'publicMarketCapable': True, 'nhAccountQueries': False, 'storageWrites': False, 'screenInspection': True, 'sourceBranch': 'feat/nh-integration-v2', 'sourceCommit': revision}))
    manifest = {p.relative_to(output).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(output.rglob('*')) if p.is_file()}
    (output / 'asset-manifest.json').write_text(json.dumps(manifest, sort_keys=True))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--relay-endpoint',help='Verified fixed development Worker URL; never a GAS URL or credential')
    args = parser.parse_args()
    build(args.output,relay_endpoint=args.relay_endpoint)
    print(json.dumps({'status': 'PASS', 'artifact': 'DEV_FRONTEND_ONLY', 'secretsIncluded': False}))
