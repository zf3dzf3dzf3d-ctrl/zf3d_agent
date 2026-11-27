# -*- coding: utf-8 -*-
"""App 应用锁核心（策划案-App应用锁-v2，i隐私模块子能力）

- 密码：scrypt 哈希落 private/db/iprivacy/applock.json（明文密码永不落盘）
- 会话：verify 成功签发随机 token，内存表 + HttpOnly Cookie（SameSite=Strict，TTL 30min）
- 防爆破：错 5 次锁 5 分钟，计数落盘（重启不重置）
- 忘记密码策略（用户默认拍板）：连续错 5 次锁 5 分钟；主动 reset 需确认 + 审计日志
"""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STORE_DIR = os.path.join(_BASE, 'private', 'db', 'iprivacy')
_STORE_FILE = os.path.join(_STORE_DIR, 'applock.json')
_FAIL_FILE = os.path.join(_STORE_DIR, 'applock_fail.json')

TTL_SECONDS = 1800        # 解锁有效期 30 分钟
FAIL_LIMIT = 5            # 错 5 次
LOCK_SECONDS = 300        # 锁 5 分钟

# 已注册可加锁的 app（后续 i相册/i笔记 零成本接入）
LOCKED_APPS = {'manga': 'i漫画'}

_lock = threading.Lock()
_tokens = {}  # app -> (token, expire_ts)
_log_handler = None  # _write_log 惰性缓存的 db_write_log


def _read_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _hash_pw(pw, salt):
    return hashlib.scrypt(pw.encode('utf-8'), salt=salt.encode('utf-8'), n=16384, r=8, p=1, dklen=32).hex()


def is_locked(app):
    """该 app 是否已设锁（有密码记录即视为上锁）"""
    store = _read_json(_STORE_FILE, {})
    return app in store


def status(app):
    if app not in LOCKED_APPS:
        return {'ok': False, 'err': 'unknown app'}
    return {'ok': True, 'app': app, 'locked': is_locked(app), 'ttl': TTL_SECONDS}


def set_password(app, pw, old='', approved=False):
    """设置/修改应用锁密码。

    【2026-11-24 重新认证】
      - 首次设锁须 approved=True（路由层先弹本机桌面确认框）：跨站页面不得替用户上锁；
      - 已设锁改密须先验 old（当前密码），错 5 次同样锁 5 分钟：知道旧密码的人才改得动。"""
    if app not in LOCKED_APPS or not pw:
        return {'ok': False, 'err': 'bad app or empty password'}
    store = _read_json(_STORE_FILE, {})
    if app not in store:
        if not approved:
            _write_log('set_refused', app, '设锁被拒：未经桌面确认')
            return {'ok': False, 'err': 'need_desktop_confirm'}
        salt = secrets.token_hex(16)
        with _lock:
            store = _read_json(_STORE_FILE, {})
            store[app] = {'salt': salt, 'hash': _hash_pw(pw, salt), 'setAt': time.strftime('%Y-%m-%d %H:%M:%S')}
            _write_json(_STORE_FILE, store)
            _write_log('set', app, '密码已设置（桌面确认通过）')
        return {'ok': True, 'app': app, 'locked': True}
    # 已设锁：改密 = 重新认证
    wait = check_bruteforce(app)
    if wait:
        return {'ok': False, 'err': 'locked', 'retryAfter': wait}
    cur = store[app]
    if not str(old or '') or not hmac.compare_digest(_hash_pw(str(old), cur['salt']), cur['hash']):
        e = _fail_record(app)
        _write_log('set_refused', app, '改密被拒：旧密码不符')
        if e.get('lockUntil', 0) > time.time():
            return {'ok': False, 'err': 'locked', 'retryAfter': int(e['lockUntil'] - time.time()) + 1}
        return {'ok': False, 'err': 'wrong-password', 'fails': e['n']}
    salt = secrets.token_hex(16)
    with _lock:
        store = _read_json(_STORE_FILE, {})
        store[app] = {'salt': salt, 'hash': _hash_pw(pw, salt), 'setAt': time.strftime('%Y-%m-%d %H:%M:%S')}
        _write_json(_STORE_FILE, store)
        _write_log('set', app, '旧密码校验通过，密码已更新')
    return {'ok': True, 'app': app, 'locked': True}


