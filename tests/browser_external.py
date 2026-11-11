"""Synthetic mobile UI regression. All Google/NH/CDN traffic is intercepted."""
import base64
import copy
import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
pixel = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3X8AAAAASUVORK5CYII=")
with sync_playwright() as playwright:
    launch = {"headless": True}
    if os.environ.get("CHROMIUM_EXECUTABLE"):
        launch["executable_path"] = os.environ["CHROMIUM_EXECUTABLE"]
    browser = playwright.chromium.launch(**launch)
    for kind, width in [("isa", 344), ("pension", 690), ("irp", 344)]:
        fixture = json.loads((ROOT / "tests/fixtures" / (kind + "-ocr.json")).read_text())
        initial = dict(fixture["expected"][0], accountType=fixture["accountType"], source="saved", quantity=777, avgPrice=888)
        state = {"rows": [initial], "revision": 1, "history": [], "save_calls": 0,
                 "quote_mode": "nh" if kind == "isa" else "http" if kind == "pension" else "network"}
        page = browser.new_page(viewport={"width": width, "height": 882}, is_mobile=True)
        master_date=json.loads((ROOT / "data/krx-instruments.json").read_text())["source"]["fetchedAt"]
        page.clock.install(time=datetime.datetime.fromisoformat(master_date))
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        dialog = {"accept": True}
        page.on("dialog", lambda prompt: prompt.accept() if dialog["accept"] else prompt.dismiss())

        def fulfill(route, data, status=200):
            route.fulfill(status=status, headers={"Access-Control-Allow-Origin": "*"}, content_type="application/json", body=json.dumps(data))

        def route_request(route):
            url = route.request.url
            if "127.0.0.1" in url:
                if "/js/init.js" in url:
                    # Keep definitions, isolate unrelated market/chart initialization.
                    route.fulfill(content_type="application/javascript", body=(ROOT / "js/init.js").read_text().replace("async function initDashboard(", "async function disabledInitDashboard("))
                else:
                    route.continue_()
                return
            if "script.google.com/macros/" not in url:
                route.fulfill(status=200, content_type="application/javascript" if route.request.resource_type == "script" else "text/plain", body="")
                return
            body = json.loads(route.request.post_data or "{}")
            action = body.get("action")
            if action == "externalHoldings":
                fulfill(route, {"success": True, "holdings": state["rows"], "revision": "r" + str(state["revision"]), "storeVersion": 2})
            elif action == "nhExternalQuotes":
                if state["quote_mode"] == "network":
                    route.abort()
                elif state["quote_mode"] == "http":
                    fulfill(route, {"success": False}, 503)
                else:
                    prices = {code: {"price": 300, "name": "fixture quote"} for code in body["codes"]}
                    errors, diagnostics = {}, {}
                    if state["quote_mode"] == "nh" and body["codes"]:
                        code = body["codes"][0]
                        del prices[code]
                        errors[code] = "nh / NH_RSP / HTTP 200 / rsp_cd 00999"
                        diagnostics[code] = {"layer": "nh", "code": "NH_RSP", "http": 200, "rspCode": "00999"}
                    fulfill(route, {"success": True, "prices": prices, "errors": errors, "diagnostics": diagnostics})
            elif action in ("saveExternalHoldings", "restoreExternalHoldings"):
                assert body["confirmReplace"] is True
                assert body["expectedRevision"] == "r" + str(state["revision"])
                before = copy.deepcopy(state["rows"])
                if action == "saveExternalHoldings":
                    state["save_calls"] += 1
                    after = body["holdings"]
                else:
                    after = next(x["holdings"] for x in state["history"] if x["snapshotId"] == body["snapshotId"])
                state["history"].insert(0, {"snapshotId": "fixture-" + str(state["revision"]), "createdAt": "fixture timestamp", "reason": action, "holdings": before})
                state["rows"] = copy.deepcopy(after)
                state["revision"] += 1
                fulfill(route, {"success": True, "count": len(after), "revision": "r" + str(state["revision"]), "storeVersion": 2})
            elif action == "externalHistory":
                fulfill(route, {"success": True, "history": state["history"]})
            elif action == "nhAccounts":
                first = fixture["expected"][0]
                fulfill(route, {"success": True, "updatedAt": "fixture timestamp", "accounts": [{"acctType": "01", "domestic": {"summary": {"evalAmount": 1500, "profit": 0}, "holdings": [{"name": first["name"], "code": first["code"], "quantity": 5, "avgPrice": 300, "currentPrice": 300, "evalAmount": 1500, "profit": 0, "currency": "KRW"}]}}]})
            else:
                fulfill(route, {"success": True})

        page.route("**/*", route_request)
        page.goto("http://127.0.0.1:" + str(server.server_port), wait_until="networkidle")
        page.evaluate("""()=>{LS('invest_session_token','synthetic-session');$('authGuard').style.display='none';$('appContainer').style.display='block'}""")
        page.evaluate("loadExternalAssets()")
        assert page.locator("#externalAssetRows tr").count() == 1
        assert page.evaluate("EXT_ASSETS[0].quantity") == 777
        page.locator("#externalQuoteDiagnostics").evaluate("element=>element.parentElement.open=true")
        diagnostic = page.locator("#externalQuoteDiagnostics").inner_text()
        assert ("NH_RSP" if kind == "isa" else "GAS_HTTP" if kind == "pension" else "FRONTEND_NETWORK") in diagnostic, {'account':kind,'diagnostic':diagnostic,'status':page.locator('#externalStatus').inner_text(),'master':page.evaluate('EXT_MASTER_ERROR'),'errors':errors}
        assert page.locator("#externalAssetRows tr td").nth(5).inner_text() == "시세 미확인"
        page.select_option("#externalAccountType", fixture["accountType"])
        page.evaluate("data=>{window.Tesseract={recognize:async()=>({data})}}", fixture["data"])
        page.locator("#externalImageFiles").set_input_files({"name": "synthetic.png", "mimeType": "image/png", "buffer": pixel})
        dialog["accept"] = False
        page.click("#externalUploadBtn")
        page.wait_for_function("!$('externalUploadBtn').disabled")
        assert page.evaluate("EXT_ASSETS.length") == 1
        assert page.evaluate("EXT_ASSETS[0].quantity") == 777
        dialog["accept"] = True
        page.click("#externalUploadBtn")
        page.wait_for_function("!$('externalUploadBtn').disabled")
        expected_count = len(fixture["expected"])
        assert page.locator("#externalAssetRows tr").count() == expected_count
        assert page.evaluate("EXT_ASSETS[0].quantity") == 101
        page.click("#externalUploadBtn")
        page.wait_for_function("!$('externalUploadBtn').disabled")
        assert page.evaluate("EXT_ASSETS.length") == expected_count
        page.locator("#externalAssetRows tr").first.locator("button").click()
        assert page.evaluate("EXT_ASSETS.length") == expected_count - 1
        page.click("#externalUndoBtn")
        assert page.evaluate("EXT_ASSETS.length") == expected_count
        dialog["accept"] = False
        page.click("#externalSaveBtn")
        assert state["save_calls"] == 0
        dialog["accept"] = True
        page.click("#externalSaveBtn")
        page.wait_for_function("$('externalStatus').textContent.includes('저장 완료')")
        assert state["save_calls"] == 1
        page.locator("#externalAssetRows tr").first.locator("button").click()
        page.click("#externalSaveBtn")
        page.wait_for_function("$('externalStatus').textContent.includes('저장 완료')")
        page.evaluate("showExternalHistory()")
        page.locator("#externalHistory").evaluate("element=>element.parentElement.open=true")
        page.locator("#externalHistory button").first.click()
        page.wait_for_function("$('externalStatus').textContent.includes('복원 완료')")
        assert page.evaluate("EXT_ASSETS.length") == expected_count
        state["quote_mode"] = "success"
        page.evaluate("refreshExternalPrices(true)")
        assert page.locator("#externalQuoteDiagnostics").inner_text() == ""
        assert page.locator("#externalAssetRows tr").first.locator("td").nth(5).inner_text() == "300"
        page.evaluate("loadNHAccounts()")
        page.wait_for_function("!EXT_PRICE_BUSY")
        assert page.evaluate("NH_ACCOUNTS.length") == 1
        assert page.locator("#nhAccountRows tr").count() == 1
        page.clock.set_system_time(datetime.datetime.fromisoformat(master_date)+datetime.timedelta(days=31))
        page.evaluate("loadExternalMaster()")
        assert page.evaluate("EXT_MASTER===null")
        page.evaluate("refreshExternalPrices(true)")
        assert page.locator("#externalAssetRows tr").first.locator("td").nth(5).inner_text()=="시세 미확인"
        assert page.evaluate("NH_ACCOUNTS.length")==1
        page.evaluate("logout()")
        assert page.evaluate("EXT_ASSETS.length") == 0
        assert page.evaluate("EXT_UNDO.length") == 0
        assert page.evaluate("EXT_HISTORY.length") == 0
        assert page.locator("#externalHistory").inner_text() == ""
        assert not errors, errors
        page.close()
        print("PASS:", kind.upper(), "mobile import confirmation, duplicate prevention, undo, confirmed save/restore, classified quote failure, NH general query, and logout isolation")
    browser.close()
server.shutdown()
