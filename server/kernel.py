# -*- coding: utf-8 -*-
"""插件内核（S1 三拆后兼容 shim，策划案 v1.1 §3/§4）。

拆分结构（S1-2，机械搬移零逻辑改动）：
    kernel_core.py  EventBus + PluginStore + 统一认证
    kernel_ctx.py   PluginContext + _Ctx* 能力面板
    kernel_mgr.py   Kernel 扫描/加载/热插拔/状态持久化
    kernel.py       本 shim：re-export 全部公开符号，外部 import kernel 不变
"""
import json  # noqa: F401  原单文件版顶层符号，测试/外部可能引用
import threading
import time  # noqa: F401  boot_plugins 计时

from kernel_core import (  # noqa: F401
    KERNEL_VERSION, _PLUGIN_ROOT, _MODES_ROOT, _STATE_PATH, _VALID_TYPES,
    EventBus, PluginStore, _admin_token_path, get_admin_token,
)
from kernel_ctx import (  # noqa: F401
    PluginContext, _PluginLogger, _CtxEvent, _CtxHttp, _CtxTool,
    _CtxConfig, _CtxPluginAdmin,
)
from kernel_mgr import Kernel  # noqa: F401


_kernel = None
_klock = threading.Lock()


def get_kernel():
    global _kernel
    if _kernel is None:
        with _klock:
            if _kernel is None:
                _kernel = Kernel()
    return _kernel


def boot_plugins():
    """最小引导入口：server 启动时调用；空 plugins/ 目录 = 空白智能体照常运行。"""
    k = get_kernel()
    t0 = time.time()
    k.load_all()
    n = sum(1 for p in k.list_plugins() if p["status"] == "enabled")
    print("[kernel] %s: %d plugins enabled (%.2fs)" % (KERNEL_VERSION, n, time.time() - t0))
    return k
