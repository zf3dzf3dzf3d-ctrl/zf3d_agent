# -*- coding: utf-8 -*-
"""T0 回归：核心插件防自锁守卫（策划案 v4 T0-4 修漂移 bug 的永久回归）。

背景：_CORE_PLUGINS 曾写成 {"zf-console"}，而插件真实 id 是 manager.zf-console，
守卫失配 → 核心插件可被 disable → 管理通道永久消失（重启仍失效）→ 管理面死锁。
修复：清单归内核单一真源 {"manager.zf-console"}，load_all 时对账告警。

用法：python tests/test_t0_core_guard.py   （退出码 0 = PASS）
全程用 tempfile，生产 plugins/ 与 plugin_states.json 零接触。
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

import kernel_core  # noqa: E402
import kernel_mgr  # noqa: E402

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append((name, detail))
    print(("  [PASS] " if ok else "  [FAIL] ") + name + (("  | " + detail) if detail else ""))


def make_plugin(root, dirname, pid, provides=""):
    d = os.path.join(root, dirname)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"id": pid, "name": dirname, "version": "1.0.0", "spec": 1,
                   "type": "infra", "entry": {"py": "main.py"},
                   "capabilities": ["plugin.manage"] if pid.startswith("manager.") else ["log.write"],
                   "provides": provides}, f)
    with open(os.path.join(d, "main.py"), "w", encoding="utf-8") as f:
        f.write("def setup(ctx):\n    pass\n\ndef teardown(ctx):\n    pass\n")


def main():
    tmp = tempfile.mkdtemp(prefix="t0_core_guard_")
    old_root, old_state = kernel_core._PLUGIN_ROOT, kernel_core._STATE_PATH
    kernel_core._PLUGIN_ROOT = os.path.join(tmp, "plugins")
    kernel_core._STATE_PATH = os.path.join(tmp, "states.json")
    os.makedirs(kernel_core._PLUGIN_ROOT, exist_ok=True)
    make_plugin(kernel_core._PLUGIN_ROOT, "fakeconsole", "manager.zf-console", provides="plugin.manager")
    make_plugin(kernel_core._PLUGIN_ROOT, "fakeextra", "tool.fakeextra")
    try:
        k = kernel_mgr.Kernel()
        k.load_all()
        check("T1 核心插件可启用", k.enable("manager.zf-console").get("ok") is True)
        check("T2 普通插件可启用", k.enable("tool.fakeextra").get("ok") is True)
        r = k.disable("manager.zf-console")
        check("T3 防自锁守卫生效（核心不可禁用）", r.get("ok") is False,
              "返回: %s" % r)
        check("T4 核心插件仍处 enabled", k.plugins["manager.zf-console"]["status"] == "enabled")
        r2 = k.disable("tool.fakeextra")
        check("T5 普通插件可正常禁用", r2.get("ok") is True)
        check("T6 core_plugins() 单一真源可读", kernel_mgr.Kernel.core_plugins() == {"manager.zf-console"})
        missing = k.verify_core_plugins()
        check("T7 对账：清单齐时无告警", missing == [])
        k._CORE_PLUGINS = {"manager.zf-console", "manager.ghost"}
        check("T8 对账：漂移项被点名", k.verify_core_plugins() == ["manager.ghost"])
    finally:
        kernel_core._PLUGIN_ROOT, kernel_core._STATE_PATH = old_root, old_state
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n结果: %d PASS / %d FAIL" % (len(PASS), len(FAIL)))
    for name, detail in FAIL:
        print("  FAIL:", name, detail)
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
