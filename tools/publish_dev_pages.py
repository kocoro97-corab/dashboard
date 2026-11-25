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


def verified_source_commit(expected_source_sha=None):
    """Fail closed when the owner's checkout differs from the intended V2 branch/commit."""
    branch = git(['branch', '--show-current'], ROOT)
    if branch != SOURCE_BRANCH:raise Stop('DEV_SOURCE_BRANCH_MISMATCH')
    commit = git(['rev-parse', 'HEAD'], ROOT)
    if expected_source_sha and commit != expected_source_sha:
        raise Stop('DEV_SOURCE_SHA_MISMATCH')
    return commit


def checked_dev_head(observed, expected=None):
    """Verify that the existing development Pages checkout has not moved."""
    if expected and observed != expected:raise Stop('DEV_PAGES_HEAD_CHANGED')


def publish(expected_source_sha=None, expected_dev_head=None):
    # Never publish without both an exact approved source and a dev-pages lease.
    if not expected_source_sha or not expected_dev_head:raise Stop('DEV_APPROVED_SHA_REQUIRED')
    if not shutil.which('gh'):raise Stop('OWNER_GITHUB_CLI_REQUIRED')
    if git(['status', '--porcelain', '--untracked-files=no'], ROOT):raise Stop('DEV_TRACKED_SOURCE_DIRTY')
    verified_source_commit(expected_source_sha)
    if api('user').get('login') != 'kocoro97-corab':raise Stop('OWNER_GITHUB_ACCOUNT_MISMATCH')
    target = 'repos/' + REPO
    repo = api(target, optional=True)
    if repo is None:raise Stop('DEV_REPOSITORY_MISSING')
    if repo.get('full_name') != REPO or repo.get('private') is not False:
        raise Stop('DEV_REPOSITORY_IDENTITY_MISMATCH')
    previous = api(target + '/contents/development-only.json?ref=' + BRANCH, optional=True)
    if previous is not None:
        marker = json.loads(base64.b64decode(previous['content']))
        if marker.get('myinvestDevelopmentOnly') is not True or marker.get('sourceBranch') != 'feat/nh-integration-v2':
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
        manifest = build(artifact)
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
        # Old files must be removed *before* adding the new manifest. This was
        # previously unreachable inside an elif that always raised.
        old = json.loads((checkout / 'asset-manifest.json').read_text())
        if not isinstance(old,dict):raise Stop('DEV_MANIFEST_INVALID')
        for name in old:
            if not isinstance(name,str):raise Stop('DEV_MANIFEST_PATH_INVALID')
            path = Path(name)
            if not name or path.is_absolute() or '..' in path.parts:
                raise Stop('DEV_MANIFEST_PATH_INVALID')
            if name not in manifest and (checkout / name).is_file():
                git(['rm', '--', name], checkout)
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
    args=parser.parse_args()
    try:
        for value in (args.expect_source_sha, args.expect_dev_head):
            if value is not None and (len(value)!=40 or any(ch not in '0123456789abcdef' for ch in value)):
                raise Stop('DEV_EXPECTED_SHA_INVALID')
        report = publish(args.expect_source_sha,args.expect_dev_head)
    except Stop as error:
        report = {'status': 'NOT_RUN', 'code': str(error), 'productionChanged': False}
    except Exception:
        report = {'status': 'NOT_RUN', 'code': 'DEV_PAGES_SETUP_STOP', 'productionChanged': False}
    print(json.dumps(report))
    raise SystemExit(0 if report['status'] == 'PASS' else 2)
