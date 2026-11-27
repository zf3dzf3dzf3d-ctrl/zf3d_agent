# -*- coding: utf-8 -*-
"""内核 ctx：PluginContext 与各 _Ctx* 能力面板（插件可见 API 面）。"""
import hmac
import sqlite3
import threading

from kernel_core import get_admin_token, PluginStore  # noqa: F401  认证/存储单点复用




from util_log import get_logger

log = get_logger('kernel_ctx')
class PluginContext:
    """插件唯一入口：拿不到即没有。能力按 manifest.capabilities 授权裁剪。"""

    def verify_admin_token(self, handler):
        """【2026-11-08 kernel 级统一认证】特权插件的管理端点统一走这里校验
        X-Plugin-Token 头；token 文件由内核持有，插件不再各自实现认证。
        无 plugin.manage 能力的插件调用即抛 PermissionError（森林的门在内核）。"""
        self._cap("plugin.manage")
        tok = get_admin_token()
        given = str(handler.headers.get("X-Plugin-Token", "") or "").strip()
        # 常量时间比较，防 token 时序侧信道（S0.7 安全师建议#1）
        return bool(tok) and hmac.compare_digest(given.encode("utf-8"), tok.encode("utf-8"))

    def __init__(self, kernel, manifest):
        self._kernel = kernel
        self.manifest = manifest
        self.id = manifest["id"]
        self.caps = set(manifest.get("capabilities", []))
        self.log = _PluginLogger(self.id)
        self.event = _CtxEvent(kernel.bus, self)
        self.http = _CtxHttp(kernel, self)
        self.tool = _CtxTool(kernel, self)
        self.ui = _CtxUi(kernel, self)
        self.route = _CtxRoute(kernel, self)
        self.store = _CtxStore(self.id, self)  # T5：命名空间 SQLite（每插件独占库文件）
        # 【20261123 Phase 3.1】写操作 _cap("store.rw") 强制（time-report/echo-demo 已声明）
        self.db = _CtxDb(self.id)  # T5：命名空间 SQLite（每插件独占库文件）
        self.config = _CtxConfig(kernel, self)
        self.plugin = _CtxPluginAdmin(kernel, self)  # 仅 manager 插件实际可用
        # schedule 挂载（最小实现：登记到内核，由现有 schedule 体系接管）
        self._schedule_items = []

    def schedule_every(self, seconds, job, name=None):
        # 【20261123 Phase 3.1】声明与实现对齐：schedule 能力此前声明名漂移
        # （schedule / schedule.every 并存）且未强制；统一为 schedule.every 并
        # 与 http.route/tool.register/ui.mount/plugin.manage 同为硬能力。
        self._cap("schedule.every")
        self._schedule_items.append({"interval": seconds, "job": job, "name": name or self.id})
        self._kernel.register_schedule(self.id, self._schedule_items[-1])

    def _cap(self, cap):
        if cap not in self.caps:
            raise PermissionError("plugin %s lacks capability: %s" % (self.id, cap))


class _PluginLogger:
    def __init__(self, pid):
        self._p = pid

    def _fmt(self, msg):
        return "[plugin:%s] %s" % (self._p, msg)

    def info(self, m):
        log.info(self._fmt(m))

    def error(self, m):
        log.error(self._fmt("ERROR " + str(m)))


class _CtxStore:
    """PluginStore 薄包装：读放行，写（set）强制 store.rw 能力。"""

    def __init__(self, plugin_id, ctx):
        self._s = PluginStore(plugin_id)
        self._ctx = ctx

    def get(self, key, default=None):
        return self._s.get(key, default)

    def all(self):
        return self._s.all()

    def set(self, key, value):
        self._ctx._cap("store.rw")
        return self._s.set(key, value)


class _CtxEvent:
    def __init__(self, bus, ctx):
        self._bus, self._ctx = bus, ctx

    def on(self, event, fn):
        # 【20261123 Phase 3.1】声明与实现对齐：event.use 此前声明未强制
        self._ctx._cap("event.use")
        self._bus.on(event, fn, owner=self._ctx.id)

    def emit(self, event, data=None):
        self._ctx._cap("event.use")
        return self._bus.emit(event, data)


class _CtxHttp:
    """ctx.http.route → 复用 routes/dispatcher 注册表（插件=挂载点）。"""

    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    def route(self, path, fn, method="POST"):
        self._ctx._cap("http.route")
        from routes.dispatcher import route_post, route_get

        def _h(handler, p, parsed):
            fn(handler, p, parsed)

        kind = "route_get" if method == "GET" else "route_post"
        {"route_get": route_get, "route_post": route_post}[kind](path)(_h)
        # 【20261123 修复FH#5】补 _unreg：与 _CtxRoute._reg 对齐——插件 teardown 时
        # kernel_mgr 按 mounts 项的 _unreg=(kind, key) 调 dispatcher.unregister 注销，
        # 原实现缺该项导致插件停用后 http 路由残留。
        self._kernel.mounts.append({"plugin": self._ctx.id, "kind": "http", "target": path,
                                    "_unreg": (kind, path)})


