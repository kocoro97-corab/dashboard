import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("master_builder", Path(__file__).resolve().parents[1] / "tools/update_instrument_master.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def archive(market, rows):
    filename, tail = module.SOURCES[market]
    text = "".join(code.ljust(9) + "KR7035720002" + name.ljust(40) + group + "0" * (tail - 3) + "\n" for code, name, group in rows)
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as output:
        output.writestr(filename, text.encode("cp949"))
    return data.getvalue()


class MasterTests(unittest.TestCase):
    def test_stock_and_etf_identity_and_provenance(self):
        data = module.build({"KOSPI": archive("KOSPI", [("000001", "Synthetic ETF", "EF")]),
                             "KOSDAQ": archive("KOSDAQ", [("000002", "Synthetic stock", "ST")])}, "fixture timestamp")
        self.assertEqual([row["type"] for row in data["instruments"]], ["ETF", "STOCK"])
        self.assertEqual(data["source"]["fetchedAt"], "fixture timestamp")
        self.assertTrue(all(len(source["sha256"]) == 64 for source in data["source"]["archives"]))

    def test_etns_and_malformed_codes_are_not_misclassified_or_truncated(self):
        rows = module.parse_archive(archive("KOSPI", [("000001", "Synthetic ETF", "EF"), ("000002", "Synthetic ETN", "EN"), ("000A01", "Alphanumeric", "ST"), ("12345", "Short invalid", "ST")]), "KOSPI")
        self.assertEqual([row["code"] for row in rows], ["000001", "000A01"])

    def test_incomplete_or_conflicting_download_is_rejected(self):
        with self.assertRaises(ValueError):
            module.build({"KOSPI": archive("KOSPI", [("000001", "Stock only", "ST")])})
        with self.assertRaises(ValueError):
            module.build({"KOSPI": archive("KOSPI", [("000001", "ETF", "EF")]), "KOSDAQ": archive("KOSDAQ", [("000001", "Conflicting", "ST")])})


if __name__ == "__main__":
    unittest.main()
