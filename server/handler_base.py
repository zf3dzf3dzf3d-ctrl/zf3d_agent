#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTTP 请求处理基类
"""

import json
import os
import re
import subprocess
import traceback
from http.server import BaseHTTPRequestHandler

from config import PUBLIC_DIR, BASE_DIR

class HandlerBase(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""

    # HTTP/1.1 支持 keep-alive 和长连接（SSE 流式必须）
    protocol_version = "HTTP/1.1"

    # 【网络卡顿修复】禁用 Nagle 算法：默认 Nagle 会把 SSE 逐块小包攒批延迟
    # 40~200ms 才发出，与大模型流式输出叠加表现为「与大模型通信被卡住」。
    # 关闭后每个 flush 立即发包，流式输出实时到达前端。
    disable_nagle_algorithm = True

    # 缓冲调小：wfile 每次写尽快落到 socket，配合每写必 flush 保证低延迟
    wbufsize = 0  # 无缓冲直写（BaseHTTPRequestHandler 默认 0，显式声明防被子类覆盖）

    def log_message(self, format, *args):
        """简化日志"""
        pass

    def handle_error(self, request, client_address):
        """静默客户端中断连接等噪音，仅打印真正的异常"""
        import sys
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, TimeoutError)):
            return
        traceback.print_exc()

    # ===== 安全：跨站请求防护 =====
    # 服务只绑定 127.0.0.1，但恶意网页仍可通过浏览器发起跨站请求（CSRF）。
    # 浏览器对跨域 POST 必带 Origin 头，校验其必须是本机来源即可拦截。
    def _check_origin(self):
        origin = (self.headers.get('Origin') or '').strip()
        if not origin:
            return True  # 同源 fetch/工具调用通常无 Origin（非浏览器客户端）
        host = (self.headers.get('Host') or '').strip()
        if host and origin.rstrip('/') == f'http://{host}':
            return True
        if origin.startswith('http://127.0.0.1') or origin.startswith('http://localhost'):
            return True
        self._send_json({'ok': False, 'error': 'Forbidden: cross-origin request rejected'}, 403)
        return False

    def _drain_body(self):
        """读掉并丢弃当前请求的 body。
        keep-alive 连接上若有 handler 未读 body 就返回响应，残留字节会被
        当作下一个请求的请求行解析，报 501 "Unsupported method ('{}GET')"。
        在分发入口统一排干，根治所有漏读路径。"""
        try:
            if self.headers.get('Transfer-Encoding', '').lower().find('chunked') >= 0:
                self.close_connection = True  # 无法简单排干，直接断开
                return
            length = int(self.headers.get('Content-Length', 0) or 0)
            if length > 0:
                # body 只读一次并缓存：后续 _read_body() 直接取缓存，
                # 避免"先排干再读取"导致二次读为空、json.loads 报
                # "Expecting value: line 1 column 1"（消息发不出去的根因）。
                raw = self.rfile.read(length)
                self._cached_raw_body = raw
                self._body_consumed = True
        except Exception:
            self.close_connection = True

    def _cached_body(self, length):
        """读取请求体原始字节：优先用 _drain_body() 已缓存的结果。
        排干改造后 body 只能从 socket 读一次；二次 rfile.read 会因
        等不到数据而永久阻塞（连接黑洞、消息发不出去的根因）。"""
        if getattr(self, '_body_consumed', False):
            raw = getattr(self, '_cached_raw_body', None)
            if raw is not None:
                return raw
        return self.rfile.read(length) if length > 0 else b''

    def _read_json(self):
        """Safely read JSON body, return {} on failure."""
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b''
            if not raw:
                return {}
            data = json.loads(raw.decode('utf-8', 'ignore'))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    def _send_json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=True).encode('utf-8')
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            # 安全：不再允许任意网站跨域调用本 API（去掉 ACAO: *）。
            # 前端与服务同源，不需要 CORS 头；如需跨域调试，临时手动放开。
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # 客户端已断开，无法发送响应，静默忽略
            pass

    def _send_error(self, msg, code=400):
        tb_str = traceback.format_exc()
        # 安全：静默模式下不向客户端返回 Python traceback（泄露内部路径）；
        # 排查问题时把 config.QUIET_CONSOLE 改为 False 即可恢复。
        try:
            from config import QUIET_CONSOLE
        except Exception:
            QUIET_CONSOLE = True
        self._send_json({'ok': False, 'error': msg,
                         'traceback': None if QUIET_CONSOLE else (tb_str[-500:] if tb_str != 'NoneType: None\n' else None)}, code)

    @staticmethod
    def _sanitize_surrogates(obj):
        """递归清洗字符串中的孤立代理项（\ud800-\udfff）。
        JS 端把 emoji 拆成高位/低位代理项传过来时，sqlite3 写库会报
        UnicodeEncodeError: surrogates not allowed，这里统一替换为 U+FFFD。"""
        if isinstance(obj, str):
            if any('\ud800' <= c <= '\udfff' for c in obj):
                return obj.encode('utf-8', errors='replace').decode('utf-8', errors='replace')
            return obj
        if isinstance(obj, dict):
            return {k: HandlerBase._sanitize_surrogates(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [HandlerBase._sanitize_surrogates(v) for v in obj]
        return obj

    @staticmethod
    def _bodydiag_write(s):
        """400 诊断专用落盘（不依赖 stdout——10:44 起服务器 stdout 在 bat 控制台窗口，
        server_stdout.log 已失联）。仅在异常路径触发，正常请求零开销。"""
        try:
            with open(os.path.join(BASE_DIR, 'server', 'diag_body_400.log'), 'a', encoding='utf-8') as _f:
                _f.write(s + '\n')
        except Exception:
            pass

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        # 优先使用 _drain_body() 已缓存的一次性读取结果（body 只能从 socket 读一次）
        if length == 0:
            # 【BodyDiag 2026-09-10】代理/池类 POST 却无 Content-Length（或 chunked 被
            # _drain_body 跳过缓存）→ 上层路由 except 吞成空 body → 400 Missing _target_url
            # 的直接来源。只记代理类路径，避免噪音。
            try:
                _p = getattr(self, 'path', '') or ''
                if ('proxy' in _p or 'chat-pool' in _p):
                    import time as _t
                    self._bodydiag_write('[BodyDiag][%s] EMPTY-BODY %s CL=%s TE=%s consumed=%s' % (
                        _t.strftime('%H:%M:%S'), _p,
                        self.headers.get('Content-Length'),
                        self.headers.get('Transfer-Encoding'),
                        getattr(self, '_body_consumed', None)))
            except Exception:
                pass
            # 仍有缓存时（Content-Length 缺失但已读过）不做处理，直接返回空
            return {}
        try:
            if getattr(self, '_body_consumed', False):
                raw = getattr(self, '_cached_raw_body', None)
                if raw is not None:
                    if not raw:
                        return {}
                    return self._sanitize_surrogates(json.loads(raw.decode('utf-8')))
            raw = self.rfile.read(length)
            return self._sanitize_surrogates(json.loads(raw.decode('utf-8')))
        except Exception as _e:
            # 【BodyDiag 2026-09-10】body 读取/解析异常：记录字节特征后原样抛出，
            # 上层路由的 except 仍会吞成空 body（行为不变），但服务器侧留下定位证据。
            try:
                import time as _t
                import traceback as _tb
                _raw = getattr(self, '_cached_raw_body', None)
                _rlen = len(raw) if 'raw' in dir() else 'undef'
                self._bodydiag_write('[BodyDiag][%s] READ-EX %s CL=%s read_len=%s cached=%s consumed=%s EXC=%r\n%s' % (
                    _t.strftime('%H:%M:%S'), getattr(self, 'path', ''),
                    self.headers.get('Content-Length'),
                    _rlen,
                    (len(_raw) if _raw is not None else 'None'),
                    getattr(self, '_body_consumed', None), _e,
                    _tb.format_exc()[-300:]))
            except Exception:
                pass
            raise

    # ===== 基础工具：读取 / 写入 / 运行 =====
    # 路由: /api/tools/read | /api/tools/write | /api/tools/run
    # 安全策略：
    #   - 路径不限，可读写任意路径
    #   - 运行支持任意 shell 命令，不限超时
    #   - 写入覆盖前自动备份 .bak
    def _safe_project_path(self, rel_path, project_dir=None):
        """将相对路径安全解析到项目目录内，越权返回 None。
        project_dir 优先取传入值，否则回落 BASE_DIR。"""
        base = project_dir or BASE_DIR
        if not rel_path:
            return None
        # 去掉首尾斜杠，防止绝对路径穿越
        rel = rel_path.strip().lstrip('/\\')
        if not rel:
            return None
        # 解析并规范化，确保仍在 base 内
        full = os.path.abspath(os.path.join(base, rel))
        if os.path.commonpath([base, full]) != base:
            return None
        return full

    # ===== 工具路由：/api/tools/* =====
    def _handle_tools_post(self, path):
        """统一处理 /api/tools/* POST 请求。
        所有工具统一走 tools 注册表动态分发。
        """
        tools = path.rsplit('/', 1)[-1]
        try:
            body = self._read_body()
        except Exception:
            self._send_json({'ok': False, 'error': 'Invalid JSON body'})
            return

        try:
            from tools import get_handler
            from tools.coding.backend.base import ToolContext
            handler_mod = get_handler(tools)
            if handler_mod:
                ctx = ToolContext(self, body)
                handler_mod.handle(body, ctx)
            else:
                self._send_json({'ok': False, 'error': 'Unknown tools: ' + tools})
        except Exception as e:
            self._send_json({'ok': False, 'error': 'Tool handler error: ' + str(e)})
