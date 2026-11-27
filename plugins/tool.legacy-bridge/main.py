# -*- coding: utf-8 -*-
"""tool.legacy-bridge — 旧轨桥接插件（绞杀者过渡，S1-8）。

设计：
- 旧轨 tools/minimal|coding/backend/<tool>.py 是单一真源，本插件【不复制实现】，
  仅用捕获型 FakeCtx 调用旧轨 handle(body, ctx)，把 send_json 输出转成返回值。
- 好处：旧轨任何逻辑修复自动生效；坏处：仍是旧代码在跑——这是有意的过渡态，
  后续批次逐工具搬真实现，搬完本插件退役。
- 安全边界沿用旧轨（含 security.is_blocked_system_path 等），白名单外的工具
  不会注册（见 _BRIDGE_TOOLS）。
"""
import os
import sys
import importlib
import threading

# 【安全补丁 20261108】保护 _load_backend 的 sys.modules 清理/重导入（防并发竞态）
_BACKEND_LOCK = threading.Lock()

# 项目根（plugins/<id>/main.py → plugins/<id> → plugins → 项目根）
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
_SERVER = os.path.join(_ROOT, 'server')

# 本插件桥接的工具 → 旧轨模块名（minimal 3 个走 coding backend 实测可用，统一 coding 优先，minimal 兜底）
_BRIDGE_TOOLS = {
    'read_file': 'read',
    'read_lines': 'read_lines',
    'tree_dir': 'tree_dir',
    'search_in_files': 'search_in_files',
    'find_files': 'find_files',
    'write_file': 'write',
    'replace_text': 'replace_text',
    'move_file': 'move_file',
    'task_list': 'task_list',
    'project_record': 'project_record',
    'run_code': 'run',
    'ask_user': 'ask_user',
    'switch_tool_category': 'switch_tool_category',
    'long_plan': 'long_plan',
    'plan_batch': 'plan_batch',
    'get_tool_result': 'get_tool_result',
    # S2 定时体系：schedule 有状态长线程模块，先桥接（单一真源），后续批次搬真实现
    'schedule': 'schedule',
}


class _FakeHandler:
    """捕获 _send_json 输出的假 handler（ToolContext 只用到这两个方法）。"""

    def __init__(self):
        self.payload = None

    def _send_json(self, data, code=200):
        self.payload = data

    def _safe_project_path(self, rel_path, project_dir):
        # 与路由层同语义：拼接并归一化，不做额外限制（旧轨本来就是这个行为）
        return os.path.normpath(os.path.join(project_dir, rel_path))


class _CaptureCtx:
    """捕获型上下文：替代 ToolContext，send_json 转为返回值。"""

    def __init__(self, body):
        from tools.coding.backend.base import BASE_DIR
        self.base_dir = BASE_DIR
        self.project_dir = BASE_DIR
        p = (body or {}).get('_project_path')
        if isinstance(p, str) and p.strip():
            try:
                pp = os.path.abspath(os.path.expanduser(p.strip()))
                # 【安全补丁 20261108】项目根白名单：越界目录回退默认项目根（同 file-tools 模式）
                if os.path.isdir(pp):
                    try:
                        if os.path.commonpath([pp, _ROOT]) != _ROOT:
                            pp = BASE_DIR
                    except (ValueError, OSError):
                        pp = BASE_DIR
                    self.project_dir = pp
            except OSError:
                pass
        self._handler = _FakeHandler()

    def send_json(self, data, code=200):
        self._handler.payload = data

    def send_error(self, msg, code=200):
        self._handler.payload = {'ok': False, 'error': msg, 'traceback': None}

    @property
    def db_lock(self):
        # 【20261123 修复FH#2】返回共享锁（tools/coding/backend/base.py ToolContext 同源
        # config._db_lock）；原实现每次 new RLock，工具内 with self.db_lock 互斥完全失效。
        import config
        return config._db_lock

    def get_db(self):
        from db import get_db
        return get_db()

    def safe_project_path(self, rel_path):
        return self._handler._safe_project_path(rel_path, self.project_dir)


# 【20261123 修复FH#1】模块句柄缓存：首次 import 后复用模块引用，不再清 sys.modules。
# 关键：tools.coding.backend.schedule 等是有状态模块（模块级 _tasks/_tasks_lock 与
# 运行线程绑定），原实现每次调用清空全部 tools.* 再重导入，会把运行中的定时任务
# 状态劈成两半且是并发竞态源头。代价：旧轨后端代码改动需重启进程生效。
_BACKEND_CACHE = {}


def _load_backend(tool_name):
    """按旧轨注册表逻辑加载后端模块（tools.<cat>.backend.<mod>），带句柄缓存。"""
    for cat in ('minimal', 'coding'):
        mod_name = f'tools.{cat}.backend.{_BRIDGE_TOOLS[tool_name]}'
        with _BACKEND_LOCK:
            mod = _BACKEND_CACHE.get(mod_name)
            if mod is not None:
                return mod
            try:
                mod = importlib.import_module(mod_name)
            except ModuleNotFoundError:
                continue
            _BACKEND_CACHE[mod_name] = mod
            return mod
    raise ModuleNotFoundError(f'legacy backend not found for {tool_name}')


def setup(ctx):
    if _SERVER not in sys.path:
        sys.path.insert(0, _SERVER)  # 旧轨后端内部会 import server 侧模块（security/db 等）
    if _ROOT not in sys.path:
        sys.path.insert(0, _ROOT)  # tools/ 包在项目根（tools.coding.backend.*）

    def _make_exec(tool_name):
        def _exec(args):
            mod = _load_backend(tool_name)
            cap = _CaptureCtx(args or {})
            mod.handle(args or {}, cap)
            payload = cap._handler.payload
            if payload is None:
                return {'ok': False, 'error': f'{tool_name}: backend produced no response'}
            return payload
        return _exec

    for tool_name in _BRIDGE_TOOLS:
        ctx.tool.register({
            'name': tool_name,
            'exec': _make_exec(tool_name),
            'src': 'plugin:legacy-bridge',
        })
