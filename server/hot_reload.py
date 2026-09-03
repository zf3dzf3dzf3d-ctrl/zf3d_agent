#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
热更新引擎 (Hot Reload Engine)

功能：
1. 监控 server/ 目录下 .py 文件变更 → importlib.reload + 重建 DBHandler 类
2. 监控 public/ 目录下 .js/.css 文件变更 → 通过 SSE 通知前端动态替换
3. 提供 SSE 端点，前端实时接收更新通知
4. 提供手动重载 API
5. 保留 scheduler 等模块的全局状态（定时任务不丢失）

设计要点：
- 纯 Python 标准库实现，无第三方依赖
- 文件变更去抖 (debounce 800ms)，避免编辑器多次保存触发多次重载
- 模块重载失败时自动回退，不影响现有服务
- SSE 连接线程安全，支持多客户端
"""

import os
import sys
import time
import json
import threading
import importlib
import traceback
from collections import deque

import config as _config


def _dbg(msg):
    """过程日志: 静默模式下不输出 (config.QUIET_CONSOLE 控制启动画面整洁)"""
    if not getattr(_config, 'QUIET_CONSOLE', False):
        print(msg)

# ===== 全局单例 =====
_hot_reloader = None


def init_hot_reloader(server, handler_class, server_dir, public_dir):
    """初始化热更新引擎（在 server.py 中调用）"""
    global _hot_reloader
    _hot_reloader = HotReloader(server, handler_class, server_dir, public_dir)
    _hot_reloader.start()
    return _hot_reloader


def get_hot_reloader():
    """获取热更新引擎实例"""
    return _hot_reloader


class HotReloader:
    """热更新引擎"""

    # 需要监控的 Python 模块映射: 文件名 -> 模块名
    PY_MODULES = {
        'config.py': 'config',
        'db.py': 'db',
        'model_config.py': 'model_config',
        'handler_base.py': 'handler_base',
        'handler_routes.py': 'handler_routes',
        # routes/ 包（路由拆分后的各 mixin，改任一都要重载 handler_routes 级联）
        'routes/_shared.py': 'routes._shared',
        'routes/api_dispatch_get.py': 'routes.api_dispatch_get',
        'routes/api_dispatch_post.py': 'routes.api_dispatch_post',
        'routes/api_dispatch_post_extra.py': 'routes.api_dispatch_post_extra',
        'routes/mixin_proxy_stream.py': 'routes.mixin_proxy_stream',
        'routes/api_dispatch_delete.py': 'routes.api_dispatch_delete',
        'routes/mixin_base.py': 'routes.mixin_base',
        'routes/mixin_core.py': 'routes.mixin_core',
        'routes/mixin_proxy.py': 'routes.mixin_proxy',
        'routes/mixin_static.py': 'routes.mixin_static',
        'routes/mixin_pixel.py': 'routes.mixin_pixel',
        'routes/mixin_project.py': 'routes.mixin_project',
        'routes/mixin_settings.py': 'routes.mixin_settings',
        'routes/mixin_db.py': 'routes.mixin_db',
        'routes/mixin_hotreload.py': 'routes.mixin_hotreload',
        'routes/mixin_models.py': 'routes.mixin_models',
        'routes/mixin_backup.py': 'routes.mixin_backup',
        'routes/mixin_media.py': 'routes.mixin_media',
        'routes/mixin_ext.py': 'routes.mixin_ext',
        'routes/mixin_zf3d.py': 'routes.mixin_zf3d',
        'routes/mixin_dispatch_pool.py': 'routes.mixin_dispatch_pool',
        'routes/mixin_tasknotes.py': 'routes.mixin_tasknotes',
        # tools 包及其子模块（修改任一工具处理器时热重载）
        # tools/ 在项目根目录，路径相对于 server_dir 的上一级
    }

    # routes/ 下文件相对 server 目录（不是项目根），路径解析时特殊处理
    ROUTES_PREFIX = 'routes/'

    def __init__(self, server, handler_class, server_dir, public_dir):
        self.server = server
        self.handler_class = handler_class
        self.server_dir = server_dir
        self.public_dir = public_dir

        # 文件修改时间记录
        self._py_mtimes = {}
        self._static_mtimes = {}

        # SSE 客户端列表 (wfile 对象)
        self._sse_clients = []
        self._sse_lock = threading.Lock()

        # 重载历史
        self._history = deque(maxlen=50)
        self._history_lock = threading.Lock()

        # 去抖：记录待处理变更
        self._pending_py = {}    # {filename: mtime}
        self._pending_static = {}  # {filepath: mtime}
        self._debounce_lock = threading.Lock()
        self._debounce_timer = None
        self.DEBOUNCE_MS = 0.8  # 800ms 去抖窗口

        # 状态
        self._running = False
        self._thread = None

        # 初始化文件时间扫描
        self._scan_all_files()

    # ===== 文件扫描 =====

    def _scan_all_files(self):
        """扫描所有监控文件的当前修改时间"""
        # Python 文件（PY_MODULES 中显式列出的）
        for fn in self.PY_MODULES:
            fp = os.path.join(self.server_dir, fn)
            if os.path.isfile(fp):
                self._py_mtimes[fn] = os.path.getmtime(fp)

        # tools/ 目录在项目根（server_dir 的上一级），自动发现 backend/ 下所有 .py 文件
        tool_dir = os.path.join(os.path.dirname(self.server_dir), 'tools')
        for sub_dir in ('coding', 'writing', 'minimal'):
            backend_dir = os.path.join(tool_dir, sub_dir, 'backend')
            if not os.path.isdir(backend_dir):
                continue
            for f in sorted(os.listdir(backend_dir)):
                if f.endswith('.py') and not f.startswith('_'):
                    fn = 'tools/' + sub_dir + '/backend/' + f
                    fp = os.path.join(backend_dir, f)
                    if os.path.isfile(fp):
                        self._py_mtimes[fn] = os.path.getmtime(fp)
                        mod_name = 'tools.' + sub_dir + '.backend.' + f[:-3]
                        if fn not in self.PY_MODULES:
                            self.PY_MODULES[fn] = mod_name

        # 静态文件 (JS/CSS)
        self._scan_static_dir()

    def _scan_static_dir(self):
        """扫描 public 目录下的 JS/CSS 文件"""
        for root, dirs, files in os.walk(self.public_dir):
            # 跳过隐藏目录
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.endswith(('.js', '.css')) and '.bak' not in f:
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, self.public_dir).replace('\\', '/')
                    self._static_mtimes[rel] = os.path.getmtime(fp)

    # ===== 启动 / 停止 =====

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._watch_loop, daemon=True)
        self._thread.start()
        _dbg('[HotReload] 🔥 热更新引擎已启动')
        _dbg(f'[HotReload]   监控 Python 模块: {", ".join(self.PY_MODULES.keys())}')
        _dbg(f'[HotReload]   监控静态目录: {self.public_dir}')

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=3)

    # ===== 监控循环 =====

    def _watch_loop(self):
        """主监控循环，每 500ms 检查一次文件变更"""
        while self._running:
            time.sleep(0.5)
            try:
                self._check_py_changes()
                self._check_static_changes()
            except Exception as e:
                print(f'[HotReload] 监控异常: {e}')
                traceback.print_exc()

    def _check_py_changes(self):
        """检查 Python 文件变更"""
        # 先扫描 tools/ 下各分类的 backend/ 确保新文件被注册
        tool_dir = os.path.join(os.path.dirname(self.server_dir), 'tools')
        for sub_dir in ('coding', 'writing', 'minimal'):
            backend_dir = os.path.join(tool_dir, sub_dir, 'backend')
            if not os.path.isdir(backend_dir):
                continue
            for f in sorted(os.listdir(backend_dir)):
                if f.endswith('.py') and not f.startswith('_'):
                    fn = 'tools/' + sub_dir + '/backend/' + f
                    if fn not in self.PY_MODULES:
                        mod_name = 'tools.' + sub_dir + '.backend.' + f[:-3]
                        self.PY_MODULES[fn] = mod_name
                        fp = os.path.join(backend_dir, f)
                        if os.path.isfile(fp):
                            self._py_mtimes[fn] = os.path.getmtime(fp)

        for fn in self.PY_MODULES:
            # tools/ 下的文件相对项目根目录，routes/ 与其余文件相对 server 目录
            if fn.startswith('tools/'):
                fp = os.path.join(os.path.dirname(self.server_dir), fn)
            else:
                fp = os.path.join(self.server_dir, fn)
            if not os.path.isfile(fp):
                continue
            try:
                mtime = os.path.getmtime(fp)
            except OSError:
                continue
            old = self._py_mtimes.get(fn)
            if old is not None and mtime > old:
                with self._debounce_lock:
                    self._pending_py[fn] = mtime
                self._py_mtimes[fn] = mtime
                _dbg(f'[HotReload] 📝 检测到 Python 文件变更: {fn}')
                self._schedule_debounce()

    def _check_static_changes(self):
        """检查静态文件变更"""
        changed = False
        for root, dirs, files in os.walk(self.public_dir):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            for f in files:
                if f.endswith(('.js', '.css')) and '.bak' not in f:
                    fp = os.path.join(root, f)
                    rel = os.path.relpath(fp, self.public_dir).replace('\\', '/')
                    try:
                        mtime = os.path.getmtime(fp)
                    except OSError:
                        continue
                    old = self._static_mtimes.get(rel)
                    if old is not None and mtime > old:
                        with self._debounce_lock:
                            self._pending_static[rel] = mtime
                        self._static_mtimes[rel] = mtime
                        _dbg(f'[HotReload] 📝 检测到静态文件变更: {rel}')
                        changed = True
                    elif old is None:
                        # 新文件
                        self._static_mtimes[rel] = mtime

        if changed:
            self._schedule_debounce()

    # ===== 去抖处理 =====

    def _schedule_debounce(self):
        """调度去抖处理（在 DEBOUNCE_MS 秒后执行所有待处理变更）"""
        with self._debounce_lock:
            if self._debounce_timer is not None:
                self._debounce_timer.cancel()
            self._debounce_timer = threading.Timer(self.DEBOUNCE_MS, self._process_pending)
            self._debounce_timer.daemon = True
            self._debounce_timer.start()

    def _process_pending(self):
        """处理所有待处理的文件变更"""
        with self._debounce_lock:
            py_changes = dict(self._pending_py)
            static_changes = dict(self._pending_static)
            self._pending_py.clear()
            self._pending_static.clear()
            self._debounce_timer = None

        if py_changes:
            self._reload_python(list(py_changes.keys()))

        if static_changes:
            self._notify_static_change(list(static_changes.keys()))

    # ===== Python 模块重载 =====

    def _reload_python(self, changed_files):
        """重载变更的 Python 模块并重建 DBHandler 类"""
        _dbg(f'[HotReload] 开始重载模块: {", ".join(changed_files)}')
        results = []
        all_ok = True

        # ===== 1. 保存需要保留的全局状态 =====
        saved_state = self._save_module_state()

        # ===== 2. 按依赖顺序重载模块 =====
        # 顺序: config → db → scheduler → handler_base → handler_tools → handler_routes
        # 注意: 下游模块依赖上游，实际重载顺序按 reload_order 依次执行
        # routes/ 包内的文件：先重载 _shared，再按文件本身重载；最后必须级联重载 handler_routes
        reload_order = ['config', 'db', 'handler_base', 'handler_routes',
                        'routes._shared', 'routes.mixin_base', 'routes.mixin_core',
                        'routes.mixin_proxy_stream', 'routes.mixin_proxy', 'routes.mixin_static', 'routes.mixin_pixel',
                        'routes.mixin_project', 'routes.mixin_settings', 'routes.mixin_db',
                        'routes.mixin_hotreload', 'routes.mixin_models', 'routes.mixin_backup',
                        'routes.mixin_media', 'routes.mixin_ext',
                        'routes.mixin_zf3d', 'routes.mixin_dispatch_pool',
                        'routes.mixin_tasknotes',
                        'routes.api_dispatch_get', 'routes.api_dispatch_post',
                        'routes.api_dispatch_post_extra', 'routes.api_dispatch_delete']
        to_reload = []
        for mod_name in reload_order:
            for fn in changed_files:
                if self.PY_MODULES.get(fn) == mod_name:
                    to_reload.append((fn, mod_name))
                    break

        # tools/ 包下的工具处理器（模块名以 tools. 开头），不在 reload_order 里，单独追加
        for fn in changed_files:
            mod_name = self.PY_MODULES.get(fn)
            if mod_name and mod_name.startswith('tools.'):
                to_reload.append((fn, mod_name))

        # routes/ 包内的文件变更：并强制级联重载 handler_routes（组合类必须基于最新的 mixin 重建）
        routes_changed = any(fn.startswith(self.ROUTES_PREFIX) for fn in changed_files)
        if routes_changed:
            for f, m in self.PY_MODULES.items():
                if m == 'handler_routes':
                    to_reload.append((f, m))
                    _dbg('[HotReload]   🔗 级联重载 handler_routes (routes/ 已变更)')
                    break

        # 级联重载: 上游模块变更时下游必须重载
        CASCADE = {
            'config': ['db', 'handler_base', 'handler_routes'],
            'db': ['handler_base', 'handler_routes'],
            'handler_base': ['handler_routes'],
            'handler_routes': [],
        }
        reloaded_names = {m for _, m in to_reload}
        for mod_name in reload_order:
            if mod_name in reloaded_names:
                continue
            fn = None
            for f, m in self.PY_MODULES.items():
                if m == mod_name:
                    fn = f
                    break
            if fn is None:
                continue
            for changed_mod, deps in CASCADE.items():
                if changed_mod in reloaded_names and mod_name in deps:
                    to_reload.append((fn, mod_name))
                    reloaded_names.add(mod_name)
                    _dbg(f'[HotReload]   🔗 级联重载 {mod_name} (依赖 {changed_mod} 已变更)')
                    break

        for fn, mod_name in to_reload:
            try:
                mod = sys.modules.get(mod_name)
                if mod is None:
                    mod = importlib.import_module(mod_name)
                importlib.reload(mod)
                results.append({'file': fn, 'module': mod_name, 'ok': True})
                _dbg(f'[HotReload]   ✅ 重载成功: {mod_name} ({fn})')
            except Exception as e:
                all_ok = False
                err = str(e)
                tb = traceback.format_exc()[-500:]
                results.append({'file': fn, 'module': mod_name, 'ok': False, 'error': err, 'traceback': tb})
                print(f'[HotReload]   ❌ 重载失败: {mod_name} ({fn}): {err}')
                print(tb)

        # ===== 3. 恢复全局状态 =====
        if all_ok:
            self._restore_module_state(saved_state)

        # ===== 4. 重建 DBHandler 类 =====
        if all_ok:
            try:
                # 获取重载后的最新类引用
                hb_mod = sys.modules.get('handler_base')
                hr_mod = sys.modules.get('handler_routes')
                if hb_mod and hr_mod:
                    # 创建新的组合类
                    new_class = type('DBHandler', (hr_mod.HandlerRoutes, hb_mod.HandlerBase), {})
                    # 🔒 安全校验：新类必须具备核心方法，防止半写文件导致残缺类上线
                    _required = ('_load_loop_mode_system', '_handle_proxy', '_read_body', '_send_json')
                    _missing = [m for m in _required if not callable(getattr(new_class, m, None))]
                    if _missing:
                        raise RuntimeError('新类缺少核心方法: %s，疑似文件半写，放弃替换' % _missing)
                    # 更新服务器的处理器类
                    if self.server is not None:
                        self.server.RequestHandlerClass = new_class
                    self.handler_class = new_class
                    _dbg('[HotReload]   ✅ DBHandler 类已更新，新请求将使用最新代码')
            except Exception as e:
                all_ok = False
                print(f'[HotReload]   ❌ 重建 DBHandler 失败（保留旧类，服务不受影响）: {e}')
                traceback.print_exc()

        # ===== 5. 记录历史并广播 =====
        entry = {
            'time': time.time(),
            'time_str': time.strftime('%H:%M:%S'),
            'type': 'python',
            'files': [r['file'] for r in results],
            'results': results,
            'success': all_ok
        }
        with self._history_lock:
            self._history.append(entry)

        # 广播到前端
        self._broadcast({
            'type': 'python_reload',
            'success': all_ok,
            'files': results,
            'timestamp': entry['time']
        })

        if all_ok:
            self._broadcast({
                'type': 'backend_reloaded',
                'message': '后端模块已热更新',
                'files': [r['file'] for r in results],
                'timestamp': time.time()
            })

        return all_ok

    def _save_module_state(self):
        """保存需要跨重载保留的模块全局状态"""
        state = {}
        try:
            import scheduler as sched
            state['scheduler'] = {
                '_scheduled_tasks': sched._scheduled_tasks,
                '_sched_lock': sched._sched_lock,
            }
        except Exception:
            pass

        try:
            import config as cfg
            state['config'] = {
                '_db_lock': getattr(cfg, '_db_lock', None),
            }
        except Exception:
            pass

        return state

    def _restore_module_state(self, state):
        """恢复模块全局状态"""
        if 'scheduler' in state:
            try:
                import scheduler as sched
                saved = state['scheduler']
                # 恢复定时任务注册表和锁
                sched._scheduled_tasks = saved['_scheduled_tasks']
                sched._sched_lock = saved['_sched_lock']
                _dbg('[HotReload]   ✅ scheduler 状态已保留 (定时任务不丢失)')
            except Exception as e:
                print(f'[HotReload]   ⚠️ 恢复 scheduler 状态失败: {e}')

        if 'config' in state:
            try:
                import config as cfg
                saved = state['config']
                if saved.get('_db_lock'):
                    cfg._db_lock = saved['_db_lock']
            except Exception:
                pass

    # ===== 静态文件变更通知 =====

    def _notify_static_change(self, changed_files):
        """通知前端静态文件已变更"""
        for f in changed_files:
            _dbg(f'[HotReload]   📄 静态文件变更通知: {f}')

        entry = {
            'time': time.time(),
            'time_str': time.strftime('%H:%M:%S'),
            'type': 'static',
            'files': changed_files,
            'success': True
        }
        with self._history_lock:
            self._history.append(entry)

        # 广播到前端
        self._broadcast({
            'type': 'static_reload',
            'files': changed_files,
            'timestamp': entry['time']
        })

    # ===== SSE 客户端管理 =====

    def add_sse_client(self, wfile):
        """注册 SSE 客户端"""
        with self._sse_lock:
            self._sse_clients.append(wfile)
        # 发送连接确认
        self._send_sse(wfile, {
            'type': 'connected',
            'message': '热更新已连接',
            'watching': list(self.PY_MODULES.keys())
        })
        count = len(self._sse_clients)
        _dbg(f'[HotReload] 📡 SSE 客户端已连接 (当前 {count} 个)')

    def remove_sse_client(self, wfile):
        """注销 SSE 客户端"""
        with self._sse_lock:
            if wfile in self._sse_clients:
                self._sse_clients.remove(wfile)
        count = len(self._sse_clients)
        _dbg(f'[HotReload] 📡 SSE 客户端已断开 (剩余 {count} 个)')

    def _send_sse(self, wfile, data):
        """向单个 SSE 客户端发送消息"""
        try:
            msg = f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
            wfile.write(msg.encode('utf-8', errors='surrogatepass'))
            wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError):
            return False

    def _broadcast(self, data):
        """向所有 SSE 客户端广播消息"""
        with self._sse_lock:
            dead = []
            for wfile in self._sse_clients:
                if not self._send_sse(wfile, data):
                    dead.append(wfile)
            for d in dead:
                if d in self._sse_clients:
                    self._sse_clients.remove(d)

    # ===== 状态查询 =====

    def get_status(self):
        """获取热更新引擎状态"""
        with self._history_lock:
            history = list(self._history)

        # 获取当前定时任务信息
        sched_tasks = []
        try:
            import scheduler as sched
            with sched._sched_lock:
                for name, task in sched._scheduled_tasks.items():
                    sched_tasks.append(task.info())
        except Exception:
            pass

        return {
            'running': self._running,
            'base_dir': os.path.abspath(os.path.dirname(self.server_dir)),
            'server_dir': os.path.abspath(self.server_dir),
            'public_dir': os.path.abspath(self.public_dir),
            'watching_py': list(self.PY_MODULES.keys()),
            'watching_static_count': len(self._static_mtimes),
            'sse_clients': len(self._sse_clients),
            'scheduled_tasks': sched_tasks,
            'history': history[-20:],
            'last_reload': history[-1] if history else None
        }

    def manual_reload(self, module_name=None):
        """手动触发模块重载"""
        if module_name:
            # 重载指定模块
            fn = None
            for f, m in self.PY_MODULES.items():
                if m == module_name:
                    fn = f
                    break
            if not fn:
                return {'ok': False, 'error': f'未知模块: {module_name}'}
            success = self._reload_python([fn])
            return {'ok': success, 'module': module_name}
        else:
            # 重载所有模块
            success = self._reload_python(list(self.PY_MODULES.keys()))
            return {'ok': success, 'modules': list(self.PY_MODULES.values())}
