"""Full owner activation adapter simulation. No real credentials or network."""
import copy,io,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tools'))
import calendar_connection_activate as m
OLD='11111111-1111-1111-1111-111111111111';NEW='22222222-2222-2222-2222-222222222222'

class Simulation:
    def __init__(self,root,fault=None):
        self.root=root;self.fault=fault;self.owner=root/'owner';self.owner.mkdir();self.script='SYNTHETIC_OWNER_SCRIPT_0123456789';self.oldrev='1'*40;self.newrev='2'*40;self.original={'Security':'unchanged-hour-security','StagingBridge':"const NH_STAGING_SCRIPT_ID='"+self.script+"';\nfunction stagingProjectGuard_(){}",'appsscript':'{}'};self.desired={**self.original,'StagingBridge':self.original['StagingBridge']+'\n// calendar metadata','CalendarIdentityBridge':'synthetic calendar helper'};self.head=copy.deepcopy(self.original);self.gasversion=1;self.gasversions={1:copy.deepcopy(self.original)};self.active=OLD;self.latest=OLD;self.calls=[];self.configured=False;self.ownerprops={};self.candidate_code=None;self.candidate_meta=None;self.username='SYNTHETIC_APP_OWNER';self.password='SYNTHETIC_APP_PASSWORD_NOT_GOOGLE';self.plan={'scriptId':self.script,'revision':self.oldrev,'sourceDigest':'c'*64,'sheetHash':'b'*64,'url':'https://script.google.com/macros/s/SYNTHETIC_OWNER_DEPLOYMENT_0123456789/exec','activeVersion':1};(self.owner/'fresh-plan.json').write_text(json.dumps(self.plan));self.write(self.owner/'bundle',self.original)
        self.bindings=[{'name':'MYINVEST_ROLE','type':'plain_text','text':m.worker.ROLE},{'name':'GATE','type':'durable_object_namespace','class_name':'RelayGate','namespace_id':'existing-test-namespace'},{'name':'MYINVEST_EXPECTED_METADATA','type':'secret_text'},{'name':'GOOGLE_CALENDAR_CLIENT_ID','type':'plain_text','text':'synthetic-client.apps.googleusercontent.com'},{'name':'GOOGLE_CALENDAR_CLIENT_SECRET','type':'secret_text'}];self.settings={'compatibility_date':'2026-11-01','compatibility_flags':[],'observability':{'enabled':False},'bindings':self.bindings}

    def write(self,folder,modules):
        folder.mkdir(parents=True,exist_ok=True);(folder/'.clasp.json').write_text(json.dumps({'scriptId':self.script,'rootDir':'.'}))
        for name,text in modules.items():(folder/(name+('.json' if name=='appsscript' else '.gs'))).write_text(text)

    def meta(self):
        return {'success':True,'freshTestEnvironment':True,'testEnvironment':'nh-staging','scriptHash':m.digest(self.script.encode()),'sheetHash':'b'*64,'sourceDigest':('d' if self.gasversion>1 else 'c')*64,'revision':self.newrev if self.gasversion>1 else self.oldrev,'gatewayVersion':2,'storeEngine':'account-store-v2','storeVersion':2,'sessionIdleMs':3600000,**({'calendarIdentityVersion':1,'calendarIdentityConfigured':self.configured} if self.gasversion>1 else {})}

    def public(self):
        if self.active==OLD and self.gasversion>1:raise m.Stop('SYNTHETIC_OLD_BINDING_MISMATCH')
        return {**self.meta(),**({'developmentGoogleCalendarOverlayVersion':1,'developmentGoogleCalendarReadOnly':True} if self.active==NEW else {})}

    def getsettings(self):
        if self.active==OLD:return copy.deepcopy(self.settings)
        result=copy.deepcopy(self.settings);result['compatibility_flags']=['nodejs_compat'];old={r['name']:r for r in self.bindings};result['bindings']=[old[r['name']] if r['type']=='inherit' else r for r in self.candidate_meta['bindings']]
        if self.fault=='unrelated-settings':result['observability']['enabled']=True
        return result

    def api(self,method,path,body=None,kind=None):
        self.calls.append((method,path))
        if path.endswith('/subdomain'):return {'subdomain':'kocoro97'}
        if path.endswith('/settings'):return self.getsettings()
        if path.endswith('/secrets'):return [r for r in self.getsettings()['bindings'] if r['type']=='secret_text']
        if path.endswith('/deployments'):
            if method=='GET':return {'deployments':[{'id':'deployment-'+self.active,'versions':[{'version_id':self.active,'percentage':100}]}]}
            self.active=body['versions'][0]['version_id']
            if self.active==NEW and self.fault=='activate-timeout':raise m.worker.Stop('CLOUDFLARE_RESULT_UNCONFIRMED')
            return {}
        if path.endswith('/versions') and method=='GET':return {'items':[{'id':OLD,'number':1}]+([{'id':NEW,'number':2}] if self.latest==NEW else [])}
        if path.endswith('/versions?bindings_inherit=strict'):
            from email.parser import BytesParser
            from email.policy import default
            parts=list(BytesParser(policy=default).parsebytes(('Content-Type: '+kind+'\r\n\r\n').encode()+body).iter_parts());self.candidate_meta=json.loads(parts[0].get_payload(decode=True));self.candidate_code=parts[1].get_payload(decode=True);self.latest=NEW
            if self.fault=='concurrent-source':self.head={'Security':'another actor source','appsscript':'{}'}
            return {'id':NEW}
        if path.endswith('/content/v2'):return {'body':self.candidate_code if self.latest==NEW else b'current legacy code','contentType':'application/javascript','entrypoint':'worker.mjs'}
        raise AssertionError('Unexpected scoped API route')

    def clasp(self,args,folder,script):
        self.assert_script(script)
        if args[0]=='list-deployments':return json.dumps([{'deploymentId':self.plan['url'].split('/')[-2],'versionNumber':self.gasversion}])
        if args[0]=='push':self.head=m.logical(folder);return '{}'
        if args[0]=='create-version':self.gasversions[2]=copy.deepcopy(self.head);return '{"versionNumber":2}'
        if args[0]=='update-deployment':self.gasversion=int(args[3]);return '{}'
        raise AssertionError('Unexpected GAS command')

    def assert_script(self,script):
        if script!=self.script:raise AssertionError('Wrong target')

    def pull(self,client,folder,script,version=None):
        self.assert_script(script);modules=self.gasversions[version] if version else self.head;self.write(folder,modules);return copy.deepcopy(modules)

    def web(self,url):
        sim=self
        class Web:
            token=None;binding=None
            def call(self,action,**values):
                sim.calls.append(('APP',action))
                if action=='appVersion':return sim.meta()
                if action=='login':
                    if values!={'user':sim.username,'pass':sim.password}:raise AssertionError('Wrong app credentials')
                    return {'success':True,'isAdmin':True,'token':'a'*64}
                if action=='logout':return {'success':True}
                if action=='calendarOwnerConfigureIdentityV1':
                    if sim.fault=='configure':raise m.Stop('SYNTHETIC_CONFIGURE_REJECTED')
                    sim.configured=True;sim.ownerprops=values;return {'success':True,'propertiesChanged':True,'bridgeKeyHash':m.digest(values['bridgeKey'].encode()),'userKeyHash':m.digest(values['userKey'].encode())}
                raise AssertionError('Forbidden application action')
        return Web()

    def execute(self):
        sim=self
        def build(script,rev,folder):self.write(folder,self.desired)
        def compile(legacy,output,folder):
            if legacy.read_bytes()!=b'current legacy code':raise AssertionError('Original code replaced')
            output.write_bytes(b'preserved legacy plus calendar')
        class Opener:
            def open(self,req,timeout=None):
                if json.loads(req.data)!={'action':'googleCalendarStatus'}:raise AssertionError('Forbidden live action')
                if sim.fault=='status':return io.BytesIO(b'{"success":false}')
                return io.BytesIO(b'{"success":true,"connected":false,"readOnly":true}')
        with patch.object(m,'private_path',side_effect=lambda path,new:Path(path).resolve()),patch.object(m,'ensure_history'),patch.object(m,'revision',return_value=self.newrev),patch.object(m,'source_digest',return_value='d'*64),patch.object(m.gas,'historical_bundle',return_value=(self.original,'c'*64)),patch.object(m,'scoped_api',return_value=self.api),patch.object(m,'build',side_effect=build),patch.object(m,'compile_worker',side_effect=compile),patch.object(m,'public',side_effect=self.public),patch.object(m.check,'public_probe',side_effect=self.public),patch.object(m.check,'inspect',return_value={'ownerCheckoutVerified':True,'ownerCheckoutInspection':{'sourceRevisionMatches':True}}),patch.object(m,'WebApp',side_effect=self.web),patch.object(m,'pull',side_effect=self.pull),patch.object(m.gas,'upgrade_clasp',side_effect=self.clasp),patch.object(m.urllib.request,'build_opener',return_value=Opener()):
            return m.apply(self.owner,'a'*32,'SYNTHETIC_CF_TOKEN',self.username,self.password)


