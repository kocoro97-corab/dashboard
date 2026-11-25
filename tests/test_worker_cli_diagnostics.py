import unittest,sys,subprocess
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from nh_v2_persistent import run,Stop
class Tests(unittest.TestCase):
 def test_cli_failure_retains_only_bounded_public_codes(self):
  result=subprocess.CompletedProcess([],1,'SYNTHETIC_PRIVATE_TOKEN','HTTP 403 [code: 10000] SYNTHETIC_PRIVATE_TOKEN')
  with patch('nh_v2_persistent.subprocess.run',return_value=result):
   with self.assertRaises(Stop) as caught:run(['deploy'],Path('/tmp'),{})
  e=caught.exception;self.assertEqual(e.diagnostic['http'],403);self.assertEqual(e.diagnostic['providerCodes'],[10000]);self.assertEqual(e.diagnostic['stage'],'WORKER_UPLOAD');self.assertNotIn('SYNTHETIC_PRIVATE_TOKEN',str(e)+str(e.diagnostic))
if __name__=='__main__':unittest.main()
