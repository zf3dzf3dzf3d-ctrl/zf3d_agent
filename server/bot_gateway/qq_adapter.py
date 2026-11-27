#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QQ 适配器（NapCat / OneBot v11）。

方式：NapCat 开启 HTTP 上报（http POST event 到本适配器内置小 HTTP 服务），
发送走 NapCat 的 HTTP API（http://host:port/send_private_msg、/send_group_msg）。

配置（data/bot_tokens.json 的 qq 段）：
{
  "qq": {
    "api_base": "http://127.0.0.1:3000",   # NapCat HTTP API 地址
    "access_token": "",                     # 可选，NapCat 的 token；配置后本适配器的
                                            # 上报端点也要求同 token（Bearer 头或参数）
    "listen_port": 8071,                    # 本适配器接收上报的端口
    "allowed_users": [],                    # 三级白名单：QQ 号列表，空=允许所有人
    "allowed_groups": []                    # 群白名单，空=允许所有群
  }
}
NapCat 侧配置 HTTP 上报地址：http://127.0.0.1:8071/onebot
"""
import hmac
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .base import BaseAdapter, BotMessage


from util_log import get_logger

log = get_logger('qq_adapter')
def _post_json(url, payload, token="", timeout=30):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", errors="replace"))


class QQAdapter(BaseAdapter):
    name = "qq"
    MAX_LEN = 4500   # QQ 消息上限较宽松

    def __init__(self, cfg):
        super().__init__(cfg)
        self.api_base = (cfg.get("api_base") or "http://127.0.0.1:3000").rstrip("/")
        self.token = cfg.get("access_token") or ""
        self.listen_port = int(cfg.get("listen_port") or 8071)
        self._srv = None

    # ---------- 接收 ----------
    def fetch_loop(self, dispatcher):
        """启动内置 HTTP 服务接收 NapCat 上报（阻塞）。"""
        adapter = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _check_token(self):
                """[安全] 配置了 access_token 则校验 OneBot 上报请求：
                要求请求头 Authorization: Bearer <token> 或 ?access_token= 参数匹配。"""
                if not adapter.token:
                    return True
                got = ""
                auth = self.headers.get("Authorization") or ""
                if auth.lower().startswith("bearer "):
                    got = auth[7:].strip()
                if not got:
                    from urllib.parse import urlparse, parse_qs
                    got = (parse_qs(urlparse(self.path).query)
                           .get("access_token") or [""])[0]
                return hmac.compare_digest(got.encode("utf-8"),
                                           adapter.token.encode("utf-8"))

            def _reply_json(self, code, obj):
                body = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                if not self._check_token():
                    self._reply_json(401, {"status": "failed",
                                           "retcode": 401,
                                           "message": "invalid access_token"})
                    return
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                    event = json.loads(self.rfile.read(n).decode("utf-8", errors="replace"))
                except Exception:
                    self.send_response(400); self.end_headers(); return
                # [安全] 过滤自身消息（user_id == self_id），防止 Bot 自问答死循环
                if (event.get("post_type") == "message"
                        and str(event.get("user_id") or "") != str(event.get("self_id") or "")
                        and not event.get("sub_type") == "bot_self_offline"):
                    uid = str(event.get("user_id") or "")
                    gid = event.get("group_id")
                    text = ""
                    for seg in event.get("message") or []:
                        if seg.get("type") == "text":
                            text += seg.get("data", {}).get("text", "")
                    if text.strip():
                        msg = BotMessage("qq", gid if gid else uid, uid,
                                         event.get("sender", {}).get("nickname") or uid,
                                         text, raw=event)
                        dispatcher.handle(msg, adapter)
                body = json.dumps({"status": "ok"}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self._srv = ThreadingHTTPServer(("127.0.0.1", self.listen_port), Handler)
        log.info(f"[bot_gateway/qq] 上报服务监听 127.0.0.1:{self.listen_port}（NapCat 上报地址 /onebot，仅本机可达）")
        self._srv.serve_forever()

    # ---------- 发送 ----------
    def _send(self, msg: BotMessage, text: str):
        payload = {"message": text, "auto_escape": False}
        if str(msg.chat_id).isdigit() and msg.raw and msg.raw.get("group_id"):
            payload["group_id"] = int(msg.chat_id)
            url = f"{self.api_base}/send_group_msg"
        else:
            payload["user_id"] = int(msg.user_id)
            url = f"{self.api_base}/send_private_msg"
        try:
            _post_json(url, payload, self.token)
        except Exception as e:
            log.error(f"[bot_gateway/qq] 发送失败: {e}")
