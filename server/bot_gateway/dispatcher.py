#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
调度器（二期）：三级白名单 → 限流 → 去重 → 引擎直调（import，不走 HTTP 自环）→ 计费 → 回复。

三级白名单（channel -> 层级1用户 / 层级2会话(群) / 拒绝）：
  配置 cfg["whitelist"] = {"telegram": {"users": [...], "chats": [...]}, ...}
  - users/chats 均为空 = 该平台允许所有人
  - 群聊消息先查 chats，再查 users（群成员级）
计费：成功回复后经 zf_billing.charge 记账（默认关闭，cfg["billing"]=true 开启）。
"""
import json
import os
import sys
import threading
import time

_SRV = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SRV not in sys.path:
    sys.path.insert(0, _SRV)

HIST_MAX = 12          # 每会话保留的历史条数（含回复）
RATE_PER_MIN = 10      # 每会话每分钟消息上限


class Dispatcher:
    def __init__(self, cfg):
        self.cfg = cfg or {}
        self._hist = {}                       # (channel,chat_id) -> [ {role,content} ]
        self._rate = {}                       # (channel,chat_id) -> [timestamps]
        self._seen = {}                       # 去重: (key,text) -> ts
        self._lock = threading.Lock()
        self._engine = None                   # 懒加载
        rl = (self.cfg.get("rate_limit") or {})
        self.rate_per_min = int(rl.get("per_chat_per_min", RATE_PER_MIN))
        self.billing = bool(self.cfg.get("billing", False))

    # ---------- 引擎 ----------
    def _load_engine(self):
        if self._engine is None:
            name = self.cfg.get("engine", "openclaw_style")
            mod = __import__(f"engines.{name}.engine", fromlist=["run"])
            self._engine = mod
            print(f"[bot_gateway] 引擎已加载: {name}")
        return self._engine

    # ---------- 计费 ----------
    def _charge(self, msg):
        """成功回复后计费记账。失败不影响回复。"""
        try:
            if not self.billing:
                return
            import zf_billing
            uid = 0
            try:
                uid = int(msg.user_id) if str(msg.user_id).isdigit() else 0
            except Exception:
                pass
            zf_billing.charge("bot", 1, user_id=uid,
                              request_id=f"bot_{msg.channel}_{msg.chat_id}_{int(time.time()*1000)}",
                              meta={"channel": msg.channel, "user_name": msg.user_name})
        except Exception as e:
            print(f"[bot_gateway] 计费记账失败（不影响回复）: {e}")

    # ---------- 三级白名单 ----------
    def _allowed(self, msg):
        wl = (self.cfg.get("whitelist") or {}).get(msg.channel)
        if not wl:
            return True                       # 未配置该平台白名单 = 允许所有人
        users = [str(u) for u in (wl.get("users") or [])]
        chats = [str(c) for c in (wl.get("chats") or [])]
        if chats and str(msg.chat_id) not in chats:
            return False                      # 层级2：会话(群)白名单
        if users and str(msg.user_id) not in users:
            return False                      # 层级1：用户白名单
        return True

    def _gc(self, now, max_age=600):
        """定期清理限流/去重过期数据（每会话窗口≤60s，10 分钟足够安全）"""
        self._seen = {k: t for k, t in self._seen.items() if now - t < max_age}
        for k in list(self._rate.keys()):
            stamps = [t for t in self._rate[k] if now - t < 60]
            if stamps:
                self._rate[k] = stamps
            else:
                del self._rate[k]

    def _engine_reply(self, msg, user_text):
        """import 直调引擎（不走 HTTP 自环），返回回复文本。"""
        eng = self._load_engine()
        key = msg.key()
        with self._lock:
            hist = self._hist.setdefault(key, [])
            if len(hist) > HIST_MAX:
                del hist[:-HIST_MAX]
        messages = [{"role": "system",
                     "content": f"渠道: {msg.channel}; 用户: {msg.user_name}({msg.user_id})"}]
        messages += hist
        messages.append({"role": "user", "content": user_text,
                         "_channel": msg.channel,
                         "_conv": f"{msg.channel}_{msg.chat_id}"})
        ctx = {"channel": msg.channel, "chat_id": msg.chat_id,
               "user_id": msg.user_id, "user_name": msg.user_name}
        resp = eng.run(messages, ctx)
        text = _extract_text(resp)
        with self._lock:
            hist.extend([{"role": "user", "content": user_text},
                         {"role": "assistant", "content": text}])
            if len(hist) > HIST_MAX:
                del hist[:-HIST_MAX]
        return text

    # ---------- 入口 ----------
    def handle(self, msg, adapter):
        if not msg.text:
            return
        if not self._allowed(msg):
            adapter.send_reply(msg, _BR("⛔ 你不在本 Bot 的白名单内。"))
            return
        now = time.time()
        with self._lock:
            stamps = [t for t in self._rate.get(msg.key(), []) if now - t < 60]
            if len(stamps) >= self.rate_per_min:
                return                        # 静默限流（防群聊刷屏）
            stamps.append(now)
            self._rate[msg.key()] = stamps
            dk = (msg.key(), msg.text)
            if now - self._seen.get(dk, 0) < 60:
                return                        # 60s 内同会话同文本去重
            self._seen[dk] = now
            self._gc(now)                      # 清理过期项，防长期运行内存增长
        try:
            # P2 审批推手机：白名单用户回复「同意 工具名」即完成 syscall.approve
            try:
                from bot_gateway import approve_hook
                _tool = approve_hook.parse_approve_reply(msg.text)
                if _tool:
                    from engines.common.syscall import approve as _approve
                    _approve(_tool, by='bot:%s:%s' % (msg.channel, msg.user_id))
                    adapter.send_reply(msg, _BR("✅ 已批准工具 %s（1小时内免重复确认）。" % _tool))
                    return
            except Exception as _ae:
                print(f"[bot_gateway] 审批指令处理失败: {_ae}")
            text = self._engine_reply(msg, msg.text)
        except Exception as e:
            # 失败不扣费：报错提示后直接返回，跳过 _charge
            adapter.send_reply(msg, _BR(f"⚠️ 处理失败: {e}"))
            return
        adapter.send_reply(msg, _BR(text))
        self._charge(msg)


def _extract_text(resp):
    """从 OpenAI 兼容响应提取文本。"""
    if resp is None:
        return ""
    if isinstance(resp, str):
        return resp
    if isinstance(resp, dict):
        ch = resp.get("choices") or [{}]
        m = (ch[0] or {}).get("message") or {}
        return m.get("content") or resp.get("content") or json.dumps(resp, ensure_ascii=False)[:2000]
    return str(resp)


class _BR:
    """轻量 BotReply（避免循环 import base）。"""
    __slots__ = ("text",)
    def __init__(self, text):
        self.text = text
