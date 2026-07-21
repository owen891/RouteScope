#!/usr/bin/env python3
"""Temporary QQ official bot gateway to capture openids for UpstreamOps setup.

Does not log into a personal QQ account. Uses AppID/AppSecret only.
Writes captures to /opt/qqofficial-openid.jsonl
"""

from __future__ import annotations

import json
import os
import ssl
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

try:
    import websocket  # type: ignore
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "websocket-client"])
    import websocket  # type: ignore

APP_ID = os.environ.get("QQ_APP_ID", "").strip()
APP_SECRET = os.environ.get("QQ_APP_SECRET", "").strip()
TOKEN_URL = os.environ.get("QQ_TOKEN_URL", "https://bots.qq.com/app/getAppAccessToken")
OPENAPI = os.environ.get("QQ_OPENAPI_BASE_URL", "https://api.sgroup.qq.com").rstrip("/")
OUT = Path(os.environ.get("QQ_CAPTURE_OUT", "/opt/qqofficial-openid.jsonl"))
STATE = Path(os.environ.get("QQ_CAPTURE_STATE", "/opt/qqofficial-capture.state.json"))

# Best-effort intents for group / C2C / public events. Platform may ignore unsupported bits.
INTENTS = (1 << 25) | (1 << 12) | (1 << 30)


def http_json(url: str, method: str = "GET", data=None, headers=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode() or "{}")


def get_token() -> str:
    if not APP_SECRET:
        raise RuntimeError("QQ_APP_SECRET is empty")
    data = http_json(TOKEN_URL, method="POST", data={"appId": APP_ID, "clientSecret": APP_SECRET})
    tok = data.get("access_token")
    if not tok:
        raise RuntimeError(f"token failed: {data}")
    return tok


def get_gateway(token: str) -> dict:
    last = None
    for path in ("/gateway", "/gateway/bot"):
        try:
            data = http_json(OPENAPI + path, headers={"Authorization": f"QQBot {token}"})
            if data.get("url"):
                return data
            last = data
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"gateway failed: {last}")


class Bot:
    def __init__(self) -> None:
        self.token = get_token()
        self.token_at = time.time()
        self.session_id = None
        self.last_seq = None
        if STATE.exists():
            try:
                st = json.loads(STATE.read_text(encoding="utf-8"))
                self.session_id = st.get("session_id")
                self.last_seq = st.get("last_seq")
            except Exception:  # noqa: BLE001
                pass

    def save_state(self) -> None:
        STATE.write_text(
            json.dumps({"session_id": self.session_id, "last_seq": self.last_seq}, ensure_ascii=False),
            encoding="utf-8",
        )

    def refresh_token_if_needed(self) -> None:
        if time.time() - self.token_at > 6000:
            self.token = get_token()
            self.token_at = time.time()

    def record(self, kind: str, payload: dict) -> None:
        row = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "kind": kind,
            "payload": payload,
        }
        with OUT.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print("CAPTURE", json.dumps(row, ensure_ascii=False), flush=True)

    def handle_dispatch(self, t: str | None, d: dict | None) -> None:
        d = d or {}
        if t == "READY":
            self.session_id = d.get("session_id")
            user = d.get("user") or {}
            print(
                f"READY bot={user.get('username')} id={user.get('id')} session={self.session_id}",
                flush=True,
            )
            self.save_state()
            return
        if t == "RESUMED":
            print("RESUMED", flush=True)
            return

        group_openid = d.get("group_openid") or d.get("group_id")
        author = d.get("author") or {}
        user_openid = (
            author.get("user_openid")
            or author.get("member_openid")
            or author.get("id")
            or d.get("author_openid")
            or d.get("openid")
        )
        content = d.get("content")
        if group_openid or user_openid:
            self.record(
                t or "UNKNOWN",
                {
                    "group_openid": group_openid,
                    "user_openid": user_openid,
                    "content": content,
                    "message_id": d.get("id"),
                },
            )
        elif t and t not in ("READY", "RESUMED"):
            self.record((t or "UNKNOWN") + "_raw", {"keys": list(d.keys())[:30]})

    def run(self) -> None:
        while True:
            try:
                self.refresh_token_if_needed()
                gw = get_gateway(self.token)
                url = gw["url"]
                print("connecting", url, flush=True)
                self._connect(url)
            except Exception as e:  # noqa: BLE001
                print("loop error:", e, flush=True)
                time.sleep(5)

    def _connect(self, url: str) -> None:
        bot = self

        def on_open(ws):  # noqa: ANN001
            print("ws open", flush=True)

        def on_message(ws, message):  # noqa: ANN001
            pkt = json.loads(message)
            op = pkt.get("op")
            s = pkt.get("s")
            if isinstance(s, int):
                bot.last_seq = s
                bot.save_state()
            if op == 10:  # hello
                interval = int(((pkt.get("d") or {}).get("heartbeat_interval") or 30000))

                def hb() -> None:
                    while True:
                        time.sleep(interval / 1000)
                        try:
                            ws.send(json.dumps({"op": 1, "d": bot.last_seq}))
                        except Exception:  # noqa: BLE001
                            return

                threading.Thread(target=hb, daemon=True).start()
                identify = {
                    "op": 2,
                    "d": {
                        "token": f"QQBot {bot.token}",
                        "intents": INTENTS,
                        "shard": [0, 1],
                        "properties": {
                            "$os": "linux",
                            "$browser": "upstream-ops",
                            "$device": "upstream-ops",
                        },
                    },
                }
                ws.send(json.dumps(identify))
                print("identify sent intents=", INTENTS, flush=True)
            elif op == 0:
                bot.handle_dispatch(pkt.get("t"), pkt.get("d"))
            elif op == 7:
                print("reconnect requested", flush=True)
                ws.close()
            elif op == 9:
                print("invalid session", flush=True)
                bot.session_id = None
                bot.save_state()
                ws.close()
            elif op == 11:
                pass

        def on_error(ws, err):  # noqa: ANN001
            print("ws error", err, flush=True)

        def on_close(ws, *a):  # noqa: ANN001
            print("ws close", a, flush=True)

        ws = websocket.WebSocketApp(
            url,
            on_open=on_open,
            on_message=on_message,
            on_error=on_error,
            on_close=on_close,
        )
        ws.run_forever(sslopt={"cert_reqs": ssl.CERT_NONE}, ping_interval=20, ping_timeout=10)


if __name__ == "__main__":
    if not APP_ID or not APP_SECRET:
        raise SystemExit("QQ_APP_ID and QQ_APP_SECRET are required")
    print("starting qq official openid capture for app", APP_ID, flush=True)
    Bot().run()
