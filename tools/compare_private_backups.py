"""Owner-only offline comparisons. No network, writes, names, values or digests in reports."""
import argparse
from decimal import Decimal
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

from prepare_gas_backup import has_git_parent

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
SAFE_ERRORS = {'PRIVATE_FILES_OUTSIDE_GIT_REQUIRED', 'DISTINCT_EXPORTS_REQUIRED',
               'XLSX_READ_FAILED', 'XLSX_TOO_LARGE', 'PRIVATE_TERMINAL_REQUIRED',
               'DUPLICATE_PROPERTY', 'VOLATILE_PROPERTY_OMIT_REQUIRED', 'PROPERTY_INPUT_LIMIT',
               'MULTILINE_PROPERTY_REVIEW_REQUIRED'}


def digest(value, key):
    data = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return hmac.new(key, data, hashlib.sha256).digest()


def xml_value(node):
    if node is None:
        return None
    text = node.text or ''
    if not node.tag.endswith(('}t', '}f', '}v')) and not text.strip():
        text = ''
    return [node.tag, sorted(node.attrib.items()), text, [xml_value(child) for child in node]]


def workbook(path):
    path = Path(path).absolute()
    if has_git_parent(path) or any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('PRIVATE_FILES_OUTSIDE_GIT_REQUIRED')
    try:
        with zipfile.ZipFile(path) as bundle:
            if sum(info.file_size for info in bundle.infolist()) > 100 * 1024 * 1024:
                raise ValueError('XLSX_TOO_LARGE')
            def xml(name):
                return ET.fromstring(bundle.read(name))
            book = xml('xl/workbook.xml')
            targets = {item.attrib['Id']: item.attrib['Target'] for item in xml('xl/_rels/workbook.xml.rels')}
            strings = []
            rich = []
            if 'xl/sharedStrings.xml' in bundle.namelist():
                for item in xml('xl/sharedStrings.xml'):
                    strings.append(''.join(item.itertext()))
                    rich.append([xml_value(child) for child in item])
            values, layouts = [], []
            for sheet in book.findall('s:sheets/s:sheet', NS):
                target = targets[sheet.attrib[REL]]
                name = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
                if not name.startswith('xl/') or '..' in name.split('/'):
                    raise ValueError('XLSX_READ_FAILED')
                root = xml(name)
                data = root.find('s:sheetData', NS)
                cells, row_settings = [], []
                for row in data if data is not None else []:
                    row_settings.append(sorted(row.attrib.items()))
                    for cell in row:
                        value = cell.find('s:v', NS)
                        text = value.text if value is not None else ''
                        kind = cell.attrib.get('t', 'n')
                        formula = cell.find('s:f', NS)
                        formatting = None
                        if formula is not None:
                            # Formula expressions are restorable; volatile cached results are not compared.
                            content = ['formula', xml_value(formula)]
                        elif kind == 's':
                            content = ['text', strings[int(text)]]
                            formatting = rich[int(text)]
                        elif kind == 'inlineStr':
                            inline = cell.find('s:is', NS)
                            content = ['text', ''.join(inline.itertext()) if inline is not None else '']
                            formatting = [xml_value(child) for child in inline] if inline is not None else []
                        elif kind == 'n' and text:
                            content = ['number', str(Decimal(text).normalize())]
                        else:
                            content = [kind, text]
                        cells.append([cell.attrib.get('r'), content])
                        # Style and rich text changes must not silently pass a values-only comparison.
                        formatting = [cell.attrib.get('r'), cell.attrib.get('s', '0'), formatting]
                        layouts.append(['cell', len(values), formatting])
                values.append([sheet.attrib.get('name'), sheet.attrib.get('state', 'visible'), cells])
                if data is not None:
                    root.remove(data)
                layouts.append(['sheet', row_settings, xml_value(root)])
            layouts.append(['styles', xml_value(xml('xl/styles.xml')) if 'xl/styles.xml' in bundle.namelist() else None])
            layouts.append(['definedNames', xml_value(book.find('s:definedNames', NS))])
            unsupported = any(name.startswith(('xl/drawings/', 'xl/charts/', 'xl/pivot', 'xl/externalLinks/', 'xl/tables/', 'xl/comments')) or name.endswith(('vbaProject.bin', 'connections.xml')) for name in bundle.namelist())
            return {'values': values, 'layout': layouts, 'sheetCount': len(values), 'unsupported': unsupported}
    except ValueError as error:
        if str(error) in SAFE_ERRORS:
            raise
        raise ValueError('XLSX_READ_FAILED') from None
    except Exception:
        raise ValueError('XLSX_READ_FAILED') from None


