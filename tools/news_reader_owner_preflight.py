"""Owner Cloud Shell read-only news setup check. No key creation or deployment.
Google's existing CLI login is reused. Cloudflare credentials stay in memory.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

import calendar_owner_preflight as owner
import worker_code_only as worker

PROJECT='my-invest-v2-calendar'
READER='myinvest-news-reader@'+PROJECT+'.iam.gserviceaccount.com'
PREVIEW='myinvest-v2-private-original-preview'

class Stop(Exception):pass

def google_snapshot(run=subprocess.run):
    if not shutil.which('gcloud'):raise Stop('EXISTING_GOOGLE_CLOUD_SHELL_REQUIRED')
    # No Cloudflare or service-key values are passed to child processes.
    child={k:v for k,v in os.environ.items() if not re.search(r'TOKEN|PASSWORD|SECRET|API_KEY',k,re.I)}
    def read(args):
        try:r=run(['gcloud',*args,'--format=json','--quiet'],capture_output=True,text=True,timeout=45,env=child)
        except subprocess.TimeoutExpired:raise Stop('GOOGLE_READ_TIMEOUT') from None
        except OSError:raise Stop('GOOGLE_CLI_UNAVAILABLE') from None
        if r.returncode:raise Stop('EXISTING_GOOGLE_PROJECT_READ_ACCESS_REQUIRED')
        try:return json.loads(r.stdout)
        except ValueError:raise Stop('GOOGLE_METADATA_INVALID') from None
    accounts=read(['auth','list','--filter=status:ACTIVE'])
    if not isinstance(accounts,list) or len(accounts)!=1 or accounts[0].get('account')!='kocoro97@gmail.com':raise Stop('EXISTING_GOOGLE_OWNER_ACCOUNT_REQUIRED')
    project=read(['projects','describe',PROJECT])
    if project.get('projectId')!=PROJECT or project.get('lifecycleState')!='ACTIVE':raise Stop('EXISTING_GOOGLE_PROJECT_MISMATCH')
    account=read(['iam','service-accounts','describe',READER,'--project='+PROJECT])
    if account.get('email')!=READER or account.get('projectId')!=PROJECT or account.get('disabled',False) is not False:raise Stop('DEDICATED_READER_IDENTITY_MISMATCH')
    services=read(['services','list','--enabled','--project='+PROJECT,'--filter=config.name=drive.googleapis.com'])
    if not isinstance(services,list) or not any(r.get('config',{}).get('name')=='drive.googleapis.com' for r in services):raise Stop('DRIVE_API_NOT_ENABLED')
    policy=read(['projects','get-iam-policy',PROJECT])
    roles=[r.get('role') for r in policy.get('bindings',[]) if 'serviceAccount:'+READER in r.get('members',[])]
    if roles:raise Stop('DEDICATED_READER_PROJECT_ROLES_REQUIRE_REVIEW')
    keys=read(['iam','service-accounts','keys','list','--iam-account='+READER,'--project='+PROJECT,'--managed-by=user'])
    if not isinstance(keys,list):raise Stop('READER_KEY_METADATA_INVALID')
    return {'projectVerified':True,'dedicatedReaderVerified':True,'driveApiEnabled':True,
        'readerProjectRoles':0,'existingUserManagedKeyCount':len(keys)}

def cloud_snapshot(account,token,folder):
    if not re.fullmatch('[a-fA-F0-9]{32}',account or ''):raise Stop('CLOUDFLARE_ACCOUNT_ID_INVALID')
    raw=worker.api_client(token)
    primary='/accounts/'+account+'/workers/scripts/'+worker.NAME
    preview='/accounts/'+account+'/workers/scripts/'+PREVIEW
    allowed={primary+s for s in ('/settings','/secrets','/deployments','/versions')}
    allowed|={preview+'/settings','/accounts/'+account+'/workers/subdomain'}
    def read(path):
        if path not in allowed:raise Stop('READ_ONLY_SCOPE_DENIED')
        return raw('GET',path)
    current=owner.inspect(read,account,owner_dir=folder)
    try:settings=read(preview+'/settings')
    except worker.Stop as error:
        if error.http!=404:raise
        settings=None
    names={r.get('name'):r.get('type') for r in settings.get('bindings',[]) if isinstance(r,dict)} if settings else {}
    return {'primaryWorkerReadVerified':True,'primaryActiveVersion':current['activeVersion'],
        'primaryHasPendingVersion':not current['latestVersionIsActive'],
        'ownerBundleVerified':current['ownerCheckoutVerified'],
        'ownerBundleSourceMatches':current.get('ownerCheckoutInspection',{}).get('sourceRevisionMatches') is True,
        'privatePreviewExists':settings is not None,
        'newsSecretBindingsPresent':{name:names.get(name)=='secret_text' for name in
          ('MYINVEST_NEWS_READER_EMAIL','MYINVEST_NEWS_READER_PEM','MYINVEST_NEWS_FOLDER_ID')}}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-dir',type=Path,default=Path('/home/kocoro97/myinvest-v2-fresh-private-r2'))
    args=parser.parse_args()
    fixed={'mode':'NEWS_OWNER_READ_ONLY_PREFLIGHT','deploymentAttempted':False,'keyCreateCalls':0,
        'settingsWriteCalls':0,'secretWriteCalls':0,'folderPermissionWrites':0,'credentialsIncluded':False,
        'originalFileWrites':0,'nhCalls':0,'accountCalls':0,'orderCalls':0}
    try:
        if not sys.stdin.isatty():raise Stop('HIDDEN_OWNER_TERMINAL_REQUIRED')
        google=google_snapshot()
        account=getpass.getpass('Existing Cloudflare Account ID (hidden): ')
        if not re.fullmatch('[a-fA-F0-9]{32}',account):raise Stop('CLOUDFLARE_ACCOUNT_ID_INVALID')
        token=getpass.getpass('Existing Cloudflare API token (hidden): ')
        cloud=cloud_snapshot(account,token,args.owner_dir)
        report={**fixed,'status':'PASS','scope':'METADATA_AND_EXISTING_ACCESS_ONLY',**google,**cloud,
            'liveOriginalDisplay':'NOT_RUN','readyForActivation':False}
    except (Stop,worker.Stop,owner.Stop) as error:
        code=error.code if isinstance(error,(worker.Stop,owner.Stop)) else str(error)
        report={**fixed,'status':'NOT_RUN','code':code}
        if isinstance(error,(worker.Stop,owner.Stop)) and error.http:report['http']=error.http
    except (EOFError,KeyboardInterrupt):report={**fixed,'status':'NOT_RUN','code':'OWNER_INPUT_INTERRUPTED'}
    except Exception:report={**fixed,'status':'NOT_RUN','code':'OWNER_READ_ONLY_CHECK_FAILED'}
    print(json.dumps(report));return 0 if report['status']=='PASS' else 1

if __name__=='__main__':raise SystemExit(main())
