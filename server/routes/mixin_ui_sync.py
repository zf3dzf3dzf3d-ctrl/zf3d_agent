# -*- coding: utf-8 -*-
"""Mixin: 双端界面实时同步（/api/ui-sync/sse）"""
import time
import socket
import select
import traceback
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinUiSync(MixinBase):
    def _handle_ui_sync_sse(self):
        """GET /api/ui-sync/sse - 双端界面实时同步事件流。"""
        import ui_sync
        try:
            cid = (self.path.split('cid=')[1].split('&')[0] if 'cid=' in self.path else '')[:64]
        except Exception:
            cid = ''

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()
        # 【关键】给该 SSE 连接设写超时：手机切后台等导致对端停读时，
        # 写阻塞最多 15 秒即抛超时判死，绝不无限占用线程/拖垮广播。
        try:
            self.connection.settimeout(15.0)
        except Exception:
            pass

        if not ui_sync.add_client(self.wfile, cid):
            # 超上限：发一条提示后结束，前端会退化轮询
            try:
                self.wfile.write(b'data: {"type":"rejected","message":"client limit"}\n\n')
                self.wfile.flush()
            except Exception:
                pass
            return

        try:
            from config import SSE_HEARTBEAT_SEC
            _hb = max(2.0, min(float(SSE_HEARTBEAT_SEC), 25.0))
        except Exception:
            _hb = 10.0

        _sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError)
        try:
            while True:
                try:
                    _r, _, _ = select.select([self.connection], [], [], _hb)
                except _sock_errs:
                    break
                except Exception:
                    time.sleep(_hb)
                    _r = []
                if _r:
                    # SSE 单向推送，入站数据 = 异常连接，断开（浏览器自动重连）
                    try:
                        _data = self.connection.recv(1, socket.MSG_PEEK)
                        if not _data:
                            break
                    except _sock_errs:
                        break
                    except Exception:
                        pass
                    break
                if not _r:
                    try:
                        self.wfile.write(b': heartbeat\n\n')
                        self.wfile.flush()
                    except _sock_errs:
                        break
                    except Exception:
                        continue
        except _sock_errs:
            pass
        except Exception as e:
            print(f'[UI-Sync] SSE 循环异常: {e}', flush=True)
            traceback.print_exc()
        finally:
            try:
                ui_sync.remove_client(self.wfile)
            except Exception:
                pass
            try:
                self.connection.shutdown(socket.SHUT_WR)
            except Exception:
                pass
            try:
                self.connection.settimeout(0.5)
                while self.connection.recv(1024):
                    pass
            except Exception:
                pass
