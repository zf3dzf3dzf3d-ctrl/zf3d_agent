# -*- coding: utf-8 -*-
"""内核 core：事件总线 EventBus + 沙箱存储 PluginStore + 内核级统一认证。
由 kernel.py（兼容 shim）re-export，外部一律 import kernel 使用。
"""
import json
import os
import re
import secrets
import threading
import traceback

# 内核版本号唯一真源 = private/version.json（经 config 读入），避免双源漂移
try:
    import config as _config
    KERNEL_VERSION = _config.VERSION
except Exception:
    KERNEL_VERSION = "0.0.0"  # 兜底：config 加载失败时仍可启动内核（0.0.0=保守值，插件 zfVersion 门槛比较会保守拒绝而非误放行）

_PLUGIN_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "plugins"))
_MODES_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "modes"))
_ENGINES_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "engines"))
_STATE_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), "data", "plugin_states.json"))

_VALID_TYPES = {"tool", "engine", "gateway", "ui", "schedule", "store", "prompt", "brain", "infra", "bundle", "mode"}



# ---------------------------------------------------------------- 事件总线


class EventBus:
    """内核只保证总线存在，不内置任何业务事件。"""

    def __init__(self):
        self._lock = threading.Lock()
        self._subs = {}  # event -> [(owner_plugin_id, fn)]

    def on(self, event, fn, owner=None):
        with self._lock:
            self._subs.setdefault(event, []).append((owner, fn))

    def off_plugin(self, plugin_id):
        """插件卸载时移除其全部订阅；通知相关订阅者 plugin.gone。"""
        with self._lock:
            gone_events = [e for e, subs in self._subs.items() if any(o == plugin_id for o, _ in subs)]
            for e in gone_events:
                self._subs[e] = [(o, f) for o, f in self._subs[e] if o != plugin_id]
        for e in gone_events:
            self.emit("plugin.gone", {"plugin": plugin_id, "event": e})

    def emit(self, event, data=None):
        with self._lock:
            subs = list(self._subs.get(event, []))
        results = []
        for _owner, fn in subs:
            try:
                results.append(fn(data))
            except Exception:
                traceback.print_exc()  # 崩溃隔离：订阅者异常不拖垮 emit 方
        return results


# ---------------------------------------------------------------- 存储句柄（沙箱化命名空间）


class PluginStore:
    """ctx.store：插件只能读写自己命名空间（server/data/plugin_store/<id>.json）。"""

    def __init__(self, plugin_id):
        self._dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "data", "plugin_store"))
        os.makedirs(self._dir, exist_ok=True)
        # 白名单字符过滤（S0.7 安全师建议#5）：只留字母/数字/点/横线/下划线，杜绝 /\ 及 Windows 盘符穿越
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", str(plugin_id))
        self._path = os.path.join(self._dir, safe + ".json")
        self._lock = threading.Lock()

    def _load(self):
        if os.path.exists(self._path):
            with open(self._path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def _save(self, data):
        with open(self._path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)

    def get(self, key, default=None):
        with self._lock:
            return self._load().get(key, default)

    def set(self, key, value):
        with self._lock:
            data = self._load()
            data[key] = value
            self._save(data)

    def all(self):
        with self._lock:
            return self._load()


# ---------------------------------------------------------------- 权限沙箱 ctx


# ---------------------------------------------------------------- 内核级统一认证


def _admin_token_path():
    # 沿用既有 plugins/data/plugin_console_token.txt（避免换路径造成静默轮换），仅持有权归内核
    root = _PLUGIN_ROOT if os.path.isabs(_PLUGIN_ROOT) else os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, 'plugins')
    return os.path.join(root, 'data', 'plugin_console_token.txt')


def get_admin_token():
    """管理 token 归内核统一持有。优先级：环境变量 ZF_ADMIN_TOKEN > 文件（首次生成）。
    【S1 门禁②】env 化：生产部署可不经磁盘文件传递 token（文件仅作本地开发默认）。"""
    env_tok = str(os.environ.get("ZF_ADMIN_TOKEN", "") or "").strip()
    if env_tok:
        return env_tok
    p = _admin_token_path()
    try:
        if os.path.exists(p):
            tok = open(p, 'r', encoding='utf-8').read().strip()
            if tok:
                return tok
        tok = secrets.token_hex(16)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(tok)
        try:
            os.chmod(p, 0o600)
        except Exception:
            pass
        return tok
    except Exception:
        return ''
