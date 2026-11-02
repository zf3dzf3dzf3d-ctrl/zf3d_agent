# -*- coding: utf-8 -*-
"""sys_ui.py - 界面感知工具集（智能体OS·P1：只读，零依赖兜底）

工具（全部只读）：
- sys_ui_foreground: 前台窗口信息（标题/进程/位置）
- sys_ui_windows:    可见顶层窗口枚举（可选关键词过滤）
- sys_ui_screen:     屏幕截图（返回本地文件路径；纯 ctypes 实现，无 Pillow 也可）

设计原则（对齐 sys_tools.py 范式）：
- 全部 ctypes/win32 标准能力，第三方库（Pillow）仅作增强
- 任何异常收敛为字符串，不外抛
- ZF_UISENSE 默认关（默认 '0'，与 sys_tools 的 ZF_SYSTOOLS 默认开相反——
  屏幕属敏感面，须显式开启），ZF_UISENSE=1 开启
- 截图仅落本地 temp，绝不上传
- 输出截断防刷屏，syscall 审计对齐 tool_base 范式
"""
import os
import json
import time
import ctypes
import ctypes.wintypes as wt

# 屏幕感知默认关：敏感面需显式 ZF_UISENSE=1 开启（动态读取，改环境变量后新对话即生效，无需重启）
def _ui_gate():
    return os.environ.get('ZF_UISENSE', '0') == '1'
_MAX_OUT = 6000
_shot_dir = os.path.join(os.environ.get('TEMP', '.'), 'zf_ui_sense')

_u32 = None
_u = None


def _user32():
    global _u32
    if _u32 is None:
        _u32 = ctypes.windll.user32
    return _u32


def _j(obj):
    return json.dumps(obj, ensure_ascii=False)[:_MAX_OUT]


def _win_text(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    _user32().GetWindowTextW(hwnd, buf, 256)
    return buf.value or ''


def _win_pid_title(hwnd):
    pid = wt.DWORD()
    _user32().GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    name = ''
    try:
        import psutil
        p = psutil.Process(pid.value)
        name = p.name()
    except Exception:
        pass
    return pid.value, name


def _visible_window(hwnd):
    if not _user32().IsWindowVisible(hwnd):
        return False
    if _user32().GetWindowLongW(hwnd, 0x4) & 0x10:  # WS_EX_TOOLWINDOW
        return False
    return bool(_win_text(hwnd).strip())


# ---------------------------------------------------------------- 工具实现

def _foreground(args, ctx):
    hwnd = _user32().GetForegroundWindow()
    if not hwnd:
        return True, _j({'error': 'no foreground window'})
    rect = wt.RECT()
    _user32().GetWindowRect(hwnd, ctypes.byref(rect))
    pid, pname = _win_pid_title(hwnd)
    return True, _j({'hwnd': hwnd, 'title': _win_text(hwnd)[:120],
                     'pid': pid, 'process': pname,
                     'rect': [rect.left, rect.top, rect.right, rect.bottom]})


def _windows(args, ctx):
    kw = str((args or {}).get('filter', '')).lower()
    result, cb = [], []

    def _enum_cb(h, _l):
        if _visible_window(h):
            t = _win_text(h)
            if not kw or kw in t.lower():
                pid, pname = _win_pid_title(h)
                result.append({'hwnd': h, 'title': t[:120], 'pid': pid,
                               'process': pname})
        return True

    CMPFUNC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    cb.append(CMPFUNC(_enum_cb))
    _user32().EnumWindows(cb[0], 0)
    result.sort(key=lambda x: x['title'].lower())
    return True, _j({'count': len(result), 'windows': result[:40]})


def _screen(args, ctx):
    # 高 DPI 感知：未声明 DPI aware 时系统会虚拟化缩放，导致截图分辨率被压低、识图模糊
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass
    # 多显示器：EnumDisplayMonitors 枚举全屏，默认合并所有屏；Pillow all_screens=True 同理
    mons = []

    def _mon_cb(hmon, _hdc, rect, _l):
        r = rect.contents
        mons.append((r.left, r.top, r.right, r.bottom))
        return True

    MONCB = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p,
                               ctypes.POINTER(wt.RECT), wt.LPARAM)
    _mcb = MONCB(_mon_cb)
    try:
        _user32().EnumDisplayMonitors(0, 0, _mcb, 0)
    except Exception:
        pass
    if mons:
        left = min(m[0] for m in mons)
        top = min(m[1] for m in mons)
        right = max(m[2] for m in mons)
        bottom = max(m[3] for m in mons)
    else:
        left, top = 0, 0
        right = _user32().GetSystemMetrics(0)
        bottom = _user32().GetSystemMetrics(1)
    v, monitor = bottom - top, right - left  # 兼容下方变量名
    if not (monitor and v):
        return False, 'screen size unavailable'
    os.makedirs(_shot_dir, exist_ok=True)
    path = os.path.join(_shot_dir, 'shot_%s.png' % time.strftime('%Y%m%d_%H%M%S'))
    saved = False
    # 增强：优先 Pillow（all_screens 合并多显示器）
    try:
        from PIL import ImageGrab
        ImageGrab.grab(all_screens=True).save(path)
        saved = True
    except Exception:
        pass
    if not saved:
        # 零依赖兜底：GDI 写 BMP（Pillow 能读 BMP，识图链路通用）
        path = path[:-4] + '.bmp'
        try:
            gdi32, hdc_src = ctypes.windll.gdi32, _user32().GetDC(0)
            hmem = gdi32.CreateCompatibleDC(hdc_src)
            hbmp = gdi32.CreateCompatibleBitmap(hdc_src, monitor, v)
            gdi32.SelectObject(hmem, hbmp)
            _user32().BitBlt(hmem, left, top, monitor, v, hdc_src, left, top, 0x00CC0020)
            class BMPHDR(ctypes.Structure):
                _fields_ = [('bf', ctypes.c_ushort * 2), ('size', ctypes.c_uint),
                            ('r1', ctypes.c_ushort * 2), ('off', ctypes.c_uint),
                            ('biSize', ctypes.c_uint), ('w', ctypes.c_long),
                            ('h', ctypes.c_long), ('planes', ctypes.c_ushort),
                            ('bpp', ctypes.c_ushort), ('comp', ctypes.c_uint),
                            ('imgsize', ctypes.c_uint)]
            gdi32.GetDIBits.restype = ctypes.c_int
            hdr = BMPHDR()
            hdr.bf[0] = 0x4D42
            hdr.off = 54
            hdr.biSize = 40
            hdr.w, hdr.h = monitor, v
            hdr.planes, hdr.bpp = 1, 32
            imgsize = monitor * v * 4
            hdr.imgsize = imgsize
            hdr.size = 54 + imgsize
            buf = ctypes.create_string_buffer(imgsize)
            gdi32.GetDIBits(hmem, hbmp, 0, v, buf,
                            ctypes.byref(hdr), 0)
            with open(path, 'wb') as f:
                f.write(bytes(hdr))
                f.write(buf.raw)
            gdi32.DeleteObject(hbmp)
            gdi32.DeleteDC(hmem)
            _user32().ReleaseDC(0, hdc_src)
            saved = True
        except Exception as e:
            return False, 'screenshot failed: %s' % e
    # 保留上限：只留最近 20 张，防 temp 无限累积
    try:
        _olds = sorted(f for f in os.listdir(_shot_dir)
                       if f.startswith('shot_') and f.endswith(('.png', '.bmp')))
        for _f in _olds[:-20]:
            try:
                os.remove(os.path.join(_shot_dir, _f))
            except Exception:
                pass
    except Exception:
        pass
    return True, _j({'ok': True, 'path': path,
                     'size': [monitor, v],
                     'monitors': len(mons) or 1,
                     'note': '截图仅保存在本机 temp，未上传'})