def _fail_read():
    return _read_json(_FAIL_FILE, {})


def _fail_write(d):
    _write_json(_FAIL_FILE, d)


def check_bruteforce(app):
    """返回 None=可尝试；否则返回剩余锁定秒数"""
    d = _fail_read().get(app) or {}
    if d.get('lockUntil', 0) > time.time():
        return int(d['lockUntil'] - time.time()) + 1
    return None


def _fail_record(app):
    with _lock:
        d = _fail_read()
        e = d.get(app) or {'n': 0, 'lockUntil': 0}
        e['n'] = int(e.get('n', 0)) + 1
        if e['n'] >= FAIL_LIMIT:
            e['lockUntil'] = time.time() + LOCK_SECONDS
            e['n'] = 0
        d[app] = e
        _fail_write(d)
        _write_log('fail', app, '第 %d 次错密码' % e['n'])
        return e


def verify(app, pw, client_ip):
    """校验密码；成功签发 token。返回 (dict, set_cookie_token_or_None)"""
    if app not in LOCKED_APPS:
        return {'ok': False, 'err': 'unknown app'}, None
    wait = check_bruteforce(app)
    if wait:
        return {'ok': False, 'err': 'locked', 'retryAfter': wait}, None
    store = _read_json(_STORE_FILE, {}).get(app)
    if not store:
        return {'ok': False, 'err': 'no-password'}, None
    if not hmac.compare_digest(_hash_pw(str(pw or ''), store['salt']), store['hash']):
        e = _fail_record(app)
        msg = {'ok': False, 'err': 'wrong-password', 'fails': e['n']}
        if e.get('lockUntil', 0) > time.time():
            msg['err'] = 'locked'
            msg['retryAfter'] = int(e['lockUntil'] - time.time()) + 1
        return msg, None
    token = secrets.token_urlsafe(32)
    with _lock:
        _tokens[app] = (token, time.time() + TTL_SECONDS)
    _write_log('unlock', app, '解锁成功 ip=%s' % client_ip)
    _fail_write({k: v for k, v in _fail_read().items() if k != app})
    return {'ok': True, 'ttl': TTL_SECONDS}, token


def check_token(app, cookie_header):
    """guard 用：Cookie 里的 token 是否有效"""
    with _lock:
        ent = _tokens.get(app)
    if not ent:
        return False
    token, exp = ent
    if exp < time.time():
        with _lock:
            _tokens.pop(app, None)
        return False
    for part in (cookie_header or '').split(';'):
        if part.strip().startswith('applock_%s=' % app):
            return hmac.compare_digest(part.strip().split('=', 1)[1], token)
    return False


def lock_now(app):
    with _lock:
        _tokens.pop(app, None)
    return {'ok': True, 'app': app, 'locked': True}


def reset_password(app, approved=False):
    """忘记密码兜底：清除重设（审计日志留痕）。

    【2026-11-24】须本机桌面确认（approved=True，由路由层弹原生窗口取得）：
    此前任何人发一个空 POST 就能把锁拆掉。用户忘记密码时的恢复路径不变——
    人在机器前，点一下确认即可。"""
    if not approved:
        _write_log('reset_refused', app, '重置被拒：未经桌面确认')
        return {'ok': False, 'err': 'need_desktop_confirm'}
    with _lock:
        store = _read_json(_STORE_FILE, {})
        if app in store:
            store.pop(app)
            _write_json(_STORE_FILE, store)
        d = _fail_read()
        d.pop(app, None)
        _fail_write(d)
        _tokens.pop(app, None)
    _write_log('reset', app, '密码被重置（清除重设）')
    return {'ok': True}


def _write_log(action, app, detail):
    # 惰性缓存 handler，避免每次调用重复 import / 污染 sys.path
    global _log_handler
    try:
        if _log_handler is None:
            import sys
            if os.path.join(_BASE, 'server') not in sys.path:
                sys.path.append(os.path.join(_BASE, 'server'))
            from routes.mixin_base import db_write_log
            _log_handler = db_write_log
        _log_handler('info', 'applock', 'applock:%s:%s' % (action, app), detail)
    except Exception:
        pass
