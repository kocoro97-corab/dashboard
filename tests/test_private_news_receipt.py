"""Synthetic diagnostics and key-propagation checks. Never uses real credentials or network."""
import hashlib,json,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import deploy_private_news_reader as m

class ReceiptTests(unittest.TestCase):
    text='SYNTHETIC 뉴스\r\n<Cite refs={[]}/>\n'
    def original(self):return {'bytes':len(self.text.encode()),'contentSha256':hashlib.sha256(self.text.encode()).hexdigest()}
    def response(self):return {'success':True,'cacheable':False,'report':{'date':'2026-11-27','content':self.text,'contentSha256':self.original()['contentSha256']}}
    def test_original_response_and_source_hashes_must_all_match(self):
        self.assertEqual(m.validate_receipt(200,self.response(),self.original()),(self.original()['contentSha256'],self.original()['bytes']))
        for field,value in [('contentSha256','f'*64),('date','2026-11-26'),('content','altered')]:
            data=self.response();data['report'][field]=value
            with self.assertRaises(m.ReceiptFailure):m.validate_receipt(200,data,self.original())
        with self.assertRaises(m.ReceiptFailure):m.validate_receipt(200,self.response(),{**self.original(),'contentSha256':'e'*64})
    def test_denial_missing_report_and_schema_failure_are_distinguishable_and_redacted(self):
        for data in ({'success':False,'code':'PRIVATE_BRIEFING_FORBIDDEN','message':'SECRET_CANARY'}, {'success':True,'cacheable':True,'report':{'content':'SECRET_CANARY'}}, {'report':[]}, []):
            with self.assertRaises(m.ReceiptFailure) as error:m.validate_receipt(403,data,self.original())
            self.assertNotIn('SECRET_CANARY',json.dumps(error.exception.diagnostic))
            self.assertFalse(error.exception.diagnostic['sourceHashMatches'])
        with self.assertRaises(m.ReceiptFailure) as error:m.validate_receipt(200,{'code':'SECRET_CANARY'},self.original())
        self.assertEqual(error.exception.diagnostic['responseCode'],'NONE_OR_REDACTED')
    def test_google_token_propagation_retries_same_ram_key_then_succeeds(self):
        failed={'success':False,'stage':'TOKEN','http':400,'code':'PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE'}
        good={'success':True,'stage':'COMPLETE','http':200,**self.original()}
        runs=[subprocess.CompletedProcess([],0,json.dumps(x),'') for x in [failed,failed,good]]
        with patch.object(m.subprocess,'run',side_effect=runs) as run,patch.object(m.time,'sleep') as sleep:
            out=m.archive_probe('SYNTHETIC_PEM','syntheticFolder000000001')
        self.assertTrue(out['success']);self.assertEqual(run.call_count,3)
        self.assertEqual([c.args[0] for c in sleep.call_args_list],[2,4])
        self.assertEqual(len({c.kwargs['input'] for c in run.call_args_list}),1)
        self.assertTrue(all('SYNTHETIC_PEM' not in str(c.args) for c in run.call_args_list))
    def test_drive_permission_failure_is_not_retried_or_printed(self):
        value={'success':False,'stage':'LIST','http':403,'code':'PRIVATE_BRIEFING_ARCHIVE_UNAVAILABLE','raw':'SECRET_CANARY'}
        with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,json.dumps(value),'PRIVATE_KEY_CANARY')),patch.object(m.time,'sleep') as sleep:
            with self.assertRaises(m.ReceiptFailure) as error:m.archive_probe('SYNTHETIC_PEM','syntheticFolder000000001')
        sleep.assert_not_called();self.assertEqual(error.exception.diagnostic['archiveStage'],'LIST')
        self.assertNotIn('CANARY',json.dumps(error.exception.diagnostic))
    def test_probe_executes_existing_reader_and_hashes_text_without_emitting_it(self):
        real_run=subprocess.run
        fixture=r'''
import {generateKeyPairSync} from 'node:crypto';
const syntheticKey=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
const syntheticText='SYNTHETIC 뉴스\r\n<Cite refs={[]}/>\n';
globalThis.fetch=async(url,opts)=>{
 const u=new URL(url);
 if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'synthetic-token-000001',token_type:'Bearer',expires_in:3600});
 if(u.pathname==='/drive/v3/files')return Response.json({files:[{id:'syntheticOriginal00000001',name:'2026-11-27.txt',mimeType:'text/plain',size:String(Buffer.byteLength(syntheticText)),modifiedTime:'2026-11-26T22:20:00Z',parents:['syntheticFolder000000001']}]});
 if(u.pathname==='/drive/v3/files/syntheticOriginal00000001')return new Response(syntheticText);
 throw Error('Unexpected network');
};
'''
        def run(args,**kwargs):
            args=list(args);args[3]=fixture+args[3].replace("input='';let stage=", "input='';x.pem=syntheticKey;let stage=")
            result=real_run(args,**kwargs)
            self.assertNotIn(self.text,result.stdout)
            return result
        with patch.object(m.subprocess,'run',side_effect=run):
            self.assertEqual(m.archive_probe('SYNTHETIC_PEM','syntheticFolder000000001')['contentSha256'],self.original()['contentSha256'])

if __name__=='__main__':unittest.main()
