# -*- coding: utf-8 -*-
"""密码库（Vault）v1.1 —— 本地加密存储网站账号密码。

存储: private/密码库/vault.json
加密: 仅 Fernet 对称加密（缺 cryptography 库时 _enc 直接报错，绝不降级为不安全混淆）
主密钥: private/密码库/.vault_key（首次自动生成，勿删，删了旧密码解不开）
接口（mixin_vault.py 提供 HTTP 路由）:
  GET  /api/vault/list            列表（密码脱敏，只回 has_pwd）
  POST /api/vault/save            新增/更新 {site, username, password, note}
  POST /api/vault/delete          删除 {site, username}
  GET  /api/vault/get?site=&username=   取回明文密码（AI 登录自动取号用）
"""
import os
import json
import base64
import threading
import time

_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
VAULT_DIR = os.path.join(_SERVER_DIR, '..', 'private', '密码库')
VAULT_FILE = os.path.join(VAULT_DIR, 'vault.json')
KEY_FILE = os.path.join(VAULT_DIR, '.vault_key')

_lock = threading.Lock()

# ---------------- 密钥 ----------------
def _load_key():
    os.makedirs(VAULT_DIR, exist_ok=True)
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, 'rb') as f:
            return f.read().strip()
    key = base64.urlsafe_b64encode(os.urandom(32))
    with open(KEY_FILE, 'wb') as f:
        f.write(key)
    try:
        os.chmod(KEY_FILE, 0o600)
    except Exception:
        pass
    return key

def _fernet():
    try:
        from cryptography.fernet import Fernet
        return Fernet(_load_key())
    except Exception:
        return None

# ---------------- 加解密（仅 Fernet；缺库直接报错，绝不静默降级为混淆） ----------------
def _enc(text):
    f = _fernet()
    if f is None:
        raise RuntimeError(
            '密码库加密失败：缺少 cryptography 库，请先安装'
            '（pip install cryptography）。已禁止不安全的降级混淆。')
    return 'F:' + f.encrypt(text.encode('utf-8')).decode('ascii')

def _dec(token):
    if not token:
        return ''
    if not token.startswith('F:'):
        # 历史 X: 混淆密文已废弃（不安全），不再支持解密；显式标记而非静默返空
        return ''
    try:
        f = _fernet()
        if f is None:
            return ''
        return f.decrypt(token[2:].encode('ascii')).decode('utf-8')
    except Exception:
        return ''


def decrypt_status(token):
    """返回 (明文, 状态)。状态: 'ok' / 'legacy'（历史混淆密文需重新保存）/ 'corrupt'（损坏）/ 'empty'。"""
    if not token:
        return '', 'empty'
    if not token.startswith('F:'):
        return '', 'legacy'
    f = _fernet()
    if f is None:
        return '', 'corrupt'
    try:
        return f.decrypt(token[2:].encode('ascii')).decode('utf-8'), 'ok'
    except Exception:
        return '', 'corrupt'

# ---------------- 存取 ----------------
def _read_all():
    try:
        with open(VAULT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f) or {'items': []}
    except Exception:
        return {'items': []}

def _write_all(data):
    os.makedirs(VAULT_DIR, exist_ok=True)
    bak = VAULT_FILE + '.bak'
    try:
        if os.path.exists(VAULT_FILE):
            with open(VAULT_FILE, 'rb') as fi, open(bak, 'wb') as fo:
                fo.write(fi.read())
    except Exception:
        pass
    tmp = VAULT_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    try:
        os.replace(tmp, VAULT_FILE)
    except Exception:
        os.replace(tmp, bak)

def list_items():
    with _lock:
        data = _read_all()
    out = []
    for it in data.get('items', []):
        out.append({
            'site': it.get('site', ''),
            'username': it.get('username', ''),
            'note': it.get('note', ''),
            'has_password': bool(it.get('password')),
            'updated_at': it.get('updated_at', ''),
        })
    return out

def save_item(site, username, password, note=''):
    site = (site or '').strip()
    username = (username or '').strip()
    if not site or not username:
        return {'ok': False, 'err': 'site 和 username 必填'}
    now = time.strftime('%Y-%m-%d %H:%M:%S')
    with _lock:
        data = _read_all()
        items = data.setdefault('items', [])
        for it in items:
            if it.get('site') == site and it.get('username') == username:
                if password:
                    it['password'] = _enc(password)
                it['note'] = note or it.get('note', '')
                it['updated_at'] = now
                _write_all(data)
                return {'ok': True, 'updated': True}
        items.append({
            'site': site,
            'username': username,
            'password': _enc(password) if password else '',
            'note': note or '',
            'updated_at': now,
        })
        _write_all(data)
    return {'ok': True, 'created': True}

def delete_item(site, username):
    with _lock:
        data = _read_all()
        items = data.get('items', [])
        n = len(items)
        items[:] = [it for it in items
                    if not (it.get('site') == (site or '').strip()
                            and it.get('username') == (username or '').strip())]
        removed = n - len(items)
        if removed:
            _write_all(data)
    return {'ok': True, 'removed': removed}

def get_item(site, username=None):
    """取明文（AI 自动登录用）。username 为空时取该站点第一条。"""
    site = (site or '').strip().lower()
    with _lock:
        data = _read_all()
    for it in data.get('items', []):
        if it.get('site', '').lower() == site:
            if username and it.get('username', '').strip() != username.strip():
                continue
            pwd, st = decrypt_status(it.get('password', ''))
            return {'ok': True, 'site': it.get('site'),
                    'username': it.get('username'),
                    'password': pwd,
                    'password_status': st,
                    'note': it.get('note', ''),
                    **({'warn': '该条目为历史混淆密文，明文已不可恢复，请重新保存密码'}
                       if st == 'legacy' else {})}
    return {'ok': False, 'err': '未找到该站点账号'}

def has_cryptography():
    return _fernet() is not None
