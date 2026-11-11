"""Replace Nhplug only, preserving private GAS files in runner memory, then redeploy."""
import copy
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


class DeployError(Exception):
    pass


def request_json(url, method="GET", payload=None, token=None, form=False):
    headers = {"Accept": "application/json"}
    data = None
    if token:
        headers["Authorization"] = "Bearer " + token
    if payload is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
        data = (urllib.parse.urlencode(payload) if form else json.dumps(payload)).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise DeployError("API request failed: HTTP " + str(error.code)) from None
    except (urllib.error.URLError, ValueError, TimeoutError):
        raise DeployError("API network or JSON response failed") from None


def google_token():
    try:
        config = json.loads(os.environ["CLASPRC_JSON"])
        credentials = config.get("tokens", {}).get("default", {})
        if not credentials and config.get("token") and config.get("oauth2ClientSettings"):
            settings = config["oauth2ClientSettings"]
            credentials = dict(config["token"], client_id=settings.get("clientId"),
                               client_secret=settings.get("clientSecret"))
        keys = ("client_id", "client_secret", "refresh_token")
        if not all(isinstance(credentials.get(k), str) and credentials[k] for k in keys):
            raise ValueError()
    except (KeyError, ValueError, TypeError, AttributeError):
        raise DeployError("Missing or invalid CLASPRC_JSON Actions secret") from None
    for key in ("client_secret", "refresh_token"):
        print("::add-mask::" + credentials[key].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A"))
    result = request_json("https://oauth2.googleapis.com/token", "POST",
                          dict((k, credentials[k]) for k in keys) | {"grant_type": "refresh_token"}, form=True)
    token = result.get("access_token")
    if not isinstance(token, str) or not token:
        raise DeployError("Google did not return an access token")
    print("::add-mask::" + token)
    return token


def clean_files(content):
    files = content.get("files", [])
    if not files or any(not all(k in f for k in ("name", "type", "source")) for f in files):
        raise DeployError("Invalid Apps Script source response")
    result = [{k: f[k] for k in ("name", "type", "source")} for f in files]
    if len({f["name"] for f in result}) != len(result):
        raise DeployError("Duplicate Apps Script file names")
    return result


def fingerprint(files, exclude=None):
    return sorted((f["name"], f["type"], f["source"]) for f in files if f["name"] != exclude)


def check_version_response(response):
    if not isinstance(response, dict) or not response.get("success") or "nhExternalQuotes" not in response.get("features", []):
        raise DeployError("The web app version endpoint did not report the required API feature")


def deploy(api, script_id, deployment_id, source, revision, probe, transform=None):
    base = "https://script.googleapis.com/v1/projects/" + script_id
    endpoint = base + "/deployments/" + deployment_id
    previous = api(endpoint)
    if previous.get("deploymentId") != deployment_id:
        raise DeployError("Deployment does not match this project")
    previous_config = previous["deploymentConfig"]
    old_version = previous_config.get("versionNumber")
    if not isinstance(old_version, int):
        raise DeployError("Existing deployment does not reference an immutable version")
    original = clean_files(api(base + "/content"))
    active = clean_files(api(base + "/content?versionNumber=" + str(old_version)))
    if fingerprint(original, "Nhplug") != fingerprint(active, "Nhplug"):
        raise DeployError("Other GAS files have unpublished changes; deployment stopped to preserve them")
    target = [f for f in original if f["name"] == "Nhplug" and f["type"] == "SERVER_JS"]
    if len(target) != 1 or "function handleNhExternalQuotes(" not in source:
        raise DeployError("Nhplug target or replacement source was not recognized")
    check_version_response(probe())
    desired = copy.deepcopy(original)
    next(f for f in desired if f["name"] == "Nhplug")["source"] = source
    if transform is not None:
        desired = transform(original, source)
    backup = api(base + "/versions", "POST", {"description": "Before Nhplug update " + revision[:12]})
    backup_version = backup["versionNumber"]
    print("Recovery source version: " + str(backup_version))
    print("Previous deployed version: " + str(old_version))
    touched = False
    new_version = None
    deployment_requested = False
    try:
        if fingerprint(clean_files(api(base + "/content"))) != fingerprint(original):
            raise DeployError("GAS source changed during preparation; stopped without overwriting it")
        touched = True  # A failed PUT can still have reached Google.
        api(base + "/content", "PUT", {"files": desired})
        if fingerprint(clean_files(api(base + "/content"))) != fingerprint(desired):
            raise DeployError("Uploaded source did not match the expected files")
        created = api(base + "/versions", "POST", {"description": "Nhplug from GitHub " + revision[:12]})
        new_version = created["versionNumber"]
        print("Created source version: " + str(new_version))
        immutable = clean_files(api(base + "/content?versionNumber=" + str(new_version)))
        if fingerprint(immutable) != fingerprint(desired):
            raise DeployError("Immutable version does not match the verified source")
        if api(endpoint)["deploymentConfig"] != previous_config:
            raise DeployError("Deployment changed concurrently; it was not overwritten")
        new_config = dict(previous_config, versionNumber=new_version)
        deployment_requested = True
        result = api(endpoint, "PUT", {"deploymentConfig": new_config})
        print("Update response version: " + str(result.get("deploymentConfig", {}).get("versionNumber")))
        if result.get("deploymentId") != deployment_id:
            raise DeployError("Deployment ID in the update response did not match")
        # Google may briefly return the former deployment after accepting an update.
        for attempt in range(10):
            confirmed = api(endpoint)
            observed_version = confirmed["deploymentConfig"].get("versionNumber")
            if str(observed_version) == str(new_version):
                break
            if attempt == 9:
                raise DeployError("Deployment version verification failed: expected " + str(new_version) + ", observed " + str(observed_version))
            time.sleep(3)
        before_urls = [p.get("webApp", {}).get("url") for p in previous.get("entryPoints", []) if p.get("entryPointType") == "WEB_APP"]
        after_urls = [p.get("webApp", {}).get("url") for p in confirmed.get("entryPoints", []) if p.get("entryPointType") == "WEB_APP"]
        if before_urls != after_urls:
            raise DeployError("Web app URL changed unexpectedly")
        for attempt in range(3):
            try:
                response = probe()
                check_version_response(response)
                if transform and response.get("securityVersion") != 1:
                    raise DeployError("The security entry point is not active on the web app")
                break
            except DeployError:
                if attempt == 2:
                    raise
                time.sleep(3)
        print("Security source update verified." if transform else "Nhplug source replacement verified; all other files preserved.")
        print("New deployed version: " + str(new_version))
        print("Existing web app URL preserved; appVersion response verified.")
        summary = {"backup_version": backup_version, "previous_version": old_version, "new_version": new_version}
        return summary
    except Exception:
        # Restore only our changes. Never overwrite a concurrent editor or deployment.
        recovery_ok = True
        if new_version is not None:
            try:
                current = api(endpoint)["deploymentConfig"]
                if str(current.get("versionNumber")) == str(new_version) or (deployment_requested and current == previous_config):
                    api(endpoint, "PUT", {"deploymentConfig": previous_config})
                elif current != previous_config:
                    recovery_ok = False
            except Exception:
                recovery_ok = False
        if touched:
            try:
                current_files = clean_files(api(base + "/content"))
                if fingerprint(current_files) == fingerprint(desired):
                    api(base + "/content", "PUT", {"files": original})
                elif fingerprint(current_files) != fingerprint(original):
                    recovery_ok = False
            except Exception:
                recovery_ok = False
        print("Recovery completed." if recovery_ok else "::warning::Automatic recovery incomplete; use the recovery source and previous deployment version above.")
        raise


def main():
    try:
        token = google_token()
        script_id = os.environ["GAS_SCRIPT_ID"]
        deployment_id = os.environ["GAS_DEPLOYMENT_ID"]
        source = Path("gas/Nhplug.gs").read_text()
        def api(url, method="GET", payload=None):
            return request_json(url, method, payload, token=token)
        def probe():
            url = "https://script.google.com/macros/s/" + deployment_id + "/exec"
            return request_json(url, "POST", {"action": "appVersion"})
        transform = None
        if os.environ.get("GAS_DEPLOY_SECURITY") == "true":
            from security_patch import apply_security
            transform = apply_security
        result = deploy(api, script_id, deployment_id, source, os.environ["GITHUB_SHA"], probe, transform=transform)
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as summary:
            summary.write("GAS security deployment verified.\n\n" if transform else "GAS deployment verified. Only Nhplug was replaced.\n\n")
            summary.write("Recovery version: {backup_version}; previous deployment: {previous_version}; new deployment: {new_version}.\n".format(**result))
            summary.write("The existing web app URL was retained. No source or credentials were logged or uploaded as artifacts.\n")
    except DeployError as error:
        print("::error::" + str(error))
        return 1
    except Exception:
        # Do not expose API response bodies, private source, or credentials.
        print("::error::Unexpected deployment failure. Consult the recovery version information above.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
