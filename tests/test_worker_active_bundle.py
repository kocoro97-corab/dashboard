"""Exact module preservation; entirely synthetic source and binary payloads."""
import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import worker_active_bundle as b

def bundle():return {'entrypoint':'index.js','modules':[{'name':'index.js','type':'application/javascript+module','body':b'import "./chunks/helper.js";\r\nexport default {};'},{'name':'chunks/helper.js','type':'application/javascript+module','body':b'export const value=1;\n'},{'name':'settings.json','type':'application/json','body':b'{ "exact": true }\n'},{'name':'engine.wasm','type':'application/wasm','body':b'\x00asm\x00\xff'},{'name':'text.txt','type':'text/plain','body':b'unchanged\r\n'}]}
def encoded(value=None):
 value=value or bundle();body,kind=b.multipart({'main_module':value['entrypoint'],'privateField':'PRIVATE_VALUE'},value);return {'body':body,'contentType':kind,'entrypoint':value['entrypoint']}

class BundleTests(unittest.TestCase):
 def test_multiple_modules_keep_filenames_entrypoint_types_and_every_byte(self):
  original=bundle();parsed=b.parse(encoded(original));self.assertEqual(parsed,original);self.assertNotIn('PRIVATE_VALUE',json.dumps(b.manifest(parsed)))
 def test_different_build_names_and_wrappers_are_not_normalized_or_compared_to_local_source(self):
  content={'body':b'// generated wrapper\r\nconst foo = 1;\r\n','contentType':'application/javascript','entrypoint':'generated-entry.js'};out=b.parse(content);self.assertEqual(out['entrypoint'],'generated-entry.js');self.assertEqual(out['modules'][0]['body'],content['body'])
 def test_content_disposition_identifies_a_raw_entrypoint_without_guessing(self):
  out=b.parse({'body':b'export default {}','contentType':'application/javascript+module; charset=utf-8','contentDisposition':'attachment; filename="entry.mjs"'});self.assertEqual(out['entrypoint'],'entry.mjs')
 def test_commonjs_and_source_map_module_types_are_preserved(self):
  v=bundle();v['modules'].extend([{'name':'common.cjs','type':'application/javascript','body':b'module.exports = 1;'},{'name':'index.js.map','type':'application/source-map','body':b'{"version":3}'}]);out=b.parse(encoded(v));self.assertEqual(out,v)
 def test_module_transport_field_name_and_missing_filename_are_preserved(self):
  v=bundle();v['modules'][1]['fileName']='helper.js';v['modules'][2]['fileName']=None;out=b.parse(encoded(v));self.assertEqual(out,v);self.assertEqual(b.manifest(out),b.manifest(v))
 def test_unknown_raw_entrypoint_is_rejected(self):
  with self.assertRaises(b.Stop):b.parse({'body':b'PRIVATE_VALUE','contentType':'application/javascript'})
 def test_observed_header_and_metadata_must_agree(self):
  content=encoded();content['entrypoint']='other.js'
  with self.assertRaises(b.Stop):b.parse(content)
 def test_one_code_byte_change_is_not_equivalent(self):
  expected=b.manifest(bundle());changed=bundle();changed['modules'][1]['body']+=b' ';self.assertFalse(b.matches(encoded(changed),expected));self.assertTrue(b.matches(encoded(),expected))
 def test_missing_added_renamed_and_changed_mime_modules_are_not_equivalent(self):
  original=bundle();expected=b.manifest(original)
  for change in [lambda v:v['modules'].pop(),lambda v:v['modules'].append({'name':'extra.txt','type':'text/plain','body':b'extra'}),lambda v:v['modules'][1].update(name='different.js'),lambda v:v['modules'][3].update(type='application/octet-stream')]:
   v=copy.deepcopy(original);change(v);self.assertFalse(b.matches(encoded(v),expected))
 def test_module_order_does_not_change_the_named_byte_manifest(self):
  original=bundle();reordered=copy.deepcopy(original);reordered['modules'].reverse();self.assertTrue(b.matches(encoded(reordered),b.manifest(original)))
 def test_duplicate_module_names_and_unsupported_mimes_are_refused(self):
  for change in [lambda v:v['modules'].append(copy.deepcopy(v['modules'][0])),lambda v:v['modules'][1].update(type='application/x-python')]:
   v=bundle();change(v)
   with self.assertRaises(b.Stop):b.parse(encoded(v))
 def test_entrypoint_must_be_present_and_javascript(self):
  for entry in ['absent.js','engine.wasm','settings.json']:
   v=bundle();v['entrypoint']=entry
   with self.assertRaises(b.Stop):b.parse(encoded(v))
 def test_path_traversal_control_characters_and_unsafe_headers_are_rejected(self):
  for name in ['/root.js','../root.js','chunks/../root.js','a//b.js','a\\b.js','x".js','x\r\nToken.js']:
   with self.assertRaises(b.Stop):b.filename(name)
 def test_oversized_or_malformed_response_errors_do_not_echo_source(self):
  for content in [{'body':b'x'*(b.LIMIT+1),'contentType':'application/javascript','entrypoint':'index.js'},{'body':b'PRIVATE_VALUE','contentType':'multipart/form-data; boundary=missing'},{'body':b'PRIVATE_VALUE','contentType':'application/unknown','entrypoint':'index.js'}]:
   with self.assertRaises(b.Stop) as raised:b.parse(content)
   self.assertEqual(str(raised.exception),'WORKER_BUNDLE_INVALID')
 def test_metadata_can_identify_multipart_entrypoint_when_header_is_missing(self):
  content=encoded();content.pop('entrypoint');self.assertEqual(b.parse(content)['entrypoint'],'index.js')
 def test_metadata_envelope_with_a_filename_is_not_mistaken_for_a_code_module(self):
  content=encoded();content['body']=content['body'].replace(b'name="metadata"\r\n',b'name="metadata"; filename="metadata"\r\n',1);self.assertEqual(b.parse(content),bundle())
 def test_too_many_modules_are_rejected(self):
  v=bundle();v['modules'] += [{'name':'chunk'+str(i)+'.txt','type':'text/plain','body':b'x'} for i in range(65)]
  with self.assertRaises(b.Stop):b.parse(encoded(v))

if __name__=='__main__':unittest.main()
