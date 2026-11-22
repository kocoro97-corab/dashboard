"""Approved narrow pilot security contract, exercised without live requests."""
import importlib.util,os,shutil,subprocess,tempfile,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
URL='https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=5m&range=1d'
class FiveMinuteProposalTest(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.tree=Path(cls.tmp.name)
  for name in ['relay/worker/worker.mjs','relay/worker/policy.json','relay/market_routes.py','tests/worker-relay.test.cjs']:
   p=cls.tree/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/name,p)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def test_python_scope_of_approved_relay(self):
  def load(file,name):
   spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
  live=load(ROOT/'relay/market_routes.py','current_routes');proposed=load(self.tree/'relay/market_routes.py','proposed_routes')
  self.assertTrue(live.allowed_market_url(URL));self.assertTrue(proposed.allowed_market_url(URL))
  for bad in [URL+'&token=x',URL+'#x',URL.replace('AAPL','MSFT'),URL.replace('5m','1m'),URL.replace('1d','5d'),URL.replace('https:','http:'),URL.replace('AAPL','%41APL')]:self.assertFalse(proposed.allowed_market_url(bad),bad)
  daily=URL.replace('5m','1d');self.assertTrue(live.allowed_market_url(daily));self.assertTrue(proposed.allowed_market_url(daily))
 def test_existing_worker_security_suite_against_proposed_copy(self):
  r=subprocess.run(['node','tests/worker-relay.test.cjs'],cwd=self.tree,capture_output=True,text=True,timeout=40)
  self.assertEqual(r.returncode,0,r.stdout+r.stderr)
 def test_proposed_worker_keeps_auth_and_public_profile_required(self):
  existing=(self.tree/'tests/worker-relay.test.cjs').read_text();prefix=existing.split("test('persistent config",1)[0]
  body=r'''
(async()=>{
 const url='https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=5m&range=1d';
 const f=await fixture();assert.equal(f.api.allowedMarketUrl(url),true);
 for(const bad of [url+'&token=x',url+'#x',url.replace('AAPL','MSFT'),url.replace('5m','1m'),url.replace('1d','5d'),url.replace('AAPL','%41APL')])assert.equal(f.api.allowedMarketUrl(bad),false);
 assert.equal((await f.handler(req({action:'publicFetch',url}),f.env)).status,401);assert.equal(f.calls.length,0);
 const meta=await(await f.handler(req(),f.env)).json();assert.equal(meta.developmentFiveMinuteReferenceVersion,1);
 const response=await f.handler(req({action:'publicFetch',url},{Authorization:'Bearer '+token}),f.env);assert.equal(response.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,url);
 const off=await fixture({MYINVEST_PUBLIC_MARKET:'false'});assert.equal((await off.handler(req({action:'publicFetch',url},{Authorization:'Bearer '+token}),off.env)).status,403);
 const offMeta=await(await off.handler(req(),off.env)).json();assert.equal(offMeta.developmentFiveMinuteReferenceVersion,0);
 let session=false,getCalls=0;
 const gateway=f.api.createGateway(f.api.configuration(f.env),async(u,options)=>{
  if(u.includes('script.google.com'))return new Response(JSON.stringify({success:session}),{headers:{'Content-Type':'application/json'}});
  getCalls++;assert.equal(u,url);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.ok(!JSON.stringify(options.headers).includes(token));return new Response('SYNTHETIC_PUBLIC');
 });
 await assert.rejects(()=>gateway.public(url,token));assert.equal(getCalls,0);session=true;assert.equal(await gateway.public(url,token),'SYNTHETIC_PUBLIC');assert.equal(getCalls,1);
 console.log('PROPOSAL_SCOPE_AND_AUTH_PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
'''
  script=self.tree/'tests/proposal-scope.cjs';script.write_text(prefix+body)
  r=subprocess.run(['node',str(script)],cwd=self.tree,capture_output=True,text=True,timeout=30)
  self.assertEqual(r.returncode,0,r.stdout+r.stderr);self.assertIn('PROPOSAL_SCOPE_AND_AUTH_PASS',r.stdout)
if __name__=='__main__':unittest.main()