class _CtxTool:
    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    def register(self, tool_def):
        self._ctx._cap("tool.register")
        self._kernel.tools[tool_def["name"]] = {**tool_def, "_plugin": self._ctx.id}
        self._kernel.mounts.append({"plugin": self._ctx.id, "kind": "tool", "target": tool_def["name"]})


class _CtxUi:
    """S7 前端挂载点：声明式挂载（slot+资源），前端经 /api/plugin-manager/ui-mounts 拉取。"""

    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    def mount(self, slot, assets):
        self._ctx._cap("ui.mount")
        if not isinstance(slot, str) or not slot:
            raise ValueError("slot required")
        entry = {"plugin": self._ctx.id, "slot": slot, "assets": list(assets or [])}
        self._kernel.mounts.append({"plugin": self._ctx.id, "kind": "ui", "target": slot})
        self._kernel.ui_mounts.append(entry)


class _CtxDb:
    """T5（策划案v4 K1）：插件命名空间 SQLite（server/data/plugin_store/<安全id>.sqlite）。

    每插件独占一个库文件——物理隔离即表级沙箱，插件摸不到别人的库；
    禁 ATTACH/DETACH（防越库逃逸）；query/exec 单语句，线程安全（库级锁）。"""

    _FORBIDDEN = ("attach", "detach")

    def __init__(self, plugin_id):
        import os
        safe = ""
        for ch in str(plugin_id):
            safe += ch if (ch.isalnum() or ch in "._-") else "_"
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "plugin_store")
        os.makedirs(base, exist_ok=True)
        self._path = os.path.join(base, safe + ".sqlite")
        self._lock = threading.Lock()
        self._conn = None

    def _conn_get(self):
        if self._conn is None:
            self._conn = sqlite3.connect(self._path, check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def _guard(self, sql):
        head = str(sql).lstrip().lower()
        for bad in self._FORBIDDEN:
            if head.startswith(bad):
                raise PermissionError("ctx.db 禁止 %s（命名空间沙箱）" % bad.upper())

    def execute(self, sql, params=()):
        """DDL/DML 单语句，返回受影响行数。自动提交。"""
        self._guard(sql)
        with self._lock:
            cur = self._conn_get().execute(sql, params)
            self._conn.commit()
            return cur.rowcount

    def query(self, sql, params=()):
        """SELECT 单语句，返回字典行列表。"""
        self._guard(sql)
        with self._lock:
            cur = self._conn_get().execute(sql, params)
            return [dict(r) for r in cur.fetchall()]

    def close(self):
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None


class _CtxRoute:
    """S8 插件路由能力：包装 dispatcher.route_*，注册记录进 kernel.mounts，teardown 时注销。"""

    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    def _reg(self, kind, key, fn):
        self._ctx._cap("http.route")
        import routes.dispatcher as D
        getattr(D, kind)(key)(fn)
        self._kernel.mounts.append({"plugin": self._ctx.id, "kind": "route",
                                    "target": key, "_unreg": (kind, key)})

    def post(self, path):
        return lambda fn: self._reg("route_post", path, fn)

    def get(self, path):
        return lambda fn: self._reg("route_get", path, fn)

    # T7（策划案v4）：前缀路由面板——/api/ext/* 之类 startswith 端点群的插件化入口
    def _reg_prefix(self, kind, prefix, fn):
        self._ctx._cap("http.route")
        import routes.dispatcher as D
        getattr(D, kind)(prefix)(fn)
        self._kernel.mounts.append({"plugin": self._ctx.id, "kind": "route",
                                    "target": prefix, "_unreg": (kind, prefix)})

    def post_prefix(self, prefix):
        return lambda fn: self._reg_prefix("route_post_prefix", prefix, fn)

    def get_prefix(self, prefix):
        return lambda fn: self._reg_prefix("route_get_prefix", prefix, fn)


class _CtxConfig:
    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    def get(self, key, default=None):
        cfg = self._kernel.plugin_config.get(self._ctx.id, {})
        declared = (self._ctx.manifest.get("config") or {}).get(key, {})
        return cfg.get(key, declared.get("default", default))


class _CtxPluginAdmin:
    """管理器专用 API：只有 capabilities 含 plugin.manage 的插件 ctx 才给真实现。"""

    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    def _check(self):
        self._ctx._cap("plugin.manage")

    def list(self):
        self._check()
        return self._kernel.list_plugins()

    def disable(self, plugin_id):
        self._check()
        return self._kernel.disable(plugin_id)

    def enable(self, plugin_id):
        self._check()
        return self._kernel.enable(plugin_id)

    def set_implementation(self, provides, plugin_id):
        self._check()
        return self._kernel.set_implementation(provides, plugin_id)

    def _kernel_reload(self, plugin_id):
        self._check()
        return self._kernel.reload(plugin_id)


