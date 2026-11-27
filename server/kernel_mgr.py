# -*- coding: utf-8 -*-
"""内核 manager：Kernel 扫描/加载/热插拔/替代仲裁/状态持久化。"""
import importlib.util
import io
import json
import os
import sys
import threading
import traceback

from kernel_core import EventBus, KERNEL_VERSION  # noqa: F401
import kernel_core as _core

from util_log import get_logger

log = get_logger('kernel_mgr')
# 调用点动态取 _core._PLUGIN_ROOT/_STATE_PATH：保持旧单文件版 monkeypatch 语义（M0 T4 patch kernel._PLUGIN_ROOT 经 shim 生效）
from kernel_ctx import PluginContext


# ---------------------------------------------------------------- 内核


class Kernel:
    def __init__(self):
        self.bus = EventBus()
        self.plugins = {}           # id -> {"manifest", "status", "module", "error", "dir"}
        self.tools = {}             # name -> tool_def（含 _plugin 归属）
        self.mounts = []            # 挂载清单（管理器展示用）
        self.ui_mounts = []         # S7 UI 挂载声明 [{plugin,slot,assets}]
        self.implementations = {}   # provides -> 当前选中 plugin_id
        self.plugin_config = {}     # id -> {key: value}
        self._schedule = []         # (plugin_id, item)
        self._lock = threading.RLock()
        self._load_states()

    # ---- 状态持久化
    def _load_states(self):
        try:
            if os.path.exists(_core._STATE_PATH):
                with open(_core._STATE_PATH, "r", encoding="utf-8") as f:
                    st = json.load(io.open(f.name, encoding="utf-8-sig"))
                self._enabled = set(st.get("enabled", []))
                self.implementations = st.get("implementations", {})
                self.plugin_config = st.get("config", {})
            else:
                self._enabled = set()
        except Exception:
            traceback.print_exc()
            self._enabled = set()

    def _save_states(self):
        try:
            os.makedirs(os.path.dirname(_core._STATE_PATH), exist_ok=True)
            # T0（2026-11-23）原子写：temp+replace，防写一半崩溃留下坏 JSON
            tmp = _core._STATE_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"enabled": sorted(self._enabled),
                           "implementations": self.implementations,
                           "config": self.plugin_config}, f, ensure_ascii=False, indent=1)
            os.replace(tmp, _core._STATE_PATH)
        except Exception:
            traceback.print_exc()

    # ---- 扫描与加载
    def scan(self):
        """扫描 plugins/ 目录，读取 manifest（不执行代码）。"""
        with self._lock:
            found = {}
            if os.path.isdir(_core._PLUGIN_ROOT):
                for d in sorted(os.listdir(_core._PLUGIN_ROOT)):
                    if d.startswith("_") or d.startswith("."):
                        # 与 modes/ 扫描同规则：_template 脚手架、隐藏目录不注册
                        continue
                    mpath = os.path.join(_core._PLUGIN_ROOT, d, "manifest.json")
                    if not os.path.isfile(mpath):
                        continue
                    try:
                        with open(mpath, "r", encoding="utf-8") as f:
                            m = json.load(io.open(f.name, encoding="utf-8-sig"))
                        errs = self._validate_manifest(m)
                        if errs:
                            found[m.get("id", d)] = {"manifest": m, "status": "invalid",
                                                     "error": "; ".join(errs), "dir": d, "module": None}
                            continue
                        found[m["id"]] = {"manifest": m, "status": "discovered",
                                          "error": None, "dir": d, "module": None}
                    except Exception as e:
                        found[d] = {"manifest": None, "status": "invalid",
                                    "error": "manifest load fail: %s" % e, "dir": d, "module": None}
            # S1-7 双轨合并：modes/ 体系（对话模式插件）纳入内核注册表。
            # mode 件无 py 入口（entry.panel 为前端文件），不执行代码，恒 discovered 等待运行时消费；
            # 注册 id 加 mode. 前缀防与 plugins/ 同名冲突。坏 manifest 同样记 invalid 不崩。
            if os.path.isdir(_core._MODES_ROOT):
                for d in sorted(os.listdir(_core._MODES_ROOT)):
                    if d.startswith("_") or d.startswith("."):
                        continue
                    mpath = os.path.join(_core._MODES_ROOT, d, "manifest.json")
                    if not os.path.isfile(mpath):
                        continue
                    try:
                        with open(mpath, "r", encoding="utf-8-sig") as f:
                            m = json.load(io.open(f.name, encoding="utf-8-sig"))
                        if not isinstance(m, dict) or not m.get("id") or m["id"] != d:
                            found["mode." + d] = {"manifest": m if isinstance(m, dict) else None,
                                                  "status": "invalid", "error": "mode id mismatch or bad manifest",
                                                  "dir": d, "module": None}
                            continue
                        m.setdefault("type", "mode")
                        found["mode." + m["id"]] = {"manifest": m, "status": "discovered",
                                                    "error": None, "dir": d, "module": None}
                    except Exception as e:
                        found["mode." + d] = {"manifest": None, "status": "invalid",
                                              "error": "manifest load fail: %s" % e, "dir": d, "module": None}
            # T4（策划案v4）：engines/ 体系（AI 引擎）纳入内核注册表，四体系归一补完最后一块。
            # 内核只登记不执行（engine.py 加载仍由 engines_loader 消费）；启停态单一真源：
            # 引擎条目 status=disabled 时 engines_loader 跳过加载。id 加 engine. 前缀防同名冲突。
            if os.path.isdir(_core._ENGINES_ROOT):
                for d in sorted(os.listdir(_core._ENGINES_ROOT)):
                    if d.startswith("_") or d.startswith("."):
                        continue
                    mpath = os.path.join(_core._ENGINES_ROOT, d, "manifest.json")
                    epath = os.path.join(_core._ENGINES_ROOT, d, "engine.py")
                    if not (os.path.isfile(mpath) and os.path.isfile(epath)):
                        continue
                    try:
                        with open(mpath, "r", encoding="utf-8-sig") as f:
                            m = json.load(io.open(f.name, encoding="utf-8-sig"))
                        if not isinstance(m, dict) or not m.get("id") or m["id"] != d:
                            found["engine." + d] = {"manifest": m if isinstance(m, dict) else None,
                                                    "status": "invalid", "error": "engine id mismatch or bad manifest",
                                                    "dir": d, "module": None}
                            continue
                        m.setdefault("type", "engine")
                        m.setdefault("version", "0.0.0")
                        m.setdefault("name", d)
                        found["engine." + m["id"]] = {"manifest": m, "status": "discovered",
                                                      "error": None, "dir": d, "module": None}
                    except Exception as e:
                        found["engine." + d] = {"manifest": None, "status": "invalid",
                                                "error": "manifest load fail: %s" % e, "dir": d, "module": None}
            # 保留已加载模块引用，清理已删除插件
            for pid in list(self.plugins):
                if pid not in found:
                    self.teardown(pid)
            for pid, info in found.items():
                if pid in self.plugins and self.plugins[pid].get("module") is not None:
                    info["module"] = self.plugins[pid]["module"]
                    info["status"] = self.plugins[pid]["status"]
                self.plugins[pid] = info
            return self.list_plugins()

    def _validate_manifest(self, m):
        errs = []
        if not m.get("id"):
            errs.append("missing id")
        if m.get("type") not in _core._VALID_TYPES:
            errs.append("bad type: %r" % m.get("type"))
        if not m.get("name"):
            errs.append("missing name")
        # spec schema 标识（S0 四体系合一）：缺省按 spec 1 兼容（存量 manifest），
        # 但显式声明了不认识的 spec 版本必须拒载，防未来版本字段被静默错读。
        spec = m.get("spec", 1)
        if spec != 1:
            errs.append("unsupported spec: %r (kernel supports spec 1)" % spec)
        return errs

    def _first_boot_seed(self):
        """首启播种（2026-11-25 修"全新环境图标全空"）：
        出厂状态=plugin_states.json 从不存在 → enabled 名单为空 → 0 插件启用，
        ui.dockapps-* 等全部不注入，Dock 图标只剩底座。6.0.0 图标硬编码所以"是全的"，
        6.1.0 迁插件后新装必空。此处补：状态文件不存在（且从无此文件）视为出厂首启，
        把 plugins/ 下全部合法 manifest 的插件播种进 enabled 并持久化。
        用户有过任何启停操作后文件必然存在 → 走用户状态，绝不覆盖用户决定。"""
        if _core._STATE_PATH and os.path.exists(_core._STATE_PATH):
            return  # 有历史状态=用户真源，不动
        if getattr(self, "_seeded", False):
            return  # 本进程已播种过，防重复
        try:
            with self._lock:
                self.scan()
                seed = [pid for pid, info in self.plugins.items()
                        if info.get("manifest") and info["status"] == "discovered"
                        and not pid.startswith(("mode.", "engine."))]
                if not seed:
                    return  # 空目录=空白体语义，保持
                self._enabled.update(seed)
                self._save_states()
                self._seeded = True
                log.info("[kernel][首启播种] 无 plugin_states.json，默认启用 %d 个官方插件: %s"
                         % (len(seed), ", ".join(sorted(seed))))
        except Exception:
            traceback.print_exc()

    def load_all(self):
        """拓扑序启用已授权（enabled 名单内）的插件；缺依赖挂起。"""
        self._first_boot_seed()
        with self._lock:
            self.scan()
            self.verify_core_plugins()  # T0 对账告警：核心清单漂移即喊话
            ids = sorted(self.plugins)
            # 简单拓扑：按 depends 深度排序（环由迭代上限兜底）
            order, done = [], set()

            def depth(pid, seen):
                if pid in seen or pid not in self.plugins:
                    return 0
                seen = seen | {pid}
                deps = self.plugins[pid]["manifest"].get("depends", []) if self.plugins[pid]["manifest"] else []
                return 1 + max([depth(d.lstrip("?"), seen) for d in deps] + [0])

            for pid in sorted(ids, key=lambda p: depth(p, set())):
                if pid in self._enabled:
                    self._enable_locked(pid)

            # 未启用的标记 discovered
            for pid in ids:
                if self.plugins[pid]["status"] == "discovered":
                    pass  # 保持 discovered，等待用户启用
            return self.list_plugins()

    def _check_version(self, m):
        zf = (m.get("zfVersion") or "").strip()
        if not zf:
            return True
        # 支持 ">=x.y.z" / "x.y.z"
        need = zf.lstrip(">= ").strip()
        try:
            def tp(v):
                return tuple(int(x) for x in v.split(".")[:3])
            return tp(KERNEL_VERSION) >= tp(need)
        except Exception:
            return True

    def _deps_satisfied(self, m):
        """返回 (ok, missing_hard_list)。'?' 前缀为可选依赖。"""
        missing = []
        for d in m.get("depends", []):
            if d.startswith("?"):
                continue
            dep = d.lstrip("?")
            info = self.plugins.get(dep)
            if not info or info["status"] not in ("enabled",):
                missing.append(dep)
        return (not missing), missing

    def _enable_locked(self, pid):
        info = self.plugins.get(pid)
        if not info or not info.get("manifest"):
            return {"ok": False, "error": "plugin not found or invalid"}
        m = info["manifest"]
        if not self._check_version(m):
            info["status"] = "incompatible"
            info["error"] = "needs zfVersion %s, kernel %s" % (m.get("zfVersion"), KERNEL_VERSION)
            return {"ok": False, "error": info["error"]}
        ok, missing = self._deps_satisfied(m)
        if not ok:
            info["status"] = "missing-dep"
            info["error"] = "missing deps: %s" % ", ".join(missing)
            return {"ok": False, "error": info["error"]}
        # 已启用则跳过
        if info["status"] == "enabled":
            return {"ok": True}
        entry_py = (m.get("entry") or {}).get("py")
        try:
            if entry_py:
                mod = self._import_plugin(info["dir"], entry_py, pid)
                if hasattr(mod, "setup"):
                    mod.setup(PluginContext(self, m))
                info["module"] = mod
            info["status"] = "enabled"
            info["error"] = None
            # provides 登记：默认第一个启用者为当前实现
            pv = m.get("provides")
            if pv and pv not in self.implementations:
                self.implementations[pv] = pid
            self._enabled.add(pid)
            self._save_states()
            return {"ok": True}
        except Exception as e:
            info["status"] = "error"
            info["error"] = "%s: %s" % (e.__class__.__name__, e)
            traceback.print_exc()
            return {"ok": False, "error": info["error"]}

    def _import_plugin(self, dir_name, entry, pid):
        """以独立模块名导入插件入口，避免与 server 内部模块混淆。"""

        path = os.path.join(_core._PLUGIN_ROOT, dir_name, entry)
        name = "zfplugin_" + pid.replace(".", "_").replace("/", "_").replace("-", "_")
        if name in sys.modules:
            return sys.modules[name]
        spec = importlib.util.spec_from_file_location(name, path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[name] = mod
        try:
            spec.loader.exec_module(mod)
        except Exception:
            # T8 修复（2026-11-23）：exec 失败必须移出缓存——否则半残模块（无 setup）
            # 被下次 enable 复用，插件被标记 enabled 但路由/挂载从未注册（空壳假启用）
            sys.modules.pop(name, None)
            raise
        return mod

    # ---- 热插拔 API
    def enable(self, pid):
        with self._lock:
            r = self._enable_locked(pid)
            self.load_all()  # 依赖它的插件可能因此可启用
            return r

    # 核心插件不可禁用保护（B2 防自锁）：manager.zf-console 提供全部 /api/plugin-manager/*
    # 管理 API，一旦被 disable 即管理通道永久消失（重启后 disable 持久化仍生效），
    # 任何插件都无法再启用 → 管理面死锁。核心清单禁改 manifest 绕过：校验在内核层。
    # T0（2026-11-23）修漂移：清单原为 {"zf-console"}，插件 id 实为 manager.zf-console，
    # 守卫失配即失效；单一真源归内核，zf-console 前端标记改读此处（kernel.core_plugins()），
    # load_all 时对账告警防再度漂移。
    _CORE_PLUGINS = {"manager.zf-console"}

    @classmethod
    def core_plugins(cls):
        """核心插件 id 集合（只读视图）。管理器插件下发 core 标记一律以此为准。"""
        return set(cls._CORE_PLUGINS)

    def verify_core_plugins(self):
        """启动对账（策划案 v4 T0-4）：核心清单里的 id 必须真实存在于注册表。"""
        missing = [pid for pid in sorted(self._CORE_PLUGINS)
                   if pid not in self.plugins]
        if missing:
            log.info("[kernel][对账告警] 核心插件清单含不存在项: %s "
                  "(防自锁守卫将落空，检查 _CORE_PLUGINS 与 manifest id 是否漂移)" % missing)
        return missing

    def disable(self, pid):
        # 锁审计（2026-11-26）：本函数持 self._lock 调 teardown（teardown 内部不再取 manager 锁，
        # bus.off_plugin 只取 EventBus 自己的锁，无重入死锁风险）；discard+_save_states 与
        # _enable_locked 的 add+_save_states 对称。【2026-11-26 修禁用复活】此前只 teardown
        # 不改 enabled 名单也不落盘 -> 重启后 load_all 按 enabled 名单把插件重新启用（禁用假动作）。
        with self._lock:
            if pid in self._CORE_PLUGINS:
                return {"ok": False, "error": f"core plugin '{pid}' cannot be disabled (self-lock guard)"}
            self.teardown(pid)
            self._enabled.discard(pid)
            self._save_states()
            return {"ok": True}

    def teardown(self, pid):
        info = self.plugins.get(pid)
        if not info:
            return {"ok": False, "error": "not found"}
        mod = info.get("module")
        try:
            if mod and hasattr(mod, "teardown"):
                mod.teardown(PluginContext(self, info["manifest"]))
        except Exception:
            traceback.print_exc()
        # 卸载其工具 / 事件订阅 / 挂载
        self.tools = {k: v for k, v in self.tools.items() if v.get("_plugin") != pid}
        self.bus.off_plugin(pid)
        # S8：注销该插件注册的路由（必须在 mounts 过滤前收集）
        # T2.4：restore=True——插件曾覆盖静态接线（domain_*）的 key 时回栈恢复原注册者
        for _m in [m for m in self.mounts if m["plugin"] == pid and m.get("_unreg")]:
            try:
                from routes.dispatcher import unregister as _unreg_route
                _unreg_route(_m["_unreg"][1], restore=True)
            except Exception:
                pass
        self.mounts = [m for m in self.mounts if m["plugin"] != pid]
        self.ui_mounts = [m for m in self.ui_mounts if m["plugin"] != pid]
        self._schedule = [s for s in self._schedule if s[0] != pid]
        pv = (info.get("manifest") or {}).get("provides")
        if pv and self.implementations.get(pv) == pid:
            self.implementations.pop(pv, None)
        info["status"] = "disabled"
        info["module"] = None
        self._enabled.discard(pid)
        self._save_states()
        # T8 修复（2026-11-23）：teardown 时同步移除模块缓存——否则 disable→enable
        # 与 reload 拿到的都是旧代码（_import_plugin 按 zfplugin_* 命中缓存直接返回），
        # 插件代码更新后无法热换。路由已注销/工具已卸载，旧函数对象不再被注册表持有。
        modname = "zfplugin_" + pid.replace(".", "_").replace("/", "_").replace("-", "_")
        sys.modules.pop(modname, None)
        return {"ok": True}

    def reload(self, pid):
        with self._lock:
            self.teardown(pid)
            # T8 修复：原句 del sys.modules[pid] 删错键（pid≠模块名），缓存从未清过
            modname = "zfplugin_" + pid.replace(".", "_").replace("/", "_").replace("-", "_")
            sys.modules.pop(modname, None)
            return self._enable_locked(pid)

    def set_implementation(self, provides, pid):
        with self._lock:
            info = self.plugins.get(pid)
            if not info or info["status"] != "enabled":
                return {"ok": False, "error": "target plugin not enabled"}
            if (info["manifest"].get("provides") or "") != provides:
                return {"ok": False, "error": "plugin does not provide %s" % provides}
            self.implementations[provides] = pid
            self._save_states()
            return {"ok": True}

    def resolve(self, provides):
        """取某能力的当前实现插件 id（替代机制查询入口）。"""
        return self.implementations.get(provides)

    def list_tools(self):
        """T3 桥（策划案v4 K3）：全部内核注册工具的定义面（含 _plugin 归属，剔 exec 执行体）。
        引擎侧经此把插件工具合并进对话工具清单；engines 内部注册表收编随 T3 主体推进。"""
        with self._lock:
            return {name: {k: v for k, v in d.items() if k != "exec"}
                    for name, d in self.tools.items()}

    def register_schedule(self, pid, item):
        self._schedule.append((pid, item))

    def set_config(self, pid, cfg):
        with self._lock:
            self.plugin_config.setdefault(pid, {}).update(cfg)
            self._save_states()

    def list_plugins(self):
        with self._lock:
            return [{"id": pid,
                     "name": (i.get("manifest") or {}).get("name", pid),
                     "type": (i.get("manifest") or {}).get("type"),
                     "version": (i.get("manifest") or {}).get("version"),
                     "provides": (i.get("manifest") or {}).get("provides"),
                     "description": (i.get("manifest") or {}).get("description"),
                     "status": i["status"],
                     "error": i["error"]} for pid, i in self.plugins.items()]

    def status(self):
        return {"kernel": KERNEL_VERSION,
                "plugins": self.list_plugins(),
                "tools": sorted(self.tools),
                "mounts": self.mounts,
                "implementations": self.implementations}


# 模块级单例（server 最小引导时 init）
