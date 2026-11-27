"""Opt-in real workerd fetch regression with synthetic keys and internal-only egress.
No Google, Cloudflare API, GAS, NH, original reports or real credentials are accessed.
"""
import argparse,hashlib,json,os,shutil,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def run(binary,schema):
    fixture=ROOT/'tests/fixtures/private-reader-workerd'
    with tempfile.TemporaryDirectory(prefix='myinvest-synthetic-workerd-') as temporary:
        directory=Path(temporary)
        for name in ('main.mjs','transport.mjs'):shutil.copyfile(fixture/name,directory/name)
        shutil.copyfile(ROOT/'relay/private-original/drive-archive.mjs',directory/'drive-archive.mjs')
        # This key is freshly generated synthetic fixture material, never an account key.
        key=subprocess.run(['node','--input-type=module','-e',"import {generateKeyPairSync} from 'node:crypto';console.log(JSON.stringify(generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey))"],capture_output=True,check=True,timeout=20).stdout
        (directory/'synthetic-key.json').write_bytes(key)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
        imported=json.dumps(os.path.relpath(schema,directory))
        config='''using Workerd = import SCHEMA;
const config :Workerd.Config = (
 services=[(name="main",worker=(compatibilityDate="2026-11-01",globalOutbound="transport",modules=[
 (name="main.mjs",esModule=embed "main.mjs"),
 (name="drive-archive.mjs",esModule=embed "drive-archive.mjs"),
 (name="synthetic-key.json",json=embed "synthetic-key.json")
 ])),(name="transport",worker=(compatibilityDate="2026-11-01",globalOutbound="transport",modules=[(name="transport.mjs",esModule=embed "transport.mjs")]))],
 sockets=[(name="http",address="127.0.0.1:PORT",http=(),service="main")]
);'''.replace('SCHEMA',imported).replace('PORT',str(port))
        (directory/'config.capnp').write_text(config)
        # All fetches go to the synthetic transport service; no internet service exists.
        with (directory/'runtime.log').open('w+') as log:
            child=subprocess.Popen([str(binary),'serve',str(directory/'config.capnp')],stdout=log,stderr=log)
            try:
                opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
                for attempt in range(60):
                    try:
                        with opener.open('http://127.0.0.1:'+str(port)+'/?case=LEGACY',timeout=1) as response:legacy=json.load(response)
                        break
                    except OSError:
                        if child.poll() is not None:raise RuntimeError('WORKERD_START_FAILED') from None
                        if attempt==59:raise RuntimeError('WORKERD_START_TIMEOUT') from None
                        time.sleep(0.1)
                assert legacy['diagnostic']=={'stage':'TOKEN_REQUEST','http':None} and legacy['calls']==[]
                print('LEGACY_UNSUPPORTED_REDIRECT_REPRODUCED: PASS')
                for case in ('SUCCESS','TOKEN','LIST','MEDIA'):
                    with opener.open('http://127.0.0.1:'+str(port)+'/?case='+case,timeout=5) as response:value=json.load(response)
                    if case=='SUCCESS':assert value['success'] is True and value['hash']==hashlib.sha256('SYNTHETIC 원문\r\n'.encode()).hexdigest()
                    else:assert value['success'] is False and value['diagnostic']=={'stage':'TOKEN_RESPONSE' if case=='TOKEN' else case,'http':302}
                    assert all(x['host']!='forbidden.invalid' for x in value['calls'])
                    print(case+': PASS')
            finally:
                child.terminate()
                try:child.wait(timeout=5)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
    print('Real Google transport and real owner browser: NOT_RUN')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workerd',required=True,type=Path)
    parser.add_argument('--schema',required=True,type=Path)
    args=parser.parse_args();run(args.workerd.resolve(),args.schema.resolve())
