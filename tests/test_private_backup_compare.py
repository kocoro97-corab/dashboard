import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import compare_private_backups as compare

PRIVATE = 'SYNTHETIC_PRIVATE_CANARY'
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'


def make_xlsx(path, value=PRIVATE, formula_cache='2', style='0', swapped=False):
    strings = ['Synthetic', value] if swapped else [value, 'Synthetic']
    index = '1' if swapped else '0'
    files = {
        'xl/workbook.xml': '<workbook xmlns="'+NS+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+PRIVATE+'" sheetId="1" r:id="r1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/sharedStrings.xml': '<sst xmlns="'+NS+'">'+''.join('<si><t>'+s+'</t></si>' for s in strings)+'</sst>',
        'xl/worksheets/sheet1.xml': '<worksheet xmlns="'+NS+'"><sheetData><row r="1"><c r="A1" t="s" s="'+style+'"><v>'+index+'</v></c><c r="B1"><f>1+1</f><v>'+formula_cache+'</v></c></row></sheetData></worksheet>',
    }
    with zipfile.ZipFile(path, 'w') as archive:
        for name, text in files.items():
            archive.writestr(name, text)
    return path


class PrivateCompareTests(unittest.TestCase):
    def setUp(self):
        stub = patch.object(compare, 'has_git_parent', return_value=False)
        stub.start()
        self.addCleanup(stub.stop)

    def test_semantic_xlsx_comparison_never_outputs_names_values_or_digests_or_writes(self):
        with tempfile.TemporaryDirectory() as folder:
            a = make_xlsx(Path(folder) / 'a.xlsx')
            b = make_xlsx(Path(folder) / 'b.xlsx', swapped=True)
            before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in [a, b]}
            result = compare.compare_sheets(a, b, True)
            self.assertEqual(result['result'], 'PASS_EXPORTED_SCOPE')
            self.assertFalse(result['fullGoogleSheetsRestoreVerified'])
            self.assertNotIn(PRIVATE, json.dumps(result))
            self.assertNotIn(hashlib.sha256(PRIVATE.encode()).hexdigest(), json.dumps(result))
            self.assertEqual(before, {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in [a, b]})

    def test_changed_cells_and_styles_cannot_pass(self):
        with tempfile.TemporaryDirectory() as folder:
            a = make_xlsx(Path(folder) / 'a.xlsx')
            for opts in [{'value': 'changed'}, {'style': '1'}]:
                result = compare.compare_sheets(a, make_xlsx(Path(folder) / 'b.xlsx', **opts), True)
                self.assertEqual(result['result'], 'ADDITIONAL_REVIEW_REQUIRED')

    def test_cached_formula_values_do_not_claim_live_valuation_comparison(self):
        with tempfile.TemporaryDirectory() as folder:
            a = make_xlsx(Path(folder) / 'a.xlsx')
            b = make_xlsx(Path(folder) / 'b.xlsx', formula_cache='999')
            result = compare.compare_sheets(a, b, True)
            self.assertTrue(result['constantValuesAndFormulasMatch'])
            self.assertFalse(result['formulaCachesCompared'])

    def test_source_confirmation_and_distinct_files_are_required(self):
        with tempfile.TemporaryDirectory() as folder:
            a = make_xlsx(Path(folder) / 'a.xlsx')
            b = make_xlsx(Path(folder) / 'b.xlsx')
            self.assertEqual(compare.compare_sheets(a, b)['result'], 'ADDITIONAL_REVIEW_REQUIRED')
            with self.assertRaisesRegex(ValueError, 'DISTINCT_EXPORTS'):
                compare.compare_sheets(a, a, True)
            with patch.object(compare, 'has_git_parent', return_value=True), self.assertRaisesRegex(ValueError, 'OUTSIDE_GIT'):
                compare.compare_sheets(a, b, True)

    def test_malformed_xlsx_error_does_not_echo_private_filename_or_body(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / PRIVATE
            path.write_text(PRIVATE)
            with self.assertRaisesRegex(ValueError, '^XLSX_READ_FAILED$'):
                compare.workbook(path)

    def test_property_comparison_reports_only_counts_and_scope(self):
        current = {'NHPLUG_APP_KEY': PRIVATE, 'NHPLUG_APP_SECRET': PRIVATE}
        result = compare.compare_properties(current, dict(current), True)
        self.assertEqual(result['result'], 'PASS_OWNER_ENTERED_SCOPE')
        self.assertNotIn(PRIVATE, json.dumps(result))
        self.assertFalse(result['propertiesReadByApi'])
        self.assertFalse(result['backupTimestampVerified'])
        result = compare.compare_properties(dict(current, hidden='changed'), dict(current, hidden=PRIVATE), True)
        self.assertFalse(result['valuesMatch'])
        self.assertEqual(result['changedValueCount'], 1)
        self.assertEqual(result['result'], 'ADDITIONAL_REVIEW_REQUIRED')

    def test_property_scope_required_keys_and_volatile_data_do_not_pass(self):
        self.assertEqual(compare.compare_properties({}, {}, True)['result'], 'ADDITIONAL_REVIEW_REQUIRED')
        for name in ['S_SYNTHETIC_TOKEN', 'NHPLUG_TOKEN', 'NHPLUG_TOKEN_EXP']:
            with self.assertRaisesRegex(ValueError, 'VOLATILE_PROPERTY'):
                compare.compare_properties({name: PRIVATE}, {})
        with self.assertRaisesRegex(ValueError, 'MULTILINE'):
            compare.compare_properties({'key': 'one\ntwo'}, {})

    def test_volatile_key_is_refused_before_prompting_for_its_value(self):
        with patch.object(compare.getpass, 'getpass', return_value='NHPLUG_TOKEN') as prompt:
            with self.assertRaisesRegex(ValueError, 'VOLATILE_PROPERTY'):
                compare.read_properties('synthetic')
            self.assertEqual(prompt.call_count, 1)

    def test_noninteractive_property_input_stops_before_collecting_secrets(self):
        with patch.object(sys, 'argv', ['compare', 'properties']), patch.object(sys.stdin, 'isatty', return_value=False), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(compare.main(), 1)
            self.assertEqual(json.loads(output.getvalue())['code'], 'PRIVATE_TERMINAL_REQUIRED')

    def test_cli_unknown_exception_is_classified_without_values(self):
        with patch.object(sys, 'argv', ['compare', 'sheets', '--current', 'a', '--backup', 'b']), patch.object(compare, 'compare_sheets', side_effect=ValueError(PRIVATE)), patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(compare.main(), 1)
            self.assertNotIn(PRIVATE, output.getvalue())


if __name__ == '__main__':
    unittest.main()
