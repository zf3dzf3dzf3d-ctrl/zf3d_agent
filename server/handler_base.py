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

    def _read_json(self):
        """Safely read JSON body, return {} on failure."""
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length > 0 else b''
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
            self.send_header('Access-Control-Allow-Origin', '*')
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
        self._send_json({'ok': False, 'error': msg, 'traceback': tb_str[-500:] if tb_str != 'NoneType: None\n' else None}, code)

    def _read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            return {}
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
        所有工具统一走 tool 注册表动态分发。
        """
        tool = path.rsplit('/', 1)[-1]
        try:
            body = self._read_body()
        except Exception:
            self._send_json({'ok': False, 'error': 'Invalid JSON body'})
            return

        try:
            from tool import get_handler
            from tool.coding.backend.base import ToolContext
            handler_mod = get_handler(tool)
            if handler_mod:
                ctx = ToolContext(self, body)
                handler_mod.handle(body, ctx)
            else:
                self._send_json({'ok': False, 'error': 'Unknown tool: ' + tool})
        except Exception as e:
            self._send_json({'ok': False, 'error': 'Tool handler error: ' + str(e)})
