#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
health_center.py — 守卫统一适配层（底盘治理步骤5·阶段三）
目标：把分散的守卫（path_guard / network_guard / view_guard /
manifest_guard / watchdog / agent_chat_watch）的状态收敛到一个统一查询入口，
新旧并行切换：旧守卫逻辑不动，health_center 只做只读聚合与注册表管理。

用法（服务端内）：
    from health_center import collect, register_probe, status
    collect()      # 聚合所有已注册探针
    status()       # dict 摘要

新增守卫接入手册：
    register_probe(name, callable) -> callable 返回 {ok: bool, detail: str}
"""
import os
import sys
import time
import threading

_SRV = os.path.dirname(os.path.abspath(__file__))
if _SRV not in sys.path:
    sys.path.insert(0, _SRV)

_LOCK = threading.Lock()
_PROBES = {}          # name -> callable() -> (ok, detail)
_LAST = {}            # name -> {'ok','detail','ts'}


def register_probe(name, fn):
    """注册一个守卫探针。fn() 返回 (ok: bool, detail: str)，异常自动收敛为失败。"""
    with _LOCK:
        _PROBES[name] = fn


def _safe_call(fn):
    try:
        r = fn()
        if isinstance(r, (tuple, list)) and len(r) >= 2:
            return bool(r[0]), str(r[1])
        return bool(r), 'ok' if r else 'not ok'
    except Exception as e:
        return False, 'probe error: %s' % e


def collect():
    """聚合全部已注册探针，返回 {name: {ok, detail, ts}}。"""
    with _LOCK:
        items = list(_PROBES.items())
    out = {}
    for name, fn in items:
        ok, detail = _safe_call(fn)
        rec = {'ok': ok, 'detail': detail, 'ts': time.time()}
        out[name] = rec
        with _LOCK:
            _LAST[name] = rec
    return out


def status():
    d = collect()
    return {
        'healthy': all(v['ok'] for v in d.values()) if d else True,
        'probes': d,
        'count': len(d),
    }


# ---------------- 内置探针：只读检查各守卫的静态状态，不触发旧守卫动作 ----------------

def _probe_files():
    """核心守卫模块文件在位检查（缺失说明部署不完整）。"""
    need = ['path_guard.py', 'network_guard.py',
            'view_guard.py', 'engines/manifest_guard.py']
    missing = [n for n in need if not os.path.exists(os.path.join(_SRV, n))]
    if missing:
        return False, 'missing guards: %s' % ', '.join(missing)
    return True, '%d guard modules present' % len(need)


def _probe_watchdog():
    """watchdog 心跳文件新鲜度（存在且 10 分钟内=健康；不存在=未启用，不判失败）。"""
    hb = os.path.join(_SRV, '.watchdog_heartbeat')
    if not os.path.exists(hb):
        return True, 'watchdog heartbeat not present (not started)'
    age = time.time() - os.path.getmtime(hb)
    if age < 600:
        return True, 'heartbeat %.0fs ago' % age
    return False, 'heartbeat stale %.0fs' % age


def _probe_server_health():
    """本机 /api/health 探活（仅当能读到端口配置时）。"""
    import json
    try:
        pj = os.path.join(os.path.dirname(_SRV), 'private', 'port.json')
        with open(pj, 'r', encoding='utf-8-sig') as f:
            port = int(json.load(f).get('api_port', 8555))
    except Exception:
        return True, 'port.json unreadable, skip'
    import urllib.request
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=3) as r:
            return r.status == 200, 'api/health %d' % r.status
    except Exception as e:
        return False, 'api/health fail: %s' % e


register_probe('guard_files', _probe_files)
register_probe('watchdog', _probe_watchdog)
register_probe('server_health', _probe_server_health)

if __name__ == '__main__':
    import json as _json
    print(_json.dumps(status(), ensure_ascii=False, indent=2))
