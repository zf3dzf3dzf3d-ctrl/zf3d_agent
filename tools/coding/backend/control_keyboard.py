#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""control_keyboard - 键盘状态获取/控制
- get:   查询按键当前是否按下（GetAsyncKeyState）
- press: 真实敲击按键（SendInput），支持组合键如 "ctrl+s"、单键 "a"、
         以及 press + hold_ms 按住指定毫秒
- text:  通过 KEYEVENTF_UNICODE 输入一段文本（支持中文）
"""
import ctypes
import time

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'control_keyboard'

user32 = ctypes.windll.user32

# 常用虚拟键码
_VK = {
    'backspace': 0x08, 'tab': 0x09, 'enter': 0x0D, 'return': 0x0D,
    'shift': 0x10, 'ctrl': 0x11, 'control': 0x11, 'alt': 0x12, 'menu': 0x12,
    'pause': 0x13, 'capslock': 0x14, 'esc': 0x1B, 'escape': 0x1B,
    'space': 0x20, 'pageup': 0x21, 'pagedown': 0x22, 'end': 0x23,
    'home': 0x24, 'left': 0x25, 'up': 0x26, 'right': 0x27, 'down': 0x28,
    'insert': 0x2D, 'delete': 0x2E, 'del': 0x2E,
    'win': 0x5B, 'lwin': 0x5B, 'rwin': 0x5C, 'apps': 0x5D,
    'numpad0': 0x60, 'numpad1': 0x61, 'numpad2': 0x62, 'numpad3': 0x63,
    'numpad4': 0x64, 'numpad5': 0x65, 'numpad6': 0x66, 'numpad7': 0x67,
    'numpad8': 0x68, 'numpad9': 0x69,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74,
    'f6': 0x75, 'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79,
    'f11': 0x7A, 'f12': 0x7B,
}


def _vk_of(name):
    """把按键名转成虚拟键码。支持 'a'、'A'、'0'、'f5'、'ctrl' 等。"""
    k = str(name).strip().lower()
    if k in _VK:
        return _VK[k]
    if len(k) == 1:
        return ord(k.upper())
    raise ValueError('未知按键: %s' % name)


class _KEYBDINPUT(ctypes.Structure):
    _fields_ = [('wVk', ctypes.c_ushort),
                ('wScan', ctypes.c_ushort),
                ('dwFlags', ctypes.c_ulong),
                ('time', ctypes.c_ulong),
                ('dwExtraInfo', ctypes.POINTER(ctypes.c_ulong))]


class _INPUT(ctypes.Structure):
    class _I(ctypes.Union):
        _fields_ = [('ki', _KEYBDINPUT)]
    _fields_ = [('type', ctypes.c_ulong), ('ki', _I)]

    def __init__(self, vk=0, scan=0, flags=0):
        super().__init__()
        self.type = 1  # INPUT_KEYBOARD
        self.ki = self._I()
        self.ki.ki.wVk = vk
        self.ki.ki.wScan = scan
        self.ki.ki.dwFlags = flags


KEYUP = 0x0002
UNICODE = 0x0004


def _send_input(inputs):
    n = user32.SendInput(len(inputs), (_INPUT * len(inputs))(*inputs),
                         ctypes.sizeof(_INPUT))
    return n == len(inputs)


def _get_state(keys):
    """返回每个按键是否处于按下状态。"""
    result = {}
    for k in keys:
        try:
            vk = _vk_of(k)
        except ValueError as e:
            result[k] = '错误: %s' % e
            continue
        # GetAsyncKeyState 最高位为 1 表示按下
        result[k] = bool(user32.GetAsyncKeyState(vk) & 0x8000)
    return result


def _press(keys, hold_ms=0):
    """敲击一组按键（组合键：修饰键按住 → 主键按下抬起 → 修饰键抬起）。"""
    vks = [_vk_of(k) for k in keys]
    downs = [_INPUT(vk=v) for v in vks]
    ups = [_INPUT(vk=v, flags=KEYUP) for v in reversed(vks)]
    if hold_ms and hold_ms > 0:
        if not _send_input(downs):
            return False
        time.sleep(hold_ms / 1000.0)
        return _send_input(ups)
    return _send_input(downs + ups)


def _type_text(text):
    """UNICODE 方式输入文本（支持中文）。"""
    ok = True
    for ch in text:
        code = ord(ch)
        down = _INPUT(scan=code, flags=UNICODE)
        up = _INPUT(scan=code, flags=UNICODE | KEYUP)
        if not _send_input([down, up]):
            ok = False
        time.sleep(0.005)
    return ok


def handle(body, ctx):
    action = body.get('action', 'get')

    # 查询按键状态
    if action == 'get':
        keys = body.get('keys')
        if isinstance(keys, str):
            keys = [k.strip() for k in keys.split('+') if k.strip()]
        if not keys:
            keys = ['ctrl', 'shift', 'alt']
        state = _get_state(keys)
        pressed = [k for k, v in state.items() if v is True]
        ctx.send_json({
            'ok': True, 'action': 'get', 'tool': TOOL_NAME,
            'state': state, 'pressed': pressed,
            'message': '按键状态: %s%s' % (
                state, ('（正在按住: %s）' % ', '.join(pressed)) if pressed else '')
        })
        return

    # 敲击按键/组合键
    if action == 'press':
        key = body.get('keys') or body.get('key') or ''
        if not key:
            ctx.send_json({'ok': False, 'message': '缺少 keys 参数，如 "ctrl+s" 或 "a"', 'tool': TOOL_NAME})
            return
        keys = [k.strip() for k in str(key).split('+') if k.strip()]
        try:
            hold = int(body.get('hold_ms') or 0)
            ok = _press(keys, hold)
        except (ValueError, TypeError) as e:
            ctx.send_json({'ok': False, 'message': str(e), 'tool': TOOL_NAME})
            return
        if ok:
            ctx.send_json({
                'ok': True, 'action': 'press', 'tool': TOOL_NAME,
                'message': '已敲击: %s' % '+'.join(keys)
            })
        else:
            ctx.send_json({'ok': False, 'message': 'SendInput 调用失败', 'tool': TOOL_NAME})
        return

    # 输入文本
    if action == 'text':
        text = body.get('text', '')
        if text == '':
            ctx.send_json({'ok': False, 'message': '缺少 text 参数', 'tool': TOOL_NAME})
            return
        if _type_text(str(text)):
            ctx.send_json({
                'ok': True, 'action': 'text', 'tool': TOOL_NAME,
                'message': '已输入文本（%d 字符）' % len(str(text))
            })
        else:
            ctx.send_json({'ok': False, 'message': 'SendInput 输入文本失败', 'tool': TOOL_NAME})
        return

    ctx.send_json({'ok': False, 'message': '未知 action: %s（支持 get/press/text）' % action, 'tool': TOOL_NAME})
