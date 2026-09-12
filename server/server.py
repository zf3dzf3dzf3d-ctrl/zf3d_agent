#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰社区无限智能体 - SQLite 数据服务
纯 Python 标准库实现,无第三方依赖。

端口: 默认 8508(private/port.json 可覆盖)
数据: private/db/zf3d_canvas.db
API 前缀: /api/db/*

启动: python server.py
"""

import os
import json
import sys
import ssl
import socket
import time
import threading
import traceback
from http.server import HTTPServer, ThreadingHTTPServer

# 导入拆分后的模块
# Path bootstrap: so that even in embedded Python (python311._pth isolated mode) sys.path contains the script directory
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# 项目根目录加入 sys.path（tools/ 包在项目根下）
_PROJECT_ROOT = os.path.dirname(_HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# 引擎目录加入 sys.path（engines_loader 及各引擎子包）
_ENGINES_DIR = os.path.join(_HERE, 'engines')
if _ENGINES_DIR not in sys.path:
    sys.path.insert(0, _ENGINES_DIR)

from config import HOST, PORT, DB_PATH, BASE_DIR, PUBLIC_DIR, VERSION, WS_PORT, QUIET_CONSOLE
from db import init_db
from handler_base import HandlerBase
from handler_routes import HandlerRoutes

# 服务器类:静默客户端中断噪音(ConnectionAbortedError/ConnectionResetError 等)
# 注意: socketserver 打印 "Exception occurred during processing of request" 用的是
# 服务器类自身的 handle_error,而不是 Handler 上的 handle_error,所以必须在这里覆盖。
class QuietHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError,
                            BrokenPipeError, TimeoutError, ConnectionError)):
            return  # 客户端主动断开,属正常现象,静默
        traceback.print_exc()

# 主处理器:组合所有 Mixin
class DBHandler(HandlerRoutes, HandlerBase):
    """主请求处理器:组合基类 + 工具处理 + 路由处理"""
    pass


def _port_in_use():
    """检测端口是否被占用(可能是旧实例或其他程序)"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1.5)
            return s.connect_ex((HOST, PORT)) == 0
    except Exception:
        return False


def _service_alive():
    """Probe the HTTP service on the port and confirm that the hot-reload directory belongs to the current project"""
    try:
        import urllib.request
        with urllib.request.urlopen(f'http://{HOST}:{PORT}/api/hot-reload/status', timeout=2.5) as resp:
            if resp.status >= 500:
                return False
            payload = json.loads(resp.read().decode('utf-8'))
        status = payload.get('status') or {}
        expected_base = os.path.abspath(BASE_DIR).casefold()
        actual_base = os.path.abspath(status.get('base_dir', '')).casefold()
        return payload.get('ok') is True and actual_base == expected_base
    except Exception:
        return False


def _write_pid_file():
    """将当前 server.py 的 PID 写入 private/server.pid,供 engine.js 精准定位杀进程"""
    try:
        import atexit
        pid = os.getpid()
        pid_file = os.path.join(BASE_DIR, 'private', 'server.pid')
        os.makedirs(os.path.dirname(pid_file), exist_ok=True)
        with open(pid_file, 'w', encoding='utf-8') as f:
            f.write(str(pid))
        def _cleanup():
            try:
                if os.path.exists(pid_file):
                    with open(pid_file, 'r', encoding='utf-8-sig') as f:
                        owner = (f.read() or '').strip()
                    if owner == str(pid):
                        os.remove(pid_file)
            except Exception:
                pass
        atexit.register(_cleanup)
        if not QUIET_CONSOLE:
            print(f'[Server] PID {pid} written to {pid_file}')
    except Exception as e:
        print(f'[Server] 写 PID 文件失败: {e}')


def _kill_stale_instances():
    """杀掉所有本项目的旧 server.py 实例(命令行含 server\\server.py 且非当前 PID)。
    仅按命令行精确匹配,不会误杀其他 Python 程序。纯标准库实现。"""
    import subprocess
    me = os.getpid()
    killed = []
    try:
        out = subprocess.run(
            ['wmic', 'process', 'where', "name='python.exe'", 'get', 'ProcessId,CommandLine', '/format:csv'],
            capture_output=True, text=True,
            encoding='utf-8', errors='replace',  # 中文 Windows 下 wmic 输出非 UTF-8，默认解码会崩导致清理失效
            timeout=10
        ).stdout
        for line in out.splitlines():
            line = line.strip()
            if 'server.py' not in line:
                continue
            pid_str = line.rsplit(',', 1)[-1].strip()
            if not pid_str.isdigit() or int(pid_str) == me:
                continue
            # 再次确认命令行确实是本项目脚本(含 server.py 结尾)
            if line.rstrip(pid_str).rstrip().endswith('server.py'):
                try:
                    subprocess.run(['taskkill', '/F', '/PID', pid_str],
                                   capture_output=True, timeout=10)
                    killed.append(int(pid_str))
                    print(f'[Server] 已清理旧实例 PID {pid_str}')
                except Exception:
                    pass
    except Exception as e:
        print(f'[Server] 清理旧实例失败(不影响启动): {e}')
    return killed


def _disable_console_quickedit():
    """禁用控制台 QuickEdit（快速编辑）模式。

    Windows 控制台默认开启 QuickEdit：用户在窗口里点一下鼠标即进入文本选中状态，
    此时所有向 stdout 的写入（print）会永久阻塞——engine 工具循环线程全部卡死，
    表现为"所有对话发不出去"但 health/db 等不打印的接口仍正常，极难排查。
    清除 ENABLE_QUICKEDIT_MODE 后不再因误点冻结（需要复制日志时用标题栏菜单的标记模式）。"""
    try:
        import sys as _s
        if _s.platform != 'win32':
            return  # 非 Windows 控制台无 QuickEdit 问题
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
        mode = ctypes.c_uint32()
        if k32.GetConsoleMode(h, ctypes.byref(mode)):
            k32.SetConsoleMode(h, mode.value & ~0x0040)
            print('[Server] 已禁用控制台 QuickEdit（防止误点窗口冻结所有对话）')
    except Exception:
        pass  # 非 Windows / stdout 被重定向到文件时无需处理


def _hold_window(reason):
    """保持窗口可见:打印提示并等待用户确认后退出(防止窗口一闪而过看不到错误)。"""
    print()
    print('=' * 60)
    print(f'[Server] {reason}')
    print('[Server] 此窗口会保持打开,便于查看信息。按回车键关闭本窗口...')
    print('=' * 60)
    try:
        input()
    except Exception:
        pass
    except KeyboardInterrupt:
        # Ctrl+C 关闭本窗口是正常操作：安静地以 0 退出，
        # 否则非零退出码会让启动器打印吓人的 [ERROR] 块（复用路径里什么都没坏）
        pass
    sys.exit(0)


def main():
    _disable_console_quickedit()
    init_db()

    # 删除缓冲垃圾箱：启动即清理超过保留期(默认30天)的条目，之后每6小时一次
    try:
        from trash import auto_cleanup as _trash_cleanup
        import threading as _threading

        def _trash_cleanup_loop():
            while True:
                try:
                    r = _trash_cleanup()
                    if r.get('purged') or r.get('errors'):
                        print('[Trash] cleanup purged=%s errors=%s'
                              % (r.get('purged'), r.get('errors')))
                except Exception as e:
                    print('[Trash] cleanup error: %s' % e)
                time.sleep(6 * 3600)

        _threading.Thread(target=_trash_cleanup_loop, name='trash-cleanup',
                          daemon=True).start()
        _trash_cleanup()
    except Exception as _trash_e:
        print('[Trash] init failed: %s' % _trash_e)

    # 长期记忆库：独立 git 仓库定时快照（定期强制 git 保存，隐私数据不进主仓库）
    try:
        from memory_autosave import start_autosave_thread
        start_autosave_thread(BASE_DIR)
    except Exception as _memgit_e:
        print('[MemoryGit] init failed: %s' % _memgit_e)

    # 主脑（Main Brain）：常驻观察线程（零侵入采集 + 事件驱动总结）
    try:
        from brain.main_brain import start_brain_thread
        start_brain_thread(BASE_DIR)
        print('[Server] 主脑观察线程已启动（20s/轮）')
    except Exception as _brain_e:
        print('[Server] 主脑启动失败:', _brain_e)

    # ---- 端口冲突智能处理 ----
    # 注意：_write_pid_file 必须在确认要真正绑定端口之后才执行——
    # 若"复用已有健康实例"的分支提前写入 pid，pid 文件会指向一个马上退出的进程，
    # 启动器/重启脚本按 pid 查杀时就会杀错对象（或杀空）。
    if _port_in_use():
        if _service_alive():
            # 已有健康实例在跑:直接复用,不重复启动(由启动器负责打开浏览器)
            print(f'[Server] port {PORT} already has a healthy service, reusing existing instance, this startup exits (0)')
            # 【改进】显示 15 秒后自动关闭，不再死等回车——避免复用窗口在桌面堆积
            print('[Server] 本窗口将在 15 秒后自动关闭...')
            try:
                time.sleep(15)
            except BaseException:
                pass
            sys.exit(0)
        else:
            # 端口被占但服务不健康:先尝试自动清理旧实例,再重试
            print(f'[Server] 端口 {PORT} 被占用但服务无响应,尝试自动清理旧实例...')
            killed = _kill_stale_instances()
            time.sleep(2)
            if killed and not _port_in_use():
                print('[Server] 旧实例已清理,继续启动。')
            elif _port_in_use() and not _service_alive():
                time.sleep(3)
                if _port_in_use() and not _service_alive():
                    print(f'[Server] 错误: 端口 {PORT} 仍被非本服务进程占用')
                    sys.stderr.write(f'端口 {PORT} 被占用且占用者无 HTTP 响应.请关闭占用进程后重试.\n')
                    _hold_window(f'错误: 端口 {PORT} 被占用且占用者无响应,无法启动服务。')

    _write_pid_file()
    server = QuietHTTPServer((HOST, PORT), DBHandler)
    # 前端 8 个 SSE 长连接 + Agent 循环并发工具调用，默认 backlog=5 会导致
    # 新连接被内核直接拒绝（浏览器报 net::ERR_EMPTY_RESPONSE），扩容到 64
    server.request_queue_size = 64
    
    # 启动热更新引擎
    server_dir = os.path.dirname(os.path.abspath(__file__))
    from hot_reload import init_hot_reloader
    init_hot_reloader(server, DBHandler, server_dir, PUBLIC_DIR)

    # 启动远程控制信令 WebSocket 服务（8516，remote/ 包）
    try:
        from remote.ws_server import start_remote_ws
        start_remote_ws()
    except Exception as e:
        if not QUIET_CONSOLE:
            print(f'[Server] 远程信令服务启动失败(不影响主服务): {e}')

    # 启动 Ctrl+~ 快速呼出轮盘（仅 Windows，失败静默降级）
    try:
        if not QUIET_CONSOLE:
            print('[Server] 正在启动 Ctrl+~ 快速呼出轮盘...')
        from 快速呼出 import 快速呼出管理
        _快速呼出 = 快速呼出管理(web端口=PORT)
        if not _快速呼出.启动():
            _快速呼出 = None
    except Exception as e:
        _快速呼出 = None
        if not QUIET_CONSOLE:
            print(f'[Server] 快速呼出轮盘启动失败(不影响主服务): {e}')

    # 启动 Ctrl+Shift+~ 桌面对话浮窗（和网页版对话 100% 一样，失败静默降级）
    try:
        from 桌面对话 import 桌面对话浮窗
        _桌面对话 = 桌面对话浮窗(web端口=PORT)
        if not _桌面对话.启动():
            _桌面对话 = None
    except Exception as e:
        _桌面对话 = None
        if not QUIET_CONSOLE:
            print(f'[Server] 桌面对话浮窗启动失败(不影响主服务): {e}')

    # 启动朱峰社区心跳上报线程
    # 默认开启（用于统计）；如需关闭在 private/port.json 中加 "heartbeat": false。
    try:
        _hb_cfg = {}
        _hb_path = os.path.join(BASE_DIR, 'private', 'port.json')
        if os.path.exists(_hb_path):
            with open(_hb_path, 'r', encoding='utf-8-sig') as _f:
                _hb_cfg = json.load(_f)
        if isinstance(_hb_cfg, dict) and _hb_cfg.get('heartbeat') is not False:
            from zf3d_heartbeat import start_heartbeat
            start_heartbeat()
        elif not QUIET_CONSOLE:
            print('[Server] 心跳上报已关闭（如需重新开启，删除 port.json 中的 "heartbeat": false）')
    except Exception as e:
        if not QUIET_CONSOLE:
            print(f'[Server] 心跳线程启动失败: {e}')

    # 启动朱峰社区远程命令消费线程（手机端 agent_remote.asp 聊天闭环）
    # 仅在已登录会员时才会实际消费命令；如需关闭在 private/port.json 中加 "remote_commands": false。
    try:
        if not (isinstance(_hb_cfg, dict) and _hb_cfg.get('remote_commands') is False):
            from zf3d_commands import start_command_consumer
            start_command_consumer()
        elif not QUIET_CONSOLE:
            print('[Server] 远程命令消费已关闭（port.json: "remote_commands": false）')
    except Exception as e:
        if not QUIET_CONSOLE:
            print(f'[Server] 远程命令消费线程启动失败: {e}')

    # 启动自动升级检查线程（启动后 30s 首检，按 private/updater.json 间隔循环；
    # auto_apply=true 时发现新版自动升级并重启，false 则只提示）
    try:
        from updater import start_auto_checker
        start_auto_checker()
    except Exception as e:
        if not QUIET_CONSOLE:
            print(f'[Server] 自动升级线程启动失败: {e}')

    print('')
    print('  ██████████  ██████████  ██████████  ████████        ██      ████████    ██████████  ██      ██  ██████████')
    print('        ██    ██                  ██  ██      ██    ██  ██    ██          ██          ████    ██      ██')
    print('      ██      ██████████  ██████████  ██      ██  ██████████  ██    ██    ██████████  ██  ██  ██      ██')
    print('    ██        ██                  ██  ██      ██  ██      ██  ██    ██    ██          ██    ████      ██')
    print('  ██████████  ██          ██████████  ████████    ██      ██  ████████    ██████████  ██      ██      ██')
    print(f'                                              ZF3D Agent  v{VERSION}')
    print('')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[Server] 正在停止...')
        # 停止快速呼出轮盘
        try:
            if _快速呼出:
                _快速呼出.停止()
        except Exception:
            pass
        # stop hot reloader
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if hr:
            hr.stop()
        # 关闭前对记忆库做最后一次 git 快照（有变更才提交）
        try:
            from memory_autosave import run_autosave
            _r = run_autosave(BASE_DIR, reason='服务关闭前')
            if _r.get('committed'):
                print('[MemoryGit] %s' % _r.get('msg', ''))
        except Exception:
            pass
        server.shutdown()
        print('[Server] stopped')
    finally:
        # 异常退出时同样保持窗口,让用户能看清错误
        _hold_window(f'服务已停止 (PID {os.getpid()})。')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        # 崩溃取证：traceback 同时落盘到 server/crash.log（控制台窗口可能被随手关掉，
        # 用户贴报错时也常漏掉上方的 traceback，落盘后任何崩溃原因都可追溯）
        try:
            _crash_log = os.path.join(BASE_DIR, 'server', 'crash.log')
            with open(_crash_log, 'a', encoding='utf-8') as _f:
                _f.write('\n==== %s (PID %s) ====\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), os.getpid()))
                traceback.print_exc(file=_f)
        except Exception:
            pass
        _hold_window('发生未捕获异常,服务启动失败!')
