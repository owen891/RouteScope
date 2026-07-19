import json
import os
import time
import urllib.error
import urllib.request

APP = os.environ.get("APP_URL", "http://app:8418")
FIXTURE = os.environ.get("FIXTURE_URL", "http://onebot-fixture:5700")


def request(method, url, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = {"raw": raw}
        return exc.code, body


for _ in range(30):
    try:
        status, _ = request("GET", APP + "/healthz")
        if status == 200:
            break
    except Exception:
        pass
    time.sleep(1)
else:
    raise SystemExit("app health did not become ready")

config = json.dumps({
    "base_url": FIXTURE,
    "access_token": "uat-token",
    "message_type": "group",
    "group_id": "123456",
    "use_query_auth": False,
})
status, created = request("POST", APP + "/api/notifications/channels", {
    "name": "OneBot Compose UAT",
    "type": "qqbot",
    "config": config,
    "subscriptions": "[]",
    "enabled": True,
    "proxy_enabled": False,
})
if status != 200:
    raise SystemExit(f"create notification channel failed: HTTP {status}")
channel_id = created.get("data", {}).get("id")
if not channel_id:
    raise SystemExit("create notification channel returned no id")

status, result = request("POST", f"{APP}/api/notifications/channels/{channel_id}/test")
if status != 200 or not result.get("ok"):
    raise SystemExit(f"group Bearer test failed: HTTP {status}, error={result.get('error', '<missing>')}")
print("container group Bearer test: passed")

config = json.dumps({
    "base_url": FIXTURE,
    "access_token": "uat-token",
    "message_type": "private",
    "user_id": "10001",
    "use_query_auth": True,
})
status, updated = request("PUT", f"{APP}/api/notifications/channels/{channel_id}", {
    "name": "OneBot Compose UAT private",
    "type": "qqbot",
    "config": config,
    "subscriptions": "[]",
    "enabled": True,
    "proxy_enabled": False,
})
if status != 200:
    raise SystemExit(f"update private config failed: HTTP {status}")
status, result = request("POST", f"{APP}/api/notifications/channels/{channel_id}/test")
if status != 200 or not result.get("ok"):
    raise SystemExit(f"private query-auth test failed: HTTP {status}, error={result.get('error', '<missing>')}")
print("container private query-auth test: passed")

config = json.dumps({
    "base_url": FIXTURE,
    "access_token": "uat-token",
    "message_type": "group",
    "group_id": "999999",
    "use_query_auth": False,
})
status, _ = request("PUT", f"{APP}/api/notifications/channels/{channel_id}", {
    "name": "OneBot Compose UAT failure",
    "type": "qqbot",
    "config": config,
    "subscriptions": "[]",
    "enabled": True,
    "proxy_enabled": False,
})
if status != 200:
    raise SystemExit(f"update failure config failed: HTTP {status}")
status, result = request("POST", f"{APP}/api/notifications/channels/{channel_id}/test")
if status != 200 or result.get("ok") or "group not found" not in result.get("error", ""):
    raise SystemExit(f"expected business failure was not surfaced: HTTP {status}")
print("container business failure test: passed")
