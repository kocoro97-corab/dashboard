"""Publish public frontend assets to the fixed, separate, free development repo.
Uses the owner's existing GitHub login. Never changes dashboard Pages settings.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from build_dev_pages import build, ROOT, PAGE

REPO = 'kocoro97-corab/dashboard-v2-dev'
BRANCH = 'dev-pages'
DESCRIPTION = 'Isolated MY INVEST V2 development login and HTTPS validation. No credentials or financial data.'
SOURCE_BRANCH = 'feat/nh-integration-v2'
PREVIEW_BRANCH = 'fix/visible-first-market-20261125'
PREVIEW_PR = 10
NEXT_PREVIEW_BRANCH = 'fix/visible-first-data-20261125'
NEXT_PREVIEW_PR = 11
TIMING_PREVIEW_BRANCH = 'fix/relay-timing-diagnostics-20261125'
TIMING_PREVIEW_PR = 12
RETRY_PREVIEW_BRANCH = 'fix/relay-retry-isolation-preview-20261126'
RETRY_PREVIEW_PR = 13
UI_PREVIEW_BRANCH = 'feat/mobile-sector-news-calendar-ui-20261126'
UI_PREVIEW_PR = 14
QUERY_PREVIEW_BRANCH = 'fix/verified-query-performance-20261126'
APPROVED_SOURCE_BRANCHES = (SOURCE_BRANCH,PREVIEW_BRANCH,NEXT_PREVIEW_BRANCH,TIMING_PREVIEW_BRANCH,RETRY_PREVIEW_BRANCH,UI_PREVIEW_BRANCH,QUERY_PREVIEW_BRANCH)


class Stop(Exception):pass


def api(path, method='GET', data=None, optional=False):
    args = ['gh', 'api', '--method', method, path]
    if data is not None:args += ['--input', '-']
    result = subprocess.run(args, input=json.dumps(data) if data is not None else None,
                            text=True, capture_output=True, timeout=30)
    if result.returncode:
        if optional and '(HTTP 404)' in result.stderr:return None
        raise Stop('OWNER_GITHUB_REPO_PERMISSION_REQUIRED')
    return json.loads(result.stdout) if result.stdout.strip() else {}


def git(args, cwd):
    env = dict(os.environ, GIT_TERMINAL_PROMPT='0')
    result = subprocess.run(['git', *args], cwd=cwd, env=env, text=True, capture_output=True, timeout=60)
    if result.returncode:raise Stop('DEV_GIT_OPERATION_STOP')
    return result.stdout.strip()


def verified_source_commit(expected_source_sha=None, source_branch=SOURCE_BRANCH):
    """Fail closed when the owner's checkout differs from the intended V2 branch/commit."""
    branch = git(['branch', '--show-current'], ROOT)
    if source_branch not in APPROVED_SOURCE_BRANCHES or branch != source_branch:raise Stop('DEV_SOURCE_BRANCH_MISMATCH')
    commit = git(['rev-parse', 'HEAD'], ROOT)
    if expected_source_sha and commit != expected_source_sha:
        raise Stop('DEV_SOURCE_SHA_MISMATCH')
    return commit


def checked_dev_head(observed, expected=None):
    """Verify that the existing development Pages checkout has not moved."""
    if expected and observed != expected:raise Stop('DEV_PAGES_HEAD_CHANGED')


