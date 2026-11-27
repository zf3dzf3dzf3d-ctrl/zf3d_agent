# -*- coding: utf-8 -*-
"""M1.0 沙箱探针：在被测解释器内运行，输出单行 PROBE:<json>。

铁律：绝不真正写入任何文件（append-open 后立即 close，零字节写入）；
绝不输出任何文件内容或剪贴板内容，只输出能力判定。
cwd 必须是项目根。八项检查 + 解释器自证。
"""
import json
import os
import socket
import subprocess
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def ok_result(fn):
    try:
        return fn()
    except PermissionError as e:
        return {'ok': False, 'denied': True, 'err': 'PermissionError: ' + str(e)[:60]}
    except OSError as e:
        return {'ok': False, 'denied': getattr(e, 'errno', None) in (5, 13), 'err': 'OSError: ' + str(e)[:60]}
    except (ImportError, ValueError, TypeError, AttributeError) as e:
        # 探针各检查的失败模式全集：文件/套接字 ⊂ OSError，ctypes 缺失 ⊂ ImportError，
        # 调用协议 ⊂ ValueError/TypeError/AttributeError；之外的异常不在此吞，响亮失败
        return {'ok': False, 'err': type(e).__name__ + ': ' + str(e)[:60]}


def try_write_append(rel):
    """以 append 模式打开后立即关闭——零字节写入，文件内容与 mtime 不变。"""
    def f():
        fd = os.open(rel, os.O_WRONLY | os.O_APPEND)
        os.close(fd)
        return {'ok': True, 'denied': False}
    return f


def try_write_create(rel):
    def f():
        fd = os.open(rel, os.O_CREAT | os.O_WRONLY)
        os.close(fd)
        try:
            os.remove(rel)
        except OSError:
            pass
        return {'ok': True, 'denied': False}
    return f


def try_read_first_byte(rel):
    def f():
        with open(rel, 'rb') as f:
            n = len(f.read(1))
        return {'ok': n == 1, 'denied': False}
    return f


def try_workspace_write():
    def f():
        path = os.path.join('tmp', 'zfsbx', 'probe_%d.txt' % os.getpid())
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w', encoding='ascii') as f:
            f.write('sandbox-write-ok')
        os.remove(path)
        return {'ok': True, 'denied': False}
    return f


def try_clipboard():
    """调用级判定：EmptyClipboard/SetClipboardData/GetClipboardData 各自的成败。

    Job 的 JOB_OBJECT_UILIMIT_* 闸的就是这些 API 本身；不做数据比对
    （本机有剪贴板同步工具干扰属主为 NULL 的写入，比对不可靠）。"""
    def f():
        import ctypes
        user32 = ctypes.windll.user32
        k32 = ctypes.windll.kernel32
        k32.GlobalAlloc.restype = ctypes.c_void_p
        k32.GlobalLock.restype = ctypes.c_void_p
        k32.GlobalLock.argtypes = (ctypes.c_void_p,)
        k32.GlobalUnlock.argtypes = (ctypes.c_void_p,)
        user32.SetClipboardData.restype = ctypes.c_void_p
        user32.SetClipboardData.argtypes = (ctypes.c_uint, ctypes.c_void_p)
        user32.GetClipboardData.restype = ctypes.c_void_p
        user32.GetClipboardData.argtypes = (ctypes.c_uint,)

        if not user32.OpenClipboard(0):
            return {'ok': True, 'denied': True, 'write': False, 'read': False,
                    'err': 'OpenClipboard 拒绝'}
        try:
            h = k32.GlobalAlloc(0x2000, 16)
            p = k32.GlobalLock(h)
            if p:
                ctypes.memmove(p, b'zfsbx' + b'\x00' * 11, 16)
                k32.GlobalUnlock(h)
            write = bool(user32.EmptyClipboard()) and bool(user32.SetClipboardData(13, h))
        finally:
            user32.CloseClipboard()
        if not write:
            return {'ok': True, 'denied': True, 'write': False, 'read': False,
                    'err': '写剪贴板被拒（UI 限制）'}
        read = False
        if user32.OpenClipboard(0):
            try:
                read = bool(user32.GetClipboardData(13))
            finally:
                user32.CloseClipboard()
            return {'ok': True, 'denied': False, 'write': True, 'read': read}
        return {'ok': True, 'denied': True, 'write': True, 'read': False,
                'err': '读阶段 OpenClipboard 拒绝（UI 限制）'}
    return f


def try_connect(host, port):
    def f():
        s = socket.create_connection((host, port), timeout=4)
        s.close()
        return {'ok': True, 'denied': False}
    return f


def try_spawn():
    def f():
        r = subprocess.run([sys.executable, '-c', 'print(123)'],
                           capture_output=True, timeout=20)
        return {'ok': (r.returncode == 0 and b'123' in r.stdout), 'denied': False}
    return f


def _detect_port():
    """从 private/port.json 读当前实例端口；读不到回退 8620 默认值。"""
    try:
        import json as _json
        pj = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__)))), 'private', 'port.json')
        with open(pj, 'r', encoding='utf-8-sig') as f:
            return int(_json.load(f).get('port') or 8620)
    except Exception:
        return 8620


results = {
    'interp': {'exe': os.path.basename(sys.executable),
               'ver': '.'.join(str(v) for v in sys.version_info[:3])},
    'import_ctypes': ok_result(lambda: (__import__('ctypes'), {'ok': True})[1]),
    'write_private_keys': ok_result(try_write_append(os.path.join('private', 'api_keys.json'))),
    'read_private_keys': ok_result(try_read_first_byte(os.path.join('private', 'api_keys.json'))),
    'write_git': ok_result(try_write_create(os.path.join('.git', 'zfsbx_probe_tmp'))),
    'write_enforcement_ro': ok_result(try_write_append(os.path.join('server', 'engines', 'common', 'syscall.py'))),
    'write_enforcement_crit': ok_result(try_write_append(os.path.join('server', 'security.py'))),
    'write_workspace': ok_result(try_workspace_write()),
    'clipboard_read': ok_result(try_clipboard()),
    'net_inet': ok_result(try_connect('1.1.1.1', 53)),
    'net_loopback': ok_result(try_connect('127.0.0.1', _detect_port())),  # 诊断探测当前实例端口，从 private/port.json 动态读取，杜绝写死
    'spawn_child': ok_result(try_spawn()),
}

print('PROBE:' + json.dumps(results, ensure_ascii=True, sort_keys=True))
sys.stdout.flush()
