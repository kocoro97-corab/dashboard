"""Build a public KRX-listed stock/ETF snapshot from KIS's official distribution.

Format references: koreainvestment/open-trading-api/stocks_info/kis_*_code_mst.py.
TLS verification stays enabled. No keys or account information are needed.
"""
import argparse
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import zipfile

SOURCES = {"KOSPI": ("kospi_code.mst", 228), "KOSDAQ": ("kosdaq_code.mst", 222)}


def parse_archive(data, market):
    filename, tail = SOURCES[market]
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        info = archive.getinfo(filename)
        if info.file_size > 10_000_000:
            raise ValueError("Master archive is unexpectedly large")
        text = archive.read(filename).decode("cp949")
    rows = []
    for line in text.splitlines(keepends=True):
        if len(line) < tail + 22:
            raise ValueError("Master format changed")
        prefix, suffix = line[:-tail], line[-tail:]
        code, isin, name = prefix[:9].strip(), prefix[9:21].strip(), prefix[21:].strip()
        group = suffix[:2]
        if group not in ("ST", "EF") or not re.fullmatch(r"[A-Z0-9]{6}", code):
            continue  # No truncation or conversion of ETNs, warrants, or malformed codes.
        if not re.fullmatch(r"KR[A-Z0-9]{10}", isin) or not name:
            raise ValueError("Invalid master identity")
        rows.append({"code": code, "name": name, "market": market, "type": "ETF" if group == "EF" else "STOCK"})
    return rows


def build(archives, fetched_at=None):
    rows, sources = [], []
    for market, data in archives.items():
        filename = SOURCES[market][0]
        rows.extend(parse_archive(data, market))
        sources.append({"url": "https://new.real.download.dws.co.kr/common/master/" + filename + ".zip", "sha256": hashlib.sha256(data).hexdigest()})
    if len({r["code"] for r in rows}) != len(rows):
        raise ValueError("Duplicate master code")
    if not any(r["type"] == "ETF" for r in rows) or not any(r["market"] == "KOSDAQ" for r in rows):
        raise ValueError("Incomplete stock/ETF coverage")
    return {"schema": 1, "source": {"provider": "한국투자증권 공식 배포 KRX 상장종목 마스터", "upstream": "KRX-listed securities; KIS distribution, not a direct KRX API response", "fetchedAt": fetched_at or datetime.datetime.now(datetime.timezone.utc).isoformat(), "archives": sources}, "instruments": sorted(rows, key=lambda r: r["code"])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive-dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/krx-instruments.json"))
    args = parser.parse_args()
    archives = {}
    for market, (filename, _) in SOURCES.items():
        if args.archive_dir:
            archives[market] = (args.archive_dir / (filename + ".zip")).read_bytes()
        else:
            with urllib.request.urlopen("https://new.real.download.dws.co.kr/common/master/" + filename + ".zip", timeout=30) as response:
                archives[market] = response.read(5_000_000)
    result = build(archives)
    if len(result["instruments"]) < 2500:
        raise ValueError("Master download is incomplete; previous snapshot retained")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    temporary.replace(args.output)
    print("Verified stock/ETF master rows:", len(result["instruments"]))


if __name__ == "__main__":
    main()
