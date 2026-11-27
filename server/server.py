#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
朱峰智能体无限 - SQLite 数据服务（引导入口，瘦身后 ≤300 行）
纯 Python 标准库实现,无第三方依赖。

端口: 默认 8558(private/port.json 可覆盖)
数据: private/db/zf3d_canvas.db
API 前缀: /api/db/*

启动: python server.py
运行期逻辑（四阶段 boot/attach/postboot/serve、停机看门狗、AI 代理拉起等）
已拆至 server_runtime.py（2026-11-08 瘦身 DoD）；本文件只做内核引导。
"""

import os
import sys
import time
import traceback

# Path bootstrap: so that even in embedded Python (python311._pth isolated mode)
# sys.path contains the script directory
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# 附属线路实例（routes_manager 拉起）：--port/--ws 参数转环境变量，须在 import config 之前。
# 用参数而非仅靠 Popen env 传递，避免部分启动链路丢失环境变量导致端口覆盖失效。
if '--route' in sys.argv:
    _i = sys.argv.index('--route')
    os.environ.setdefault('ROUTE_INSTANCE', sys.argv[_i + 1] if _i + 1 < len(sys.argv) else 'route')
    _p = sys.argv.index('--port') if '--port' in sys.argv else -1
    _w = sys.argv.index('--ws') if '--ws' in sys.argv else -1
    if _p >= 0 and _p + 1 < len(sys.argv):
        os.environ['API_PORT'] = sys.argv[_p + 1]
    if _w >= 0 and _w + 1 < len(sys.argv):
        os.environ['WS_PORT'] = sys.argv[_w + 1]

# 项目根目录加入 sys.path（tools/ 包在项目根下）
_PROJECT_ROOT = os.path.dirname(_HERE)
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

# 引擎目录加入 sys.path（engines_loader 及各引擎子包）
_ENGINES_DIR = os.path.join(_HERE, 'engines')
if _ENGINES_DIR not in sys.path:
    sys.path.insert(0, _ENGINES_DIR)

from config import BASE_DIR
from server_runtime_shared import DBHandler  # noqa: F401 (兼容旧引用)
import server_runtime as _rt

# 对外兼容出口（tray_server 等外部调用方不变）
request_shutdown = _rt.request_shutdown
shutdown_event = _rt.shutdown_event
_HTTP_SERVER = None  # attach 阶段由 runtime 回填


def main():
    """内核引导（绞杀者 Step4 拆分：复用检查 → boot → attach → serve）"""
    _rt.main()


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
        _rt._hold_window('发生未捕获异常,服务启动失败!')
