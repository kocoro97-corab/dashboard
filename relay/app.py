"""Fixed-upstream authenticated GAS relay. All logs and errors exclude request data.

Production infrastructure is not created by this module. Authentication remains
GAS-authoritative; Origin validation is CSRF/CORS policy, not authentication.
"""
from dataclasses import dataclass
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

PRODUCTION_DEPLOYMENT='AKfycbxySfUKUai418Ar7C8RI6gwBJpjSZXH4y8EX2JhJZG9nGz7RVB0WCZGl3H1wHxOWGVd'
AUTH_ACTIONS=frozenset({'appVersion','login','sessionInfo','logout'})
PUBLIC_ACTIONS=frozenset({'appVersion','login','register'})
ACTIONS=PUBLIC_ACTIONS|{'sessionInfo','logout','changePassword','protectedHoldings','getPendingUsers','approveUser',
    'nhAccounts','nhQuotes','nhStockQuotes','nhExternalQuotes','externalDriveImages','externalHoldings','externalHistory',
    'saveExternalHoldings','restoreExternalHoldings','publicFetch'}
WRITES=frozenset({'register','changePassword','approveUser','saveExternalHoldings','restoreExternalHoldings'})
PUBLIC_HOSTS=frozenset({'finance.daum.net','polling.finance.naver.com','stock.naver.com','m.stock.naver.com',
                        'query1.finance.yahoo.com','finance.yahoo.com','news.google.com'})
LIMIT=200000

class RelayFault(Exception):
    def __init__(self,code,status=502):self.code=code;self.status=status;super().__init__(code)


def valid_origin(value,development=False):
    if not isinstance(value,str) or re.search(r'[\x00-\x20\\]',value):return False
    try:p=urllib.parse.urlsplit(value);port=p.port
    except ValueError:return False
    return bool(p.hostname and not p.username and not p.password and not p.query and not p.fragment and p.path==''
                and (p.scheme=='https' or development and p.scheme=='http' and p.hostname in ('127.0.0.1','localhost'))
                and port!=0 and '*' not in value and p.netloc==p.hostname+((':'+str(port)) if port else ''))

@dataclass(frozen=True)
class Config:
    upstream:str
    origins:frozenset
    expected:dict
    auth_only:bool=True
    isolated:bool=True
    production_authorized:bool=False
    development:bool=False
    def __post_init__(self):
        match=re.fullmatch(r'https://script\.google\.com/macros/s/([A-Za-z0-9_-]+)/exec',self.upstream)
        if not match or not self.origins or any(not valid_origin(x,self.development) for x in self.origins):raise RelayFault('RELAY_CONFIG_INVALID',503)
        if not self.isolated and not self.production_authorized:raise RelayFault('RELAY_PRODUCTION_NOT_APPROVED',503)
        if self.isolated:
            if match[1]==PRODUCTION_DEPLOYMENT or self.expected.get('freshTestEnvironment') is not True or self.expected.get('testEnvironment')!='nh-staging':raise RelayFault('RELAY_ISOLATION_REQUIRED',503)
            if any(not re.fullmatch(r'[a-f0-9]{64}',str(self.expected.get(k,''))) for k in ('scriptHash','sheetHash','sourceDigest')):raise RelayFault('RELAY_ISOLATION_REQUIRED',503)
        if self.expected.get('gatewayVersion')!=2 or self.expected.get('storeEngine')!='account-store-v2':raise RelayFault('RELAY_V2_REQUIRED',503)


def public_url(value):
    if not isinstance(value,str) or len(value)>4096 or re.search(r'[\x00-\x20\\]',value):raise RelayFault('RELAY_PUBLIC_URL_DENIED',400)
    try:p=urllib.parse.urlsplit(value);port=p.port
    except ValueError:raise RelayFault('RELAY_PUBLIC_URL_DENIED',400) from None
    if p.scheme!='https' or p.hostname not in PUBLIC_HOSTS or port not in (None,443) or p.username or p.password or p.fragment:raise RelayFault('RELAY_PUBLIC_URL_DENIED',400)
    return value

class GoogleContentRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections=3
    max_repeats=1
    def redirect_request(self,request,fp,code,message,headers,url):
        try:p=urllib.parse.urlsplit(url);port=p.port
        except ValueError:raise RelayFault('RELAY_REDIRECT_DENIED') from None
        if p.hostname=='accounts.google.com':raise RelayFault('RELAY_GAS_ACCESS_REQUIRED')
        # Never send password/token bodies to redirect destinations. ContentService
        # supplies a one-time GET URL; preserve its original signed query bytes.
        if p.scheme!='https' or p.hostname!='script.googleusercontent.com' or p.path!='/macros/echo' or port not in (None,443) or p.username or p.password or p.fragment:raise RelayFault('RELAY_REDIRECT_DENIED')
        if code not in (301,302,303) or request.get_method() not in ('GET','POST'):raise RelayFault('RELAY_REDIRECT_METHOD_DENIED')
        return urllib.request.Request(url,headers={'Accept':'*/*'},method='GET',unverifiable=True)

class GasGateway:
    def __init__(self,config,opener=None):
        self.config=config;self.opener=opener or urllib.request.build_opener(GoogleContentRedirect());self.until=0;self.lock=threading.Lock()
    def _read(self,request,want_json=True):
        try:
            with self.opener.open(request,timeout=120) as response:
                final=urllib.parse.urlsplit(response.geturl())
                if final.scheme!='https' or final.hostname not in ('script.google.com','script.googleusercontent.com'):raise RelayFault('RELAY_REDIRECT_DENIED')
                if response.status!=200:raise RelayFault('RELAY_UPSTREAM_HTTP')
                raw=response.read(50*1024*1024+1)
                if len(raw)>50*1024*1024:raise RelayFault('RELAY_RESPONSE_TOO_LARGE')
                if want_json:
                    if response.headers.get_content_type()!='application/json':raise RelayFault('RELAY_NON_JSON')
                    result=json.loads(raw)
                    if not isinstance(result,dict) or type(result.get('success')) is not bool:raise RelayFault('RELAY_RESPONSE_INVALID')
                    return result
                return raw.decode('utf-8')
        except RelayFault:raise
        except urllib.error.HTTPError as error:
            role=urllib.parse.urlsplit(error.geturl()).hostname;status=error.code;error.close()
            raise RelayFault('RELAY_GOOGLE_CONTENT_400' if role=='script.googleusercontent.com' and status==400 else 'RELAY_UPSTREAM_HTTP') from None
        except Exception:raise RelayFault('RELAY_UPSTREAM_NETWORK') from None
    def post(self,payload):
        body=dict(payload)
        if self.config.isolated:body['stagingBinding']=self.config.expected['sheetHash']
        request=urllib.request.Request(self.config.upstream,data=json.dumps(body).encode(),headers={'Content-Type':'text/plain;charset=utf-8'},method='POST')
        return self._read(request)
    def verify(self):
        if time.monotonic()<self.until:return
        with self.lock:
            if time.monotonic()<self.until:return
            data=self.post({'action':'appVersion'})
            if data.get('success') is not True or any(data.get(k)!=v for k,v in self.config.expected.items()):raise RelayFault('RELAY_TARGET_MISMATCH',503)
            self.until=time.monotonic()+30
    def public(self,url,token):
        check=self.post({'action':'sessionInfo','token':token})
        if check.get('success') is not True:raise RelayFault('AUTH_REQUIRED',401)
        request=urllib.request.Request(self.config.upstream+'?url='+urllib.parse.quote(public_url(url),safe=''),method='GET')
        return self._read(request,False)

