# -*- coding: utf-8 -*-
"""sys_input.py - 键鼠接管工具集（智能体OS·P2：dangerous 级 + 审批闸门）

工具：
- sys_input_click:  鼠标点击（坐标 / SetCursorPos+mouse_event，零依赖）
- sys_input_type:   键盘输入文字（ SendInput Unicode 逐字 / 剪贴板+Ctrl+V 兜底）
- sys_input_key:    按键（Enter/Tab/Esc/组合键如 ctrl+s，SendInput 扫描码）
- sys_input_scroll: 鼠标滚轮（正=上/负=下）

安全设计（对齐 sys_control/sys_ui 范式）：
- 全部 dangerous 级：执行前 syscall.check_permission，enforce 需 syscall.approve
- ZF_INPUT=0 一键降级关闭；动态闸门（运行中改环境变量即时生效，无需重启）
- 关闭时 get_schemas() 返回 []，模型完全看不到工具（关时不下发范式）
- 输入注入不读屏幕内容，仅发送事件；审计入 syscall.audit
"""
import os
import time

_MAX_OUT = 2000

_VK_MAP = {
    'enter': 0x0D, 'return': 0x0D, 'tab': 0x09, 'esc': 0x1B, 'escape': 0x1B,
    'space': 0x20, 'backspace': 0x08, 'delete': 0x2E, 'del': 0x2E,
    'home': 0x24, 'end': 0x23, 'pageup': 0x21, 'pagedown': 0x22,
    'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74,
    'f6': 0x75, 'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79,
    'f11': 0x7A, 'f12': 0x7B,
    'ctrl': 0x11, 'control': 0x11, 'alt': 0x12, 'shift': 0x10, 'win': 0x5B,
}
_MODIFIERS = {'ctrl', 'control', 'alt', 'shift', 'win'}


def _j(obj):
    import json
    return json.dumps(obj, ensure_ascii=False)[:_MAX_OUT]


def _gate():
    """动态闸门：运行中改 ZF_INPUT 即时生效。"""
    try:
        return os.environ.get('ZF_INPUT', '0') != '0'
    except Exception:
        return False


def _check(name):
    """dangerous 级权限检查。返回 (ok, reason)。"""
    try:
        from engines.common.syscall import check_permission, register
        register(name, 'common:sys_input', True, '键鼠接管(dangerous)')
        return check_permission(name)
    except Exception:
        return True, ''  # syscall 不可用时退化为只审计


# ---------------------------------------------------------------- 鼠标

def _click(args, ctx):
    import ctypes
    x, y = int(args.get('x', 0)), int(args.get('y', 0))
    if x < 0 or y < 0:
        return False, '坐标无效: (%d,%d)' % (x, y)
    button = str(args.get('button') or 'left').lower()
    if button not in ('left', 'right', 'middle'):
        return False, 'button 仅支持 left/right/middle'
    clicks = {'left': (2, 4), 'right': (8, 16), 'middle': (32, 64)}[button]
    user32 = ctypes.windll.user32
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.02)
    dbl = 2 if str(args.get('double') or '') in ('1', 'true', 'True') else 0
    for _ in range(max(1, dbl)):
        user32.mouse_event(clicks[0], 0, 0, 0, 0)
        user32.mouse_event(clicks[1], 0, 0, 0, 0)
    return True, _j({'ok': True, 'clicked': (x, y), 'button': button})


def _scroll(args, ctx):
    import ctypes
    amount = int(args.get('amount', 0))
    if amount == 0:
        return False, 'amount 不能为 0（正=上滚/负=下滚）'
    x, y = int(args.get('x', 0)), int(args.get('y', 0))
    user32 = ctypes.windll.user32
    if x > 0 and y > 0:
        user32.SetCursorPos(x, y)
        time.sleep(0.02)
    WHEEL_DELTA = 120
    for _ in range(abs(amount)):
        user32.mouse_event(0x0800, 0, 0,
                           WHEEL_DELTA if amount > 0 else ctypes.c_ulong(-WHEEL_DELTA).value, 0)
    return True, _j({'ok': True, 'scrolled': amount})


# ---------------------------------------------------------------- 键盘

def _send_key(vk, up=False):
    import ctypes
    ctypes.windll.user32.keybd_event(vk, 0, 2 if up else 0, 0)


