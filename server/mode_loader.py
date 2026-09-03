#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mode_loader.py - 对话模式插件加载器

职责：
1. 扫描 modes/*/manifest.json，注册 enabled 的对话模式插件
2. 提供提示词读取（带 mtime 缓存）、文件访问白名单校验
3. manifest mtime 变化自动重新扫描（热更新，无需重启）

规范见 modes/README.md（插件开发手册 v1.0）
"""

import os
import json
import threading

_MODES_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'modes'
))

_LOCK = threading.Lock()
_CACHE = {
    'mtime': 0,        # modes 目录总指纹（各 manifest mtime 之和的哈希近似）
    'modes': {},       # {mode_id: manifest dict}（仅 enabled）
    'manifest_mtimes': {},  # {mode_id: mtime} 用于热更新检测
}
_PROMPT_CACHE = {}   # {mode_id: (fingerprint, content)}


def _read_manifest(path):
    """读单个 manifest，失败返回 None。"""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _scan():
    """扫描 modes 目录，重建注册表。内部不加锁，调用方持锁。"""
    modes = {}
    mtimes = {}
    try:
        entries = os.listdir(_MODES_DIR)
    except OSError:
        entries = []
    for name in sorted(entries):
        if name.startswith('_') or name.startswith('.'):
            continue
        mdir = os.path.join(_MODES_DIR, name)
        mpath = os.path.join(mdir, 'manifest.json')
        if not os.path.isfile(mpath):
            continue
        manifest = _read_manifest(mpath)
        if manifest is None:
            print('[ModeLoader] invalid manifest skipped: %s' % name)
            continue
        mid = str(manifest.get('id') or '').strip()
        if not mid or mid != name:
            print('[ModeLoader] id mismatch (manifest.id=%r vs dir=%r), skipped' % (mid, name))
            continue
        if not manifest.get('name') or 'enabled' not in manifest:
            print('[ModeLoader] manifest missing name/enabled, skipped: %s' % name)
            continue
        try:
            mtimes[name] = os.path.getmtime(mpath)
        except OSError:
            mtimes[name] = 0
        if not manifest.get('enabled'):
            continue  # 记录 mtime 但不注册
        modes[mid] = manifest
    return modes, mtimes


def _fingerprint():
    """目录指纹：任一 manifest mtime 变化即触发重扫。"""
    total = 0.0
    try:
        for name in os.listdir(_MODES_DIR):
            mp = os.path.join(_MODES_DIR, name, 'manifest.json')
            try:
                total += os.path.getmtime(mp)
            except OSError:
                pass
    except OSError:
        pass
    return total


def load_modes(force=False):
    """返回 {mode_id: manifest}。带指纹缓存，manifest 变动自动重扫。"""
    fp = _fingerprint()
    with _LOCK:
        if not force and fp == _CACHE['mtime'] and _CACHE['modes']:
            return _CACHE['modes']
        modes, mtimes = _scan()
        _CACHE['mtime'] = fp
        _CACHE['modes'] = modes
        _CACHE['manifest_mtimes'] = mtimes
        return modes


def get_manifest(mode_id):
    modes = load_modes()
    return modes.get(str(mode_id).strip())


def _plugin_dir(manifest):
    return os.path.join(_MODES_DIR, manifest['id'])


def get_prompt(mode_id):
    """读取插件系统提示词。支持字符串单文件或数组多文件（按序拼接）。
    带 mtime 缓存，文件改动自动失效。返回 None 表示不注入。"""
    manifest = get_manifest(mode_id)
    if not manifest:
        return None
    spec = manifest.get('prompt')
    if not spec:
        return None
    files = spec if isinstance(spec, list) else [spec]
    base = _plugin_dir(manifest)

    # 指纹缓存
    parts_fp = []
    for rel in files:
        fp = os.path.join(base, rel)
        try:
            st = os.stat(fp)
            parts_fp.append('%s:%d:%d' % (rel, int(st.st_mtime), st.st_size))
        except OSError:
            continue
    fingerprint = '|'.join(parts_fp)
    cached = _PROMPT_CACHE.get(mode_id)
    if cached and cached[0] == fingerprint:
        return cached[1]

    chunks = []
    for rel in files:
        fp = os.path.join(base, rel)
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                content = f.read().strip()
        except (OSError, UnicodeDecodeError):
            continue
        if content:
            chunks.append(content)
    if not chunks:
        return None
    full = '\n\n---\n\n'.join(chunks)
    _PROMPT_CACHE[mode_id] = (fingerprint, full)
    return full


def check_file_access(mode_id, path):
    """校验 path 是否在该插件的 fileAccess 白名单内。
    path 为绝对路径或相对项目根路径；白名单条目为相对项目根路径。
    未声明 fileAccess 的插件 -> 拒绝所有文件访问（安全默认）。"""
    manifest = get_manifest(mode_id)
    if not manifest:
        return False
    whitelist = manifest.get('fileAccess') or []
    if not whitelist:
        return False
    norm = os.path.normpath(str(path)).replace('\\', '/').lower()
    if os.path.isabs(norm):
        # 绝对路径：尝试剥掉项目根前缀
        root = os.path.normpath(os.path.join(_MODES_DIR, '..')).replace('\\', '/').lower()
        if norm.startswith(root + '/'):
            norm = norm[len(root) + 1:]
    for item in whitelist:
        w = os.path.normpath(str(item)).replace('\\', '/').lower()
        if norm == w or norm.endswith('/' + w) or w.endswith('/*') and norm.startswith(w[:-2]):
            return True
    return False


def get_limits(mode_id):
    """返回插件 limits 段（dict），无则空 dict。"""
    manifest = get_manifest(mode_id)
    if not manifest:
        return {}
    lim = manifest.get('limits')
    return lim if isinstance(lim, dict) else {}


def summary():
    """给前端 /api/modes 用的摘要列表。"""
    modes = load_modes()
    out = []
    for mid, m in modes.items():
        out.append({
            'id': mid,
            'name': m.get('name'),
            'icon': m.get('icon', ''),
            'description': m.get('description', ''),
            'version': m.get('version', ''),
            'panel': (m.get('entry') or {}).get('panel', '') if isinstance(m.get('entry'), dict) else '',
        })
    return out


if __name__ == '__main__':
    for m in summary():
        print(m)
