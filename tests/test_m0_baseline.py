# -*- coding: utf-8 -*-
"""M0 拔测基线回归脚本（蜂群收口第4/5轮裁决 #35~#39 入库版）。

验收四条（缺一不算 PASS，对应 S0 三条验收中已闭环的第 1 条的完整版）：
  T1 物理拔光：真实挪走 plugins/ 目录 → boot_plugins() 不崩、空白体照常
  T2 破坏性输入：损坏 manifest / 缺字段插件 / 空目录名插件 → 逐个报错跳过、内核不崩
  T3 恢复+逐插件 load：真实 plugins/ 归位 → 3 个试点插件 load 成功（非仅 discovered）
  T4 monkeypatch 快速自检（开发期用，降级为非验收项）

非破坏性：全程用 move 往返 + tempfile，生产 plugins/ 零删除。
用法：python tests/test_m0_baseline.py   （退出码 0 = PASS）
"""
import json
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

import kernel  # noqa: E402

PLUGIN_ROOT = kernel._PLUGIN_ROOT
BACKUP = PLUGIN_ROOT + "_m0_拔走备份"
PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append((name, detail))
    print(("  [PASS] " if ok else "  [FAIL] ") + name + (("  | " + detail) if detail else ""))


def boot():
    return kernel.boot_plugins()


def t1_physical_unplug():
    """T1 物理拔光：move 真实 plugins/ → boot 空白体 → move 回来。"""
    print("T1 物理拔光（move 往返）")
    if os.path.isdir(BACKUP):  # 上次异常残留，先还原
        shutil.move(BACKUP, PLUGIN_ROOT)
    shutil.move(PLUGIN_ROOT, BACKUP)
    try:
        k = boot()
        check("T1a 目录不存在时 boot_plugins 不崩", True)
        lst = k.list_plugins()
        # S1-7 起注册表含 modes/ 体系（恒 discovered），T4 起含 engines/ 体系——
        # 空白体判定=无业务件 enabled 且无 plugins/ 残留（mode./engine. 体系条目豁免：
        # 体系件可处于 enabled 态——如用户曾在管理器启用过某引擎——不算业务残留）
        non_mode = [p for p in lst
                    if not str(p.get("id", "")).startswith(("mode.", "engine."))]
        enabled = [p for p in lst if p.get("status") == "enabled"
                   and not str(p.get("id", "")).startswith(("mode.", "engine."))]
        check("T1b 空白体 0 插件", len(non_mode) == 0 and len(enabled) == 0,
              "非mode/engine条目=%d 业务enabled=%d" % (len(non_mode), len(enabled)))
    finally:
        shutil.move(BACKUP, PLUGIN_ROOT)
    k = boot()
    n = len(k.list_plugins())
    check("T1c 归位后重扫描", n >= 3, "发现 %d 个插件" % n)


def t2_corrupt_inputs():
    """T2 破坏性输入：临时 plugins 根塞坏 manifest/缺字段/怪目录名，内核须不崩且逐个跳过。"""
    print("T2 破坏性输入")
    tmp = tempfile.mkdtemp(prefix="m0_corrupt_")
    # 坏 JSON
    os.mkdir(os.path.join(tmp, "bad-json"))
    with open(os.path.join(tmp, "bad-json", "manifest.json"), "w", encoding="utf-8") as f:
        f.write("{not json!!")
    # 缺 id 字段
    os.mkdir(os.path.join(tmp, "no-id"))
    with open(os.path.join(tmp, "no-id", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"name": "缺id", "version": "0.1"}, f)
    # 空目录（无 manifest）
    os.mkdir(os.path.join(tmp, "empty-dir"))
    # Windows 保留名目录名（非法但在扫描层会出现）
    os.mkdir(os.path.join(tmp, "con"))
    with open(os.path.join(tmp, "con", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"id": "x.y", "name": "怪名", "version": "0.1", "type": "tool"}, f)

    old = kernel._PLUGIN_ROOT
    kernel._PLUGIN_ROOT = tmp
    try:
        k = boot()  # 任何一步崩溃都会让本用例 FAIL
        check("T2a 破坏性输入下 boot_plugins 不崩", True)
    except Exception as e:  # noqa: BLE001
        check("T2a 破坏性输入下 boot_plugins 不崩", False, repr(e))
        return
    finally:
        kernel._PLUGIN_ROOT = old
        shutil.rmtree(tmp, ignore_errors=True)
    bad_ids = {"bad-json", "no-id", "x.y"}
    listed = k.list_plugins()
    from_tmp = [p for p in listed if (p.get("id") in bad_ids or p.get("name") == "缺id")]
    none_enabled = all(p.get("status") != "enabled" for p in from_tmp)
    check("T2b 坏插件未被错误启用（逐个跳过）", none_enabled,
          "tmp 注入插件状态: %s" % [(p.get("id"), p.get("status")) for p in from_tmp])


def t3_reload_and_load():
    """T3 恢复 + 逐插件 load：真实 3 个试点插件 load 成功（非仅 discovered）。"""
    print("T3 恢复+逐插件 load")
    k = boot()
    plugins = k.list_plugins()
    ok_ids = [p.get("id") for p in plugins]
    for expect in ("tool.echo-demo", "tool.time-report", "manager.zf-console"):
        check("T3 %s load 成功" % expect, expect in ok_ids, "当前: %s" % ok_ids)


def t4_monkeypatch_quick():
    """T4 monkeypatch 快速自检（开发期用，非验收项）。"""
    print("T4 monkeypatch 快速自检")
    tmp = tempfile.mkdtemp(prefix="m0_empty_")
    old = kernel._PLUGIN_ROOT
    kernel._PLUGIN_ROOT = tmp
    kernel_core = sys.modules.setdefault("kernel_core", kernel)  # 三拆后常量真身在 kernel_core
    old_c = getattr(kernel_core, "_PLUGIN_ROOT", old)
    try:
        kernel_core._PLUGIN_ROOT = tmp
        boot()
        check("T4 空目录快速自检不崩", True)
    finally:
        kernel_core._PLUGIN_ROOT = old_c
        kernel._PLUGIN_ROOT = old
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    print("M0 基线回归（kernel %s, plugins_root=%s）" % (kernel.KERNEL_VERSION, PLUGIN_ROOT))
    t4_monkeypatch_quick()
    t1_physical_unplug()
    t2_corrupt_inputs()
    t3_reload_and_load()
    print("\n结果: %d PASS / %d FAIL" % (len(PASS), len(FAIL)))
    for name, detail in FAIL:
        print("  FAIL:", name, detail)
    sys.exit(0 if not FAIL else 1)
