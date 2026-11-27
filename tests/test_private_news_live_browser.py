"""Synthetic receipt checks only; never imports an owner browser/session."""
import hashlib,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import verify_private_news_live_browser as m

class OwnerBrowserReceiptTests(unittest.TestCase):
    def fixture(self):
        text='SYNTHETIC 원문\r\n<script>NEVER_EXECUTE</script>\n';digest=hashlib.sha256(text.encode()).hexdigest()
        return {'success':True,'cacheable':False,'report':{'date':'2026-11-27','content':text,'contentSha256':digest}},digest,len(text.encode())
    def test_exact_source_response_contract(self):
        data,digest,size=self.fixture();out=m.receipt(data,digest,'2026-11-27',size)
        self.assertEqual(out['sha256'],digest);self.assertEqual(out['bytes'],size);self.assertNotIn('content',out)
    def test_wrong_hash_size_date_or_cache_contract_is_not_accepted(self):
        for variant in ('hash','size','date','cache','denied'):
            data,digest,size=self.fixture()
            if variant=='hash':data['report']['contentSha256']='f'*64
            if variant=='size':size+=1
            if variant=='date':data['report']['date']='2026-11-26'
            if variant=='cache':data['cacheable']=True
            if variant=='denied':data={'success':False,'message':'PRIVATE_CANARY','token':'PRIVATE_CANARY'}
            with self.subTest(variant=variant):
                with self.assertRaises(m.Stop) as error:m.receipt(data,digest,'2026-11-27',size)
                self.assertNotIn('PRIVATE_CANARY',str(error.exception))

if __name__=='__main__':unittest.main()
