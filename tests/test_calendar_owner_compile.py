"""Owner compilation failures are bounded and sanitized before any deployment."""
import io, json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import calendar_connection_activate as m


class OwnerCompilationTests(unittest.TestCase):
    def execute(self,results):
        folder=Path(self.folder)
        legacy=folder/'legacy.mjs';legacy.write_text('synthetic public fixture')
        with patch.object(m.subprocess,'run',side_effect=results) as run,patch('sys.stderr',new_callable=io.StringIO) as output:
            try:m.compile_worker(legacy,folder/'candidate.mjs',folder)
            except m.Stop as error:return m.safe_code(error),run.call_args_list,output.getvalue()
            return 'PASS',run.call_args_list,output.getvalue()

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.folder=self.tmp.name
    def tearDown(self):self.tmp.cleanup()

    def test_each_subprocess_timeout_names_the_exact_stage_without_private_output(self):
        ok=subprocess.CompletedProcess([],0,stdout='{"status":"PASS"}',stderr='')
        for index,stage in enumerate(['INSTALLING_LOCAL_BUNDLER','COMPILING_CURRENT_WORKER','CHECKING_WORKER_EXPORTS']):
            with self.subTest(stage=stage),tempfile.TemporaryDirectory() as folder:
                self.folder=folder
                code,calls,logs=self.execute([ok]*index+[subprocess.TimeoutExpired(['PRIVATE_COMMAND'],120,output='PRIVATE_CANARY',stderr='PRIVATE_CANARY')])
                self.assertEqual(code,stage+'_TIMEOUT');self.assertEqual(len(calls),index+1)
                self.assertNotIn('PRIVATE',code+logs)

    def test_missing_npm_or_node_and_denied_execution_have_actionable_codes(self):
        for error,suffix in [(FileNotFoundError('PRIVATE_CANARY'),'COMMAND_MISSING'),(PermissionError('PRIVATE_CANARY'),'EXECUTION_DENIED'),(OSError('PRIVATE_CANARY'),'PROCESS_FAILED')]:
            with self.subTest(suffix=suffix),tempfile.TemporaryDirectory() as folder:
                self.folder=folder;code,calls,logs=self.execute([error])
                self.assertEqual(code,'INSTALLING_LOCAL_BUNDLER_'+suffix);self.assertEqual(len(calls),1);self.assertNotIn('PRIVATE',code+logs)

    def test_network_and_disk_errors_report_fixed_categories_only(self):
        for category in ['EAI_AGAIN','ENOTFOUND','ETIMEDOUT','ENOSPC','EACCES']:
            with self.subTest(category=category),tempfile.TemporaryDirectory() as folder:
                self.folder=folder;code,_,logs=self.execute([subprocess.CompletedProcess([],1,stdout='',stderr='PRIVATE_CANARY npm error '+category)])
                self.assertEqual(code,'LOCAL_BUNDLE_DEPENDENCY_'+category);self.assertNotIn('PRIVATE',code+logs)

    def test_success_bounded_fetch_and_no_secret_environment_forwarding(self):
        ok=subprocess.CompletedProcess([],0,stdout='{"status":"PASS"}',stderr='')
        with patch.dict(os.environ,{'SYNTHETIC_API_TOKEN':'PRIVATE_CANARY','SYNTHETIC_PASSWORD':'PRIVATE_CANARY'}):
            code,calls,logs=self.execute([ok,ok,ok])
        self.assertEqual(code,'PASS');self.assertEqual(len(calls),3)
        self.assertIn('--fetch-timeout=30000',calls[0].args[0]);self.assertIn('--fetch-retries=1',calls[0].args[0])
        for call in calls:
            self.assertNotIn('SYNTHETIC_API_TOKEN',call.kwargs['env']);self.assertNotIn('SYNTHETIC_PASSWORD',call.kwargs['env'])
            self.assertLessEqual(call.kwargs['timeout'],120)
        self.assertNotIn('PRIVATE',logs)

    def test_main_reports_direct_gas_failure_stage_and_http_without_echoing_values(self):
        def fail(*args,**kwargs):
            m.progress('VERIFYING_DIRECT_GAS_METADATA')
            raise m.ApiFailure('HTTP_FAILURE',403,'appVersion')
        with patch.object(sys,'argv',['owner-tool','--environment',self.folder,'--apply']),patch.object(m.os,'isatty',return_value=True),patch.object(m.getpass,'getpass',side_effect=['a'*32,'PRIVATE_TOKEN','PRIVATE_USER','PRIVATE_PASSWORD']),patch.object(m,'apply',side_effect=fail),patch('sys.stdout',new_callable=io.StringIO) as output,patch('sys.stderr',new_callable=io.StringIO):
            self.assertEqual(m.main(),1)
        report=json.loads(output.getvalue())
        self.assertEqual(report['code'],'HTTP_FAILURE');self.assertEqual(report['http'],403)
        self.assertEqual(report['requestStage'],'VERIFYING_DIRECT_GAS_METADATA')
        self.assertFalse(report['deploymentAttempted']);self.assertNotIn('PRIVATE',output.getvalue())

    def test_gas_source_and_owner_auth_failures_remain_distinct(self):
        self.assertEqual(m.safe_code(m.gas.Stop('FRESH_BINDING_OR_SOURCE_FAILED')),'FRESH_BINDING_OR_SOURCE_FAILED')
        self.assertEqual(m.safe_code(m.ApiFailure('LOGIN_CREDENTIALS_OR_APPROVAL')),'LOGIN_CREDENTIALS_OR_APPROVAL')
        self.assertEqual(m.safe_code(RuntimeError('PRIVATE_CANARY')),'OWNER_CALENDAR_STEP_FAILED')


if __name__=='__main__':unittest.main()
