#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
工具处理器基类。
每个工具文件导出 handle(body, ctx) 函数，
ctx 封装了 _send_json / _send_error / _read_body 等公共方法。
"""

import os
import json
import re
import subprocess
import time
import traceback

from config import BASE_DIR, _db_lock


class ToolContext:
    """工具上下文：封装 HTTP handler 的公共方法，供各工具调用。"""

    def __init__(self, handler, body=None):
        self._handler = handler
        self.base_dir = BASE_DIR
        # 项目路径感知：优先取请求 body._project_path（对话关联项目的真实路径，
        # 由前端 db.js 附带），让目录型工具默认落在用户指定的项目工作区（如 D 盘）；
        # 非法/不存在路径回退软件自身根目录 BASE_DIR
        self.project_dir = BASE_DIR
        p = (body or {}).get('_project_path')
        if isinstance(p, str) and p.strip():
            try:
                pp = os.path.abspath(os.path.expanduser(p.strip()))
                if os.path.isdir(pp):
                    self.project_dir = pp
            except OSError:
                pass

    def send_json(self, data, code=200):
        self._handler._send_json(data, code)

    def send_error(self, msg, code=200):
        # 工具级错误（参数缺失/清单不存在等）一律返回 HTTP 200 + {ok:false}，
        # 让 Agent 循环读到 error 文本后自行修正参数，同时避免浏览器控制台
        # 刷 "POST /api/tools/* 400 (Bad Request)" 噪音。需要真正 HTTP 错误时
        # 可显式传 code。
        self._handler._send_json({'ok': False, 'error': msg, 'traceback': None}, code)

    @property
    def db_lock(self):
        return _db_lock

    def get_db(self):
        from db import get_db
        return get_db()

    def safe_project_path(self, rel_path):
        return self._handler._safe_project_path(rel_path, self.project_dir)
