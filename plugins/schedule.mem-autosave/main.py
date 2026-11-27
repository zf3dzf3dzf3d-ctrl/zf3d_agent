# -*- coding: utf-8 -*-
"""schedule.mem-autosave：长期记忆库 git 定时快照（T6，策划案v4）。

桥接 server/memory_autosave 旧轨 start_autosave_thread（过渡桥，T5/T8 摘壳时
转正为纯插件实现）。server_runtime 侧有双轨守卫：本插件启用（provides
mem_autosave 有实现）即跳过旧轨自启，全程唯一线程真源。
"""
import os

# 【20261123 修复FH#4】setup 防重入标记（内核 setup/teardown 串行调用，布尔足够）
_active = False


def setup(ctx):
    global _active
    if _active:
        ctx.log.info("mem-autosave setup: already active, skip re-entry")
        return
    from memory_autosave import start_autosave_thread
    base_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
    start_autosave_thread(base_dir)  # 模块级单例守卫：已有存活线程直接复用
    _active = True
    ctx.log.info("mem-autosave thread started via plugin (provides=mem_autosave)")


def teardown(ctx):
    # 【20261123 修复FH#4】摘壳收口：stop_autosave 置位 Event + 短超时 join，
    # 睡眠已改为可中断 wait，线程即时退出；超时（5s）则留 daemon 自然退出。
    from memory_autosave import stop_autosave
    ok = stop_autosave(timeout=5)
    _active = False
    ctx.log.info("mem-autosave teardown: stop_autosave -> %s"
                 % ("stopped" if ok else "timeout, daemon exits on next wake"))
