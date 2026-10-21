# -*- coding: utf-8 -*-
"""密码库（Vault）v1.0 —— 本地加密存储网站账号密码。

存储: private/密码库/vault.json
加密: Fernet 对称加密（无 cryptography 库时自动降级为 XOR+base64 混淆，并给出提示）
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

# ---------------- 加解密（cryptography 优先，缺失降级混淆） ----------------
def _enc(text):
    f = _fernet()
    if f is not None:
        return 'F:' + f.encrypt(text.encode('utf-8')).decode('ascii')
    key = _load_key()
    raw = text.encode('utf-8')
    x = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
    return 'X:' + base64.urlsafe_b64encode(x).decode('ascii')

def _dec(token):
    if not token:
        return ''
    try:
        if token.startswith('F:'):
            f = _fernet()
            if f is None:
                return ''
            return f.decrypt(token[2:].encode('ascii')).decode('utf-8')
        if token.startswith('X:'):
            key = _load_key()
            x = base64.urlsafe_b64decode(token[2:].encode('ascii'))
            return bytes(b ^ key[i % len(key)] for i, b in enumerate(x)).decode('utf-8')
    except Exception:
        return ''
    return ''

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
            return {'ok': True, 'site': it.get('site'),
                    'username': it.get('username'),
                    'password': _dec(it.get('password', '')),
                    'note': it.get('note', '')}
    return {'ok': False, 'err': '未找到该站点账号'}

def has_cryptography():
    return _fernet() is not None
