#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""适配器抽象基类与统一消息模型。"""


class BotMessage:
    """平台无关的入站消息。"""
    __slots__ = ("channel", "chat_id", "user_id", "user_name", "text", "raw")

    def __init__(self, channel, chat_id, user_id, user_name, text, raw=None):
        self.channel = channel      # telegram / qq / wechat ...
        self.chat_id = chat_id      # 会话 id（私聊=用户，群聊=群号）
        self.user_id = str(user_id)
        self.user_name = user_name or ""
        self.text = (text or "").strip()
        self.raw = raw

    def key(self):
        return (self.channel, str(self.chat_id))


class BotReply:
    """平台无关的出站回复。text 可超长，由 adapter 负责分片。"""
    __slots__ = ("text",)

    def __init__(self, text):
        self.text = str(text or "")


class BaseAdapter:
    """平台适配器接口：子类实现 fetch_loop / send_reply / split。"""
    name = "base"
    MAX_LEN = 3800  # 分片上限（TG 上限 4096，留余量）

    def __init__(self, cfg):
        self.cfg = cfg or {}

    def start(self, dispatcher):
        """启动收消息循环（后台线程），返回 threading.Thread。"""
        import threading
        t = threading.Thread(target=self._run, args=(dispatcher,), daemon=True,
                             name=f"botgw-{self.name}")
        t.start()
        return t

    def _run(self, dispatcher):
        while True:
            try:
                self.fetch_loop(dispatcher)
            except Exception as e:
                print(f"[bot_gateway/{self.name}] 循环异常，10s 后重连: {e}")
                import time
                time.sleep(10)

    # ---- 子类必须实现 ----
    def fetch_loop(self, dispatcher):
        """阻塞式收消息循环：收到消息 → dispatcher.handle(BotMessage, self)。"""
        raise NotImplementedError

    def send_reply(self, msg: BotMessage, reply: BotReply):
        """发送回复，超长自动分片。"""
        for chunk in self.split(reply.text):
            self._send(msg, chunk)

    def _send(self, msg: BotMessage, text: str):
        raise NotImplementedError

    def split(self, text):
        text = str(text or "")
        n = self.MAX_LEN
        return [text[i:i + n] for i in range(0, len(text), n)] or [""]
