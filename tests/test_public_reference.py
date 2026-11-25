import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('public_reference',Path(__file__).resolve().parents[1]/'tools/refresh_public_reference.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PublicReference(unittest.TestCase):
 def test_only_exact_https_public_sources(self):
  for url in ['http://www.nasdaqtrader.com/a','https://example.com/a','https://user:pass@www.nasdaqtrader.com/a','https://www.nasdaqtrader.com:8443/a']:
   with self.assertRaises(ValueError):m.read(url)
 def test_incomplete_directory_does_not_replace_existing_references(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'us-instruments.json').write_text('existing');(p/'us-theme-instruments.json').write_text('existing')
   with patch.object(m,'read',return_value=b'Symbol|Security Name|Test Issue|ETF\nAAPL|Apple Inc.|N|N\n'):
    with self.assertRaisesRegex(ValueError,'INCOMPLETE'):m.refresh(p)
   self.assertEqual((p/'us-instruments.json').read_text(),'existing');self.assertEqual((p/'us-theme-instruments.json').read_text(),'existing')
 def test_committed_reference_is_public_and_typed(self):
  root=Path(__file__).resolve().parents[1]/'data';doc=json.loads((root/'us-instruments.json').read_text());rows=doc['instruments'];self.assertGreater(len(rows),1000);self.assertEqual(len(rows),len({r['symbol'] for r in rows}));self.assertTrue(any(r['type']=='ETF' for r in rows));self.assertTrue(any(r.get('nameKo')=='애플' for r in rows));self.assertNotIn('accountNumber',json.dumps(doc));themes=json.loads((root/'us-theme-instruments.json').read_text())['themes'];self.assertGreaterEqual(len(themes),6);self.assertTrue(all(len(t['instruments'])>=3 and t['sourceSha256'] for t in themes))
if __name__=='__main__':unittest.main()
