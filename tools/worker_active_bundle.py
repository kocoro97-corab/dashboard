"""Read and re-upload the exact active module bundle; no source normalization.
Only a raw HTTP main-module response's standard JS MIME aliases are canonicalized.
Code/data bytes, module filenames and the observed entrypoint remain exact.
"""
import hashlib,json,re,uuid
from email.parser import BytesParser
from email.policy import default
from email.message import Message

LIMIT=2*1024*1024
MIME={value:value for value in ['application/javascript+module','application/javascript','application/wasm','application/octet-stream','application/json','text/plain','application/source-map']}
class Stop(Exception):
 def __init__(self):super().__init__('WORKER_BUNDLE_INVALID');self.code='WORKER_BUNDLE_INVALID'

def filename(value):
 if not isinstance(value,str) or value=='metadata' or not re.fullmatch(r'[A-Za-z0-9_@.+~-][A-Za-z0-9_@./+~-]{0,239}',value) or any(part in ('','.','..') for part in value.split('/')):raise Stop()
 return value

def parse(content):
 try:
  body=content.get('body');kind=content.get('contentType','');entry=content.get('entrypoint');metadata_entry=None;modules=[]
  if not isinstance(body,bytes) or not body or len(body)>LIMIT or not isinstance(kind,str):raise Stop()
  if entry is not None:entry=filename(entry)
  if kind.lower().startswith('multipart/'):
   msg=BytesParser(policy=default).parsebytes(('Content-Type: '+kind+'\r\nMIME-Version: 1.0\r\n\r\n').encode()+body)
   if not msg.is_multipart() or msg.defects:raise Stop()
   saw_metadata=False
   for part in msg.iter_parts():
    if part.is_multipart() or part.defects:raise Stop()
    file=part.get_filename();field=part.get_param('name',header='content-disposition')
    if part.get('Content-Transfer-Encoding','binary').lower() not in ('binary','8bit','7bit','base64','quoted-printable'):raise Stop()
    name=field or file;payload=part.get_payload(decode=True)
    if not isinstance(payload,bytes):raise Stop()
    if field=='metadata':
     if saw_metadata or len(payload)>65536:raise Stop()
     saw_metadata=True;meta=json.loads(payload)
     if not isinstance(meta,dict):raise Stop()
     if 'main_module' in meta:metadata_entry=filename(meta['main_module'])
     continue
    name=filename(name);mime=MIME.get(part.get_content_type().lower())
    if not mime or len(modules)>=64:raise Stop()
    module={'name':name,'type':mime,'body':payload}
    if file!=name:module['fileName']=filename(file) if file else None
    modules.append(module)
  else:
   raw_mime=kind.split(';',1)[0].strip().lower();explicit_entry=bool(entry)
   mime='application/javascript+module' if raw_mime=='application/javascript+module' or explicit_entry and raw_mime in ['application/javascript','text/javascript'] else None
   if not entry and content.get('contentDisposition'):
    header=Message();header['Content-Disposition']=content['contentDisposition'];entry=filename(header.get_filename())
   if not entry or mime!='application/javascript+module':raise Stop()
   modules=[{'name':entry,'type':mime,'body':body}]
  if entry and metadata_entry and entry!=metadata_entry:raise Stop()
  entry=entry or metadata_entry or (modules[0]['name'] if len(modules)==1 else None)
  if not modules or not entry or len({m['name'] for m in modules})!=len(modules):raise Stop()
  if sum(len(m['body']) for m in modules)>LIMIT:raise Stop()
  if not any(m['name']==entry and m['type']=='application/javascript+module' for m in modules):raise Stop()
  return {'entrypoint':entry,'modules':modules}
 except Stop:raise
 except Exception:raise Stop() from None

def manifest(bundle):
 return {'entrypoint':bundle['entrypoint'],'modules':{m['name']:{'type':m['type'],'size':len(m['body']),'sha256':hashlib.sha256(m['body']).hexdigest()} for m in sorted(bundle['modules'],key=lambda m:m['name'])}}

def matches(content,expected):
 try:return manifest(parse(content))==expected
 except Stop:return False

def multipart(metadata,bundle):
 if metadata.get('main_module')!=bundle['entrypoint']:raise Stop()
 boundary='myinvest-preserved-'+uuid.uuid4().hex;parts=[]
 rows=[('metadata','application/json',None,json.dumps(metadata).encode())]+[(m['name'],m['type'],m.get('fileName',m['name']),m['body']) for m in bundle['modules']]
 for name,mime,file,body in rows:
  disposition='form-data; name="'+name+'"'+('; filename="'+file+'"' if file else '')
  parts.append(('--'+boundary+'\r\nContent-Disposition: '+disposition+'\r\nContent-Type: '+mime+'\r\n\r\n').encode()+body+b'\r\n')
 return b''.join(parts)+('--'+boundary+'--\r\n').encode(),'multipart/form-data; boundary='+boundary
