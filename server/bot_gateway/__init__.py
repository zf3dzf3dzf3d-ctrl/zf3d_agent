#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bot_gateway —— 外部聊天平台 Bot 接入层（一期）

架构：平台消息 → Adapter(网络层) → Dispatcher(路由/鉴权/去重) → 引擎 import 直调（不走 HTTP 自环）→ 回复 → Adapter → 平台

一期实现 Telegram 长轮询适配器；QQ/NapCat、微信公众号按 base.py 接口在二期/三期扩展。
配置：data/bot_tokens.json  {"telegram": {"token": "123:abc", "allowed_users": [uid,...]}}
启动：pythonw server/bot_gateway/__main__.py   （或 import bot_gateway; bot_gateway.start_all()）
"""

import os
import sys

_GW_DIR = os.path.dirname(os.path.abspath(__file__))
_SRV = os.path.dirname(_GW_DIR)
for p in (_SRV, os.path.join(_SRV, "zf_core")):
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

from .base import BaseAdapter, BotMessage, BotReply
from .dispatcher import Dispatcher

__all__ = ["BaseAdapter", "BotMessage", "BotReply", "Dispatcher", "start_all"]


def _load_adapters(cfg):
    """按配置加载可用适配器（一期只有 telegram，后续 append 即可）。"""
    adapters = []
    tg_cfg = (cfg or {}).get("telegram") or {}
    if tg_cfg.get("token"):
        from .telegram_adapter import TelegramAdapter
        adapters.append(TelegramAdapter(tg_cfg))
    return adapters


def start_all(block=True):
    """加载配置、启动全部已配置适配器。"""
    from .config import load_config
    cfg = load_config()
    adapters = _load_adapters(cfg)
    if not adapters:
        print("[bot_gateway] 无可用适配器：请在 data/bot_tokens.json 配置 token")
        return None
    dp = Dispatcher(cfg)
    threads = [a.start(dp) for a in adapters]
    if block:
        for t in threads:
            t.join()
    return dp
