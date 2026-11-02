#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Telegram 长轮询适配器（仅标准库 urllib，无第三方依赖；国内网络需系统代理）。"""
import json
import time
import urllib.request

from .base import BaseAdapter, BotMessage

API = "https://api.telegram.org/bot{token}/{method}"
PROXY_HOSTS = ("api.telegram.org",)


def _opener():
    """优先系统代理（HTTP_PROXY/HTTPS_PROXY 环境变量），否则直连。"""
    return urllib.request.build_opener()


class TelegramAdapter(BaseAdapter):
    name = "telegram"
    MAX_LEN = 3800

    def __init__(self, cfg):
        super().__init__(cfg)
        self.token = cfg["token"]
        self._offset = 0
        self._opener = _opener()

    def _call(self, method, payload=None, timeout=70):
        req = urllib.request.Request(
            API.format(token=self.token, method=method),
            data=json.dumps(payload or {}).encode("utf-8"),
            headers={"Content-Type": "application/json"})
        with self._opener.open(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
        if not data.get("ok"):
            raise RuntimeError(f"TG API error: {data}")
        return data["result"]

    def fetch_loop(self, dispatcher):
        # 清 getUpdates 积压 webhook 冲突
        try:
            self._call("deleteWebhook", {"drop_pending_updates": False}, timeout=15)
        except Exception:
            pass
        while True:
            updates = self._call("getUpdates",
                                 {"offset": self._offset, "timeout": 50,
                                  "allowed_updates": ["message"]}) or []
            for u in updates:
                self._offset = u["update_id"] + 1
                m = u.get("message") or {}
                if not m.get("text"):
                    continue
                frm = m.get("from") or {}
                msg = BotMessage(
                    channel="telegram",
                    chat_id=m["chat"]["id"],
                    user_id=frm.get("id", ""),
                    user_name=frm.get("first_name", "") + (frm.get("last_name") or ""),
                    text=m["text"], raw=m)
                dispatcher.handle(msg, self)

    def _send(self, msg: BotMessage, text: str):
        self._call("sendMessage",
                   {"chat_id": msg.chat_id, "text": text or "(空回复)",
                    "parse_mode": ""}, timeout=30)
