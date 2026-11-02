# -*- coding: utf-8 -*-
"""
zf_identity.py — 朱峰通道「可信身份票」与内部接口共享密钥（2026-09-21 安全加固）

背景（对应两份安全意见）：
  [意见1] zf_proxy_billing.identify_user() 直接信任客户端自带的
          body._zf_user_id / Header X-ZF-Uid / Cookie zf_uid=数字ID。
          ID 是公开递增数字，改个 Cookie 就能冒用他人身份扣别人的钱，
          还能命中 free_usernames 白名单免账。
  [意见2] ai_proxy.py 的 /internal/* 只判来源 IP，private/port.json 的
          auth_token 为空且无强制校验，等于本机裸调即可充值/扣费/取令牌。

本模块提供三样东西：
  1. internal_secret()      —— 内部接口共享密钥（首次运行自动生成，权限 0600）
  2. sign/verify_identity() —— 带 HMAC-SHA256 签名 + 时效的身份票 zf_idt.<payload>.<sig>
  3. identity_from_headers()—— 从 Cookie / Header 提取并校验身份票
  4. RateLimiter            —— 按 uid 的令牌桶，防止单一身份打爆上游
  5. audit()                —— 身份/计费安全审计流水（jsonl）

设计原则：**任何由客户端直接提供的裸 ID 都不可信**。身份只能来自
服务端签发的、带签名和过期时间的票；或者由站长在配置里显式绑定的令牌。
"""
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time

_BASE = os.path.dirname(os.path.abspath(__file__))
_SECRET_FILE = os.path.join(_BASE, 'private', 'internal_secret.txt')
_AUDIT_FILE = os.path.join(_BASE, 'private', 'billing', 'zf_identity_audit.jsonl')
_TICKET_TTL = int(os.environ.get('ZF_ID_TTL', 86400))   # 身份票有效期（秒）
_TICKET_PREFIX = 'zf_idt.'

_lock = threading.Lock()
_secret_cache = {'v': None, 't': 0.0}


# ---------------- 内部接口共享密钥 ----------------

def internal_secret():
    """读取内部接口共享密钥；不存在则自动生成（32 字节随机，权限 0600）。"""
    now = time.time()
    with _lock:
        if _secret_cache['v'] and now - _secret_cache['t'] < 5:
            return _secret_cache['v']
    try:
        with open(_SECRET_FILE, encoding='utf-8') as f:
            v = f.read().strip()
        if v:
            with _lock:
                _secret_cache['v'] = v
                _secret_cache['t'] = now
            return v
    except Exception:
        pass
    # 生成新密钥
    v = secrets.token_hex(32)
    try:
        os.makedirs(os.path.dirname(_SECRET_FILE), exist_ok=True)
        with open(_SECRET_FILE, 'w', encoding='utf-8') as f:
            f.write(v)
        try:
            os.chmod(_SECRET_FILE, 0o600)
        except Exception:
            pass
        logging.warning('[zf_identity] 已生成新的内部接口密钥 %s，请重启依赖它的服务', _SECRET_FILE)
    except Exception as e:
        logging.error('[zf_identity] 无法写入内部密钥文件: %s', e)
        return ''
    with _lock:
        _secret_cache['v'] = v
        _secret_cache['t'] = now
    return v


def internal_auth_ok(headers):
    """校验请求头 X-ZF-Internal 是否等于共享密钥。空密钥一律拒绝（fail-closed）。"""
    sec = internal_secret()
    if not sec:
        return False
    try:
        h = {str(k).lower(): v for k, v in (headers or {}).items()}
        got = str(h.get('x-zf-internal') or '')
    except Exception:
        return False
    if not got:
        return False
    return hmac.compare_digest(got, sec)


# ---------------- 身份票（签名 + 时效） ----------------

def _b64e(b):
    return base64.urlsafe_b64encode(b).decode('ascii').rstrip('=')


def _b64d(s):
    pad = '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def sign_identity(user_id, ttl=None, extra=None):
    """签发身份票。返回 'zf_idt.<base64url(json)>.<sig>'；user_id<=0 返回 ''。"""
    try:
        uid = int(user_id)
    except Exception:
        return ''
    if uid <= 0:
        return ''
    sec = internal_secret()
    if not sec:
        return ''
    ttl = _TICKET_TTL if ttl is None else int(ttl)
    body = {'uid': uid, 'iat': int(time.time()), 'exp': int(time.time()) + int(ttl)}
    if isinstance(extra, dict) and extra:
        body['x'] = extra
    raw = _b64e(json.dumps(body, separators=(',', ':'), ensure_ascii=False).encode('utf-8'))
    sig = _b64e(hmac.new(sec.encode('utf-8'), raw.encode('ascii'), hashlib.sha256).digest())
    return _TICKET_PREFIX + raw + '.' + sig


