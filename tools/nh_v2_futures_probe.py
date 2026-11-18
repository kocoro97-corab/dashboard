"""Owner-only, single A06 inquiry against the existing isolated environment.
No deploy, account inquiry, order, Sheet/Properties or private-data file writes.
Credentials are prompted locally and never included in results.
"""
import argparse,datetime,getpass,json,math,re,time
from pathlib import Path
from nh_v2_fresh import private_path,target,OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID,OLD_SHEET
from nh_staging_test import WebApp,fingerprint,PRODUCTION_SHEET_HASH

class Stop(Exception):
 def __init__(self,code):self.code=code

def validate_quote(q,now=None):
 now=time.time()*1000 if now is None else now
 if not isinstance(q,dict) or not re.fullmatch(r'A06[0-9][1-9ABC]000',str(q.get('code',''))):raise Stop('NH_CONTRACT')
 if not re.search(r'코스닥150|KOSDAQ150',re.sub(r'\s','',str(q.get('name',''))),re.I):raise Stop('NH_CONTRACT')
 expiry=str(q.get('expiry',''))
 try:date=datetime.datetime.strptime(expiry,'%Y%m%d').date()
 except ValueError:raise Stop('NH_CONTRACT') from None
 today=datetime.datetime.fromtimestamp(now/1000,datetime.timezone(datetime.timedelta(hours=9))).date()
 if len(expiry)!=8 or date<today or q.get('contractVerified') is not True:raise Stop('NH_CONTRACT')
 for key in ['p','prev']:
  value=q.get(key)
  if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0:raise Stop('NH_NO_PRICE')
 observed=q.get('observedAt')
 if isinstance(observed,bool) or not isinstance(observed,(int,float)) or not math.isfinite(observed) or observed<=0 or observed>now+300000:raise Stop('NH_OBSERVATION')
 if now-observed>4*86400000:raise Stop('NH_STALE')
 return {'contract':q['code'],'expiry':expiry,'price':q['p'],'changePct':(q['p']/q['prev']-1)*100,'observedAt':datetime.datetime.fromtimestamp(observed/1000,datetime.timezone.utc).isoformat(),'receivedAt':datetime.datetime.fromtimestamp(now/1000,datetime.timezone.utc).isoformat(),'source':'NH N2 PLUG','marketState':'UNVERIFIED','delayStatus':'UNVERIFIED'}

def verify(client,plan,credentials):
 report={'mode':'OWNER_ISOLATED_KOSDAQ150_INQUIRY','status':'NOT_RUN','nhQuoteRequests':0,'accountCalls':0,'orderCalls':0,'storeWrites':False,'credentialsIncluded':False,'phase':'ISOLATION'};token=None
 try:
  m=client.call('appVersion')
  expected={'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':fingerprint(plan['scriptId']),'sheetHash':plan['sheetHash'],'sourceDigest':plan['sourceDigest'],'gatewayVersion':2,'storeEngine':'account-store-v2'}
  if any(m.get(k)!=v for k,v in expected.items()):raise Stop('ISOLATION_NOT_VERIFIED')
  report['phase']='LOGIN';user,password=credentials();login=client.call('login',**{'user':user,'pass':password});token=login.get('token');client.token=token
  if not isinstance(token,str) or not re.fullmatch('[a-fA-F0-9]{64}',token) or login.get('mustChangePassword'):raise Stop('AUTH_REQUIRED')
  report['phase']='NH_QUOTE';report['nhQuoteRequests']=1;result=client.call('nhQuotes',items=[{'k':'k4','t':'fut','c':'A06'}]);q=result.get('data',{}).get('k4')
  if q is None:
   raw=str(result.get('errors',{}).get('k4',''));match=re.match(r'^(NH_(?:CONFIG|TOKEN|HTTP|NETWORK|RSP|NO_PRICE|CONTRACT|OBSERVATION|STALE|UNSUPPORTED))(?: / HTTP [1-5][0-9]{2})?$',raw);raise Stop(match[1] if match else 'NH_NO_PRICE')
  report.update(status='PARTIAL',quote=validate_quote(q),code='QUOTE_VERIFIED_MARKET_STATE_PENDING')
 except Stop as e:report.update(status='NOT_RUN' if not report['nhQuoteRequests'] else 'FAIL',code=e.code)
 except Exception as e:
  report.update(status='NOT_RUN' if not report['nhQuoteRequests'] else 'FAIL',code='OWNER_FUTURES_PROBE_FAILED')
  http=getattr(e,'http',None)
  if isinstance(http,int) and 100<=http<=599:report['http']=http
 finally:
  if token:
   try:client.call('logout');report['logout']='PASS'
   except Exception:report['logout']='NOT_VERIFIED'
  client.token=None
 return report

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--environment',type=Path,required=True);a=p.parse_args()
 try:
  env=private_path(a.environment,False);plan=json.loads((env/'fresh-plan.json').read_text());target(plan['scriptId']);match=re.fullmatch(r'https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec',plan['url'])
  if not match or match[1] in (OLD_DEPLOYMENT,PRODUCTION_DEPLOYMENT_ID) or plan.get('sheetHash') in (None,PRODUCTION_SHEET_HASH,fingerprint(OLD_SHEET)):raise Stop('ISOLATED_TARGET_REQUIRED')
  client=WebApp(plan['url']);client.binding=plan['sheetHash'];result=verify(client,plan,lambda:(getpass.getpass('Existing test user ID (hidden): '),getpass.getpass('Existing test password (hidden): ')))
 except Exception:result={'status':'NOT_RUN','code':'EXISTING_OWNER_ENVIRONMENT_REQUIRED','accountCalls':0,'orderCalls':0,'storeWrites':False,'credentialsIncluded':False}
 print(json.dumps(result));return 0 if result['status'] in ('PASS','PARTIAL') else 1
if __name__=='__main__':raise SystemExit(main())
