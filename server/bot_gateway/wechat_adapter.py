#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
微信公众号适配器（仅官方接口，禁用个人号协议）。

方式：公众平台服务器配置指向本适配器内置 HTTP 服务：
  URL: http://你的域名:8072/wechat     Token: 与配置一致
  - GET 验证签名 echostr
  - POST 收消息（XML），5 秒内必须响应 → 先回 "success"，再走客服接口异步回复
    （需公众号有客服接口权限；48 小时内互动过才可回复，符合官方规则）

配置（data/bot_tokens.json 的 wechat 段）：
{
  "wechat": {
    "app_id": "wx...",
    "app_secret": "...",
    "token": "自定义Token",           # 公众号服务器配置里的 Token
    "listen_port": 8072,
    "allowed_users": []               # openid 白名单，空=允许所有人
  }
}
注意：国内公众号需 ICP 备案域名/公网可访问；本机调试可用内网穿透。
"""
import hashlib
import json
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .base import BaseAdapter, BotMessage


class WechatAdapter(BaseAdapter):
    name = "wechat"
    MAX_LEN = 2000   # 公众号客服消息上限 2048 字节级，保守

    def __init__(self, cfg):
        super().__init__(cfg)
        self.app_id = cfg.get("app_id") or ""
        self.app_secret = cfg.get("app_secret") or ""
        self.token = cfg.get("token") or ""
        self.listen_port = int(cfg.get("listen_port") or 8072)
        self._access_token = ""
        self._tok_expire = 0
        self._srv = None

    # ---------- access_token ----------
    def _get_token(self):
        if self._access_token and time.time() < self._tok_expire - 60:
            return self._access_token
        url = ("https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential"
               f"&appid={self.app_id}&secret={self.app_secret}")
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.loads(r.read().decode("utf-8"))
        self._access_token = d.get("access_token") or ""
        self._tok_expire = time.time() + int(d.get("expires_in") or 7200)
        return self._access_token

    # ---------- 接收 ----------
    def fetch_loop(self, dispatcher):
        adapter = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _check_sig(self, qs):
                sig = qs.get("signature", [""])[0]
                ts = qs.get("timestamp", [""])[0]
                nonce = qs.get("nonce", [""])[0]
                raw = "".join(sorted([adapter.token, ts, nonce]))
                return hashlib.sha1(raw.encode("utf-8")).hexdigest() == sig

            def do_GET(self):
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                if self._check_sig(qs):
                    body = qs.get("echostr", [""])[0].encode("utf-8")
                else:
                    body = b"bad signature"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(self.path).query)
                ok = self._check_sig(qs)
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                    xml_data = self.rfile.read(n).decode("utf-8", errors="replace")
                except Exception:
                    xml_data = ""
                # 5 秒超时约束：立即应答，业务异步处理
                body = b"success"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                if not ok:
                    return
                try:
                    root = ET.fromstring(xml_data)
                    if root.findtext("MsgType") == "text":
                        uid = root.findtext("FromUserName") or ""
                        text = root.findtext("Content") or ""
                        if text.strip():
                            msg = BotMessage("wechat", uid, uid, "wechat_user", text, raw=xml_data)
                            threading.Thread(target=dispatcher.handle,
                                             args=(msg, adapter), daemon=True).start()
                except Exception as e:
                    print(f"[bot_gateway/wechat] 解析失败: {e}")

        self._srv = ThreadingHTTPServer(("0.0.0.0", self.listen_port), Handler)
        print(f"[bot_gateway/wechat] 公众号回调服务监听 0.0.0.0:{self.listen_port}（URL=/wechat）")
        self._srv.serve_forever()

    # ---------- 发送（客服接口，需48h内互动） ----------
    def _send(self, msg: BotMessage, text: str):
        try:
            tok = self._get_token()
            payload = {"touser": msg.user_id, "msgtype": "text",
                       "text": {"content": text}}
            req = urllib.request.Request(
                f"https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token={tok}",
                data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as r:
                d = json.loads(r.read().decode("utf-8", errors="replace"))
            if d.get("errcode") not in (0, None):
                print(f"[bot_gateway/wechat] 发送失败: {d}")
        except Exception as e:
            print(f"[bot_gateway/wechat] 发送异常: {e}")