# ---------------------------------------------------------------- schema/exec

def get_schemas():
    # ZF_UISENSE 关闭时不输出 schema：模型完全看不到工具，避免"调了才知道没开"的空转
    if not _ui_gate():
        return []

    def _schema(name, desc, params=None):
        return {'type': 'function',
                'function': {'name': name, 'description': desc,
                             'parameters': params or {'type': 'object', 'properties': {}}}}
    return [
        _schema('sys_ui_foreground',
                '界面感知：获取当前前台窗口信息（标题/进程/位置）。想知道用户正在看什么窗口时用。'),
        _schema('sys_ui_windows',
                '界面感知：枚举所有可见顶层窗口（标题/进程），可传 filter 关键词过滤。'),
        _schema('sys_ui_screen',
                '界面感知：截取全屏保存到本机 temp，返回图片文件路径（供识图工具读取）。屏幕数据不出本机。'),
    ]


def execute(name, args, ctx):
    if not _ui_gate():
        return False, ('sys_ui 已默认关闭（屏幕属敏感面），设置环境变量 ZF_UISENSE=1 后立即生效')
    fn = {'sys_ui_foreground': _foreground,
          'sys_ui_windows': _windows,
          'sys_ui_screen': _screen}.get(name)
    if not fn:
        return False, 'unknown sys_ui tool: %s' % name
    t0 = time.time()
    try:
        ok, out = fn(args if isinstance(args, dict) else {}, ctx or {})
    except Exception as e:
        ok, out = False, 'sys_ui error: %s' % e
    # syscall 审计（对齐 tool_base 范式，异常静默）
    try:
        from engines.common.syscall import audit as _sc_audit, register as _sc_reg
        _sc_reg(name, 'common:sys_ui', False, '界面感知')
        _sc_audit(name, 'common:sys_ui', ok, (time.time() - t0) * 1000,
                  err=('' if ok else str(out)[:120]))
    except Exception:
        pass
    return ok, out
