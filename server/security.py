#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
security.py - 安全辅助模块（渐进式加固，默认不改变现有行为）
- API Key 脱敏：mask_key / sanitize_models_config
- token 认证：AUTH_TOKEN 从 private/port.json 读取（auth_token 字段，默认空=关闭）
- SSRF 防护：is_safe_public_url（拦截内网/本机地址）
- 文件路径防护：is_blocked_system_path（仅拦截系统敏感目录，不影响正常盘符读写）
"""
import ipaddress
import os
import socket
import urllib.parse

from config import PORT_JSON_PATH

# ===== token 认证（默认关闭）=====
# 在 private/port.json 中加 "auth_token": "你的密码" 即开启：
# 开启后所有 /api/* 请求需带 X-Auth-Token 头或 ?token= 参数；
# 同时 GET /api/models/config 对未认证请求返回脱敏 key。
AUTH_TOKEN = ''


def _load_auth_token():
    try:
        import json
        if os.path.exists(PORT_JSON_PATH):
            with open(PORT_JSON_PATH, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            if isinstance(data, dict):
                return str(data.get('auth_token') or '').strip()
    except Exception:
        pass
    return ''


def reload_auth_token():
    global AUTH_TOKEN
    AUTH_TOKEN = _load_auth_token()
    return AUTH_TOKEN


reload_auth_token()


def check_request_token(handler):
    """校验请求 token。未设置 token 时恒放行（默认行为不变）。
    支持三种携带方式：X-Auth-Token 头 / ?token= 参数 / Cookie（zf_auth=<token>，
    由静态页面响应自动种下，浏览器零改动自动携带）。
    返回 True=放行, False=已发送 403 响应。"""
    if not AUTH_TOKEN:
        return True
    got = (handler.headers.get('X-Auth-Token') or '').strip()
    if not got:
        # 回落1：Cookie（浏览器自动携带，用户无感知）
        try:
            cookies = handler.headers.get('Cookie') or ''
            for part in cookies.split(';'):
                part = part.strip()
                if part.startswith('zf_auth='):
                    got = part[len('zf_auth='):].strip()
                    break
        except Exception:
            got = ''
    if not got:
        # 回落2：URL query ?token=
        try:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(handler.path).query)
            got = (q.get('token') or [''])[0]
        except Exception:
            got = ''
    if got == AUTH_TOKEN:
        return True
    try:
        handler._send_json({'ok': False, 'error': 'Unauthorized: invalid token'}, 403)
    except Exception:
        pass
    return False


def auth_cookie_header():
    """生成静态页面响应用的 Set-Cookie 头（未设置 token 时返回 None）。"""
    if not AUTH_TOKEN:
        return None
    return 'zf_auth=%s; Path=/; HttpOnly; SameSite=Strict' % AUTH_TOKEN


# ===== API Key 脱敏 =====

def mask_key(key):
    if not key or not isinstance(key, str):
        return key
    if len(key) <= 8:
        return '****'
    return key[:4] + '****' + key[-4:]


def sanitize_models_config(cfg):
    """对 load_models_config() 结果中的 key 做脱敏（副本操作，不污染缓存）。"""
    import copy
    out = copy.deepcopy(cfg) if cfg else cfg
    try:
        for m in (out.get('list') or []):
            if isinstance(m, dict):
                if m.get('key'):
                    m['key'] = mask_key(m['key'])
                    m['keyMasked'] = True
                if m.get('apiKey'):
                    m['apiKey'] = mask_key(m['apiKey'])
                    m['keyMasked'] = True
    except Exception:
        pass
    return out


# ===== SSRF 防护 =====

def is_safe_public_url(url, _depth=0):
    """仅允许 http/https 且解析出的 IP 不是本机/内网/链路本地。
    抓取公网网页完全不受影响。"""
    if _depth > 3:
        return False
    try:
        u = urllib.parse.urlparse(str(url))
        if u.scheme not in ('http', 'https'):
            return False
        host = (u.hostname or '').strip().lower()
        if not host:
            return False
        # 明确的本机名
        if host in ('localhost',) or host.endswith('.local') or host.endswith('.internal'):
            return False
        infos = socket.getaddrinfo(host, None)
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
                return False
        return True
    except Exception:
        return False


# ===== 文件系统敏感目录拦截（黑名单制，不影响正常工作盘）=====

_BLOCKED_PATH_PREFIXES = []
_PRIVATE_ALLOWLIST = []


def _init_blocked():
    global _BLOCKED_PATH_PREFIXES
    if _BLOCKED_PATH_PREFIXES:
        return
    cands = []
    windir = os.environ.get('SystemRoot', r'C:\Windows')
    cands += [windir, os.path.join(windir, 'System32')]
    for pf in ('ProgramFiles', 'ProgramFiles(x86)'):
        v = os.environ.get(pf)
        if v:
            cands.append(v)
    cands.append(os.path.join(os.environ.get('SystemDrive', 'C:') + '\\', 'ProgramData'))
    # 程序自身的密钥/私有配置目录，工具层禁止读写（不影响项目盘操作）
    # 白名单：明确放行的私有文件（用户已授权智能体写入 API Key）
    global _PRIVATE_ALLOWLIST
    try:
        from config import BASE_DIR
        cands.append(os.path.join(BASE_DIR, 'private'))
        cands.append(os.path.join(BASE_DIR, 'server', 'private'))
        _PRIVATE_ALLOWLIST = [
            os.path.abspath(os.path.join(BASE_DIR, 'private', 'api_keys.json')).rstrip('\\').lower(),
        ]
    except Exception:
        _PRIVATE_ALLOWLIST = []
    for c in cands:
        try:
            _BLOCKED_PATH_PREFIXES.append(os.path.abspath(c).rstrip('\\').lower())
        except Exception:
            pass


def is_blocked_system_path(path):
    """True = 命中系统敏感目录（Windows/System32、Program Files、ProgramData）。
    正常项目盘（D:\、E:\、用户目录等）完全不受影响。
    白名单（_PRIVATE_ALLOWLIST）中的私有文件除外，允许读写。"""
    _init_blocked()
    if not path:
        return False
    try:
        p = os.path.abspath(str(path)).rstrip('\\').lower()
    except Exception:
        return False
    allow = globals().get('_PRIVATE_ALLOWLIST', [])
    if p in allow:
        return False
    for b in _BLOCKED_PATH_PREFIXES:
        if p == b or p.startswith(b + '\\'):
            return True
    return False
