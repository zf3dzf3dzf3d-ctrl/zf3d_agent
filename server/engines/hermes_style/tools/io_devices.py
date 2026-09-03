#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""hermes_style 桌面输入设备工具：control_mouse / control_keyboard
纯 ctypes (user32)，不依赖 pyautogui。能力：
  鼠标：get(取位置) / move(绝对) / move_rel(相对) / click(左/右/双击) / scroll(滚动)
  键盘：type(打字,支持中文,剪贴板+CtrlV兜底) / press(按键名或VK码) / get(查询按键状态)
"""

import ctypes
import time
import json

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
# 64 位下必须声明指针类型，否则 HANDLE 被截断导致崩溃
kernel32.GlobalAlloc.restype = ctypes.c_void_p
kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
kernel32.GlobalFree.argtypes = [ctypes.c_void_p]
user32.SetClipboardData.restype = ctypes.c_void_p
user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
user32.OpenClipboard.argtypes = [ctypes.c_void_p]
user32.OpenClipboard.restype = ctypes.c_int
user32.CloseClipboard.restype = ctypes.c_int
user32.EmptyClipboard.restype = ctypes.c_int

LONG = ctypes.c_long
from ctypes import wintypes

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP = 0x0008, 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_ABSOLUTE = 0x8000

KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

# 常用按键名 -> VK
VK_MAP = {
    "space": 0x20, "enter": 0x0D, "return": 0x0D, "esc": 0x1B, "escape": 0x1B,
    "tab": 0x09, "backspace": 0x08, "delete": 0x2E, "del": 0x2E,
    "shift": 0x10, "ctrl": 0x11, "control": 0x11, "alt": 0x12, "win": 0x5B,
    "up": 0x26, "down": 0x28, "left": 0x25, "right": 0x27,
    "home": 0x24, "end": 0x23, "pageup": 0x21, "pagedown": 0x22,
    "insert": 0x2D, "capslock": 0x14, "printscreen": 0x2C,
}
for i in range(1, 13):
    VK_MAP["f%d" % i] = 0x6F + i
for c in "abcdefghijklmnopqrstuvwxyz0123456789":
    VK_MAP[c] = ord(c.upper())


def _vk(name):
    n = str(name).strip().lower()
    if n in VK_MAP:
        return VK_MAP[n]
    if n.startswith("0x"):
        return int(n, 16)
    if n.isdigit():
        return int(n)
    return None


# ---------------- control_mouse ----------------

def _t_mouse(args, ctx):
    action = args.get("action", "get")
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    try:
        if action == "get":
            return "OK x=%d y=%d" % (pt.x, pt.y)

        if action in ("move", "move_rel"):
            if action == "move":
                x, y = int(args["x"]), int(args["y"])
            else:
                x, y = pt.x + int(args.get("dx", 0)), pt.y + int(args.get("dy", 0))
            sw, sh = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
            user32.SetCursorPos(max(0, min(sw - 1, x)), max(0, min(sh - 1, y)))
            user32.GetCursorPos(ctypes.byref(pt))
            return "OK moved to x=%d y=%d" % (pt.x, pt.y)

        if action == "click":
            btn = str(args.get("button", "left")).lower()
            times = 2 if btn == "double" else int(args.get("times", 1))
            down, up = (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP) if btn == "right" \
                else (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP)
            for _ in range(max(1, times)):
                user32.mouse_event(down, 0, 0, 0, 0)
                user32.mouse_event(up, 0, 0, 0, 0)
                time.sleep(0.02)
            return "OK %s click x%d @(%d,%d)" % (btn, times, pt.x, pt.y)

        if action == "scroll":
            delta = int(args.get("delta", -120))  # 负=向下滚
            user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0)
            return "OK scrolled %d @(%d,%d)" % (delta, pt.x, pt.y)

        return "ERR unknown action: %s" % action
    except Exception as e:
        return "ERR %s" % e


SCHEMA_mouse = {
    "type": "function",
    "function": {
        "name": "control_mouse",
        "description": "[SENSITIVE] Control the mouse: get position, move absolute/relative, click (left/right/double), scroll. WARNING: this really moves the user's mouse on screen.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["get", "move", "move_rel", "click", "scroll"]},
                "x": {"type": "integer"}, "y": {"type": "integer"},
                "dx": {"type": "integer"}, "dy": {"type": "integer"},
                "button": {"type": "string", "enum": ["left", "right", "double"]},
                "times": {"type": "integer"},
                "delta": {"type": "integer", "description": "scroll amount, negative = down"},
            },
            "required": ["action"],
        },
    },
}


# ---------------- control_keyboard ----------------

def _t_key(args, ctx):
    action = args.get("action", "get")
    try:
        if action == "get":
            vk = _vk(args.get("key", ""))
            if vk is None:
                return "ERR bad key: %s" % args.get("key")
            state = user32.GetAsyncKeyState(vk)
            return "OK key=%s pressed=%s" % (args.get("key"), bool(state & 0x8000))

        if action == "press":
            keys = args.get("keys") or [args.get("key")]
            vks = [_vk(k) for k in keys if k]
            if not vks or any(v is None for v in vks):
                return "ERR bad key in: %s" % keys
            for v in vks:
                user32.keybd_event(v, 0, 0, 0)
            for v in reversed(vks):
                user32.keybd_event(v, 0, KEYEVENTF_KEYUP, 0)
            return "OK pressed %s" % "+".join(str(k) for k in keys)

        if action == "type":
            text = args.get("text", "")
            if not text:
                return "ERR empty text"
            # ASCII 直接逐字符发 UNICODE 事件
            if all(ord(c) < 128 for c in text):
                for c in text:
                    user32.keybd_event(0, ord(c), KEYEVENTF_UNICODE, 0)
                    user32.keybd_event(0, ord(c), KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)
                    time.sleep(0.01)
                return "OK typed %d chars" % len(text)
            # 含中文：走剪贴板 + Ctrl+V
            CF_UNICODETEXT, GMEM_MOVEABLE = 13, 0x0002
            buf = ctypes.create_string_buffer(text.encode("utf-16-le") + b"\x00\x00")
            if not user32.OpenClipboard(None):
                return "ERR open clipboard failed"
            try:
                user32.EmptyClipboard()
                h = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(buf))
                if not h:
                    return "ERR GlobalAlloc failed"
                p = kernel32.GlobalLock(h)
                if not p:
                    kernel32.GlobalFree(h)
                    return "ERR GlobalLock failed"
                ctypes.memmove(p, buf, len(buf))
                kernel32.GlobalUnlock(h)
                if not user32.SetClipboardData(CF_UNICODETEXT, ctypes.c_void_p(h)):
                    kernel32.GlobalFree(h)
                    return "ERR SetClipboardData failed"
            finally:
                user32.CloseClipboard()
            user32.keybd_event(0x11, 0, 0, 0)
            user32.keybd_event(0x56, 0, 0, 0)
            user32.keybd_event(0x56, 0, KEYEVENTF_KEYUP, 0)
            user32.keybd_event(0x11, 0, KEYEVENTF_KEYUP, 0)
            return "OK pasted %d chars (clipboard)" % len(text)

        return "ERR unknown action: %s" % action
    except Exception as e:
        return "ERR %s" % e


SCHEMA_key = {
    "type": "function",
    "function": {
        "name": "control_keyboard",
        "description": "[SENSITIVE] Control the keyboard: press key(s) (e.g. 'ctrl+shift+s', 'enter', 'f5'), type text (Chinese supported via clipboard), or query key pressed state. WARNING: this really types into the user's focused window.",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["press", "type", "get"]},
                "key": {"type": "string", "description": "key name for press/get, e.g. space, enter, f5, a, 0x41"},
                "keys": {"type": "array", "items": {"type": "string"}, "description": "combo for press, e.g. ['ctrl','shift','s']"},
                "text": {"type": "string", "description": "text for type action"},
            },
            "required": ["action"],
        },
    },
}


TOOLS = [
    {"name": "control_mouse", "SCHEMA": SCHEMA_mouse, "run": _t_mouse},
    {"name": "control_keyboard", "SCHEMA": SCHEMA_key, "run": _t_key},
]
