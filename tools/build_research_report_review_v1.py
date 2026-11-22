"""Create a strictly local, synthetic-only dashboard integration review artifact.

The existing developer build is produced unchanged first, then an isolated
review hook and its verified research dependencies are copied INTO THE
TEMPORARY ARTIFACT ONLY. Source index.html, app router, Codex news/strategy,
NH/GAS/Sheets/Properties and deployed Pages remain untouched.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil

from build_dev_pages import build as build_original

ROOT = Path(__file__).resolve().parents[1]

SCRIPTS = (
    'market-sector-stock-alignment-v1.js',
    'investment-evidence-explanation-v1.js',
    'investment-evidence-timeline-v1.js',
    'investment-research-report-v1.js',
    'investment-research-report-panel-v1.js',
    'research-report-harness-fixture-v1.js',
    'research-report-strategy-review-hook-v1.js',
)

def build_review(output, *, relay_endpoint=None, root=ROOT):
    output = Path(output)
    build_original(output, root=root, relay_endpoint=relay_endpoint,
                   use_public_config=False)
    html = (output / 'index.html').read_text()
    if html.count('</body>') != 1:
        raise ValueError('REVIEW_HTML_BODY_MARKER_CHANGED')
    if html.count('src="js/app-shell.js?v=2') != 1:
        raise ValueError('REVIEW_APP_SHELL_MARKER_CHANGED')
    if "MYINVEST_RESEARCH_REVIEW" in html or "research-report" in html:
        raise ValueError('REVIEW_ALREADY_INJECTED')
    if "Content-Security-Policy" not in html or "script-src 'self'" not in html:
        raise ValueError('REVIEW_CSP_CHANGED')

    # Fixed local filenames only: no arbitrary paths, remote scripts or user input.
    for name in SCRIPTS:
        if not re.fullmatch(r'[a-z][a-z0-9-]{0,80}\.js',name):
            raise ValueError('REVIEW_MODULE_NAME_INVALID')
        source=root/'js'/name
        if not source.is_file() or source.is_symlink():
            raise ValueError('REVIEW_MODULE_UNAVAILABLE')
        target=output/'js'/name
        if target.exists():
            raise ValueError('REVIEW_MODULE_COLLISION')
        shutil.copyfile(source,target)
    inject=(
        '<script>window.MYINVEST_RESEARCH_REVIEW="synthetic-only";</script>\n'
        + ''.join('<script src="js/'+name+'?review=synthetic-only"></script>\n'
                  for name in SCRIPTS)
    )
    html=html.replace('</body>',inject+'</body>')
    (output/'index.html').write_text(html)

    meta_path=output/'development-only.json'
    meta=json.loads(meta_path.read_text())
    meta['researchHarness']='SYNTHETIC_ONLY'
    meta['researchHarnessProductionAllowed']=False
    meta['syntheticReportAccountDataUsed']=False
    meta['syntheticReportLiveMarketQueries']=False
    meta['syntheticReportOrderCalls']=False
    meta['sourceBranch']='feat/research-report-strategy-harness-isolated'
    meta_path.write_text(json.dumps(meta,sort_keys=True))

    manifest={
        p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(output.rglob('*')) if p.is_file()
        and p.name != 'asset-manifest.json'
    }
    (output/'asset-manifest.json').write_text(json.dumps(manifest,sort_keys=True))
    return manifest
