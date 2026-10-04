# -*- coding: utf-8 -*-
"""拆分总验证：任一断言失败即非零退出。"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

os.chdir(os.path.join(ROOT, 'server'))

# 1) chat_gate 门面
import chat_gate
for s in ('acquire', 'release', 'GateRejected', 'status_snapshot', 'set_lanes',
          '_LOCK', '_lanes', 'start_probe'):
    assert hasattr(chat_gate, s), 'chat_gate missing: ' + s

# 2) api_dispatch_post 门面
import routes.api_dispatch_post as m
for meth in ('_handle_swarm_post', '_handle_game_save_post',
             '_handle_engine2d_console_report', '_handle_perf_log_post', 'do_POST'):
    assert hasattr(m.MixinDispatchPost, meth), 'post mixin missing: ' + meth

# 3) 行数守恒：分段行数和 == 原文件（chat_gate.py.bak=1420）
base = os.path.join(ROOT, 'server')
g = sum(len(open(os.path.join(base, f), encoding='utf-8').read().splitlines())
        for f in ('_gate_state.py', '_gate_cfg_io.py', '_gate_acquire.py',
                  '_gate_worker.py', '_gate_admin.py'))
assert g == 1420, ('gate segments', g)
r = sum(len(open(os.path.join(base, 'routes', f), encoding='utf-8').read().splitlines())
        for f in ('_post_handlers.py', '_post_core_a.py', '_post_core_b.py'))
assert r == 1034, ('post segments', r)

# 4) 分段内容守恒：去头后逐行与 .bak 一致
for orig, segs, hdr_lines in (('chat_gate.py.bak', ['_gate_state.py', '_gate_cfg_io.py', '_gate_acquire.py', '_gate_worker.py', '_gate_admin.py'], 2),
                              (r'routes\api_dispatch_post.py.bak', [r'routes\_post_handlers.py', r'routes\_post_core_a.py', r'routes\_post_core_b.py'], 2)):
    orig_lines = open(os.path.join(base, orig), encoding='utf-8').read().splitlines(keepends=True)
    joined = []
    for f in segs:
        fl = open(os.path.join(base, f), encoding='utf-8').read().splitlines(keepends=True)
        joined.extend(fl[hdr_lines:])
    assert joined == orig_lines, ('content mismatch', orig)

print('ALL VERIFY OK')
