#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""locate_mouse - 鼠标定位/控制（真实系统鼠标）
- get:    获取系统鼠标真实位置（GetCursorPos）
- set:    真实移动系统鼠标到指定位置（SetCursorPos），支持 dx/dy 相对移动
- click:  真实点击鼠标（SendInput/mouse_event），支持 left/right/double
- scroll: 真实滚动滚轮，delta 负=向下 正=向上（一格约 120）
- 其余动作（画布高亮引导等）由前端 App.locateMouse 处理
"""
import ctypes
import ctypes.wintypes
import time

from tools.coding.backend.base import ToolContext

TOOL_NAME = 'locate_mouse'

user32 = ctypes.windll.user32

MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x0008, 0x0010
MOUSEEVENTF_WHEEL = 0x0800


def _get_pos():
    pt = ctypes.wintypes.POINT()
    ok = user32.GetCursorPos(ctypes.byref(pt))
    if not ok:
        return None
    return pt.x, pt.y


def _set_pos(x, y):
    return bool(user32.SetCursorPos(int(x), int(y)))


def _click(btn='left', times=1):
    down, up = (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) if btn == 'right' \
        else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
    for _ in range(max(1, int(times))):
        user32.mouse_event(down, 0, 0, 0, 0)
        user32.mouse_event(up, 0, 0, 0, 0)
        time.sleep(0.02)


def handle(body, ctx):
    action = body.get('action', 'get')

    # 获取系统鼠标真实位置
    if action == 'get':
        pos = _get_pos()
        if pos is None:
            ctx.send_json({'ok': False, 'message': '获取鼠标位置失败', 'tool': TOOL_NAME})
            return
        ctx.send_json({
            'ok': True, 'action': 'get', 'tool': TOOL_NAME,
            'x': pos[0], 'y': pos[1],
            'message': '当前鼠标位置: (%d, %d)' % pos
        })
        return

    # 真实移动系统鼠标（绝对坐标 x/y 或相对位移 dx/dy）
    if action == 'set':
        pos = _get_pos()
        if pos is None:
            ctx.send_json({'ok': False, 'message': '获取当前鼠标位置失败', 'tool': TOOL_NAME})
            return
        cx, cy = pos
        x = body.get('x')
        y = body.get('y')
        dx = body.get('dx')
        dy = body.get('dy')
        if x is not None:
            tx = int(x)
        elif dx is not None:
            tx = cx + int(dx)
        else:
            tx = cx
        if y is not None:
            ty = int(y)
        elif dy is not None:
            ty = cy + int(dy)
        else:
            ty = cy
        if _set_pos(tx, ty):
            ctx.send_json({
                'ok': True, 'action': 'set', 'tool': TOOL_NAME,
                'x': tx, 'y': ty,
                'message': '鼠标已移动到 (%d, %d)（原位置 %d, %d）' % (tx, ty, cx, cy)
            })
        else:
            ctx.send_json({'ok': False, 'message': 'SetCursorPos 调用失败', 'tool': TOOL_NAME})
        return

    # 真实点击系统鼠标（先可带 x/y 或 dx/dy 移动到位再点）
    if action == 'click':
        btn = str(body.get('button', 'left')).lower()
        if btn not in ('left', 'right', 'double'):
            ctx.send_json({'ok': False, 'message': 'button 仅支持 left/right/double', 'tool': TOOL_NAME})
            return
        times = 2 if btn == 'double' else int(body.get('times', 1))
        # 可选：点击前移动到指定位置
        if body.get('x') is not None or body.get('y') is not None or \
           body.get('dx') is not None or body.get('dy') is not None:
            pos = _get_pos()
            if pos is None:
                ctx.send_json({'ok': False, 'message': '获取当前鼠标位置失败', 'tool': TOOL_NAME})
                return
            cx, cy = pos
            tx = int(body['x']) if body.get('x') is not None else cx + int(body.get('dx') or 0)
            ty = int(body['y']) if body.get('y') is not None else cy + int(body.get('dy') or 0)
            _set_pos(tx, ty)
            time.sleep(0.05)
        pos = _get_pos()
        _click('right' if btn == 'right' else 'left', times)
        ctx.send_json({
            'ok': True, 'action': 'click', 'tool': TOOL_NAME,
            'button': btn, 'times': times, 'x': pos[0], 'y': pos[1],
            'message': '已%s点击 %d 次 @(%d, %d)' % (
                '双击' if btn == 'double' else ('右键' if btn == 'right' else '左键'),
                times, pos[0], pos[1])
        })
        return

    # 真实滚动滚轮
    if action == 'scroll':
        delta = int(body.get('delta', -120))
        pos = _get_pos()
        user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
        ctx.send_json({
            'ok': True, 'action': 'scroll', 'tool': TOOL_NAME,
            'delta': delta, 'x': pos[0], 'y': pos[1],
            'message': '已滚动 %d（正=向上 负=向下）@(%d, %d)' % (delta, pos[0], pos[1])
        })
        return

    # 其他动作交由前端处理（此分支一般不会到达，仅兜底）
    ctx.send_json({
        'ok': True, 'action': action, 'tool': TOOL_NAME,
        'message': '该动作由前端处理'
    })
