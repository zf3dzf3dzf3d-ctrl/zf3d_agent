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
from util_log import get_logger

log = get_logger('hot_reload')


def _dbg(msg):
    """过程日志: 静默模式下不输出 (config.QUIET_CONSOLE 控制启动画面整洁)"""
    if not getattr(_config, 'QUIET_CONSOLE', False):
        log.info(msg)

# ===== 全局单例 =====
_hot_reloader = None


# ===== 开关：热重载是开发期工具，默认关闭（2026-11-24）=====
# 为什么默认关闭：
#   1) 自我修改即时生效——server/ 下任何 .py 落盘约 1 秒后就被运行中的服务加载。安装后的正式环境
#      没有人改代码，这个能力只剩风险：一次误写或恶意写入立刻改变在线服务的行为。
#   2) 假生效——日志报“重载成功”不等于代码真的生效。实测 routes/mixin_static.py 被重载 3 次、
#      全部 ok，线上响应头却没变（处理器类由多个 mixin 运行时拼装，只重载其中一个模块时，
#      方法解析仍指向旧类对象），重启后才生效。对安全修复而言这是危险的错觉。
#      find_stale_mixins 负责把这种情况如实报出来。
#   3) 空闲时持续轮询约 700 个文件的修改时间。
# 开启方式（二选一，任一为真即开；ZF_HOT_RELOAD=0 显式关闭优先级最高）：
#   - 环境变量 ZF_HOT_RELOAD=1
#   - private/port.json 里 "hot_reload": true（机器本地配置，不随分发）
def hot_reload_enabled():
    """热重载是否开启。默认关闭。"""
    v = os.environ.get('ZF_HOT_RELOAD', '').strip().lower()
    if v in ('0', 'false', 'no', 'off'):
        return False
    if v in ('1', 'true', 'yes', 'on'):
        return True
    pj = getattr(_config, 'PORT_JSON_PATH', None)
    if not pj:
        return False
    try:
        with open(pj, 'r', encoding='utf-8-sig') as f:
            return bool(json.load(f).get('hot_reload'))
    except (OSError, ValueError):
        return False


def _excluded_modules():
    """不参与热重载的执法模块。清单真源在 server/util_enforcement.py。"""
    try:
        from util_enforcement import hot_reload_excluded_modules
        return hot_reload_excluded_modules()
    except ImportError:
        return frozenset()


def find_stale_mixins(new_class, module_names, modules=None):
    """重载生效性自检（纯函数）。

    处理器类由多个 mixin 运行时拼装。重载某个 mixin 模块后，若拼装链上还有模块没被重载，
    它们继承的仍是“旧类对象”——新处理器类的方法解析走不到刚重载的新代码，而日志照样报成功。

    返回 [(模块名, 类名)]：这些模块已重载，但 new_class 的 MRO 里的同名类不是重载后的那个对象。
    modules 仅供测试注入 {模块名: 模块对象}，默认取 sys.modules。"""
    mods = sys.modules if modules is None else modules
    stale = []
    mro = getattr(new_class, '__mro__', ())
    for name in module_names or ():
        mod = mods.get(name)
        if mod is None:
            continue
        for obj in vars(mod).values():
            if not isinstance(obj, type) or getattr(obj, '__module__', None) != name:
                continue
            for cls in mro:
                if cls is obj:
                    break
                if getattr(cls, '__module__', None) == name and cls.__name__ == obj.__name__:
                    stale.append((name, obj.__name__))
                    break
    return stale


