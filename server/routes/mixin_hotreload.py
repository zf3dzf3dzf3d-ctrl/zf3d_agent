# -*- coding: utf-8 -*-
"""Mixin: 热更新（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinHotreload(MixinBase):
    def _handle_hot_reload_sse(self):
        """GET /api/hot-reload/sse - stream hot reload events."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_error('hot reload engine not started', 503)
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        # 娉ㄥ唽涓?SSE 瀹㈡埛绔?
        hr.add_sse_client(self.wfile)

        # 蹇冭烦闂撮殧鍙厤锛堥粯璁?10s锛岄伩寮€甯歌鍙嶄唬鐨?30s 绌洪棽鍒囨柇 + 娴忚鍣ㄤ唬鐞?60s 鍒囨柇锛?
        try:
            from config import SSE_HEARTBEAT_SEC
            _hb = max(2.0, min(float(SSE_HEARTBEAT_SEC), 25.0))
        except Exception:
            _hb = 10.0

        import time as _time
        import socket as _sock
        import select as _sel
        _sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError)
        try:
            while True:
                # 鐢ㄧ煭杞 + select 鍚屾椂鎵挎媴銆屽績璺冲彂閫併€?銆屾娴嬪鎴风鏂紑銆?
                # 涓嶅啀鐢?_time.sleep(15) 閭ｇ銆屽啓澶辫触鎵嶇煡閬撴柇浜嗐€嶇殑琚姩绛栫暐
                try:
                    _r, _, _ = _sel.select([self.connection], [], [], _hb)
                except _sock_errs:
                    break
                except Exception:
                    # select 澶辫触鏃堕€€鍖栦负 sleep 鍏滃簳
                    _time.sleep(_hb)
                    _r = []

                # 娌℃湁鍙浜嬩欢 = 鍒颁簡蹇冭烦鏃堕棿
                if not _r:
                    try:
                        self.wfile.write(b': heartbeat\n\n')
                        self.wfile.flush()
                    except _sock_errs:
                        break
                    except Exception as e:
                        print(f'[SSE] 蹇冭烦鍐欏叆寮傚父: {e}', flush=True)
                        traceback.print_exc()
                        # 鍗曟澶辫触涓嶉€€鍑猴紝淇濇寔杩炴帴锛堥伩鍏?reload 鏃跺伓鍙戞姈鍔ㄨ鎵€鏈夌獥鍙ｇ绾匡級
                        continue
        except _sock_errs:
            pass
        except Exception as e:
            print(f'[SSE] 涓诲惊鐜紓甯? {e}', flush=True)
            traceback.print_exc()
        finally:
            try:
                hr.remove_sse_client(self.wfile)
            except Exception:
                pass
            # 优雅关闭：先关闭写方向并排空缓冲，避免 RST 导致浏览器报 ERR_CONNECTION_RESET
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


    def _handle_hot_reload_status(self):
        """Return hot-reload engine status."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_json({'ok': False, 'error': 'hot reload engine not started'})
            return
        self._send_json({'ok': True, 'status': hr.get_status()})


    def _handle_hot_reload_manual(self):
        """Manually reload a hot-reload module."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_json({'ok': False, 'error': 'hot reload engine not started'})
            return
        try:
            body = self._read_body()
            module_name = body.get('module', None)
            result = hr.manual_reload(module_name)
            self._send_json(result)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

    # ============================================================
    # 通用存根（工具系统已剥离，仅保留 200 占位以兼容旧前端）
    # ============================================================

