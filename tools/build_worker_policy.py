"""Export existing relay constants. No credentials, deployment IDs or private plans."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from relay.app import AUTH_ACTIONS,PRODUCTION_DEPLOYMENT
from relay.account_scope import READS,WRITES
from relay.market_routes import NEWS_QUERIES
from build_nh_staging import PRODUCTION_SHEET_HASH
TARGET=ROOT/'relay/worker/policy.json'
def policy():return dict(auth=sorted(AUTH_ACTIONS),reads=sorted(READS),writes=sorted(WRITES),productionDeployment=PRODUCTION_DEPLOYMENT,newsQueries=sorted(NEWS_QUERIES),productionSheetHash=PRODUCTION_SHEET_HASH,privateReads=['privateMorningBriefing'])
if __name__=='__main__':
 value=json.dumps(policy(),ensure_ascii=False,sort_keys=True,indent=2)+'\n'
 if '--check' in sys.argv:
  if not TARGET.is_file() or TARGET.read_text()!=value:raise SystemExit('WORKER_POLICY_DRIFT')
 else:TARGET.write_text(value)