class CalendarActivationSimulationTest(unittest.TestCase):
    def test_complete_private_activation_preserves_hour_source_and_google_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            sim=Simulation(Path(tmp));report=sim.execute();self.assertEqual(report['status'],'PASS');self.assertEqual(sim.active,NEW);self.assertEqual(sim.gasversion,2);self.assertEqual(m.logical(sim.owner/'bundle'),sim.desired);self.assertEqual(json.loads((sim.owner/'fresh-plan.json').read_text())['revision'],sim.newrev);self.assertEqual(report['configurationPropertyWrites'],3);self.assertFalse(report['googleClientValuesOverwritten']);self.assertEqual(report['temporarySessionLogout'],'PASS');self.assertNotIn(sim.password,json.dumps(report));self.assertEqual([a for method,a in sim.calls if method=='APP' and a=='login'],['login']);self.assertFalse(any('nhAccounts' in path or 'order' in path for _,path in sim.calls))

    def test_config_status_and_activation_failures_restore_original_core(self):
        for fault in ['configure','status','activate-timeout','unrelated-settings']:
            with tempfile.TemporaryDirectory() as tmp:
                sim=Simulation(Path(tmp),fault);report=sim.execute();self.assertEqual(report['status'],'FAIL',fault);self.assertEqual(report['recovery'],'PASS_PREVIOUS_CONNECTION_RESTORED',fault);self.assertEqual(sim.active,OLD);self.assertEqual(sim.gasversion,1);self.assertEqual(sim.head,sim.original);self.assertEqual(m.logical(sim.owner/'bundle'),sim.original);self.assertEqual(json.loads((sim.owner/'fresh-plan.json').read_text()),sim.plan)

    def test_unrelated_concurrent_gas_head_is_not_overwritten_by_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            sim=Simulation(Path(tmp),'concurrent-source');report=sim.execute();self.assertEqual(report['status'],'FAIL');self.assertEqual(report['recovery'],'OWNER_REVIEW_REQUIRED_NO_BLIND_ROLLBACK');self.assertEqual(sim.head['Security'],'another actor source');self.assertEqual(sim.active,OLD)

if __name__=='__main__':unittest.main()