class RelayApp:
    def __init__(self,config,gateway=None):
        self.config=config;self.gateway=gateway or GasGateway(config);self.metrics={'preflights':0,'upstreamAttempts':{}};self.metrics_lock=threading.Lock()
    def __call__(self,environ,start_response):
        origin=environ.get('HTTP_ORIGIN','');allowed=origin in self.config.origins
        headers=[('Content-Type','application/json;charset=utf-8'),('Cache-Control','no-store'),('Pragma','no-cache'),
                 ('Vary','Origin'),('X-Content-Type-Options','nosniff')]
        if allowed:headers.append(('Access-Control-Allow-Origin',origin))
        def send(status,value):
            data=json.dumps(value,separators=(',',':')).encode()
            start_response(str(status)+' '+{200:'OK',204:'No Content',400:'Bad Request',401:'Unauthorized',403:'Forbidden',404:'Not Found',405:'Method Not Allowed',413:'Payload Too Large',415:'Unsupported Media Type',502:'Bad Gateway',503:'Service Unavailable'}.get(status,'Error'),headers+[('Content-Length',str(len(data)) if status!=204 else '0')])
            return [data] if status!=204 else []
        action=None;attempted=False
        try:
            if environ.get('PATH_INFO')!='/api' or environ.get('QUERY_STRING'):raise RelayFault('RELAY_PATH_DENIED',404)
            if not allowed:raise RelayFault('RELAY_ORIGIN_DENIED',403)
            method=environ.get('REQUEST_METHOD')
            if method=='OPTIONS':
                requested={x.strip().lower() for x in environ.get('HTTP_ACCESS_CONTROL_REQUEST_HEADERS','').split(',') if x.strip()}
                if environ.get('HTTP_ACCESS_CONTROL_REQUEST_METHOD')!='POST' or requested-{'content-type','authorization'}:raise RelayFault('RELAY_PREFLIGHT_DENIED',403)
                with self.metrics_lock:self.metrics['preflights']+=1
                headers.extend([('Access-Control-Allow-Methods','POST, OPTIONS'),('Access-Control-Allow-Headers','Content-Type, Authorization')])
                return send(204,{})
            if method!='POST':raise RelayFault('RELAY_METHOD_DENIED',405)
            if environ.get('CONTENT_TYPE','').split(';')[0].strip().lower()!='application/json':raise RelayFault('RELAY_CONTENT_TYPE',415)
            length=int(environ.get('CONTENT_LENGTH') or '0')
            if length<=0 or length>LIMIT:raise RelayFault('RELAY_REQUEST_SIZE',413)
            raw=environ['wsgi.input'].read(length)
            if len(raw)!=length:raise RelayFault('RELAY_BAD_REQUEST',400)
            try:payload=json.loads(raw)
            except Exception:raise RelayFault('RELAY_BAD_REQUEST',400) from None
            if not isinstance(payload,dict) or any(k in payload for k in ('token','stagingBinding','backendUrl','gasUrl','targetUrl')):raise RelayFault('RELAY_BAD_REQUEST',400)
            action=payload.get('action')
            if not isinstance(action,str) or action not in ACTIONS:raise RelayFault('RELAY_ACTION_DENIED',400)
            if self.config.auth_only and action not in AUTH_ACTIONS:raise RelayFault('RELAY_SCOPE_BLOCKED',403)
            if action not in PUBLIC_ACTIONS:
                match=re.fullmatch(r'Bearer ([a-fA-F0-9]{64})',environ.get('HTTP_AUTHORIZATION',''))
                if not match:raise RelayFault('AUTH_REQUIRED',401)
                payload['token']=match[1]
            elif environ.get('HTTP_AUTHORIZATION'):raise RelayFault('RELAY_BAD_REQUEST',400)
            if action=='publicFetch':public_url(payload.get('url'))
            self.gateway.verify()
            attempted=True
            with self.metrics_lock:self.metrics['upstreamAttempts'][action]=self.metrics['upstreamAttempts'].get(action,0)+1
            result={'success':True,'text':self.gateway.public(payload['url'],payload['token'])} if action=='publicFetch' else self.gateway.post(payload)
            return send(200,result)
        except RelayFault as error:
            code='RELAY_WRITE_OUTCOME_UNKNOWN' if attempted and action in WRITES else error.code
            return send(error.status,{'success':False,'code':code,'layer':'relay'})
        except Exception:
            return send(502,{'success':False,'code':'RELAY_WRITE_OUTCOME_UNKNOWN' if attempted and action in WRITES else 'RELAY_BAD_RESPONSE','layer':'relay'})


def from_environment():
    try:
        profile=os.environ.get('MYINVEST_RELAY_PROFILE','isolated')
        auth=os.environ.get('MYINVEST_AUTH_ONLY','true')
        if profile not in ('isolated','production') or auth not in ('true','false'):raise ValueError()
        isolated=profile=='isolated'
        config=Config(upstream=os.environ['MYINVEST_GAS_URL'],origins=frozenset(os.environ['MYINVEST_ALLOWED_ORIGINS'].split(',')),
                      expected=json.loads(os.environ['MYINVEST_EXPECTED_METADATA']),auth_only=auth=='true',
                      isolated=isolated,production_authorized=os.environ.get('MYINVEST_ALLOW_PRODUCTION')=='explicitly-approved')
        return RelayApp(config)
    except Exception:raise RuntimeError('RELAY_CONFIG_INVALID') from None
