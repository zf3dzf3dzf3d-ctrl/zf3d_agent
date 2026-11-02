# -*- coding: utf-8 -*-
"""B3: IE缓存模式 —— 浏览器 profile 目录整体打包/还原（zip）。
比 cookies 快照更彻底：含 IndexedDB、Cache、localStorage 等全部浏览器本地状态。
用法：
  profile_save(name)   # 把 browser_profile/ 打包存到 data/login_states/<name>.zip
  profile_restore(name)# 用存档覆盖回 browser_profile/（须先关浏览器）
"""
import io
import os
import shutil
import zipfile
import time

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILE_DIR = os.path.join(_PLUGIN_DIR, 'browser_profile')
STATES_DIR = os.path.join(_PLUGIN_DIR, 'data', 'login_states')

_SKIP_TOP = {'SingletonLock', 'SingletonSocket', 'SingletonCookie'}  # 避免锁文件干扰

def _states_dir():
    os.makedirs(STATES_DIR, exist_ok=True)
    return STATES_DIR

def profile_list():
    d = _states_dir()
    out = []
    for f in sorted(os.listdir(d)):
        if f.endswith('.zip'):
            p = os.path.join(d, f)
            out.append({'name': f[:-4], 'size': os.path.getsize(p),
                        'saved_at': time.strftime(
                            '%Y-%m-%d %H:%M:%S', time.localtime(os.path.getmtime(p)))})
    return out

def profile_save(name, config=None):
    name = ''.join(c for c in (name or 'default') if c.isalnum() or c in '-_')
    d = _states_dir()
    dst = os.path.join(d, name + '.zip')
    tmp = dst + '.tmp'
    n = 0
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(PROFILE_DIR):
            for f in files:
                full = os.path.join(root, f)
                rel = os.path.relpath(full, PROFILE_DIR)
                if rel.split(os.sep)[0] in _SKIP_TOP:
                    continue
                try:
                    z.write(full, rel)
                    n += 1
                except Exception:
                    pass  # 被占用的文件跳过
    os.replace(tmp, dst)
    return {'ok': True, 'name': name, 'files': n, 'size': os.path.getsize(dst)}

def profile_restore(name, config=None):
    name = ''.join(c for c in (name or '') if c.isalnum() or c in '-_')
    src = os.path.join(_states_dir(), name + '.zip')
    if not os.path.exists(src):
        return {'ok': False, 'error': '没有名为 %s 的登录态档案' % name}
    os.makedirs(PROFILE_DIR, exist_ok=True)
    # 先清空 profile（保留目录），再解压覆盖
    for item in os.listdir(PROFILE_DIR):
        p = os.path.join(PROFILE_DIR, item)
        try:
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                os.remove(p)
        except Exception:
            pass
    n = 0
    with zipfile.ZipFile(src) as z:
        for m in z.namelist():
            if m.split('/')[0] in _SKIP_TOP:
                continue
            try:
                z.extract(m, PROFILE_DIR)
                n += 1
            except Exception:
                pass
    return {'ok': True, 'name': name, 'files': n}

def profile_delete(name):
    name = ''.join(c for c in (name or '') if c.isalnum() or c in '-_')
    src = os.path.join(_states_dir(), name + '.zip')
    if os.path.exists(src):
        os.remove(src)
        return {'ok': True}
    return {'ok': False, 'error': '不存在'}
