import io
import json
from email.message import Message
from pathlib import Path
import sys
import unittest
import urllib.request
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'tools'))
from relay.app import Config,RelayApp,GasGateway,GoogleContentRedirect,RelayFault,PRODUCTION_DEPLOYMENT,public_url
from nh_v2_relay_check import deployment_settings

URL='https://script.google.com/macros/s/SYNTHETIC_RELAY_GAS_123456789/exec'
ORIGIN='https://synthetic-dashboard.example'
TOKEN='a'*64
EXPECTED={'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':'a'*64,'sheetHash':'b'*64,'sourceDigest':'c'*64,'gatewayVersion':2,'storeEngine':'account-store-v2'}

def configuration(**kwargs):return Config(**(dict(upstream=URL,origins=frozenset({ORIGIN}),expected=EXPECTED)|kwargs))
class FakeGateway:
    def __init__(self):self.calls=[];self.ready=True;self.failure=None
    def verify(self):
        if not self.ready:raise RelayFault('RELAY_TARGET_MISMATCH',503)
    def post(self,payload):
        self.calls.append(payload)
        if self.failure:raise self.failure
        return {'success':True,'value':'SYNTHETIC_CANARY_NOT_LOGGED'}
    def public(self,url,token):self.calls.append({'action':'publicFetch'});return '{"public":true}'

def request(app,payload=None,origin=ORIGIN,method='POST',authorization=None,**changes):
    raw=json.dumps(payload or {'action':'appVersion'}).encode()
    env={'PATH_INFO':'/api','QUERY_STRING':'','REQUEST_METHOD':method,'HTTP_ORIGIN':origin,'CONTENT_TYPE':'application/json','CONTENT_LENGTH':str(len(raw)),'wsgi.input':io.BytesIO(raw)}
    if authorization:env['HTTP_AUTHORIZATION']=authorization
    env.update(changes);result={}
    def start(status,headers):result.update(status=int(status.split()[0]),headers=dict(headers))
    body=b''.join(app(env,start));result['body']=json.loads(body) if body else None;return result

