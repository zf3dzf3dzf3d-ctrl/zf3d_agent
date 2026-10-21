# -*- coding: utf-8 -*-
"""sys_hotkey: P3 全局热键守护（ZhuFeng Agent OS 感知/控制/接管第三阶段）

提供 RegisterHotKey 全局热键能力：
- sys_hotkey_register: 注册全局热键（Ctrl/Alt/Win+Shift 组合 + 按键）
- sys_hotkey_list: 列出已注册热键
- sys_hotkey_unregister: 注销热键
安全设计（照抄 sys_input/sys_ui 范式）：
- ZF_HOTKEY 环境变量动态闸门，默认关闭；关时 schema 不下发、执行直接拒绝
- 注册/注销走 syscall audit 审计
- 热键触发只写入回调文件（事件落盘），不直接执行任何动作——动作执行由上层
  （bot_gateway/butler_conductor）消费，热键层与动作层解耦
"""
import os
import json
import ctypes
from ctypes import wintypes

from engines.common.syscall import audit as _syscall_audit

# ---- 动态闸门（不固化，运行中改 ZF_HOTKEY 即时生效） ----
def _hotkey_gate():
    return os.environ.get('ZF_HOTKEY', '0') == '1'

# 事件落盘目录
EVENT_DIR = os.path.join(os.environ.get('TEMP', '.'), 'zf_hotkey_events')
os.makedirs(EVENT_DIR, exist_ok=True)

# 已注册热键表: id -> {modifiers, vk, name, event_file}
_REGISTRY = {}
_NEXT_ID = [1]

MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN = 0x1, 0x2, 0x4, 0x8
_MOD_MAP = {'alt': MOD_ALT, 'ctrl': MOD_CONTROL, 'control': MOD_CONTROL,
            'shift': MOD_SHIFT, 'win': MOD_WIN}
_HOTKEY_THREAD = [None]

_VK_MAP = {
    'space': 0x20, 'enter': 0x0D, 'esc': 0x1B, 'escape': 0x1B, 'tab': 0x09,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74, 'f6': 0x75,
    'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
}
for _c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789':
    _VK_MAP[_c.lower()] = ord(_c)


def _parse_combo(combo):
    """'ctrl+alt+space' -> (mods, vk)；至少一个修饰键 + 一个主键"""
    parts = [p.strip().lower() for p in combo.split('+') if p.strip()]
    if len(parts) < 2:
        return None, '热键格式: 修饰键+主键，如 ctrl+alt+space（必须含至少一个修饰键）'
    mods, vk = 0, None
    for p in parts:
        if p in _MOD_MAP:
            mods |= _MOD_MAP[p]
        elif p in _VK_MAP:
            if vk is not None:
                return None, '只能有一个主键'
            vk = _VK_MAP[p]
        else:
            return None, '未知按键: %s' % p
    if vk is None:
        return None, '缺少主键'
    if mods == 0:
        return None, '必须含至少一个修饰键（ctrl/alt/shift/win），防误触普通按键'
    return (mods, vk), None


def _fire_event(hotkey_id, name):
    """热键触发：写事件文件（不执行动作，与动作层解耦）"""
    evt = {'id': hotkey_id, 'name': name, 'ts': __import__('time').time()}
    try:
        path = os.path.join(EVENT_DIR, 'evt_%d_%s.json' % (hotkey_id, int(evt['ts'] * 1000)))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(evt, f, ensure_ascii=False)
        _syscall_audit('sys_hotkey_fire', 'common:sys_hotkey', True, 0)
    except Exception as e:
        _syscall_audit('sys_hotkey_fire', 'common:sys_hotkey', False, 0, err=str(e))


def _hotkey_thread_loop():
    """后台消息循环线程：接收 WM_HOTKEY 并写事件文件"""
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    msg = wintypes.MSG()
    while _REGISTRY:
        peeked = user32.PeekMessageW(ctypes.byref(msg), None,
                                     0x0312, 0x0312, 0x0001)  # WM_HOTKEY
        if peeked:
            info = _REGISTRY.get(msg.wParam)
            if info:
                _fire_event(msg.wParam, info['name'])
            user32.DispatchMessageW(ctypes.byref(msg))
        else:
            kernel32.Sleep(50)


