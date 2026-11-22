"""Synthetic-only report integration artifact must never alter app sources or ship secrets."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_research_report_review_v1 import build_review,SCRIPTS

class ResearchReportReviewArtifact(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory()
  cls.public=Path(cls.temp.name)/'review'
  cls.manifest=build_review(cls.public,relay_endpoint=
      'https://myinvest-v2-dev-relay.synthetic.workers.dev/api')
  cls.html=(cls.public/'index.html').read_text()

 @classmethod
 def tearDownClass(cls):
  cls.temp.cleanup()

 def test_original_codex_routes_and_source_index_remain_unchanged(self):
  original=(ROOT/'index.html').read_text()
  assert 'MYINVEST_RESEARCH_REVIEW' not in original
  assert 'research-report-strategy-review-hook-v1.js' not in original
  assert 'src="js/app-router.js?v=1' in self.html
  assert 'src="js/page-strategy.js?v=1' in self.html
  assert 'src="js/page-news.js?v=2' in self.html
  assert 'src="js/app-shell.js?v=2' in self.html
  assert 'news-briefing' in self.html

 def test_fixed_local_development_module_order(self):
  assert self.html.count('MYINVEST_RESEARCH_REVIEW="synthetic-only"')==1
  positions=[self.html.index('src="js/'+name+'?review=synthetic-only"')
             for name in SCRIPTS]
  assert positions==sorted(positions)
  assert positions[0]>self.html.index('src="js/app-shell.js?v=2')
  for name in SCRIPTS:
   assert self.html.count('src="js/'+name+'?review=synthetic-only"')==1
   assert (self.public/'js'/name).is_file()
   assert 'js/'+name in self.manifest
  assert not any('http://' in s or 'https://' in s for s in SCRIPTS)

 def test_public_metadata_labels_synthetic_without_provider_or_order_rights(self):
  doc=json.loads((self.public/'development-only.json').read_text())
  assert doc['researchHarness']=='SYNTHETIC_ONLY'
  assert doc['researchHarnessProductionAllowed'] is False
  assert doc['syntheticReportLiveMarketQueries'] is False
  assert doc['syntheticReportAccountDataUsed'] is False
  assert doc['syntheticReportOrderCalls'] is False
  assert doc['storageWrites'] is False
  assert doc['nhAccountQueries'] is False

 def test_isolated_hooks_never_access_account_storage_or_order_apis(self):
  hook=(self.public/'js/research-report-strategy-review-hook-v1.js').read_text()
  fixture=(self.public/'js/research-report-harness-fixture-v1.js').read_text()
  assert 'synthetic-only' in hook
  assert 'data-research-harness' in hook
  assert 'str4' in hook
  assert 'hashchange' in hook
  assert 'destroyPanel' in hook
  for forbidden in ('fetch(', 'localStorage.', 'sessionStorage.', 'NH_ACCOUNT',
                    'placeOrder(', 'executeOrder(', 'saveExternalHoldings(', 'PropertiesService'):
   assert forbidden not in hook,forbidden
   assert forbidden not in fixture,forbidden

 def test_research_scripts_only_in_review_artifact_and_manifest(self):
  assert 'src="js/market-sector-stock-alignment-v1.js?' not in (ROOT/'index.html').read_text()
  assert (self.public/'asset-manifest.json').is_file()
  manifest=json.loads((self.public/'asset-manifest.json').read_text())
  assert manifest['index.html']==self.manifest['index.html']
  assert manifest['js/research-report-strategy-review-hook-v1.js']==self.manifest['js/research-report-strategy-review-hook-v1.js']
  assert 'gas/Code.gs' not in manifest
  assert not any('Properties' in path or '.env' in path for path in manifest)

if __name__=='__main__':
 unittest.main()
