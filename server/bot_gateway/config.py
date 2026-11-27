#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""配置加载：data/bot_tokens.json（不入 git，防 token 泄露）。"""
import copy
import json
import os

from util_log import get_logger

log = get_logger('config')
_SRV = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(_SRV, "data", "bot_tokens.json")

DEFAULT = {
    "telegram": {"token": "", "allowed_users": []},  # allowed_users 空=允许所有人
    "qq": {            # NapCat/OneBot v11（配了 api_base 即启用）
        "api_base": "", "access_token": "", "listen_port": 8071,
        "allowed_users": [], "allowed_groups": []
    },
    "wechat": {        # 微信公众号官方接口（配了 app_id 即启用；禁个人号）
        "app_id": "", "app_secret": "", "token": "", "listen_port": 8072,
        "allowed_users": []
    },
    "engine": "openclaw_style",   # 使用的引擎名（server/engines/ 下目录名）
    "rate_limit": {"per_chat_per_min": 10},
    "billing": False,             # true=成功回复后经 zf_billing 记账
    "whitelist": {                # 三级白名单：users=用户级，chats=会话/群级
        # allow_when_no_whitelist: 该平台未配置 users/chats 白名单时是否放行陌生人
        # （[安全] 默认 false=拒收，fail-closed；显式设 true 才回退为"允许所有人"）
        "telegram": {"users": [], "chats": [], "allow_when_no_whitelist": False},
        "qq": {"users": [], "chats": [], "allow_when_no_whitelist": False},
        "wechat": {"users": [], "chats": [], "allow_when_no_whitelist": False}
    },
}


def load_config():
    # [安全修复] deepcopy 防止浅拷贝下 cfg[k].update(v) 原地污染模块级 DEFAULT
    cfg = copy.deepcopy(DEFAULT)
    try:
        with open(CFG_PATH, "r", encoding="utf-8") as f:
            user_cfg = json.load(f)
        for k, v in user_cfg.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    except FileNotFoundError:
        pass
    except Exception as e:
        log.error(f"[bot_gateway] 配置读取失败({e})，使用默认配置")
    return cfg


def ensure_template():
    """首次运行生成模板文件（token 留空）。"""
    if not os.path.exists(CFG_PATH):
        os.makedirs(os.path.dirname(CFG_PATH), exist_ok=True)
        with open(CFG_PATH, "w", encoding="utf-8") as f:
            json.dump(DEFAULT, f, ensure_ascii=False, indent=2)
        log.info(f"[bot_gateway] 已生成配置模板: {CFG_PATH}（填入 token 后重启）")