def compare_sheets(current, backup, provenance_confirmed=False):
    if Path(current).resolve() == Path(backup).resolve():
        raise ValueError('DISTINCT_EXPORTS_REQUIRED')
    left, right = workbook(current), workbook(backup)
    key = os.urandom(32)
    values_match = hmac.compare_digest(digest(left['values'], key), digest(right['values'], key))
    layout_match = hmac.compare_digest(digest(left['layout'], key), digest(right['layout'], key))
    limited = left['unsupported'] or right['unsupported']
    passed = values_match and layout_match and not limited and provenance_confirmed and left['sheetCount'] > 0
    return {'mode': 'OFFLINE_XLSX_COMPARISON',
            'result': 'PASS_EXPORTED_SCOPE' if passed else 'ADDITIONAL_REVIEW_REQUIRED',
            'sourceSelectionOwnerConfirmed': provenance_confirmed,
            'currentSheetCount': left['sheetCount'], 'backupSheetCount': right['sheetCount'],
            'constantValuesAndFormulasMatch': values_match, 'layoutAndStylesMatch': layout_match,
            'unsupportedWorkbookFeaturesPresent': limited, 'formulaCachesCompared': False,
            'googlePermissionsScriptsHistoryCompared': False, 'backupTimestampVerified': False,
            'fullGoogleSheetsRestoreVerified': False,
            'valuesNamesOrDigestsIncluded': False, 'remoteWrites': False, 'localWrites': False}


def is_volatile(name):
    return name.startswith('S_') or name in ('NHPLUG_TOKEN', 'NHPLUG_TOKEN_EXP')


def compare_properties(current, backup, complete=False):
    if any(is_volatile(name) for name in set(current) | set(backup)):
        raise ValueError('VOLATILE_PROPERTY_OMIT_REQUIRED')
    if any('\n' in value or '\r' in value for data in (current, backup) for value in data.values()):
        raise ValueError('MULTILINE_PROPERTY_REVIEW_REQUIRED')
    key = os.urandom(32)
    same_keys = set(current) == set(backup)
    same_values = hmac.compare_digest(digest(current, key), digest(backup, key))
    required_present = all(name in current and name in backup for name in ('NHPLUG_APP_KEY', 'NHPLUG_APP_SECRET'))
    changed = sum(not hmac.compare_digest(digest(current[name], key), digest(backup[name], key)) for name in set(current) & set(backup))
    return {'mode': 'OWNER_ENTERED_PERMANENT_PROPERTIES',
            'result': 'PASS_OWNER_ENTERED_SCOPE' if complete and required_present and same_keys and same_values else 'ADDITIONAL_REVIEW_REQUIRED',
            'scopeCompleteOwnerConfirmed': complete, 'requiredPermanentKeysPresent': required_present,
            'keySetsMatch': same_keys, 'valuesMatch': same_values, 'changedValueCount': changed,
            'addedKeyCount': len(set(current) - set(backup)), 'missingKeyCount': len(set(backup) - set(current)),
            'propertiesReadByApi': False, 'volatilePropertiesCompared': False,
            'singleLineValuesOnly': True,
            'backupTimestampVerified': False, 'restoreExecutionVerified': False,
            'valuesNamesOrDigestsIncluded': False, 'remoteWrites': False, 'localWrites': False}


def read_properties(label):
    result = {}
    for index in range(256):
        name = getpass.getpass(label + ' 속성 이름 (' + str(index + 1) + ', 완료 시 빈 입력): ')
        if not name:
            return result
        if is_volatile(name):
            raise ValueError('VOLATILE_PROPERTY_OMIT_REQUIRED')
        if name in result:
            raise ValueError('DUPLICATE_PROPERTY')
        result[name] = getpass.getpass(label + ' 속성 값 (표시/저장 안 됨, 한 줄 값만): ')
    raise ValueError('PROPERTY_INPUT_LIMIT')


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_subparsers(dest='mode', required=True)
    sheets = modes.add_parser('sheets')
    sheets.add_argument('--current', type=Path, required=True)
    sheets.add_argument('--backup', type=Path, required=True)
    sheets.add_argument('--provenance-confirmed', action='store_true')
    properties = modes.add_parser('properties')
    properties.add_argument('--complete-permanent-scope', action='store_true')
    args = parser.parse_args()
    try:
        if args.mode == 'sheets':
            result = compare_sheets(args.current, args.backup, args.provenance_confirmed)
        else:
            if not sys.stdin.isatty():
                raise ValueError('PRIVATE_TERMINAL_REQUIRED')
            result = compare_properties(read_properties('현재'), read_properties('기존 백업'), args.complete_permanent_scope)
        print(json.dumps(result))
        return 0 if result['result'].startswith('PASS_') else 2
    except Exception as error:
        code = str(error) if str(error) in SAFE_ERRORS else 'PRIVATE_COMPARISON_FAILED'
        print(json.dumps({'status': 'BLOCKED', 'code': code, 'valuesNamesOrDigestsIncluded': False, 'remoteWrites': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
