import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = "uat-token"

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            self.reply({"status": "ok", "retcode": 0}, 200)
        else:
            self.reply({"status": "failed", "retcode": 404, "wording": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.reply({"status": "failed", "retcode": 400, "wording": "invalid json"}, 400)
            return
        authorization = self.headers.get("Authorization", "")
        token = ""
        if authorization.startswith("Bearer "):
            token = authorization[len("Bearer "):]
        elif "?access_token=" in self.path:
            token = self.path.split("?access_token=", 1)[1].split("&", 1)[0]
        if token != TOKEN:
            self.reply({"status": "failed", "retcode": 401, "wording": "unauthorized"}, 401)
            return
        endpoint = self.path.split("?", 1)[0]
        if endpoint == "/send_group_msg":
            target = str(body.get("group_id", ""))
            if target == "123456":
                self.reply({"status": "ok", "retcode": 0, "message_id": 7001}, 200)
            elif target == "999999":
                self.reply({"status": "failed", "retcode": 100, "wording": "group not found"}, 200)
            else:
                self.reply({"status": "failed", "retcode": 100, "wording": "group target invalid"}, 200)
            return
        if endpoint == "/send_private_msg":
            if str(body.get("user_id", "")) == "10001":
                self.reply({"status": "ok", "retcode": 0, "message_id": 7002}, 200)
            else:
                self.reply({"status": "failed", "retcode": 100, "wording": "user target invalid"}, 200)
            return
        self.reply({"status": "failed", "retcode": 404, "wording": "not found"}, 404)

    def reply(self, body, status):
        encoded = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format, *_args):
        return

ThreadingHTTPServer(("0.0.0.0", 5700), Handler).serve_forever()
