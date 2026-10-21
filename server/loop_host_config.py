# -*- coding: utf-8 -*-
"""loop_host 配置读取（循环内核化·阶段A 开关）

用途：声明式选择 ReAct 循环宿主：
  - browser：浏览器 JS 循环（public/js/agent-02-loop-core.js，现状默认，零行为变化）
  - server ：Python 内核循环（server/engines/common/agent_loop.py，阶段B起启用）

设计要点：
  - 默认 browser：配置文件缺失/损坏/值非法一律回退 browser，保证阶段A零风险。
  - 带缓存的 json 读取：get_loop_host()，配置文件 mtime 变化自动重读（无需重启）。
  - is_server_host() 便捷判断，供阶段B/C 接线使用；阶段A无任何调用方，纯前置。
配置文件：private/loop_host.json（与 port.json 同级）
"""
import json
import os

_PRIVATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'private')
CFG_PATH = os.path.join(_PRIVATE_DIR, 'loop_host.json')
DEFAULT_HOST = 'browser'
_ALLOWED = ('browser', 'server')

_cache = {'mtime': None, 'value': DEFAULT_HOST}


def _read_raw():
    """读原始配置值（不缓存），异常回退默认。"""
    try:
        with open(CFG_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        v = str(data.get('loop_host', '')).strip().lower()
        return v if v in _ALLOWED else DEFAULT_HOST
    except Exception:
        return DEFAULT_HOST


def get_loop_host():
    """获取当前循环宿主（带 mtime 缓存；配置文件变更自动生效）。返回 'browser' | 'server'。"""
    try:
        mtime = os.path.getmtime(CFG_PATH)
    except OSError:
        mtime = None
    if mtime != _cache['mtime']:
        _cache['mtime'] = mtime
        _cache['value'] = _read_raw()
    return _cache['value']


def is_server_host():
    """阶段B接线用：当前是否应由服务端内核驱动循环。"""
    return get_loop_host() == 'server'


if __name__ == '__main__':
    print('CFG_PATH =', CFG_PATH)
    print('loop_host =', get_loop_host())
