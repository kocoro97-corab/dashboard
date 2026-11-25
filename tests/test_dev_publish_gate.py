"""Development Pages source/head guards. Never make network requests."""
import sys
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import publish_dev_pages as pub

SOURCE='a'*40
DEV_HEAD='b'*40


class DevelopmentPublishGateTests(unittest.TestCase):
    def test_approved_source_branch_and_expected_commit(self):
        def local_git(args,root):
            if args==['branch','--show-current']:return pub.SOURCE_BRANCH
            if args==['rev-parse','HEAD']:return SOURCE
            self.fail(f'unexpected synthetic git command: {args}')
        with patch.object(pub,'git',side_effect=local_git):
            self.assertEqual(pub.verified_source_commit(SOURCE),SOURCE)

    def test_never_publish_from_main_or_detached_head(self):
        for branch in ('main','release/pages',''):
            with self.subTest(branch=branch):
                with patch.object(pub,'git',return_value=branch):
                    with self.assertRaisesRegex(pub.Stop,'DEV_SOURCE_BRANCH_MISMATCH'):
                        pub.verified_source_commit(SOURCE)

    def test_changed_source_revision_is_rejected(self):
        with patch.object(pub,'git',side_effect=[pub.SOURCE_BRANCH,'c'*40]):
            with self.assertRaisesRegex(pub.Stop,'DEV_SOURCE_SHA_MISMATCH'):
                pub.verified_source_commit(SOURCE)

    def test_published_development_head_can_be_pinned(self):
        pub.checked_dev_head(DEV_HEAD,DEV_HEAD)
        with self.assertRaisesRegex(pub.Stop,'DEV_PAGES_HEAD_CHANGED'):
            pub.checked_dev_head('c'*40,DEV_HEAD)

    def test_obsolete_assets_are_staged_for_removal(self):
        with tempfile.TemporaryDirectory() as tmp:
            checkout=Path(tmp)
            (checkout/'js').mkdir()
            (checkout/'js/obsolete.js').write_text('old development-only data')
            (checkout/'js/kept.js').write_text('new file')
            before={'js/obsolete.js':'x','js/kept.js':'y'}
            after={'js/kept.js':'z'}
            with patch.object(pub,'git') as git:
                pub.remove_obsolete_assets(checkout,before,after)
                git.assert_called_once_with(['rm','--','js/obsolete.js'],checkout)

    def test_manifest_cleanup_rejects_traversal_and_git_control_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            for bad in ('../private.txt','/absolute.txt','.git/config','a\\b','a?b'):
                with self.subTest(bad=bad):
                    with patch.object(pub,'git') as git:
                        with self.assertRaisesRegex(pub.Stop,'DEV_MANIFEST_PATH_INVALID'):
                            pub.remove_obsolete_assets(Path(tmp),{bad:'hash'}, {})
                        git.assert_not_called()
            with self.assertRaisesRegex(pub.Stop,'DEV_MANIFEST_INVALID'):
                pub.remove_obsolete_assets(Path(tmp),['bad list'],{})

    def test_missing_pinned_shas_fail_before_github_or_git_writes(self):
        with patch.object(pub,'shutil') as shutil:
            with self.assertRaisesRegex(pub.Stop,'DEV_APPROVED_SHA_REQUIRED'):
                pub.publish()
            shutil.which.assert_not_called()

    def test_publication_requires_green_push_and_pr_for_same_commit(self):
        def report(events):
            return {'workflow_runs': [
                {'event':e,'head_sha':SOURCE,'name':'PR regression tests',
                 'status':'completed','conclusion':'success'} for e in events]}
        with patch.object(pub,'api',return_value=report(['push','pull_request'])) as api:
            pub.require_green_ci(SOURCE)
            self.assertIn('head_sha='+SOURCE,api.call_args.args[0])
        with patch.object(pub,'api',return_value=report(['push'])):
            with self.assertRaisesRegex(pub.Stop,'DEV_CI_NOT_GREEN'):
                pub.require_green_ci(SOURCE)

    def test_ci_from_different_sha_or_failed_checks_never_authorizes_publish(self):
        wrong={'event':'pull_request','head_sha':'c'*40,
               'name':'PR regression tests','status':'completed','conclusion':'success'}
        failed={'event':'pull_request','head_sha':SOURCE,
                'name':'PR regression tests','status':'completed','conclusion':'failure'}
        good={'event':'push','head_sha':SOURCE,
              'name':'PR regression tests','status':'completed','conclusion':'success'}
        for checks in ([good,wrong],[good,failed],[],[good,{'event':'pull_request','head_sha':SOURCE,'name':'another workflow','status':'completed','conclusion':'success'}]):
            with self.subTest(checks=checks):
                with patch.object(pub,'api',return_value={'workflow_runs':checks}):
                    with self.assertRaisesRegex(pub.Stop,'DEV_CI_NOT_GREEN'):
                        pub.require_green_ci(SOURCE)

    def test_development_publish_builder_preserves_existing_public_calendar(self):
        # The publish entrypoint must never silently reset independently
        # refreshed dev-pages calendar snapshots to older source snapshots.
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            checkout=folder/'checkout'
            checkout.mkdir()
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as build:
                result=pub.build_with_preserved_calendar(folder/'artifact',checkout)
                self.assertEqual(result,{'index.html':'synthetic'})
                build.assert_called_once_with(folder/'artifact',public_data=checkout/'data')

    def test_fixed_development_repository_and_no_production_target(self):
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')
        self.assertEqual(pub.SOURCE_BRANCH,'feat/nh-integration-v2')


if __name__=='__main__':
    unittest.main()
