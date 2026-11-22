"""Only the isolated developer's Pages build gets manual comparison resources."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from build_dev_pages import build

MODULES=[
 'market-evidence-gate-v1.js',
 'market-session-context-v1.js',
 'strategy-risk-capacity-v1.js',
 'strategy-scenario-compare-v1.js',
 'strategy-market-link-v1.js',
 'five-minute-read-candidate-v1.js',
 'five-minute-reference-panel-v1.js',
 'strategy-scenario-compare-panel-v1.js'
]

class StrategyComparisonDevBundle(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory()
  cls.output=Path(cls.tmp.name)/'public'
  cls.manifest=build(cls.output,use_public_config=False)
  cls.html=(cls.output/'index.html').read_text()

 @classmethod
 def tearDownClass(cls):
  cls.tmp.cleanup()

 def test_development_modules_in_exact_static_order(self):
  indexes=[self.html.index('src="js/'+n+'?v=1') for n in MODULES]
  self.assertEqual(indexes,sorted(indexes))
  self.assertLess(indexes[-1],self.html.index('src="js/page-strategy.js?v=1'))
  for name in MODULES:
   self.assertEqual(self.html.count('src="js/'+name+'?v=1'),1)
   self.assertTrue((self.output/'js'/name).is_file())
   self.assertIn('js/'+name,self.manifest)

 def test_original_index_not_modified_and_no_news_script_injection(self):
  original=(ROOT/'index.html').read_text()
  self.assertNotIn('strategy-scenario-compare-v1.js',original)
  self.assertEqual(original.count('src="js/page-strategy.js?v=1"'),1)
  self.assertNotIn('news-briefing-market-composer-v1.js',self.html)

 def test_no_risk_cli_or_broker_code_in_exported_dev_assets(self):
  paths=set(self.manifest)
  self.assertNotIn('tools/inspect_strategy_risk_v1.cjs',paths)
  self.assertNotIn('gas/Code.gs',paths)
  self.assertNotIn('js/market-quality-diagnostics-v1.js',paths)
  self.assertTrue(set('js/'+s for s in MODULES).issubset(paths))

 def test_lazy_opt_in_and_route_cleanup_persist_in_export(self):
  source=(self.output/'js/page-strategy.js').read_text()
  self.assertIn('compareDisclosure.addEventListener',source)
  self.assertIn("compareDisclosure?.removeEventListener('toggle'",source)
  self.assertIn('cleanupComparison()',source)
  self.assertIn('if(!compareDisclosure.open)return',source)
  self.assertIn('MYInvestScenarioComparePanelV1',source)
  self.assertNotIn('compareHost,ctxRef',source)
  self.assertNotIn('compareHost,ctx',source)

 def test_csp_keeps_scripts_on_self_with_no_new_external_host(self):
  self.assertIn("script-src 'self'",self.html)
  self.assertIn("form-action 'none'",self.html)
  self.assertIn("base-uri 'none'",self.html)

 def test_news_modules_retained_with_strategy_dependencies(self):
  news=['news-briefing-archive-v1.js','news-briefing-transfer-v1.js',
        'news-briefing-panel-v1.js','news-briefing-public-feed-v1.js']
  indexes=[self.html.index('src="js/'+n+'?') for n in news]
  self.assertEqual(indexes,sorted(indexes))
  self.assertLess(indexes[-1],self.html.index('src="js/page-news.js?'))
  for name in news:
   self.assertEqual(self.html.count('src="js/'+name+'?'),1)
   self.assertIn('js/'+name,self.manifest)
  self.assertNotIn('data/myinvest-public-briefings-v1.json',self.manifest)

 def test_only_the_development_artifact_changes_inactivity_duration(self):
  original=(ROOT/'js/auth.js').read_text()
  with tempfile.TemporaryDirectory() as tmp:
   output=Path(tmp)/'persistent'
   build(output,relay_endpoint='https://myinvest-v2-dev-relay.synthetic.workers.dev/api')
   built=(output/'js/auth.js').read_text()
  self.assertIn('const SESSION_MS=300000;',original)
  self.assertIn('const SESSION_MS=300000;',(self.output/'js/auth.js').read_text())
  self.assertIn('const SESSION_MS=3600000;',built)
  self.assertNotIn('const SESSION_MS=3600000;',original)
  self.assertIn('const SECURITY_IDLE_MS = 5 * 60 * 1000;', (ROOT/'gas/Security.gs').read_text())
  self.assertNotIn('dev_session.js',(ROOT/'index.html').read_text())
  self.assertIn('js/dev_session.js',self.manifest)
  self.assertLess(self.html.index('src="js/auth.js?'),self.html.index('src="js/dev_session.js?'))

 def test_diagnostics_is_development_only_and_replaces_the_strategy_probe(self):
  self.assertIn('window.MYINVEST_DEV_DIAGNOSTICS=true',self.html)
  self.assertIn('js/development-diagnostics.js',self.manifest)
  self.assertIn('js/page-diagnostics.js',self.manifest)
  self.assertNotIn('page-diagnostics.js',(ROOT/'index.html').read_text())
  self.assertNotIn('MYInvestFiveMinuteReferencePanelV1',(self.output/'js/page-strategy.js').read_text())
  self.assertIn('MYInvestFiveMinuteReferencePanelV1',(self.output/'js/page-diagnostics.js').read_text())
  self.assertLess(self.html.index('src="js/development-diagnostics.js?'),self.html.index('src="js/debug.js?'))
  self.assertLess(self.html.index('src="js/page-diagnostics.js?'),self.html.index('src="js/app-shell.js?'))

 def test_session_build_refuses_an_unreviewed_duration_marker(self):
  from unittest.mock import patch
  original=Path.read_text
  def changed(path,*args,**kwargs):
   text=original(path,*args,**kwargs)
   return text.replace('const SESSION_MS=300000;','const SESSION_MS=1;') if path==ROOT/'js/auth.js' else text
  with tempfile.TemporaryDirectory() as tmp,patch.object(Path,'read_text',changed):
   with self.assertRaisesRegex(ValueError,'DEV_SESSION_DURATION_MARKER_CHANGED'):
    build(Path(tmp)/'site',use_public_config=False)

if __name__=='__main__':
 unittest.main()
