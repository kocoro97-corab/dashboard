"""Development Pages source/head guards. Never make network requests."""
import sys
from pathlib import Path
import unittest
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

    def test_fixed_development_repository_and_no_production_target(self):
        self.assertEqual(pub.REPO,'kocoro97-corab/dashboard-v2-dev')
        self.assertEqual(pub.BRANCH,'dev-pages')
        self.assertEqual(pub.SOURCE_BRANCH,'feat/nh-integration-v2')


if __name__=='__main__':
    unittest.main()