class RelayTests(unittest.TestCase):
    def setUp(self):self.g=FakeGateway();self.app=RelayApp(configuration(),self.g)
    def test_real_cors_preflight_has_explicit_origin_methods_headers_and_no_upstream(self):
        r=request(self.app,method='OPTIONS',HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',HTTP_ACCESS_CONTROL_REQUEST_HEADERS='authorization,content-type')
        self.assertEqual(r['status'],204);self.assertEqual(r['headers']['Access-Control-Allow-Origin'],ORIGIN);self.assertIn('Authorization',r['headers']['Access-Control-Allow-Headers']);self.assertEqual(self.g.calls,[])
    def test_unapproved_origins_and_credentials_headers_fail_closed(self):
        for origin in ('null','https://evil.example',''):
            r=request(self.app,origin=origin);self.assertEqual(r['status'],403);self.assertNotIn('Access-Control-Allow-Origin',r['headers'])
        self.assertEqual(request(self.app,method='OPTIONS',HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',HTTP_ACCESS_CONTROL_REQUEST_HEADERS='x-private-header')['status'],403)
        self.assertEqual(self.g.calls,[])
    def test_unauthenticated_protected_requests_stop_before_upstream(self):
        r=request(self.app,{'action':'sessionInfo'});self.assertEqual(r['status'],401);self.assertEqual(self.g.calls,[])
    def test_session_token_is_forwarded_in_body_only_to_fixed_gas(self):
        r=request(self.app,{'action':'sessionInfo'},authorization='Bearer '+TOKEN)
        self.assertEqual(r['status'],200);self.assertEqual(self.g.calls,[{'action':'sessionInfo','token':TOKEN}]);self.assertEqual(r['headers']['Cache-Control'],'no-store');self.assertNotIn('Access-Control-Allow-Credentials',r['headers'])
    def test_current_auth_only_profile_blocks_every_nh_store_and_proxy_action(self):
        for action in ('nhAccounts','nhQuotes','nhStockQuotes','publicFetch','saveExternalHoldings','register','nhSnapshotCapture','nhSnapshotRestore','order','nhTestToken'):
            self.assertIn(request(self.app,{'action':action},authorization='Bearer '+TOKEN)['status'],(400,403))
        self.assertEqual(self.g.calls,[])
    def test_wrong_target_prevents_password_forwarding(self):
        self.g.ready=False;r=request(self.app,{'action':'login','user':'synthetic','pass':'SYNTHETIC_PRIVATE_PASSWORD'})
        self.assertEqual(r['status'],503);self.assertEqual(self.g.calls,[]);self.assertNotIn('SYNTHETIC',json.dumps(r['body']))
    def test_bad_payload_route_and_form_requests_never_reach_upstream(self):
        for changes in ({'PATH_INFO':'/other'},{'QUERY_STRING':'token=synthetic'},{'CONTENT_TYPE':'text/plain'},{'CONTENT_LENGTH':'200001'}):
            self.assertNotEqual(request(self.app,**changes)['status'],200)
        for body in ({'action':'appVersion','token':TOKEN},{'action':'login','backendUrl':'https://evil.example'},{'action':[]}):self.assertEqual(request(self.app,body)['status'],400)
        self.assertEqual(self.g.calls,[])
    def test_failed_mutation_is_never_retried_and_outcome_is_not_reported_as_unsaved(self):
        app=RelayApp(configuration(auth_only=False),self.g);self.g.failure=RelayFault('RELAY_GOOGLE_CONTENT_400')
        r=request(app,{'action':'saveExternalHoldings','expectedRevision':'synthetic','confirmReplace':True,'holdings':[]},authorization='Bearer '+TOKEN)
        self.assertEqual(r['status'],502);self.assertEqual(r['body']['code'],'RELAY_WRITE_OUTCOME_UNKNOWN');self.assertEqual(len(self.g.calls),1)
    def test_unknown_upstream_exception_is_not_echoed(self):
        self.g.failure=RuntimeError('SYNTHETIC_PRIVATE_TOKEN')
        r=request(self.app,{'action':'login','user':'synthetic','pass':'synthetic'})
        self.assertEqual(r['status'],502);self.assertNotIn('SYNTHETIC_PRIVATE',json.dumps(r))
    def test_full_profile_preserves_duplicate_requests_for_gas_revision_guard_no_automatic_retry(self):
        app=RelayApp(configuration(auth_only=False),self.g)
        for _ in range(2):request(app,{'action':'externalHoldings'},authorization='Bearer '+TOKEN)
        self.assertEqual(len(self.g.calls),2)
    def test_production_target_and_wildcard_origins_are_not_silently_accepted(self):
        for changes in ({'upstream':'https://script.google.com/macros/s/'+PRODUCTION_DEPLOYMENT+'/exec'}, {'origins':frozenset({'*'})},{'origins':frozenset({ORIGIN+'\n'})},{'origins':frozenset({' '+ORIGIN})},{'isolated':False}):
            with self.assertRaises(RelayFault):configuration(**changes)
    def test_public_fetch_cannot_call_nh_or_private_hosts(self):
        for url in ('http://stock.naver.com/','https://api.nhplug.com:8443/order','https://127.0.0.1/','https://stock.naver.com.evil.example/','https://user:pass@stock.naver.com/'):
            with self.assertRaises(RelayFault):public_url(url)

class RedirectTests(unittest.TestCase):
    def test_signed_content_url_is_not_reencoded_and_no_body_or_auth_is_replayed(self):
        target='https://script.googleusercontent.com/macros/echo?user_content_key=A%2BB%3D+X&lib=public'
        original=urllib.request.Request(URL,data=b'SYNTHETIC_PRIVATE_PASSWORD',headers={'Authorization':'SYNTHETIC_PRIVATE_TOKEN','Content-Type':'text/plain'},method='POST')
        next_request=GoogleContentRedirect().redirect_request(original,None,302,'',{},target)
        self.assertEqual(next_request.full_url,target);self.assertEqual(next_request.get_method(),'GET');self.assertIsNone(next_request.data);self.assertIsNone(next_request.get_header('Authorization'))
    def test_auth_redirect_and_307_post_replay_are_denied(self):
        original=urllib.request.Request(URL,data=b'synthetic',method='POST')
        for status,target in [(302,'https://accounts.google.com/login'),(302,'http://script.googleusercontent.com/macros/echo'),(307,'https://script.googleusercontent.com/macros/echo'),(302,'https://evil.example/')]:
            with self.assertRaises(RelayFault):GoogleContentRedirect().redirect_request(original,None,status,'',{},target)
    def test_metadata_fingerprint_mismatch_is_not_a_success(self):
        gateway=GasGateway(configuration());gateway.post=lambda payload:dict(EXPECTED,success=True,sheetHash='d'*64)
        with self.assertRaisesRegex(RelayFault,'RELAY_TARGET_MISMATCH'):gateway.verify()
    def test_non_json_200_is_not_a_communication_success(self):
        class Response:
            status=200
            headers=Message()
            headers['Content-Type']='text/html'
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def geturl(self):return URL
            def read(self,n):return b'<html>SYNTHETIC_PRIVATE_BODY</html>'
        class Opener:
            def open(self,*args,**kwargs):return Response()
        with self.assertRaisesRegex(RelayFault,'RELAY_NON_JSON'):GasGateway(configuration(),Opener()).post({'action':'appVersion'})

class DeploymentMetadataTests(unittest.TestCase):
    def test_real_api_fields_are_compared_not_manifest_guessed(self):
        plan={'scriptId':'SYNTHETIC_SCRIPT','url':URL,'activeVersion':2};dep=URL.split('/')[-2]
        resource={'deploymentId':dep,'deploymentConfig':{'scriptId':plan['scriptId'],'versionNumber':2},'entryPoints':[{'entryPointType':'WEB_APP','webApp':{'url':URL,'entryPointConfig':{'executeAs':'USER_DEPLOYING','access':'ANYONE_ANONYMOUS'}}}]}
        self.assertEqual(deployment_settings(plan,lambda url:resource)['status'],'PASS')
        resource['entryPoints'][0]['webApp']['entryPointConfig']['executeAs']='USER_ACCESSING'
        self.assertEqual(deployment_settings(plan,lambda url:resource)['status'],'FAIL')
    def test_no_permission_is_not_a_pass_or_a_source_dump(self):
        result=deployment_settings({'url':URL,'scriptId':'synthetic'},lambda url:(_ for _ in ()).throw(Exception('SYNTHETIC_PRIVATE_TOKEN')))
        self.assertEqual(result['status'],'NOT_RUN');self.assertNotIn('SYNTHETIC_PRIVATE',json.dumps(result))
