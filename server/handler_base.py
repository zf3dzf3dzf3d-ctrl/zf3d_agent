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

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        # 优先使用 _drain_body() 已缓存的一次性读取结果（body 只能从 socket 读一次）
        if length == 0:
            # 仍有缓存时（Content-Length 缺失但已读过）不做处理，直接返回空
            return {}
        if getattr(self, '_body_consumed', False):
            raw = getattr(self, '_cached_raw_body', None)
            if raw is not None:
                if not raw:
                    return {}
                return json.loads(raw.decode('utf-8'))
        raw = self.rfile.read(length)
        return json.loads(raw.decode('utf-8'))

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