def verify_identity(ticket):
    """校验身份票。成功返回 (uid, '')；失败返回 (0, 原因)。"""
    if not ticket or not isinstance(ticket, str) or not ticket.startswith(_TICKET_PREFIX):
        return 0, 'no_ticket'
    sec = internal_secret()
    if not sec:
        return 0, 'no_secret'
    try:
        raw, sig = ticket[len(_TICKET_PREFIX):].rsplit('.', 1)
    except Exception:
        return 0, 'bad_format'
    expect = _b64e(hmac.new(sec.encode('utf-8'), raw.encode('ascii'), hashlib.sha256).digest())
    if not hmac.compare_digest(expect, sig):
        return 0, 'bad_signature'
    try:
        body = json.loads(_b64d(raw).decode('utf-8'))
    except Exception:
        return 0, 'bad_payload'
    try:
        uid = int(body.get('uid') or 0)
        exp = int(body.get('exp') or 0)
    except Exception:
        return 0, 'bad_payload'
    if uid <= 0:
        return 0, 'bad_uid'
    if exp and int(time.time()) > exp:
        return 0, 'expired'
    return uid, ''


def identity_from_headers(headers):
    """从请求头提取身份票并校验。来源：Cookie zf_idt / Header X-ZF-Idt。
    返回 (uid, err)。**不接受裸数字 ID**。"""
    try:
        h = {str(k).lower(): v for k, v in (headers or {}).items()}
    except Exception:
        return 0, 'bad_headers'
    ticket = str(h.get('x-zf-idt') or '')
    if not ticket:
        cookie = str(h.get('cookie') or '')
        for part in cookie.split(';'):
            part = part.strip()
            if part.startswith('zf_idt='):
                ticket = part.split('=', 1)[1].strip()
                break
    if not ticket:
        return 0, 'no_ticket'
    return verify_identity(ticket)


def bind_token_to_uid(headers, bindings):
    """按站长配置的令牌绑定表取 uid。bindings: {sha256(token): uid}。"""
    if not bindings:
        return 0, 'no_bindings'
    try:
        h = {str(k).lower(): v for k, v in (headers or {}).items()}
    except Exception:
        return 0, 'bad_headers'
    raw = str(h.get('x-zf-internal') or '') or str(h.get('authorization') or '')
    if raw.lower().startswith('bearer '):
        raw = raw[7:].strip()
    if not raw:
        cookie = str(h.get('cookie') or '')
        for part in cookie.split(';'):
            part = part.strip()
            for name in ('zf_auth=', 'zf_token='):
                if part.startswith(name):
                    raw = part[len(name):].strip()
                    break
    if not raw:
        return 0, 'no_token'
    fp = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    for k, v in (bindings or {}).items():
        try:
            if hmac.compare_digest(str(k), fp):
                return int(v), ''
        except Exception:
            continue
    return 0, 'token_not_bound'


# ---------------- 限流 ----------------

class RateLimiter:
    """按 key 的令牌桶（内存态，进程重启清零）。"""

    def __init__(self):
        self._b = {}

    def allow(self, key, rate_per_min, burst=None):
        """rate_per_min<=0 表示不限流。返回 (ok, retry_after_seconds)。"""
        try:
            rate = float(rate_per_min or 0)
        except Exception:
            rate = 0.0
        if rate <= 0:
            return True, 0.0
        burst = burst if burst else max(1.0, rate / 6.0)
        now = time.time()
        k = str(key)
        with _lock:
            tok, last = self._b.get(k, (burst, now))
            tok = min(burst, tok + (now - last) * rate / 60.0)
            if tok < 1.0:
                self._b[k] = (tok, now)
                return False, (1.0 - tok) * 60.0 / rate
            self._b[k] = (tok - 1.0, now)
            return True, 0.0

    def reset(self, key=None):
        with _lock:
            if key is None:
                self._b.clear()
            else:
                self._b.pop(str(key), None)


_limiter = RateLimiter()


def rate_allow(key, rate_per_min, burst=None):
    return _limiter.allow(key, rate_per_min, burst)


def rate_reset(key=None):
    _limiter.reset(key)


# ---------------- 审计 ----------------

def audit(event, **fields):
    """追加一条安全审计流水。任何异常都不影响主流程。"""
    try:
        rec = {'ts': int(time.time() * 1000), 'event': str(event)}
        rec.update(fields or {})
        os.makedirs(os.path.dirname(_AUDIT_FILE), exist_ok=True)
        with _lock:
            with open(_AUDIT_FILE, 'a', encoding='utf-8') as f:
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception:
        pass
    return None
