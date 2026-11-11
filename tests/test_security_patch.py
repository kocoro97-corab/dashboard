import copy
import json
import os
import tempfile
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("security_patch", root / "tools/security_patch.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SecurityPatchTests(unittest.TestCase):
    def files(self):
        code = """function doPost(e) {
  return 'existing routes';
}
function doGet(e) {
  return UrlFetchApp.fetch('https://example.test', {muteHttpExceptions: true, headers: {}});
}
function getSheet(name) {
  const ss = SpreadsheetApp.openById('private-sheet-id');
  sheet.appendRow(['admin', 'fixture-default-password', 'approved', 'true', new Date()]);
  return ss;
}
function handleLogin(user,pass) {
  return 'legacy login';
}
function handleRegister(user,pass) {
  return 'legacy registration';
}
function createSession_(user) {
  return 'legacy token';
}
function getSession_(token) {
  return 'legacy session';
}
"""
        return [{"name": "Code", "type": "SERVER_JS", "source": code},
                {"name": "Nhplug", "type": "SERVER_JS", "source": "old quotes"},
                {"name": "PrivateHelper", "type": "SERVER_JS", "source": "private helper"},
                {"name": "appsscript", "type": "JSON", "source": "private manifest"}]

    def test_private_settings_and_unrelated_files_are_preserved(self):
        original = self.files()
        snapshot = copy.deepcopy(original)
        result = module.apply_security(original, "new quotes", root / "gas")
        self.assertEqual(original, snapshot)
        self.assertEqual(result[2:4], original[2:4])
        self.assertIn("SpreadsheetApp.openById('private-sheet-id')", result[0]["source"])
        self.assertNotIn("fixture-default-password", result[0]["source"])
        self.assertIn("followRedirects: false", result[0]["source"])
        self.assertIn("return securitySession_(token)", result[0]["source"])
        self.assertIn("function securityLegacyDoPost_(e)", result[0]["source"])
        self.assertEqual({f["name"] for f in result}, {"Code", "Nhplug", "PrivateHelper", "appsscript", "Security", "SecurityKdf"})

    def test_transform_is_idempotent(self):
        result = module.apply_security(self.files(), "new quotes", root / "gas")
        self.assertEqual(module.apply_security(result, "new quotes", root / "gas"), result)

    def test_unknown_source_layout_stops_instead_of_guessing(self):
        original = self.files()
        original[0]["source"] = "unknown private source"
        with self.assertRaises(ValueError):
            module.apply_security(original, "new quotes", root / "gas")

    def test_static_holdings_are_preserved_in_private_gas_source_only_once(self):
        with tempfile.TemporaryDirectory() as folder:
            temporary = Path(folder)
            (temporary / "js").mkdir()
            (temporary / "gas").mkdir()
            for name in ("Security", "SecurityKdf"):
                (temporary / "gas" / (name + ".gs")).write_text((root / "gas" / (name + ".gs")).read_text())
            holdings = [["fixture account", "fixture name", 1, 2, 3, 4, 5, "000001", ""]]
            (temporary / "js" / "data.js").write_text("const H=" + json.dumps(holdings) + ";\n")
            with patch.dict(os.environ, {"GAS_PROTECT_STATIC_HOLDINGS": "true"}):
                result = module.apply_security(self.files(), "new quotes", temporary / "gas")
                private = next(f for f in result if f["name"] == "SecurityData")
                self.assertIn("fixture name", private["source"])
                (temporary / "js" / "data.js").write_text("const H=[];\n")
                self.assertEqual(module.apply_security(result, "new quotes", temporary / "gas"), result)


if __name__ == "__main__":
    unittest.main()
