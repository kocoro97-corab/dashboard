import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from nh_v2_futures_activate import coordinated
class Tests(unittest.TestCase):
 def run_steps(self,fail=None,changed=True):
  calls=[]
  def upgrade():calls.append('upgrade');return {'status':'FAIL' if fail=='upgrade' else 'PASS','changed':changed,'recovery':'NOT_NEEDED'}
  def step(name):
   def run(*args):
    calls.append(name)
    if fail==name:raise RuntimeError('SYNTHETIC_SECRET')
   return run
  r=coordinated(upgrade,step('deploy'),step('restore'),step('verify'));self.assertNotIn('SYNTHETIC_SECRET',str(r));return calls,r
 def test_success_never_runs_restore(self):c,r=self.run_steps();self.assertEqual(c,['upgrade','deploy','verify']);self.assertEqual(r['status'],'PASS')
 def test_gas_upgrade_failure_never_changes_worker(self):c,r=self.run_steps('upgrade');self.assertEqual(c,['upgrade']);self.assertEqual(r['status'],'FAIL')
 def test_worker_or_readback_failure_restores_connection(self):
  for failure in ['deploy','verify']:
   c,r=self.run_steps(failure);self.assertEqual(c[-1],'restore');self.assertEqual(r['recovery'],'PASS_PREVIOUS_CONNECTION_RESTORED')
if __name__=='__main__':unittest.main()
