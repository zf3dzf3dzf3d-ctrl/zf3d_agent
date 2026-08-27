#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰社区无限智能体 - SQLite 数据服务
纯 Python 标准库实现,无第三方依赖。

端口: 默认 8420(private/port.json 可覆盖)
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

# 项目根目录加入 sys.path（tool/ 包在项目根下）
_PROJECT_ROOT = os.path.dirname(_HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from config import HOST, PORT, DB_PATH, BASE_DIR, PUBLIC_DIR, VERSION, WS_PORT, QUIET_CONSOLE
from db import init_db
from handler_base import HandlerBase
from handler_routes import HandlerRoutes

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
                    with open(pid_file, 'r', encoding='utf-8') as f:
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
    sys.exit(0)


def main():
    init_db()
    _write_pid_file()

    # ---- 端口冲突智能处理 ----
    if _port_in_use():
        if _service_alive():
            # 已有健康实例在跑:直接复用,不重复启动(由启动器负责打开浏览器)
            print(f'[Server] port {PORT} already has a healthy service, reusing existing instance, this startup exits (0)')
            _hold_window(f'检测到端口 {PORT} 已有健康服务在运行,本次启动直接复用现有实例。')
        else:
            # 端口被占但服务不健康:等 5 秒重试一次,仍不行则报错退出
            print(f'[Server] 端口 {PORT} 被占用但服务无响应,等待 5 秒后重试...')
            time.sleep(5)
            if _port_in_use() and not _service_alive():
                print(f'[Server] 错误: 端口 {PORT} 仍被非本服务进程占用')
                sys.stderr.write(f'端口 {PORT} 被占用且占用者无 HTTP 响应.请关闭占用进程后重试.\n')
                _hold_window(f'错误: 端口 {PORT} 被占用且占用者无响应,无法启动服务。')

    server = ThreadingHTTPServer((HOST, PORT), DBHandler)
    # 前端 8 个 SSE 长连接 + Agent 循环并发工具调用，默认 backlog=5 会导致
    # 新连接被内核直接拒绝（浏览器报 net::ERR_EMPTY_RESPONSE），扩容到 64
    server.request_queue_size = 64
    
    # 启动热更新引擎
    server_dir = os.path.dirname(os.path.abspath(__file__))
    from hot_reload import init_hot_reloader
    init_hot_reloader(server, DBHandler, server_dir, PUBLIC_DIR)

    # 启动朱峰社区心跳上报线程
    try:
        from zf3d_heartbeat import start_heartbeat
        start_heartbeat()
    except Exception as e:
        if not QUIET_CONSOLE:
            print(f'[Server] 心跳线程启动失败: {e}')

    print('')
    print('  +--------------------------------------------------------------------------------------------------------------+')
    print('  |                                                                                                              |')
    print('  |  ██████████  ██████████  ██████████  ████████        ██      ████████    ██████████  ██      ██  ██████████  |')
    print('  |        ██    ██                  ██  ██      ██    ██  ██    ██          ██          ████    ██      ██      |')
    print('  |      ██      ██████████  ██████████  ██      ██  ██████████  ██    ██    ██████████  ██  ██  ██      ██      |')
    print('  |    ██        ██                  ██  ██      ██  ██      ██  ██    ██    ██          ██    ████      ██      |')
    print('  |  ██████████  ██          ██████████  ████████    ██      ██  ████████    ██████████  ██      ██      ██      |')
    print('  |                                                                                                              |')
    # 版本号从 private/version.json 读(由 config 加载),保证和前端启动器一致
    print(f'  |                                          ZF3D Agent  v{VERSION:<50}|')
    print('  |                                                                                                              |')
    print('  +--------------------------------------------------------------------------------------------------------------+')
    print('')
    print(f'  URL: http://{HOST}:{PORT}')
    print(f'  DB:  {DB_PATH}')
    print(f'  Hot reload: enabled')
    print(f'  Status: running')
    print('')
    print(f'  Press Ctrl+C to stop')
    print('')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[Server] 正在停止...')
        # stop hot reloader
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if hr:
            hr.stop()
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
        _hold_window('发生未捕获异常,服务启动失败!')
