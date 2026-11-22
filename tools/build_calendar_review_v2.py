"""MY INVEST V2 temporary calendar review artifact, never a live deployment.

Builds the pre-existing Codex developer artifact first. Only a temporary
local output receives the new calendar scripts. Google OAuth uses a PUBLIC
Web Client ID ONLY when explicitly supplied. No private secrets are read.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil

from build_dev_pages import build as build_original

ROOT=Path(__file__).resolve().parents[1]
FILES=(
 'invest-calendar-core-v2.js',
 'invest-calendar-style-v2.js',
 'invest-calendar-google-readonly-v2.js',
 'invest-calendar-workspace-v2.js'
)
GOOGLE_CLIENT_RE=re.compile(r'^[0-9]{8,32}-[A-Za-z0-9_-]{12,80}\.apps\.googleusercontent\.com$')

def build_calendar_review(output, *, root=ROOT, relay_endpoint=None,
                          google_client_id=None):
 output=Path(output)
 build_original(output,root=root,relay_endpoint=relay_endpoint,
                use_public_config=False)
 html=(output/'index.html').read_text()
 matches=list(re.finditer(r'<script src="js/page-news\.js\?v=2[^"]*"></script>',html))
 if len(matches)!=1 or '<script src="js/app-shell.js?v=2' not in html:
  raise ValueError('CALENDAR_INJECTION_ANCHOR_CHANGED')
 if 'invest-calendar-workspace-v2.js' in html:
  raise ValueError('CALENDAR_ALREADY_ATTACHED')
 if google_client_id is not None and not GOOGLE_CLIENT_RE.fullmatch(google_client_id):
  raise ValueError('GOOGLE_PUBLIC_OAUTH_CLIENT_ID_INVALID')
 for name in FILES:
  source=root/'js'/name
  if not source.is_file() or source.is_symlink():
   raise ValueError('CALENDAR_MODULE_UNAVAILABLE')
  dest=output/'js'/name
  if dest.exists():raise ValueError('CALENDAR_ASSET_COLLISION')
  shutil.copyfile(source,dest)
 snippets=''
 if google_client_id:
  # API token is obtained only by explicit user consent in their browser.
  # OAuth client ID is NOT a client secret or Google Calendar user token.
  snippets='<script>window.MYINVEST_GOOGLE_CALENDAR_CLIENT_ID=' + json.dumps(google_client_id) + ';</script>\n'
  snippets+='<script src="https://accounts.google.com/gsi/client"></script>\n'
  html=html.replace("script-src 'self' ","script-src 'self' https://accounts.google.com ")
  html=html.replace("connect-src 'self' data:","connect-src 'self' https://www.googleapis.com data:")
  html=html.replace("frame-src https://s.tradingview.com;","frame-src https://s.tradingview.com https://accounts.google.com;")
 snippets+=''.join('<script src="js/'+name+'?review=calendar-v2"></script>\n'
                   for name in FILES)
 at=matches[0].end()
 html=html[:at]+'\n'+snippets+html[at:]
 (output/'index.html').write_text(html)
 metaFile=output/'development-only.json'
 meta=json.loads(metaFile.read_text())
 meta['calendarReview']='LOCAL_MANUAL_AND_OPTIONAL_GOOGLE_READ_ONLY'
 meta['googleOAuthClientConfigured']=bool(google_client_id)
 meta['googleScope']='calendar.events.readonly'
 meta['googleEventWrites']=False
 meta['calendarGASWrites']=False
 meta['calendarNHCalls']=False
 meta['published']=False
 metaFile.write_text(json.dumps(meta,sort_keys=True))
 manifest={p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
           for p in sorted(output.rglob('*')) if p.is_file()
           and p.name!='asset-manifest.json'}
 (output/'asset-manifest.json').write_text(json.dumps(manifest,sort_keys=True))
 return manifest
