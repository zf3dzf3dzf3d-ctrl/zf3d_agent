# -*- coding: utf-8 -*-
"""
🔑 密码库修复：把源 profile 的密码解密→用主 profile 密钥重加密→并入主 Login Data
解决「Login Data 拷过来但密码库显示为空」（密钥不配套）问题。只增不删、按 realm+username 去重。
"""
import os, sys, json, sqlite3, tempfile, shutil, base64, ctypes
from ctypes import wintypes

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN_PROF = os.path.join(ROOT, 'private', '浏览器数据', 'profiles', 'default')  # 2026-10-30: 与引擎 config data_dir 一致；旧 server/data/browser_profile 已归档
SRC_PROF = os.path.join(ROOT, 'private', '浏览器数据', 'profiles', 'default')


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


def _dpapi(data):
    buf = ctypes.create_string_buffer(data, len(data))
    fin = _DATA_BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    fout = _DATA_BLOB()
    ok = ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(fin), None, None, None, None, 0, ctypes.byref(fout))
    if not ok:
        raise OSError('CryptUnprotectData failed')
    out = ctypes.string_at(fout.pbData, fout.cbData)
    ctypes.windll.kernel32.LocalFree(fout.pbData)
    return out


def _get_key(local_state_path):
    with open(local_state_path, 'r', encoding='utf-8') as f:
        ls = json.load(f)
    key_b64 = ls['os_crypt']['encrypted_key']
    key = base64.b64decode(key_b64)[5:]  # 去 DPAPI 前缀
    return _dpapi(key)


def _decrypt(blob, key):
    if blob[:3] in (b'v10', b'v11'):
        from Crypto.Cipher import AES
        nonce, ct = blob[3:15], blob[15:]
        pt = AES.new(key, AES.MODE_GCM, nonce=nonce).decrypt(ct)[:-16]
        return pt.decode('utf-8', 'replace')
    return _dpapi(blob).decode('utf-8', 'replace')


def _encrypt(plain, key):
    from Crypto.Cipher import AES
    nonce = os.urandom(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ct, tag = cipher.encrypt_and_digest(plain.encode('utf-8'))
    return b'v10' + nonce + ct + tag


def merge():
    from Crypto.Cipher import AES  # noqa: 确认依赖存在
    src_ld = os.path.join(SRC_PROF, 'Default', 'Login Data')
    main_ld = os.path.join(MAIN_PROF, 'Default', 'Login Data')
    assert os.path.isfile(src_ld), '源 Login Data 不存在'
    assert os.path.isfile(main_ld), '主 Login Data 不存在'
    src_key = _get_key(os.path.join(SRC_PROF, 'Local State'))
    main_key = _get_key(os.path.join(MAIN_PROF, 'Local State'))

    tmp = tempfile.mktemp(suffix='.db')
    shutil.copy2(src_ld, tmp)
    sconn = sqlite3.connect(tmp)
    rows = sconn.execute(
        'SELECT origin_url, action_url, username_element, username_value, '
        'password_element, password_value, signon_realm, date_created, times_used '
        'FROM logins').fetchall()
    sconn.close()
    os.remove(tmp)

    tmp2 = tempfile.mktemp(suffix='.db')
    shutil.copy2(main_ld, tmp2)
    mconn = sqlite3.connect(tmp2)
    existing = {(r[0], r[1]) for r in mconn.execute('SELECT signon_realm, username_value FROM logins')}
    added = 0
    for (origin, action, ue, un, pe, pv, realm, dt, tu) in rows:
        if (realm, un) in existing or not un:
            continue
        try:
            plain = _decrypt(pv, src_key)
        except Exception:
            continue  # 解不开的跳过，不写坏库
        enc = _encrypt(plain, main_key)
        mconn.execute(
            'INSERT INTO logins (origin_url, action_url, username_element, username_value, '
            'password_element, password_value, signon_realm, date_created, times_used, '
            'date_last_used, blacklisted_by_user, scheme) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,0,?)',
            (origin, action, ue, un, pe, enc, realm, dt, tu, 0, 'Chrome'))
        existing.add((realm, un))
        added += 1
    mconn.commit()
    n = mconn.execute('SELECT COUNT(*) FROM logins').fetchone()[0]
    mconn.close()
    os.makedirs(os.path.dirname(main_ld), exist_ok=True)
    shutil.copy2(tmp2, main_ld)
    os.remove(tmp2)
    return {'ok': True, 'src_rows': len(rows), 'added': added, 'main_total': n}


if __name__ == '__main__':
    print(json.dumps(merge(), ensure_ascii=False))
