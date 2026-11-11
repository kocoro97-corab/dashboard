import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy_gas", Path(__file__).resolve().parents[1] / "tools/deploy_gas.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FakeGoogle:
    def __init__(self):
        self.base = "https://script.googleapis.com/v1/projects/test-script"
        self.original = [
            {"name": "Code", "type": "SERVER_JS", "source": "private code"},
            {"name": "Nhplug", "type": "SERVER_JS", "source": "old quote code"},
            {"name": "appsscript", "type": "JSON", "source": '{"timeZone":"Asia/Seoul"}'},
        ]
        self.head = copy.deepcopy(self.original)
        self.versions = {1: copy.deepcopy(self.head)}
        self.config = {"scriptId": "test-script", "versionNumber": 1, "manifestFileName": "appsscript", "description": "Keep description"}
        self.calls = []
        self.fail_deploy = False
        self.edit_during_read = False
        self.head_reads = 0
        self.stale_deployment_reads = 0
        self.previous_config = None

    def api(self, url, method="GET", payload=None):
        path = url.removeprefix(self.base)
        self.calls.append((method, path))
        if path == "/content":
            if method == "PUT":
                self.head = copy.deepcopy(payload["files"])
                return {"files": copy.deepcopy(self.head)}
            self.head_reads += 1
            if self.edit_during_read and self.head_reads == 2:
                self.head[0]["source"] = "concurrent private edit"
            return {"files": copy.deepcopy(self.head)}
        if path.startswith("/content?versionNumber="):
            return {"files": copy.deepcopy(self.versions[int(path.split("=")[1])])}
        if path == "/versions" and method == "POST":
            number = max(self.versions) + 1
            self.versions[number] = copy.deepcopy(self.head)
            return {"versionNumber": number}
        if path == "/deployments/test-deployment":
            if method == "PUT":
                if self.fail_deploy:
                    raise module.DeployError("Simulated deployment API failure")
                self.previous_config = copy.deepcopy(self.config)
                self.config = copy.deepcopy(payload["deploymentConfig"])
            if method == "GET" and self.previous_config and self.stale_deployment_reads:
                self.stale_deployment_reads -= 1
                return {"deploymentId": "test-deployment", "deploymentConfig": copy.deepcopy(self.previous_config),
                        "entryPoints": [{"entryPointType": "WEB_APP", "webApp": {"url": "https://example.test/exec"}}]}
            return {"deploymentId": "test-deployment", "deploymentConfig": copy.deepcopy(self.config),
                    "entryPoints": [{"entryPointType": "WEB_APP", "webApp": {"url": "https://example.test/exec"}}]}
        raise AssertionError((method, path))


class DeploymentTests(unittest.TestCase):
    replacement = "function handleNhExternalQuotes(token,codes) { return 'new'; }"

    @staticmethod
    def good_probe():
        return {"success": True, "version": "v7", "features": ["nhExternalQuotes"]}

    def run_deploy(self, fake, probe=None):
        return module.deploy(fake.api, "test-script", "test-deployment", self.replacement, "a" * 40, probe or self.good_probe)

    def test_only_nhplug_changes_and_deployment_settings_are_preserved(self):
        fake = FakeGoogle()
        result = self.run_deploy(fake)
        self.assertEqual(result, {"backup_version": 2, "previous_version": 1, "new_version": 3})
        self.assertEqual(fake.versions[2], fake.original)
        self.assertEqual(fake.head[0], fake.original[0])
        self.assertEqual(fake.head[2], fake.original[2])
        self.assertEqual(fake.head[1]["source"], self.replacement)
        self.assertEqual(fake.config["versionNumber"], 3)
        self.assertEqual(fake.config["description"], "Keep description")
        self.assertLess(fake.calls.index(("POST", "/versions")), fake.calls.index(("PUT", "/content")))

    def test_unpublished_other_files_stop_before_writes(self):
        fake = FakeGoogle()
        fake.head[0]["source"] = "unpublished private code"
        with self.assertRaisesRegex(module.DeployError, "unpublished"):
            self.run_deploy(fake)
        self.assertFalse(any(method != "GET" for method, path in fake.calls))

    def test_stale_deployment_get_is_retried_until_new_version_is_visible(self):
        fake = FakeGoogle()
        fake.stale_deployment_reads = 2
        with patch.object(module.time, "sleep") as sleep:
            result = self.run_deploy(fake)
        self.assertEqual(result["new_version"], 3)
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(fake.config["versionNumber"], 3)

    def test_concurrent_editor_is_never_overwritten(self):
        fake = FakeGoogle()
        fake.edit_during_read = True
        with self.assertRaisesRegex(module.DeployError, "changed during preparation"):
            self.run_deploy(fake)
        self.assertEqual(fake.head[0]["source"], "concurrent private edit")
        self.assertNotIn(("PUT", "/content"), fake.calls)
        self.assertEqual(fake.config["versionNumber"], 1)

    def test_deployment_failure_restores_original_source(self):
        fake = FakeGoogle()
        fake.fail_deploy = True
        with self.assertRaisesRegex(module.DeployError, "Simulated"):
            self.run_deploy(fake)
        self.assertEqual(fake.head, fake.original)
        self.assertEqual(fake.config["versionNumber"], 1)

    def test_post_deployment_smoke_failure_restores_source_and_deployment(self):
        fake = FakeGoogle()
        count = 0
        def probe():
            nonlocal count
            count += 1
            if count > 1:
                raise module.DeployError("Simulated web app failure")
            return self.good_probe()
        with patch.object(module.time, "sleep"), self.assertRaisesRegex(module.DeployError, "web app failure"):
            self.run_deploy(fake, probe)
        self.assertEqual(fake.head, fake.original)
        self.assertEqual(fake.config["versionNumber"], 1)

    def test_unrecognized_source_is_rejected_before_writes(self):
        fake = FakeGoogle()
        with self.assertRaisesRegex(module.DeployError, "not recognized"):
            module.deploy(fake.api, "test-script", "test-deployment", "invalid source", "a" * 40, self.good_probe)
        self.assertFalse(any(method != "GET" for method, path in fake.calls))


if __name__ == "__main__":
    unittest.main()