def init_hot_reloader(server, handler_class, server_dir, public_dir):
    """初始化热更新引擎（在 server.py 中调用）。默认关闭，开启方式见 hot_reload_enabled。"""
    global _hot_reloader
    if not hot_reload_enabled():
        log.info('[HotReload] 热更新引擎未启动（默认关闭）。开发机开启：private/port.json 设 '
                 '"hot_reload": true，或设环境变量 ZF_HOT_RELOAD=1')
        _hot_reloader = None
        return None
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
        'dispatch_swarm.py': 'dispatch_swarm',
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
 'routes/mixin_project_fs.py': 'routes.mixin_project_fs',
        'routes/mixin_settings.py': 'routes.mixin_settings',
        'routes/mixin_db.py': 'routes.mixin_db',
        'routes/mixin_hotreload.py': 'routes.mixin_hotreload',
        'routes/mixin_models.py': 'routes.mixin_models',
        'routes/mixin_backup.py': 'routes.mixin_backup',
        'routes/mixin_media.py': 'routes.mixin_media',
        'routes/mixin_ext.py': 'routes.mixin_ext',
        'routes/mixin_video.py': 'routes.mixin_video',
        'routes/mixin_zf3d.py': 'routes.mixin_zf3d',
        # 【2026-11-22 补】zf3d relay/login domain 路由此前漏配监视，改完必须重启才生效 → 加入级联重载
        'routes/zf3d_relay.py': 'routes.zf3d_relay',
        'routes/zf3d_login.py': 'routes.zf3d_login',
        # 【2026-11-10 补】i音乐 domain 路由此前漏配监视，改完必须重启才生效 → 加入级联重载
        'routes/domain_music.py': 'routes.domain_music',
        # 【2026-11-19 补】i小镇 domain 路由此前漏配监视，改完必须重启才生效 → 加入级联重载
        'routes/domain_town.py': 'routes.domain_town',
        # 【2026-11-21 补】i棋 domain 路由（漏配会导致改完不生效）
        'routes/domain_chess.py': 'routes.domain_chess',
        # 【2026-10-28 补】工作台 mixin 此前漏配监视，改完必须重启才生效 → 加入级联重载
        'routes/mixin_workbench.py': 'routes.mixin_workbench',
        'zf3d_commands.py': 'zf3d_commands',
        'zf3d_heartbeat.py': 'zf3d_heartbeat',
        'git_branch_api.py': 'git_branch_api',
        'routes/mixin_browser.py': 'routes.mixin_browser',
        'routes/mixin_demo.py': 'routes.mixin_demo',
        'routes/mixin_gate.py': 'routes.mixin_gate',
        # 【2026-10-22 补】jobs 后台流水线 mixin 此前漏配监视，改完必须重启才生效 → 加入级联重载
        'routes/mixin_jobs.py': 'routes.mixin_jobs',
        # 【2026-11-17 补】i小说 mixin 此前漏配监视，改完必须重启才生效 → 加入级联重载
        'routes/mixin_novel.py': 'routes.mixin_novel',
        'chat_gate.py': 'chat_gate',
        'butler_store.py': 'butler_store',
        'routes/mixin_docs.py': 'routes.mixin_docs',
        'routes/mixin_briefing.py': 'routes.mixin_briefing',
        # 【2026-11-11 补】iApp 统一调度路由（AI 操作各 App）
        'routes/mixin_iapp.py': 'routes.mixin_iapp',
        # 循环内核化（阶段B/C）：Loop-S 内核循环与路由
        'loop_s.py': 'loop_s',
        'routes/mixin_loop_s.py': 'routes.mixin_loop_s',
        'browser_plugin/engine.py': 'browser_plugin.engine',
        # 【20261123】exec 拆分还原：engine_seg2 已拼回 engine.py 单文件，监视 engine.py 即可
        # extensions 扩展子系统（dsh 桥等），在项目根 extensions/ 目录
        '../extensions/__init__.py': 'extensions',
        '../extensions/dsh/__init__.py': 'extensions.dsh',
        '../extensions/ui_registry.py': 'extensions.ui_registry',
        '../extensions/market.py': 'extensions.market',
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

        # 执法模块不参与热重载：改盘不会被运行中的服务自动加载，须重启（清单见 server/util_enforcement.py）
        self._excluded = _excluded_modules()
        self._last_stale = []

        # 初始化文件时间扫描
        self._scan_all_files()
        if self._excluded:
            _dbg('[HotReload] 执法模块不参与热重载（修改须重启服务）: %d 个' % len(self._excluded))

    # ===== 文件扫描 =====

    def _scan_all_files(self):
        """扫描所有监控文件的当前修改时间"""
        # Python 文件（PY_MODULES 中显式列出的）
        for fn in self.PY_MODULES:
            if self.PY_MODULES[fn] in self._excluded:
                continue
            fp = os.path.join(self.server_dir, fn)
            if os.path.isfile(fp):
                self._py_mtimes[fn] = os.path.getmtime(fp)

        # tools/ 目录在项目根（server_dir 的上一级），自动发现 backend/ 下所有 .py 文件
        tool_dir = os.path.join(os.path.dirname(self.server_dir), 'tools')
        for sub_dir in ('coding', 'writing', 'minimal', 'vision', 'dcc'):
            backend_dir = os.path.join(tool_dir, sub_dir, 'backend')
            if not os.path.isdir(backend_dir):
                continue
            for f in sorted(os.listdir(backend_dir)):
                if f.endswith('.py') and not f.startswith('_'):
                    mod_name = 'tools.' + sub_dir + '.backend.' + f[:-3]
                    if mod_name in self._excluded:
                        continue
                    fn = 'tools/' + sub_dir + '/backend/' + f
                    fp = os.path.join(backend_dir, f)
                    if os.path.isfile(fp):
                        self._py_mtimes[fn] = os.path.getmtime(fp)
                        if fn not in self.PY_MODULES:
                            self.PY_MODULES[fn] = mod_name

        # 【S1 自动发现·双轨】routes/ 包内全部 .py（白名单前缀 _shared/api_*/mixin_*/domain_*）
        # 与旧 PY_MODULES 硬编码表并存（双轨观察期），自动发现的条目动态并入 self.PY_MODULES
        self._auto_discover_modules()

        # 静态文件 (JS/CSS)
        self._scan_static_dir()

    # routes/ 自动发现白名单：只纳入路由模块命名约定，防误纳 __init__/私有实验文件
    ROUTES_AUTO_PREFIXES = ('mixin_', 'api_', 'domain_', '_shared')

    def _auto_discover_modules(self):
        """S1：扫描 routes/（相对 server_dir）与 extensions/（相对项目根）自动注册监视清单。
        只做增量并入（已有键不覆盖），新增条目同时登记 mtime；返回本轮新注册清单（供 dry-run 对照）。"""
        discovered = {}
        routes_dir = os.path.join(self.server_dir, 'routes')
        if os.path.isdir(routes_dir):
            for f in sorted(os.listdir(routes_dir)):
                if f.endswith('.py') and f[:-3].startswith(self.ROUTES_AUTO_PREFIXES):
                    fn = self.ROUTES_PREFIX + f
                    discovered[fn] = 'routes.' + f[:-3]
        # extensions/ 在项目根（server_dir 上一级），仅顶包与白名单文件
        ext_dir = os.path.join(os.path.dirname(self.server_dir), 'extensions')
        if os.path.isdir(ext_dir):
            discovered['../extensions/__init__.py'] = 'extensions'
            for f in sorted(os.listdir(ext_dir)):
                if f.endswith('.py') and f[:-3] in ('ui_registry', 'market', 'settings', 'mcp', 'skills', 'config_store', 'declarative_ui'):
                    discovered['../extensions/' + f] = 'extensions.' + f[:-3]
        added = []
        for fn, mod in discovered.items():
            if mod in self._excluded:
                continue
            if fn not in self.PY_MODULES:
                self.PY_MODULES[fn] = mod
                added.append((fn, mod))
            fp = os.path.join(self.server_dir, fn) if not fn.startswith(('tools/', '../')) \
                else os.path.join(os.path.dirname(self.server_dir), fn[3:] if fn.startswith('../') else fn)
            if os.path.isfile(fp):
                self._py_mtimes[fn] = os.path.getmtime(fp)
        if added:
            _dbg('[HotReload] [S1自动发现] 新增监视: ' + ', '.join(f'{m}({f})' for f, m in added))
        return added

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

    # 目录重扫描节流：listdir/walk 属于重 IO，降频执行（每次间隔约60秒）
    RESCAN_EVERY = 30  # 每 30 个监控周期重扫一次目录结构

    def _watch_loop(self):
        """主监控循环，每 2s 检查一次已知文件 mtime；目录结构每 60s 重扫一次
        【优化】原 500ms 全量 os.walk + listdir 导致空闲时磁盘持续高 IO（用户反馈硬盘狂转）"""
        scan_count = 0
        while self._running:
            time.sleep(2.0)
            try:
                scan_count += 1
                rescan = (scan_count % self.RESCAN_EVERY == 1)
                self._check_py_changes(rescan=rescan)
                self._check_static_changes(rescan=rescan)
            except Exception as e:
                log.error(f'[HotReload] 监控异常: {e}')
                traceback.print_exc()

    def _check_py_changes(self, rescan=False):
        """检查 Python 文件变更（rescan=True 时才重新扫描 tools/ 目录结构）"""
        # 扫描 tools/ 下各分类的 backend/ 确保新文件被注册（降频：约每60秒一次）
        if rescan:
            tool_dir = os.path.join(os.path.dirname(self.server_dir), 'tools')
            for sub_dir in ('coding', 'writing', 'minimal', 'vision', 'dcc'):
                backend_dir = os.path.join(tool_dir, sub_dir, 'backend')
                if not os.path.isdir(backend_dir):
                    continue
                for f in sorted(os.listdir(backend_dir)):
                    if f.endswith('.py') and not f.startswith('_'):
                        mod_name = 'tools.' + sub_dir + '.backend.' + f[:-3]
                        if mod_name in self._excluded:
                            continue
                        fn = 'tools/' + sub_dir + '/backend/' + f
                        if fn not in self.PY_MODULES:
                            self.PY_MODULES[fn] = mod_name
                            fp = os.path.join(backend_dir, f)
                            if os.path.isfile(fp):
                                self._py_mtimes[fn] = os.path.getmtime(fp)

        for fn in self.PY_MODULES:
            if self.PY_MODULES[fn] in self._excluded:
                continue
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

    def _check_static_changes(self, rescan=False):
        """检查静态文件变更（rescan=True 时才 os.walk 全目录，否则只检查已缓存文件）"""
        changed = False
        if rescan:
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
        else:
            # 轻量路径：只 stat 已缓存的文件（不遍历目录）
            for rel, old in list(self._static_mtimes.items()):
                fp = os.path.join(self.public_dir, rel.replace('/', os.sep))
                try:
                    mtime = os.path.getmtime(fp)
                except OSError:
                    continue
                if mtime > old:
                    with self._debounce_lock:
                        self._pending_static[rel] = mtime
                    self._static_mtimes[rel] = mtime
                    _dbg(f'[HotReload] 📝 检测到静态文件变更: {rel}')
                    changed = True

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
        """重载变更的 Python 模块并重建 DBHandler 类（编排器：6 阶段方法）"""
        _dbg(f'[HotReload] 开始重载模块: {", ".join(changed_files)}')
        _reload_ret = self._reload_exec_modules(self._collect_reload_set(changed_files))
        if not isinstance(_reload_ret, tuple) or len(_reload_ret) != 2:
            # 【2026-11-13 防御】上游缺 return 时兜底，防 NoneType 解包崩溃（同洞二次复发防线）
            log.error('[HotReload] ⚠️ _reload_exec_modules 返回异常，兜底为空结果继续')
            results, all_ok = [], False
        else:
            results, all_ok = _reload_ret
        saved_state = self._save_module_state()
        _critical_ok = self._restore_or_skip(saved_state, results, all_ok)
        if _critical_ok:
            all_ok = self._rebuild_handler([r['module'] for r in results if r.get('ok')]) and all_ok
        self._restart_zf3d_consumer(results)
        self._record_and_broadcast(results, all_ok)
        return all_ok

    # ===== S2 拆分：主单收集 / 包附加收集 / 级联收集 三私有方法，主函数只编排 =====
    # 重载顺序主单（下游依赖上游，按此序依次 reload）
    RELOAD_ORDER = ['config', 'db', 'handler_base', 'handler_routes',
                    'routes._shared', 'routes.mixin_base', 'routes.mixin_core',
                    'routes.mixin_proxy_stream', 'routes.mixin_proxy', 'routes.mixin_static', 'routes.mixin_pixel',
                    'routes.mixin_project', 'routes.mixin_settings', 'routes.mixin_db',
                    'routes.mixin_hotreload', 'routes.mixin_models', 'routes.mixin_backup',
                    'routes.mixin_media', 'routes.mixin_ext',
                    'routes.mixin_iapp',
                    'routes.mixin_video',
                    'routes.domain_music',
                    'routes.mixin_zf3d',
                    'zf3d_heartbeat', 'zf3d_commands',
                    'routes.mixin_browser',
                    # 循环内核化（D3）：loop_s 与其路由必须参与重载，否则改动永不生效
                    'loop_s', 'routes.mixin_loop_s',
                    'dispatch_swarm',
                    'routes.api_dispatch_get', 'routes.api_dispatch_post',
                    'routes.api_dispatch_post_extra', 'routes.api_dispatch_delete']
    # 级联表：上游变更时下游必须重载
    CASCADE = {
        'config': ['db', 'handler_base', 'handler_routes'],
        'db': ['handler_base', 'handler_routes'],
        'handler_base': ['handler_routes'],
        'handler_routes': [],
    }

    def _collect_reload_set(self, changed_files):
        """阶段2：按依赖顺序+级联规则收集待重载模块集（S2 编排器，只组装不实现）"""
        to_reload = self._collect_ordered_changed(changed_files)
        to_reload.extend(self._collect_package_extras(changed_files, to_reload))
        self._collect_cascade(changed_files, to_reload)
        # 【S3 契约】返回必须为 list，防"同洞三犯"（历史上 L448/L470 两次缺 return 事故）
        if not isinstance(to_reload, list):
            log.error('[HotReload] ⚠️ _collect_reload_set 返回异常，兜底为空列表（S3 契约防线）')
            to_reload = []
        return to_reload

    def _collect_ordered_changed(self, changed_files):
        """S2-①：按 RELOAD_ORDER 主单收集直接命中的变更模块"""
        to_reload = []
        for mod_name in self.RELOAD_ORDER:
            for fn in changed_files:
                if self.PY_MODULES.get(fn) == mod_name:
                    to_reload.append((fn, mod_name))
                    break
        return to_reload

    def _collect_package_extras(self, changed_files, to_reload):
        """S2-②：主单之外的包级附加（tools./browser_plugin./extensions/ 级联与 routes→handler_routes 强制级联）"""
        extras = []
        # tools/ 包下的工具处理器（模块名以 tools. 开头），不在 RELOAD_ORDER 里，单独追加
        for fn in changed_files:
            mod_name = self.PY_MODULES.get(fn)
            if mod_name and mod_name.startswith('tools.'):
                extras.append((fn, mod_name))

        # browser_plugin/ 包下的模块（如 engine_seg2.py），同样单独追加
        for fn in changed_files:
            mod_name = self.PY_MODULES.get(fn)
            if mod_name and mod_name.startswith('browser_plugin.'):
                extras.append((fn, mod_name))

        # extensions/ 扩展子系统（dsh 桥等）：extensions.dsh 变更时级联重载 extensions 包
        _in_set = {m for _, m in to_reload} | {m for _, m in extras}
        for fn in changed_files:
            mod_name = self.PY_MODULES.get(fn)
            if mod_name and mod_name.startswith('extensions'):
                if mod_name != 'extensions' and 'extensions' not in _in_set:
                    extras.append(('../extensions/__init__.py', 'extensions'))
                    _in_set.add('extensions')
                extras.append((fn, mod_name))

        # 【20261123】exec 拆分还原：engine_seg 分段已拼回 engine.py 单文件并归档，
        # 原分段级联重载块随之删除 —— engine.py 本身在 PY_MODULES 监视表（第118行）内，直接生效

        # routes/ 包内的文件变更：并强制级联重载 handler_routes（组合类必须基于最新的 mixin 重建）
        routes_changed = any(fn.startswith(self.ROUTES_PREFIX) for fn in changed_files)
        if routes_changed and 'handler_routes' not in _in_set:
            for f, m in self.PY_MODULES.items():
                if m == 'handler_routes':
                    extras.append((f, m))
                    _dbg('[HotReload]   🔗 级联重载 handler_routes (routes/ 已变更)')
                    break
        return extras

    def _collect_cascade(self, changed_files, to_reload):
        """S2-③：通用级联（CASCADE 表：上游变更→下游补重载），原地追加进 to_reload"""
        reloaded_names = {m for _, m in to_reload}
        for mod_name in self.RELOAD_ORDER:
            if mod_name in reloaded_names:
                continue
            fn = None
            for f, m in self.PY_MODULES.items():
                if m == mod_name:
                    fn = f
                    break
            if fn is None:
                continue
            for changed_mod, deps in self.CASCADE.items():
                if changed_mod in reloaded_names and mod_name in deps:
                    to_reload.append((fn, mod_name))
                    reloaded_names.add(mod_name)
                    _dbg(f'[HotReload]   🔗 级联重载 {mod_name} (依赖 {changed_mod} 已变更)')
                    break

    def _reload_exec_modules(self, to_reload):
        """阶段2.5：执行 importlib.reload，返回 (results, all_ok)"""
        results = []
        all_ok = True

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
                log.error(f'[HotReload]   ❌ 重载失败: {mod_name} ({fn}): {err}')
                log.info(tb)
        # 【S3 契约】出口断言：必须返回 (list, bool)，防缺 return 同洞三犯（L448/L470 历史两犯）
        _ret = (results, all_ok)
        if not (isinstance(_ret, tuple) and len(_ret) == 2 and isinstance(_ret[0], list) and isinstance(_ret[1], bool)):
            log.warning('[HotReload] ⚠️ _reload_exec_modules 契约违反，兜底空结果（S3 防线）')
            return [], False
        return _ret  # 【2026-11-13 修】补缺失的 return，此前 L342 解包必报 NoneType（同洞二次复发，姊妹函数 L442 同类 bug 11-11 已修）

    def _restore_or_skip(self, saved_state, results, all_ok):
        """阶段3：恢复全局状态/判定关键链路是否全部成功，返回 _critical_ok"""
        # ===== 3. 恢复全局状态 =====
        # 关键模块：handler 组合类依赖的 routes/handler/loop 链路。只有关键模块全部
        # 重载成功才允许重建 DBHandler；无关模块（tools/browser_plugin 等拆分段模块，
        # 无法独立 reload）失败不应阻塞 handler 更新。 D3-HTTP复验修复
        _critical_ok = all(
            r['ok'] for r in results
            if r.get('module') in ('handler_base', 'handler_routes', 'loop_s',
                                   'routes.mixin_loop_s', 'hot_reload', 'db',
                                   'config', 'model_config', 'dispatch_swarm')
        )
        if all_ok:
            self._restore_module_state(saved_state)
        elif _critical_ok:
            _dbg('[HotReload]   ⚠️ 存在非关键模块重载失败，跳过全局状态恢复，仍重建 handler')

    def _rebuild_handler(self, reloaded_modules=None):
        """阶段4：重建 DBHandler 组合类，失败返回 False（保留旧类）。调用前提：_critical_ok 为真（编排器保证）

        reloaded_modules：本轮已重载成功的模块名，用于生效性自检（结果写入 self._last_stale）。"""
        # ===== 4. 重建 DBHandler 类 =====
        self._last_stale = []
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
                # 生效性自检：刚重载的模块若仍以“旧类对象”留在方法解析链里，这次重载就没有真正生效
                self._last_stale = find_stale_mixins(new_class, reloaded_modules or [])
                if self._last_stale:
                    log.warning('[HotReload] ⚠️ 以下模块已重载，但处理器类仍引用它们的旧类对象——'
                                '本次改动未生效，须重启服务: %s'
                                % ', '.join('%s.%s' % s for s in self._last_stale))
                else:
                    _dbg('[HotReload]   ✅ DBHandler 类已更新，新请求将使用最新代码')
        except Exception as e:
            log.error(f'[HotReload]   ❌ 重建 DBHandler 失败（保留旧类，服务不受影响）: {e}')
            traceback.print_exc()
            return False

        return True

    def _restart_zf3d_consumer(self, results):
        """阶段5.5：zf3d_commands 热更新成功后重启远程命令消费线程"""
        # ===== 5.5 重启远程命令消费线程（zf3d_commands 热更新后接管）=====
        if any(r.get('module') == 'zf3d_commands' and r.get('ok') for r in results):
            try:
                # 【隐私整改 2026-11-05】尊重 port.json "remote_commands" 开关，热更新不绕过（默认关）。
                # start_command_consumer 内部也做了同一检查（双保险）。
                import json as _json
                _pc = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   os.pardir, 'private', 'port.json')
                _ok = False
                if os.path.exists(_pc):
                    with open(_pc, 'r', encoding='utf-8-sig') as _f:
                        _cfg = _json.load(_f)
                    _ok = isinstance(_cfg, dict) and _cfg.get('remote_commands') is True
                if _ok:
                    from zf3d_commands import start_command_consumer
                    start_command_consumer()
            except Exception as _e:
                log.error(f'[HotReload] 重启远程命令消费线程失败: {_e}')

    def _record_and_broadcast(self, results, all_ok):
        """阶段5：记录历史并广播到前端。

        三个字段各说各话，不互相顶替：
          success       模块本身重载成功
          stale         已重载却仍被处理器类以旧对象引用的 [(模块, 类)]
          effective     改动真正生效（success 且无 stale）；为 False 时 needs_restart 为真
        """
        stale = list(getattr(self, '_last_stale', []))
        effective = bool(all_ok and not stale)
        # ===== 5. 记录历史并广播 =====
        entry = {
            'time': time.time(),
            'time_str': time.strftime('%H:%M:%S'),
            'type': 'python',
            'files': [r['file'] for r in results],
            'results': results,
            'success': all_ok,
            'stale': stale,
            'effective': effective,
            'needs_restart': not effective
        }
        with self._history_lock:
            self._history.append(entry)

        # 广播到前端
        self._broadcast({
            'type': 'python_reload',
            'success': all_ok,
            'effective': effective,
            'needs_restart': not effective,
            'stale': stale,
            'files': results,
            'timestamp': entry['time']
        })

        if effective:
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
                log.error(f'[HotReload]   ⚠️ 恢复 scheduler 状态失败: {e}')

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
        """注册 SSE 客户端。【方案A】注册时给底层 socket 设写超时，防慢客户端 write 卡死拖慢广播。"""
        self._set_sock_timeout(wfile)
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

    @staticmethod
    def _set_sock_timeout(wfile):
        """【方案A·P1-1】尽力给底层 socket 设写超时（默认 3 秒，可用环境变量 SSE_WRITE_TIMEOUT 覆盖）。"""
        try:
            timeout = float(os.environ.get('SSE_WRITE_TIMEOUT', '3.0'))
        except Exception:
            timeout = 3.0
        sock = getattr(wfile, 'raw', None)
        sock = getattr(sock, '_sock', sock) if sock is not None else None
        if sock is None:
            sock = getattr(wfile, '_sock', None)
        if sock is not None and hasattr(sock, 'settimeout'):
            try:
                sock.settimeout(timeout)
            except Exception:
                pass

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
        """向所有 SSE 客户端广播消息。
        【关键】锁内只快照，发送放锁外：防止某个客户端 socket 写阻塞
        （如手机峰控切后台暂停读网络）持锁卡死整个广播/请求链路。"""
        with self._sse_lock:
            targets = list(self._sse_clients)
        dead = [wfile for wfile in targets if not self._send_sse(wfile, data)]
        if dead:
            with self._sse_lock:
                self._sse_clients[:] = [w for w in self._sse_clients if w not in dead]

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
            'excluded_py': sorted(self._excluded),
            'sse_clients': len(self._sse_clients),
            'scheduled_tasks': sched_tasks,
            'history': history[-20:],
            'last_reload': history[-1] if history else None
        }

    def manual_reload(self, module_name=None):
        """手动触发模块重载。执法模块不参与热重载（清单见 server/util_enforcement.py），修改须重启服务。"""
        if module_name:
            if module_name in self._excluded:
                return {'ok': False,
                        'error': f'{module_name} 是执法模块，不参与热重载，修改后须重启服务'}
            # 重载指定模块
            fn = None
            for f, m in self.PY_MODULES.items():
                if m == module_name:
                    fn = f
                    break
            if not fn:
                return {'ok': False, 'error': f'未知模块: {module_name}'}
            success = self._reload_python([fn])
            return {'ok': success, 'module': module_name,
                    'effective': success and not self._last_stale,
                    'needs_restart': bool(self._last_stale), 'stale': list(self._last_stale)}
        else:
            # 重载所有模块
            watchable = [f for f, m in self.PY_MODULES.items() if m not in self._excluded]
            success = self._reload_python(watchable)
            return {'ok': success, 'modules': [self.PY_MODULES[f] for f in watchable],
                    'excluded': sorted(self._excluded)}

