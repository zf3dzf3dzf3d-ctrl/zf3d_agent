#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""util_key_reveal.py - 查看明文密钥的二次验证（密码 + 防爆破 + 短时会话）。

解决什么问题
------------
/api/models/reveal-key 此前凭 4 位尾号即可取回解密后的完整密钥，而本机回环请求免 token——
智能体自己执行的任何 shell 命令，都能凭界面上随处可见的尾号把全部密钥取走。
密钥在盘上是 DPAPI 密文这件事，防的是“文件被拷走”，防不了“以用户身份运行的进程”。

做法
----
明文密钥只交给“知道查看密码的人”：
  - 查看密码由用户在**电脑上的原生窗口**里设置（server/util_key_reveal_dialog.py，独立子进程）。
    不走网页、不走接口——智能体的 HTTP 请求没法替用户往原生窗口里输入，
    所以也就没法抢在用户之前自己设一个密码（否则二次验证形同虚设）。
  - 查看时在网页里输入密码（POST，密码不进 URL）；服务端 scrypt 校验；
  - 验证通过签发 5 分钟的会话 Cookie（HttpOnly / SameSite=Strict），期间不必重复输入；
  - 连续错 5 次锁 5 分钟，计数落盘（重启不重置）；
  - 每次成功显钥写入审计哈希链（audit_chain）。

密码存储：private/db/iprivacy/key_reveal.json，只存 scrypt 哈希与盐，明文永不落盘。
修改密码同样只能经原生窗口，且需先输入当前密码。

