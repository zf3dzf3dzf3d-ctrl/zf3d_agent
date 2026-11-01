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

# ===== token 认证 =====
# token 从 private/port.json 读取（auth_token 字段）。
# P0 整改：未设置时自动生成随机 token 并写回 port.json（空 token 恒放行已废除）。
# 认证携带方式：X-Auth-Token 头 / Cookie（zf_auth=<token>，静态页自动种下）。
# ?token= URL 回落已删除：防 token 泄漏进访问日志/浏览器历史。
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


def _generate_auth_token():
    """空 token 时自动生成随机 token 并持久化到 port.json（首次启动自动开启认证）。
    跨进程防竞态：msvcrt 文件锁串行化 + 双检（拿到锁后先回读，别的进程可能已生成）。"""
    import json
    import secrets
    import time
    lock_path = PORT_JSON_PATH + '.tokenlock'
    try:
        data = {}
        if os.path.exists(PORT_JSON_PATH):
            with open(PORT_JSON_PATH, 'r', encoding='utf-8-sig') as f:
                data = json.load(f) or {}
        token = secrets.token_urlsafe(24)
        lock_f = open(lock_path, 'a+')
        try:
            # 最多等 5 秒拿锁；锁内先双检，避免多进程各自生成不同 token 互相覆盖
            deadline = time.time() + 5
            while True:
                try:
                    import msvcrt
                    msvcrt.locking(lock_f.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.time() > deadline:
                        break
                    time.sleep(0.05)
            # 双检：锁内回读，若已有 token 则复用
            existing = _load_auth_token()
            if existing:
                return existing
            data = {}
            if os.path.exists(PORT_JSON_PATH):
                with open(PORT_JSON_PATH, 'r', encoding='utf-8-sig') as f:
                    data = json.load(f) or {}
            data['auth_token'] = token
            tmp = PORT_JSON_PATH + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, PORT_JSON_PATH)
            print('[security] 未设置 auth_token，已自动生成并写入 %s（请妥善保管）' % PORT_JSON_PATH)
            return token
        finally:
            try:
                import msvcrt
                lock_f.seek(0)
                msvcrt.locking(lock_f.fileno(), msvcrt.LK_UNLCK, 1)
            except Exception:
                pass
            lock_f.close()
    except Exception as e:
        # 写入失败时使用进程内临时 token（本次运行有效），避免裸奔
        print('[security] auth_token 生成写入失败(%r)，本次运行使用临时随机 token' % e)
        return secrets.token_urlsafe(24)


def reload_auth_token():
    global AUTH_TOKEN
    AUTH_TOKEN = _load_auth_token()
    if not AUTH_TOKEN:
        AUTH_TOKEN = _generate_auth_token()
    return AUTH_TOKEN


reload_auth_token()


def _is_loopback_request(handler):
    """本机回环请求（真实来源 IP 为 127.0.0.1/::1）视为本机可信，放行 token 校验。
    原因：多版本同机并存时（8570/8560），Cookie 按域(localhost)存储不分端口，
    会互相覆盖 zf_auth 导致 403。回环放行不影响对外安全性。
    【安全修复 2026-11-07】改用 handler.client_address[0]（TCP 真实来源 IP，
    客户端不可伪造）判定，不再信任 Host 头（可被客户端任意伪造，曾致局域网
    直连请求伪造 Host:localhost 绕过 token 校验）。"""
    try:
        ip = (handler.client_address[0] if handler.client_address else '').strip().lower()
        if ip in ('127.0.0.1', '::1', '::ffff:127.0.0.1'):
            return True
    except Exception:
        pass
    return False


def check_request_token(handler):
    """校验请求 token。token 恒非空（reload_auth_token 保证）。
    携带方式：X-Auth-Token 头 / Cookie（zf_auth=<token>，由静态页面响应自动种下，
    浏览器零改动自动携带）。?token= URL 回落已删除（防 token 进日志/历史）。
    本机回环访问（127.0.0.1/localhost）直接放行（多版本并存 Cookie 冲突规避）。
    返回 True=放行, False=已发送 403 响应。"""
    if _is_loopback_request(handler):
        return True
    if not AUTH_TOKEN:
        # 理论不可达：reload_auth_token 会自动生成。防御性拒绝，绝不裸奔。
        try:
            handler._send_json({'ok': False, 'error': 'Unauthorized: token not configured'}, 403)
        except Exception:
            pass
        return False
    got = (handler.headers.get('X-Auth-Token') or '').strip()
    if not got:
        # Cookie 回落（浏览器自动携带，用户无感知）
        try:
            cookies = handler.headers.get('Cookie') or ''
            for part in cookies.split(';'):
                part = part.strip()
                if part.startswith('zf_auth='):
                    got = part[len('zf_auth='):].strip()
                    break
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
            # 长期记忆目录（project_record / long_plan / 帖子跟踪）：仅限专用记忆工具通道读写
            os.path.abspath(os.path.join(BASE_DIR, 'private', '记忆')).rstrip('\\').lower(),
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
    for a in allow:
        if p == a or p.startswith(a + os.sep):
            return False
    for b in _BLOCKED_PATH_PREFIXES:
        if p == b or p.startswith(b + '\\'):
            return True
    return False
