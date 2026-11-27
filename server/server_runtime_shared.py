# -*- coding: utf-8 -*-
"""server_runtime_shared — server.py 与 server_runtime.py 共享的类与工具。"""
import os
import sys
import time
import traceback
from http.server import ThreadingHTTPServer

from util_log import get_logger

log = get_logger('server_runtime_shared')
_HERE_SH = os.path.dirname(os.path.abspath(__file__))
if _HERE_SH not in sys.path:
    sys.path.insert(0, _HERE_SH)
_PROJECT_ROOT_SH = os.path.dirname(_HERE_SH)
if _PROJECT_ROOT_SH not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT_SH)

from config import BASE_DIR
from handler_base import HandlerBase
from handler_routes import HandlerRoutes


class DBHandler(HandlerRoutes, HandlerBase):
    """主处理器:组合所有 Mixin（完整定义见 server_runtime_shared）。"""
    pass


def _bf_dbg(tag, e):
    try:
        import sys
        print("[bf] " + str(tag) + " " + type(e).__name__ + ": " + str(e), file=sys.stderr, flush=True)
    except Exception:
        pass


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
        # 运行期崩溃取证：请求处理异常同样落盘 server/crash.log（与 __main__ 兜底一致），
        # 控制台窗口可能被关掉，落盘后崩溃原因始终可追溯
        try:
            with open(os.path.join(BASE_DIR, 'server', 'crash.log'), 'a', encoding='utf-8') as _f:
                _f.write('\n==== %s request-error from %s ====\n'
                         % (time.strftime('%Y-%m-%d %H:%M:%S'), client_address))
                traceback.print_exc(file=_f)
        except Exception:
            pass

# 主处理器:组合所有 Mixin（DBHandler 类定义见上方 shared 区）
