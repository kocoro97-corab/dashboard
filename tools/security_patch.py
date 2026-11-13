"""Transform private Code.gs in memory; never copy its source into Git or logs."""
import copy
import json
import os
from pathlib import Path
import re


def replace_function(source, name, replacement):
    pattern = r"(?ms)^function " + re.escape(name) + r"\([^\n]*\)\s*\{.*?^\}"
    result, count = re.subn(pattern, lambda match: replacement, source)
    if count != 1:
        raise ValueError("Expected one supported GAS function: " + name)
    return result


def apply_security(files, nhplug_source, root=Path("gas")):
    files = copy.deepcopy(files)
    matches = [f for f in files if f["name"] == "Code" and f["type"] == "SERVER_JS"]
    if len(matches) != 1:
        raise ValueError("The private Code.gs file was not recognized")
    source = matches[0]["source"]
    for old, new in [("doPost", "securityLegacyDoPost_"), ("doGet", "securityLegacyDoGet_")]:
        if "function " + new + "(" not in source:
            if len(re.findall(r"\bfunction " + old + r"\(", source)) != 1:
                raise ValueError("The GAS entry point was not recognized")
            source = source.replace("function " + old + "(", "function " + new + "(", 1)
    # Preserve the private spreadsheet selector; remove only automatic default-admin creation.
    source = re.sub(r'''(?m)^\s*sheet\.appendRow\(\[\s*['"]admin['"].*\n?''', "\n", source)
    source = replace_function(source, "handleRegister", "function handleRegister(user,pass) {\n  return securityRegister_(user,pass);\n}")
    source = replace_function(source, "handleLogin", "function handleLogin(user,pass) {\n  return securityLogin_(user,pass);\n}")
    source = replace_function(source, "createSession_", "function createSession_(user) {\n  return securityCreateSession_(user,false);\n}")
    source = replace_function(source, "getSession_", "function getSession_(token) {\n  return securitySession_(token);\n}")
    if "followRedirects: false" not in source:
        source = source.replace("muteHttpExceptions: true,", "muteHttpExceptions: true, followRedirects: false,", 1)
    matches[0]["source"] = source
    nh = next(f for f in files if f["name"] == "Nhplug")
    nh["source"] = nhplug_source
    for name in ("Security", "SecurityKdf", "ExternalHoldings", "NhGatewayV2", "NhAccountsV2", "NhForeignIdentityV2", "NhSnapshotV2", "AccountStoreV2"):
        replacement = (root / (name + ".gs")).read_text()
        existing = next((f for f in files if f["name"] == name), None)
        if existing:
            if not existing["source"].startswith(replacement.splitlines()[0]):
                raise ValueError("A different private GAS file already uses the security module name")
            existing["type"] = "SERVER_JS"
            existing["source"] = replacement
        else:
            files.append({"name": name, "type": "SERVER_JS", "source": replacement})
    # First deploy happens before the public bootstrap data is removed. Keep the data
    # only in private GAS source; subsequent deployments preserve that private file.
    private_data = next((f for f in files if f["name"] == "SecurityData"), None)
    if os.environ.get("GAS_PROTECT_STATIC_HOLDINGS") == "true" and private_data and not private_data["source"].startswith("// Private protected holdings migrated"):
        raise ValueError("A different private GAS file already uses SecurityData")
    if os.environ.get("GAS_PROTECT_STATIC_HOLDINGS") == "true" and not private_data:
        public_data = (root.parent / "js" / "data.js").read_text()
        match = re.search(r"(?s)const H\s*=\s*(\[.*\]);\s*$", public_data)
        if not match:
            raise ValueError("Existing holdings were not recognized; stop instead of losing them")
        holdings = json.loads(match.group(1))
        if not isinstance(holdings, list) or not all(isinstance(row, list) and len(row) == 9 for row in holdings):
            raise ValueError("Existing holdings have an unexpected format")
        files.append({"name": "SecurityData", "type": "SERVER_JS", "source":
                      "// Private protected holdings migrated from the former bootstrap file.\nconst SECURITY_PROTECTED_HOLDINGS=" + json.dumps(holdings, ensure_ascii=False) + ";\n"})
    return files