诚实的边界
----------
能以用户身份执行任意命令的对手，仍可离线暴力破解这个哈希（弱密码会破），
也能在用户刚验证完的 5 分钟窗口内搭便车。这道验证消除的是“一条命令就拿走全部密钥”的
零成本路径，并把其余路径变成有留痕的主动攻击。真正的解法是密钥代理
（明文密钥只在服务进程内使用、从不交给模型），属于后续里程碑。
"""
import hashlib
import hmac
import json
import os
import secrets
import subprocess
import sys
import threading
import time

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STORE_DIR = os.path.join(_BASE, 'private', 'db', 'iprivacy')
STORE_FILE = os.path.join(_STORE_DIR, 'key_reveal.json')
FAIL_FILE = os.path.join(_STORE_DIR, 'key_reveal_fail.json')
DIALOG_SCRIPT = os.path.join(_BASE, 'server', 'util_key_reveal_dialog.py')

MIN_LEN = 6
MAX_LEN = 64
TTL_SECONDS = 300            # 验证通过后的免输时长：5 分钟
FAIL_LIMIT = 5               # 连续错 5 次
LOCK_SECONDS = 300           # 锁 5 分钟
COOKIE_NAME = 'zf_key_reveal'
_DIALOG_COOLDOWN = 30.0      # 设置窗口：同一时刻只开一个，30 秒内不重复弹

_lock = threading.Lock()
_tokens = {}                 # token -> 过期时间戳（仅内存，重启即失效）
_dialog_proc = None
_dialog_started_at = 0.0


def _read_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def _hash_pw(pw, salt):
    return hashlib.scrypt(pw.encode('utf-8'), salt=salt.encode('utf-8'), n=16384, r=8, p=1, dklen=32).hex()


def _validate(pw):
    """返回错误文本；合法返回 None。"""
    if not isinstance(pw, str) or not (MIN_LEN <= len(pw) <= MAX_LEN):
        return '密码长度须在 %d 到 %d 位之间' % (MIN_LEN, MAX_LEN)
    if pw.isspace():
        return '密码不能全是空格'
    return None


def is_configured():
    """是否已设置查看密码。"""
    return bool(_read_json(STORE_FILE, {}).get('hash'))


def check_bruteforce():
    """返回 None=可尝试；否则返回剩余锁定秒数。"""
    until = _read_json(FAIL_FILE, {}).get('lockUntil', 0)
    if until > time.time():
        return int(until - time.time()) + 1
    return None


def verify_password(pw):
    """只比对密码，不计数、不签发。"""
    store = _read_json(STORE_FILE, {})
    if not store.get('hash') or not store.get('salt'):
        return False
    return hmac.compare_digest(_hash_pw(str(pw or ''), store['salt']), store['hash'])


def set_password(pw, replace=False):
    """设置查看密码。已设置过时必须 replace=True（调用方须先验证过当前密码）。"""
    err = _validate(pw)
    if err:
        return {'ok': False, 'error': err}
    with _lock:
        if is_configured() and not replace:
            return {'ok': False, 'error': '已设置过查看密码；修改须经原生窗口并输入当前密码'}
        salt = secrets.token_hex(16)
        _write_json(STORE_FILE, {'salt': salt, 'hash': _hash_pw(pw, salt),
                                 'setAt': time.strftime('%Y-%m-%d %H:%M:%S')})
        _write_json(FAIL_FILE, {})
        _tokens.clear()          # 换密码后，旧会话全部作废
    log_event('password_set', 'replaced=%s' % replace)
    return {'ok': True}


def verify(pw, client_ip=''):
    """校验密码；成功签发会话 token。返回 (结果 dict, token 或 None)。"""
    if not is_configured():
        return {'ok': False, 'err': 'not-configured'}, None
    wait = check_bruteforce()
    if wait:
        return {'ok': False, 'err': 'locked', 'retryAfter': wait}, None
    if not verify_password(pw):
        with _lock:
            fails = int(_read_json(FAIL_FILE, {}).get('n', 0)) + 1
            locked = fails >= FAIL_LIMIT
            _write_json(FAIL_FILE, {'n': 0 if locked else fails,
                                    'lockUntil': time.time() + LOCK_SECONDS if locked else 0})
        res = {'ok': False, 'err': 'wrong_password', 'fails': 0 if locked else fails}
        if locked:
            res['err'] = 'locked'
            res['retryAfter'] = LOCK_SECONDS
        log_event('verify_fail', 'ip=%s fails=%s locked=%s' % (client_ip, fails, locked))
        return res, None
    token = secrets.token_urlsafe(32)
    with _lock:
        now = time.time()
        for t, exp in list(_tokens.items()):
            if exp < now:
                _tokens.pop(t, None)
        _tokens[token] = now + TTL_SECONDS
        _write_json(FAIL_FILE, {})     # 成功一次即清零失败计数
    log_event('verify_ok', 'ip=%s' % client_ip)
    return {'ok': True, 'ttl': TTL_SECONDS}, token


def check_token(cookie_header):
    """Cookie 里的会话 token 是否有效。"""
    with _lock:
        for part in (cookie_header or '').split(';'):
            part = part.strip()
            if part.startswith(COOKIE_NAME + '='):
                token = part.split('=', 1)[1]
                exp = _tokens.get(token)
                if exp is not None and exp >= time.time():
                    return True
                _tokens.pop(token, None)
                return False
    return False


def revoke():
    """注销全部会话（例如用户点了“隐藏”）。"""
    with _lock:
        _tokens.clear()


def cookie_header(token):
    """由 token 生成 Set-Cookie 头。"""
    return '%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (COOKIE_NAME, token, TTL_SECONDS)


def start_dialog():
    """在桌面上弹出原生窗口（未设置 → 设置；已设置 → 修改）。同一时刻只开一个。

    返回 {'ok', 'started', 'mode'}；打不开时 ok=False。"""
    global _dialog_proc, _dialog_started_at
    with _lock:
        running = _dialog_proc is not None and _dialog_proc.poll() is None
        if running or time.time() - _dialog_started_at < _DIALOG_COOLDOWN:
            return {'ok': True, 'started': False, 'mode': 'change' if is_configured() else 'setup'}
        mode = 'change' if is_configured() else 'setup'
        try:
            _dialog_proc = subprocess.Popen(
                [sys.executable, DIALOG_SCRIPT, '--mode', mode],
                cwd=_BASE, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except (OSError, ValueError) as e:
            log_event('dialog', 'launch_failed=%r' % e)
            return {'ok': False, 'error': '无法打开设置窗口：%s' % e}
        _dialog_started_at = time.time()
        log_event('dialog', 'mode=%s' % mode)
        return {'ok': True, 'started': True, 'mode': mode}


def log_event(action, detail=''):
    """审计留痕（哈希链）。失败不阻断：审计写不进去不该拦住合法用户，也不该放行非法用户。"""
    try:
        import audit_chain
        audit_chain.record('key_reveal', action, {'detail': str(detail)[:200]})
    except (ImportError, OSError, TypeError) as e:
        # 审计写不进去不拦用户，但要留痕；连日志模块都用不了时退到标准错误
        try:
            from util_log import get_logger
            get_logger('util_key_reveal').warning('显钥审计留痕失败: %s' % e)
        except ImportError:
            sys.stderr.write('[util_key_reveal] 显钥审计留痕失败: %s\n' % e)
