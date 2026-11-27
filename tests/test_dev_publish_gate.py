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

    def test_preview_branch_requires_exact_draft_pr_identity_and_sha(self):
        valid={'state':'open','draft':True,'merged_at':None,
               'head':{'ref':pub.PREVIEW_BRANCH,'sha':SOURCE,
                       'repo':{'full_name':'kocoro97-corab/dashboard'}},
               'base':{'ref':pub.SOURCE_BRANCH}}
        with patch.object(pub,'api',return_value=valid) as api:
            pub.require_reviewed_preview(SOURCE,pub.PREVIEW_BRANCH)
            api.assert_called_once_with('repos/kocoro97-corab/dashboard/pulls/10')
        for wrong in (
            {'draft':False},
            {'state':'closed'},
            {'head':{'ref':pub.PREVIEW_BRANCH,'sha':'c'*40,
                     'repo':{'full_name':'kocoro97-corab/dashboard'}}},
            {'head':{'ref':pub.PREVIEW_BRANCH,'sha':SOURCE,
                     'repo':{'full_name':'another/other'}}},
            {'base':{'ref':'main'}},
            {'merged_at':'2026-11-25T00:00:00Z'}
        ):
            row=dict(valid,**wrong)
            with self.subTest(wrong=wrong),patch.object(pub,'api',return_value=row):
                with self.assertRaisesRegex(pub.Stop,'DEV_PREVIEW_PR_MISMATCH'):
                    pub.require_reviewed_preview(SOURCE,pub.PREVIEW_BRANCH)
        with patch.object(pub,'api') as api:
            with self.assertRaisesRegex(pub.Stop,'DEV_SOURCE_BRANCH_NOT_APPROVED'):
                pub.require_reviewed_preview(SOURCE,'main')
            api.assert_not_called()

    def test_pr11_preview_requires_exact_draft_sha_base_and_owner(self):
        valid={'state':'open','draft':True,'merged_at':None,
               'head':{'ref':pub.NEXT_PREVIEW_BRANCH,'sha':SOURCE,
                       'repo':{'full_name':'kocoro97-corab/dashboard'}},
               'base':{'ref':pub.PREVIEW_BRANCH}}
        with patch.object(pub,'api',return_value=valid) as api:
            pub.require_reviewed_preview(SOURCE,pub.NEXT_PREVIEW_BRANCH)
            api.assert_called_once_with('repos/kocoro97-corab/dashboard/pulls/11')
        for wrong in (
            {'draft':False},
            {'state':'closed'},
            {'base':{'ref':pub.SOURCE_BRANCH}},
            {'head':{'ref':pub.NEXT_PREVIEW_BRANCH,'sha':'f'*40,
                     'repo':{'full_name':'kocoro97-corab/dashboard'}}},
            {'head':{'ref':pub.NEXT_PREVIEW_BRANCH,'sha':SOURCE,
                     'repo':{'full_name':'another/other'}}},
        ):
            with self.subTest(wrong=wrong),patch.object(pub,'api',return_value=dict(valid,**wrong)):
                with self.assertRaisesRegex(pub.Stop,'DEV_PREVIEW_PR_MISMATCH'):
                    pub.require_reviewed_preview(SOURCE,pub.NEXT_PREVIEW_BRANCH)

    def test_pr11_build_retains_public_calendar_and_identifies_source(self):
        with patch.object(pub,'git',side_effect=[pub.NEXT_PREVIEW_BRANCH,SOURCE]):
            self.assertEqual(pub.verified_source_commit(SOURCE,pub.NEXT_PREVIEW_BRANCH),SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as build:
                pub.build_with_preserved_calendar(folder/'next',folder,pub.NEXT_PREVIEW_BRANCH)
                build.assert_called_once_with(folder/'next',public_data=folder/'data',source_branch=pub.NEXT_PREVIEW_BRANCH)
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')

    def test_pr12_preview_requires_exact_open_draft_head_and_parent(self):
        valid={'state':'open','draft':True,'merged_at':None,
               'head':{'ref':pub.TIMING_PREVIEW_BRANCH,'sha':SOURCE,
                       'repo':{'full_name':'kocoro97-corab/dashboard'}},
               'base':{'ref':pub.NEXT_PREVIEW_BRANCH}}
        with patch.object(pub,'api',return_value=valid) as api:
            pub.require_reviewed_preview(SOURCE,pub.TIMING_PREVIEW_BRANCH)
            api.assert_called_once_with('repos/kocoro97-corab/dashboard/pulls/12')
        for wrong in (
            {'draft':False}, {'state':'closed'}, {'merged_at':'2026-11-25T00:00:00Z'},
            {'base':{'ref':pub.PREVIEW_BRANCH}},
            {'head':{'ref':pub.TIMING_PREVIEW_BRANCH,'sha':'f'*40,
                     'repo':{'full_name':'kocoro97-corab/dashboard'}}},
            {'head':{'ref':pub.TIMING_PREVIEW_BRANCH,'sha':SOURCE,
                     'repo':{'full_name':'another/repo'}}},
        ):
            with self.subTest(wrong=wrong),patch.object(pub,'api',return_value=dict(valid,**wrong)):
                with self.assertRaisesRegex(pub.Stop,'DEV_PREVIEW_PR_MISMATCH'):
                    pub.require_reviewed_preview(SOURCE,pub.TIMING_PREVIEW_BRANCH)

    def test_pr12_checked_build_retains_dev_calendar_and_exact_source(self):
        with patch.object(pub,'git',side_effect=[pub.TIMING_PREVIEW_BRANCH,SOURCE]):
            self.assertEqual(pub.verified_source_commit(SOURCE,pub.TIMING_PREVIEW_BRANCH),SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as build:
                pub.build_with_preserved_calendar(folder/'pr12',folder,pub.TIMING_PREVIEW_BRANCH)
                build.assert_called_once_with(folder/'pr12',public_data=folder/'data',source_branch=pub.TIMING_PREVIEW_BRANCH)
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')

    def test_pr14_preview_requires_exact_draft_identity_head_and_parent(self):
        valid={'state':'open','draft':True,'merged_at':None,
               'head':{'ref':pub.UI_PREVIEW_BRANCH,'sha':SOURCE,
                       'repo':{'full_name':'kocoro97-corab/dashboard'}},
               'base':{'ref':pub.RETRY_PREVIEW_BRANCH}}
        with patch.object(pub,'api',return_value=valid) as api:
            pub.require_reviewed_preview(SOURCE,pub.UI_PREVIEW_BRANCH)
            api.assert_called_once_with('repos/kocoro97-corab/dashboard/pulls/14')
        for invalid in (
            {'draft':False},{'state':'closed'},{'merged_at':'2026-11-26T00:00:00Z'},
            {'base':{'ref':pub.TIMING_PREVIEW_BRANCH}},
            {'head':{'ref':pub.UI_PREVIEW_BRANCH,'sha':'f'*40,
                     'repo':{'full_name':'kocoro97-corab/dashboard'}}},
            {'head':{'ref':pub.UI_PREVIEW_BRANCH,'sha':SOURCE,
                     'repo':{'full_name':'attacker/other'}}},
        ):
            with self.subTest(invalid=invalid),patch.object(pub,'api',return_value=dict(valid,**invalid)):
                with self.assertRaisesRegex(pub.Stop,'DEV_PREVIEW_PR_MISMATCH'):
                    pub.require_reviewed_preview(SOURCE,pub.UI_PREVIEW_BRANCH)

    def test_pr14_build_retains_existing_dev_calendar(self):
        with patch.object(pub,'git',side_effect=[pub.UI_PREVIEW_BRANCH,SOURCE]):
            self.assertEqual(pub.verified_source_commit(SOURCE,pub.UI_PREVIEW_BRANCH),SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as build:
                pub.build_with_preserved_calendar(folder/'pr14',folder,pub.UI_PREVIEW_BRANCH)
                build.assert_called_once_with(folder/'pr14',public_data=folder/'data',source_branch=pub.UI_PREVIEW_BRANCH)
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')

    def test_pr15_preview_requires_exact_open_draft_head_and_parent(self):
        valid={'state':'open','draft':True,'merged_at':None,
               'head':{'ref':pub.FOREGROUND_PREVIEW_BRANCH,'sha':SOURCE,
                       'repo':{'full_name':'kocoro97-corab/dashboard'}},
               'base':{'ref':pub.UI_PREVIEW_BRANCH}}
        with patch.object(pub,'api',return_value=valid) as api:
            pub.require_reviewed_preview(SOURCE,pub.FOREGROUND_PREVIEW_BRANCH)
            api.assert_called_once_with('repos/kocoro97-corab/dashboard/pulls/15')
        for bad in (
            {'draft':False},{'state':'closed'},{'merged_at':'2026-11-26T00:00:00Z'},
            {'base':{'ref':pub.RETRY_PREVIEW_BRANCH}},
            {'head':{'ref':pub.FOREGROUND_PREVIEW_BRANCH,'sha':'f'*40,
                     'repo':{'full_name':'kocoro97-corab/dashboard'}}},
            {'head':{'ref':pub.FOREGROUND_PREVIEW_BRANCH,'sha':SOURCE,
                     'repo':{'full_name':'attacker/other'}}},
        ):
            with self.subTest(bad=bad),patch.object(pub,'api',return_value=dict(valid,**bad)):
                with self.assertRaisesRegex(pub.Stop,'DEV_PREVIEW_PR_MISMATCH'):
                    pub.require_reviewed_preview(SOURCE,pub.FOREGROUND_PREVIEW_BRANCH)

    def test_pr15_preserves_calendar_data_and_separate_dev_repo(self):
        with patch.object(pub,'git',side_effect=[pub.FOREGROUND_PREVIEW_BRANCH,SOURCE]):
            self.assertEqual(pub.verified_source_commit(SOURCE,pub.FOREGROUND_PREVIEW_BRANCH),SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as builder:
                pub.build_with_preserved_calendar(folder/'pr15',folder,pub.FOREGROUND_PREVIEW_BRANCH)
                builder.assert_called_once_with(folder/'pr15',public_data=folder/'data',source_branch=pub.FOREGROUND_PREVIEW_BRANCH)
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')

    def test_pr17_approved_exact_draft_source_base_and_owner(self):
        source={'state':'open','draft':True,'merged_at':None,
                'head':{'ref':pub.PRIVATE_PREVIEW_BRANCH,'sha':SOURCE,
                        'repo':{'full_name':'kocoro97-corab/dashboard'}},
                'base':{'ref':pub.FOREGROUND_PREVIEW_BRANCH}}
        with patch.object(pub,'api',return_value=source) as api:
            pub.require_reviewed_preview(SOURCE,pub.PRIVATE_PREVIEW_BRANCH)
            api.assert_called_once_with('repos/kocoro97-corab/dashboard/pulls/17')
        for invalid in (
            {'draft':False},{'state':'closed'},{'merged_at':'2026-11-26T00:00:00Z'},
            {'base':{'ref':pub.UI_PREVIEW_BRANCH}},
            {'head':{'ref':pub.PRIVATE_PREVIEW_BRANCH,'sha':'f'*40,
                     'repo':{'full_name':'kocoro97-corab/dashboard'}}},
            {'head':{'ref':pub.PRIVATE_PREVIEW_BRANCH,'sha':SOURCE,
                     'repo':{'full_name':'attacker/repo'}}},
        ):
            with self.subTest(invalid=invalid),patch.object(pub,'api',return_value=dict(source,**invalid)):
                with self.assertRaisesRegex(pub.Stop,'DEV_PREVIEW_PR_MISMATCH'):
                    pub.require_reviewed_preview(SOURCE,pub.PRIVATE_PREVIEW_BRANCH)

    def test_pr17_build_copies_only_frontend_no_private_archive(self):
        with patch.object(pub,'git',side_effect=[pub.PRIVATE_PREVIEW_BRANCH,SOURCE]):
            self.assertEqual(pub.verified_source_commit(SOURCE,pub.PRIVATE_PREVIEW_BRANCH),SOURCE)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as builder:
                for unapproved in (None, 'https://myinvest-v2-dev-relay.kocoro97.workers.dev/api',
                                   pub.PRIVATE_PREVIEW_RELAY+'?extra=1'):
                    with self.subTest(relay=unapproved):
                        with self.assertRaisesRegex(pub.Stop,'DEV_PRIVATE_PREVIEW_RELAY_REQUIRED'):
                            pub.build_with_preserved_calendar(folder/'pr17',folder,pub.PRIVATE_PREVIEW_BRANCH,unapproved)
                builder.assert_not_called()
                pub.build_with_preserved_calendar(folder/'pr17',folder,pub.PRIVATE_PREVIEW_BRANCH,pub.PRIVATE_PREVIEW_RELAY)
                builder.assert_called_once_with(folder/'pr17',private_briefing_endpoint=pub.PRIVATE_PREVIEW_RELAY,
                                                public_data=folder/'data',
                                                source_branch=pub.PRIVATE_PREVIEW_BRANCH)
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')

    def test_private_preview_keeps_primary_and_oauth_and_adds_only_fixed_reader(self):
        from build_dev_pages import build
        with tempfile.TemporaryDirectory() as tmp:
            output=Path(tmp)/'dual'
            build(output,source_branch=pub.PRIVATE_PREVIEW_BRANCH,private_briefing_endpoint=pub.PRIVATE_PREVIEW_RELAY)
            html=(output/'index.html').read_text()
            self.assertIn('MYINVEST_PRIVATE_BRIEFING_RELAY',html)
            self.assertIn('https://myinvest-v2-dev-relay.kocoro97.workers.dev/api',html)
            self.assertIn('https://myinvest-v2-dev-relay.kocoro97.workers.dev/oauth/google/start',html)
            self.assertIn(pub.PRIVATE_PREVIEW_RELAY,html)
            self.assertTrue((output/'js/private-original-briefing.js').is_file())
            self.assertFalse((output/'gas').exists())
            self.assertFalse((output/'relay').exists())
        with tempfile.TemporaryDirectory() as tmp:
            for bad in (pub.PRIVATE_PREVIEW_RELAY+'?token=synthetic','https://another.synthetic.workers.dev/api'):
                with self.assertRaisesRegex(ValueError,'DEV_PRIVATE_READER_ENDPOINT_INVALID'):
                    build(Path(tmp)/'invalid',source_branch=pub.PRIVATE_PREVIEW_BRANCH,private_briefing_endpoint=bad)

    def test_private_relay_gate_runs_before_network_or_build(self):
        with patch.object(pub,'api') as api,patch.object(pub,'build') as builder,patch.object(pub,'git') as git:
            with self.assertRaisesRegex(pub.Stop,'DEV_PRIVATE_PREVIEW_RELAY_REQUIRED'):
                pub.publish(SOURCE,'b'*40,pub.PRIVATE_PREVIEW_BRANCH)
            with self.assertRaisesRegex(pub.Stop,'DEV_PRIVATE_PREVIEW_RELAY_NOT_ALLOWED'):
                pub.publish(SOURCE,'b'*40,pub.FOREGROUND_PREVIEW_BRANCH,pub.PRIVATE_PREVIEW_RELAY)
            api.assert_not_called()
            builder.assert_not_called()
            git.assert_not_called()

    def test_preview_checkout_and_build_keep_original_publish_path(self):
        with patch.object(pub,'git',side_effect=[pub.PREVIEW_BRANCH,SOURCE]):
            self.assertEqual(pub.verified_source_commit(SOURCE,pub.PREVIEW_BRANCH),SOURCE)
        with patch.object(pub,'git',return_value='main'):
            with self.assertRaisesRegex(pub.Stop,'DEV_SOURCE_BRANCH_MISMATCH'):
                pub.verified_source_commit(SOURCE,pub.PREVIEW_BRANCH)
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as build:
                pub.build_with_preserved_calendar(folder/'preview',folder,pub.PREVIEW_BRANCH)
                build.assert_called_once_with(folder/'preview',public_data=folder/'data',source_branch=pub.PREVIEW_BRANCH)
            with patch.object(pub,'build',return_value={'index.html':'synthetic'}) as build:
                pub.build_with_preserved_calendar(folder/'original',folder,pub.SOURCE_BRANCH)
                build.assert_called_once_with(folder/'original',public_data=folder/'data')

    def test_fixed_development_repository_and_no_production_target(self):
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')
        self.assertEqual(pub.SOURCE_BRANCH,'feat/nh-integration-v2')


if __name__=='__main__':
    unittest.main()

