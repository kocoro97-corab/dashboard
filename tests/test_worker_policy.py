"""Existing Python relay remains the policy source; compare Worker adapter decisions."""
import importlib.util,json,subprocess,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path[:0]=[str(ROOT),str(ROOT/'tools'),str(ROOT/'tests')]
from build_worker_policy import policy,TARGET
from relay.market_routes import allowed_market_url
from build_dev_pages import fixed_relay
from test_market_relay import VALID
class WorkerPolicyTests(unittest.TestCase):
 def test_generated_constants_match_existing_relay(self):self.assertEqual(json.loads(TARGET.read_text()),policy())
 def test_market_rules_match_existing_python_boundary(self):
  urls=list(VALID)+[u.replace('https://','https:////') for u in VALID]+[u.replace('/api/','/unexpected/../api/') for u in VALID]+[u+'&' for u in VALID if '?' in u]+[u+suffix for u in VALID for suffix in ['#fragment','?token=PRIVATE','&extra=1','&url=https://127.0.0.1']]+['https://127.0.0.1/api','https://api.nhplug.com/order','https://query1.finance.yahoo.com/v8/finance/chart/%2e%2e%2fprivate?interval=1d&range=1y']
  code="import {allowedMarketUrl} from './relay/worker/worker.mjs';let x='';for await(const p of process.stdin)x+=p;process.stdout.write(JSON.stringify(JSON.parse(x).map(allowedMarketUrl)))"
  r=subprocess.run(['node','--input-type=module','-e',code],input=json.dumps(urls),text=True,cwd=ROOT,capture_output=True,check=True)
  self.assertEqual(json.loads(r.stdout),[allowed_market_url(x) for x in urls])
 def test_bootstrap_endpoint_never_accepts_gas_credentials_queries_or_other_hosts(self):
  self.assertEqual(fixed_relay('https://myinvest-v2-dev-relay.synthetic.workers.dev/api'),'https://myinvest-v2-dev-relay.synthetic.workers.dev/api')
  for url in ['https://script.google.com/macros/s/PRIVATE/exec','https://evil.example/api','http://relay.test.workers.dev/api','https://relay.test.workers.dev/api?token=PRIVATE','https://user:pass@relay.test.workers.dev/api','https://relay.test.workers.dev/api#PRIVATE']:
   with self.assertRaises(ValueError):fixed_relay(url)
if __name__=='__main__':unittest.main()
