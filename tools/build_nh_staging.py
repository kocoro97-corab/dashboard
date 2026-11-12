"""Build public PR source for a new standalone staging GAS project; no production reads."""
import argparse
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_SCRIPT_ID = "1WwqTZuH36L3sYdwmz8POXLmW-1Xw4oC4AGkFPSeueaEVBMB31ua_CkYL"
PRODUCTION_DEPLOYMENT_ID = "AKfycbxySfUKUai418Ar7C8RI6gwBJpjSZXH4y8EX2JhJZG9nGz7RVB0WCZGl3H1wHxOWGVd"
PRODUCTION_SHEET_HASH = "a151f7f6339a9f699aa24cc0d8b968e7c11777c374942250dda33bed11a52c95"
SOURCES = ["gas/Security.gs", "gas/SecurityKdf.gs", "gas/ExternalHoldings.gs", "gas/Nhplug.gs", "gas/NhGatewayV2.gs", "gas/NhAccountsV2.gs", "gas/AccountStoreV2.gs", "tests/staging/StagingBridge.gs"]
MANIFEST = {"timeZone": "Asia/Seoul", "runtimeVersion": "V8", "exceptionLogging": "NONE", "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/script.external_request", "https://www.googleapis.com/auth/script.scriptapp"], "webapp": {"executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS"}}


def source_digest(root=ROOT):
    digest = hashlib.sha256()
    for name in SOURCES:
        data = (root / name).read_bytes()
        digest.update(name.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
    digest.update(json.dumps(MANIFEST, sort_keys=True).encode())
    return digest.hexdigest()


def build(script_id, revision, output, root=ROOT):
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,200}", script_id) or script_id == PRODUCTION_SCRIPT_ID:
        raise ValueError("A new, non-production staging script ID is required")
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        raise ValueError("Use the exact checked-out PR commit SHA")
    output = Path(output)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Use an empty output directory; existing projects are never overwritten")
    output.mkdir(parents=True, exist_ok=True)
    for source in SOURCES:
        content = (root / source).read_text()
        if source.endswith("StagingBridge.gs"):
            content = content.replace("__SCRIPT_ID__", script_id).replace("__REVISION__", revision).replace("__SOURCE_DIGEST__", source_digest(root))
        (output / Path(source).name).write_text(content)
    (output / "appsscript.json").write_text(json.dumps(MANIFEST, indent=2) + "\n")
    (output / ".clasp.json").write_text(json.dumps({"scriptId": script_id, "rootDir": "."}) + "\n")
    return {"scriptId": script_id, "revision": revision, "sourceDigest": source_digest(root), "files": len(SOURCES) + 1}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--script-id", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.script_id, args.revision, args.output)))
