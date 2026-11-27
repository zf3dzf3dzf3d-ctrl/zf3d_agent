# -*- coding: utf-8 -*-
"""
extensions/config_store.py - 扩展配置统一存取入口（根治按钮复发问题的模块）

背景（2026-11-07 复盘）：settings.py / ui_registry.py / market.py 各自拼接
private/extensions/settings.json 路径、各自读写，且 settings.py 的 _load()
只保留 mcp/skills 键，POST 保存时会把 ui.disabled 名单整体覆盖抹掉——
这是右下角扩展按钮反复复活的代码级根因（蜂群代码师/安全师共同定位）。

本模块提供：
  CONF_PATH  统一配置路径（唯一拼接点）
  LOCK       进程内全局写锁（RLock，允许同线程重入）
  load_raw() 读完整 dict（含未知键如 ui），失败返回 {} 并打日志
  save_raw() 写完整 dict（调用方自行先 load 再改再存，禁止盲写默认值）

⚠️ 铁律：任何模块写本文件必须走 load_raw → 改 → save_raw 全流程，
   严禁用 _DEFAULTS 构造新 dict 直接覆盖。
"""

import json
import os
import threading

from util_log import get_logger

log = get_logger('config_store')
_DIR = os.path.dirname(os.path.abspath(__file__))
CONF_PATH = os.path.join(os.path.dirname(_DIR), 'private', 'extensions', 'settings.json')

LOCK = threading.RLock()


def load_raw():
    """读完整配置 dict；文件缺失/损坏返回 {} 并打一条 warning 日志。"""
    try:
        with open(CONF_PATH, 'r', encoding='utf-8-sig') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except FileNotFoundError:
        _warn('settings.json 不存在（可能被清理误删），按空配置处理')
        return {}
    except Exception as e:
        _warn('settings.json 读取失败：%s' % e)
        return {}


def save_raw(d):
    """写完整配置 dict（带锁）。调用方必须先 load_raw 改完再传入。"""
    os.makedirs(os.path.dirname(CONF_PATH), exist_ok=True)
    with LOCK:
        with open(CONF_PATH, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)


def _warn(msg):
    try:
        log.info('[extensions:config_store] %s' % msg)
    except Exception:
        pass
