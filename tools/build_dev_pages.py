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


def build(output, root=ROOT):
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError('DEV_OUTPUT_NOT_EMPTY')
    output.mkdir(parents=True, exist_ok=True)
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    text = (root / 'index.html').read_text()
    text = '\n'.join(line for line in text.splitlines() if 'https://cdn.jsdelivr.net/npm/tesseract' not in line)
    text = text.replace('<head>', '<head>\n<meta name="referrer" content="strict-origin-when-cross-origin">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; '
        'script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; '
        'img-src \'self\' data:; connect-src \'self\' https://*.trycloudflare.com; '
        'frame-src \'none\'; worker-src \'none\'; form-action \'none\'; base-uri \'none\'">')
    marker = '<script src="js/transport.js?v=1"></script>'
    if text.count(marker) != 1:
        raise ValueError('DEV_TRANSPORT_MARKER_CHANGED')
    text = text.replace(marker, '<script>window.MYINVEST_TRANSPORT_CONFIG={mode:"relay",endpoint:"",devSession:true};</script>\n<script src="js/dev_market.js?v=1"></script>\n<script src="js/dev_inspection.js?v=1"></script>\n<script src="js/dev_connect.js?v=1"></script>\n' + marker)
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
    args = parser.parse_args()
    build(args.output)
    print(json.dumps({'status': 'PASS', 'artifact': 'DEV_FRONTEND_ONLY', 'secretsIncluded': False}))
