import base64
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tools')]
import publish_dev_pages as publish
from install_dev_tunnel import install
from nh_v2_https import tunnel


class HttpsToolTests(unittest.TestCase):
    def blocked_publish(self, user, repo, marker=None, pages=None):
        calls = []
        def api(path, method='GET', data=None, optional=False):
            calls.append((path, method))
            if path == 'user':return {'login': user}
            if path == 'repos/' + publish.REPO:return repo
            if '/contents/' in path:
                return {'content': base64.b64encode(json.dumps(marker).encode()).decode()} if marker else None
            if path.endswith('/pages'):return pages
            self.fail('UNEXPECTED_PUBLICATION_WRITE')
        with patch.object(publish, 'api', api), patch.object(publish, 'git', return_value=''):
            with self.assertRaises(publish.Stop):publish.publish()
        self.assertTrue(all(method == 'GET' for path, method in calls))
        self.assertFalse(any(path.startswith('repos/kocoro97-corab/dashboard/') for path, method in calls))

    def test_wrong_github_account_cannot_create_or_publish_any_resource(self):
        self.blocked_publish('other-owner', {})

    def test_private_or_wrong_repository_identity_is_not_reused(self):
        self.blocked_publish('kocoro97-corab', {'full_name': publish.REPO, 'private': True})

    def test_existing_repository_without_our_marker_is_not_overwritten(self):
        self.blocked_publish('kocoro97-corab', {'full_name': publish.REPO, 'private': False, 'size': 10, 'description': 'Unrelated repository'})

    def test_pages_settings_outside_development_branch_are_not_modified(self):
        self.blocked_publish('kocoro97-corab', {'full_name': publish.REPO, 'private': False},
                             {'myinvestDevelopmentOnly': True, 'sourceBranch': 'feat/nh-integration-v2'},
                             {'build_type': 'legacy', 'source': {'branch': 'main', 'path': '/'}})

    def test_existing_unverified_binary_is_never_overwritten_or_executed(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'cloudflared'
            file.write_bytes(b'SYNTHETIC_UNVERIFIED_BINARY')
            with patch('install_dev_tunnel.urllib.request.urlopen') as network:
                with self.assertRaises(ValueError):install(file)
                network.assert_not_called()
            self.assertEqual(file.read_bytes(), b'SYNTHETIC_UNVERIFIED_BINARY')

    def test_tunnel_output_is_private_and_process_is_stopped_on_exit(self):
        class Process:
            def __init__(self):
                self.stdout = io.BytesIO(b'SYNTHETIC_PRIVATE_LOG\nINF | https://synthetic-only.trycloudflare.com |\nINF Registered tunnel connection\n')
                self.stopped = False
            def poll(self):return 0 if self.stopped else None
            def terminate(self):self.stopped = True
            def wait(self, timeout):return 0
        process = Process()
        output = io.StringIO()
        with patch('nh_v2_https.subprocess.Popen', return_value=process) as start, redirect_stdout(output):
            with tunnel(12345, Path('/synthetic/cloudflared'), 60) as (host, _):
                self.assertEqual(host, 'synthetic-only.trycloudflare.com')
            args = start.call_args.args[0]
            self.assertNotIn('--no-tls-verify', args)
            self.assertEqual(args[args.index('--loglevel') + 1], 'info')
        self.assertTrue(process.stopped)
        self.assertEqual(output.getvalue(), '')