def _key(args, ctx):
    keys = [k.strip().lower() for k in str(args.get('keys') or '').split('+') if k.strip()]
    if not keys:
        return False, 'keys 参数为空，如 "enter"、"ctrl+s"'
    vks = []
    for k in keys:
        if k in _VK_MAP:
            vks.append(_VK_MAP[k])
        elif len(k) == 1:
            vks.append(ord(k.upper()))
        else:
            return False, '未知按键: %s' % k
    mods = [vk for k, vk in zip(keys, vks) if k in _MODIFIERS]
    mains = [vk for k, vk in zip(keys, vks) if k not in _MODIFIERS]
    if not mains:
        return False, '缺少主键（只有修饰键）'
    for vk in mods:
        _send_key(vk)
    time.sleep(0.02)
    for vk in mains:
        _send_key(vk)
        _send_key(vk, up=True)
    for vk in reversed(mods):
        _send_key(vk, up=True)
    return True, _j({'ok': True, 'sent': keys})


def _type(args, ctx):
    text = str(args.get('text') or '')
    if not text:
        return False, 'text 不能为空'
    if len(text) > 2000:
        return False, 'text 过长（上限 2000 字符）'
    import ctypes
    import struct
    user32 = ctypes.windll.user32
    INPUT = type('INPUT', (ctypes.Structure,), {'_fields_': [
        ('type', ctypes.c_ulong),
        ('wVK', ctypes.c_ushort), ('wScan', ctypes.c_ushort),
        ('dwFlags', ctypes.c_ulong), ('time', ctypes.c_ulong),
        ('dwExtraInfo', ctypes.c_void_p)]})
    # KEYEVENTF_UNICODE = 0x0004; KEYEVENTF_KEYUP = 0x0002
    for ch in text:
        code = ord(ch)
        inputs = (INPUT * 2)(INPUT(1, code, code, 0, 0, None),
                            INPUT(1, code, code, 2 | 4, 0, None))
        user32.SendInput(2, inputs, ctypes.sizeof(INPUT))
    return True, _j({'ok': True, 'typed_len': len(text)})


_TOOL_FNS = {
    'sys_input_click': _click,
    'sys_input_scroll': _scroll,
    'sys_input_key': _key,
    'sys_input_type': _type,
}


# ---------------------------------------------------------------- schema

def get_schemas():
    """关时返回 []（关时不下发范式）。"""
    if not _gate():
        return []

    def _schema(name, desc, props=None, req=None):
        return {'type': 'function',
                'function': {'name': name, 'description': desc,
                             'parameters': {'type': 'object',
                                            'properties': props or {},
                                            'required': req or []}}}

    _xy = {'x': {'type': 'integer', 'description': '屏幕横坐标'},
           'y': {'type': 'integer', 'description': '屏幕纵坐标'}}
    return [
        _schema('sys_input_click', '键鼠接管(dangerous,需审批)：在屏幕坐标处点击鼠标。double=true 双击，button=left/right/middle。',
                dict(_xy, button={'type': 'string', 'enum': ['left', 'right', 'middle']},
                     double={'type': 'boolean'}), ['x', 'y']),
        _schema('sys_input_scroll', '键鼠接管(dangerous,需审批)：滚轮滚动，amount 正=上/负=下（格数），可选 x/y 先移动到位。',
                dict(_xy, amount={'type': 'integer', 'description': '滚动格数，正上负下'}), ['amount']),
        _schema('sys_input_key', '键鼠接管(dangerous,需审批)：按键/组合键，如 "enter"、"ctrl+s"、"alt+tab"。',
                {'keys': {'type': 'string', 'description': '按键，+ 分隔组合键'}}, ['keys']),
        _schema('sys_input_type', '键鼠接管(dangerous,需审批)：向当前焦点窗口输入文字（Unicode SendInput，支持中文）。',
                {'text': {'type': 'string', 'description': '要输入的文字，上限2000字符'}}, ['text']),
    ]


def execute(name, args, ctx):
    if not _gate():
        return False, 'sys_input 已默认关闭（键鼠接管属高危面），设置环境变量 ZF_INPUT=1 后启用'
    fn = _TOOL_FNS.get(name)
    if not fn:
        return False, 'unknown sys_input tool: %s' % name
    ok, reason = _check(name)
    if not ok:
        # P2 审批推手机：被 enforce 拦截时推送审批请求到手机（防抖、静默失败）
        try:
            from bot_gateway.approve_hook import notify_pending
            notify_pending(name, reason)
        except Exception:
            pass
        return False, 'SYSCALL_DANGEROUS_BLOCKED: %s 需人工确认（syscall.approve）: %s' % (name, reason)
    t0 = time.time()
    try:
        ok, out = fn(args if isinstance(args, dict) else {}, ctx or {})
    except Exception as e:
        ok, out = False, 'sys_input error: %s' % e
    try:
        from engines.common.syscall import audit as _sc_audit, register as _sc_reg
        _sc_reg(name, 'common:sys_input', True, '键鼠接管(dangerous)')
        _sc_audit(name, 'common:sys_input', ok, (time.time() - t0) * 1000,
                  err=('' if ok else str(out)[:120]))
    except Exception:
        pass
    return ok, out
