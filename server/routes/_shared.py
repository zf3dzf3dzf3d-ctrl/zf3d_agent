# -*- coding: utf-8 -*-
"""路由模块共享依赖：常量、锁、缓存、通用 import。
所有 routes/mixin_*.py 通过 `from routes._shared import *` 取得所需名称。"""
import os
import sys
import json
import ssl
import socket
import time
import shutil
import subprocess
import threading
import traceback
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs

from config import BASE_DIR, DB_PATH, CONFIG_PATH, PUBLIC_DIR, MIME_TYPES, HOST, PORT, _db_lock, VERSION
from db import get_db, init_db

# 循环模式配置 json 路径（前端可读可写）
_LOOP_MODE_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'chat_loop_mode.json'
)
_LOOP_MODE_CONFIG_LOCK = threading.Lock()

# 健康守护配置 json 路径
_HEALTH_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'health_guard.json'
)
_HEALTH_CONFIG_LOCK = threading.Lock()

# 工具结果出口限额配置 json 路径
_TOOL_RESULT_LIMITS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'tool_result_limits.json'
)
_TOOL_RESULT_LIMITS_LOCK = threading.Lock()

# ===== 用户设置 =====
_USER_SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', '用户设置', 'user_settings.json'
)
_USER_SETTINGS_LOCK = threading.Lock()
_USER_SETTINGS_MAX_KEYS = 500

_USER_PREFERENCES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', '用户设置', 'user_preferences.json')
_USER_PREFERENCES_LOCK = threading.Lock()

# ===== 画布背景/特效配置（独立 JSON，避免混入主设置） =====
_BACKGROUND_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', '用户设置', 'background.json')
_BACKGROUND_LOCK = threading.Lock()

# ===== 工作日志（AI 每完成一个任务自动记录，按日期归档，供对话时注入"今天做了什么"）=====
_WORKLOG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', '用户设置', 'worklog.json'
)
_WORKLOG_LOCK = threading.Lock()
_WORKLOG_MAX_DAYS = 30
_WORKLOG_MAX_ENTRIES_PER_DAY = 200

# 提示词注入相关路径与缓存
_PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public')
_PROMPTS_CACHE = {}  # {mode_id_str: (mtime, content)}
_PROMPTS_CACHE_LOCK = threading.Lock()
_LOOP_MODE_DIR = {
    '1': '模式1_直接聊天',
    '2': '模式2_工具循环',
}

# 全局复用 SSL 上下文：默认严格校验证书（防中间人窃取 API Key）。
# 如确有自签名证书需求，可在 private/port.json 加 "ssl_verify": false 关闭。
_SSL_CTX = ssl.create_default_context()
try:
    _verify_cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'private', 'port.json')
    _verify_cfg = json.load(open(_verify_cfg_path, 'r', encoding='utf-8-sig')) if os.path.exists(_verify_cfg_path) else {}
    if isinstance(_verify_cfg, dict) and _verify_cfg.get('ssl_verify') is False:
        _SSL_CTX.check_hostname = False
        _SSL_CTX.verify_mode = ssl.CERT_NONE
        print('[Security] WARNING: SSL certificate verification is DISABLED (ssl_verify=false)')
except Exception:
    pass

# ===== SSRF 防护：禁止代理请求打到内网/本机 =====
def _ssrf_check_url(url):
    """校验代理目标 URL，内网地址返回 False。本机自身端口放行（前端代理自身模型端点）。"""
    try:
        p = urlparse(url)
        host = (p.hostname or '').lower()
        if not host:
            return False
        if host in ('localhost',):
            return True  # 本机模型代理属正常用途
        if host == '127.0.0.1' or host == '::1':
            return True
        import ipaddress as _ip
        try:
            ip = _ip.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                # 允许 127.0.0.1 本机端口（本地模型如 Ollama）
                return ip.is_loopback
            return True
        except ValueError:
            pass  # 域名
        # 防域名解析到内网的简单拦截：阻止明显的内网域名段
        if host.endswith(('.internal', '.local', '.lan', '.corp')):
            return False
        return True
    except Exception:
        return False


# ===== 对话模式限制规则 =====
try:
    import chat_mode_rules
except Exception as _e:
    print('[ModeRules] import failed: %s' % _e)
    chat_mode_rules = None

__all__ = [
    'os', 'sys', 'json', 'ssl', 'socket', 'time', 'shutil', 'subprocess',
    'threading', 'traceback', 'urllib', 'urlparse', 'parse_qs',
    'BASE_DIR', 'DB_PATH', 'CONFIG_PATH', 'PUBLIC_DIR', 'MIME_TYPES', 'HOST', 'PORT',
    '_db_lock', 'VERSION', 'get_db', 'init_db',
    '_LOOP_MODE_CONFIG_PATH', '_LOOP_MODE_CONFIG_LOCK',
    '_HEALTH_CONFIG_PATH', '_HEALTH_CONFIG_LOCK',
    '_TOOL_RESULT_LIMITS_PATH', '_TOOL_RESULT_LIMITS_LOCK',
    '_USER_SETTINGS_PATH', '_USER_SETTINGS_LOCK', '_USER_SETTINGS_MAX_KEYS',
    '_USER_PREFERENCES_PATH', '_USER_PREFERENCES_LOCK',
    '_BACKGROUND_PATH', '_BACKGROUND_LOCK',
    '_WORKLOG_PATH', '_WORKLOG_LOCK', '_WORKLOG_MAX_DAYS', '_WORKLOG_MAX_ENTRIES_PER_DAY',
    '_PUBLIC_DIR', '_PROMPTS_CACHE', '_PROMPTS_CACHE_LOCK', '_LOOP_MODE_DIR',
    '_SSL_CTX', '_ssrf_check_url', 'chat_mode_rules',
]
