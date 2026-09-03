#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
engines_loader.py - 底层对话引擎插件加载器

职责：
1. 扫描 server/engines/*/manifest.json，注册 enabled 的引擎
2. 动态 import 各引擎 engine.py（单例缓存），提供统一调用接口
3. manifest/engine.py mtime 变化自动重新加载（热更新，无需重启）

引擎统一接口：
    run(messages, ctx, on_event) -> dict
    - messages: list[dict]  对话消息
    - ctx: dict             上下文 {model_cfg, tool_registry, project_path, payload, headers, target_url}
    - on_event: callable    流式事件回调（可选）
    返回与 OpenAI 兼容的响应 dict（含 choices[0].message.content）
"""

import os
import sys
import json
import importlib
import threading

_ENGINES_DIR = os.path.dirname(os.path.abspath(__file__))
if _ENGINES_DIR not in sys.path:
    sys.path.insert(0, _ENGINES_DIR)

_LOCK = threading.Lock()
_CACHE = {
    'mtime': 0.0,          # 目录指纹
    'manifests': {},       # {engine_id: manifest dict}（仅 enabled）
    'modules': {},         # {engine_id: module} 已加载的 engine 模块
    'module_mtimes': {},   # {engine_id: engine.py mtime}
}
_MANIFEST_MTIMES = {}

DEFAULT_ENGINE = 'zf_core'


def _read_json(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _scan():
    """扫描引擎目录。调用方持锁。"""
    manifests = {}
    mtimes = {}
    try:
        entries = os.listdir(_ENGINES_DIR)
    except OSError:
        entries = []
    for name in sorted(entries):
        if name.startswith('_') or name.startswith('.'):
            continue
        edir = os.path.join(_ENGINES_DIR, name)
        mpath = os.path.join(edir, 'manifest.json')
        epath = os.path.join(edir, 'engine.py')
        if not (os.path.isfile(mpath) and os.path.isfile(epath)):
            continue
        m = _read_json(mpath)
        if not m:
            print('[Engines] invalid manifest skipped: %s' % name)
            continue
        eid = str(m.get('id') or '').strip()
        if not eid or eid != name:
            print('[Engines] id mismatch (manifest.id=%r vs dir=%r), skipped' % (eid, name))
            continue
        if not m.get('name'):
            print('[Engines] manifest missing name, skipped: %s' % name)
            continue
        try:
            mtimes[eid] = os.path.getmtime(epath)
        except OSError:
            mtimes[eid] = 0
        if not m.get('enabled', True):
            continue
        manifests[eid] = m
    return manifests, mtimes


def _fingerprint():
    total = 0.0
    try:
        for name in os.listdir(_ENGINES_DIR):
            for f in ('manifest.json', 'engine.py'):
                fp = os.path.join(_ENGINES_DIR, name, f)
                try:
                    total += os.path.getmtime(fp)
                except OSError:
                    pass
            # tools/ 子目录也纳入指纹：改 tools/*.py 后 tool_count 能实时刷新
            tdir = os.path.join(_ENGINES_DIR, name, 'tools')
            if os.path.isdir(tdir):
                try:
                    for tf in os.listdir(tdir):
                        if tf.endswith('.py'):
                            total += os.path.getmtime(os.path.join(tdir, tf))
                except OSError:
                    pass
    except OSError:
        pass
    return total


def load_engines(force=False):
    """返回 {engine_id: manifest}。带指纹缓存 + 模块热更新。"""
    fp = _fingerprint()
    with _LOCK:
        if not force and fp == _CACHE['mtime'] and _CACHE['manifests']:
            # 检查已加载模块是否有更新
            for eid, mtime in _CACHE['module_mtimes'].items():
                if eid in _CACHE['modules']:
                    try:
                        cur = os.path.getmtime(os.path.join(_ENGINES_DIR, eid, 'engine.py'))
                    except OSError:
                        continue
                    if cur != mtime:
                        _CACHE['modules'].pop(eid, None)
            return _CACHE['manifests']
        manifests, mtimes = _scan()
        _CACHE['mtime'] = fp
        _CACHE['manifests'] = manifests
        _CACHE['module_mtimes'] = mtimes
        # 引擎被删除/禁用时清理模块缓存
        for eid in list(_CACHE['modules'].keys()):
            if eid not in manifests:
                _CACHE['modules'].pop(eid, None)
        return manifests


def get_manifest(engine_id):
    return load_engines().get(str(engine_id or '').strip())


def get_module(engine_id):
    """获取引擎模块（带缓存与热更新）。不可用返回 None。"""
    eid = str(engine_id or '').strip() or DEFAULT_ENGINE
    load_engines()
    with _LOCK:
        if eid not in _CACHE['manifests']:
            return None
        mod = _CACHE['modules'].get(eid)
        if mod is not None:
            return mod
        try:
            mod = importlib.import_module(eid + '.engine')
        except Exception as e:
            print('[Engines] import %s.engine failed: %s' % (eid, e))
            return None
        _CACHE['modules'][eid] = mod
        return mod


def run_engine(engine_id, messages, ctx, on_event=None):
    """统一调用入口。引擎不可用时抛 RuntimeError。"""
    mod = get_module(engine_id)
    if mod is None or not hasattr(mod, 'run'):
        raise RuntimeError('engine not available: %s' % engine_id)
    return mod.run(messages, ctx, on_event)


def execute_tools(engine_id, tool_calls, ctx):
    """本地工具执行入口（local_loop 引擎）。
    引擎无 execute_tool_calls（如 zf_core preprocess 模式）返回 None，
    上层回退到朱峰全局工具执行。"""
    mod = get_module(engine_id)
    if mod is None or not hasattr(mod, 'execute_tool_calls'):
        return None
    return mod.execute_tool_calls(tool_calls, ctx)


def engine_owns_tools(engine_id):
    """该引擎是否带自己的独立工具集（local_loop）。"""
    m = get_manifest(engine_id)
    return bool(m and m.get('engine_mode') == 'local_loop')


def summary():
    """给前端 /api/engines 用的摘要列表。"""
    engines = load_engines()
    out = []
    for eid, m in engines.items():
        # 工具信息：own_tools 引擎带工具数与工具 schema（懒加载统计，不触发模型调用）
        tool_count = 0
        tool_schemas = []
        if m.get('engine_mode') == 'local_loop':
            try:
                _srv_root = os.path.dirname(_ENGINES_DIR)
                if _srv_root not in sys.path:
                    sys.path.insert(0, _srv_root)
                mod = get_module(eid)
                if mod and hasattr(mod, 'get_tool_schemas'):
                    tool_schemas = mod.get_tool_schemas() or []
                    tool_count = len(tool_schemas)
            except Exception:
                tool_count = 0
                tool_schemas = []
        out.append({
            'id': eid,
            'name': m.get('name'),
            'icon': m.get('icon', ''),
            'description': m.get('description', ''),
            'version': m.get('version', ''),
            'engine_mode': m.get('engine_mode', 'preprocess'),
            'own_tools': m.get('engine_mode') == 'local_loop',
            'tool_count': tool_count,
            'tool_schemas': tool_schemas,
            'default': eid == DEFAULT_ENGINE,
        })
    # 默认引擎排最前
    out.sort(key=lambda x: (not x['default'], x['id']))
    return out


if __name__ == '__main__':
    for e in summary():
        print(e)