def remove_obsolete_assets(checkout, old, new):
    """Stage removal of assets present in the old manifest but absent from a new build."""
    if not isinstance(old, dict):raise Stop('DEV_MANIFEST_INVALID')
    for name in old:
        if not isinstance(name, str) or not name or any(ch not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_./-' for ch in name):
            raise Stop('DEV_MANIFEST_PATH_INVALID')
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or '.git' in path.parts:
            raise Stop('DEV_MANIFEST_PATH_INVALID')
        if name not in new and (checkout / name).is_file():
            git(['rm', '--', name], checkout)


def require_green_ci(source_sha):
    """Only publish a commit whose normal secret-free push and PR regressions passed."""
    response = api('repos/kocoro97-corab/dashboard/actions/runs?head_sha=' + source_sha + '&per_page=100')
    runs = response.get('workflow_runs', [])
    if not isinstance(runs, list):raise Stop('DEV_CI_NOT_GREEN')
    approved = {r.get('event') for r in runs if isinstance(r,dict)
                and r.get('head_sha') == source_sha
                and r.get('name') == 'PR regression tests'
                and r.get('status') == 'completed'
                and r.get('conclusion') == 'success'}
    if not {'push','pull_request'}.issubset(approved):
        raise Stop('DEV_CI_NOT_GREEN')


def require_reviewed_preview(source_sha, source_branch):
    """Never allow a generic feature branch to publish by relaxing this gate."""
    if source_branch == SOURCE_BRANCH:return
    reviewed = {
        PREVIEW_BRANCH:(PREVIEW_PR,SOURCE_BRANCH),
        NEXT_PREVIEW_BRANCH:(NEXT_PREVIEW_PR,PREVIEW_BRANCH),
        TIMING_PREVIEW_BRANCH:(TIMING_PREVIEW_PR,NEXT_PREVIEW_BRANCH),
        RETRY_PREVIEW_BRANCH:(RETRY_PREVIEW_PR,TIMING_PREVIEW_BRANCH),
        UI_PREVIEW_BRANCH:(UI_PREVIEW_PR,RETRY_PREVIEW_BRANCH),
    }
    if source_branch == QUERY_PREVIEW_BRANCH:
        from urllib.parse import urlencode
        expected_base = UI_PREVIEW_BRANCH
        candidates = api('repos/kocoro97-corab/dashboard/pulls?' + urlencode({
            'state':'open', 'head':'kocoro97-corab:' + QUERY_PREVIEW_BRANCH,
            'base':expected_base}))
        if not isinstance(candidates,list) or len(candidates)!=1:
            raise Stop('DEV_PREVIEW_PR_MISMATCH')
        pr = candidates[0]
    else:
        if source_branch not in reviewed:raise Stop('DEV_SOURCE_BRANCH_NOT_APPROVED')
        pr_id,expected_base = reviewed[source_branch]
        pr = api('repos/kocoro97-corab/dashboard/pulls/' + str(pr_id))
    if not isinstance(pr,dict) or pr.get('state') != 'open' or pr.get('draft') is not True or pr.get('merged_at') is not None:
        raise Stop('DEV_PREVIEW_PR_MISMATCH')
    head=pr.get('head') or {}
    base=pr.get('base') or {}
    repository=head.get('repo') or {}
    if head.get('ref') != source_branch or head.get('sha') != source_sha or        repository.get('full_name') != 'kocoro97-corab/dashboard' or base.get('ref') != expected_base:
        raise Stop('DEV_PREVIEW_PR_MISMATCH')


def build_with_preserved_calendar(artifact, checkout, source_branch=SOURCE_BRANCH):
    """Retain newer validated public calendar snapshots already on dev-pages.

    The exporter independently validates each snapshot, compares retrievedAt,
    and preserves verified previous collection-failure status. Never copies
    private files or accepts raw unchecked provider responses.
    """
    if source_branch == SOURCE_BRANCH:
        return build(artifact, public_data=checkout / 'data')
    if source_branch in (PREVIEW_BRANCH,NEXT_PREVIEW_BRANCH,TIMING_PREVIEW_BRANCH,RETRY_PREVIEW_BRANCH,UI_PREVIEW_BRANCH,QUERY_PREVIEW_BRANCH):
        return build(artifact, public_data=checkout / 'data', source_branch=source_branch)
    raise Stop('DEV_SOURCE_BRANCH_NOT_APPROVED')


def publish(expected_source_sha=None, expected_dev_head=None, source_branch=SOURCE_BRANCH):
    # Never publish without both an exact approved source and a dev-pages lease.
    if not expected_source_sha or not expected_dev_head:raise Stop('DEV_APPROVED_SHA_REQUIRED')
    if not shutil.which('gh'):raise Stop('OWNER_GITHUB_CLI_REQUIRED')
    if git(['status', '--porcelain', '--untracked-files=no'], ROOT):raise Stop('DEV_TRACKED_SOURCE_DIRTY')
    source_sha=verified_source_commit(expected_source_sha, source_branch)
    require_reviewed_preview(source_sha, source_branch)
    require_green_ci(source_sha)
    if api('user').get('login') != 'kocoro97-corab':raise Stop('OWNER_GITHUB_ACCOUNT_MISMATCH')
    target = 'repos/' + REPO
    repo = api(target, optional=True)
    if repo is None:raise Stop('DEV_REPOSITORY_MISSING')
    if repo.get('full_name') != REPO or repo.get('private') is not False:
        raise Stop('DEV_REPOSITORY_IDENTITY_MISMATCH')
    previous = api(target + '/contents/development-only.json?ref=' + BRANCH, optional=True)
    if previous is not None:
        marker = json.loads(base64.b64decode(previous['content']))
        if marker.get('myinvestDevelopmentOnly') is not True or marker.get('sourceBranch') not in APPROVED_SOURCE_BRANCHES:
            raise Stop('DEV_REPOSITORY_MARKER_MISMATCH')
    elif not (repo.get('size', 0) == 0 and repo.get('description') == DESCRIPTION):
        raise Stop('DEV_REPOSITORY_NOT_EMPTY_OR_OURS')
    existing_pages = api(target + '/pages', optional=True)
    if existing_pages and (existing_pages.get('build_type') != 'legacy' or
                           existing_pages.get('source') != {'branch': BRANCH, 'path': '/'} or existing_pages.get('cname')):
        raise Stop('DEV_PAGES_SETTINGS_CONFLICT')
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        artifact = folder / 'artifact'
        checkout = folder / 'checkout'
        checkout.mkdir()
        git(['init', '--initial-branch=' + BRANCH], checkout)
        git(['config', 'user.name', 'MY INVEST development'], checkout)
        git(['config', 'user.email', 'development@users.noreply.github.com'], checkout)
        git(['remote', 'add', 'origin', 'https://github.com/' + REPO + '.git'], checkout)
        if previous is None:raise Stop('DEV_PAGES_HEAD_CHANGED')
        git(['fetch', '--depth=1', 'origin', BRANCH], checkout)
        checked_dev_head(git(['rev-parse', 'FETCH_HEAD'], checkout), expected_dev_head)
        git(['checkout', '-B', BRANCH, 'FETCH_HEAD'], checkout)
        manifest = build_with_preserved_calendar(artifact, checkout, source_branch)
        # Old files must be removed *before* adding the new manifest. This was
        # previously unreachable inside an elif that always raised.
        old = json.loads((checkout / 'asset-manifest.json').read_text())
        remove_obsolete_assets(checkout,old,manifest)
        for source in artifact.rglob('*'):
            if source.is_file():
                dest = checkout / source.relative_to(artifact)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, dest)
        git(['add', '--', *manifest, 'asset-manifest.json'], checkout)
        staged = subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=checkout)
        if staged.returncode == 1:
            git(['commit', '-m', 'Publish isolated V2 development frontend'], checkout)
            git(['-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', 'HEAD:' + BRANCH], checkout)
        elif staged.returncode != 0:raise Stop('DEV_GIT_OPERATION_STOP')
        deployed = git(['rev-parse', 'HEAD'], checkout)
    # Fixed target repository only: no API call names the operating repository.
    if existing_pages is None:
        api(target + '/pages', 'POST', {'source': {'branch': BRANCH, 'path': '/'}})
    pages = api(target + '/pages')
    if pages.get('https_enforced') is not True:
        api(target + '/pages', 'PUT', {'https_enforced': True})
    for _ in range(12):
        latest = api(target + '/pages/builds/latest', optional=True)
        if latest and latest.get('commit') == deployed:
            if latest.get('status') == 'built':
                return {'status': 'PASS', 'page': PAGE, 'developmentCommit': deployed, 'productionChanged': False}
            if latest.get('status') == 'errored':raise Stop('DEV_PAGES_BUILD_FAILED')
        time.sleep(5)
    return {'status': 'NOT_RUN', 'code': 'DEV_PAGES_BUILD_PENDING', 'page': PAGE, 'productionChanged': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish-dev-pages', action='store_true', required=True)
    parser.add_argument('--expect-source-sha', metavar='SHA40',required=True)
    parser.add_argument('--expect-dev-head', metavar='SHA40',required=True)
    parser.add_argument('--source-branch', choices=APPROVED_SOURCE_BRANCHES,default=SOURCE_BRANCH)
    args=parser.parse_args()
    try:
        for value in (args.expect_source_sha, args.expect_dev_head):
            if value is not None and (len(value)!=40 or any(ch not in '0123456789abcdef' for ch in value)):
                raise Stop('DEV_EXPECTED_SHA_INVALID')
        report = publish(args.expect_source_sha,args.expect_dev_head,args.source_branch)
    except Stop as error:
        report = {'status': 'NOT_RUN', 'code': str(error), 'productionChanged': False}
    except Exception:
        report = {'status': 'NOT_RUN', 'code': 'DEV_PAGES_SETUP_STOP', 'productionChanged': False}
    print(json.dumps(report))
    raise SystemExit(0 if report['status'] == 'PASS' else 2)