def _ensure_thread():
    import threading
    if _HOTKEY_THREAD[0] is None or not _HOTKEY_THREAD[0].is_alive():
        _HOTKEY_THREAD[0] = threading.Thread(target=_hotkey_thread_loop, daemon=True)
        _HOTKEY_THREAD[0].start()


def _register(args):
    combo = args.get('combo', '')
    name = args.get('name', 'unnamed')
    parsed, err = _parse_combo(combo)
    if err:
        return False, err
    mods, vk = parsed
    user32 = ctypes.windll.user32
    # 查重
    for hid, info in _REGISTRY.items():
        if info['mods'] == mods and info['vk'] == vk:
            return False, '热键已注册: %s (id=%d, name=%s)' % (combo, hid, info['name'])
    hid = _NEXT_ID[0]
    _NEXT_ID[0] += 1
    if not user32.RegisterHotKey(None, hid, mods, vk):
        return False, 'RegisterHotKey 失败（可能被其他程序占用）: %s' % combo
    _REGISTRY[hid] = {'mods': mods, 'vk': vk, 'name': name, 'combo': combo}
    _ensure_thread()
    _syscall_audit('sys_hotkey_register', 'common:sys_hotkey', True, 0)
    return True, '已注册 %s -> %s (id=%d)，触发时事件写入 %s' % (combo, name, hid, EVENT_DIR)


def _list(_args):
    items = [{'id': hid, 'combo': info['combo'], 'name': info['name']}
             for hid, info in sorted(_REGISTRY.items())]
    return True, {'hotkeys': items, 'event_dir': EVENT_DIR,
                  'thread_alive': bool(_HOTKEY_THREAD[0] and _HOTKEY_THREAD[0].is_alive())}


def _unregister(args):
    hid = args.get('id')
    try:
        hid = int(hid)
    except (TypeError, ValueError):
        return False, '需要热键 id（用 sys_hotkey_list 查询）'
    info = _REGISTRY.pop(hid, None)
    if not info:
        return False, '未找到 id=%s' % hid
    ctypes.windll.user32.UnregisterHotKey(None, hid)
    _syscall_audit('sys_hotkey_unregister', 'common:sys_hotkey', True, 0)
    return True, '已注销 %s' % info['combo']


# 预置急停组合：ctrl+alt+shift+x（P3 策划案约定），触发即写 panic 事件由守护层消费
_PANIC_COMBO = 'ctrl+alt+shift+x'


def get_schemas():
    if not _hotkey_gate():
        return []
    return [
        {'type': 'function', 'function': {
            'name': 'sys_hotkey_register',
            'description': '注册全局系统热键（如 ctrl+alt+space）。必须含至少一个修饰键。触发时事件写入本机 temp 目录，不直接执行动作。用于 P3 意图条唤起/急停等入口。',
            'parameters': {'type': 'object', 'properties': {
                'combo': {'type': 'string', 'description': '热键组合，如 ctrl+alt+space'},
                'name': {'type': 'string', 'description': '热键用途名称'}},
                'required': ['combo', 'name']}}},
        {'type': 'function', 'function': {
            'name': 'sys_hotkey_list',
            'description': '列出已注册的全局热键及事件目录。',
            'parameters': {'type': 'object', 'properties': {}}}},
        {'type': 'function', 'function': {
            'name': 'sys_hotkey_unregister',
            'description': '注销指定 id 的全局热键。',
            'parameters': {'type': 'object', 'properties': {
                'id': {'type': 'integer', 'description': '热键 id（sys_hotkey_list 查询）'}},
                'required': ['id']}}},
    ]


def execute(tool, args, ctx):
    if not _hotkey_gate():
        return False, 'sys_hotkey 已默认关闭（全局热键属高危面），设置环境变量 ZF_HOTKEY=1 后启用'
    handlers = {'sys_hotkey_register': _register,
                'sys_hotkey_list': _list,
                'sys_hotkey_unregister': _unregister}
    h = handlers.get(tool)
    if not h:
        return False, 'unknown sys_hotkey tool: %s' % tool
    try:
        return h(args or {})
    except Exception as e:
        return False, 'sys_hotkey error: %s' % e
