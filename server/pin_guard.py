# -*- coding: utf-8 -*-
"""
钉住保底·自动重登兜底：检测 zf3d 登录态，失效则用密码库里存的账号自动重登。
用法：pythonw pin_guard.py            （手动跑一次）
配合 schedule 定时任务：每天自动跑 + 备援备份。
"""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server'))

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROF = os.path.join(ROOT, 'private', '浏览器数据', 'profiles', 'default')  # 2026-10-30: 与引擎 config data_dir 一致；旧 server/data/browser_profile 已归档
GUANLI = 'https://www.zf3d.com/guanliy.asp'


def _get_cred():
    import sqlite3, tempfile, shutil, base64, ctypes
    from ctypes import wintypes

    class BLOB(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]

    def dpapi(data):
        buf = ctypes.create_string_buffer(data, len(data))
        fin = BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
        fout = BLOB()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(fin), None, None, None, None, 0, ctypes.byref(fout)):
            raise OSError('dpapi fail')
        out = ctypes.string_at(fout.pbData, fout.cbData)
        ctypes.windll.kernel32.LocalFree(fout.pbData)
        return out

    ld = os.path.join(PROF, 'Default', 'Login Data')
    with open(os.path.join(PROF, 'Local State'), encoding='utf-8') as f:
        key = dpapi(base64.b64decode(json.load(f)['os_crypt']['encrypted_key'])[5:])
    tmp = tempfile.mktemp(suffix='.db')
    shutil.copy2(ld, tmp)
    conn = sqlite3.connect(tmp)
    row = conn.execute("SELECT username_value, password_value FROM logins WHERE signon_realm LIKE '%zf3d%' LIMIT 1").fetchone()
    conn.close()
    os.remove(tmp)
    if not row:
        return None, None
    user, blob = row
    from Crypto.Cipher import AES
    plain = AES.new(key, AES.MODE_GCM, blob[3:15]).decrypt(blob[15:])[:-16].decode('utf-8')
    return user, plain


def run():
    import browser_profile_import as bpi
    backup = bpi.reserve_backup()  # 先备份当前关键库
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROF, headless=True,
            artifacts_dir=os.path.join(ROOT, 'server', 'data', 'pw-artifacts'))
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(GUANLI, timeout=30000)
        ok = 'guanliy.asp' in page.url and 'login' not in page.url.lower()
        result = {'backup': backup.get('ts'), 'login_ok': ok, 'url': page.url}
        if not ok:
            user, pwd = _get_cred()
            if user:
                page.goto('https://www.zf3d.com/login.asp', timeout=30000)
                page.fill('input[placeholder*="用户"]', user)
                page.fill('input[type="password"]', pwd)
                page.click('input[type="submit"], button[type="submit"], input[value*="登"]')
                page.wait_for_timeout(3000)
                page.goto(GUANLI, timeout=30000)
                result['relogin'] = 'guanliy.asp' in page.url and 'login' not in page.url.lower()
                result['login_ok'] = bool(result.get('relogin'))
            else:
                result['relogin'] = '密码库无 zf3d 账号'
        ctx.close()
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == '__main__':
    run()
