#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
security.py - 安全辅助模块（渐进式加固，默认不改变现有行为）
- token 认证：AUTH_TOKEN 从 private/port.json 读取（auth_token 字段，默认空=关闭）
- SSRF 防护：is_safe_public_url（拦截内网/本机地址）
- 文件路径防护：is_blocked_system_path（仅拦截系统敏感目录，不影响正常盘符读写）
- 【2026-11-23】API Key 脱敏统一走 model_config.mask_key（include_key=False 默认掩码），
  本模块原 mask_key/sanitize_models_config 死代码已移除
"""
import hmac
import ipaddress
import os
import re
import socket
import urllib.parse

from config import PORT_JSON_PATH

from util_log import get_logger

log = get_logger('security')
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
            log.info('[security] 未设置 auth_token，已自动生成并写入 %s（请妥善保管）' % PORT_JSON_PATH)
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
        log.error('[security] auth_token 生成写入失败(%r)，本次运行使用临时随机 token' % e)
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


def _is_cross_site_browser_request(handler):
    """【安全加固 2026-11-06 Issue#44-B】检测跨站浏览器发起的请求（CSRF 面）。
    浏览器跨站请求必带 Origin 头（fetch/XHR/表单 POST）；同源工具调用
    （requests/curl）不带 Origin。Sec-Fetch-Site 头（现代浏览器自动附加）
    cross-site 亦可判定。用于：回环免 token 放行前，先排除"本机浏览器里
    恶意页面跨站打 127.0.0.1"的 CSRF→RCE 链（叠加 shell=True 端点）。
    返回 True=疑似跨站浏览器请求，应拒绝。"""
    try:
        origin = (handler.headers.get('Origin') or '').strip()
        if origin:
            # Origin 非空则必须是本服务自己的源（localhost/127.0.0.1 任意端口）
            host = (handler.headers.get('Host') or '').strip()
            m = re.match(r'^https?://([^/:]+)(?::\d+)?$', origin, re.I)
            if not m:
                return True
            ohost = m.group(1).lower()
            if ohost not in ('localhost', '127.0.0.1', '[::1]', '::1'):
                return True
            if host and host.split(':')[0].lower() not in ('localhost', '127.0.0.1', '[::1]', '::1'):
                return True
            return False  # 本机自己的 Origin，放行
        sfs = (handler.headers.get('Sec-Fetch-Site') or '').strip().lower()
        if sfs in ('cross-site', 'same-site', 'nested-cross-site'):
            # same-site：同站不同源（如别的端口），同样不可信
            return True
    except Exception:
        pass
    return False


def _extract_request_token(handler):
    """提取请求携带的 token：X-Auth-Token 头优先，Cookie（zf_auth=<token>）回落。"""
    got = (handler.headers.get('X-Auth-Token') or '').strip()
    if not got:
        try:
            cookies = handler.headers.get('Cookie') or ''
            for part in cookies.split(';'):
                part = part.strip()
                if part.startswith('zf_auth='):
                    got = part[len('zf_auth='):].strip()
                    break
        except Exception:
            got = ''
    return got


def request_has_valid_token(handler):
    """请求是否携带正确 token（check_request_token 与 Cookie 下发判定共用）。"""
    if not AUTH_TOKEN:
        return False
    got = _extract_request_token(handler)
    if not got:
        return False
    return hmac.compare_digest(got, AUTH_TOKEN)


def check_request_token(handler):
    """校验请求 token。token 恒非空（reload_auth_token 保证）。
    携带方式：X-Auth-Token 头 / Cookie（zf_auth=<token>，由静态页面响应自动种下，
    浏览器零改动自动携带）。?token= URL 回落已删除（防 token 进日志/历史）。
    本机回环访问（127.0.0.1/localhost）直接放行（多版本并存 Cookie 冲突规避），
    但【2026-11-06】回环放行前先做跨站检测：浏览器跨站伪造的请求
    （Origin 异源 / Sec-Fetch-Site: cross-site）一律拒绝，
    堵"本机浏览器恶意页面跨站打 127.0.0.1 shell 端点"的 CSRF→RCE 链；
    纯命令行工具调用（无 Origin/Sec-Fetch-Site 头）不受影响。
    返回 True=放行, False=已发送 403 响应。"""
    if _is_loopback_request(handler):
        if _is_cross_site_browser_request(handler):
            try:
                handler._send_json({'ok': False, 'error': 'Forbidden: cross-site request to loopback is not allowed'}, 403)
            except Exception:
                pass
            return False
        return True
    if not AUTH_TOKEN:
        # 理论不可达：reload_auth_token 会自动生成。防御性拒绝，绝不裸奔。
        try:
            handler._send_json({'ok': False, 'error': 'Unauthorized: token not configured'}, 403)
        except Exception:
            pass
        return False
    if request_has_valid_token(handler):
        return True
    try:
        handler._send_json({'ok': False, 'error': 'Unauthorized: invalid token'}, 403)
    except Exception:
        pass
    return False


def should_issue_auth_cookie(handler):
    """静态响应是否可下发 zf_auth Cookie。
    【安全修复 2026-11-23】原先静态响应无条件下发 token——任何能访问服务的
    请求方（含局域网直连的陌生客户端）抓一条静态响应即得 token，token 形同白送，
    与"清空 AI 接口"式攻击组合即整站失守。收紧为两类放行：
      1) 本机回环请求（可信环境；浏览器首访靠它自动种 Cookie 零改动）；
      2) 已携带正确 token 的请求（续期/多端口同域共享场景）。
    其余请求方仍能加载静态页面本身，但拿不到 token，后续 /api/ 调用被
    check_request_token 403 拦截。跨站浏览器请求（恶意页面打回环）一律不种。"""
    try:
        if _is_cross_site_browser_request(handler):
            return False
        if _is_loopback_request(handler):
            return True
        return request_has_valid_token(handler)
    except Exception:
        return False


def auth_cookie_header(handler=None):
    """生成静态页面响应用的 Set-Cookie 头（不可下发时返回 None）。
    【2026-11-23】必须传入 handler 做回环/已验 token 判定（should_issue_auth_cookie）；
    未传 handler 的旧式调用一律返回 None（宁可少种不可白送）。"""
    if not AUTH_TOKEN:
        return None
    if handler is None or not should_issue_auth_cookie(handler):
        return None
    return 'zf_auth=%s; Path=/; HttpOnly; SameSite=Strict' % AUTH_TOKEN


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


# ===== 朱峰官方中转线路域名白名单（P0-2 修复 2026-11-23）=====
_ZF_RELAY_HOSTS = ('www.zf3d.com', 'zf3d.com')


def is_zf_relay_url(url):
    """判定是否朱峰官方中转线路：仅按固定域名清单精确匹配 hostname。
    子串判定（'zf_models_relay' in url）可被 https://evil.com/?x=zf_models_relay
    骗走 X-ZF-Key/X-ZF-User（用户真实 zf3d key+uid），一律勿用。
    清单写死非配置化，防 settings 路由远程改写。"""
    try:
        h = (urllib.parse.urlparse(str(url or '')).hostname or '').lower()
    except Exception:
        return False
    return h in _ZF_RELAY_HOSTS


# ===== 文件系统敏感目录拦截（黑名单制，不影响正常工作盘）=====

_BLOCKED_PATH_PREFIXES = []
_PRIVATE_RW = []          # 读写均放行的私有路径（专用记忆工具通道）
_PRIVATE_WRITE_ONLY = []  # 仅写放行的私有路径（密钥库：允许代填，不允许读回）
_PRIVATE_ALLOWLIST = []   # 全部白名单条目（= 读写 + 只写），保留旧名供外部查看


def _base_dir():
    """应用根目录。优先 config.BASE_DIR；config 不可用时按本文件位置推算（server/ 的上一级）。"""
    try:
        from config import BASE_DIR
        return BASE_DIR
    except ImportError:
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _init_blocked():
    global _BLOCKED_PATH_PREFIXES, _PRIVATE_RW, _PRIVATE_WRITE_ONLY, _PRIVATE_ALLOWLIST
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
    # 程序自身的密钥/私有配置目录，工具层禁止读写（不影响项目盘操作）。
    # 不依赖 config 能否导入：此前私有目录要等 config 导入成功才登记，config 一出问题私有目录就不设防。
    base = _base_dir()
    cands.append(os.path.abspath(os.path.join(base, 'private')).rstrip('\\').lower())
    cands.append(os.path.abspath(os.path.join(base, 'server', 'private')).rstrip('\\').lower())
    _PRIVATE_RW = [
        # 长期记忆目录（project_record / long_plan / 帖子跟踪）：仅限专用记忆工具通道读写
        os.path.abspath(os.path.join(base, 'private', '记忆')).rstrip('\\').lower(),
    ]
    _PRIVATE_WRITE_ONLY = [
        # 密钥库：用户已授权智能体代填 API Key，所以写放行；读回不放行（见 is_blocked_system_path）
        os.path.abspath(os.path.join(base, 'private', 'api_keys.json')).rstrip('\\').lower(),
    ]
    _PRIVATE_ALLOWLIST = _PRIVATE_RW + _PRIVATE_WRITE_ONLY
    for c in cands:
        try:
            _BLOCKED_PATH_PREFIXES.append(os.path.abspath(c).rstrip('\\').lower())
        except Exception:
            pass


def is_blocked_system_path(path, for_write=False):
    """True = 命中系统敏感目录（Windows/System32、Program Files、ProgramData）或应用自身的私有目录。
    正常项目盘（D:\、E:\、用户目录等）完全不受影响。

    私有目录的放行例外：
      - private/记忆          读写均放行（专用记忆工具通道）；
      - private/api_keys.json 密钥库**仅写放行**（for_write=True）。用户已授权智能体代填 API Key，
                              但不允许读回——读回等于把全部密钥交给模型。2026-11-24 收紧：此前读写都放行。
                              要看配置走掩码接口 /api/models/config。
    for_write=True 表示调用方接下来要做的是写操作（写入 / 移动 / 撤销）。
    路径算不出来（异常）按“不拦截”返回 False，与历史行为一致。"""
    _init_blocked()
    if not path:
        return False
    try:
        p = os.path.abspath(str(path)).rstrip('\\').lower()
        # 【安全加固】剥离 Win32 命名空间前缀后再比对：\\?\C:\Windows 这类形态
        # os.path.abspath 不会归一化，原样带着 \\?\ 前缀会绕过前缀黑名单；
        # \\?\UNC\server\share 需还原成 \\server\share 再比。
        if p.startswith('\\\\?\\unc\\'):
            p = '\\\\' + p[8:]
        elif p.startswith('\\\\?\\'):
            p = p[4:]
    except Exception:
        return False
    allow = _PRIVATE_RW + (_PRIVATE_WRITE_ONLY if for_write else [])
    for a in allow:
        if p == a or p.startswith(a + os.sep):
            return False
    for b in _BLOCKED_PATH_PREFIXES:
        if p == b or p.startswith(b + '\\'):
            return True
    return False
