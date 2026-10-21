# -*- coding: utf-8 -*-
"""
credentials.py — 浏览器登录态持久化（凭据表）
⚠️ 敏感链路：修改本文件前必读 private/记忆/约定-登录态系统改动需强审.md（保持蜂群强审+三项实测验收）

存储位置: browser_plugin/data/credentials.json
格式:
{
  "version": 1,
  "entries": {
    "<session>:<domain>": {
      "session": "default",
      "domain": "zf3d.com",
      "cookies": [...],          # context.cookies() 快照（该域过滤）
      "origins": [...],          # localStorage/origin 状态
      "saved_at": "2026-09-26 09:00:00",
      "note": ""
    }
  }
}
"""
import base64
import hashlib
import io
import json
import os
import threading
import time

_lock = threading.Lock()

# ---- 机器绑定加密（A1）：密钥由 Windows 机器 GUID 派生，换机/重装即失效 ----
_KEY_CACHE = None

def _machine_key():
    """机器 GUID -> SHA256 -> Fernet key。仅本机可解。"""
    global _KEY_CACHE
    if _KEY_CACHE:
        return _KEY_CACHE
    raw = ''
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                            r'SOFTWARE\Microsoft\Cryptography') as k:
            raw = winreg.QueryValueEx(k, 'MachineGuid')[0]
    except Exception:
        raw = 'zf-fallback:%s' % os.environ.get('COMPUTERNAME', 'unknown')
    seed = ('zf-credential:' + raw).encode('utf-8')
    _KEY_CACHE = base64.urlsafe_b64encode(hashlib.sha256(seed).digest())
    return _KEY_CACHE

_ENC_PREFIX = 'ZFENC1:'  # 文件头标识：加密格式

def _encrypt_text(plain):
    from cryptography.fernet import Fernet
    return Fernet(_machine_key()).encrypt(
        plain.encode('utf-8')).decode('ascii')

def _decrypt_text(token):
    from cryptography.fernet import Fernet, InvalidToken
    try:
        return Fernet(_machine_key()).decrypt(token.encode('ascii')).decode('utf-8')
    except InvalidToken:
        raise RuntimeError('credentials.json 解密失败：密钥与本机不匹配（可能换过机器）')

def _data_dir(config=None):
    base = os.path.dirname(os.path.abspath(__file__))
    d = os.path.join(base, 'data')
    os.makedirs(d, exist_ok=True)
    return d

def _store_path(config=None):
    return os.path.join(_data_dir(config), 'credentials.json')

def _load(config=None):
    p = _store_path(config)
    if not os.path.exists(p):
        return {'version': 2, 'entries': {}}
    try:
        raw = io.open(p, encoding='utf-8').read()
        if raw.startswith(_ENC_PREFIX):
            data = json.loads(_decrypt_text(raw[len(_ENC_PREFIX):]))
        else:
            data = json.loads(raw)  # 旧明文：读出后下次 save 时自动迁移为加密
        data.setdefault('entries', {})
        return data
    except Exception:
        return {'version': 2, 'entries': {}}

def _save(store, config=None):
    p = _store_path(config)
    tmp = p + '.tmp'
    enc = _ENC_PREFIX + _encrypt_text(json.dumps(
        store, ensure_ascii=False, indent=2))
    io.open(tmp, 'w', encoding='utf-8').write(enc)
    os.replace(tmp, p)

def _domain_of(url):
    try:
        from urllib.parse import urlparse
        return urlparse(url).netloc.lower() or 'unknown'
    except Exception:
        return 'unknown'

def credentials_save(ctx, page, session='default', note='', config=None):
    """把当前会话该域的 cookies + origin 状态存入凭据表。在会话 worker 线程内调用。"""
    domain = _domain_of(page.url)
    state = ctx.storage_state()
    cookies = [c for c in state.get('cookies', [])
               if domain and (c.get('domain', '').lstrip('.') in domain
                              or domain.endswith(c.get('domain', '').lstrip('.')))]
    origins = [o for o in state.get('origins', [])
               if _domain_of(o.get('origin', '')) == domain]
    key = '%s:%s' % (session, domain)
    with _lock:
        store = _load(config)
        store['entries'][key] = {
            'session': session,
            'domain': domain,
            'cookies': cookies,
            'origins': origins,
            'saved_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'note': note,
        }
        _save(store, config)
    return {'ok': True, 'key': key, 'domain': domain,
            'cookies': len(cookies), 'origins': len(origins)}

def credentials_restore(ctx, page, session='default', from_key=None, config=None):
    """恢复该域已保存的凭据到当前上下文。在会话 worker 线程内调用。
    from_key: 指定恢复某条凭据（形如 'wb2:zf3d.com'），用于跨工作台借用。"""
    domain = _domain_of(page.url)
    key = from_key if from_key else '%s:%s' % (session, domain)
    with _lock:
        store = _load(config)
    ent = store.get('entries', {}).get(key)
    if not ent and not from_key:
        # 本工作台没有 → 找同域其他工作台的历史登录态（借用最近的）
        domain_l = domain
        cands = [k for k, v in store.get('entries', {}).items()
                 if v.get('domain') == domain_l]
        if cands:
            key = sorted(cands)[-1]
            ent = store.get('entries', {}).get(key)
    if not ent:
        return {'ok': False, 'error': '没有 %s 的已保存登录态' % key}
    try:
        if ent.get('cookies'):
            ctx.add_cookies(ent['cookies'])
        for o in ent.get('origins', []):
            try:
                ctx.add_init_script  # noqa — 确认 ctx 可用
            except Exception:
                pass
        # localStorage 恢复：导航到 origin 后注入
        for o in ent.get('origins', []):
            org = o.get('origin')
            if not org:
                continue
            try:
                pg = ctx.new_page()
                pg.goto(org + '/favicon.ico', timeout=8000)
                for k, v in (o.get('localStorage') or {}).items():
                    pg.evaluate("([k,v])=>localStorage.setItem(k,v)", [k, v])
                pg.close()
            except Exception:
                pass
        return {'ok': True, 'key': key, 'restored': True,
                'cookies': len(ent.get('cookies') or [])}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:200]}

def credentials_list(config=None):
    with _lock:
        store = _load(config)
    out = []
    for k, v in store.get('entries', {}).items():
        out.append({'key': k, 'session': v.get('session'),
                    'domain': v.get('domain'), 'saved_at': v.get('saved_at'),
                    'note': v.get('note'), 'cookies': len(v.get('cookies') or [])})
    return out

def credentials_delete(key, config=None):
    with _lock:
        store = _load(config)
        existed = store.get('entries', {}).pop(key, None)
        if existed is not None:
            _save(store, config)
    return {'ok': existed is not None, 'deleted': key}

def credentials_query(domain, exclude_session=None, config=None):
    """B1: 查询某域名的全部历史登录态（按工作台隔离存储，跨工作台可借用）。
    exclude_session: 排除自己当前 session 后即为"其他工作台的历史"。"""
    domain = (domain or '').lower()
    with _lock:
        store = _load(config)
    out = []
    for k, v in store.get('entries', {}).items():
        if v.get('domain') != domain:
            continue
        if exclude_session and v.get('session') == exclude_session:
            continue
        out.append({'key': k, 'session': v.get('session'),
                    'domain': v.get('domain'), 'saved_at': v.get('saved_at'),
                    'note': v.get('note'), 'cookies': len(v.get('cookies') or [])})
    return out
