"""Synthetic freshness/privacy checks for development calendar republishing."""
import datetime,json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from build_dev_pages import build,ROOT
class CalendarPublication(unittest.TestCase):
 def test_newer_public_snapshot_is_kept_without_resetting_failed_collection_status(self):
  with tempfile.TemporaryDirectory() as temp:
   folder=Path(temp);data=folder/'existing/data';data.mkdir(parents=True)
   row=json.loads((ROOT/'data/earnings-events.json').read_text());row['retrievedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(data/'earnings-events.json').write_text(json.dumps(row))
   (data.parent/'calendar-data-status.json').write_text(json.dumps([{'file':'earnings-events.json','status':'FAILED','retrievedAt':row['retrievedAt']}]))
   build(folder/'public',public_data=data)
   self.assertEqual(json.loads((folder/'public/data/earnings-events.json').read_text())['retrievedAt'],row['retrievedAt'])
   self.assertEqual(next(x for x in json.loads((folder/'public/calendar-data-status.json').read_text()) if x['file']=='earnings-events.json')['status'],'FAILED')
 def test_private_fields_in_existing_data_cannot_reach_a_new_public_artifact(self):
  with tempfile.TemporaryDirectory() as temp:
   folder=Path(temp);data=folder/'existing/data';data.mkdir(parents=True)
   row=json.loads((ROOT/'data/earnings-events.json').read_text());row['retrievedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();row['events'][0]['accountNumber']='SYNTHETIC_PRIVATE_CANARY';(data/'earnings-events.json').write_text(json.dumps(row));build(folder/'public',public_data=data)
   self.assertNotIn('SYNTHETIC_PRIVATE_CANARY',(folder/'public/data/earnings-events.json').read_text())
if __name__=='__main__':unittest.main()
